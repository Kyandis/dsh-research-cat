/**
 * dsh-research-cat, browser half.
 *
 * Loaded by the web GUI as a Loader module: `react` comes from the shell's
 * `require`, the host is reached over the same-origin /dsh-research-cat routes
 * with plain `fetch`, and the two surfaces (sidebar entry + centre-column
 * panel) are registered into real slots.
 *
 * The graph view has two deterministic layouts:
 *  - radial: a hub in the middle, one radius band per BFS layer, angular
 *    sectors per relationship role, ring-capacity spacing and a minimum spoke
 *    angle (unchanged from the validated baseline);
 *  - timeline: x follows publication year (older -> newer), y follows citation
 *    count (more citations -> higher on screen), with a separate
 *    "year unknown" band for records whose year is missing.
 *
 * The library surface (collections + subcollections, Recently Found, notes /
 * tags / colour, BibTeX export) reads the host's persisted library through the
 * same envelope; every failure lands in the panel's error bar.
 *
 * This file is intentionally plain (no JSX, no bundler): the Loader contract
 * only needs a single script calling `window.__ModuleLoader__.load`. The
 * `@parity:` comment markers below delimit self-contained pure functions that
 * the offline test suite extracts and evaluates directly, so the shipped code
 * is what gets asserted.
 */

