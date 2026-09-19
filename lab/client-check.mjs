// Offline self-check for the browser half of dsh-research-cat (task t4).
//
//   node lab/client-check.mjs
//
// The panel is browser code that cannot be imported by Node (it calls
// `window.__ModuleLoader__.load`), so this script:
//   1. evaluates src/client.js in a vm with a fake Loader + fake document and
//      asserts the Loader/slot contract;
//   2. extracts the `@parity:` marked pure functions from the shipped source
//      and asserts their properties directly (frozen radial-layout digests
//      taken from the 9a1bd7d baseline, timeline monotonicity, axis ticks,
//      collection forest);
//   3. renders the real `ResearchCatPanel` through a miniature hook runtime
//      against a mocked /dsh-research-cat host, drives the UI (tabs, filters,
//      layout switch, selection, kind toggles, zoom, pan, node drag, Clear,
//      Auto-expand, Re-layout, library operations, notes) and asserts what the
//      rendered tree actually shows.
//
// Scope note: this suite asserts browser-half behaviour only. It deliberately
// does NOT import src/config.js, src/tools.js or test/local.mjs, so host-side
// assertions (config defaults, tool enum, list wording, store isolation) can
// evolve independently in test/local.mjs without locking this file.
import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
import { createHash } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
const root = resolve(here, '..')
const src = readFileSync(resolve(root, 'src/client.js'), 'utf8')

let failures = 0
function check(label, condition, detail) {
  if (condition) console.log('  PASS ' + label)
  else { failures++; console.log('  FAIL ' + label + (detail === undefined ? '' : ' -> ' + detail)) }
}

/* ------------------------------------------------------------- parity blocks */

function block(name) {
  const start = src.indexOf('/* @parity:' + name + ':start */')
  const end = src.indexOf('/* @parity:' + name + ':end */')
  if (start < 0 || end < 0) throw new Error('missing @parity block ' + name)
  return src.slice(start, end + ('/* @parity:' + name + ':end */').length)
}
function fromBlock(name, expr) {
  return new Function(block(name) + '\n;return ' + expr + ';')()
}

const computeTimelineLayout = fromBlock('computeTimelineLayout', 'computeTimelineLayout')
const timelineTicks = fromBlock('timelineTicks', 'timelineTicks')
const computeRadialLayout = fromBlock('computeRadialLayout', 'computeRadialLayout')
const radiusOf = fromBlock('radiusOf', 'radiusOf')
const layoutExtent = fromBlock('layoutExtent', 'layoutExtent')
const treeFns = fromBlock('buildCollectionTree', '({ buildCollectionTree: buildCollectionTree, flattenCollectionTree: flattenCollectionTree })')

const BOX = { w: 1200, h: 800 }

/* ------------- 1. radial layout: A0 baseline + the intentional t11 snapshot */

// Digests are frozen constants (not a git lookup) so this suite runs anywhere.
//  * BASELINE_IDENTICAL — input where neither the t10 seed quirk nor the t11
//    clamp could trigger (the only seed is the hub; the outer ring stays inside
//    the old clamp radius 374 and node radii already fit minSpacing). Computed
//    from `git show 9a1bd7d:src/client.js` (computeLayout): these must not move.
//  * POST_T11 — clamp-affected input, whose snapshot t11 intentionally updated
//    (before: 16/18, 118/120, 257/260 nodes placed and worst overlap margins of
//    -31.9 / -37.2, min distances 2.07 / 0.006). The relaxed AC-A6-7 criterion
//    is: every node placed, no pair closer than its radii sum, rings grow past
//    the old clamp instead of stacking, rest of the arithmetic unchanged. The
//    dedicated suite with the coordinates lives in test/client.mjs.
const RADIAL_BASELINE_IDENTICAL = [
  { label: 'star, seed is the hub (24 nodes, spin 0)', data: starHub(24), spin: 0, keys: 24, digest: 'c652299929f47b64348d169bcf143013498c714cf19017716de00926f3cf5171' },
  { label: 'star, seed is the hub (40 nodes, spin 2)', data: starHub(40), spin: 2, keys: 40, digest: '75ffd0c808c3b02072e849175efc41f6f6b1ad1baa91b1f61411e439b0a344dd' },
  { label: 'random legacy graph, no seeds, clamp-free (24 nodes, spin 0)', data: sample(41, 24, undefined, 0), spin: 0, keys: 24, digest: '30a01314e1db4a1b5a6658fd31f63cd23314e5e38526b67d61889f74ab5da546' },
]
const RADIAL_POST_T11 = [
  { label: '3 seeds, 18 nodes, spin 0', data: sample(7, 18, undefined, 3), spin: 0, keys: 18, digest: '5fa04849c8fccd2b41f5c37c5fd0bee06c6999ca9cd561a4e74e2ce8a923fa1f' },
  { label: '3 seeds, 120 nodes, spin 1', data: sample(11, 120, undefined, 3), spin: 1, keys: 120, digest: '6dbc4c45c16df0b62df8bcea9bc26974c0da4b11eb82459070843017b6fa9a5a' },
  { label: '3 seeds, 260 nodes, spin 3', data: sample(13, 260, undefined, 3), spin: 3, keys: 260, digest: 'f9db7acb16a6491da1d3bd427e0d1d0854b245071a5e748d190b0999cded78a9' },
  { label: 'no seeds, 60 nodes, spin 0 (was an A0 case until its outer ring hit the clamp)', data: sample(31, 60, undefined, 0), spin: 0, keys: 60, digest: '55c832cfcf67cb32410023a059847e3016d138cb48cf7fe5bf9448265d6656ab' },
]

function sample(seed, count, kinds, seedCount) {
  let state = seed
  function rnd() { state = (state * 1103515245 + 12345) % 2147483648; return state / 2147483648 }
  const nodes = []
  for (let i = 0; i < count; i++) {
    nodes.push({ id: 'W' + i, title: 't' + i, year: 1990 + Math.floor(rnd() * 30), citedBy: Math.floor(rnd() * 4000), seed: i < (seedCount === undefined ? 3 : seedCount) })
  }
  const links = []
  const pool = kinds || ['references', 'citations', 'related']
  for (let i = 1; i < count; i++) {
    links.push({ source: nodes[Math.floor(rnd() * i)].id, target: nodes[i].id, kind: pool[Math.floor(rnd() * pool.length)] })
  }
  return { nodes, links }
}

/** Star whose only seed is the hub, so the t10 and t11 quirks cannot trigger. */
function starHub(count, kinds) {
  const pool = kinds || ['references', 'citations', 'related']
  const nodes = []
  for (let i = 0; i < count; i++) nodes.push({ id: 'W' + i, title: 't' + i, year: 1990 + i, citedBy: count - i, seed: i === 0 })
  const links = []
  for (let i = 1; i < count; i++) links.push({ source: 'W0', target: 'W' + i, kind: pool[i % pool.length] })
  return { nodes, links }
}

