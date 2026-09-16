const PANEL_KEY = 'research-cat'
const BOX_W = 1200
const BOX_H = 800
const EMPTY_GRAPH = { seeds: [], nodes: [], links: [] }
const KIND_LABEL = { references: 'References', citations: 'Cited by', related: 'Similar' }
const ROLE_STROKE = {
  seed: 'transparent',
  references: 'var(--dsw-alias-brand-primary)',
  citations: 'var(--dsw-alias-state-warn-primary)',
  related: 'var(--dsw-alias-label-tertiary)',
  lonely: 'var(--dsw-alias-border-l2)',
}
const EXAMPLES = [
  'citation network visualization',
  'single-cell RNA sequencing',
  'graph neural networks',
  'CRISPR off-target effects',
]

const CSS = [
  '.rr-root{display:flex;height:100%;min-height:0;box-sizing:border-box;overflow:hidden;background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-primary);font-size:13px;line-height:1.45}',
  '.rr-root *{box-sizing:border-box}',
  '.rr-side{display:flex;flex-direction:column;flex:0 0 292px;width:292px;min-height:0;border-right:1px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-layer-1)}',
  '.rr-head{padding:13px 13px 9px}',
  '.rr-title{display:block;font-size:14px;font-weight:600;letter-spacing:.2px}',
  '.rr-sub{display:block;margin-top:2px;font-size:11px;color:var(--dsw-alias-label-tertiary)}',
  '.rr-search{display:flex;gap:6px;padding:0 13px 10px}',
  '.rr-input{flex:1 1 auto;min-width:0;height:30px;padding:0 9px;border-radius:7px;border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-2);color:inherit;font:inherit;font-size:12.5px;outline:none}',
  '.rr-input:focus{border-color:var(--dsw-alias-brand-primary)}',
  '.rr-btn{height:30px;padding:0 10px;border-radius:7px;border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary);font:inherit;font-size:12px;cursor:pointer;white-space:nowrap}',
  '.rr-btn:hover:enabled{background:var(--dsw-alias-interactive-bg-hover)}',
  '.rr-btn:disabled{opacity:.45;cursor:default}',
  '.rr-btn-primary{background:var(--dsw-alias-button-primary-fill);border-color:transparent;color:#fff;font-weight:600}',
  '.rr-btn-primary:hover:enabled{background:var(--dsw-alias-button-primary-hover)}',
  '.rr-btn-small{height:24px;padding:0 8px;font-size:11px;border-radius:6px}',
  '.rr-error{margin:0 13px 8px;padding:7px 9px;border-radius:7px;font-size:11.5px;color:var(--dsw-alias-state-error-primary);border:1px solid var(--dsw-alias-state-error-primary)}',
  '.rr-scroll{flex:1 1 auto;min-height:0;overflow:auto;padding:0 13px 16px}',
  '.rr-section{margin-top:12px}',
  '.rr-section-title{font-size:10.5px;text-transform:uppercase;letter-spacing:.7px;color:var(--dsw-alias-label-tertiary);margin-bottom:6px;display:flex;justify-content:space-between;align-items:center}',
  '.rr-result{display:flex;gap:8px;align-items:flex-start;padding:7px 8px;border-radius:8px;border:1px solid transparent}',
  '.rr-result:hover{background:var(--dsw-alias-interactive-bg-hover)}',
  '.rr-result-main{flex:1 1 auto;min-width:0}',
  '.rr-result-title{font-size:12.5px;font-weight:500;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}',
  '.rr-result-meta{font-size:11px;color:var(--dsw-alias-label-tertiary);margin-top:2px;display:-webkit-box;-webkit-line-clamp:1;-webkit-box-orient:vertical;overflow:hidden}',
  '.rr-seed{display:flex;gap:8px;align-items:flex-start;padding:6px 8px;border-radius:8px;cursor:pointer}',
  '.rr-seed:hover{background:var(--dsw-alias-interactive-bg-hover)}',
  '.rr-seed-on{background:var(--dsw-alias-interactive-bg-active)}',
  '.rr-seed-title{font-size:12.5px;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}',
  '.rr-seed-meta{font-size:11px;color:var(--dsw-alias-label-tertiary);margin-top:1px}',
  '.rr-x{border:none;background:transparent;color:var(--dsw-alias-label-tertiary);cursor:pointer;font-size:14px;line-height:1;padding:2px 4px;border-radius:5px}',
  '.rr-x:hover{color:var(--dsw-alias-state-error-primary)}',
  '.rr-main{display:flex;flex-direction:column;flex:1 1 auto;min-width:0;min-height:0}',
  '.rr-toolbar{display:flex;align-items:center;gap:6px;flex-wrap:wrap;padding:9px 12px;border-bottom:1px solid var(--dsw-alias-border-l1)}',
  '.rr-stats{font-size:11.5px;color:var(--dsw-alias-label-tertiary);margin-right:auto}',
  '.rr-toggle{height:24px;padding:0 9px;border-radius:999px;border:1px solid var(--dsw-alias-border-l2);background:transparent;color:var(--dsw-alias-label-tertiary);font:inherit;font-size:11px;cursor:pointer}',
  '.rr-toggle-on{color:var(--dsw-alias-label-primary);border-color:var(--dsw-alias-brand-primary)}',
  '.rr-canvas{position:relative;flex:1 1 auto;min-height:0;overflow:hidden}',
  '.rr-svg{display:block;width:100%;height:100%;cursor:grab}',
  '.rr-svg:active{cursor:grabbing}',
  '.rr-edge{stroke-linecap:round}',
  '.rr-edge-references{stroke:var(--dsw-alias-brand-primary);stroke-width:1.1;opacity:.4}',
  '.rr-edge-citations{stroke:var(--dsw-alias-state-warn-primary);stroke-width:1.1;opacity:.42}',
  '.rr-edge-related{stroke:var(--dsw-alias-label-tertiary);stroke-width:1;opacity:.3;stroke-dasharray:4 5}',
  '.rr-node{fill:var(--dsw-alias-bg-layer-3);stroke:var(--dsw-alias-border-l2);stroke-width:1.2;cursor:pointer}',
  '.rr-node-seed{fill:var(--dsw-alias-brand-primary);stroke:transparent}',
  '.rr-node-hover{stroke:var(--dsw-alias-label-secondary)}',
  '.rr-node-selected{stroke:var(--dsw-alias-brand-primary);stroke-width:2.4}',
  '.rr-label{fill:var(--dsw-alias-label-secondary);font-size:11px;pointer-events:none;user-select:none}',
  '.rr-empty{position:absolute;top:0;left:0;right:0;bottom:0;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:9px;padding:30px;text-align:center;pointer-events:none}',
  '.rr-empty-title{font-size:15px;font-weight:600}',
  '.rr-empty-text{max-width:430px;font-size:12.5px;color:var(--dsw-alias-label-secondary)}',
  '.rr-chips{display:flex;flex-wrap:wrap;gap:6px;justify-content:center;margin-top:6px;pointer-events:auto}',
  '.rr-chip{height:26px;padding:0 11px;border-radius:999px;border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-secondary);font:inherit;font-size:11.5px;cursor:pointer}',
  '.rr-chip:hover{color:var(--dsw-alias-label-primary);border-color:var(--dsw-alias-brand-primary)}',
  '.rr-hud{position:absolute;left:12px;bottom:12px;max-width:60%;pointer-events:none;font-size:11.5px;color:var(--dsw-alias-label-secondary);background:var(--dsw-alias-bg-overlay);border:1px solid var(--dsw-alias-border-l1);border-radius:8px;padding:5px 9px}',
  '.rr-legend{position:absolute;right:12px;top:12px;display:flex;flex-direction:column;gap:4px;pointer-events:none;background:var(--dsw-alias-bg-overlay);border:1px solid var(--dsw-alias-border-l1);border-radius:8px;padding:7px 9px;font-size:11px;color:var(--dsw-alias-label-secondary)}',
  '.rr-legend-row{display:flex;align-items:center;gap:6px}',
  '.rr-swatch{width:16px;height:2px;border-radius:2px;display:inline-block}',
  '.rr-swatch-dot{width:9px;height:9px;border-radius:50%;display:inline-block}',
  '.rr-legend-note{margin-top:3px;padding-top:4px;border-top:1px solid var(--dsw-alias-border-l1);font-size:10px;opacity:.8}',
  '.rr-zoom{position:absolute;right:12px;bottom:12px;display:flex;flex-direction:column;gap:4px}',
  '.rr-detail{display:flex;flex-direction:column;flex:0 0 330px;width:330px;min-height:0;border-left:1px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-layer-1);overflow:auto;padding:14px}',
  '.rr-detail h2{margin:0 0 6px;font-size:14px;font-weight:600;line-height:1.35}',
  '.rr-detail-meta{font-size:11.5px;color:var(--dsw-alias-label-tertiary);margin-bottom:8px}',
  '.rr-authors{font-size:12px;color:var(--dsw-alias-label-secondary);margin-bottom:10px}',
  '.rr-abstract{font-size:12px;color:var(--dsw-alias-label-secondary);white-space:pre-wrap}',
  '.rr-actions{display:flex;flex-wrap:wrap;gap:6px;margin:10px 0 4px}',
  '.rr-link{color:var(--dsw-alias-brand-primary);text-decoration:none;font-size:11.5px;margin-right:10px}',
  '.rr-link:hover{text-decoration:underline}',
  '.rr-hint{font-size:12px;color:var(--dsw-alias-label-tertiary);padding:6px 0}',
  '.rr-badge{display:inline-block;font-size:10px;padding:1px 6px;border-radius:999px;border:1px solid var(--dsw-alias-brand-primary);color:var(--dsw-alias-brand-primary);margin-left:6px;vertical-align:middle}',
  '.rr-busy{position:absolute;left:12px;top:12px;font-size:11.5px;color:var(--dsw-alias-label-secondary);background:var(--dsw-alias-bg-overlay);border:1px solid var(--dsw-alias-border-l1);border-radius:8px;padding:4px 9px}',
  '.rr-card{display:flex;flex-direction:column;border:1px solid var(--dsw-alias-border-l1);border-radius:10px;overflow:hidden;background:var(--dsw-alias-bg-base)}',
  '.rr-card-head{display:flex;align-items:center;gap:8px;padding:8px 10px;border-bottom:1px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-layer-1)}',
  '.rr-card-head strong{font-size:12.5px;margin-right:auto}',
  '.rr-card-body{height:540px;min-height:0}',
].join('\n')

