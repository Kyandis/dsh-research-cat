# Research Cat · citation network explorer

**English** | [中文](README.md)

A literature-discovery workbench for **DeepSeek Harness**: a sidebar panel plus an agent Tool that **share one in-memory graph**. Search OpenAlex, collect papers, expand them into references / citing papers / similar work, and read the resulting citation network on a layout that is arranged by structure instead of by physics.

```
search → add to collection → expand (references / citations / related) → explore the graph and details
```

## Preview

| Before (force-directed) | After (radial) |
|---|---|
| ![before](preview/before-101-nodes.png) | ![after](preview/after-101-nodes.png) |

> These are **not screenshots** — they are offline layout renders produced by `lab/render.mjs` (approximate theme colours, so the layout itself is what you judge). The data is real: two seeds contributing 29 references + 10 related + 25 citing papers each, 101 nodes / 118 links. Measured on that graph: total edge length 28456 → 11516 px, edge crossings **6 → 0**, minimum hub angle 0.0° → 2.9°.

## How to load it

Research Cat is a **dynamic Cordis plugin** — two function bodies that register a Tool and UI through the `harness` builtins. It therefore **cannot be `npm install`ed**; you load it by asking **your own DSH agent** to register it into the running process:

```
Read host.js and client.js from this repository, then:
1) call cordis_define with plugin.kind = "new", code.host = the full contents of host.js,
   code.client = the full contents of client.js
2) call cordis_run with the returned pluginId / packageId, mode = "run"
```

Requirement: your DSH session exposes the dynamic Cordis plugin tools (`cordis_define`, `cordis_run`, `cordis_inspect_self`), i.e. it runs under an agent preset with that capability.

The client half returns `awaiting-approval`: approve it once on the Run card in the conversation (a double check mark also authorises future versions of the same plugin).

Once loaded: a **Research Cat** icon appears in the sidebar (order 20) and the agent gains a `research_cat` tool.

## Usage

**A. Driven by the agent** — the `research_cat` Tool has four actions:

| action | effect |
|---|---|
| `search` | find papers by title / author / topic / DOI; returns OpenAlex matches and work ids such as `W2094864959` |
| `add` | put one paper into the collection |
| `expand` | pull a paper's neighbours: `references`, `citations`, or `related` |
| `list` | list the current collection |

**B. Inside the panel** — sidebar → Research Cat: search box and example chips, `Add` on any result, toolbar with `Auto-expand` / `Re-layout` / `Clear` and three edge-kind toggles, click a node for the detail pane (title, year, citations, authors, and an abstract reconstructed from OpenAlex's inverted index).

**Both share one in-memory library**, so papers added by the agent show up in the panel and vice versa.

## Data source and quotas

- **OpenAlex public API** (`https://api.openalex.org`) — no API key
- 20 search results per page; 30 references / related per expand; citations capped at the **top 25 by citation count** (not exhaustive)
- Hard ceiling of **400 nodes** per graph
- `related` is empty for some papers (OpenAlex reports 0); the UI says so rather than inventing data

## Important limitations

1. **Not a persistent plugin.** Dynamic Cordis plugins live only in the current DSH process and **disappear on a DSH restart** (twice within four hours during this project's development). Just load it again from these same two files.
2. **The plugin writes nothing to disk.** Neither half calls `fs`, a storage service or `localStorage`; all state is five in-memory containers (`nodes`, `links`, `catalog`, `seeds`, `cache`) inside the `apply()` closure. Note however that retrieval driven through the agent Tool does land in the harness session transcript; panel-only use never passes through the model.
3. The collection and graph are memory-only and reset with the process.

## Layout algorithm

Not physics tuning — an explainable radial arrangement (`computeLayout` in `client.js`):

1. **Hub**: the highest-degree node (ties prefer seeds, then citations) goes to the centre.
2. **BFS layers** from the hub; one radius band per layer.
3. **Role sectors**: within a layer, `references` / `citations` / `related` each get a contiguous angular sector with a 0.2 rad gap — you can see at a glance which side is which.
4. **Ordering**: each sector is sorted by citation count, so the most important papers sit on the inner rings.
5. **Ring capacity** `⌊arc × r / minSpacing⌋` guarantees minimum spacing along a ring; overflow moves outward to the next ring, staggered by half a slot.
6. **Spoke separation**: hub edges are finally pushed apart to a minimum angle of 0.05 rad, which removes near-overlapping lines.

Node size and brightness are normalised by citation count; node stroke encodes the relationship to the collection; seeds and the top 18 papers keep permanent labels (all labels at zoom ≥ 1.8); selecting a node highlights its edges and dims everything unrelated.

## Repository layout

```
host.js        backend: 8 panel handlers + the research_cat agent Tool + OpenAlex access
client.js      frontend: sidebar icon / main panel / Run card — three slots
plugin.json    manifest: slots, handlers, tool name, quotas, layout params and measurements
lab/           offline layout lab
preview/       before/after renders
```

## `lab/` — change the layout and see it immediately

```bash
npm i @resvg/resvg-js
node lab/fetch.mjs graph.json W2907492528 W3152893301   # fetch real data (two seeds)
node lab/render.mjs graph.json old before
node lab/render.mjs graph.json new after
```

`lab/computeLayout.new.js` is the same literal that runs in the plugin, and `lab/render.mjs` prints total edge length, longest edge, minimum hub angle and the **true crossing count** — objective numbers for deciding whether a change actually helped.

## Roadmap

- [ ] Ship an **installable** build (TypeScript + tsdown, `dsh.bundle.patch`, a separate client bundle) so that `npm i` plus a line in the profile's `dsh.profile.bundles` is enough — and it survives restarts.

## License

[MIT](LICENSE)