/** Star with `seedCount` seed leaves plus `leafCount` non-seed leaves around a non-seed hub. */
function starSeeds(seedCount, leafCount) {
  const nodes = [{ id: 'HUB', title: 'hub', year: 2000, citedBy: 100, seed: false }]
  for (let i = 0; i < seedCount; i++) nodes.push({ id: 'S' + i, title: 'seed' + i, year: 1995 + i, citedBy: 50 - i, seed: true })
  for (let i = 0; i < leafCount; i++) nodes.push({ id: 'P' + i, title: 'leaf' + i, year: 2010, citedBy: 10, seed: false })
  const links = []
  for (let i = 0; i < seedCount; i++) links.push({ source: 'HUB', target: 'S' + i, kind: 'references' })
  for (let i = 0; i < leafCount; i++) links.push({ source: 'HUB', target: 'P' + i, kind: 'related' })
  return { nodes, links }
}

function canonical(place) {
  return JSON.stringify(Object.keys(place).sort().map((id) => [id, place[id].x, place[id].y]))
}
function digestOf(text) {
  return createHash('sha256').update(text).digest('hex')
}
function overlapReport(place, nodes) {
  let maxCited = 0
  for (let i = 0; i < nodes.length; i++) if (nodes[i].citedBy > maxCited) maxCited = nodes[i].citedBy
  const ids = nodes.map((n) => n.id)
  const radii = {}
  for (let i = 0; i < nodes.length; i++) radii[nodes[i].id] = radiusOf(nodes[i].citedBy, maxCited)
  let worst = Infinity
  let overlapping = 0
  for (let i = 0; i < ids.length; i++) {
    for (let j = i + 1; j < ids.length; j++) {
      const a = place[ids[i]]
      const b = place[ids[j]]
      if (a === undefined || b === undefined) continue
      const margin = Math.hypot(a.x - b.x, a.y - b.y) - (radii[ids[i]] + radii[ids[j]])
      if (margin < 0) overlapping++
      if (margin < worst) worst = margin
    }
  }
  return { worst: worst, overlapping: overlapping }
}

let baselineOk = true
let baselineDetail = ''
for (const item of RADIAL_BASELINE_IDENTICAL) {
  const place = computeRadialLayout(item.data.nodes, item.data.links, item.spin, BOX)
  const text = canonical(place)
  if (!(Object.keys(place).length === item.keys && digestOf(text) === item.digest)) { baselineOk = false; baselineDetail = item.label }
}
check('A0: radial layout stays byte-identical to the 9a1bd7d baseline where neither quirk can trigger (3 datasets)', baselineOk, baselineDetail)

let postOk = true
let postDetail = ''
for (const item of RADIAL_POST_T11) {
  const place = computeRadialLayout(item.data.nodes, item.data.links, item.spin, BOX)
  const text = canonical(place)
  if (!(Object.keys(place).length === item.keys && digestOf(text) === item.digest)) {
    postOk = false
    postDetail = item.label
  }
}
check('t11 snapshot: clamp-affected layouts match the intentionally updated digests (4 datasets, up to 260 nodes)', postOk, postDetail)

let seedFixOk = true
let seedFixDetail = ''
for (const seedCount of [2, 3, 5, 50]) {
  const graph = starSeeds(seedCount, 4)
  const place = computeRadialLayout(graph.nodes, graph.links, 0, BOX)
  const seedIds = graph.nodes.filter((n) => n.seed === true).map((n) => n.id)
  const placed = seedIds.filter((id) => place[id] !== undefined).length
  const onCentre = graph.nodes.map((n) => n.id).filter((id) => place[id] !== undefined && Math.abs(place[id].x - 600) < 1e-9 && Math.abs(place[id].y - 400) < 1e-9).length
  if (!(placed === seedCount && Object.keys(place).length === graph.nodes.length && onCentre === 1)) { seedFixOk = false; seedFixDetail = 'seeds=' + seedCount }
}
check('t10 fix: every seed of a multi-seed star is placed and only the hub stays on the centre (2/3/5/50 seeds)', seedFixOk, seedFixDetail)

// t11: the overlap criterion on the target sizes and at the A5 ceiling.
let overlapOk = true
let overlapDetail = ''
const overlapLines = []
for (const [label, seed, count] of [['120', 11, 120], ['260', 13, 260], ['500', 41, 500], ['1000', 43, 1000]]) {
  const data = sample(seed, count, undefined, 3)
  const place = computeRadialLayout(data.nodes, data.links, 0, BOX)
  const report = overlapReport(place, data.nodes)
  overlapLines.push(label + ' nodes: worst margin ' + report.worst.toFixed(2) + ', overlapping pairs ' + report.overlapping)
  if (!(report.overlapping === 0 && report.worst >= 0 && Object.keys(place).length === data.nodes.length)) {
    overlapOk = false
    overlapDetail = label + ' nodes (worst margin ' + report.worst.toFixed(2) + ')'
  }
}
check('t11 fix: no node pair is closer than its two radii on 120/260/500/1000-node graphs', overlapOk, overlapDetail)
for (const line of overlapLines) console.log('       ' + line)

{
  const big = sample(13, 260, undefined, 3)
  const place = computeRadialLayout(big.nodes, big.links, 3, BOX)
  const extent = layoutExtent(place, 19 + 12)
  let covered = true
  for (const id in place) {
    const p = place[id]
    if (p.x < extent.x || p.x > extent.x + extent.w || p.y < extent.y || p.y > extent.y + extent.h) covered = false
  }
  check('t11 viewBox: a grown layout yields a bigger frame that still covers every node', covered && (extent.w > 1200 || extent.h > 800), JSON.stringify(extent))
}
check('layoutExtent keeps the exact 0 0 1200 800 frame for a small layout',
  JSON.stringify(layoutExtent({ A: { x: 600, y: 400 } }, 19)) === JSON.stringify({ x: 0, y: 0, w: 1200, h: 800 }))

const legacyData = sample(3, 60, undefined, 1)
check('radial layout defaults to the 1200x800 box when no box is passed',
  canonical(computeRadialLayout(legacyData.nodes, legacyData.links, 0)) === canonical(computeRadialLayout(legacyData.nodes, legacyData.links, 0, BOX)))

const sixKindData = sample(23, 80, ['references', 'citations', 'related', 'earlier', 'later', 'author'], 3)
const sixPlace = computeRadialLayout(sixKindData.nodes, sixKindData.links, 0, BOX)
const threePlace = computeRadialLayout(sixKindData.nodes, sample(23, 80, undefined, 3).links, 0, BOX)
check('radial layout handles the three new edge kinds without losing nodes versus legacy input',
  Object.keys(sixPlace).length === Object.keys(threePlace).length && Object.keys(sixPlace).length === sixKindData.nodes.length,
  'six=' + Object.keys(sixPlace).length + ' legacy=' + Object.keys(threePlace).length + ' nodes=' + sixKindData.nodes.length)


