// Research Cat core: the OpenAlex access layer and the in-memory citation graph.
// Ported from the DSH dynamic plugin's host half. No harness / Cordis dependency:
// the only external capabilities used are global fetch and this module's own state.
//
// State is per library instance. createLibrary() therefore gives every MCP session
// its own collection and graph, so concurrent users never share a graph.

const OA = 'https://api.openalex.org'
// OpenAlex's polite pool prefers a real contact address; override via env.
const MAILTO = process.env.RESEARCH_CAT_MAILTO || 'research-cat-mcp@localhost'
const RECORD_SELECT = 'id,doi,title,display_name,publication_year,cited_by_count,type,primary_location'
const EDGE_SELECT = 'id,referenced_works,related_works'
const DETAIL_SELECT = 'id,doi,title,publication_year,cited_by_count,type,authorships,primary_location,abstract_inverted_index,referenced_works,related_works'
const MAX_NODES = 400
const MAX_BATCH = 30

function hasText(value) {
  return typeof value === 'string' && value.length > 0
}
function nullIfEmpty(value) {
  return hasText(value) ? value : null
}
function messageOf(error) {
  if (error !== null && error !== undefined && hasText(error.message)) return String(error.message)
  return String(error)
}
function shortId(value) {
  if (value === null || value === undefined) return ''
  return String(value).replace(/^https?:\/\/openalex\.org\//, '')
}
function isWorkId(id) {
  return /^W\d+$/.test(id)
}
function doiIn(query) {
  const match = String(query).match(/10\.\d{4,9}\/[^\s"'<>]+/)
  if (match === null) return null
  return match[0].replace(/[.,;)]+$/, '')
}

function venueOf(work) {
  const location = work.primary_location
  if (location === null || typeof location !== 'object') return null
  const source = location.source
  if (source === null || typeof source !== 'object') return null
  return nullIfEmpty(source.display_name)
}

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

// OpenAlex returns an inverted index (word -> positions); rebuild the sentence.
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

export function createLibrary() {
  const nodes = new Map()
  const links = new Map()
  const catalog = new Map()
  const seeds = []
  const cache = new Map()

  async function getJson(url) {
    const cached = cache.get(url)
    if (cached !== undefined) return cached
    const response = await fetch(url, { headers: { accept: 'application/json' } })
    const text = await response.text()
    if (!response.ok) {
      throw new Error('OpenAlex answered HTTP ' + response.status + '.')
    }
    let data
    try {
      data = JSON.parse(text)
    } catch (error) {
      throw new Error('The OpenAlex reply was cut short before it could be parsed; try again.')
    }
    if (cache.size > 240) cache.clear()
    cache.set(url, data)
    return data
  }

  async function oaSearch(term) {
    const url = OA + '/works?search=' + encodeURIComponent(term) +
      '&select=' + encodeURIComponent(RECORD_SELECT) +
      '&per-page=20&mailto=' + encodeURIComponent(MAILTO)
    const data = await getJson(url)
    return Array.isArray(data.results) ? data.results.map(recordOf) : []
  }

  async function oaByDoi(doi) {
    const url = OA + '/works?filter=' + encodeURIComponent('doi:' + doi.toLowerCase()) +
      '&select=' + encodeURIComponent(RECORD_SELECT) +
      '&per-page=1&mailto=' + encodeURIComponent(MAILTO)
    const data = await getJson(url)
    if (!Array.isArray(data.results) || data.results.length === 0) return null
    return recordOf(data.results[0])
  }

  async function oaByIds(ids) {
    const unique = []
    const seen = {}
    for (let i = 0; i < ids.length && unique.length < MAX_BATCH; i++) {
      const id = shortId(ids[i])
      if (!isWorkId(id) || seen[id] === true) continue
      seen[id] = true
      unique.push(id)
    }
    if (unique.length === 0) return []
    const url = OA + '/works?filter=' + encodeURIComponent('openalex_id:' + unique.join('|')) +
      '&select=' + encodeURIComponent(RECORD_SELECT) +
      '&per-page=50&mailto=' + encodeURIComponent(MAILTO)
    const data = await getJson(url)
    return Array.isArray(data.results) ? data.results.map(recordOf) : []
  }

  async function oaEdgeLists(id) {
    const url = OA + '/works/' + id + '?select=' + encodeURIComponent(EDGE_SELECT) +
      '&mailto=' + encodeURIComponent(MAILTO)
    const data = await getJson(url)
    return {
      references: Array.isArray(data.referenced_works) ? data.referenced_works : [],
      related: Array.isArray(data.related_works) ? data.related_works : [],
    }
  }

  async function oaCitedBy(id, limit) {
    const url = OA + '/works?filter=' + encodeURIComponent('cites:' + id) +
      '&select=' + encodeURIComponent(RECORD_SELECT) +
      '&sort=cited_by_count:desc&per-page=' + limit +
      '&mailto=' + encodeURIComponent(MAILTO)
    const data = await getJson(url)
    return Array.isArray(data.results) ? data.results.map(recordOf) : []
  }

  async function oaDetail(id) {
    const url = OA + '/works/' + id + '?select=' + encodeURIComponent(DETAIL_SELECT) +
      '&mailto=' + encodeURIComponent(MAILTO)
    const data = await getJson(url)
    const paper = recordOf(data)
    paper.abstract = abstractOf(data)
    paper.authors = authorsOf(data)
    paper.url = 'https://openalex.org/' + paper.id
    paper.referenceCount = Array.isArray(data.referenced_works) ? data.referenced_works.length : 0
    paper.relatedCount = Array.isArray(data.related_works) ? data.related_works.length : 0
    return paper
  }

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

  function putLink(source, target, kind) {
    if (!isWorkId(source) || !isWorkId(target) || source === target) return
    links.set(source + '>' + target + '>' + kind, { source: source, target: target, kind: kind })
  }

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

  async function runSearch(term) {
    const doi = doiIn(term)
    if (doi !== null) {
      const resolved = await oaByDoi(doi)
      if (resolved !== null) return [resolved]
    }
    return oaSearch(term)
  }

  async function expandInto(id, kind) {
    if (nodes.size >= MAX_NODES) {
      throw new Error('The graph already holds ' + nodes.size + ' papers; clear it before expanding further.')
    }
    let found = []
    if (kind === 'citations') {
      found = await oaCitedBy(id, 25)
    } else {
      const edges = await oaEdgeLists(id)
      const wanted = kind === 'references' ? edges.references : edges.related
      found = await oaByIds(wanted.slice(0, MAX_BATCH))
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

  function describe(list) {
    const lines = []
    for (let i = 0; i < list.length; i++) {
      const paper = list[i]
      const bits = []
      if (paper.year > 0) bits.push(String(paper.year))
      if (paper.venue !== null) bits.push(paper.venue)
      bits.push(paper.citedBy + ' citations')
      bits.push('id ' + paper.id)
      lines.push((i + 1) + '. ' + paper.title + ' -- ' + bits.join(' / '))
    }
    return lines.join('\n')
  }

  function counts() {
    let reference = 0
    let citation = 0
    let related = 0
    links.forEach(function (link) {
      if (link.kind === 'references') reference++
      else if (link.kind === 'citations') citation++
      else if (link.kind === 'related') related++
    })
    return { papers: nodes.size, links: links.size, seeds: seeds.length, reference: reference, citation: citation, related: related }
  }

  return {
    async search(query) {
      const term = typeof query === 'string' ? query.trim() : ''
      if (term.length === 0) return { ok: false, text: 'search_papers needs a non-empty query.' }
      try {
        const found = await runSearch(term)
        for (let i = 0; i < found.length; i++) catalog.set(found[i].id, found[i])
        if (found.length === 0) return { ok: true, text: 'No OpenAlex work matched "' + term + '".' }
        return { ok: true, text: 'OpenAlex matches for "' + term + '":\n' + describe(found) }
      } catch (error) {
        return { ok: false, text: 'search_papers failed: ' + messageOf(error) }
      }
    },

    async add(id) {
      const work = shortId(hasText(id) ? id : '')
      if (!isWorkId(work)) return { ok: false, text: 'add_paper needs an OpenAlex work id such as W2094864959.' }
      try {
        const record = await ensureRecord(work)
        putNode(record, true)
        if (seeds.indexOf(work) < 0) seeds.unshift(work)
        const c = counts()
        return {
          ok: true,
          text: 'Added "' + record.title + '" (' + work + ') to the collection, which now holds ' + seeds.length +
            ' paper(s); the graph holds ' + c.papers + ' node(s) and ' + c.links + ' link(s).',
        }
      } catch (error) {
        return { ok: false, text: 'add_paper failed: ' + messageOf(error) }
      }
    },

    async expand(id, kind) {
      const work = shortId(hasText(id) ? id : '')
      const use = hasText(kind) ? kind : 'related'
      if (!isWorkId(work)) return { ok: false, text: 'expand_paper needs an OpenAlex work id such as W2094864959.' }
      if (use !== 'references' && use !== 'citations' && use !== 'related') {
        return { ok: false, text: 'kind must be references, citations, or related.' }
      }
      try {
        const outcome = await expandInto(work, use)
        return {
          ok: true,
          text: 'Expanded ' + work + ' by ' + use + ': ' + outcome.found + ' neighbour(s) found, ' +
            outcome.added + ' new node(s) added. The graph now holds ' + nodes.size + ' node(s).',
        }
      } catch (error) {
        return { ok: false, text: 'expand_paper failed: ' + messageOf(error) }
      }
    },

    async details(id) {
      const work = shortId(hasText(id) ? id : '')
      if (!isWorkId(work)) return { ok: false, text: 'paper_details needs an OpenAlex work id such as W2094864959.' }
      try {
        const paper = await oaDetail(work)
        const lines = []
        lines.push(paper.title)
        lines.push('id ' + paper.id + (paper.doi ? '  doi ' + paper.doi : ''))
        const meta = []
        if (paper.venue !== null) meta.push(paper.venue)
        if (paper.year > 0) meta.push(String(paper.year))
        meta.push(paper.citedBy + ' citations')
        meta.push(paper.referenceCount + ' references')
        meta.push(paper.relatedCount + ' similar works')
        lines.push(meta.join(' / '))
        if (paper.authors.length > 0) {
          const shown = paper.authors.length > 8 ? paper.authors.slice(0, 8).join(', ') + ' et al.' : paper.authors.join(', ')
          lines.push('authors: ' + shown)
        }
        lines.push('openalex: ' + paper.url)
        lines.push('')
        lines.push(paper.abstract.length > 0 ? paper.abstract : '(OpenAlex holds no abstract for this record.)')
        return { ok: true, text: lines.join('\n') }
      } catch (error) {
        return { ok: false, text: 'paper_details failed: ' + messageOf(error) }
      }
    },

    async list() {
      if (seeds.length === 0) return { ok: true, text: 'The collection is empty.' }
      const lines = []
      for (let i = 0; i < seeds.length; i++) {
        const node = nodes.get(seeds[i])
        lines.push((i + 1) + '. ' + (node === undefined
          ? seeds[i]
          : node.title + ' (' + node.year + ') -- ' + node.citedBy + ' citations -- id ' + node.id))
      }
      const c = counts()
      return {
        ok: true,
        text: 'Collection (' + seeds.length + ' seed(s); graph: ' + c.papers + ' papers, ' + c.links +
          ' links -- ' + c.reference + ' reference / ' + c.citation + ' citation / ' + c.related + ' similar):\n' +
          lines.join('\n'),
      }
    },

    async clear() {
      nodes.clear()
      links.clear()
      seeds.length = 0
      return { ok: true, text: 'Cleared: the in-memory collection and graph are empty again.' }
    },
  }
}
