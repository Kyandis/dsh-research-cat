// Reproduce the exact graph the panel holds right now, using host.js's own query logic.
// Usage: node fetch.mjs W2907492528 [W3152893301 ...]  -> graph.json
import { writeFileSync } from 'node:fs'

const OA = 'https://api.openalex.org'
const MAILTO = 'dsh-research-cat@localhost'
const RECORD_SELECT = 'id,doi,title,display_name,publication_year,cited_by_count,type,primary_location'
const EDGE_SELECT = 'id,referenced_works,related_works'
const MAX_BATCH = 30

const shortId = (v) => (v === null || v === undefined ? '' : String(v).replace(/^https?:\/\/openalex\.org\//, ''))
const isWorkId = (id) => /^W\d+$/.test(id)

async function getJson(url) {
  const res = await fetch(url, { headers: { 'user-agent': 'dsh-research-cat-lab' } })
  if (!res.ok) throw new Error('HTTP ' + res.status + ' for ' + url)
  return res.json()
}
function recordOf(work) {
  const loc = work.primary_location
  const src = loc && typeof loc === 'object' ? loc.source : null
  return {
    id: shortId(work.id),
    title: work.title || work.display_name || '(untitled)',
    year: typeof work.publication_year === 'number' ? work.publication_year : 0,
    citedBy: typeof work.cited_by_count === 'number' ? work.cited_by_count : 0,
    doi: work.doi || null,
    venue: src && src.display_name ? src.display_name : null,
    kind: work.type || null,
    seed: false,
  }
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
    '&select=' + encodeURIComponent(RECORD_SELECT) + '&per-page=50&mailto=' + encodeURIComponent(MAILTO)
  const data = await getJson(url)
  return Array.isArray(data.results) ? data.results.map(recordOf) : []
}
async function oaEdgeLists(id) {
  const url = OA + '/works/' + id + '?select=' + encodeURIComponent(EDGE_SELECT) + '&mailto=' + encodeURIComponent(MAILTO)
  const data = await getJson(url)
  return {
    references: Array.isArray(data.referenced_works) ? data.referenced_works : [],
    related: Array.isArray(data.related_works) ? data.related_works : [],
  }
}
async function oaCitedBy(id, limit) {
  const url = OA + '/works?filter=' + encodeURIComponent('cites:' + id) +
    '&select=' + encodeURIComponent(RECORD_SELECT) + '&sort=cited_by_count:desc&per-page=' + limit +
    '&mailto=' + encodeURIComponent(MAILTO)
  const data = await getJson(url)
  return Array.isArray(data.results) ? data.results.map(recordOf) : []
}
async function oaDetail(id) {
  const url = OA + '/works/' + id + '?select=' + encodeURIComponent(RECORD_SELECT) + '&mailto=' + encodeURIComponent(MAILTO)
  const data = await getJson(url)
  return recordOf(data)
}

const outFile = process.argv[2] || 'graph.json'
const seeds = process.argv.slice(3)
const nodes = new Map()
const links = new Map()
const putNode = (rec, isSeed) => {
  const ex = nodes.get(rec.id)
  if (ex !== undefined) { if (isSeed) ex.seed = true; return ex }
  const n = { ...rec, seed: isSeed === true }
  nodes.set(n.id, n)
  return n
}
const putLink = (s, t, kind) => {
  if (!isWorkId(s) || !isWorkId(t) || s === t) return
  links.set(s + '>' + t + '>' + kind, { source: s, target: t, kind })
}

for (const seed of seeds) {
  const rec = await oaDetail(seed)
  putNode(rec, true)
  const edges = await oaEdgeLists(seed)
  const refs = await oaByIds(edges.references.slice(0, MAX_BATCH))
  for (const r of refs) { putNode(r, false); putLink(seed, r.id, 'references') }
  const related = await oaByIds(edges.related.slice(0, MAX_BATCH))
  for (const r of related) { putNode(r, false); putLink(seed, r.id, 'related') }
  const citers = await oaCitedBy(seed, 25)
  for (const c of citers) { putNode(c, false); putLink(seed, c.id, 'citations') }
  console.log('seed ' + seed + ': refs=' + refs.length + ' related=' + related.length + ' citers=' + citers.length)
}

const graph = { seeds: seeds.slice(), nodes: [...nodes.values()], links: [...links.values()] }
writeFileSync(new URL('./' + outFile, import.meta.url), JSON.stringify(graph, null, 2))
console.log('graph -> ' + outFile + ': ' + graph.nodes.length + ' nodes, ' + graph.links.length + ' links')