/* ------------------------------------------------------- 2. timeline + tree */

const tlNodes = [
  { id: 'A', year: 2000, citedBy: 10 },
  { id: 'B', year: 2010, citedBy: 500 },
  { id: 'C', year: 2010, citedBy: 20 },
  { id: 'D', year: 2020, citedBy: 100 },
  { id: 'E', year: 0, citedBy: 5 },
  { id: 'F', year: 0, citedBy: 900 },
]
const tl = computeTimelineLayout(tlNodes, [], BOX)
check('timeline places every node, including year=0 records', Object.keys(tl).length === tlNodes.length, JSON.stringify(Object.keys(tl)))

const byYear = tlNodes.slice().sort((a, b) => a.year - b.year)
let xMonotone = true
for (let i = 1; i < byYear.length; i++) if (tl[byYear[i].id].x < tl[byYear[i - 1].id].x - 1e-9) xMonotone = false
check('timeline x is non-decreasing for a year-ordered listing', xMonotone, JSON.stringify(byYear.map((n) => tl[n.id].x)))

check('timeline: older year is left of newer, same year shares one x',
  tl.A.x < tl.B.x && Math.abs(tl.B.x - tl.C.x) < 1e-9, JSON.stringify([tl.A.x, tl.B.x, tl.C.x]))

const byCited = tlNodes.slice().sort((a, b) => b.citedBy - a.citedBy)
let yMonotone = true
for (let i = 1; i < byCited.length; i++) if (tl[byCited[i].id].y < tl[byCited[i - 1].id].y - 1e-9) yMonotone = false
check('timeline y is non-increasing in citedBy (more citations = higher on screen)', yMonotone, JSON.stringify(byCited.map((n) => tl[n.id].y)))

check('timeline: the year-unknown band sits left of every dated node', Math.max(tl.E.x, tl.F.x) < Math.min(tl.A.x, tl.B.x, tl.D.x), JSON.stringify([tl.E.x, tl.F.x, tl.A.x]))

const bigSpan = []
for (let y = 1980; y <= 2020; y++) bigSpan.push({ id: 'W' + y, year: y, citedBy: (y - 1979) * 10 })
const ticks = timelineTicks(bigSpan, BOX)
check('timeline axis has min/max + intermediate year ticks and citation ticks',
  ticks.years.length >= 5 && ticks.citations.length >= 3, JSON.stringify(ticks.years.map((t) => t.year)))
check('axis tick x agrees with the layout x for that year',
  Math.abs(ticks.years[ticks.years.length - 1].x - computeTimelineLayout(bigSpan, [], BOX).W2020.x) < 1e-9)
check('year-unknown flag is reported to the axis', timelineTicks(tlNodes, BOX).hasUnknown === true)

const flat = [
  { id: 'seeds', name: 'Collection', parentId: null, itemCount: 2, system: true },
  { id: 'c1', name: 'Topic A', parentId: null, itemCount: 1 },
  { id: 'c2', name: 'Subtopic', parentId: 'c1', itemCount: 1 },
  { id: 'c3', name: 'Deep', parentId: 'c2', itemCount: 1 },
  { id: 'orphan', name: 'Orphan', parentId: 'missing', itemCount: 0 },
  { id: 'x', name: 'Cycle X', parentId: 'y', itemCount: 0 },
  { id: 'y', name: 'Cycle Y', parentId: 'x', itemCount: 0 },
]
const forest = treeFns.buildCollectionTree(flat)
const rows = treeFns.flattenCollectionTree(forest)
const depthOf = (id) => (rows.find((r) => r.id === id) || {}).depth
check('collection forest supports >=3 nesting levels', depthOf('c1') === 0 && depthOf('c2') === 1 && depthOf('c3') === 2, JSON.stringify(rows))
check('collection forest keeps the system collection as a root', rows.some((r) => r.id === 'seeds' && r.depth === 0 && r.system === true))
check('collection forest promotes missing parents and loses nothing', depthOf('orphan') === 0 && rows.length === flat.length, JSON.stringify(rows.map((r) => r.id)))
check('collection forest breaks parent/child cycles deterministically',
  (depthOf('x') === 0 && depthOf('y') === 1) || (depthOf('y') === 0 && depthOf('x') === 1))

/* ------------------------------------------------------------ mini runtime */

function makeRuntime() {
  const stores = new Map()
  let pending = []
  let cursor = 0
  let key = 'root'
  let dirty = false
  const React = {
    createElement(type, props) {
      const children = []
      for (let i = 2; i < arguments.length; i++) {
        const kid = arguments[i]
        if (Array.isArray(kid)) children.push(...kid)
        else if (kid !== null && kid !== undefined && kid !== false) children.push(kid)
      }
      return { el: true, type, props: props || {}, children }
    },
    useState(init) {
      const store = stores.get(key) || []
      const i = cursor++
      if (!(i in store)) store[i] = typeof init === 'function' ? init() : init
      stores.set(key, store)
      return [store[i], (value) => { store[i] = typeof value === 'function' ? value(store[i]) : value; dirty = true }]
    },
    useEffect(fn, deps) {
      const store = stores.get(key) || []
      const i = cursor++
      const prev = store[i]
      const changed = !prev || !deps || !prev.deps || deps.length !== prev.deps.length || deps.some((d, j) => !Object.is(d, prev.deps[j]))
      if (changed) { store[i] = { deps, fn }; pending.push(fn) }
      stores.set(key, store)
    },
    useMemo(fn, deps) {
      const store = stores.get(key) || []
      const i = cursor++
      const prev = store[i]
      if (!prev || !deps || !prev.deps || deps.length !== prev.deps.length || deps.some((d, j) => !Object.is(d, prev.deps[j]))) {
        store[i] = { deps, value: fn() }
      }
      stores.set(key, store)
      return store[i].value
    },
    useRef(init) {
      const store = stores.get(key) || []
      const i = cursor++
      if (!(i in store)) store[i] = { current: init === undefined ? null : init }
      stores.set(key, store)
      return store[i]
    },
  }
  function walk(el, path) {
    if (el === null || el === undefined || el === false || typeof el !== 'object' || !el.el) return el
    if (typeof el.type === 'function') {
      const prevKey = key
      const prevCursor = cursor
      key = path
      cursor = 0
      const out = el.type(Object.assign({}, el.props, { children: el.children }))
      key = prevKey
      cursor = prevCursor
      return walk(out, path)
    }
    return { type: el.type, props: el.props, children: el.children.map((child, i) => walk(child, path + '/' + i)) }
  }
  return {
    React,
    walk,
    takeEffects() { const out = pending; pending = []; return out },
    dirty: () => dirty,
    clean() { dirty = false },
  }
}

