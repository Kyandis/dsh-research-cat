const OA = 'https://api.openalex.org'
const MAILTO = 'dsh-research-cat@localhost'
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

return {
  apply(ctx) {
    const nodes = new Map()
    const links = new Map()
    const catalog = new Map()
    const seeds = []
    const cache = new Map()

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

    async function getJson(url) {
      const cached = cache.get(url)
      if (cached !== undefined) return cached
      const web = ctx.get('web')
      if (web === undefined) throw new Error('The harness web service is not available, so OpenAlex cannot be reached.')
      const response = await web.fetch({ url: url })
      if (response === null || response === undefined || typeof response.statusCode !== 'number') {
        throw new Error('OpenAlex returned no usable response.')
      }
      const body = response.body
      const text = body !== null && typeof body === 'object' && typeof body.content === 'string' ? body.content : ''
      if (response.statusCode < 200 || response.statusCode >= 300) {
        throw new Error('OpenAlex answered HTTP ' + response.statusCode + '.')
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

    harness.handle('state', function () {
      return { ok: true, graph: graph() }
    })

    harness.handle('search', async function (args) {
      const term = args !== null && typeof args === 'object' && hasText(args.query) ? args.query.trim() : ''
      if (term.length === 0) return { ok: false, error: 'Type a title, author, topic or DOI first.' }
      try {
        const found = await runSearch(term)
        for (let i = 0; i < found.length; i++) catalog.set(found[i].id, found[i])
        return { ok: true, term: term, results: found, graph: graph() }
      } catch (error) {
        return { ok: false, error: messageOf(error) }
      }
    })

    harness.handle('addSeed', async function (args) {
      const raw = args !== null && typeof args === 'object' && hasText(args.id) ? args.id : ''
      const id = shortId(raw)
      if (!isWorkId(id)) return { ok: false, error: 'No OpenAlex paper id was supplied.' }
      try {
        const record = await ensureRecord(id)
        putNode(record, true)
        if (seeds.indexOf(id) < 0) seeds.unshift(id)
        return { ok: true, graph: graph() }
      } catch (error) {
        return { ok: false, error: messageOf(error) }
      }
    })

    harness.handle('removeSeed', function (args) {
      const raw = args !== null && typeof args === 'object' && hasText(args.id) ? args.id : ''
      const id = shortId(raw)
      const at = seeds.indexOf(id)
      if (at >= 0) seeds.splice(at, 1)
      nodes.delete(id)
      const doomed = []
      links.forEach(function (link, key) {
        if (link.source === id || link.target === id) doomed.push(key)
      })
      for (let i = 0; i < doomed.length; i++) links.delete(doomed[i])
      pruneOrphans()
      return { ok: true, graph: graph() }
    })

    harness.handle('expand', async function (args) {
      const raw = args !== null && typeof args === 'object' && hasText(args.id) ? args.id : ''
      const id = shortId(raw)
      const kind = args !== null && typeof args === 'object' && hasText(args.kind) ? args.kind : 'related'
      if (!isWorkId(id)) return { ok: false, error: 'No OpenAlex paper id was supplied.' }
      if (kind !== 'references' && kind !== 'citations' && kind !== 'related') {
        return { ok: false, error: 'Unknown expansion kind.' }
      }
      try {
        const outcome = await expandInto(id, kind)
        return { ok: true, kind: kind, found: outcome.found, added: outcome.added, graph: graph() }
      } catch (error) {
        return { ok: false, error: messageOf(error) }
      }
    })

    harness.handle('expandAll', async function () {
      const targets = seeds.slice(0, 6)
      if (targets.length === 0) return { ok: false, error: 'Add at least one paper to the collection first.' }
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
      return { ok: true, added: added, warning: warning, graph: graph() }
    })

    harness.handle('details', async function (args) {
      const raw = args !== null && typeof args === 'object' && hasText(args.id) ? args.id : ''
      const id = shortId(raw)
      if (!isWorkId(id)) return { ok: false, error: 'No OpenAlex paper id was supplied.' }
      try {
        return { ok: true, paper: await oaDetail(id) }
      } catch (error) {
        return { ok: false, error: messageOf(error) }
      }
    })

    harness.handle('clear', function () {
      nodes.clear()
      links.clear()
      seeds.length = 0
      return { ok: true, graph: graph() }
    })

    try {
      const tool = harness.defineTool({
        name: 'research_cat',
        description: 'Explore a literature graph in the Research Cat panel. Search OpenAlex for papers, add them to the shared collection, expand a paper into its references / citing papers / similar work, or list the current collection. This tool and the Research Cat panel share one in-memory library, so papers added here appear in the panel and vice versa. Paper ids are OpenAlex work ids such as W2094864959.',
        parameters: {
          action: {
            type: 'string',
            required: true,
            enum: ['search', 'add', 'expand', 'list'],
            description: 'search = find papers by title, author, topic or DOI; add = put one paper into the collection; expand = pull one paper neighbours into the graph; list = show the current collection.',
          },
          query: { type: 'string', description: 'Search text for action "search": a title, author, topic, or a DOI.' },
          id: { type: 'string', description: 'OpenAlex work id for action "add" or "expand", for example W2094864959.' },
          kind: {
            type: 'string',
            enum: ['references', 'citations', 'related'],
            description: 'Which neighbours action "expand" pulls: the paper references, the papers citing it, or similar work.',
          },
        },
        output: {
          schema: {
            type: 'object',
            additionalProperties: false,
            properties: {
              ok: { type: 'boolean', required: true },
              text: { type: 'string', required: true },
            },
          },
          render: function (args, value) {
            const body = value !== null && value !== undefined && hasText(value.text)
              ? value.text
              : 'research_cat produced no output.'
            return [{ type: 'text', text: body }]
          },
        },
        execute: async function (args) {
          const input = args !== null && typeof args === 'object' ? args : {}
          const action = hasText(input.action) ? input.action : ''
          try {
            if (action === 'search') {
              const term = hasText(input.query) ? input.query.trim() : ''
              if (term.length === 0) return { ok: false, text: 'action "search" needs a non-empty query.' }
              const found = await runSearch(term)
              for (let i = 0; i < found.length; i++) catalog.set(found[i].id, found[i])
              if (found.length === 0) return { ok: true, text: 'No OpenAlex work matched "' + term + '".' }
              return { ok: true, text: 'OpenAlex matches for "' + term + '":\n' + describe(found) }
            }
            if (action === 'add') {
              const id = shortId(hasText(input.id) ? input.id : '')
              if (!isWorkId(id)) return { ok: false, text: 'action "add" needs an OpenAlex work id such as W2094864959.' }
              const record = await ensureRecord(id)
              putNode(record, true)
              if (seeds.indexOf(id) < 0) seeds.unshift(id)
              return { ok: true, text: 'Added "' + record.title + '" (' + id + ') to the collection, which now holds ' + seeds.length + ' paper(s).' }
            }
            if (action === 'expand') {
              const id = shortId(hasText(input.id) ? input.id : '')
              const kind = hasText(input.kind) ? input.kind : 'related'
              if (!isWorkId(id)) return { ok: false, text: 'action "expand" needs an OpenAlex work id such as W2094864959.' }
              if (kind !== 'references' && kind !== 'citations' && kind !== 'related') {
                return { ok: false, text: 'kind must be references, citations, or related.' }
              }
              const outcome = await expandInto(id, kind)
              return {
                ok: true,
                text: 'Expanded ' + id + ' by ' + kind + ': ' + outcome.found + ' neighbour(s) found, ' +
                  outcome.added + ' new node(s) added. The graph now holds ' + nodes.size + ' node(s).',
              }
            }
            if (action === 'list') {
              if (seeds.length === 0) return { ok: true, text: 'The Research Cat collection is empty.' }
              const lines = []
              for (let i = 0; i < seeds.length; i++) {
                const node = nodes.get(seeds[i])
                lines.push((i + 1) + '. ' + (node === undefined
                  ? seeds[i]
                  : node.title + ' (' + node.year + ') -- ' + node.citedBy + ' citations -- id ' + node.id))
              }
              return { ok: true, text: 'Collection (' + seeds.length + '):\n' + lines.join('\n') }
            }
            return { ok: false, text: 'Unknown action "' + action + '". Use search, add, expand, or list.' }
          } catch (error) {
            return { ok: false, text: 'research_cat failed: ' + messageOf(error) }
          }
        },
      })
      harness.registerTool(ctx, tool)
    } catch (error) {
      console.error('research_cat: tool registration failed -- ' + messageOf(error))
    }
  },
}
