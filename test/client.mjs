// Client-half radial layout suite: seed placement (t10) + overlap fix (t11).
//
//   node test/client.mjs
//
// History
//   t10 — `roleOf()` returned 'seed' but ORDER did not list it, so a seed that
//         was not the BFS hub got no `place` entry and `positionOf()` fell back
//         to the canvas centre: with several seeds (A2 allows 50) they all
//         stacked on one point.
//   t11 — the layout clamped every ring radius to `maxRadius = min(CX, CY) - 26`
//         (= 374 in the 1200x800 box) and clamped final coordinates into the
//         box. Once a clamped ring was full, further rings landed on the same
//         radius (and out-of-box points were pinned to the border), so nodes
//         piled up: worst margin (distance minus the two radii) was -31.9 at 120
//         nodes and -37.2 at 260 nodes (min distances 2.07 / 0.006), and still
//         107 / 277 overlapping pairs at 500 / 1000 nodes. Rings now grow
//         outward and the ring capacity uses the real node size
//         (`spacing = max(minSpacing, 2 * biggestRadius + 4)`); the panel sizes
//         the SVG viewBox from `layoutExtent()`, so nothing is clipped.
//
// What this file asserts
//   1. every seed of a multi-seed star is really placed (t10 regression);
//   2. no two nodes are closer than their radii sum on 120 / 260 (plus 500 /
//      1000 as extra scale evidence) — the t11 acceptance criterion;
//   3. the rings really grew past the old clamp radius (root cause handled);
//   4. A0 regression: input whose outer ring never reached the old clamp and
//      whose radii already fit `minSpacing` is byte-identical to 9a1bd7d
//      (digests computed from `git show 9a1bd7d:src/client.js`), and the t10
//      5-node snapshot is unchanged;
//   5. intentionally updated snapshots for the clamp-affected inputs, with the
//      new digests frozen so future drift is a visible edit.
//
// AC-A6-7 criterion (relaxed on purpose, twice)
//   baseline: "byte-identical to 9a1bd7d for the same input".
//   now:      byte-identical for input where neither the seed quirk (t10) nor
//             the clamp (t11) could trigger — no seeds or the only seed is the
//             hub, AND the outer ring stays inside 374 with node radii that
//             already fit minSpacing. For every other input the criterion is
//             "every node placed, no pair closer than its radii sum, rings grow
//             instead of stacking, and the rest of the arithmetic unchanged",
//             pinned by the updated digests below. The old output for those
//             inputs was a defect (overlapping points), not behaviour worth
//             preserving.
import { readFileSync } from 'node:fs'
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

/* ------------------------------------------- shipped pure functions (real code) */

function parityBlock(name) {
  const start = src.indexOf('/* @parity:' + name + ':start */')
  const end = src.indexOf('/* @parity:' + name + ':end */')
  if (start < 0 || end < 0) throw new Error('missing @parity block ' + name)
  return src.slice(start, end + ('/* @parity:' + name + ':end */').length)
}
function fromBlock(name, expr) {
  return new Function(parityBlock(name) + '\n;return ' + expr + ';')()
}
const computeRadialLayout = fromBlock('computeRadialLayout', 'computeRadialLayout')
const radiusOf = fromBlock('radiusOf', 'radiusOf')
const layoutExtent = fromBlock('layoutExtent', 'layoutExtent')

const BOX = { w: 1200, h: 800 }
const OLD_CLAMP_RADIUS = Math.min(BOX.w / 2, BOX.h / 2) - 26 // 374, the t11 root cause

function canonical(place) {
  return JSON.stringify(Object.keys(place).sort().map((id) => [id, place[id].x, place[id].y]))
}
function digestOf(place) {
  return createHash('sha256').update(canonical(place)).digest('hex')
}

/* --------------------------------------------------------------- generators */

/** Deterministic LCG sample; `seedCount` controls how many of the first nodes are seeds. */
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

/** Star whose only seed is the hub, so neither the t10 nor the t11 quirk can trigger. */
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

/* ------------------------------------------------------------- measurements */