/* ---------------------------------------------------------- mock host + boot */

const WORK = {
  W1: { id: 'W1', title: 'Seed paper', year: 2000, citedBy: 100, venue: 'Nature', doi: null },
  W2: { id: 'W2', title: 'Citing paper', year: 2015, citedBy: 300, venue: 'Science', doi: null },
  W3: { id: 'W3', title: 'Referenced paper', year: 1990, citedBy: 50, venue: 'Cell', doi: null },
  W4: { id: 'W4', title: 'Isolated paper', year: 2020, citedBy: 0, venue: null, doi: null },
}
const GRAPH = {
  seeds: ['W1'],
  nodes: [
    Object.assign({ seed: true, kind: 'seed' }, WORK.W1),
    Object.assign({ seed: false, kind: 'citations' }, WORK.W2),
    Object.assign({ seed: false, kind: 'references' }, WORK.W3),
    Object.assign({ seed: false, kind: 'lonely' }, WORK.W4),
  ],
  links: [
    { source: 'W1', target: 'W2', kind: 'citations' },
    { source: 'W1', target: 'W3', kind: 'references' },
  ],
}
const SIX_GRAPH = {
  seeds: ['W1'],
  nodes: [1, 2, 3, 4, 5, 6, 7].map((n) => Object.assign({ id: 'W' + n, title: 'Paper ' + n, year: 1990 + n * 3, citedBy: n * 40, seed: n === 1 }, {})),
  links: [
    { source: 'W1', target: 'W2', kind: 'references' },
    { source: 'W1', target: 'W3', kind: 'citations' },
    { source: 'W1', target: 'W4', kind: 'related' },
    { source: 'W1', target: 'W5', kind: 'earlier' },
    { source: 'W1', target: 'W6', kind: 'later' },
    { source: 'W1', target: 'W7', kind: 'author' },
  ],
}
const LIBRARY = {
  collections: [
    { id: 'seeds', name: 'Collection', parentId: null, itemCount: 1, itemCountDeep: 1, system: true, ids: ['W1'] },
    { id: 'c1', name: 'Topic A', parentId: null, itemCount: 1, itemCountDeep: 3, ids: ['W2'] },
    { id: 'c2', name: 'Subtopic', parentId: 'c1', itemCount: 1, itemCountDeep: 2, ids: ['W3'] },
    { id: 'c3', name: 'Deep subtopic', parentId: 'c2', itemCount: 1, itemCountDeep: 1, ids: ['W4'] },
    { id: 'c4', name: 'Counts only', parentId: null, itemCount: 2, itemCountDeep: 2 },
  ],
  recentlyFound: ['W3', 'W2'],
  annotations: { W3: { note: 'read me', tags: ['x'], color: 'red', updatedAt: '2026-01-01' } },
  storePath: '/tmp/research-cat/library.json',
  storeError: '',
  records: WORK,
}

async function boot(options) {
  options = options || {}
  const CALLS = []
  const library = Object.assign({}, LIBRARY, options.libraryPatch || {})
  const graph = options.graph || GRAPH

  function respond(value) {
    return Promise.resolve({ status: 200, json: () => Promise.resolve({ ok: true, value }) })
  }
  function fetchMock(url, init) {
    const op = String(url).split('/').pop()
    const body = JSON.parse((init && init.body) || '{}')
    CALLS.push({ op, body })
    if (op === 'state') return respond({ graph: graph, counts: { papers: graph.nodes.length, links: graph.links.length, seeds: graph.seeds.length }, library: library })
    if (op === 'collections') {
      if (body.op === 'list') return respond({ collections: library.collections })
      if (body.op === 'create') return respond({ collection: { id: 'c9', name: body.name, parentId: body.parentId, itemCount: 0, ids: [] } })
      return respond({ collection: { id: body.collectionId || body.id, ids: body.ids || [] } })
    }
    if (op === 'recentlyFound') return respond({ recentlyFound: library.recentlyFound })
    if (op === 'details') {
      return respond({ paper: Object.assign({ authors: ['A One', 'B Two'], authorIds: ['A1', 'A2'], abstract: 'Abstract text', referenceCount: 2, relatedCount: 3 }, WORK[body.id] || { id: body.id, title: body.id, year: 0, citedBy: 0 }) })
    }
    if (op === 'authors') {
      if (options.failAuthors === true) return Promise.reject(new Error('HTTP 404: no /authors route'))
      return respond({ authors: [{ id: 'A1', name: 'A One' }, { id: 'A2', name: 'B Two' }] })
    }
    if (op === 'search') return respond({ term: body.query, results: [WORK.W2, WORK.W3], graph: graph, filters: body.filters, page: 1, total: 2, hasMore: false, considered: 5 })
    if (op === 'expand') return respond({ kind: body.kind, found: 2, added: 1, considered: 2, truncated: false, graph: graph, counts: {} })
    if (op === 'expandAll') return respond({ added: 2, skipped: 0, perSeed: [{ id: 'W1', kind: 'references', found: 1, added: 1 }], graph: graph, counts: {} })
    if (op === 'clear') return respond({ graph: { seeds: [], nodes: [], links: [] }, counts: {}, library: library })
    if (op === 'addSeed' || op === 'removeSeed') return respond({ graph: graph, counts: {} })
    if (op === 'annotate') return respond({ annotation: Object.assign({ id: body.id, note: '', tags: [], color: null, updatedAt: '2026-02-02' }, body) })
    if (op === 'export') return respond({ format: 'bibtex', count: 1, bibtex: '@article{a2000seed,\n  title={Seed paper},\n  year={2000}\n}\n' })
    return Promise.reject(new Error('unmocked route ' + op))
  }

  const registrations = []
  const sandbox = {
    window: { __ModuleLoader__: { load: (r) => registrations.push(r) } },
    fetch: fetchMock,
    console,
    document: {
      createElement: () => ({ setAttribute() {}, remove() {}, textContent: '' }),
      head: { appendChild() {} },
      body: { appendChild() {}, removeChild() {} },
    },
  }
  runInNewContext(src, sandbox, { filename: 'src/client.js' })

  const registration = registrations[0]
  if (registrations.length !== 1 || registration === undefined || typeof registration.factory !== 'function') {
    return { fatal: 'expected exactly one window.__ModuleLoader__.load registration, got ' + registrations.length }
  }
  const requested = new Set()
  const rt = makeRuntime()
  const clientExports = registration.factory((specifier) => {
    requested.add(specifier)
    if (specifier === 'react') return rt.React
    throw new Error('unexpected require: ' + specifier)
  })

  const slotCalls = []
  const fakeCtx = {
    effect: (fn) => { fn() },
    slots: {
      inject: (name, body) => { slotCalls.push({ name, registration: body() }) },
      register: (opts, component) => ({ options: opts, component }),
    },
  }
  await clientExports.apply(fakeCtx)
  if (slotCalls.length !== 2 || !slotCalls[1] || !slotCalls[1].registration || typeof slotCalls[1].registration.component !== 'function') {
    return { fatal: 'expected sidebar.panellist + main registrations, got ' + slotCalls.length }
  }
  const Panel = slotCalls[1].registration.component

  async function flush() { for (let i = 0; i < 4; i++) await new Promise((r) => setImmediate(r)) }
  let tree = null
  async function render() {
    for (let pass = 0; pass < 14; pass++) {
      rt.clean()
      tree = rt.walk(rt.React.createElement(Panel, {}), 'root')
      const effects = rt.takeEffects()
      for (const fn of effects) fn()
      await flush()
      if (effects.length === 0 && !rt.dirty()) break
    }
    return tree
  }
  function all(node, out) {
    out = out || []
    if (node === null || node === undefined || typeof node !== 'object') return out
    out.push(node)
    const kids = Array.isArray(node.children) ? node.children : []
    for (const kid of kids) all(kid, out)
    return out
  }
  function textOf(node) {
    if (typeof node === 'string') return node
    if (node === null || node === undefined || typeof node !== 'object') return ''
    return (Array.isArray(node.children) ? node.children : []).map(textOf).join('')
  }
  const api = {
    CALLS,
    registration,
    requested,
    clientExports,
    slotCalls,
    render,
    nodes: () => all(tree),
    byMarker: (marker) => all(tree).filter((n) => n.props && n.props['data-rr'] === marker),
    byClass: (name) => all(tree).filter((n) => typeof n.props.className === 'string' && n.props.className.split(' ').indexOf(name) !== -1),
    byText: (label) => all(tree).filter((n) => n.props && typeof n.props.onClick === 'function' && textOf(n) === label),
    textOf,
    byTitle: (title) => all(tree).filter((n) => n.props && n.props.title === title),
    nodeEntries() {
      const out = []
      for (const g of all(tree)) {
        if (g.type !== 'g' || typeof g.props.onMouseDown !== 'function') continue
        const circle = (g.children || []).find((c) => c.type === 'circle' && String(c.props.className || '').includes('rr-node'))
        if (!circle) continue
        const label = (g.children || []).find((c) => c.type === 'text')
        out.push({ g, circle, label: label ? textOf(label) : '', stroke: circle.props.style.stroke, r: circle.props.r, cx: circle.props.cx, cy: circle.props.cy, opacity: circle.props.style.opacity })
      }
      return out
    },
    nodeByLabel(label) { return api.nodeEntries().find((e) => e.label === label) },
    click(marker) {
      const el = api.byMarker(marker)[0]
      if (!el) throw new Error('no element with data-rr=' + marker)
      el.props.onClick({ stopPropagation() {}, preventDefault() {} })
    },
    async repaint() {
      await flush()
      rt.clean()
      tree = rt.walk(rt.React.createElement(Panel, {}), 'root')
      const fx = rt.takeEffects()
      for (const fn of fx) fn()
      await flush()
      rt.clean()
      tree = rt.walk(rt.React.createElement(Panel, {}), 'root')
    },
  }
  return api
}

