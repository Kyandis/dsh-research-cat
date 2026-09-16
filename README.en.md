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

## Install

### A. As an installable plugin (recommended)

Research Cat is a standard DSH plugin package: the host half (`exports["."]`) registers the `research_cat` tool and the `/dsh-research-cat` routes inside the host process, and the client half (`exports["./client"]`) registers the sidebar entry and the centre-column panel in the web GUI. **There is no build step** — both halves are plain JS, and the client half calls `window.__ModuleLoader__.load` exactly as the shell requires, with React supplied by the shell's `require`.

```bash
dsh plugin --profile <your-profile> add link:/path/to/dsh-research-cat
```

> ⚠️ **The `desktop` profile is managed exclusively by the DSH desktop application** — the CLI refuses it outright (`rejectElectronProfile` in the launcher). Desktop users should install through the in-app **plugin market** with the source `link:/path/to/dsh-research-cat` (dshmarket supports `link:` and `file:` sources). Other profiles can use the command above.
>
> **Manual path verified to work on desktop** (this is how this repository was installed):
> 1. in the profile directory (`~/.dsh/profiles/desktop`) run `pnpm add "link:/path/to/dsh-research-cat"`
> 2. add `"dsh-research-cat"` to that profile's `dsh.profile.bundles` in `package.json`
> 3. restart DSH
>
> The difference: **the market hot-mounts on install** (its log prints `[dsh-market] hot-mounted <plugin>`), while a manual install loads on the next start.
>
> How to tell it loaded: the sidebar occupant's `registrant` should be **`dsh-research-cat`**. If it starts with `dyn/`, that is a dynamic plugin a session registered temporarily — not this package.

### B. As a dynamic Cordis plugin (`dynamic/`)

`dynamic/` keeps the pure dynamic-plugin form (two function bodies). It needs no install, but it lives only in process memory — **it disappears on a DSH restart** — and loading it goes through an agent approval:

```
Read dynamic/host.js and dynamic/client.js, then:
1) call cordis_define with plugin.kind = "new", code.host = dynamic/host.js, code.client = dynamic/client.js
2) call cordis_run with the returned pluginId / packageId, mode = "run"
```

The client half returns `awaiting-approval`: approve it once on the Run card (a double check mark also authorises future versions). It requires a session that exposes the dynamic Cordis plugin tools.

Either way you end up with a **Research Cat** entry in the sidebar and a `research_cat` tool on the agent.

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

1. **In-memory, nothing on disk.** Neither half calls `fs`, a storage service or `localStorage`; all state is five in-memory containers (`nodes`, `links`, `catalog`, `seeds`, `cache`) inside `apply()`. A restart empties the collection and the graph.
   - Form A (installable plugin) **is itself persistent**: install once and it survives restarts — only the graph is empty.
   - Form B (dynamic plugin) does not even persist its definition: it must be loaded again after a restart.
2. **Retrieval driven through the agent Tool lands in the harness session transcript**; panel-only use never passes through the model.

## Layout algorithm

Not physics tuning — an explainable radial arrangement (`computeLayout` in `src/client.js`):

1. **Hub**: the highest-degree node (ties prefer seeds, then citations) goes to the centre.
2. **BFS layers** from the hub; one radius band per layer.
3. **Role sectors**: within a layer, `references` / `citations` / `related` each get a contiguous angular sector with a 0.2 rad gap — you can see at a glance which side is which.
4. **Ordering**: each sector is sorted by citation count, so the most important papers sit on the inner rings.
5. **Ring capacity** `⌊arc × r / minSpacing⌋` guarantees minimum spacing along a ring; overflow moves outward to the next ring, staggered by half a slot.
6. **Spoke separation**: hub edges are finally pushed apart to a minimum angle of 0.05 rad, which removes near-overlapping lines.

Node size and brightness are normalised by citation count; node stroke encodes the relationship to the collection; seeds and the top 18 papers keep permanent labels (all labels at zoom ≥ 1.8); selecting a node highlights its edges and dims everything unrelated.

## Repository layout

```
package.json               plugin manifest: exports / dsh.bundle.patch / dsh.client
cordis.patch.yml           composition patch: inserts this plugin's row into a profile
src/
  index.js                 host entry (name / inject / apply)
  graph.js                 engine: OpenAlex queries + in-memory graph + 8 operations
  routes.js                /dsh-research-cat JSON routes (panel side, loopback-fenced)
  tools.js                 the research_cat agent tool (defineTool)
  client.js                browser half: __ModuleLoader__ contract + sidebar + panel
  config.js                config resolution
test/local.mjs             local checks: loader contract / live engine / host wiring (33)
dynamic/                   the pure dynamic-plugin archive (host.js / client.js / plugin.json)
lab/                       offline layout lab
preview/                   before/after renders
```

## `lab/` — change the layout and see it immediately

```bash
npm i @resvg/resvg-js
node lab/fetch.mjs graph.json W2907492528 W3152893301   # fetch real data (two seeds)
node lab/render.mjs graph.json old before
node lab/render.mjs graph.json new after
```

`lab/computeLayout.new.js` is the same literal that runs in the plugin, and `lab/render.mjs` prints total edge length, longest edge, minimum hub angle and the **true crossing count** — objective numbers for deciding whether a change actually helped.

## Verify locally

```bash
node test/local.mjs
```

It checks the Loader contract (one registration, only `react` requested, `name`/`inject`/`apply` exported), the config defaults, and the engine against the **live** OpenAlex API (search, add, expand, dedup, remove, clear, bad input). The host wiring checks call `apply()` with a stub context and assert that exactly one tool and one route prefix are registered.

## Roadmap

- [x] Ship an installable plugin package (host tools + routes, browser half on the Loader contract)
- [x] Install it into a `desktop` profile and verify tool, sidebar entry, panel and a clean log across a restart
- [ ] Publish to the DSH plugin market so installation is a single click

## License

[MIT](LICENSE)
