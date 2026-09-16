// Render a graph.json with either layout into SVG + PNG so the arrangement can be judged by eye.
// Usage: node render.mjs <old|new> <outName>
import { readFileSync, writeFileSync } from 'node:fs'
import { Resvg } from '@resvg/resvg-js'

const BOX_W = 1200
const BOX_H = 800
const C = {
  bg: '#ffffff',
  node: '#e9edf3',
  seed: '#2f6feb',
  border: '#d6dae1',
  brand: '#2f6feb',
  warn: '#d97706',
  tertiary: '#9aa3ad',
  label: '#5b6472',
}

const graphFile = process.argv[2] || 'graph.json'
const graph = JSON.parse(readFileSync(new URL('./' + graphFile, import.meta.url), 'utf8'))
const which = process.argv[3] || 'new'
const outName = process.argv[4] || which

// ---- old layout, copied verbatim from client.js (pkg-2) ----
function oldLayout(nodeList, linkList, spin) {
  const count = nodeList.length
  const place = {}
  if (count === 0) return place
  const known = {}
  for (let i = 0; i < count; i++) known[nodeList[i].id] = true
  const offset = (spin > 0 ? spin : 0) * 0.73
  for (let i = 0; i < count; i++) {
    const angle = i * 2.399963 + offset
    const radius = 0.36 * Math.min(BOX_W, BOX_H) * Math.sqrt((i + 1) / count)
    place[nodeList[i].id] = {
      x: BOX_W / 2 + radius * Math.cos(angle),
      y: BOX_H / 2 + radius * Math.sin(angle),
    }
  }
  const edges = []
  for (let i = 0; i < linkList.length; i++) {
    if (known[linkList[i].source] === true && known[linkList[i].target] === true) {
      edges.push([linkList[i].source, linkList[i].target, linkList[i].kind])
    }
  }
  const ideal = Math.sqrt((BOX_W * BOX_H) / count) * 0.6
  const iterations = count > 90 ? 90 : count > 40 ? 160 : 260
  let temperature = BOX_W / 9
  const cooling = temperature / (iterations + 1)
  const push = {}
  for (let step = 0; step < iterations; step++) {
    for (let i = 0; i < count; i++) push[nodeList[i].id] = { x: 0, y: 0 }
    for (let i = 0; i < count; i++) {
      const aId = nodeList[i].id
      const pa = place[aId]
      const da = push[aId]
      for (let j = i + 1; j < count; j++) {
        const bId = nodeList[j].id
        const pb = place[bId]
        const db = push[bId]
        let dx = pa.x - pb.x
        let dy = pa.y - pb.y
        let square = dx * dx + dy * dy
        if (square < 0.01) { dx = 0.31 + (i - j) * 0.13; dy = 0.47; square = dx * dx + dy * dy }
        const distance = Math.sqrt(square)
        const force = (ideal * ideal) / distance
        const ux = dx / distance
        const uy = dy / distance
        da.x += ux * force
        da.y += uy * force
        db.x -= ux * force
        db.y -= uy * force
      }
    }
    for (let e = 0; e < edges.length; e++) {
      const source = edges[e][0]
      const target = edges[e][1]
      const kind = edges[e][2]
      const pa = place[source]
      const pb = place[target]
      const da = push[source]
      const db = push[target]
      if (pa === undefined || pb === undefined || da === undefined || db === undefined) continue
      const weight = kind === 'related' ? 1.6 : kind === 'references' ? 1 : 0.7
      let dx = pa.x - pb.x
      let dy = pa.y - pb.y
      let distance = Math.sqrt(dx * dx + dy * dy)
      if (distance < 0.01) distance = 0.01
      const force = ((distance * distance) / ideal) * weight * 0.6
      const ux = dx / distance
      const uy = dy / distance
      da.x -= ux * force
      da.y -= uy * force
      db.x += ux * force
      db.y += uy * force
    }
    for (let i = 0; i < count; i++) {
      const point = place[nodeList[i].id]
      const vector = push[nodeList[i].id]
      vector.x += (BOX_W / 2 - point.x) * 0.015
      vector.y += (BOX_H / 2 - point.y) * 0.015
      const length = Math.sqrt(vector.x * vector.x + vector.y * vector.y)
      if (length > 0.0001) {
        const step2 = Math.min(length, temperature)
        point.x += (vector.x / length) * step2
        point.y += (vector.y / length) * step2
      }
      point.x = Math.max(34, Math.min(BOX_W - 34, point.x))
      point.y = Math.max(34, Math.min(BOX_H - 34, point.y))
    }
    temperature = Math.max(1, temperature - cooling)
  }
  return place
}