/* ------------------------------------------------------------ scenario A: UI */

console.log('--- Loader + slot contract ---')
const A = await boot({})
if (A.fatal !== undefined) {
  check('client registers exactly one Loader module', false, A.fatal)
  console.log('\nclient-check: cannot continue \u2014 ' + A.fatal)
  process.exit(1)
}
await A.render()

check('client registers exactly one Loader module', A.registration !== undefined && A.registration.id === 'dsh-research-cat', String(A.registration && A.registration.id))
check('client only requires react from the shell', [...A.requested].join(',') === 'react', [...A.requested].join(','))
check('client exports name/inject/apply', A.clientExports.name === 'dsh-research-cat' && A.clientExports.inject.includes('slots') && typeof A.clientExports.apply === 'function')
check('sidebar.panellist + main are registered', A.slotCalls.length === 2 && A.slotCalls[0].name === 'sidebar.panellist' && A.slotCalls[1].name === 'main', JSON.stringify(A.slotCalls.map((s) => s.name)))
check('slot id/key are research-cat', A.slotCalls[0].registration.options.id === 'research-cat' && A.slotCalls[1].registration.options.key === 'research-cat')

console.log('--- rendered panel: new surfaces ---')
check('renders without throwing', A.nodes().length > 30, String(A.nodes().length))
check('Graph + Library tabs exist', A.byMarker('tab-graph').length === 1 && A.byMarker('tab-library').length === 1)
check('six relationship kinds are independently switchable', ['references', 'citations', 'related', 'earlier', 'later', 'author'].every((k) => A.byMarker('kind-' + k).length === 1))
check('Radial is the default layout and Timeline is available', A.byMarker('layout-radial').length === 1 && A.byMarker('layout-timeline').length === 1 && A.byMarker('layout-radial')[0].props.className.includes('rr-toggle-on'))
check('legend lists the seed plus all six edge kinds', A.byClass('rr-legend-row').length === 7, String(A.byClass('rr-legend-row').length))
check('edge stylesheet gives each kind its own rule', ['references', 'citations', 'related', 'earlier', 'later', 'author'].every((k) => src.includes('.rr-edge-' + k + '{')))

A.click('filters-toggle')
await A.repaint()
check('filter panel exposes year range + venue + OA + retracted + min citations + sort',
  A.byMarker('filter-bar').length === 1 &&
  A.nodes().filter((n) => n.type === 'input' && n.props.type === 'number').length === 3 &&
  A.nodes().filter((n) => n.type === 'select').length >= 3)

A.click('layout-timeline')
await A.repaint()
check('timeline view renders its axis and keeps every node', A.byMarker('timeline-axis').length === 1 && A.nodeEntries().length === 4, String(A.nodeEntries().length))
check('timeline: same-year nodes share x, older is left of newer', (() => {
  const a = A.nodeByLabel('Referenced paper')
  const b = A.nodeByLabel('Seed paper')
  const c = A.nodeByLabel('Citing paper')
  return a !== undefined && b !== undefined && c !== undefined && a.cx < b.cx && b.cx < c.cx
})(), JSON.stringify(A.nodeEntries().map((e) => e.label + ':' + e.cx.toFixed(1))))
A.click('layout-radial')
await A.repaint()
check('switching back to Radial keeps the panel alive', A.byMarker('timeline-axis').length === 0 && A.nodeEntries().length === 4)