window.__ModuleLoader__.load({
  id: 'dsh-research-cat',
  factory: (require) => {
    var module = { exports: {} }
    var exports = module.exports
    Object.defineProperty(exports, Symbol.toStringTag, { value: 'Module' })

    const React = require('react')

    /** Host route prefix registered by src/routes.js. */
    const ROUTE = '/dsh-research-cat'
    /** Sidebar entry id == main-panel key. */
    const PANEL_KEY = 'research-cat'
    const BOX_W = 1200
    const BOX_H = 800
    const EMPTY_GRAPH = { seeds: [], nodes: [], links: [] }
    const EMPTY_LIBRARY = { collections: [], recentlyFound: [], annotations: {}, storePath: '', storeError: '' }
    const KIND_LABEL = {
      references: 'References',
      citations: 'Cited by',
      related: 'Similar',
      earlier: 'Earlier work',
      later: 'Later work',
      author: 'By author',
    }
    const KIND_ORDER = ['references', 'citations', 'related', 'earlier', 'later', 'author']
    const ROLE_STROKE = {
      seed: 'transparent',
      references: 'var(--dsw-alias-brand-primary)',
      citations: 'var(--dsw-alias-state-warn-primary)',
      related: 'var(--dsw-alias-label-tertiary)',
      earlier: 'var(--dsw-alias-label-secondary)',
      later: 'var(--dsw-alias-state-error-primary)',
      author: 'var(--dsw-alias-label-primary)',
      lonely: 'var(--dsw-alias-border-l2)',
    }
    /** Line style per relationship kind, so all six axes stay distinguishable. */
    const EDGE_DASH = {
      references: undefined,
      citations: undefined,
      related: '4 5',
      earlier: '2 3',
      later: '9 4',
      author: '1 3',
    }
    /** Frozen annotation colour enum (spec AC-B4-4); values are the host ids. */
    const COLOR_CHOICES = [
      { id: 'red', hex: '#e5484d' },
      { id: 'orange', hex: '#f76b15' },
      { id: 'yellow', hex: '#ffb224' },
      { id: 'green', hex: '#30a46c' },
      { id: 'blue', hex: '#0091ff' },
      { id: 'purple', hex: '#8e4ec6' },
      { id: 'gray', hex: '#8b8d98' },
    ]
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
      '.rr-section-title{font-size:10.5px;text-transform:uppercase;letter-spacing:.7px;color:var(--dsw-alias-label-tertiary);margin-bottom:6px;display:flex;justify-content:space-between;align-items:center;gap:6px}',
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
      '.rr-edge-earlier{stroke:var(--dsw-alias-label-secondary);stroke-width:1;opacity:.34}',
      '.rr-edge-later{stroke:var(--dsw-alias-state-error-primary);stroke-width:1.1;opacity:.34}',
      '.rr-edge-author{stroke:var(--dsw-alias-label-primary);stroke-width:1.1;opacity:.4}',
      '.rr-node{fill:var(--dsw-alias-bg-layer-3);stroke:var(--dsw-alias-border-l2);stroke-width:1.2;cursor:pointer}',
      '.rr-node-seed{fill:var(--dsw-alias-brand-primary);stroke:transparent}',
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
      /* -------------------------------------------------- library / timeline */
      '.rr-tabs{display:flex;gap:4px;padding:0 13px 9px}',
      '.rr-tab{flex:1 1 auto;height:26px;border-radius:999px;border:1px solid var(--dsw-alias-border-l2);background:transparent;color:var(--dsw-alias-label-tertiary);font:inherit;font-size:11.5px;cursor:pointer}',
      '.rr-tab-on{color:var(--dsw-alias-label-primary);border-color:var(--dsw-alias-brand-primary);background:var(--dsw-alias-interactive-bg-active)}',
      '.rr-warnbar{margin:0 13px 8px;padding:7px 9px;border-radius:7px;font-size:11.5px;color:var(--dsw-alias-state-warn-primary);border:1px solid var(--dsw-alias-state-warn-primary)}',
      '.rr-tree{display:flex;flex-direction:column;gap:1px}',
      '.rr-tree-row{display:flex;align-items:center;gap:5px;padding:4px 6px;border-radius:6px;cursor:pointer}',
      '.rr-tree-row:hover{background:var(--dsw-alias-interactive-bg-hover)}',
      '.rr-tree-row-on{background:var(--dsw-alias-interactive-bg-active)}',
      '.rr-tree-caret{width:14px;flex:0 0 14px;border:none;background:transparent;color:var(--dsw-alias-label-tertiary);cursor:pointer;font-size:10px;padding:0;line-height:1}',
      '.rr-tree-name{flex:1 1 auto;min-width:0;font-size:12.5px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
      '.rr-tree-count{font-size:10.5px;color:var(--dsw-alias-label-tertiary);flex:0 0 auto}',
      '.rr-tree-acts{display:flex;gap:2px;flex:0 0 auto}',
      '.rr-recent{display:flex;align-items:center;gap:6px;padding:4px 6px;border-radius:6px}',
      '.rr-recent:hover{background:var(--dsw-alias-interactive-bg-hover)}',
      '.rr-recent-title{flex:1 1 auto;min-width:0;font-size:12px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;cursor:pointer}',
      '.rr-filter{display:flex;flex-direction:column;gap:6px;padding:8px 9px;margin:0 0 8px;border:1px solid var(--dsw-alias-border-l1);border-radius:8px;background:var(--dsw-alias-bg-layer-2)}',
      '.rr-filter-row{display:flex;align-items:center;gap:6px}',
      '.rr-filter-label{flex:0 0 70px;font-size:11px;color:var(--dsw-alias-label-tertiary)}',
      '.rr-filter-input{flex:1 1 auto;min-width:0;height:26px;padding:0 7px;border-radius:6px;border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-1);color:inherit;font:inherit;font-size:11.5px;outline:none}',
      '.rr-filter-input:focus{border-color:var(--dsw-alias-brand-primary)}',
      '.rr-filter-check{display:flex;align-items:center;gap:5px;font-size:11.5px;color:var(--dsw-alias-label-secondary)}',
      '.rr-note{display:flex;flex-direction:column;gap:6px;margin-top:10px;padding-top:9px;border-top:1px solid var(--dsw-alias-border-l1)}',
      '.rr-note-input{width:100%;min-height:62px;padding:7px 8px;border-radius:7px;border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-2);color:inherit;font:inherit;font-size:12px;resize:vertical;outline:none}',
      '.rr-note-input:focus{border-color:var(--dsw-alias-brand-primary)}',
      '.rr-tags{display:flex;flex-wrap:wrap;gap:4px}',
      '.rr-tag{font-size:10.5px;padding:1px 7px;border-radius:999px;border:1px solid var(--dsw-alias-border-l2);color:var(--dsw-alias-label-secondary)}',
      '.rr-color-row{display:flex;align-items:center;gap:5px;flex-wrap:wrap}',
      '.rr-color-dot{width:15px;height:15px;border-radius:50%;border:2px solid transparent;cursor:pointer;padding:0}',
      '.rr-color-on{border-color:var(--dsw-alias-label-primary)}',
      '.rr-timeline-axis{pointer-events:none}',
      '.rr-tick{stroke:var(--dsw-alias-border-l1);stroke-width:1}',
      '.rr-tick-label{fill:var(--dsw-alias-label-tertiary);font-size:10px}',
      '.rr-band{fill:var(--dsw-alias-bg-layer-2);stroke:var(--dsw-alias-border-l1);stroke-width:1}',
      '.rr-export-row{display:flex;flex-wrap:wrap;gap:6px;margin-top:8px}',
      '.rr-save{height:24px;max-width:150px;border-radius:6px;border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-secondary);font:inherit;font-size:10.5px}',
      '.rr-dot{width:8px;height:8px;border-radius:50%;flex:0 0 auto;display:inline-block}',
      '.rr-inline-input{height:24px;flex:1 1 auto;min-width:0;padding:0 6px;border-radius:6px;border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-1);color:inherit;font:inherit;font-size:11.5px;outline:none}',
      '.rr-author{font:inherit;font-size:12px;padding:0;margin:0 4px 2px 0;border:none;background:transparent;color:var(--dsw-alias-brand-primary);cursor:pointer}',
      '.rr-author:hover{text-decoration:underline}',
      '.rr-export-text{width:100%;min-height:110px;margin-top:6px;padding:7px 8px;border-radius:7px;border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-2);color:inherit;font:inherit;font-size:11px;resize:vertical}',
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
      bits.push((isNum(paper.citedBy) ? paper.citedBy : 0) + ' citations')
      return bits.join(' \u00b7 ')
    }

    function isNum(value) {
      return typeof value === 'number' && isFinite(value)
    }

    /* @parity:computeRadialLayout:start */
    /* @parity:radiusOf:start */
    /**
     * Node radius in layout units: square-root scaled by the citation share, so
     * the biggest paper in the graph gets r = 19 and an uncited one r = 4. The
     * overlap assertions read this shipped function directly.
     */
    function radiusOf(citedBy, maxCited) {
      const top = maxCited > 0 ? maxCited : 1
      const share = citedBy > 0 ? citedBy / top : 0
      return 4 + 15 * Math.sqrt(share > 1 ? 1 : share)
    }
    /* @parity:radiusOf:end */

    /**
     * Radial layout: hub in the middle, one radius band per BFS layer, angular
     * sectors per relationship role.
     *
     * t11 (overlap fix). The baseline clamped two things: every ring radius was
     * clamped to `maxRadius = min(CX, CY) - 26` (= 374 in the 1200x800 box) and
     * every final coordinate was clamped into the box. Once the capacity of the
     * clamped ring was exhausted, further rings were placed at the *same* radius
     * (and points outside the box were pinned to the border), so nodes piled up:
     * measured worst margins of -31.9 at 120 nodes and -37.2 at 260 nodes, and
     * still 107/277 overlapping pairs at 500/1000 nodes.
     *
     * The fix: rings now keep growing outward (no radius clamp) and coordinates
     * are no longer clamped into the box; instead the ring capacity uses the
     * real node size — `spacing = max(minSpacing, 2 * biggestNodeRadius + 4)` —
     * so a ring never packs two circles closer than their radii sum. The SVG
     * viewBox follows the resulting extent via `layoutExtent()` (the layout is
     * still centred, `preserveAspectRatio` keeps the aspect), so a bigger graph
     * is simply displayed smaller and stays fully visible/zoomable.
     *
     * Byte-identity is preserved for every input whose outer ring stayed inside
     * the old clamp radius and whose node radii already fit `minSpacing`
     * (minSpacing is 46 for <= 80 nodes and 38 for <= 150, and the biggest
     * possible 2r + 4 is 42) — e.g. single-seed graphs, no-seed graphs with a
     * small ring, and the 5-node snapshot. Inputs that did reach the clamp
     * (medium multi-level graphs, multi-seed and large graphs) change on
     * purpose; their frozen digests are updated in test/client.mjs and
     * lab/client-check.mjs.
     */
    function computeRadialLayout(nodeList, linkList, spin, box) {
      const place = {}
      const count = nodeList.length
      if (count === 0) return place
      const BW = box !== null && box !== undefined && box.w > 0 ? box.w : 1200
      const BH = box !== null && box !== undefined && box.h > 0 ? box.h : 800
      const CX = BW / 2
      const CY = BH / 2

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
        if (set.earlier === true) return 'earlier'
        if (set.later === true) return 'later'
        if (set.author === true) return 'author'
        return 'lonely'
      }
      /* t10 fix: 'seed' has to be a group of its own. In 9a1bd7d `roleOf`
       * returned 'seed' but ORDER did not list it, so a seed that was not the
       * hub (BFS level >= 1) was skipped by the group loop below and fell back
       * to the canvas centre in positionOf — with several seeds (A2, up to 50)
       * they all stacked on that one point. Listing 'seed' first gives every
       * seed a real sector. The layout arithmetic itself is untouched, so an
       * input in which the quirk cannot trigger (no seeds, or the only seed is
       * the hub) stays byte-identical to 9a1bd7d; multi-seed input changes on
       * purpose (see lab/client-check.mjs and test/client.mjs for the frozen
       * digests and the relaxed AC-A6-7 criterion). */
      const ORDER = ['seed', 'references', 'citations', 'related', 'earlier', 'later', 'author', 'lonely']

      const minSpacing = count > 150 ? 30 : count > 80 ? 38 : 46
      const ringGap = minSpacing + 30
      /* t11: no radius clamp any more — rings grow outward instead of stacking
       * on the old `maxRadius` circle. Node size comes from radiusOf(), so the
       * biggest possible diameter is 2 * 19 = 38; RADIUS_PAD keeps the chord a
       * little above the radii sum (a chord of a ring is slightly shorter than
       * its arc). */
      const RADIUS_PAD = 4
      let biggestCited = 0
      for (let i = 0; i < count; i++) if (nodeList[i].citedBy > biggestCited) biggestCited = nodeList[i].citedBy
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
            /* Ring spacing must clear the biggest circle still to be placed in
             * this group; when the radii already fit minSpacing (<= 150 nodes)
             * this is exactly the baseline value, which is what keeps those
             * layouts byte-identical. */
            let need = minSpacing
            for (let q = placed; q < members.length; q++) {
              const wanted = 2 * radiusOf(byId[members[q]].citedBy, biggestCited) + RADIUS_PAD
              if (wanted > need) need = wanted
            }
            let capacity = Math.floor((arc * radius) / need)
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
        /* t11: no box clamp — a layout that outgrew the 1200x800 frame used to
         * have its outer points pinned onto the border, which stacked them.
         * layoutExtent() sizes the SVG viewBox to the real extent instead. */
        if (!isFinite(point.x) || !isFinite(point.y)) { point.x = CX; point.y = CY }
      }
      return place
    }
    /* @parity:computeRadialLayout:end */

    /* @parity:layoutExtent:start */
    /**
     * Bounding box (layout units) covering every placed point plus `pad`.
     * The 1200x800 baseline frame is returned whenever the layout fits inside
     * it, so small graphs are framed exactly as before; a layout that outgrew
     * the frame grows symmetrically around the layout centre, which is what the
     * panel hands to the SVG viewBox (preserveAspectRatio keeps the aspect, so
     * a bigger graph simply renders smaller and stays fully visible).
     */
    function layoutExtent(place, pad) {
      const ids = Object.keys(place)
      if (ids.length === 0) return { x: 0, y: 0, w: 1200, h: 800 }
      let minX = Infinity
      let maxX = -Infinity
      let minY = Infinity
      let maxY = -Infinity
      for (let i = 0; i < ids.length; i++) {
        const point = place[ids[i]]
        if (!isFinite(point.x) || !isFinite(point.y)) continue
        if (point.x < minX) minX = point.x
        if (point.x > maxX) maxX = point.x
        if (point.y < minY) minY = point.y
        if (point.y > maxY) maxY = point.y
      }
      if (!isFinite(minX) || !isFinite(minY)) return { x: 0, y: 0, w: 1200, h: 800 }
      const safePad = typeof pad === 'number' && isFinite(pad) && pad > 0 ? pad : 0
      const cx = 600
      const cy = 400
      const halfW = Math.max(600, Math.max(Math.abs(minX - cx), Math.abs(maxX - cx)) + safePad)
      const halfH = Math.max(400, Math.max(Math.abs(minY - cy), Math.abs(maxY - cy)) + safePad)
      return { x: cx - halfW, y: cy - halfH, w: halfW * 2, h: halfH * 2 }
    }
    /* @parity:layoutExtent:end */

    /* @parity:computeTimelineLayout:start */
    /**
     * Timeline layout (spec AC-A6-2/3/5):
     *  - x: publication year, older -> newer, left -> right. All records of one
     *    year share the same x, so x is non-decreasing for any year-ordered
     *    listing; dated records start after the "year unknown" band.
     *  - y: citation count, monotone non-increasing in citedBy (more citations
     *    -> higher on screen, i.e. smaller y), square-root scaled.
     *  - year === 0 records are NOT dropped: they go into a dedicated band on
     *    the far left. Their x advances only in input order (so x stays
     *    non-decreasing for any year-ordered listing) and stays left of every
     *    dated x; their y still follows citations, so the y rule below holds
     *    for every node. Overlap inside the band is accepted and documented.
     * Self-contained on purpose: the offline parity suite extracts this block.
     */
    function computeTimelineLayout(nodeList, linkList, box) {
      const place = {}
      const nodes = Array.isArray(nodeList) ? nodeList : []
      const width = box !== null && box !== undefined && box.w > 0 ? box.w : 1200
      const height = box !== null && box !== undefined && box.h > 0 ? box.h : 800
      if (nodes.length === 0) return place

      const PAD = 46
      const TOP = 34
      const BOTTOM = 54
      const UNKNOWN_W = 104
      const plotLeft = PAD + UNKNOWN_W
      const plotRight = width - PAD
      const plotTop = TOP
      const plotBottom = height - BOTTOM

      const dated = []
      const unknown = []
      for (let i = 0; i < nodes.length; i++) {
        const node = nodes[i]
        if (node === null || node === undefined || typeof node.id !== 'string') continue
        const rawYear = typeof node.year === 'number' && isFinite(node.year) ? node.year : 0
        const rawCited = typeof node.citedBy === 'number' && isFinite(node.citedBy) ? node.citedBy : 0
        const year = rawYear > 0 ? rawYear : 0
        const citedBy = rawCited > 0 ? rawCited : 0
        if (year > 0) dated.push({ id: node.id, year: year, citedBy: citedBy })
        else unknown.push({ id: node.id, year: 0, citedBy: citedBy })
      }

      let maxCited = 0
      for (let i = 0; i < dated.length; i++) if (dated[i].citedBy > maxCited) maxCited = dated[i].citedBy
      for (let i = 0; i < unknown.length; i++) if (unknown[i].citedBy > maxCited) maxCited = unknown[i].citedBy

      function byCitations(a, b) {
        if (a.citedBy !== b.citedBy) return b.citedBy - a.citedBy
        return a.id < b.id ? -1 : a.id > b.id ? 1 : 0
      }
      function yOf(citedBy) {
        const share = maxCited > 0 ? Math.sqrt(citedBy / maxCited) : 0
        return plotTop + (1 - share) * (plotBottom - plotTop)
      }

      /* Band order is the input order: x must not decrease for any listing
       * that keeps year-0 records in their original relative order. */
      const rowStep = 26
      const colStep = 24
      const rows = Math.max(1, Math.floor((plotBottom - plotTop) / rowStep))
      const cols = Math.max(1, Math.floor((UNKNOWN_W - 8) / colStep))
      for (let i = 0; i < unknown.length; i++) {
        const col = Math.min(Math.floor(i / rows), cols - 1)
        place[unknown[i].id] = { x: PAD + 8 + col * colStep, y: yOf(unknown[i].citedBy) }
      }

      dated.sort(function (a, b) {
        if (a.year !== b.year) return a.year - b.year
        return byCitations(a, b)
      })
      let minYear = 0
      let maxYear = 0
      for (let i = 0; i < dated.length; i++) {
        if (minYear === 0 || dated[i].year < minYear) minYear = dated[i].year
        if (dated[i].year > maxYear) maxYear = dated[i].year
      }
      const span = maxYear > minYear ? maxYear - minYear : 0
      const usable = Math.max(60, plotRight - plotLeft)
      const yearGap = span > 0 ? usable / span : 0
      for (let i = 0; i < dated.length; i++) {
        const baseX = span > 0 ? plotLeft + (dated[i].year - minYear) * yearGap : (plotLeft + plotRight) / 2
        place[dated[i].id] = {
          x: Math.max(plotLeft, Math.min(plotRight, baseX)),
          y: yOf(dated[i].citedBy),
        }
      }
      return place
    }
    /* @parity:computeTimelineLayout:end */

    /* @parity:timelineTicks:start */
    /**
     * Axis data for the timeline view (spec AC-A6-4): x ticks carry the year
     * plus the same x the layout gives that year, y ticks carry a citation
     * value plus its y. Self-contained (the geometry literals mirror
     * computeTimelineLayout; the offline suite asserts they agree).
     */
    function timelineTicks(nodeList, box) {
      const nodes = Array.isArray(nodeList) ? nodeList : []
      const width = box !== null && box !== undefined && box.w > 0 ? box.w : 1200
      const height = box !== null && box !== undefined && box.h > 0 ? box.h : 800
      const PAD = 46
      const TOP = 34
      const BOTTOM = 54
      const UNKNOWN_W = 104
      const plotLeft = PAD + UNKNOWN_W
      const plotRight = width - PAD
      const plotTop = TOP
      const plotBottom = height - BOTTOM

      let minYear = 0
      let maxYear = 0
      let maxCited = 0
      let hasUnknown = false
      for (let i = 0; i < nodes.length; i++) {
        const node = nodes[i]
        if (node === null || node === undefined) continue
        const rawYear = typeof node.year === 'number' && isFinite(node.year) ? node.year : 0
        const rawCited = typeof node.citedBy === 'number' && isFinite(node.citedBy) ? node.citedBy : 0
        const year = rawYear > 0 ? rawYear : 0
        const citedBy = rawCited > 0 ? rawCited : 0
        if (year > 0) {
          if (minYear === 0 || year < minYear) minYear = year
          if (year > maxYear) maxYear = year
        } else hasUnknown = true
        if (citedBy > maxCited) maxCited = citedBy
      }

      const years = []
      if (minYear > 0) {
        const span = maxYear > minYear ? maxYear - minYear : 0
        const usable = Math.max(60, plotRight - plotLeft)
        const yearGap = span > 0 ? usable / span : 0
        const picks = [minYear]
        if (span >= 4) {
          picks.push(minYear + Math.round(span / 4))
          picks.push(minYear + Math.round(span / 2))
          picks.push(minYear + Math.round((3 * span) / 4))
        } else {
          for (let y = minYear + 1; y < maxYear; y++) picks.push(y)
        }
        picks.push(maxYear)
        for (let i = 0; i < picks.length; i++) {
          if (i > 0 && picks[i] === picks[i - 1]) continue
          const year = picks[i]
          years.push({
            year: year,
            x: Math.max(plotLeft, Math.min(plotRight, span > 0 ? plotLeft + (year - minYear) * yearGap : (plotLeft + plotRight) / 2)),
          })
        }
      }

      const citations = []
      if (maxCited > 0) {
        for (let i = 0; i <= 4; i++) {
          const value = Math.round((maxCited * i) / 4)
          if (citations.length > 0 && citations[citations.length - 1].value === value) continue
          const y = plotTop + (1 - Math.sqrt(value / maxCited)) * (plotBottom - plotTop)
          citations.push({ value: value, y: y })
        }
      }

      return {
        years: years,
        citations: citations,
        hasUnknown: hasUnknown,
        minYear: minYear,
        maxYear: maxYear,
        maxCited: maxCited,
        band: { x: PAD, width: UNKNOWN_W },
      }
    }
    /* @parity:timelineTicks:end */

    /* @parity:buildCollectionTree:start */
    /**
     * Flat collection list -> forest (spec AC-B2-1/2/9). Missing parents are
     * promoted to roots, cycles are broken by promoting the first unreachable
     * node in input order, duplicates and malformed entries are dropped, and
     * input order is preserved everywhere (deterministic). Self-contained on
     * purpose: the offline parity suite extracts this block.
     */
    function buildCollectionTree(collections) {
      const list = Array.isArray(collections) ? collections : []
      const nodes = []
      const byId = {}
      const children = {}
      for (let i = 0; i < list.length; i++) {
        const raw = list[i]
        if (raw === null || raw === undefined || typeof raw !== 'object') continue
        const id = typeof raw.id === 'string' ? raw.id : ''
        if (id.length === 0 || byId[id] !== undefined) continue
        const node = {
          id: id,
          name: typeof raw.name === 'string' && raw.name.length > 0 ? raw.name : id,
          parentId: typeof raw.parentId === 'string' && raw.parentId.length > 0 ? raw.parentId : null,
          itemCount: typeof raw.itemCount === 'number' && isFinite(raw.itemCount) ? raw.itemCount : 0,
          itemCountDeep: typeof raw.itemCountDeep === 'number' && isFinite(raw.itemCountDeep) ? raw.itemCountDeep : 0,
          system: raw.system === true,
          children: [],
        }
        if (node.itemCountDeep === 0 && node.itemCount > 0) node.itemCountDeep = node.itemCount
        byId[id] = node
        children[id] = []
        nodes.push(node)
      }
      for (let i = 0; i < nodes.length; i++) {
        const node = nodes[i]
        const parent = node.parentId === null ? undefined : byId[node.parentId]
        if (parent !== undefined && parent !== node) children[parent.id].push(node)
      }
      const roots = []
      const seen = {}
      function walk(node) {
        if (seen[node.id] === true) return
        seen[node.id] = true
        node.children = children[node.id]
        for (let i = 0; i < node.children.length; i++) walk(node.children[i])
      }
      for (let i = 0; i < nodes.length; i++) {
        const node = nodes[i]
        const parent = node.parentId === null ? undefined : byId[node.parentId]
        if (parent === undefined || parent === node) {
          if (seen[node.id] !== true) { roots.push(node); walk(node) }
        }
      }
      for (let i = 0; i < nodes.length; i++) {
        if (seen[nodes[i].id] !== true) { roots.push(nodes[i]); walk(nodes[i]) }
      }
      return roots
    }

    /** Depth-first id/depth listing of a collection forest (render + test helper). */
    function flattenCollectionTree(roots) {
      const out = []
      const seen = {}
      function walk(nodes, depth) {
        for (let i = 0; i < nodes.length; i++) {
          const node = nodes[i]
          if (seen[node.id] === true) continue
          seen[node.id] = true
          out.push({ id: node.id, name: node.name, depth: depth, parentId: node.parentId, system: node.system === true })
          walk(node.children, depth + 1)
        }
      }
      walk(Array.isArray(roots) ? roots : [], 0)
      return out
    }
    /* @parity:buildCollectionTree:end */

    /** Accepts `[id]`, `[{id}]`, `[{workId}]` and returns unique string ids. */
    function idList(value) {
      const out = []
      if (!Array.isArray(value)) return out
      for (let i = 0; i < value.length; i++) {
        const item = value[i]
        const id = typeof item === 'string'
          ? item
          : item !== null && item !== undefined && typeof item === 'object'
            ? (typeof item.id === 'string' ? item.id : typeof item.workId === 'string' ? item.workId : null)
            : null
        if (typeof id === 'string' && id.length > 0 && out.indexOf(id) === -1) out.push(id)
      }
      return out
    }

    /**
     * Direct members of a collection, or null when the host sent only counts.
     * `ids` is the additive field the host should return (see the t4 note to
     * t3); `members`/`workIds` are accepted aliases.
     */
    function collectionMembers(collection) {
      if (collection === null || collection === undefined) return null
      if (Array.isArray(collection.ids)) return idList(collection.ids)
      if (Array.isArray(collection.members)) return idList(collection.members)
      if (Array.isArray(collection.workIds)) return idList(collection.workIds)
      return null
    }

    /** Normalises whatever /state or a mutation returned into EMPTY_LIBRARY's shape. */
    function normalizeLibrary(raw) {
      const lib = Object.assign({}, EMPTY_LIBRARY)
      if (raw === null || raw === undefined || typeof raw !== 'object') return lib
      if (Array.isArray(raw.collections)) lib.collections = raw.collections
      if (Array.isArray(raw.recentlyFound)) lib.recentlyFound = raw.recentlyFound
      if (raw.annotations !== null && typeof raw.annotations === 'object' && !Array.isArray(raw.annotations)) {
        lib.annotations = raw.annotations
      }
      if (typeof raw.storePath === 'string') lib.storePath = raw.storePath
      if (typeof raw.storeError === 'string') lib.storeError = raw.storeError
      else if (raw.storeError) lib.storeError = String(raw.storeError)
      if (raw.records !== undefined) lib.records = raw.records
      return lib
    }

    /** `{id: record}` from a map or an array, without trusting either. */
    function recordsIndex(raw) {
      const out = {}
      if (raw === null || raw === undefined) return out
      if (Array.isArray(raw)) {
        for (let i = 0; i < raw.length; i++) {
          const record = raw[i]
          if (record !== null && record !== undefined && typeof record.id === 'string') out[record.id] = record
        }
        return out
      }
      if (typeof raw !== 'object') return out
      const keys = Object.keys(raw)
      for (let i = 0; i < keys.length; i++) {
        const record = raw[keys[i]]
        if (record !== null && record !== undefined && typeof record === 'object') {
          const id = typeof record.id === 'string' ? record.id : keys[i]
          out[id] = record
        }
      }
      return out
    }

    /** One host route call: unwraps the {ok,value|error} envelope, throws on failure. */
    function post(method, body) {
      return fetch(ROUTE + '/' + method, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body === undefined ? {} : body),
      }).then(function (response) {
        return response.json().catch(function () {
          throw new Error('HTTP ' + response.status + ': invalid JSON response')
        })
      }).then(function (envelope) {
        if (envelope === null || typeof envelope !== 'object' || envelope.ok !== true) {
          const message = envelope && envelope.error && envelope.error.message
            ? envelope.error.message
            : 'The host refused the request.'
          throw new Error(message)
        }
        return envelope.value
      })
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

    /** Colour dot for a work id, from the annotation colour enum. */
    function colorHexOf(annotations, id) {
      const annotation = annotations !== null && annotations !== undefined ? annotations[id] : undefined
      if (annotation === null || annotation === undefined || typeof annotation.color !== 'string') return null
      for (let i = 0; i < COLOR_CHOICES.length; i++) {
        if (COLOR_CHOICES[i].id === annotation.color) return COLOR_CHOICES[i].hex
      }
      return null
    }

    function ColorDot(props) {
      if (props.hex === null || props.hex === undefined) return null
      return React.createElement('span', { className: 'rr-dot', style: { background: props.hex } })
    }

    /** "Save to ..." picker used by search results, collection items and seeds. */
    function SaveToSelect(props) {
      const collections = props.collections || []
      const users = []
      for (let i = 0; i < collections.length; i++) {
        const collection = collections[i]
        if (collection && typeof collection.id === 'string' && collection.system !== true) users.push(collection)
      }
      const disabled = props.disabled === true || users.length === 0
      return React.createElement('select', {
        className: 'rr-save',
        'data-rr': props.marker || 'save-to',
        value: '',
        disabled: disabled,
        title: users.length === 0 ? 'Create a collection in the Library tab first' : 'Copy into a collection',
        onClick: function (event) { event.stopPropagation() },
        onChange: function (event) {
          const value = event.target.value
          event.target.value = ''
          if (value === '') return
          props.onPick(value)
        },
      },
        React.createElement('option', { value: '' }, users.length === 0 ? 'No collection' : 'Save to\u2026'),
        users.map(function (collection) {
          return React.createElement('option', { key: collection.id, value: collection.id }, collection.name || collection.id)
        }),
      )
    }

    /**
     * Recursive collection tree: expand/collapse, activate, create a
     * subcollection, rename, delete (two-step confirm) and copy the active
     * work ids into it.
     */
    function LibraryTree(props) {
      const roots = props.roots || []
      const [collapsed, setCollapsed] = React.useState({})
      const [editingId, setEditingId] = React.useState(null)
      const [draft, setDraft] = React.useState('')
      const [createParent, setCreateParent] = React.useState(null)
      const [newName, setNewName] = React.useState('')
      const [confirmId, setConfirmId] = React.useState(null)
      const busy = props.busy === true

      function toggle(id) {
        setCollapsed(function (prev) {
          const next = Object.assign({}, prev)
          next[id] = prev[id] !== true
          return next
        })
      }

      function startRename(node) {
        setEditingId(node.id)
        setDraft(node.name)
        setConfirmId(null)
      }

      function commitRename(id) {
        const name = draft.trim()
        setEditingId(null)
        if (name.length === 0) return
        props.onRename(id, name)
      }

      function startCreate(parentId) {
        setCreateParent(parentId)
        setNewName('')
      }

      function commitCreate() {
        const name = newName.trim()
        const parentId = createParent
        setCreateParent(null)
        setNewName('')
        if (name.length === 0) return
        props.onCreate(parentId, name)
      }

      function renderNodes(nodes, depth) {
        const out = []
        for (let i = 0; i < nodes.length; i++) {
          const node = nodes[i]
          const kids = node.children || []
          const open = collapsed[node.id] !== true
          const count = node.itemCountDeep > node.itemCount
            ? node.itemCount + '/' + node.itemCountDeep
            : String(node.itemCount)
          const row = []
          row.push(React.createElement('button', {
            key: 'caret',
            className: 'rr-tree-caret',
            'aria-label': open ? 'Collapse' : 'Expand',
            onClick: function (event) { event.stopPropagation(); toggle(node.id) },
          }, kids.length === 0 ? '' : open ? '\u25be' : '\u25b8'))
          if (editingId === node.id) {
            row.push(React.createElement('input', {
              key: 'edit',
              className: 'rr-inline-input',
              value: draft,
              autoFocus: true,
              onClick: function (event) { event.stopPropagation() },
              onChange: function (event) { setDraft(event.target.value) },
              onKeyDown: function (event) {
                if (event.key === 'Enter') commitRename(node.id)
                if (event.key === 'Escape') setEditingId(null)
              },
              onBlur: function () { commitRename(node.id) },
            }))
          } else {
            row.push(React.createElement('span', { key: 'name', className: 'rr-tree-name' }, node.name))
          }
          row.push(React.createElement('span', { key: 'count', className: 'rr-tree-count', title: 'items (direct/deep)' }, count))
          if (!node.system) {
            row.push(React.createElement('button', {
              key: 'add',
              className: 'rr-x',
              title: 'New subcollection',
              onClick: function (event) { event.stopPropagation(); startCreate(node.id) },
            }, '\uFF0B'))
            row.push(React.createElement('button', {
              key: 'rename',
              className: 'rr-x',
              title: 'Rename',
              onClick: function (event) { event.stopPropagation(); startRename(node) },
            }, '\u270e'))
            row.push(React.createElement('button', {
              key: 'delete',
              className: 'rr-x',
              title: confirmId === node.id ? 'Press again to delete this collection and its subcollections' : 'Delete collection',
              onClick: function (event) {
                event.stopPropagation()
                if (confirmId === node.id) { setConfirmId(null); props.onDelete(node.id) }
                else setConfirmId(node.id)
              },
            }, confirmId === node.id ? '\u2713' : '\u00d7'))
          }
          out.push(React.createElement('div', {
            key: 'row:' + node.id,
            className: 'rr-tree-row' + (props.activeId === node.id ? ' rr-tree-row-on' : ''),
            'data-rr': 'tree-row',
            style: { paddingLeft: String(6 + depth * 13) + 'px' },
            onClick: function () { props.onActivate(node.id) },
          }, row))
          if (createParent === node.id) {
            out.push(React.createElement('div', {
              key: 'create:' + node.id,
              className: 'rr-tree-row',
              style: { paddingLeft: String(6 + (depth + 1) * 13) + 'px' },
            },
              React.createElement('input', {
                className: 'rr-inline-input',
                placeholder: 'Subcollection name\u2026',
                value: newName,
                autoFocus: true,
                onChange: function (event) { setNewName(event.target.value) },
                onKeyDown: function (event) {
                  if (event.key === 'Enter') commitCreate()
                  if (event.key === 'Escape') setCreateParent(null)
                },
              }),
              React.createElement('button', { className: 'rr-btn rr-btn-small', disabled: busy, onClick: commitCreate }, 'Add'),
              React.createElement('button', { className: 'rr-x', onClick: function () { setCreateParent(null) } }, '\u00d7'),
            ))
          }
          if (open && kids.length > 0) {
            const nested = renderNodes(kids, depth + 1)
            for (let k = 0; k < nested.length; k++) out.push(nested[k])
          }
        }
        return out
      }

      const rows = []
      if (createParent === '__root') {
        rows.push(React.createElement('div', { key: 'create:root', className: 'rr-tree-row' },
          React.createElement('input', {
            className: 'rr-inline-input',
            placeholder: 'Collection name\u2026',
            value: newName,
            autoFocus: true,
            onChange: function (event) { setNewName(event.target.value) },
            onKeyDown: function (event) {
              if (event.key === 'Enter') commitCreate()
              if (event.key === 'Escape') setCreateParent(null)
            },
          }),
          React.createElement('button', { className: 'rr-btn rr-btn-small', disabled: busy, onClick: commitCreate }, 'Add'),
          React.createElement('button', { className: 'rr-x', onClick: function () { setCreateParent(null) } }, '\u00d7'),
        ))
      }
      const tree = renderNodes(roots, 0)
      for (let i = 0; i < tree.length; i++) rows.push(tree[i])

      return React.createElement('div', { className: 'rr-tree', 'data-rr': 'library-tree' },
        roots.length === 0 && createParent !== '__root'
          ? React.createElement('div', { className: 'rr-hint' }, 'No collections yet. Create one to group papers (subcollections supported).')
          : rows,
      )
    }

    /** Recently Found staging area: multi-select, promote into a collection, clear. */
    function RecentlyFoundList(props) {
      const ids = props.ids || []
      const selected = props.selected || {}
      const [newName, setNewName] = React.useState('')
      const users = []
      const collections = props.collections || []
      for (let i = 0; i < collections.length; i++) {
        const collection = collections[i]
        if (collection && typeof collection.id === 'string' && collection.system !== true) users.push(collection)
      }
      let selectedCount = 0
      for (let i = 0; i < ids.length; i++) if (selected[ids[i]] === true) selectedCount++

      return React.createElement('div', { 'data-rr': 'recently-found' },
        ids.length === 0
          ? React.createElement('div', { className: 'rr-hint' }, 'Nothing here yet. Papers enter this list when they join the graph.')
          : ids.map(function (id) {
            const record = props.records[id]
            const title = record ? record.title : id
            return React.createElement('div', { key: id, className: 'rr-recent', 'data-rr': 'recent-row' },
              React.createElement('input', {
                type: 'checkbox',
                checked: selected[id] === true,
                onChange: function () { props.onToggle(id) },
              }),
              React.createElement(ColorDot, { hex: colorHexOf(props.annotations, id) }),
              React.createElement('span', {
                className: 'rr-recent-title',
                title: title,
                onClick: function () { props.onOpen(id) },
              }, shorten(title, 52)),
              React.createElement('span', { className: 'rr-tree-count' }, record && record.year > 0 ? String(record.year) : ''),
            )
          }),
        ids.length > 0 ? React.createElement('div', { className: 'rr-export-row' },
          React.createElement(SaveToSelect, {
            collections: collections,
            marker: 'recent-promote',
            disabled: selectedCount === 0 || props.busy === true,
            onPick: function (collectionId) { props.onPromote(collectionId) },
          }),
          React.createElement('button', {
            className: 'rr-btn rr-btn-small',
            disabled: selectedCount === 0 || users.length === 0 || props.busy === true,
            title: users.length === 0 ? 'Create a collection first' : 'Save the ticked papers into ' + users[0].name,
            onClick: function () { props.onPromote(users[0].id) },
          }, users.length === 0 ? 'Save selected' : 'Save selected \u2192 ' + shorten(users[0].name, 14)),
          React.createElement('button', {
            className: 'rr-btn rr-btn-small',
            disabled: props.busy === true,
            onClick: function () { props.onClear() },
          }, 'Clear list'),
        ) : null,
        ids.length > 0 ? React.createElement('div', { className: 'rr-filter-row', style: { marginTop: '6px' } },
          React.createElement('input', {
            className: 'rr-inline-input',
            placeholder: 'New collection name\u2026',
            value: newName,
            onChange: function (event) { setNewName(event.target.value) },
          }),
          React.createElement('button', {
            className: 'rr-btn rr-btn-small',
            disabled: newName.trim().length === 0 || selectedCount === 0 || props.busy === true,
            onClick: function () {
              const name = newName.trim()
              setNewName('')
              if (name.length > 0) props.onPromoteNew(name)
            },
          }, 'Create & save'),
        ) : null,
      )
    }

    /** Filter panel: the frozen five dimensions plus sort (spec A4). */
    function FilterBar(props) {
      const filters = props.filters || {}
      function num(event) {
        const raw = event.target.value
        if (raw === '') return undefined
        const value = Number(raw)
        return isFinite(value) ? value : undefined
      }
      return React.createElement('div', { className: 'rr-filter', 'data-rr': 'filter-bar' },
        React.createElement('div', { className: 'rr-filter-row' },
          React.createElement('span', { className: 'rr-filter-label' }, 'Years'),
          React.createElement('input', {
            className: 'rr-filter-input',
            type: 'number',
            placeholder: 'from',
            value: filters.yearFrom === undefined ? '' : String(filters.yearFrom),
            onChange: function (event) { props.onChange({ yearFrom: num(event) }) },
          }),
          React.createElement('input', {
            className: 'rr-filter-input',
            type: 'number',
            placeholder: 'to',
            value: filters.yearTo === undefined ? '' : String(filters.yearTo),
            onChange: function (event) { props.onChange({ yearTo: num(event) }) },
          }),
        ),
        React.createElement('div', { className: 'rr-filter-row' },
          React.createElement('span', { className: 'rr-filter-label' }, 'Journal'),
          React.createElement('input', {
            className: 'rr-filter-input',
            placeholder: 'venue contains\u2026',
            value: typeof filters.venue === 'string' ? filters.venue : '',
            onChange: function (event) { props.onChange({ venue: event.target.value }) },
          }),
        ),
        React.createElement('div', { className: 'rr-filter-row' },
          React.createElement('span', { className: 'rr-filter-label' }, 'Min cites'),
          React.createElement('input', {
            className: 'rr-filter-input',
            type: 'number',
            placeholder: '0',
            value: filters.minCitations === undefined ? '' : String(filters.minCitations),
            onChange: function (event) { props.onChange({ minCitations: num(event) }) },
          }),
          React.createElement('span', { className: 'rr-filter-label' }, 'Sort'),
          React.createElement('select', {
            className: 'rr-filter-input',
            value: filters.sort === 'year' ? 'year' : 'cited',
            onChange: function (event) { props.onChange({ sort: event.target.value }) },
          },
            React.createElement('option', { value: 'cited' }, 'Most cited'),
            React.createElement('option', { value: 'year' }, 'Newest year'),
          ),
        ),
        React.createElement('div', { className: 'rr-filter-row' },
          React.createElement('select', {
            className: 'rr-filter-input',
            value: filters.isOa === true ? 'yes' : filters.isOa === false ? 'no' : 'any',
            onChange: function (event) {
              const value = event.target.value
              props.onChange({ isOa: value === 'any' ? undefined : value === 'yes' })
            },
          },
            React.createElement('option', { value: 'any' }, 'Open access: any'),
            React.createElement('option', { value: 'yes' }, 'Open access only'),
            React.createElement('option', { value: 'no' }, 'Closed access only'),
          ),
          React.createElement('select', {
            className: 'rr-filter-input',
            value: filters.isRetracted === true ? 'yes' : filters.isRetracted === false ? 'no' : 'any',
            onChange: function (event) {
              const value = event.target.value
              props.onChange({ isRetracted: value === 'any' ? undefined : value === 'yes' })
            },
          },
            React.createElement('option', { value: 'any' }, 'Retracted: any'),
            React.createElement('option', { value: 'yes' }, 'Retracted only'),
            React.createElement('option', { value: 'no' }, 'Not retracted'),
          ),
        ),
        React.createElement('div', { className: 'rr-filter-row' },
          React.createElement('button', {
            className: 'rr-btn rr-btn-small rr-btn-primary',
            disabled: props.busy === true || props.canApply !== true,
            onClick: function () { props.onApply() },
          }, 'Apply & search'),
          React.createElement('button', {
            className: 'rr-btn rr-btn-small',
            disabled: props.busy === true,
            onClick: function () { props.onReset() },
          }, 'Reset'),
          props.stats ? React.createElement('span', { className: 'rr-stats' }, props.stats) : null,
        ),
      )
    }

    /** Notes / tags / colour editor for the selected work (spec B4). */
    function NoteEditor(props) {
      const annotation = props.annotation || {}
      const tags = Array.isArray(annotation.tags) ? annotation.tags : []
      const [note, setNote] = React.useState(typeof annotation.note === 'string' ? annotation.note : '')
      const [tagsText, setTagsText] = React.useState(tags.join(', '))
      const stamp = String(annotation.updatedAt === undefined ? '' : annotation.updatedAt) + '#' + tags.join(',')
      React.useEffect(function () {
        setNote(typeof annotation.note === 'string' ? annotation.note : '')
        setTagsText((Array.isArray(annotation.tags) ? annotation.tags : []).join(', '))
      }, [props.id, stamp])

      function commitNote() {
        const next = note
        if (next !== (typeof annotation.note === 'string' ? annotation.note : '')) props.onSave({ note: next })
      }

      function commitTags() {
        const parsed = []
        const parts = tagsText.split(',')
        for (let i = 0; i < parts.length && parsed.length < 20; i++) {
          const tag = parts[i].trim().slice(0, 40)
          if (tag.length > 0 && parsed.indexOf(tag) === -1) parsed.push(tag)
        }
        if (parsed.join(',') !== tags.join(',')) props.onSave({ tags: parsed })
      }

      return React.createElement('div', { className: 'rr-note', 'data-rr': 'note-editor' },
        React.createElement('div', { className: 'rr-section-title' }, React.createElement('span', null, 'Notes')),
        React.createElement('textarea', {
          className: 'rr-note-input',
          placeholder: 'Reading notes\u2026 (saved when you click away)',
          value: note,
          disabled: props.busy === true,
          onChange: function (event) { setNote(event.target.value) },
          onBlur: commitNote,
        }),
        React.createElement('div', { className: 'rr-filter-row' },
          React.createElement('input', {
            className: 'rr-filter-input',
            placeholder: 'tags, comma separated\u2026',
            value: tagsText,
            disabled: props.busy === true,
            onChange: function (event) { setTagsText(event.target.value) },
            onBlur: commitTags,
            onKeyDown: function (event) { if (event.key === 'Enter') commitTags() },
          }),
        ),
        tags.length > 0 ? React.createElement('div', { className: 'rr-tags' }, tags.map(function (tag) {
          return React.createElement('span', { key: tag, className: 'rr-tag' }, tag)
        })) : null,
        React.createElement('div', { className: 'rr-color-row' },
          React.createElement('span', { className: 'rr-filter-label' }, 'Colour'),
          COLOR_CHOICES.map(function (choice) {
            return React.createElement('button', {
              key: choice.id,
              className: 'rr-color-dot' + (annotation.color === choice.id ? ' rr-color-on' : ''),
              style: { background: choice.hex },
              title: choice.id,
              'aria-label': choice.id,
              disabled: props.busy === true,
              onClick: function () { props.onSave({ color: choice.id }) },
            })
          }),
          React.createElement('button', {
            className: 'rr-btn rr-btn-small',
            disabled: props.busy === true || !annotation.color,
            onClick: function () { props.onSave({ color: null }) },
          }, 'No colour'),
        ),
      )
    }

    /** Timeline axes: year ticks on x, citation ticks on y, "year unknown" band. */
    function TimelineAxis(props) {
      const ticks = props.ticks || { years: [], citations: [], hasUnknown: false, band: null }
      const parts = []
      const bottom = BOX_H - 54
      const left = 46
      const right = BOX_W - 46
      for (let i = 0; i < ticks.years.length; i++) {
        const tick = ticks.years[i]
        parts.push(React.createElement('line', {
          key: 'yg:' + tick.year,
          className: 'rr-tick',
          x1: tick.x,
          y1: 34,
          x2: tick.x,
          y2: bottom,
        }))
        parts.push(React.createElement('text', {
          key: 'yt:' + tick.year,
          className: 'rr-tick-label',
          x: tick.x,
          y: bottom + 15,
          textAnchor: 'middle',
        }, String(tick.year)))
      }
      for (let i = 0; i < ticks.citations.length; i++) {
        const tick = ticks.citations[i]
        parts.push(React.createElement('line', {
          key: 'cg:' + i,
          className: 'rr-tick',
          x1: left,
          y1: tick.y,
          x2: right,
          y2: tick.y,
        }))
        parts.push(React.createElement('text', {
          key: 'ct:' + i,
          className: 'rr-tick-label',
          x: left - 4,
          y: tick.y + 3,
          textAnchor: 'end',
        }, String(tick.value)))
      }
      if (ticks.hasUnknown && ticks.band) {
        parts.push(React.createElement('rect', {
          key: 'band',
          className: 'rr-band',
          x: ticks.band.x,
          y: 34,
          width: ticks.band.width,
          height: bottom - 34,
          rx: 6,
        }))
        parts.push(React.createElement('text', {
          key: 'band-label',
          className: 'rr-tick-label',
          x: ticks.band.x + 6,
          y: 30,
        }, 'year unknown'))
      }
      parts.push(React.createElement('text', {
        key: 'axis-x',
        className: 'rr-tick-label',
        x: right,
        y: bottom + 15,
        textAnchor: 'end',
      }, 'publication year \u2192'))
      parts.push(React.createElement('text', {
        key: 'axis-y',
        className: 'rr-tick-label',
        x: left,
        y: 28,
      }, 'citations \u2191'))
      return React.createElement('g', { className: 'rr-timeline-axis', 'data-rr': 'timeline-axis' }, parts)
    }

    function ResearchCatPanel() {
      const [graph, setGraph] = React.useState(EMPTY_GRAPH)
      const [library, setLibrary] = React.useState(EMPTY_LIBRARY)
      const [tab, setTab] = React.useState('graph')
      const [activeCollectionId, setActiveCollectionId] = React.useState('seeds')
      const [filters, setFilters] = React.useState({})
      const [showFilters, setShowFilters] = React.useState(false)
      const [layoutMode, setLayoutMode] = React.useState('radial')
      const [recentSelected, setRecentSelected] = React.useState({})
      const [recordCache, setRecordCache] = React.useState({})
      const [authorList, setAuthorList] = React.useState(null)
      const [searchStats, setSearchStats] = React.useState(null)
      const [exportText, setExportText] = React.useState('')
      const [exportNote, setExportNote] = React.useState('')
      const [query, setQuery] = React.useState('')
      const [results, setResults] = React.useState(null)
      const [resultsFor, setResultsFor] = React.useState('')
      const [busy, setBusy] = React.useState('')
      const [error, setError] = React.useState('')
      const [selected, setSelected] = React.useState(null)
      const [detail, setDetail] = React.useState(null)
      const [loadingDetail, setLoadingDetail] = React.useState(false)
      const [showKinds, setShowKinds] = React.useState({
        references: true,
        citations: true,
        related: true,
        earlier: true,
        later: true,
        author: true,
      })
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
        return ids.join(',') + '#' + graph.links.length + '#' + spin + '#' + layoutMode
      }, [graph, spin, layoutMode])

      React.useEffect(function () {
        setPlace(layoutMode === 'timeline'
          ? computeTimelineLayout(graph.nodes, graph.links, { w: BOX_W, h: BOX_H })
          : computeRadialLayout(graph.nodes, graph.links, spin, { w: BOX_W, h: BOX_H }))
      }, [signature, layoutMode])

      React.useEffect(function () {
        let alive = true
        post('state', {}).then(function (res) {
          if (!alive || res === null || res === undefined) return
          if (res.graph) setGraph(res.graph)
          if (res.library) setLibrary(normalizeLibrary(res.library))
        }, function (err) {
          if (alive) setError(errText(err))
        })
        return function () { alive = false }
      }, [])

      const annotations = library.annotations !== null && typeof library.annotations === 'object' ? library.annotations : {}

      function mergeLibrary(patch) {
        setLibrary(function (prev) {
          const next = Object.assign({}, prev)
          if (Array.isArray(patch.collections)) next.collections = patch.collections
          if (Array.isArray(patch.recentlyFound)) next.recentlyFound = patch.recentlyFound
          if (patch.annotations !== undefined) next.annotations = patch.annotations
          if (typeof patch.storePath === 'string') next.storePath = patch.storePath
          if (patch.storeError !== undefined) next.storeError = patch.storeError === null ? '' : String(patch.storeError)
          if (patch.records !== undefined) next.records = patch.records
          return next
        })
      }

      /** Re-reads collections + Recently Found; quiet mode is used on mount. */
      function refreshLibrary(quiet) {
        return Promise.all([
          post('collections', { op: 'list' }).then(function (res) {
            return res && Array.isArray(res.collections) ? res.collections : null
          }, function (err) { if (!quiet) setError(errText(err)); return null }),
          post('recentlyFound', { op: 'list' }).then(function (res) {
            return res && Array.isArray(res.recentlyFound) ? res.recentlyFound : null
          }, function (err) { if (!quiet) setError(errText(err)); return null }),
        ]).then(function (both) {
          if (both[0] !== null || both[1] !== null) {
            mergeLibrary({ collections: both[0] === null ? undefined : both[0], recentlyFound: both[1] === null ? undefined : both[1] })
          }
        })
      }

      React.useEffect(function () {
        refreshLibrary(true)
      }, [])

      /** Normalises the filter object to the frozen contract (drops blanks). */
      function activeFilters() {
        const out = {}
        if (isNum(filters.yearFrom)) out.yearFrom = filters.yearFrom
        if (isNum(filters.yearTo)) out.yearTo = filters.yearTo
        if (typeof filters.venue === 'string' && filters.venue.trim().length > 0) out.venue = filters.venue.trim()
        if (filters.isOa === true || filters.isOa === false) out.isOa = filters.isOa
        if (filters.isRetracted === true || filters.isRetracted === false) out.isRetracted = filters.isRetracted
        if (isNum(filters.minCitations)) out.minCitations = filters.minCitations
        if (filters.sort === 'year' || filters.sort === 'cited') out.sort = filters.sort
        return Object.keys(out).length > 0 ? out : undefined
      }

      function setFilter(patch) {
        setFilters(function (prev) {
          const next = Object.assign({}, prev)
          const keys = Object.keys(patch)
          for (let i = 0; i < keys.length; i++) {
            const value = patch[keys[i]]
            if (value === undefined || value === '') delete next[keys[i]]
            else next[keys[i]] = value
          }
          return next
        })
      }

      function runSearch(term, nextPage) {
        const asked = term === undefined ? query : term
        if (typeof asked !== 'string' || asked.trim().length === 0) return
        const pageNo = isNum(nextPage) && nextPage > 0 ? nextPage : 1
        setBusy('Searching OpenAlex\u2026')
        setError('')
        const body = { query: asked, page: pageNo }
        const sent = activeFilters()
        if (sent !== undefined) body.filters = sent
        post('search', body).then(function (res) {
          const rows = res && Array.isArray(res.results) ? res.results : []
          setResults(function (prev) {
            return pageNo > 1 && Array.isArray(prev) ? prev.concat(rows) : rows
          })
          setResultsFor(res && res.term ? res.term : asked)
          setSearchStats({
            shown: rows.length,
            considered: res && isNum(res.considered) ? res.considered : null,
            total: res && isNum(res.total) ? res.total : null,
            hasMore: res !== null && res !== undefined && res.hasMore === true,
            page: pageNo,
          })
          if (res && res.graph) setGraph(res.graph)
          setTab('graph')
          if (pageNo === 1) refreshLibrary(true)
        }, function (err) {
          if (pageNo === 1) setResults([])
          setError(errText(err))
        }).then(function () { setBusy('') })
      }

      function loadDetail(id) {
        setSelected(id)
        setDetail(null)
        setAuthorList(null)
        setLoadingDetail(true)
        post('details', { id: id }).then(function (res) {
          setDetail(res.paper)
          if (res && res.paper) {
            setRecordCache(function (prev) {
              const next = Object.assign({}, prev)
              next[id] = res.paper
              return next
            })
          }
        }, function (err) {
          setError(errText(err))
        }).then(function () { setLoadingDetail(false) })
        post('authors', { id: id }).then(function (res) {
          if (res && Array.isArray(res.authors) && res.authors.length > 0) setAuthorList(res.authors)
        }, function () { /* optional route: fall back to the record's authorIds */ })
      }

      function addPaper(id) {
        setBusy('Adding paper\u2026')
        setError('')
        post('addSeed', { id: id }).then(function (res) {
          setGraph(res.graph)
          setResults(null)
          if (res.library) mergeLibrary(normalizeLibrary(res.library))
          loadDetail(id)
          refreshLibrary(true)
        }, function (err) {
          setError(errText(err))
        }).then(function () { setBusy('') })
      }

      function dropSeed(id) {
        setError('')
        post('removeSeed', { id: id }).then(function (res) {
          setGraph(res.graph)
          if (res.library) mergeLibrary(normalizeLibrary(res.library))
          if (selected === id) { setSelected(null); setDetail(null) }
          refreshLibrary(true)
        }, function (err) { setError(errText(err)) })
      }

      function expand(id, kind, authorId) {
        setBusy('Pulling ' + KIND_LABEL[kind].toLowerCase() + '\u2026')
        setError('')
        const body = { id: id, kind: kind }
        if (typeof authorId === 'string' && authorId.length > 0) body.authorId = authorId
        const sent = activeFilters()
        if (sent !== undefined) body.filters = sent
        post('expand', body).then(function (res) {
          setGraph(res.graph)
          if (res.library) mergeLibrary(normalizeLibrary(res.library))
          if (res.found === 0) {
            setError('OpenAlex records no ' + KIND_LABEL[kind].toLowerCase() + ' for this paper.')
          } else if (res.truncated === true) {
            setError('Showing the first ' + res.found + ' of ' + (isNum(res.considered) ? res.considered : 'more') + ' ' + KIND_LABEL[kind].toLowerCase() + '.')
          }
          refreshLibrary(true)
        }, function (err) {
          setError(errText(err))
        }).then(function () { setBusy('') })
      }

      function expandAuthor(id, authorId) {
        if (typeof authorId !== 'string' || authorId.length === 0) return
        expand(id, 'author', authorId)
      }

      function expandAll() {
        setBusy('Auto-expanding the collection\u2026')
        setError('')
        const body = {}
        const sent = activeFilters()
        if (sent !== undefined) body.filters = sent
        post('expandAll', body).then(function (res) {
          setGraph(res.graph)
          if (res.library) mergeLibrary(normalizeLibrary(res.library))
          let failed = 0
          const perSeed = Array.isArray(res.perSeed) ? res.perSeed : []
          for (let i = 0; i < perSeed.length; i++) if (perSeed[i] && perSeed[i].error) failed++
          if (res.added === 0) setError('Nothing new came back \u2014 this collection is already expanded.')
          else if (failed > 0) setError(res.added + ' new papers \u00b7 ' + failed + ' request(s) failed \u00b7 ' + (res.skipped || 0) + ' skipped')
          else if (res.warning) setError(res.warning)
          else if (res.skipped > 0) setError(res.added + ' new papers \u00b7 ' + res.skipped + ' skipped (graph limit?)')
          refreshLibrary(true)
        }, function (err) {
          setError(errText(err))
        }).then(function () { setBusy('') })
      }

      function clearAll() {
        setError('')
        post('clear', {}).then(function (res) {
          setGraph(res.graph)
          if (res.library) mergeLibrary(normalizeLibrary(res.library))
          setSelected(null)
          setDetail(null)
          setManual({})
          setView({ k: 1, x: 0, y: 0 })
          refreshLibrary(true)
        }, function (err) { setError(errText(err)) })
      }

      function resetLibrary() {
        setBusy('Clearing the library\u2026')
        setError('')
        post('clear', { scope: 'library' }).then(function (res) {
          setGraph(res.graph)
          if (res.library) mergeLibrary(normalizeLibrary(res.library))
          setActiveCollectionId('seeds')
          setSelected(null)
          setDetail(null)
          setManual({})
          setRecentSelected({})
          refreshLibrary(true)
        }, function (err) {
          setError(errText(err))
        }).then(function () { setBusy('') })
      }

      function toggleKind(kind) {
        setShowKinds(function (prev) {
          const next = Object.assign({}, prev)
          next[kind] = prev[kind] !== true
          return next
        })
      }

      /* ------------------------------------------------------- library ops */

      function libraryOp(route, body, label, after) {
        setBusy(label)
        setError('')
        return post(route, body).then(function (res) {
          if (res && res.library) mergeLibrary(normalizeLibrary(res.library))
          if (after !== undefined) after(res)
          refreshLibrary(true)
          return res
        }, function (err) {
          setError(errText(err))
          return null
        }).then(function (res) { setBusy(''); return res })
      }

      function createCollection(parentId, name) {
        libraryOp('collections', { op: 'create', name: name, parentId: parentId === undefined ? null : parentId }, 'Creating collection\u2026')
      }

      function renameCollection(id, name) {
        libraryOp('collections', { op: 'rename', id: id, name: name }, 'Renaming collection\u2026')
      }

      function deleteCollection(id) {
        libraryOp('collections', { op: 'delete', id: id }, 'Deleting collection\u2026', function () {
          if (activeCollectionId === id) setActiveCollectionId('seeds')
        })
      }

      function saveToCollection(collectionId, ids) {
        if (!Array.isArray(ids) || ids.length === 0) return
        libraryOp('collections', { op: 'save', collectionId: collectionId, ids: ids }, 'Saving\u2026')
      }

      function removeFromCollection(collectionId, ids) {
        if (!Array.isArray(ids) || ids.length === 0) return
        libraryOp('collections', { op: 'remove', collectionId: collectionId, ids: ids }, 'Removing\u2026')
      }

      function promoteRecent(ids, collectionId) {
        if (!Array.isArray(ids) || ids.length === 0) return
        libraryOp('recentlyFound', { op: 'promote', ids: ids, collectionId: collectionId }, 'Filing papers\u2026', function () {
          setRecentSelected({})
        })
      }

      function clearRecent() {
        libraryOp('recentlyFound', { op: 'clear' }, 'Clearing the staging area\u2026', function () {
          setRecentSelected({})
        })
      }

      function saveAnnotation(id, patch) {
        setError('')
        const body = Object.assign({ id: id }, patch)
        post('annotate', body).then(function (res) {
          if (res && res.annotation) {
            setLibrary(function (prev) {
              const next = Object.assign({}, prev)
              const nextAnnotations = Object.assign({}, prev.annotations)
              nextAnnotations[id] = res.annotation
              next.annotations = nextAnnotations
              return next
            })
          }
        }, function (err) {
          setError(errText(err))
        })
      }

      function exportBibtex(collectionId) {
        setBusy('Exporting BibTeX\u2026')
        setError('')
        setExportText('')
        setExportNote('')
        const body = { format: 'bibtex' }
        if (typeof collectionId === 'string' && collectionId.length > 0) body.collectionId = collectionId
        post('export', body).then(function (res) {
          if (res === null || res === undefined || typeof res.bibtex !== 'string') {
            setError('The host returned no BibTeX payload.')
            return
          }
          const name = 'research-cat-' + (collectionId || 'all') + '-' + new Date().toISOString().slice(0, 10) + '.bib'
          setExportNote((isNum(res.count) ? res.count : 0) + ' entries \u2192 ' + name)
          let saved = false
          if (typeof document !== 'undefined' && typeof Blob === 'function' && typeof URL !== 'undefined' && typeof URL.createObjectURL === 'function') {
            try {
              const url = URL.createObjectURL(new Blob([res.bibtex], { type: 'application/x-bibtex' }))
              const anchor = document.createElement('a')
              anchor.href = url
              anchor.download = name
              if (document.body) document.body.appendChild(anchor)
              anchor.click()
              if (anchor.remove) anchor.remove()
              URL.revokeObjectURL(url)
              saved = true
            } catch (ignored) { saved = false }
          }
          if (!saved) setExportText(res.bibtex)
        }, function (err) {
          setError(errText(err))
        }).then(function () { setBusy('') })
      }

      /* ------------------------------------------------------------ layout */

      /* t11: `frame` (the SVG viewBox in layout units) is derived in the data
       * section below, once `maxCited` is known. Timeline stays on the fixed
       * 1200x800 box; radial follows the real extent of the layout, so a graph
       * whose rings grew past the old clamp radius is still fully visible
       * (small graphs keep the exact 0 0 1200 800 framing). */
      function unitScale() {
        const element = svgRef.current
        if (element === null || element === undefined || typeof element.getBoundingClientRect !== 'function') return 1
        const rect = element.getBoundingClientRect()
        if (rect === null || rect === undefined || !(rect.width > 0) || !(rect.height > 0)) return 1
        return Math.min(rect.width / frame.w, rect.height / frame.h)
      }

      function positionOf(id) {
        if (manual[id] !== undefined) return manual[id]
        if (place[id] !== undefined) return place[id]
        return { x: frameCentreX, y: frameCentreY }
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
            x: frameCentreX - ratio * (frameCentreX - prev.x),
            y: frameCentreY - ratio * (frameCentreY - prev.y),
          }
        })
      }

      /* ------------------------------------------------------------- data */

      const inCollection = {}
      for (let s = 0; s < graph.seeds.length; s++) inCollection[graph.seeds[s]] = true

      const nodeById = {}
      for (let n = 0; n < graph.nodes.length; n++) nodeById[graph.nodes[n].id] = graph.nodes[n]

      let maxCited = 0
      for (let n = 0; n < graph.nodes.length; n++) if (graph.nodes[n].citedBy > maxCited) maxCited = graph.nodes[n].citedBy

      /* t11: the frame the SVG renders (viewBox units). Timeline stays on the
       * fixed 1200x800 box; radial follows the real extent of the layout, so a
       * graph whose rings grew past the old clamp radius stays fully visible
       * (small graphs keep the exact 0 0 1200 800 framing). */
      let maxNodeRadius = 0
      for (let n = 0; n < graph.nodes.length; n++) {
        const nodeRadius = radiusOf(graph.nodes[n].citedBy, maxCited)
        if (nodeRadius > maxNodeRadius) maxNodeRadius = nodeRadius
      }
      const frame = layoutMode === 'timeline'
        ? { x: 0, y: 0, w: BOX_W, h: BOX_H }
        : layoutExtent(place, maxNodeRadius + 12)
      const frameCentreX = frame.x + frame.w / 2
      const frameCentreY = frame.y + frame.h / 2

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
        if (set.earlier === true) return 'earlier'
        if (set.later === true) return 'later'
        if (set.author === true) return 'author'
        return 'lonely'
      }

      const records = recordsIndex(library.records)
      for (let n = 0; n < graph.nodes.length; n++) {
        const node = graph.nodes[n]
        records[node.id] = Object.assign({}, records[node.id], node)
      }
      const cachedIds = Object.keys(recordCache)
      for (let i = 0; i < cachedIds.length; i++) {
        records[cachedIds[i]] = Object.assign({}, records[cachedIds[i]], recordCache[cachedIds[i]])
      }

      const treeRoots = buildCollectionTree(library.collections)
      let activeCollection = null
      for (let i = 0; i < library.collections.length; i++) {
        if (library.collections[i] && library.collections[i].id === activeCollectionId) activeCollection = library.collections[i]
      }
      let activeIds = null
      if (activeCollectionId === 'seeds') activeIds = graph.seeds
      else if (activeCollection !== null) activeIds = collectionMembers(activeCollection)
      const activeName = activeCollection !== null
        ? activeCollection.name
        : activeCollectionId === 'seeds' ? 'Collection' : activeCollectionId

      const recentIds = idList(library.recentlyFound)

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
          strokeDasharray: EDGE_DASH[link.kind],
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
        const annotated = colorHexOf(annotations, node.id)
        let stroke = ROLE_STROKE[role]
        let strokeWidth = isSelected ? 2.4 : 1.2
        if (annotated !== null) { stroke = annotated; strokeWidth = isSelected ? 3.4 : 2.6 }
        else if (isSeed) stroke = 'transparent'
        else if (isSelected) stroke = 'var(--dsw-alias-label-primary)'
        else if (isHovered) stroke = 'var(--dsw-alias-label-secondary)'
        const className = ['rr-node']
          .concat(isSeed ? ['rr-node-seed'] : [])
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
              strokeWidth: strokeWidth,
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

      const timelineAxis = layoutMode === 'timeline'
        ? React.createElement(TimelineAxis, { key: 'axis', ticks: timelineTicks(graph.nodes, { w: BOX_W, h: BOX_H }) })
        : null

      /* ------------------------------------------------------- left column */

      const statsText = searchStats === null
        ? ''
        : searchStats.shown + ' shown'
          + (searchStats.considered !== null ? ' \u00b7 ' + searchStats.considered + ' before filters' : '')
          + (searchStats.total !== null ? ' \u00b7 ' + searchStats.total + ' total' : '')

      const resultRows = results === null ? null : results.map(function (paper) {
        const added = inCollection[paper.id] === true
        return React.createElement('div', { className: 'rr-result', key: paper.id, 'data-rr': 'result-row' },
          React.createElement(ColorDot, { hex: colorHexOf(annotations, paper.id) }),
          React.createElement('div', { className: 'rr-result-main' },
            React.createElement('div', { className: 'rr-result-title' }, paper.title),
            React.createElement('div', { className: 'rr-result-meta' }, metaLine(paper)),
          ),
          React.createElement('button', {
            className: 'rr-btn rr-btn-small',
            disabled: added || busy !== '',
            onClick: function () { addPaper(paper.id) },
          }, added ? 'In collection' : 'Add'),
          React.createElement(SaveToSelect, {
            collections: library.collections,
            marker: 'result-save',
            disabled: busy !== '',
            onPick: function (collectionId) { saveToCollection(collectionId, [paper.id]) },
          }),
        )
      })

      const activeRows = activeIds === null ? null : activeIds.map(function (id) {
        const node = records[id]
        return React.createElement('div', {
          className: 'rr-seed' + (selected === id ? ' rr-seed-on' : ''),
          key: id,
          'data-rr': 'library-item',
          onClick: function () { loadDetail(id) },
        },
          React.createElement(ColorDot, { hex: colorHexOf(annotations, id) }),
          React.createElement('div', { className: 'rr-result-main' },
            React.createElement('div', { className: 'rr-seed-title' }, node ? node.title : id),
            React.createElement('div', { className: 'rr-seed-meta' }, node ? metaLine(node) : id),
          ),
          activeCollectionId === 'seeds'
            ? React.createElement('button', {
              className: 'rr-x',
              title: 'Remove from collection',
              onClick: function (event) { event.stopPropagation(); dropSeed(id) },
            }, '\u00d7')
            : React.createElement('button', {
              className: 'rr-x',
              title: 'Remove from this collection (the paper stays in the library)',
              onClick: function (event) { event.stopPropagation(); removeFromCollection(activeCollectionId, [id]) },
            }, '\u00d7'),
          activeCollectionId === 'seeds'
            ? null
            : React.createElement(SaveToSelect, {
              collections: library.collections,
              marker: 'item-save',
              disabled: busy !== '',
              onPick: function (collectionId) { saveToCollection(collectionId, [id]) },
            }),
        )
      })

      const filterBar = showFilters
        ? React.createElement(FilterBar, {
          filters: filters,
          busy: busy !== '',
          canApply: query.trim().length > 0 || results !== null,
          stats: statsText,
          onChange: setFilter,
          onApply: function () { runSearch(resultsFor.length > 0 ? resultsFor : query, 1) },
          onReset: function () { setFilters({}) },
        })
        : null

      const graphTab = [
        filterBar,
        results === null ? null : React.createElement('div', { className: 'rr-section', key: 'results' },
          React.createElement('div', { className: 'rr-section-title' },
            React.createElement('span', null, 'Results \u00b7 ' + shorten(resultsFor, 22) + (statsText.length > 0 ? ' \u00b7 ' + statsText : '')),
            React.createElement('button', { className: 'rr-x', onClick: function () { setResults(null); setSearchStats(null) } }, '\u00d7'),
          ),
          resultRows.length === 0
            ? React.createElement('div', { className: 'rr-hint' }, 'No matching work found.')
            : resultRows,
          searchStats !== null && searchStats.hasMore
            ? React.createElement('button', {
              className: 'rr-btn rr-btn-small',
              disabled: busy !== '',
              onClick: function () { runSearch(resultsFor, searchStats.page + 1) },
            }, 'Load more')
            : null,
        ),
        React.createElement('div', { className: 'rr-section', key: 'collection' },
          React.createElement('div', { className: 'rr-section-title' },
            React.createElement('span', null, shorten(activeName, 20) + ' \u00b7 ' + (activeIds === null ? (activeCollection ? activeCollection.itemCount : 0) : activeIds.length)),
            React.createElement('button', {
              className: 'rr-btn rr-btn-small',
              onClick: function () { setTab('library') },
            }, 'Library'),
          ),
          activeRows === null
            ? React.createElement('div', { className: 'rr-hint' },
              'The host returned only counts for this collection. Open the Library tab, or ask the host for member ids.')
            : activeRows.length === 0
              ? React.createElement('div', { className: 'rr-hint' }, 'Empty. Search above, or paste a DOI.')
              : activeRows,
        ),
      ]

      const libraryTab = [
        React.createElement('div', { className: 'rr-section', key: 'recent' },
          React.createElement('div', { className: 'rr-section-title' },
            React.createElement('span', null, 'Recently Found \u00b7 ' + recentIds.length),
            React.createElement('button', { className: 'rr-x', title: 'Clear the staging area', onClick: clearRecent, disabled: recentIds.length === 0 || busy !== '' }, '\u00d7'),
          ),
          React.createElement(RecentlyFoundList, {
            ids: recentIds,
            records: records,
            annotations: annotations,
            collections: library.collections,
            selected: recentSelected,
            busy: busy !== '',
            onToggle: function (id) {
              setRecentSelected(function (prev) {
                const next = Object.assign({}, prev)
                next[id] = prev[id] !== true
                return next
              })
            },
            onOpen: loadDetail,
            onPromote: function (collectionId) {
              const ids = []
              for (let i = 0; i < recentIds.length; i++) if (recentSelected[recentIds[i]] === true) ids.push(recentIds[i])
              if (ids.length > 0) promoteRecent(ids, collectionId)
            },
            onPromoteNew: function (name) {
              const ids = []
              for (let i = 0; i < recentIds.length; i++) if (recentSelected[recentIds[i]] === true) ids.push(recentIds[i])
              if (ids.length === 0) return
              setBusy('Creating collection\u2026')
              setError('')
              post('collections', { op: 'create', name: name, parentId: null }).then(function (res) {
                const created = res && res.collection ? res.collection : null
                if (created === null || typeof created.id !== 'string') {
                  throw new Error('The host did not return the new collection id.')
                }
                return post('recentlyFound', { op: 'promote', ids: ids, collectionId: created.id })
              }).then(function () {
                setRecentSelected({})
                refreshLibrary(false)
              }, function (err) {
                setError(errText(err))
              }).then(function () { setBusy('') })
            },
            onClear: clearRecent,
          }),
        ),
        React.createElement('div', { className: 'rr-section', key: 'tree' },
          React.createElement('div', { className: 'rr-section-title' },
            React.createElement('span', null, 'Collections \u00b7 ' + treeRoots.length),
            React.createElement('button', {
              className: 'rr-btn rr-btn-small',
              onClick: function () { setTab('graph') },
            }, 'Graph'),
          ),
          React.createElement(LibraryTree, {
            roots: treeRoots,
            activeId: activeCollectionId,
            busy: busy !== '',
            onActivate: function (id) { setActiveCollectionId(id); setTab('graph') },
            onCreate: createCollection,
            onRename: renameCollection,
            onDelete: deleteCollection,
          }),
          React.createElement('div', { className: 'rr-hint' },
            'Subcollections are supported; deleting a collection keeps its papers in the library.'),
        ),
        React.createElement('div', { className: 'rr-section', key: 'export' },
          React.createElement('div', { className: 'rr-section-title' }, React.createElement('span', null, 'Export & storage')),
          React.createElement('div', { className: 'rr-export-row' },
            React.createElement('button', {
              className: 'rr-btn rr-btn-small',
              disabled: busy !== '',
              onClick: function () { exportBibtex(activeCollectionId) },
            }, 'Export ' + shorten(activeName, 16) + ' (.bib)'),
            React.createElement('button', {
              className: 'rr-btn rr-btn-small',
              disabled: busy !== '',
              onClick: function () { exportBibtex(null) },
            }, 'Export everything (.bib)'),
            React.createElement('button', {
              className: 'rr-btn rr-btn-small',
              disabled: busy !== '',
              onClick: resetLibrary,
              title: 'Delete every collection, record and note (asks the host for scope:"library")',
            }, 'Reset library'),
          ),
          exportNote.length > 0 ? React.createElement('div', { className: 'rr-hint' }, exportNote) : null,
          exportText.length > 0
            ? React.createElement('textarea', { className: 'rr-export-text', readOnly: true, value: exportText })
            : null,
          library.storePath.length > 0
            ? React.createElement('div', { className: 'rr-hint' }, 'Library file: ' + library.storePath)
            : null,
        ),
      ]

      /* -------------------------------------------------------- right side */

      let detailBody
      if (selected === null) {
        detailBody = React.createElement('div', { className: 'rr-hint' },
          'Select a paper in the graph to read its abstract and authors, or press a paper to pull in the work around it.')
      } else if (loadingDetail) {
        detailBody = React.createElement('div', { className: 'rr-hint' }, 'Loading paper\u2026')
      } else {
        const node = nodeById[selected]
        const cached = records[selected]
        const paper = detail !== null ? detail : cached !== undefined ? cached : null
        const title = paper ? paper.title : node ? node.title : selected
        const year = paper ? paper.year : node ? node.year : 0
        const citedBy = paper ? paper.citedBy : node ? node.citedBy : 0
        const venue = paper ? paper.venue : node ? node.venue : null
        const doi = paper ? paper.doi : node ? node.doi : null
        const authorNames = paper && Array.isArray(paper.authors) ? paper.authors : []
        const authorIds = paper && Array.isArray(paper.authorIds) ? paper.authorIds : []
        let entries = []
        if (Array.isArray(authorList) && authorList.length > 0) entries = authorList
        else if (authorIds.length > 0) {
          entries = authorIds.map(function (authorId, index) {
            return { id: authorId, name: authorNames[index] !== undefined ? authorNames[index] : authorId }
          })
        }
        const shownAuthors = authorNames.length > 8
          ? authorNames.slice(0, 8).join(', ') + ' et al.'
          : authorNames.join(', ')
        const isSeed = inCollection[selected] === true
        const annotation = annotations[selected] !== undefined ? annotations[selected] : {}
        const authorRow = entries.length > 0
          ? React.createElement('div', { className: 'rr-authors' },
            entries.slice(0, 12).map(function (entry, index) {
              return React.createElement('button', {
                key: (entry.id || entry.name || 'a') + ':' + index,
                className: 'rr-author',
                title: 'Pull this author\u2019s most cited work into the graph',
                disabled: busy !== '',
                onClick: function () { expandAuthor(selected, entry.id) },
              }, entry.name + (index < entries.length - 1 ? ',' : ''))
            }),
            entries.length > 12 ? React.createElement('span', null, ' et al.') : null,
          )
          : shownAuthors.length > 0
            ? React.createElement('div', { className: 'rr-authors' }, shownAuthors)
            : null
        detailBody = React.createElement('div', null,
          React.createElement('h2', null, title, isSeed ? React.createElement('span', { className: 'rr-badge' }, 'in collection') : null),
          React.createElement('div', { className: 'rr-detail-meta' },
            [venue, year > 0 ? String(year) : null, citedBy + ' citations'].filter(Boolean).join(' \u00b7 ')),
          authorRow,
          React.createElement('div', { className: 'rr-actions' },
            isSeed
              ? React.createElement('button', { className: 'rr-btn rr-btn-small', onClick: function () { dropSeed(selected) } }, 'Remove from collection')
              : React.createElement('button', { className: 'rr-btn rr-btn-small', disabled: busy !== '', onClick: function () { addPaper(selected) } }, 'Add to collection'),
            React.createElement(SaveToSelect, {
              collections: library.collections,
              marker: 'detail-save',
              disabled: busy !== '',
              onPick: function (collectionId) { saveToCollection(collectionId, [selected]) },
            }),
          ),
          React.createElement('div', { className: 'rr-actions' },
            React.createElement('button', { className: 'rr-btn rr-btn-small', disabled: busy !== '', onClick: function () { expand(selected, 'references') } }, 'References'),
            React.createElement('button', { className: 'rr-btn rr-btn-small', disabled: busy !== '', onClick: function () { expand(selected, 'citations') } }, 'Cited by'),
            React.createElement('button', { className: 'rr-btn rr-btn-small', disabled: busy !== '', onClick: function () { expand(selected, 'related') } }, 'Similar'),
            React.createElement('button', {
              className: 'rr-btn rr-btn-small',
              disabled: busy !== '',
              title: 'References published before this paper',
              onClick: function () { expand(selected, 'earlier') },
            }, 'Earlier'),
            React.createElement('button', {
              className: 'rr-btn rr-btn-small',
              disabled: busy !== '',
              title: 'Papers citing this one that are newer',
              onClick: function () { expand(selected, 'later') },
            }, 'Later'),
          ),
          paper && paper.referenceCount !== undefined
            ? React.createElement('div', { className: 'rr-detail-meta' }, paper.referenceCount + ' references \u00b7 ' + paper.relatedCount + ' similar works on OpenAlex')
            : null,
          React.createElement(NoteEditor, {
            id: selected,
            annotation: annotation,
            busy: busy !== '',
            onSave: function (patch) { saveAnnotation(selected, patch) },
          }),
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

      function tabButton(key, label) {
        return React.createElement('button', {
          key: key,
          className: 'rr-tab' + (tab === key ? ' rr-tab-on' : ''),
          'data-rr': 'tab-' + key,
          onClick: function () { setTab(key) },
        }, label)
      }

      return React.createElement('div', { className: 'rr-root' },
        React.createElement('aside', { className: 'rr-side' },
          React.createElement('div', { className: 'rr-head' },
            React.createElement('span', { className: 'rr-title' }, 'Research Cat'),
            React.createElement('span', { className: 'rr-sub' }, 'Citation graph explorer \u00b7 OpenAlex'),
          ),
          React.createElement('div', { className: 'rr-tabs' }, tabButton('graph', 'Graph'), tabButton('library', 'Library')),
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
          error ? React.createElement('div', { className: 'rr-error', 'data-rr': 'error' }, error) : null,
          library.storeError.length > 0
            ? React.createElement('div', { className: 'rr-warnbar', 'data-rr': 'store-warning' },
              'Library storage: ' + library.storeError)
            : null,
          React.createElement('div', { className: 'rr-scroll' },
            tab === 'library' ? libraryTab : graphTab,
          ),
        ),
        React.createElement('section', { className: 'rr-main' },
          React.createElement('div', { className: 'rr-toolbar' },
            React.createElement('span', { className: 'rr-stats' },
              graph.nodes.length + ' papers \u00b7 ' + graph.links.length + ' links'),
            React.createElement('button', {
              className: 'rr-toggle' + (layoutMode === 'radial' ? ' rr-toggle-on' : ''),
              'data-rr': 'layout-radial',
              title: 'Hub-centred radial layout',
              onClick: function () { setLayoutMode('radial') },
            }, 'Radial'),
            React.createElement('button', {
              className: 'rr-toggle' + (layoutMode === 'timeline' ? ' rr-toggle-on' : ''),
              'data-rr': 'layout-timeline',
              title: 'X = year, Y = citations',
              onClick: function () { setLayoutMode('timeline') },
            }, 'Timeline'),
            React.createElement('button', {
              className: 'rr-toggle' + (showFilters ? ' rr-toggle-on' : ''),
              'data-rr': 'filters-toggle',
              onClick: function () { setShowFilters(showFilters !== true) },
            }, 'Filters'),
            KIND_ORDER.map(function (kind) {
              return React.createElement('button', {
                key: kind,
                className: 'rr-toggle' + (showKinds[kind] === true ? ' rr-toggle-on' : ''),
                'data-rr': 'kind-' + kind,
                onClick: function () { toggleKind(kind) },
              }, KIND_LABEL[kind])
            }),
            React.createElement('button', {
              className: 'rr-btn rr-btn-small',
              disabled: busy !== '',
              title: 'Export the active collection as BibTeX',
              onClick: function () { exportBibtex(activeCollectionId) },
            }, 'BibTeX'),
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
              viewBox: frame.x + ' ' + frame.y + ' ' + frame.w + ' ' + frame.h,
              preserveAspectRatio: 'xMidYMid meet',
              onMouseDown: startPan,
              onMouseMove: onDragMove,
              onMouseUp: endDrag,
              onMouseLeave: endDrag,
            },
              React.createElement('g', {
                transform: 'translate(' + view.x + ',' + view.y + ') scale(' + view.k + ')',
              }, timelineAxis === null ? edgeElements.concat(nodeElements) : [timelineAxis].concat(edgeElements, nodeElements)),
            ),
            graph.nodes.length === 0 ? React.createElement('div', { className: 'rr-empty' },
              React.createElement('div', { className: 'rr-empty-title' }, 'Build a citation graph'),
              React.createElement('div', { className: 'rr-empty-text' },
                'Search for a paper to start a collection, then pull in what it cites, what cites it, and the work OpenAlex considers similar. Try one of these:'),
              recentIds.length > 0 || treeRoots.length > 0
                ? React.createElement('div', { className: 'rr-empty-text' },
                  'Your library is still here (' + recentIds.length + ' in Recently Found) \u2014 open the Library tab, or expand any entry to rebuild the graph.')
                : null,
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
              KIND_ORDER.map(function (kind) {
                return React.createElement('div', { className: 'rr-legend-row', key: kind },
                  React.createElement('span', {
                    className: 'rr-swatch',
                    style: {
                      background: ROLE_STROKE[kind],
                      height: '2px',
                      borderTop: EDGE_DASH[kind] === undefined ? undefined : '2px dashed ' + ROLE_STROKE[kind],
                      backgroundColor: EDGE_DASH[kind] === undefined ? ROLE_STROKE[kind] : 'transparent',
                    },
                  }),
                  KIND_LABEL[kind].toLowerCase())
              }),
              React.createElement('div', { className: 'rr-legend-note' },
                'node size & brightness = citations \u00b7 node ring = your colour'),
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

    exports.name = 'dsh-research-cat'
    exports.inject = ['slots']

    /**
     * Browser plugin body: the stylesheet, the sidebar entry and the panel.
     *
     * @param {import('@deepseek-ai/dsh-client-runtime/client').ClientContext} ctx - client root context.
     */
    exports.apply = async function apply(ctx) {
      ctx.effect(function () {
        const style = document.createElement('style')
        style.setAttribute('data-dsh-research-cat', '')
        style.textContent = CSS
        document.head.appendChild(style)
        return function () { style.remove() }
      }, 'dsh-research-cat: styles')

      ctx.slots.inject('sidebar.panellist', function () {
        return ctx.slots.register(
          { name: 'sidebar.panellist', id: PANEL_KEY, order: 20, label: 'Research Cat' },
          PanelIcon,
        )
      })

      ctx.slots.inject('main', function () {
        return ctx.slots.register({ name: 'main', key: PANEL_KEY }, ResearchCatPanel)
      })
    }

    return module.exports
  },
})