// ---- new layout, loaded from its own file so the tested text IS the shipped text ----
const newSource = readFileSync(new URL('./computeLayout.new.js', import.meta.url), 'utf8')
const newLayout = new Function('BOX_W', 'BOX_H', 'return (' + newSource + ')')(BOX_W, BOX_H)

const place = which === 'old' ? oldLayout(graph.nodes, graph.links, 0) : newLayout(graph.nodes, graph.links, 0)

const nodes = graph.nodes
const maxCited = nodes.reduce((m, n) => Math.max(m, n.citedBy), 0)
const oldRadius = (c) => 4 + Math.min(15, Math.log10((c > 0 ? c : 0) + 1) * 4.4)
const newRadius = (c) => 4 + 15 * Math.sqrt((c > 0 ? c : 0) / Math.max(1, maxCited))

const inCollection = {}
for (const s of graph.seeds) inCollection[s] = true
const kinds = {}
for (const l of graph.links) {
  ;(kinds[l.source] = kinds[l.source] || {})[l.kind] = true
  ;(kinds[l.target] = kinds[l.target] || {})[l.kind] = true
}
const roleOf = (id) => {
  if (inCollection[id]) return 'seed'
  const k = kinds[id]
  if (!k) return 'lonely'
  if (k.references) return 'references'
  if (k.citations) return 'citations'
  if (k.related) return 'related'
  return 'lonely'
}
const ROLE_STROKE = {
  seed: 'transparent',
  references: C.brand,
  citations: C.warn,
  related: C.tertiary,
  lonely: C.tertiary,
}

// label policy: old = seed||hover||selected||k>=1.5 ; new = seed | top-18 by citations | k>=1.8
const ranked = nodes.slice().sort((a, b) => b.citedBy - a.citedBy)
const rank = {}
ranked.forEach((n, i) => { rank[n.id] = i })

const edgeOpacity = { references: 0.4, citations: 0.42, related: 0.3 }
const edgeColor = { references: C.brand, citations: C.warn, related: C.tertiary }

let svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${BOX_W}" height="${BOX_H}" viewBox="0 0 ${BOX_W} ${BOX_H}" font-family="Helvetica, Arial, sans-serif">`
svg += `<rect width="${BOX_W}" height="${BOX_H}" fill="${C.bg}"/>`
for (const l of graph.links) {
  const a = place[l.source], b = place[l.target]
  if (!a || !b) continue
  svg += `<line x1="${a.x.toFixed(1)}" y1="${a.y.toFixed(1)}" x2="${b.x.toFixed(1)}" y2="${b.y.toFixed(1)}" stroke="${edgeColor[l.kind] || C.tertiary}" stroke-width="1.1" opacity="${edgeOpacity[l.kind] || 0.3}"/>`
}
for (const n of nodes) {
  const p = place[n.id]
  if (!p) continue
  const seed = !!inCollection[n.id]
  const r = which === 'old' ? oldRadius(n.citedBy) : newRadius(n.citedBy)
  const importance = maxCited > 0 ? Math.sqrt(n.citedBy / maxCited) : 0
  const opacity = which === 'old' ? 1 : (0.55 + 0.45 * importance).toFixed(2)
  svg += `<circle cx="${p.x.toFixed(1)}" cy="${p.y.toFixed(1)}" r="${r.toFixed(1)}" fill="${seed ? C.seed : C.node}" stroke="${ROLE_STROKE[roleOf(n.id)]}" stroke-width="${seed ? 1.2 : 1.2}" opacity="${opacity}"/>`
  const show = which === 'old'
    ? (seed)
    : (seed || rank[n.id] < 18)
  if (show) {
    const t = n.title.length > 26 ? n.title.slice(0, 25) + '\u2026' : n.title
    svg += `<text x="${p.x.toFixed(1)}" y="${(p.y + r + 11).toFixed(1)}" fill="${C.label}" font-size="11" text-anchor="middle">${t.replace(/&/g, '&amp;').replace(/</g, '&lt;')}</text>`
  }
}
svg += `</svg>`

