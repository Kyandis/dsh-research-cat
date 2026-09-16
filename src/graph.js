/**
 * The Research Cat engine: OpenAlex access plus the in-memory citation graph.
 *
 * Ported from the dynamic-plugin host half. Two differences from that version:
 *
 * - Operations return plain data and throw on failure. The HTTP routes hand the
 *   data to the panel, and the agent tool formats it as text — one engine, two
 *   consumers.
 * - Network access is plain `fetch` (Node 18+), isolated in {@link getJson} so
 *   it can be pointed at the harness `web` service later if that is wanted.
 *
 * State is per library instance and never touches disk.
 *
 * @module dsh-research-cat/graph
 */

const OA = 'https://api.openalex.org'
const RECORD_SELECT = 'id,doi,title,display_name,publication_year,cited_by_count,type,primary_location'
const EDGE_SELECT = 'id,referenced_works,related_works'
const DETAIL_SELECT = 'id,doi,title,publication_year,cited_by_count,type,authorships,primary_location,abstract_inverted_index,referenced_works,related_works'
const CACHE_LIMIT = 240

/** @param {unknown} value @returns {boolean} */
function hasText(value) {
  return typeof value === 'string' && value.length > 0
}

/** @param {unknown} value @returns {string | null} */
function nullIfEmpty(value) {
  return hasText(value) ? value : null
}

/** @param {unknown} error @returns {string} */
export function messageOf(error) {
  if (error !== null && error !== undefined && hasText(error.message)) return String(error.message)
  return String(error)
}