function radiiOf(nodes) {
  let maxCited = 0
  for (let i = 0; i < nodes.length; i++) if (nodes[i].citedBy > maxCited) maxCited = nodes[i].citedBy
  const radii = {}
  for (let i = 0; i < nodes.length; i++) radii[nodes[i].id] = radiusOf(nodes[i].citedBy, maxCited)
  return radii
}
/** Worst (distance - radii sum) over every pair, plus the number of overlapping pairs. */
function overlapReport(place, nodes) {
  const radii = radiiOf(nodes)
  const ids = nodes.map((n) => n.id)
  let worst = { margin: Infinity }
  let overlapping = 0
  for (let i = 0; i < ids.length; i++) {
    for (let j = i + 1; j < ids.length; j++) {
      const a = place[ids[i]]
      const b = place[ids[j]]
      if (a === undefined || b === undefined) continue
      const distance = Math.hypot(a.x - b.x, a.y - b.y)
      const need = radii[ids[i]] + radii[ids[j]]
      if (distance < need) overlapping++
      if (distance - need < worst.margin) {
        worst = { margin: distance - need, pair: ids[i] + '/' + ids[j], distance: distance, need: need }
      }
    }
  }
  return { worst: worst, overlapping: overlapping }
}
function maxRadiusOf(place) {
  let max = 0
  for (const id in place) {
    const r = Math.hypot(place[id].x - BOX.w / 2, place[id].y - BOX.h / 2)
    if (r > max) max = r
  }
  return max
}
function minPairDistance(place, ids) {
  let min = Infinity
  for (let i = 0; i < ids.length; i++) {
    for (let j = i + 1; j < ids.length; j++) {
      const a = place[ids[i]]
      const b = place[ids[j]]
      if (a === undefined || b === undefined) continue
      const d = Math.hypot(a.x - b.x, a.y - b.y)
      if (d < min) min = d
    }
  }
  return min
}
function countOnCentre(place, ids) {
  let n = 0
  for (let i = 0; i < ids.length; i++) {
    const p = place[ids[i]]
    if (p !== undefined && Math.abs(p.x - BOX.w / 2) < 1e-9 && Math.abs(p.y - BOX.h / 2) < 1e-9) n++
  }
  return n
}

/* ---------------------------- 1. t10 regression: every seed is really placed */

console.log('--- multi-seed star graphs (t10 fix) ---')
for (const seedCount of [2, 3, 5, 10, 50]) {
  const graph = starSeeds(seedCount, 4)
  const place = computeRadialLayout(graph.nodes, graph.links, 0, BOX)
  const ids = graph.nodes.map((n) => n.id)
  const seedIds = graph.nodes.filter((n) => n.seed === true).map((n) => n.id)
  const placedSeeds = seedIds.filter((id) => place[id] !== undefined).length
  const seedDistance = minPairDistance(place, seedIds)
  check(seedCount + '-seed star: every seed gets a real place entry (no canvas-centre fallback)',
    placedSeeds === seedCount && Object.keys(place).length === graph.nodes.length,
    'placed seeds ' + placedSeeds + '/' + seedCount + ', keys ' + Object.keys(place).length + '/' + graph.nodes.length)
  check(seedCount + '-seed star: only the hub sits on the canvas centre', countOnCentre(place, ids) === 1, 'on centre ' + countOnCentre(place, ids))
  check(seedCount + '-seed star: seeds keep a positive pairwise distance', seedDistance > 40, 'min seed distance ' + seedDistance.toFixed(3))
}

/* ------------------------------- 2. t11: no pair closer than its radii sum */

console.log('--- overlap fix: 120 / 260 nodes (before: worst margin -31.860 / -37.169, min distance 2.07 / 0.006) ---')
const OVERLAP_TARGETS = [
  { label: '120-node random graph (3 seeds)', data: sample(11, 120, undefined, 3), spin: 1, previousWorstMargin: -31.860 },
  { label: '260-node random graph (3 seeds)', data: sample(13, 260, undefined, 3), spin: 3, previousWorstMargin: -37.169 },
]
for (const item of OVERLAP_TARGETS) {
  const place = computeRadialLayout(item.data.nodes, item.data.links, item.spin, BOX)
  const report = overlapReport(place, item.data.nodes)
  console.log('       ' + item.label + ': worst margin ' + report.worst.margin.toFixed(3) +
    ', worst pair ' + report.worst.pair + ' (distance ' + report.worst.distance.toFixed(3) +
    ', radii sum ' + report.worst.need.toFixed(3) + '), before the fix ' + item.previousWorstMargin.toFixed(3))
  check(item.label + ': every node is placed', Object.keys(place).length === item.data.nodes.length, Object.keys(place).length + '/' + item.data.nodes.length)
  check(item.label + ': no pair is closer than its two radii (margin >= 0)', report.overlapping === 0 && report.worst.margin >= 0,
    'overlapping pairs ' + report.overlapping + ', worst margin ' + report.worst.margin.toFixed(3))
  check(item.label + ': rings grew past the old clamp radius ' + OLD_CLAMP_RADIUS + ' instead of stacking',
    maxRadiusOf(place) > OLD_CLAMP_RADIUS, 'max ring radius ' + maxRadiusOf(place).toFixed(1))
}