console.log('--- rendered panel: legacy interactions ---')
check('existing controls still present: Clear / Auto-expand / Re-layout / Fit', ['Clear', 'Auto-expand', 'Re-layout', 'Fit'].every((t) => A.byText(t).length === 1))
check('one node circle per paper', A.nodeEntries().length === 4, String(A.nodeEntries().length))
check('citation scaling keeps radii ordered (300 > 100 > 50 > 0 citations)',
  A.nodeByLabel('Citing paper').r > A.nodeByLabel('Seed paper').r &&
  A.nodeByLabel('Seed paper').r > A.nodeByLabel('Referenced paper').r &&
  A.nodeByLabel('Referenced paper').r > A.nodeByLabel('Isolated paper').r,
  JSON.stringify(A.nodeEntries().map((e) => e.label + ':' + e.r.toFixed(2))))
check('role colouring: seed transparent, citations warn token, isolated border token', (() => {
  return A.nodeByLabel('Seed paper').stroke === 'transparent' &&
    String(A.nodeByLabel('Citing paper').stroke).includes('state-warn-primary') &&
    String(A.nodeByLabel('Isolated paper').stroke).includes('border-l2')
})(), JSON.stringify(A.nodeEntries().map((e) => e.label + ':' + e.stroke)))
check('annotation colour is painted on the node ring', A.nodeByLabel('Referenced paper').stroke === '#e5484d', String(A.nodeByLabel('Referenced paper').stroke))
check('label policy: seeds and top-cited nodes are labelled', A.nodes().filter((n) => n.type === 'text' && n.props.className === 'rr-label').length >= 1)
check('radial view draws both mock edges with their kinds', (() => {
  const kinds = A.byClass('rr-edge').map((n) => n.props.className)
  return kinds.length === 2 && kinds.some((c) => c.includes('citations')) && kinds.some((c) => c.includes('references'))
})(), JSON.stringify(A.byClass('rr-edge').map((n) => n.props.className)))

A.click('kind-references')
await A.repaint()
check('switching a kind off stops drawing that edge', A.byClass('rr-edge-references').length === 0 && A.byClass('rr-edge-citations').length === 1)
A.click('kind-references')
await A.repaint()
check('switching it back restores the edge', A.byClass('rr-edge-references').length === 1)

// selection: the seed keeps its transparent ring by baseline design, so pick a neighbour
A.nodeByLabel('Citing paper').g.props.onMouseDown({ stopPropagation() {}, preventDefault() {}, clientX: 10, clientY: 10 })
await A.repaint()
check('selecting a node opens details with abstract, note editor and 7 colour dots',
  A.byMarker('note-editor').length === 1 && A.byClass('rr-color-dot').length === 7 && A.nodes().some((n) => n.type === 'p' && String(n.props.className).includes('rr-abstract')))
check('detail offers the five exploration entries', ['References', 'Cited by', 'Similar', 'Earlier', 'Later'].every((t) => A.byText(t).length >= 1))
check('/authors list is rendered as clickable author-axis entries', A.byClass('rr-author').length === 2, String(A.byClass('rr-author').length))
check('selection highlight: selected node stroke is the label-primary token', A.nodeEntries().some((e) => String(e.stroke).includes('label-primary')), JSON.stringify(A.nodeEntries().map((e) => e.stroke)))
check('selection fades the node that is neither selected nor adjacent', (() => {
  const isolated = A.nodeByLabel('Isolated paper')
  return isolated !== undefined && isolated.opacity === 0.15 && A.nodeByLabel('Seed paper').opacity !== 0.15
})(), JSON.stringify(A.nodeEntries().map((e) => e.label + ':' + e.opacity)))

A.byClass('rr-author')[0].props.onClick({ stopPropagation() {}, preventDefault() {} })
await A.repaint()
const authorCall = A.CALLS.filter((c) => c.op === 'expand').pop()
check('clicking an author calls /expand {kind:"author", authorId}', authorCall && authorCall.body.kind === 'author' && authorCall.body.authorId === 'A1', JSON.stringify(authorCall && authorCall.body))
A.byText('Earlier')[0].props.onClick()
await A.repaint()
check('Earlier calls /expand {kind:"earlier"}', (A.CALLS.filter((c) => c.op === 'expand').pop() || {}).body.kind === 'earlier')

console.log('--- rendered panel: zoom / drag / toolbar ---')
const beforeSpin = A.nodeEntries().map((e) => e.cx.toFixed(3)).join(',')
A.byText('Re-layout')[0].props.onClick()
await A.repaint()
const afterSpin = A.nodeEntries().map((e) => e.cx.toFixed(3)).join(',')
check('Re-layout recomputes positions without dropping nodes', A.nodeEntries().length === 4 && afterSpin !== beforeSpin, beforeSpin + ' vs ' + afterSpin)

const svg = A.nodes().find((n) => n.type === 'svg')
const transformOf = () => A.nodes().find((n) => n.type === 'g' && typeof n.props.transform === 'string').props.transform
const beforePan = transformOf()
svg.props.onMouseDown({ clientX: 100, clientY: 100 })
svg.props.onMouseMove({ clientX: 160, clientY: 130 })
await A.repaint()
check('pan (drag) still moves the canvas transform', transformOf() !== beforePan)
A.byText('Fit')[0].props.onClick()
await A.repaint()
check('Fit resets the transform', transformOf() === 'translate(0,0) scale(1)')
const beforeZoom = transformOf()
A.byText('+')[0].props.onClick()
await A.repaint()
check('zoom + still scales the canvas', transformOf() !== beforeZoom)

const dragTarget = A.nodeEntries()[0]
const dragCx = dragTarget.cx
dragTarget.g.props.onMouseDown({ stopPropagation() {}, preventDefault() {}, clientX: 0, clientY: 0 })
dragTarget.g.props.onMouseDown({ stopPropagation() {}, preventDefault() {}, clientX: 0, clientY: 0 })
svg.props.onMouseMove({ clientX: 90, clientY: 40 })
await A.repaint()
check('node dragging still moves the node', A.nodeEntries().some((e) => Math.abs(e.cx - dragCx) > 1), JSON.stringify([dragCx, A.nodeEntries().map((e) => e.cx)]))

console.log('--- rendered panel: library surfaces ---')
A.click('tab-library')
await A.repaint()
check('Library tab shows Recently Found rows from library records',
  A.byMarker('recently-found').length === 1 && A.byMarker('recent-row').length === 2 && A.textOf(A.byMarker('recently-found')[0]).includes('Referenced paper'))