writeFileSync(new URL(`./${outName}.svg`, import.meta.url), svg)
const png = new Resvg(svg, { fitTo: { mode: 'width', value: BOX_W } }).render().asPng()
writeFileSync(new URL(`./${outName}.png`, import.meta.url), png)

// ---- geometry metrics ----
let bad = 0, oob = 0, minPair = Infinity, overlapped = 0
const ids = Object.keys(place)
for (const id of ids) {
  const p = place[id]
  if (!isFinite(p.x) || !isFinite(p.y)) bad++
  if (p.x < 0 || p.x > BOX_W || p.y < 0 || p.y > BOX_H) oob++
}
for (let i = 0; i < ids.length; i++) {
  for (let j = i + 1; j < ids.length; j++) {
    const a = place[ids[i]], b = place[ids[j]]
    const d = Math.hypot(a.x - b.x, a.y - b.y)
    if (d < minPair) minPair = d
    if (d < 24) overlapped++
  }
}
// ---- layout-quality metrics: total edge length, hub angular resolution, proper crossings ----
const degree = {}
for (const l of graph.links) {
  degree[l.source] = (degree[l.source] || 0) + 1
  degree[l.target] = (degree[l.target] || 0) + 1
}
let hubId = nodes[0].id
for (const n of nodes) if ((degree[n.id] || 0) > (degree[hubId] || 0)) hubId = n.id

let totalLen = 0, maxLen = 0
for (const l of graph.links) {
  const a = place[l.source], b = place[l.target]
  if (!a || !b) continue
  const d = Math.hypot(a.x - b.x, a.y - b.y)
  totalLen += d
  if (d > maxLen) maxLen = d
}
const angles = []
for (const l of graph.links) {
  const other = l.source === hubId ? l.target : l.target === hubId ? l.source : null
  if (other === null) continue
  const p = place[other]
  if (!p) continue
  angles.push(Math.atan2(p.y - place[hubId].y, p.x - place[hubId].x))
}
angles.sort((a, b) => a - b)
let minGap = Infinity
for (let i = 0; i < angles.length; i++) {
  const next = i + 1 < angles.length ? angles[i + 1] : angles[0] + Math.PI * 2
  const gap = next - angles[i]
  if (gap < minGap) minGap = gap
}
// proper crossings (pairs of edges sharing no endpoint)
const segs = graph.links.map((l) => [place[l.source], place[l.target], l.source, l.target]).filter((s) => s[0] && s[1])
function orient(a, b, c) { return (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x) }
let crossings = 0
for (let i = 0; i < segs.length; i++) {
  for (let j = i + 1; j < segs.length; j++) {
    const [p1, p2, s1, t1] = segs[i]
    const [p3, p4, s2, t2] = segs[j]
    if (s1 === s2 || s1 === t2 || t1 === s2 || t1 === t2) continue
    const d1 = orient(p3, p4, p1), d2 = orient(p3, p4, p2)
    const d3 = orient(p1, p2, p3), d4 = orient(p1, p2, p4)
    if (((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0))) crossings++
  }
}
console.log(`  edgeLen total=${Math.round(totalLen)} max=${Math.round(maxLen)} | hubDeg=${degree[hubId]} minAngularGap=${(minGap * 180 / Math.PI).toFixed(1)}deg crossings=${crossings}`)

const xs = ids.map((id) => place[id].x), ys = ids.map((id) => place[id].y)
console.log(`${which}: nodes=${ids.length} NaN=${bad} outOfBox=${oob} minPairDist=${minPair.toFixed(1)} pairs<24px=${overlapped} bbox=${Math.round(Math.min(...xs))}..${Math.round(Math.max(...xs))} x ${Math.round(Math.min(...ys))}..${Math.round(Math.max(...ys))}`)
console.log(`  wrote ${outName}.png`)