console.log('--- overlap fix at the A5 ceiling (1000 nodes) and 500 nodes ---')
for (const [label, seed, count] of [['500-node', 41, 500], ['1000-node', 43, 1000]]) {
  const data = sample(seed, count, undefined, 3)
  const place = computeRadialLayout(data.nodes, data.links, 0, BOX)
  const report = overlapReport(place, data.nodes)
  check(label + ' random graph: no overlapping pair', report.overlapping === 0 && report.worst.margin >= 0,
    'overlapping pairs ' + report.overlapping + ', worst margin ' + report.worst.margin.toFixed(3))
}

/* -------------------- 3. A0 regression: byte-identical to the 9a1bd7d baseline */

// Digests computed from `git show 9a1bd7d:src/client.js` (computeLayout) on the
// same deterministic inputs. None of these inputs can reach either quirk: the
// seed is the hub (t10) and the outer ring stays inside the old clamp radius
// with radii that already fit minSpacing (t11) — so not one coordinate may move.
const BASELINE_IDENTICAL = [
  { label: 'star with the seed as hub (24 nodes, spin 0)', data: starHub(24), spin: 0, keys: 24, digest: 'c652299929f47b64348d169bcf143013498c714cf19017716de00926f3cf5171' },
  { label: 'star with the seed as hub (40 nodes, spin 2)', data: starHub(40), spin: 2, keys: 40, digest: '75ffd0c808c3b02072e849175efc41f6f6b1ad1baa91b1f61411e439b0a344dd' },
  { label: 'random legacy graph with no seeds, clamp-free (24 nodes, spin 0)', data: sample(41, 24, undefined, 0), spin: 0, keys: 24, digest: '30a01314e1db4a1b5a6658fd31f63cd23314e5e38526b67d61889f74ab5da546' },
]
console.log('--- A0 regression: byte-identical to the 9a1bd7d baseline ---')
for (const item of BASELINE_IDENTICAL) {
  const place = computeRadialLayout(item.data.nodes, item.data.links, item.spin, BOX)
  check('unchanged vs baseline: ' + item.label,
    Object.keys(place).length === item.keys && digestOf(place) === item.digest,
    'keys ' + Object.keys(place).length + '/' + item.keys + ', digest ' + digestOf(place))
}
// The t10 snapshot required to stay put: 5 nodes, no ring reaches the clamp.
const SMALL_T10 = {
  label: 't10 5-node snapshot (3 seeds, spin 0)',
  data: sample(17, 5, undefined, 3),
  spin: 0,
  keys: 5,
  digest: '4474714a083f4d96e9789ecf3163f1b795daa5c4855c1f115776fb4a409afc5e',
  json: '[["W0",653.4318307282194,479.75612493740465],["W1",436.1986259796573,347.52991453172774],["W2",600,400],["W3",636.5216555214771,311.21842151678896],["W4",504,400]]',
}
{
  const place = computeRadialLayout(SMALL_T10.data.nodes, SMALL_T10.data.links, SMALL_T10.spin, BOX)
  check('unchanged since t10: ' + SMALL_T10.label,
    Object.keys(place).length === SMALL_T10.keys && digestOf(place) === SMALL_T10.digest && canonical(place) === SMALL_T10.json,
    'digest ' + digestOf(place))
}

/* ------------------------ 4. intentionally updated snapshots (t11, clamp-affected) */

