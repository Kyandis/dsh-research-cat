// t5 independent check of the AC-A0-6/AC-A6-7 radial baseline claim.
//
//   node test/a0-baseline-check.mjs
//
// It does NOT import test/client.mjs or lab/client-check.mjs. It extracts the
// old `computeLayout` straight from `git show 9a1bd7d:src/client.js` and the new
// `@parity:computeRadialLayout` block from the working tree, runs both on the
// frozen datasets, and compares the canonical coordinate digests against the
// constants frozen in lab/client-check.mjs.
//
// Verdict it proves:
//  * A0 datasets  — old == new == frozen digest (byte-identical, no regression);
//  * post-t10/11  — the old code places 16/18, 118/120, 257/260 nodes (the
//                   defect), the new code places all and matches the updated
//                   digest (intentional, documented baseline change).
import { readFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
const root = resolve(here, '..')

const OLD = execFileSync('git', ['show', '9a1bd7d:src/client.js'], { cwd: root, encoding: 'utf8' })
const NEW = readFileSync(resolve(root, 'src/client.js'), 'utf8')

function oldImpl() {
  const radiusStart = OLD.indexOf('    function radiusOf(citedBy, maxCited) {')
  const layoutStart = OLD.indexOf('    function computeLayout(nodeList, linkList, spin) {')
  const layoutEnd = OLD.indexOf('\n    }\n', OLD.indexOf('      return place\n    }'))
  const source = OLD.slice(radiusStart, layoutStart) + '\n' + OLD.slice(layoutStart, layoutEnd + 6)
  return new Function('BOX_W', 'BOX_H', source + '\n;return { computeLayout: computeLayout, radiusOf: radiusOf };')(1200, 800)
}
function newImpl() {
  const start = NEW.indexOf('/* @parity:computeRadialLayout:start */')
  const end = NEW.indexOf('/* @parity:computeRadialLayout:end */') + '/* @parity:computeRadialLayout:end */'.length
  return new Function('BOX', NEW.slice(start, end) + '\n;return { computeRadialLayout: computeRadialLayout, radiusOf: radiusOf };')({ w: 1200, h: 800 })
}

const oldCode = oldImpl()
const newCode = newImpl()

function sample(seed, count, kinds, seedCount) {
  let state = seed
  function rnd() { state = (state * 1103515245 + 12345) % 2147483648; return state / 2147483648 }
  const nodes = []
  for (let i = 0; i < count; i++) nodes.push({ id: 'W' + i, title: 't' + i, year: 1990 + Math.floor(rnd() * 30), citedBy: Math.floor(rnd() * 4000), seed: i < (seedCount === undefined ? 3 : seedCount) })
  const links = []
  const pool = kinds || ['references', 'citations', 'related']
  for (let i = 1; i < count; i++) links.push({ source: nodes[Math.floor(rnd() * i)].id, target: nodes[i].id, kind: pool[Math.floor(rnd() * pool.length)] })
  return { nodes: nodes, links: links }
}
function starHub(count, kinds) {
  const pool = kinds || ['references', 'citations', 'related']
  const nodes = []
  for (let i = 0; i < count; i++) nodes.push({ id: 'W' + i, title: 't' + i, year: 1990 + i, citedBy: count - i, seed: i === 0 })
  const links = []
  for (let i = 1; i < count; i++) links.push({ source: 'W0', target: 'W' + i, kind: pool[i % pool.length] })
  return { nodes: nodes, links: links }
}
const canonical = (place) => JSON.stringify(Object.keys(place).sort().map((id) => [id, place[id].x, place[id].y]))
const digest = (text) => createHash('sha256').update(text).digest('hex')

// Digests below are the constants frozen in lab/client-check.mjs.
const A0 = [
  { label: 'star, seed is the hub (24 nodes, spin 0)', data: starHub(24), spin: 0, keys: 24, claimed: 'c652299929f47b64348d169bcf143013498c714cf19017716de00926f3cf5171' },
  { label: 'star, seed is the hub (40 nodes, spin 2)', data: starHub(40), spin: 2, keys: 40, claimed: '75ffd0c808c3b02072e849175efc41f6f6b1ad1baa91b1f61411e439b0a344dd' },
  { label: 'random legacy graph, no seeds, clamp-free (24 nodes, spin 0)', data: sample(41, 24, undefined, 0), spin: 0, keys: 24, claimed: '30a01314e1db4a1b5a6658fd31f63cd23314e5e38526b67d61889f74ab5da546' },
]
const POST = [
  { label: '3 seeds, 18 nodes, spin 0', data: sample(7, 18, undefined, 3), spin: 0, keys: 18, claimed: '5fa04849c8fccd2b41f5c37c5fd0bee06c6999ca9cd561a4e74e2ce8a923fa1f' },
  { label: '3 seeds, 120 nodes, spin 1', data: sample(11, 120, undefined, 3), spin: 1, keys: 120, claimed: '6dbc4c45c16df0b62df8bcea9bc26974c0da4b11eb82459070843017b6fa9a5a' },
  { label: '3 seeds, 260 nodes, spin 3', data: sample(13, 260, undefined, 3), spin: 3, keys: 260, claimed: 'f9db7acb16a6491da1d3bd427e0d1d0854b245071a5e748d190b0999cded78a9' },
  { label: 'no seeds, 60 nodes, spin 0', data: sample(31, 60, undefined, 0), spin: 0, keys: 60, claimed: '55c832cfcf67cb32410023a059847e3016d138cb48cf7fe5bf9448265d6656ab' },
]

let fails = 0
console.log('== A0: old(9a1bd7d) vs new(worktree); the claimed digest must match the OLD output ==')
for (const item of A0) {
  const oldPlace = oldCode.computeLayout(item.data.nodes, item.data.links, item.spin)
  const newPlace = newCode.computeRadialLayout(item.data.nodes, item.data.links, item.spin, { w: 1200, h: 800 })
  const oldDigest = digest(canonical(oldPlace))
  const newDigest = digest(canonical(newPlace))
  const ok = oldDigest === item.claimed && newDigest === item.claimed && Object.keys(oldPlace).length === item.keys && Object.keys(newPlace).length === item.keys
  if (!ok) fails++
  console.log((ok ? '  PASS ' : '  FAIL ') + item.label)
  console.log('       old=' + oldDigest.slice(0, 24) + ' new=' + newDigest.slice(0, 24) + ' claimed=' + item.claimed.slice(0, 24) + ' keys=' + Object.keys(oldPlace).length + '/' + Object.keys(newPlace).length)
}
console.log('== post-t10/t11: the claimed digest must match NEW, and OLD must differ (the defect was real) ==')
for (const item of POST) {
  const oldPlace = oldCode.computeLayout(item.data.nodes, item.data.links, item.spin)
  const newPlace = newCode.computeRadialLayout(item.data.nodes, item.data.links, item.spin, { w: 1200, h: 800 })
  const oldDigest = digest(canonical(oldPlace))
  const newDigest = digest(canonical(newPlace))
  const ok = newDigest === item.claimed && oldDigest !== newDigest
  if (!ok) fails++
  console.log((ok ? '  PASS ' : '  FAIL ') + item.label + ' oldKeys=' + Object.keys(oldPlace).length + '/' + item.keys + ' newKeys=' + Object.keys(newPlace).length)
  console.log('       old=' + oldDigest.slice(0, 24) + ' new=' + newDigest.slice(0, 24) + ' claimed=' + item.claimed.slice(0, 24))
}
console.log(fails === 0 ? '\nt5-a0-baseline: all independent checks passed' : '\nt5-a0-baseline: ' + fails + ' FAILED')
process.exit(fails === 0 ? 0 : 1)