check('collection tree renders all 5 collections including three nested levels', A.byMarker('library-tree').length === 1 && A.byMarker('tree-row').length === 5, String(A.byMarker('tree-row').length))
const treeText = A.textOf(A.byMarker('library-tree')[0])
check('collection tree shows names and direct/deep counts', treeText.includes('Topic A') && treeText.includes('Subtopic') && treeText.includes('Deep subtopic') && treeText.includes('1/3'))
check('nesting is visible as increasing indentation', (() => {
  const rowsByText = A.byMarker('tree-row')
  const pad = (t) => { const r = rowsByText.find((x) => A.textOf(x).includes(t)); return r === undefined ? NaN : parseInt(r.props.style.paddingLeft, 10) }
  return pad('Topic A') < pad('Subtopic') && pad('Subtopic') < pad('Deep subtopic')
})())
check('the system collection offers no delete/rename buttons while user rows do', (() => {
  const row = A.byMarker('tree-row').find((r) => A.textOf(r).includes('Collection'))
  if (row === undefined) return false
  const subtree = []
  const walk = (n) => { subtree.push(n); (Array.isArray(n.children) ? n.children : []).forEach(walk) }
  walk(row)
  const titleOf = (n) => (n !== null && typeof n === 'object' && n.props ? n.props.title : undefined)
  const hasDelete = subtree.some((n) => typeof titleOf(n) === 'string' && titleOf(n).indexOf('Delete') === 0)
  const hasRename = subtree.some((n) => titleOf(n) === 'Rename')
  const userDeleteButtons = A.nodes().filter((n) => n.props.title === 'Delete collection').length
  return hasDelete === false && hasRename === false && userDeleteButtons === 4
})())
check('export entries exist for the active collection and for everything', A.byText('Export everything (.bib)').length === 1 && A.nodes().some((n) => typeof n.props.onClick === 'function' && A.textOf(n).indexOf('Export ') === 0))
check('the library file path is shown', A.nodes().some((n) => A.textOf(n).includes('Library file: /tmp/research-cat/library.json')))
check('no storage warning when storeError is empty', A.byMarker('store-warning').length === 0)

A.byText('Export everything (.bib)')[0].props.onClick()
await A.repaint()
check('/export is called with format=bibtex', (A.CALLS.filter((c) => c.op === 'export').pop() || {}).body.format === 'bibtex')

A.nodes().filter((n) => n.type === 'input' && n.props.type === 'checkbox')[0].props.onChange()
await A.repaint()
const saveSelected = A.nodes().find((n) => typeof n.props.onClick === 'function' && A.textOf(n).indexOf('Save selected') === 0)
check('Recently Found offers promote into a collection', saveSelected !== undefined)
saveSelected.props.onClick()
await A.repaint()
const promote = A.CALLS.filter((c) => c.op === 'recentlyFound' && c.body.op === 'promote').pop()
check('promote sends the ticked id and target collection', promote && promote.body.ids.length === 1 && typeof promote.body.collectionId === 'string', JSON.stringify(promote && promote.body))

const addSub = A.nodes().find((n) => n.props.title === 'New subcollection')
check('every non-system row offers a new subcollection', addSub !== undefined)
addSub.props.onClick({ stopPropagation() {} })
await A.repaint()
A.nodes().find((n) => n.type === 'input' && String(n.props.placeholder).indexOf('Subcollection name') === 0).props.onChange({ target: { value: 'Nested' } })
await A.repaint()
A.nodes().find((n) => n.type === 'input' && String(n.props.placeholder).indexOf('Subcollection name') === 0).props.onKeyDown({ key: 'Enter' })
await A.repaint()
const createCall = A.CALLS.filter((c) => c.op === 'collections' && c.body.op === 'create').pop()
check('creating a subcollection sends {op:"create", name, parentId}', createCall && createCall.body.name === 'Nested' && typeof createCall.body.parentId === 'string' && createCall.body.parentId.length > 0, JSON.stringify(createCall && createCall.body))

A.nodes().find((n) => n.props.title === 'Rename').props.onClick({ stopPropagation() {} })
await A.repaint()
A.nodes().find((n) => n.type === 'input' && String(n.props.className) === 'rr-inline-input' && !String(n.props.placeholder || '').length).props.onChange({ target: { value: 'Renamed' } })
await A.repaint()
A.nodes().find((n) => n.type === 'input' && String(n.props.className) === 'rr-inline-input' && !String(n.props.placeholder || '').length).props.onKeyDown({ key: 'Enter' })
await A.repaint()
const renameCall = A.CALLS.filter((c) => c.op === 'collections' && c.body.op === 'rename').pop()
check('renaming sends {op:"rename", id, name}', renameCall && renameCall.body.name === 'Renamed' && typeof renameCall.body.id === 'string', JSON.stringify(renameCall && renameCall.body))

A.nodes().filter((n) => n.props.title === 'Delete collection')[0].props.onClick({ stopPropagation() {} })
await A.repaint()
check('delete asks for a second click first', A.CALLS.filter((c) => c.op === 'collections' && c.body.op === 'delete').length === 0)
A.nodes().filter((n) => typeof n.props.title === 'string' && n.props.title.indexOf('Press again to delete') === 0)[0].props.onClick({ stopPropagation() {} })
await A.repaint()
check('the second click deletes the collection', A.CALLS.filter((c) => c.op === 'collections' && c.body.op === 'delete').length === 1)

// collection with ids: activating lists its members
const subtopicRow = A.byMarker('tree-row').find((r) => A.textOf(r).includes('Subtopic'))
subtopicRow.props.onClick()
await A.repaint()
check('activating a subcollection lists its members from collection.ids',
  A.byMarker('library-item').length === 1 && A.textOf(A.byMarker('library-item')[0]).includes('Referenced paper'), String(A.byMarker('library-item').length))
// collection without ids: graceful degradation to counts only
A.click('tab-library')
await A.repaint()
A.byMarker('tree-row').find((r) => A.textOf(r).includes('Counts only')).props.onClick()
await A.repaint()
check('a collection without member ids degrades to counts + hint instead of breaking',
  A.byMarker('library-item').length === 0 && A.nodes().some((n) => A.textOf(n).includes('only counts')))

console.log('--- rendered panel: notes, search, filters, clear ---')
A.click('tab-graph')
await A.repaint()
A.nodeByLabel('Citing paper').g.props.onMouseDown({ stopPropagation() {}, preventDefault() {}, clientX: 0, clientY: 0 })
await A.repaint()
const noteArea = A.nodes().find((n) => n.type === 'textarea' && String(n.props.className).includes('rr-note-input'))
check('note editor renders for the selected paper', noteArea !== undefined)
noteArea.props.onChange({ target: { value: 'my note' } })
await A.repaint()
A.nodes().find((n) => n.type === 'textarea' && String(n.props.className).includes('rr-note-input')).props.onBlur()
await A.repaint()
const annotateNote = A.CALLS.filter((c) => c.op === 'annotate').pop()
check('blurring the note calls /annotate with a partial update', annotateNote && annotateNote.body.id === 'W2' && annotateNote.body.note === 'my note' && annotateNote.body.tags === undefined, JSON.stringify(annotateNote && annotateNote.body))
A.byClass('rr-color-dot')[3].props.onClick()
await A.repaint()
const annotateColor = A.CALLS.filter((c) => c.op === 'annotate').pop()
check('a colour dot sends the frozen colour id', annotateColor && annotateColor.body.color === 'green' && annotateColor.body.note === undefined, JSON.stringify(annotateColor && annotateColor.body))