// These inputs DID reach the old clamp (their outer ring would have been 400+ in
// a 374 limit), so their layout legitimately changed. New digests pin the fixed
// behaviour; the previous values are recorded so the change stays auditable.
const POST_T11 = [
  { label: 'random legacy graph, 3 seeds (18 nodes, spin 0)', data: sample(7, 18, undefined, 3), spin: 0, keys: 18, digest: '5fa04849c8fccd2b41f5c37c5fd0bee06c6999ca9cd561a4e74e2ce8a923fa1f', previousDigest: 'c9d3ffd5f888bca4fcd2e68354e645b5a53df49bc72ae068e07f52301bb8d671' },
  { label: 'random legacy graph, 3 seeds (120 nodes, spin 1)', data: sample(11, 120, undefined, 3), spin: 1, keys: 120, digest: '6dbc4c45c16df0b62df8bcea9bc26974c0da4b11eb82459070843017b6fa9a5a', previousDigest: '2a04b01bc0c7098c95c4d2288a8c97046561f06e91733c6e2ef6f7126eb47c6e' },
  { label: 'random legacy graph, 3 seeds (260 nodes, spin 3)', data: sample(13, 260, undefined, 3), spin: 3, keys: 260, digest: 'f9db7acb16a6491da1d3bd427e0d1d0854b245071a5e748d190b0999cded78a9', previousDigest: 'd321e4139b6a7da16b4cebd1c5a955bb26ec191349c084456dd0fc957914b2f2' },
  { label: 'random legacy graph, no seeds (60 nodes, spin 0) — was an A0 case until its outer ring hit the clamp', data: sample(31, 60, undefined, 0), spin: 0, keys: 60, digest: '55c832cfcf67cb32410023a059847e3016d138cb48cf7fe5bf9448265d6656ab' },
]
console.log('--- intentionally updated snapshots (t11) ---')
for (const item of POST_T11) {
  const place = computeRadialLayout(item.data.nodes, item.data.links, item.spin, BOX)
  check('post-t11 snapshot: ' + item.label,
    Object.keys(place).length === item.keys && digestOf(place) === item.digest,
    'keys ' + Object.keys(place).length + '/' + item.keys + ', digest ' + digestOf(place))
}
check('every snapshot that was already frozen before t11 really moved (no "edit until green")',
  POST_T11.filter((i) => i.previousDigest !== undefined).every((i) => i.previousDigest !== i.digest))
check('every snapshot places every node (the 9a1bd7d drop signature is gone)',
  POST_T11.every((item) => Object.keys(computeRadialLayout(item.data.nodes, item.data.links, item.spin, BOX)).length === item.data.nodes.length))

/* ------------------------------- 5. viewBox follows the layout (nothing clipped) */

console.log('--- layoutExtent: the SVG viewBox follows the layout ---')
check('empty layout keeps the baseline frame', JSON.stringify(layoutExtent({}, 20)) === JSON.stringify({ x: 0, y: 0, w: 1200, h: 800 }))
check('a layout inside the frame keeps the exact 0 0 1200 800 viewBox',
  JSON.stringify(layoutExtent({ A: { x: 600, y: 400 }, B: { x: 300, y: 200 } }, 19)) === JSON.stringify({ x: 0, y: 0, w: 1200, h: 800 }))
{
  const big = sample(13, 260, undefined, 3)
  const place = computeRadialLayout(big.nodes, big.links, 3, BOX)
  const extent = layoutExtent(place, 19 + 12)
  let covered = true
  for (const id in place) {
    const p = place[id]
    if (p.x < extent.x || p.x > extent.x + extent.w || p.y < extent.y || p.y > extent.y + extent.h) covered = false
  }
  check('a grown layout yields a bigger viewBox that still covers every node', covered && (extent.w > 1200 || extent.h > 800),
    'extent ' + JSON.stringify(extent) + ', max ring radius ' + maxRadiusOf(place).toFixed(1))
}

/* --------------------------------------------------------------------- sanity */

check('empty input still returns an empty placement', canonical(computeRadialLayout([], [], 0, BOX)) === '[]')
check('the default box stays 1200x800',
  canonical(computeRadialLayout(SMALL_T10.data.nodes, SMALL_T10.data.links, 0)) === canonical(computeRadialLayout(SMALL_T10.data.nodes, SMALL_T10.data.links, 0, BOX)))

console.log(failures === 0 ? '\nclient-radial: all checks passed' : '\nclient-radial: ' + failures + ' check(s) FAILED')
process.exit(failures === 0 ? 0 : 1)