function errText(error) {
  if (error !== null && error !== undefined && typeof error.message === 'string' && error.message.length > 0) {
    return error.message
  }
  return String(error)
}

function shorten(value, limit) {
  const text = String(value === null || value === undefined ? '' : value)
  return text.length > limit ? text.slice(0, limit - 1) + '\u2026' : text
}

function metaLine(paper) {
  const bits = []
  if (paper.venue) bits.push(paper.venue)
  if (paper.year > 0) bits.push(String(paper.year))
  bits.push(paper.citedBy + ' citations')
  return bits.join(' \u00b7 ')
}

function radiusOf(citedBy, maxCited) {
  const top = maxCited > 0 ? maxCited : 1
  const share = citedBy > 0 ? citedBy / top : 0
  return 4 + 15 * Math.sqrt(share > 1 ? 1 : share)
}

function computeLayout(nodeList, linkList, spin) {
  const place = {}
  const count = nodeList.length
  if (count === 0) return place
  const CX = BOX_W / 2
  const CY = BOX_H / 2

  const byId = {}
  for (let i = 0; i < count; i++) byId[nodeList[i].id] = nodeList[i]

  const adj = {}
  for (let i = 0; i < count; i++) adj[nodeList[i].id] = []
  const live = []
  for (let i = 0; i < linkList.length; i++) {
    const link = linkList[i]
    if (byId[link.source] === undefined || byId[link.target] === undefined) continue
    adj[link.source].push(link.target)
    adj[link.target].push(link.source)
    live.push(link)
  }

  let hub = nodeList[0].id
  for (let i = 1; i < count; i++) {
    const node = nodeList[i]
    const degree = adj[node.id].length
    const hubDegree = adj[hub].length
    if (degree > hubDegree) { hub = node.id; continue }
    if (degree !== hubDegree) continue
    const nodeSeed = node.seed === true
    const hubSeed = byId[hub].seed === true
    if (nodeSeed && !hubSeed) { hub = node.id; continue }
    if (nodeSeed === hubSeed && node.citedBy > byId[hub].citedBy) hub = node.id
  }

  const layer = {}
  for (let i = 0; i < count; i++) layer[nodeList[i].id] = -1
  layer[hub] = 0
  const layers = [[hub]]
  const queue = [hub]
  for (let qi = 0; qi < queue.length; qi++) {
    const current = queue[qi]
    const neighbours = adj[current]
    for (let i = 0; i < neighbours.length; i++) {
      const other = neighbours[i]
      if (layer[other] !== -1) continue
      layer[other] = layer[current] + 1
      if (layers[layer[other]] === undefined) layers[layer[other]] = []
      layers[layer[other]].push(other)
      queue.push(other)
    }
  }
  const stray = []
  for (let i = 0; i < count; i++) {
    const id = nodeList[i].id
    if (layer[id] === -1) { layer[id] = layers.length; stray.push(id) }
  }
  if (stray.length > 0) layers.push(stray)

  const kinds = {}
  for (let i = 0; i < live.length; i++) {
    const link = live[i]
    if (kinds[link.source] === undefined) kinds[link.source] = {}
    if (kinds[link.target] === undefined) kinds[link.target] = {}
    kinds[link.source][link.kind] = true
    kinds[link.target][link.kind] = true
  }
  function roleOf(id) {
    const node = byId[id]
    if (node !== undefined && node.seed === true) return 'seed'
    const set = kinds[id]
    if (set === undefined) return 'lonely'
    if (set.references === true) return 'references'
    if (set.citations === true) return 'citations'
    if (set.related === true) return 'related'
    return 'lonely'
  }
  const ORDER = ['references', 'citations', 'related', 'lonely']

  const minSpacing = count > 150 ? 30 : count > 80 ? 38 : 46
  const ringGap = minSpacing + 30
  const maxRadius = Math.min(CX, CY) - 26
  const turns = spin > 0 ? spin : 0
  const direction = turns % 2 === 0 ? 1 : -1
  const turn = turns * 0.43

  place[hub] = { x: CX, y: CY }

  const spokes = []
  let usedRadius = 0

  for (let level = 1; level < layers.length; level++) {
    const ids = layers[level]
    if (ids === undefined || ids.length === 0) continue

    const groups = []
    for (let g = 0; g < ORDER.length; g++) {
      const members = []
      for (let i = 0; i < ids.length; i++) if (roleOf(ids[i]) === ORDER[g]) members.push(ids[i])
      if (members.length === 0) continue
      members.sort(function (a, b) { return byId[b].citedBy - byId[a].citedBy })
      groups.push(members)
    }

    const gap = groups.length > 1 ? 0.2 : 0
    const usable = Math.PI * 2 - gap * groups.length
    let cursor = turn + (level - 1) * 0.31 * direction
    const startRadius = Math.max(96, usedRadius + ringGap)
    let reached = startRadius

    for (let g = 0; g < groups.length; g++) {
      const members = groups[g]
      const arc = usable * (members.length / ids.length)
      let remaining = members.length
      let placed = 0
      let radius = startRadius
      let ring = 0
      while (remaining > 0) {
        if (radius > maxRadius) radius = maxRadius
        let capacity = Math.floor((arc * radius) / minSpacing)
        if (capacity < 1) capacity = 1
        const take = remaining < capacity ? remaining : capacity
        const step = arc / take
        const stagger = ring % 2 === 0 ? 0.5 : 1
        for (let k = 0; k < take; k++) {
          const theta = cursor + direction * step * (k + stagger)
          const id = members[placed + k]
          if (level === 1) spokes.push({ id: id, radius: radius, theta: theta })
          else place[id] = { x: CX + radius * Math.cos(theta), y: CY + radius * Math.sin(theta) }
          if (radius > reached) reached = radius
        }
        placed += take
        remaining -= take
        ring++
        radius += ringGap
      }
      cursor = cursor + direction * (arc + gap)
    }
    usedRadius = reached
  }

  if (spokes.length > 1) {
    const minAngle = 0.05
    spokes.sort(function (a, b) { return a.theta - b.theta })
    const total = spokes.length
    for (let pass = 0; pass < 60; pass++) {
      let moved = 0
      for (let i = 0; i < total; i++) {
        const a = spokes[i]
        const b = spokes[(i + 1) % total]
        let gap = i === total - 1 ? b.theta + Math.PI * 2 - a.theta : b.theta - a.theta
        if (gap >= minAngle) continue
        const push = (minAngle - gap) * 0.5
        a.theta -= push
        b.theta += push
        moved++
      }
      if (moved === 0) break
    }
  }
  for (let i = 0; i < spokes.length; i++) {
    const spoke = spokes[i]
    place[spoke.id] = { x: CX + spoke.radius * Math.cos(spoke.theta), y: CY + spoke.radius * Math.sin(spoke.theta) }
  }

  const ids = Object.keys(place)
  for (let i = 0; i < ids.length; i++) {
    const point = place[ids[i]]
    if (!isFinite(point.x) || !isFinite(point.y)) { point.x = CX; point.y = CY }
    point.x = Math.max(34, Math.min(BOX_W - 34, point.x))
    point.y = Math.max(34, Math.min(BOX_H - 34, point.y))
  }
  return place
}