/** Strip the OpenAlex URL prefix: `https://openalex.org/W123` -> `W123`. */
function shortId(value) {
  if (value === null || value === undefined) return ''
  return String(value).replace(/^https?:\/\/openalex\.org\//, '')
}

/** @param {string} id @returns {boolean} */
function isWorkId(id) {
  return /^W\d+$/.test(id)
}

/** Pull a bare DOI out of a free-text query, or null. */
function doiIn(query) {
  const match = String(query).match(/10\.\d{4,9}\/[^\s"'<>]+/)
  if (match === null) return null
  return match[0].replace(/[.,;)]+$/, '')
}

/** Journal / venue name from `primary_location.source.display_name`. */
function venueOf(work) {
  const location = work.primary_location
  if (location === null || typeof location !== 'object') return null
  const source = location.source
  if (source === null || typeof source !== 'object') return null
  return nullIfEmpty(source.display_name)
}

/** Normalise one OpenAlex work into a graph record. */
function recordOf(work) {
  return {
    id: shortId(work.id),
    title: nullIfEmpty(work.title) || nullIfEmpty(work.display_name) || '(untitled)',
    year: typeof work.publication_year === 'number' ? work.publication_year : 0,
    citedBy: typeof work.cited_by_count === 'number' ? work.cited_by_count : 0,
    doi: nullIfEmpty(work.doi),
    venue: venueOf(work),
    kind: nullIfEmpty(work.type),
    seed: false,
  }
}

/**
 * Rebuild the abstract. OpenAlex returns an inverted index (word -> positions),
 * not prose, so the words are placed back at their offsets.
 */
function abstractOf(work) {
  const inverted = work.abstract_inverted_index
  if (inverted === null || typeof inverted !== 'object') return ''
  const words = []
  const keys = Object.keys(inverted)
  for (let i = 0; i < keys.length; i++) {
    const positions = inverted[keys[i]]
    if (!Array.isArray(positions)) continue
    for (let p = 0; p < positions.length; p++) {
      if (typeof positions[p] === 'number') words[positions[p]] = keys[i]
    }
  }
  const text = words.filter(function (word) { return typeof word === 'string' }).join(' ')
  return text.length > 1500 ? text.slice(0, 1500) + ' ...' : text
}

/** Author display names from `authorships`. */
function authorsOf(work) {
  const list = work.authorships
  if (!Array.isArray(list)) return []
  const names = []
  for (let i = 0; i < list.length; i++) {
    const entry = list[i]
    const author = entry === null || typeof entry !== 'object' ? null : entry.author
    const name = author === null || typeof author !== 'object' ? null : nullIfEmpty(author.display_name)
    if (name !== null) names.push(name)
  }
  return names
}

/**
 * @typedef {object} LibraryOptions
 * @property {string} mailto - OpenAlex polite-pool contact address.
 * @property {number} maxNodes - papers per graph ceiling.
 * @property {number} maxBatch - neighbours per references/related expand.
 * @property {number} maxCitations - citing papers per citations expand.
 */

/**
 * Build one independent library (its own collection, graph and cache).
 *
 * @param {LibraryOptions} options - resolved plugin config.
 */
export function createLibrary(options) {
  const mailto = options.mailto
  const maxNodes = options.maxNodes
  const maxBatch = options.maxBatch
  const maxCitations = options.maxCitations

  /** @type {Map<string, any>} */
  const nodes = new Map()
  /** @type {Map<string, any>} */
  const links = new Map()
  /** @type {Map<string, any>} */
  const catalog = new Map()
  /** @type {string[]} */
  const seeds = []
  /** @type {Map<string, any>} */
  const cache = new Map()

  /** One OpenAlex GET, JSON-parsed and cached by URL. */
  async function getJson(url) {
    const cached = cache.get(url)
    if (cached !== undefined) return cached
    let response
    try {
      response = await fetch(url, { headers: { accept: 'application/json' } })
    } catch (error) {
      throw new Error('OpenAlex is unreachable: ' + messageOf(error))
    }
    const text = await response.text()
    if (!response.ok) throw new Error('OpenAlex answered HTTP ' + response.status + '.')
    let data
    try {
      data = JSON.parse(text)
    } catch {
      throw new Error('The OpenAlex reply was cut short before it could be parsed; try again.')
    }
    if (cache.size > CACHE_LIMIT) cache.clear()
    cache.set(url, data)
    return data
  }

  const withMailto = (url) => url + (url.includes('?') ? '&' : '?') + 'mailto=' + encodeURIComponent(mailto)

  async function oaSearch(term) {
    const url = OA + '/works?search=' + encodeURIComponent(term) +
      '&select=' + encodeURIComponent(RECORD_SELECT) + '&per-page=20'
    const data = await getJson(withMailto(url))
    return Array.isArray(data.results) ? data.results.map(recordOf) : []
  }

  async function oaByDoi(doi) {
    const url = OA + '/works?filter=' + encodeURIComponent('doi:' + doi.toLowerCase()) +
      '&select=' + encodeURIComponent(RECORD_SELECT) + '&per-page=1'
    const data = await getJson(withMailto(url))
    if (!Array.isArray(data.results) || data.results.length === 0) return null
    return recordOf(data.results[0])
  }

  async function oaByIds(ids) {
    const unique = []
    const seen = {}
    for (let i = 0; i < ids.length && unique.length < maxBatch; i++) {
      const id = shortId(ids[i])
      if (!isWorkId(id) || seen[id] === true) continue
      seen[id] = true
      unique.push(id)
    }
    if (unique.length === 0) return []
    const url = OA + '/works?filter=' + encodeURIComponent('openalex_id:' + unique.join('|')) +
      '&select=' + encodeURIComponent(RECORD_SELECT) + '&per-page=50'
    const data = await getJson(withMailto(url))
    return Array.isArray(data.results) ? data.results.map(recordOf) : []
  }

  async function oaEdgeLists(id) {
    const url = OA + '/works/' + id + '?select=' + encodeURIComponent(EDGE_SELECT)
    const data = await getJson(withMailto(url))
    return {
      references: Array.isArray(data.referenced_works) ? data.referenced_works : [],
      related: Array.isArray(data.related_works) ? data.related_works : [],
    }
  }

  async function oaCitedBy(id, limit) {
    const url = OA + '/works?filter=' + encodeURIComponent('cites:' + id) +
      '&select=' + encodeURIComponent(RECORD_SELECT) +
      '&sort=cited_by_count:desc&per-page=' + limit
    const data = await getJson(withMailto(url))
    return Array.isArray(data.results) ? data.results.map(recordOf) : []
  }

  async function oaDetail(id) {
    const url = OA + '/works/' + id + '?select=' + encodeURIComponent(DETAIL_SELECT)
    const data = await getJson(withMailto(url))
    const paper = recordOf(data)
    paper.abstract = abstractOf(data)
    paper.authors = authorsOf(data)
    paper.url = 'https://openalex.org/' + paper.id
    paper.referenceCount = Array.isArray(data.referenced_works) ? data.referenced_works.length : 0
    paper.relatedCount = Array.isArray(data.related_works) ? data.related_works.length : 0
    return paper
  }

  /** Insert or merge a node. Merging never overwrites richer existing fields. */
  function putNode(record, isSeed) {
    const existing = nodes.get(record.id)
    if (existing !== undefined) {
      if (isSeed === true) existing.seed = true
      if (existing.venue === null && record.venue !== null) existing.venue = record.venue
      return existing
    }
    const node = {
      id: record.id,
      title: record.title,
      year: record.year,
      citedBy: record.citedBy,
      doi: record.doi,
      venue: record.venue,
      kind: record.kind,
      seed: isSeed === true,
    }
    nodes.set(node.id, node)
    return node
  }

  /** Link two works. The composite key makes re-expanding idempotent. */
  function putLink(source, target, kind) {
    if (!isWorkId(source) || !isWorkId(target) || source === target) return
    links.set(source + '>' + target + '>' + kind, { source: source, target: target, kind: kind })
  }

  /** A pure snapshot the panel can hold. */
  function graph() {
    const nodeList = []
    nodes.forEach(function (node) {
      nodeList.push({
        id: node.id,
        title: node.title,
        year: node.year,
        citedBy: node.citedBy,
        doi: node.doi,
        venue: node.venue,
        kind: node.kind,
        seed: node.seed === true,
      })
    })
    const linkList = []
    links.forEach(function (link) {
      linkList.push({ source: link.source, target: link.target, kind: link.kind })
    })
    return { seeds: seeds.slice(), nodes: nodeList, links: linkList }
  }

  /** Drop non-seed nodes that no link touches any more. */
  function pruneOrphans() {
    const touched = new Map()
    links.forEach(function (link) {
      touched.set(link.source, true)
      touched.set(link.target, true)
    })
    const doomed = []
    nodes.forEach(function (node) {
      if (node.seed !== true && touched.has(node.id) !== true) doomed.push(node.id)
    })
    for (let i = 0; i < doomed.length; i++) nodes.delete(doomed[i])
  }

  async function ensureRecord(id) {
    const known = catalog.get(id) || nodes.get(id)
    if (known !== undefined) return known
    const found = await oaByIds([id])
    if (found.length === 0) throw new Error('OpenAlex has no work with id ' + id + '.')
    catalog.set(id, found[0])
    return found[0]
  }

  /** Search: a bare DOI short-circuits to the DOI lookup, else full-text search. */
  async function runSearch(term) {
    const doi = doiIn(term)
    if (doi !== null) {
      const resolved = await oaByDoi(doi)
      if (resolved !== null) return [resolved]
    }
    return oaSearch(term)
  }

  async function expandInto(id, kind) {
    if (nodes.size >= maxNodes) {
      throw new Error('The graph already holds ' + nodes.size + ' papers; clear it before expanding further.')
    }
    let found = []
    if (kind === 'citations') {
      found = await oaCitedBy(id, maxCitations)
    } else {
      const edges = await oaEdgeLists(id)
      const wanted = kind === 'references' ? edges.references : edges.related
      found = await oaByIds(wanted.slice(0, maxBatch))
    }
    let added = 0
    for (let i = 0; i < found.length; i++) {
      if (found[i].id === id) continue
      if (!nodes.has(found[i].id)) added += 1
      putNode(found[i], false)
      putLink(id, found[i].id, kind)
    }
    return { found: found.length, added: added }
  }

  /** Graph totals, including the per-kind link split. */
  function counts() {
    let reference = 0
    let citation = 0
    let related = 0
    links.forEach(function (link) {
      if (link.kind === 'references') reference++
      else if (link.kind === 'citations') citation++
      else if (link.kind === 'related') related++
    })
    return {
      papers: nodes.size,
      links: links.size,
      seeds: seeds.length,
      reference: reference,
      citation: citation,
      related: related,
    }
  }

  /** Validate a work id argument. */
  function requireWorkId(value, what) {
    const id = shortId(hasText(value) ? value : '')
    if (!isWorkId(id)) throw new Error(what + ' needs an OpenAlex work id such as W2094864959.')
    return id
  }

  return {
    /** The whole graph snapshot. */
    state() {
      return { graph: graph(), counts: counts() }
    },

    /** Full-text (or DOI) search; results are also cached for later adds. */
    async search(query) {
      const term = hasText(query) ? query.trim() : ''
      if (term.length === 0) throw new Error('Type a title, author, topic or DOI first.')
      const found = await runSearch(term)
      for (let i = 0; i < found.length; i++) catalog.set(found[i].id, found[i])
      return { term: term, results: found, graph: graph(), counts: counts() }
    },

    /** Add one collected paper (a graph seed). */
    async addSeed(id) {
      const work = requireWorkId(id, 'Adding a paper')
      const record = await ensureRecord(work)
      putNode(record, true)
      if (seeds.indexOf(work) < 0) seeds.unshift(work)
      return { record: record, graph: graph(), counts: counts() }
    },

    /** Remove one seed and everything that hangs off it alone. */
    removeSeed(id) {
      const work = shortId(hasText(id) ? id : '')
      const at = seeds.indexOf(work)
      if (at >= 0) seeds.splice(at, 1)
      nodes.delete(work)
      const doomed = []
      links.forEach(function (link, key) {
        if (link.source === work || link.target === work) doomed.push(key)
      })
      for (let i = 0; i < doomed.length; i++) links.delete(doomed[i])
      pruneOrphans()
      return { graph: graph(), counts: counts() }
    },

    /** Pull one paper's neighbours in. */
    async expand(id, kind) {
      const work = requireWorkId(id, 'Expanding a paper')
      const use = hasText(kind) ? kind : 'related'
      if (use !== 'references' && use !== 'citations' && use !== 'related') {
        throw new Error('Unknown expansion kind: ' + use + '. Use references, citations or related.')
      }
      const outcome = await expandInto(work, use)
      return { kind: use, found: outcome.found, added: outcome.added, graph: graph(), counts: counts() }
    },

    /** Expand up to the first six seeds by references and related work. */
    async expandAll() {
      const targets = seeds.slice(0, 6)
      if (targets.length === 0) throw new Error('Add at least one paper to the collection first.')
      let added = 0
      let warning = null
      for (let i = 0; i < targets.length; i++) {
        const kinds = ['references', 'related']
        for (let k = 0; k < kinds.length; k++) {
          try {
            const outcome = await expandInto(targets[i], kinds[k])
            added += outcome.added
          } catch (error) {
            if (warning === null) warning = messageOf(error)
          }
        }
      }
      return { added: added, warning: warning, graph: graph(), counts: counts() }
    },

    /** One paper's full record (authors, abstract, counts). */
    async details(id) {
      const work = requireWorkId(id, 'Reading a paper')
      return { paper: await oaDetail(work) }
    },

    /** Wipe the collection and the graph. */
    clear() {
      nodes.clear()
      links.clear()
      seeds.length = 0
      return { graph: graph(), counts: counts() }
    },

    /** Snapshot helper for the agent tool. */
    snapshot() {
      return { graph: graph(), counts: counts() }
    },
  }
}

/**
 * Tokenise an OpenAlex id list for a batch lookup — exported for tests.
 *
 * @param {string[]} ids - raw ids.
 * @param {number} limit - cap.
 * @returns {string[]} unique bare work ids.
 */
export function uniqueWorkIds(ids, limit) {
  const unique = []
  const seen = {}
  for (let i = 0; i < ids.length && unique.length < limit; i++) {
    const id = shortId(ids[i])
    if (!isWorkId(id) || seen[id] === true) continue
    seen[id] = true
    unique.push(id)
  }
  return unique
}