const searchInput = A.nodes().find((n) => n.type === 'input' && typeof n.props.placeholder === 'string' && n.props.placeholder.indexOf('Title, author') === 0)
searchInput.props.onChange({ target: { value: 'graph neural networks' } })
await A.repaint()
A.byText('Search')[0].props.onClick()
await A.repaint()
check('search sends the query and reports considered/total', (A.CALLS.filter((c) => c.op === 'search').pop() || {}).body.query === 'graph neural networks' && A.nodes().some((n) => A.textOf(n).includes('before filters')))
A.nodes().find((n) => n.type === 'input' && n.props.type === 'number' && n.props.placeholder === 'from').props.onChange({ target: { value: '2000' } })
await A.repaint()
A.byText('Apply & search')[0].props.onClick()
await A.repaint()
const filtered = A.CALLS.filter((c) => c.op === 'search').pop()
check('filters are sent to /search as the frozen key set', filtered && filtered.body.filters && filtered.body.filters.yearFrom === 2000, JSON.stringify(filtered && filtered.body.filters))
check('result rows offer Add and a save-to-collection picker', A.byMarker('result-row').length === 2 && A.byMarker('result-save').length === 2)
A.byMarker('result-save')[0].props.onChange({ target: { value: 'c1' } })
await A.repaint()
const saveCall = A.CALLS.filter((c) => c.op === 'collections' && c.body.op === 'save').pop()
check('picking a collection calls /collections {op:"save", ids:[...]}', saveCall && saveCall.body.collectionId === 'c1' && saveCall.body.ids.length === 1, JSON.stringify(saveCall && saveCall.body))

A.byText('Auto-expand')[0].props.onClick()
await A.repaint()
check('Auto-expand leaves kinds to the host defaults (no kinds key) and carries the active filters', (() => {
  const body = (A.CALLS.filter((c) => c.op === 'expandAll').pop() || {}).body
  return body !== undefined && body.kinds === undefined && body.filters !== undefined && body.filters.yearFrom === 2000
})(), JSON.stringify((A.CALLS.filter((c) => c.op === 'expandAll').pop() || {}).body))
A.byText('Clear')[0].props.onClick()
await A.repaint()
check('Clear calls /clear with an empty body (9a1bd7d semantics)', JSON.stringify((A.CALLS.filter((c) => c.op === 'clear').pop() || {}).body) === '{}')
check('after Clear the canvas is empty and the empty state returns', A.byClass('rr-node').length === 0 && A.nodes().some((n) => A.textOf(n) === 'Build a citation graph'))

/* ------------------------------ scenario B: six kinds, store warning, /authors fallback */

console.log('--- scenario B: six edge kinds + storage warning + /authors fallback ---')
const B = await boot({
  graph: SIX_GRAPH,
  libraryPatch: { storeError: 'library.json is not valid JSON (kept as library.bak-2026)' },
  failAuthors: true,
})
if (B.fatal !== undefined) {
  check('scenario B boots the panel', false, B.fatal)
  console.log('\nclient-check: cannot continue \u2014 ' + B.fatal)
  process.exit(1)
}
await B.render()
check('all six edge kinds render with distinct classes', (() => {
  const set = new Set(B.byClass('rr-edge').map((n) => n.props.className))
  return set.size === 6
})(), JSON.stringify([...new Set(B.byClass('rr-edge').map((n) => n.props.className))]))
B.click('kind-earlier')
await B.repaint()
check('switching the Earlier kind off removes exactly that edge', B.byClass('rr-edge-earlier').length === 0 && B.byClass('rr-edge-later').length === 1)
check('storeError is surfaced as a warning bar', B.byMarker('store-warning').length === 1 && B.textOf(B.byMarker('store-warning')[0]).includes('library.bak-2026'))
B.nodeEntries()[1].g.props.onMouseDown({ stopPropagation() {}, preventDefault() {}, clientX: 0, clientY: 0 })
await B.repaint()
check('/authors being unavailable falls back to the record authorIds', B.byClass('rr-author').length === 2 && B.textOf(B.byClass('rr-author')[0]).indexOf('A One') === 0, JSON.stringify(B.byClass('rr-author').map((n) => B.textOf(n))))


/* --------------- scenario C: a 120-node graph, rendered end to end (t11) */

console.log('--- scenario C: 120-node graph, viewBox follows the layout ---')
function bigGraph(count) {
  const generated = sample(11, count, undefined, 3)
  const nodes = generated.nodes.map(function (n) {
    return { id: n.id, title: 'Paper ' + n.id, year: n.year, citedBy: n.citedBy, seed: n.seed === true }
  })
  return { seeds: generated.nodes.filter(function (n) { return n.seed === true }).map(function (n) { return n.id }), nodes: nodes, links: generated.links }
}
const C = await boot({ graph: bigGraph(120) })
if (C.fatal !== undefined) {
  check('scenario C boots the panel', false, C.fatal)
  console.log('\nclient-check: cannot continue \u2014 ' + C.fatal)
  process.exit(1)
}
await C.render()
check('scenario C renders all 120 nodes', C.nodeEntries().length === 120, String(C.nodeEntries().length))
{
  const svg = C.nodes().find(function (n) { return n.type === 'svg' })
  const parts = String(svg.props.viewBox).split(' ').map(Number)
  const frame = { x: parts[0], y: parts[1], w: parts[2], h: parts[3] }
  let covered = true
  for (const entry of C.nodeEntries()) {
    if (entry.cx < frame.x || entry.cx > frame.x + frame.w || entry.cy < frame.y || entry.cy > frame.y + frame.h) covered = false
  }
  check('scenario C: viewBox grew past the baseline 1200x800 and still covers every node',
    covered && (frame.w > 1200 || frame.h > 800), JSON.stringify(frame))
}
{
  const entries = C.nodeEntries()
  let worst = Infinity
  let overlapping = 0
  for (let i = 0; i < entries.length; i++) {
    for (let j = i + 1; j < entries.length; j++) {
      const margin = Math.hypot(entries[i].cx - entries[j].cx, entries[i].cy - entries[j].cy) - (entries[i].r + entries[j].r)
      if (margin < 0) overlapping++
      if (margin < worst) worst = margin
    }
  }
  check('scenario C: rendered circles do not overlap (distance >= r1 + r2)', overlapping === 0 && worst >= 0,
    'overlapping pairs ' + overlapping + ', worst margin ' + worst.toFixed(2))
}

console.log(failures === 0 ? '\nclient-check: all checks passed' : '\nclient-check: ' + failures + ' check(s) FAILED')
process.exit(failures === 0 ? 0 : 1)