return {
  apply(ctx) {
    const slots = ctx.get('slots')
    if (slots === undefined) return
    const layoutService = ctx.get('layout')

    ctx.effect(function () { return styles.insert(CSS) }, 'research-cat/styles')

    function call(method, args) {
      return host.call(method, args === undefined ? {} : args)
    }

    function PanelIcon(props) {
      const size = typeof props.size === 'number' ? props.size : 18
      return React.createElement(
        'svg',
        {
          width: size,
          height: size,
          viewBox: '0 0 24 24',
          fill: 'none',
          stroke: 'currentColor',
          strokeWidth: 1.7,
          strokeLinecap: 'round',
          strokeLinejoin: 'round',
          'aria-hidden': 'true',
        },
        React.createElement('circle', { key: 'a', cx: 12, cy: 4.6, r: 2.5 }),
        React.createElement('circle', { key: 'b', cx: 4.8, cy: 17.4, r: 2.5 }),
        React.createElement('circle', { key: 'c', cx: 19.2, cy: 17.4, r: 2.5 }),
        React.createElement('path', { key: 'd', d: 'M10.3 6.7 6.6 15.3' }),
        React.createElement('path', { key: 'e', d: 'M13.7 6.7 17.4 15.3' }),
        React.createElement('path', { key: 'f', d: 'M7.3 17.4h9.4' }),
      )
    }

    function ResearchCatPanel() {
      const [graph, setGraph] = React.useState(EMPTY_GRAPH)
      const [query, setQuery] = React.useState('')
      const [results, setResults] = React.useState(null)
      const [resultsFor, setResultsFor] = React.useState('')
      const [busy, setBusy] = React.useState('')
      const [error, setError] = React.useState('')
      const [selected, setSelected] = React.useState(null)
      const [detail, setDetail] = React.useState(null)
      const [loadingDetail, setLoadingDetail] = React.useState(false)
      const [showKinds, setShowKinds] = React.useState({ references: true, citations: true, related: true })
      const [place, setPlace] = React.useState({})
      const [manual, setManual] = React.useState({})
      const [view, setView] = React.useState({ k: 1, x: 0, y: 0 })
      const [hovered, setHovered] = React.useState(null)
      const [spin, setSpin] = React.useState(0)
      const svgRef = React.useRef(null)
      const dragRef = React.useRef(null)

      const signature = React.useMemo(function () {
        const ids = graph.nodes.map(function (node) { return node.id })
        ids.sort()
        return ids.join(',') + '#' + graph.links.length + '#' + spin
      }, [graph, spin])

      React.useEffect(function () {
        setPlace(computeLayout(graph.nodes, graph.links, spin))
      }, [signature])

      React.useEffect(function () {
        let alive = true
        call('state', {}).then(function (res) {
          if (alive && res && res.ok === true && res.graph) setGraph(res.graph)
        }, function () {})
        return function () { alive = false }
      }, [])

      function runSearch(term) {
        const asked = term === undefined ? query : term
        if (typeof asked !== 'string' || asked.trim().length === 0) return
        setBusy('Searching OpenAlex\u2026')
        setError('')
        call('search', { query: asked }).then(function (res) {
          if (res && res.ok === true) {
            setResults(res.results || [])
            setResultsFor(asked)
            if (res.graph) setGraph(res.graph)
          } else {
            setResults([])
            setError(res && res.error ? res.error : 'Search failed.')
          }
        }, function (err) { setError(errText(err)) }).then(function () { setBusy('') })
      }

      function loadDetail(id) {
        setSelected(id)
        setDetail(null)
        setLoadingDetail(true)
        call('details', { id: id }).then(function (res) {
          if (res && res.ok === true) setDetail(res.paper)
          else setError(res && res.error ? res.error : 'Could not load that paper.')
        }, function () {}).then(function () { setLoadingDetail(false) })
      }

      function addPaper(id) {
        setBusy('Adding paper\u2026')
        setError('')
        call('addSeed', { id: id }).then(function (res) {
          if (res && res.ok === true) {
            setGraph(res.graph)
            setResults(null)
            loadDetail(id)
          } else {
            setError(res && res.error ? res.error : 'Could not add that paper.')
          }
        }, function (err) { setError(errText(err)) }).then(function () { setBusy('') })
      }

      function dropSeed(id) {
        setError('')
        call('removeSeed', { id: id }).then(function (res) {
          if (res && res.ok === true) {
            setGraph(res.graph)
            if (selected === id) { setSelected(null); setDetail(null) }
          }
        }, function (err) { setError(errText(err)) })
      }

      function expand(id, kind) {
        setBusy('Pulling ' + KIND_LABEL[kind].toLowerCase() + '\u2026')
        setError('')
        call('expand', { id: id, kind: kind }).then(function (res) {
          if (res && res.ok === true) {
            setGraph(res.graph)
            if (res.found === 0) setError('OpenAlex records no ' + KIND_LABEL[kind].toLowerCase() + ' for this paper.')
          } else {
            setError(res && res.error ? res.error : 'Expansion failed.')
          }
        }, function (err) { setError(errText(err)) }).then(function () { setBusy('') })
      }

      function expandAll() {
        setBusy('Auto-expanding the collection\u2026')
        setError('')
        call('expandAll', {}).then(function (res) {
          if (res && res.ok === true) {
            setGraph(res.graph)
            if (res.added === 0) setError('Nothing new came back \u2014 this collection is already expanded.')
            else if (res.warning) setError(res.warning)
          } else {
            setError(res && res.error ? res.error : 'Auto-expand failed.')
          }
        }, function (err) { setError(errText(err)) }).then(function () { setBusy('') })
      }

      function clearAll() {
        setError('')
        call('clear', {}).then(function (res) {
          if (res && res.ok === true) {
            setGraph(res.graph)
            setSelected(null)
            setDetail(null)
            setManual({})
            setView({ k: 1, x: 0, y: 0 })
          }
        }, function (err) { setError(errText(err)) })
      }

      function toggleKind(kind) {
        setShowKinds(function (prev) {
          const next = Object.assign({}, prev)
          next[kind] = prev[kind] !== true
          return next
        })
      }

      function unitScale() {
        const element = svgRef.current
        if (element === null || element === undefined || typeof element.getBoundingClientRect !== 'function') return 1
        const rect = element.getBoundingClientRect()
        if (rect === null || rect === undefined || !(rect.width > 0) || !(rect.height > 0)) return 1
        return Math.min(rect.width / BOX_W, rect.height / BOX_H)
      }

      function positionOf(id) {
        if (manual[id] !== undefined) return manual[id]
        if (place[id] !== undefined) return place[id]
        return { x: BOX_W / 2, y: BOX_H / 2 }
      }

      function startNodeDrag(event, id) {
        if (typeof event.stopPropagation === 'function') event.stopPropagation()
        if (typeof event.preventDefault === 'function') event.preventDefault()
        const point = positionOf(id)
        dragRef.current = {
          mode: 'node',
          id: id,
          startX: event.clientX,
          startY: event.clientY,
          baseX: point.x,
          baseY: point.y,
          unit: unitScale(),
          zoom: view.k,
        }
        loadDetail(id)
      }

      function startPan(event) {
        dragRef.current = {
          mode: 'pan',
          startX: event.clientX,
          startY: event.clientY,
          baseX: view.x,
          baseY: view.y,
          unit: unitScale(),
        }
      }

      function onDragMove(event) {
        const drag = dragRef.current
        if (drag === null || drag === undefined) return
        const dx = event.clientX - drag.startX
        const dy = event.clientY - drag.startY
        if (drag.mode === 'node') {
          const scale = drag.unit * drag.zoom
          setManual(function (prev) {
            const next = Object.assign({}, prev)
            next[drag.id] = { x: drag.baseX + dx / scale, y: drag.baseY + dy / scale }
            return next
          })
        } else {
          setView({ k: view.k, x: drag.baseX + dx / drag.unit, y: drag.baseY + dy / drag.unit })
        }
      }

      function endDrag() {
        dragRef.current = null
      }

      function zoomBy(factor) {
        setView(function (prev) {
          const next = Math.max(0.25, Math.min(4, prev.k * factor))
          const ratio = next / prev.k
          return {
            k: next,
            x: BOX_W / 2 - ratio * (BOX_W / 2 - prev.x),
            y: BOX_H / 2 - ratio * (BOX_H / 2 - prev.y),
          }
        })
      }

      const inCollection = {}
      for (let s = 0; s < graph.seeds.length; s++) inCollection[graph.seeds[s]] = true

      const nodeById = {}
      for (let n = 0; n < graph.nodes.length; n++) nodeById[graph.nodes[n].id] = graph.nodes[n]

      let maxCited = 0
      for (let n = 0; n < graph.nodes.length; n++) if (graph.nodes[n].citedBy > maxCited) maxCited = graph.nodes[n].citedBy

      const kindSets = {}
      for (let i = 0; i < graph.links.length; i++) {
        const link = graph.links[i]
        if (kindSets[link.source] === undefined) kindSets[link.source] = {}
        if (kindSets[link.target] === undefined) kindSets[link.target] = {}
        kindSets[link.source][link.kind] = true
        kindSets[link.target][link.kind] = true
      }

      const labelRank = {}
      const byCitations = graph.nodes.slice().sort(function (a, b) { return b.citedBy - a.citedBy })
      for (let i = 0; i < byCitations.length; i++) labelRank[byCitations[i].id] = i

      const adjacent = {}
      if (selected !== null) {
        for (let i = 0; i < graph.links.length; i++) {
          const link = graph.links[i]
          if (link.source === selected) adjacent[link.target] = true
          if (link.target === selected) adjacent[link.source] = true
        }
      }

      function roleOfNode(id) {
        if (inCollection[id] === true) return 'seed'
        const set = kindSets[id]
        if (set === undefined) return 'lonely'
        if (set.references === true) return 'references'
        if (set.citations === true) return 'citations'
        if (set.related === true) return 'related'
        return 'lonely'
      }

      const visibleLinks = graph.links.filter(function (link) { return showKinds[link.kind] !== false })

      const edgeElements = visibleLinks.map(function (link, index) {
        const from = positionOf(link.source)
        const to = positionOf(link.target)
        const faded = selected !== null && link.source !== selected && link.target !== selected
        return React.createElement('line', {
          key: link.kind + ':' + link.source + ':' + link.target + ':' + index,
          className: 'rr-edge rr-edge-' + link.kind,
          x1: from.x,
          y1: from.y,
          x2: to.x,
          y2: to.y,
          vectorEffect: 'non-scaling-stroke',
          style: faded ? { opacity: 0.05 } : undefined,
        })
      })

      const nodeElements = graph.nodes.map(function (node) {
        const point = positionOf(node.id)
        const radius = radiusOf(node.citedBy, maxCited)
        const isSelected = selected === node.id
        const isHovered = hovered === node.id
        const isSeed = node.seed === true
        const role = roleOfNode(node.id)
        const share = maxCited > 0 ? Math.sqrt(node.citedBy / maxCited) : 0
        const faded = selected !== null && !isSelected && adjacent[node.id] !== true
        let stroke = ROLE_STROKE[role]
        if (isSeed) stroke = 'transparent'
        else if (isSelected) stroke = 'var(--dsw-alias-label-primary)'
        else if (isHovered) stroke = 'var(--dsw-alias-label-secondary)'
        const className = ['rr-node']
          .concat(isSeed ? ['rr-node-seed'] : [])
          .concat(isHovered ? ['rr-node-hover'] : [])
          .concat(isSelected ? ['rr-node-selected'] : [])
          .join(' ')
        const children = [
          React.createElement('circle', {
            key: 'dot',
            className: className,
            cx: point.x,
            cy: point.y,
            r: radius,
            style: {
              stroke: stroke,
              strokeWidth: isSelected ? 2.4 : 1.2,
              opacity: faded ? 0.15 : 0.55 + 0.45 * share,
            },
          }),
        ]
        const showLabel = isSeed || isSelected || isHovered || view.k >= 1.8 || labelRank[node.id] < 18
        if (showLabel) {
          children.push(React.createElement('text', {
            key: 'label',
            className: 'rr-label',
            x: point.x,
            y: point.y + radius + 11,
            textAnchor: 'middle',
            style: faded ? { opacity: 0.25 } : undefined,
          }, shorten(node.title, 26)))
        }
        return React.createElement('g', {
          key: node.id,
          onMouseDown: function (event) { startNodeDrag(event, node.id) },
          onMouseEnter: function () { setHovered(node.id) },
          onMouseLeave: function () { setHovered(null) },
        }, children)
      })

      const resultRows = results === null ? null : results.map(function (paper) {
        const added = inCollection[paper.id] === true
        return React.createElement('div', { className: 'rr-result', key: paper.id },
          React.createElement('div', { className: 'rr-result-main' },
            React.createElement('div', { className: 'rr-result-title' }, paper.title),
            React.createElement('div', { className: 'rr-result-meta' }, metaLine(paper)),
          ),
          React.createElement('button', {
            className: 'rr-btn rr-btn-small',
            disabled: added || busy !== '',
            onClick: function () { addPaper(paper.id) },
          }, added ? 'In collection' : 'Add'),
        )
      })

      const seedRows = graph.seeds.map(function (id) {
        const node = nodeById[id]
        return React.createElement('div', {
          className: 'rr-seed' + (selected === id ? ' rr-seed-on' : ''),
          key: id,
          onClick: function () { loadDetail(id) },
        },
          React.createElement('div', { className: 'rr-result-main' },
            React.createElement('div', { className: 'rr-seed-title' }, node ? node.title : id),
            React.createElement('div', { className: 'rr-seed-meta' }, node ? metaLine(node) : id),
          ),
          React.createElement('button', {
            className: 'rr-x',
            title: 'Remove from collection',
            onClick: function (event) { event.stopPropagation(); dropSeed(id) },
          }, '\u00d7'),
        )
      })

      let detailBody
      if (selected === null) {
        detailBody = React.createElement('div', { className: 'rr-hint' },
          'Select a paper in the graph to read its abstract and authors, or press a paper to pull in the work around it.')
      } else if (loadingDetail) {
        detailBody = React.createElement('div', { className: 'rr-hint' }, 'Loading paper\u2026')
      } else {
        const node = nodeById[selected]
        const paper = detail
        const title = paper ? paper.title : node ? node.title : selected
        const year = paper ? paper.year : node ? node.year : 0
        const citedBy = paper ? paper.citedBy : node ? node.citedBy : 0
        const venue = paper ? paper.venue : node ? node.venue : null
        const doi = paper ? paper.doi : node ? node.doi : null
        const authors = paper && Array.isArray(paper.authors) ? paper.authors : []
        const shownAuthors = authors.length > 8
          ? authors.slice(0, 8).join(', ') + ' et al.'
          : authors.join(', ')
        const isSeed = inCollection[selected] === true
        detailBody = React.createElement('div', null,
          React.createElement('h2', null, title, isSeed ? React.createElement('span', { className: 'rr-badge' }, 'in collection') : null),
          React.createElement('div', { className: 'rr-detail-meta' },
            [venue, year > 0 ? String(year) : null, citedBy + ' citations'].filter(Boolean).join(' \u00b7 ')),
          shownAuthors.length > 0 ? React.createElement('div', { className: 'rr-authors' }, shownAuthors) : null,
          React.createElement('div', { className: 'rr-actions' },
            isSeed
              ? React.createElement('button', { className: 'rr-btn rr-btn-small', onClick: function () { dropSeed(selected) } }, 'Remove from collection')
              : React.createElement('button', { className: 'rr-btn rr-btn-small', disabled: busy !== '', onClick: function () { addPaper(selected) } }, 'Add to collection'),
          ),
          React.createElement('div', { className: 'rr-actions' },
            React.createElement('button', { className: 'rr-btn rr-btn-small', disabled: busy !== '', onClick: function () { expand(selected, 'references') } }, 'References'),
            React.createElement('button', { className: 'rr-btn rr-btn-small', disabled: busy !== '', onClick: function () { expand(selected, 'citations') } }, 'Cited by'),
            React.createElement('button', { className: 'rr-btn rr-btn-small', disabled: busy !== '', onClick: function () { expand(selected, 'related') } }, 'Similar'),
          ),
          paper && paper.referenceCount !== undefined
            ? React.createElement('div', { className: 'rr-detail-meta' }, paper.referenceCount + ' references \u00b7 ' + paper.relatedCount + ' similar works on OpenAlex')
            : null,
          doi ? React.createElement('a', { className: 'rr-link', href: doi, target: '_blank', rel: 'noreferrer noopener' }, 'Publisher DOI') : null,
          React.createElement('a', {
            className: 'rr-link',
            href: paper && paper.url ? paper.url : 'https://openalex.org/' + selected,
            target: '_blank',
            rel: 'noreferrer noopener',
          }, 'OpenAlex record'),
          paper && paper.abstract
            ? React.createElement('p', { className: 'rr-abstract' }, paper.abstract)
            : React.createElement('div', { className: 'rr-hint' }, 'OpenAlex holds no abstract for this record.'),
        )
      }

      const hoveredNode = hovered !== null && nodeById[hovered] !== undefined ? nodeById[hovered] : null

      return React.createElement('div', { className: 'rr-root' },
        React.createElement('aside', { className: 'rr-side' },
          React.createElement('div', { className: 'rr-head' },
            React.createElement('span', { className: 'rr-title' }, 'Research Cat'),
            React.createElement('span', { className: 'rr-sub' }, 'Citation graph explorer \u00b7 OpenAlex'),
          ),
          React.createElement('div', { className: 'rr-search' },
            React.createElement('input', {
              className: 'rr-input',
              value: query,
              placeholder: 'Title, author, topic or DOI\u2026',
              spellCheck: false,
              onChange: function (event) { setQuery(event.target.value) },
              onKeyDown: function (event) { if (event.key === 'Enter') runSearch() },
            }),
            React.createElement('button', {
              className: 'rr-btn rr-btn-primary',
              disabled: busy !== '',
              onClick: function () { runSearch() },
            }, 'Search'),
          ),
          error ? React.createElement('div', { className: 'rr-error' }, error) : null,
          React.createElement('div', { className: 'rr-scroll' },
            resultRows === null ? null : React.createElement('div', { className: 'rr-section' },
              React.createElement('div', { className: 'rr-section-title' },
                React.createElement('span', null, 'Results \u00b7 ' + shorten(resultsFor, 26)),
                React.createElement('button', { className: 'rr-x', onClick: function () { setResults(null) } }, '\u00d7'),
              ),
              resultRows.length === 0
                ? React.createElement('div', { className: 'rr-hint' }, 'No matching work found.')
                : resultRows,
            ),
            React.createElement('div', { className: 'rr-section' },
              React.createElement('div', { className: 'rr-section-title' },
                React.createElement('span', null, 'Collection \u00b7 ' + graph.seeds.length),
              ),
              seedRows.length === 0
                ? React.createElement('div', { className: 'rr-hint' }, 'Empty. Search above, or paste a DOI.')
                : seedRows,
            ),
          ),
        ),
        React.createElement('section', { className: 'rr-main' },
          React.createElement('div', { className: 'rr-toolbar' },
            React.createElement('span', { className: 'rr-stats' },
              graph.nodes.length + ' papers \u00b7 ' + graph.links.length + ' links'),
            ['references', 'citations', 'related'].map(function (kind) {
              return React.createElement('button', {
                key: kind,
                className: 'rr-toggle' + (showKinds[kind] === true ? ' rr-toggle-on' : ''),
                onClick: function () { toggleKind(kind) },
              }, KIND_LABEL[kind])
            }),
            React.createElement('button', {
              className: 'rr-btn rr-btn-small',
              disabled: busy !== '' || graph.seeds.length === 0,
              title: 'Pull references and similar work for every paper in the collection',
              onClick: expandAll,
            }, 'Auto-expand'),
            React.createElement('button', {
              className: 'rr-btn rr-btn-small',
              onClick: function () { setSpin(spin + 1) },
            }, 'Re-layout'),
            React.createElement('button', {
              className: 'rr-btn rr-btn-small',
              disabled: graph.nodes.length === 0,
              onClick: clearAll,
            }, 'Clear'),
          ),
          React.createElement('div', { className: 'rr-canvas' },
            React.createElement('svg', {
              className: 'rr-svg',
              ref: svgRef,
              viewBox: '0 0 ' + BOX_W + ' ' + BOX_H,
              preserveAspectRatio: 'xMidYMid meet',
              onMouseDown: startPan,
              onMouseMove: onDragMove,
              onMouseUp: endDrag,
              onMouseLeave: endDrag,
            },
              React.createElement('g', {
                transform: 'translate(' + view.x + ',' + view.y + ') scale(' + view.k + ')',
              }, edgeElements.concat(nodeElements)),
            ),
            graph.nodes.length === 0 ? React.createElement('div', { className: 'rr-empty' },
              React.createElement('div', { className: 'rr-empty-title' }, 'Build a citation graph'),
              React.createElement('div', { className: 'rr-empty-text' },
                'Search for a paper to start a collection, then pull in what it cites, what cites it, and the work OpenAlex considers similar. Try one of these:'),
              React.createElement('div', { className: 'rr-chips' }, EXAMPLES.map(function (example) {
                return React.createElement('button', {
                  key: example,
                  className: 'rr-chip',
                  onClick: function () { setQuery(example); runSearch(example) },
                }, example)
              })),
            ) : null,
            busy !== '' ? React.createElement('div', { className: 'rr-busy' }, busy) : null,
            graph.nodes.length > 0 ? React.createElement('div', { className: 'rr-legend' },
              React.createElement('div', { className: 'rr-legend-row' },
                React.createElement('span', { className: 'rr-swatch-dot', style: { background: 'var(--dsw-alias-brand-primary)' } }),
                'collection seed'),
              React.createElement('div', { className: 'rr-legend-row' },
                React.createElement('span', { className: 'rr-swatch', style: { background: 'var(--dsw-alias-brand-primary)' } }),
                'cites'),
              React.createElement('div', { className: 'rr-legend-row' },
                React.createElement('span', { className: 'rr-swatch', style: { background: 'var(--dsw-alias-state-warn-primary)' } }),
                'cited by'),
              React.createElement('div', { className: 'rr-legend-row' },
                React.createElement('span', { className: 'rr-swatch', style: { background: 'var(--dsw-alias-label-tertiary)' } }),
                'similar'),
              React.createElement('div', { className: 'rr-legend-note' }, 'node size & brightness = citations'),
            ) : null,
            React.createElement('div', { className: 'rr-zoom' },
              React.createElement('button', { className: 'rr-btn rr-btn-small', onClick: function () { zoomBy(1.25) } }, '+'),
              React.createElement('button', { className: 'rr-btn rr-btn-small', onClick: function () { zoomBy(0.8) } }, '\u2212'),
              React.createElement('button', {
                className: 'rr-btn rr-btn-small',
                onClick: function () { setView({ k: 1, x: 0, y: 0 }) },
              }, 'Fit'),
            ),
            hoveredNode !== null ? React.createElement('div', { className: 'rr-hud' },
              hoveredNode.title + ' \u00b7 ' + metaLine(hoveredNode)) : null,
          ),
        ),
        React.createElement('aside', { className: 'rr-detail' }, detailBody),
      )
    }

    function RunCard() {
      return React.createElement('div', { className: 'rr-card' },
        React.createElement('div', { className: 'rr-card-head' },
          React.createElement('strong', null, 'Research Cat'),
          React.createElement('span', { className: 'rr-sub' }, 'citation graph explorer'),
          layoutService === undefined ? null : React.createElement('button', {
            className: 'rr-btn rr-btn-small',
            onClick: function () { layoutService.selectPanel(PANEL_KEY) },
          }, 'Open in sidebar'),
        ),
        React.createElement('div', { className: 'rr-card-body' },
          React.createElement(ResearchCatPanel, null),
        ),
      )
    }

    ctx.effect(function () {
      return slots.inject('sidebar.panellist', function () {
        return slots.register({ name: 'sidebar.panellist', id: PANEL_KEY, order: 20, label: 'Research Cat' }, PanelIcon)
      })
    }, 'research-cat/sidebar')

    ctx.effect(function () {
      return slots.inject('main', function () {
        return slots.register({ name: 'main', key: PANEL_KEY }, ResearchCatPanel)
      })
    }, 'research-cat/main')

    ctx.effect(function () {
      return slots.inject('tool.view.cordis', function () {
        return slots.register({ name: 'tool.view.cordis', key: 'self' }, RunCard)
      })
    }, 'research-cat/card')
  },
}
