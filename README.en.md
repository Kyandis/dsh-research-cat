# Research Cat · citation network explorer

**English** | [中文](README.md)

A literature-discovery workbench for **DeepSeek Harness**: a sidebar panel plus an agent Tool that **share one library** — the library (collections, Recently Found, notes) is **persisted to disk**, while the citation graph itself is **in memory only**. Search OpenAlex, file papers into collections and subcollections, expand along six axes (references / citations / similar / author / earlier / later), read the result as a radial map or a timeline, and export BibTeX.

```
search → add seeds (≤50) → expand (references / citations / related / earlier / later / author) → explore the graph and details → file into collections / take notes / export BibTeX
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
> How to tell it loaded: the sidebar occupant's `registrant` should be **`dsh-research-cat`**. If it starts with `dyn/`, that is a dynamic plugin a session registered temporarily — not this package. The full post-restart checklist is in [`docs/RELEASE-CHECKLIST.md`](docs/RELEASE-CHECKLIST.md).

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

**A. Driven by the agent** — the `research_cat` Tool has eight actions:

| action | effect |
|---|---|
| `search` | find papers by title / author / topic / DOI; returns OpenAlex matches and work ids such as `W2094864959`; accepts `filters` and `page` |
| `add` | put one paper into the collection (a seed; 50 max) |
| `expand` | pull a paper's neighbours: `references`, `citations`, `related`, `earlier`, `later`, or `author` (needs `authorId`) |
| `list` | list the current collection |
| `collections` | organise the library: `op` = list / create / rename / delete / save / remove (`parentId` creates a subcollection, `ids` batches) |
| `recent` | Recently Found staging area: `op` = list / clear / promote |
| `annotate` | read or write a paper's note, tags and colour (`note` / `tags` / `color`) |
| `export` | BibTeX export (`format:"bibtex"`, optionally `ids` or `collectionId`) |

`search` and `expand` both accept `filters`: `yearFrom` / `yearTo` (closed interval), `venue` (case-insensitive substring), `isOa`, `isRetracted`, `minCitations`, `sort` (`"cited"` default / `"year"`). An invalid filter is rejected with `code: "invalid"` instead of being silently ignored.

**B. Inside the panel** — sidebar → Research Cat:

- two tabs at the top: **Graph** (the citation map) and **Library** (collection tree + Recently Found)
- toolbar: `Auto-expand` (expands **every** seed, not just the first six), `Re-layout`, `Clear` (empties the graph and the system collection, keeps the library), `Radial` / `Timeline` layout switch, `Filters` (years / venue / OA / retracted / minimum citations / sort), `Export` (active collection or everything, as `.bib`)
- Library tab: a multi-level collection tree (create / rename / delete / new subcollection / save into / remove), the Recently Found list (multi-select → file into a collection, one-click clear), and `Reset library` (wipes the whole library, with confirmation)
- detail pane: References / Cited by / Similar / **Earlier** / **Later** buttons, clickable author names (expand by author), a note editor, a tag input and seven colour labels; the footer shows the library file location and any `storeError`

**Both share one library**, so papers added by the agent show up in the panel and vice versa. The comfortable split: let the agent search, seed, expand and file; read the map, open nodes, skim abstracts and take notes yourself.

## How this round maps to Research Rabbit

The item-by-item comparison (including **what is not implemented**, and why) is in [`docs/COMPARISON.md`](docs/COMPARISON.md). What shipped:

| Capability | Notes |
|---|---|
| Author axis | Click an author name, or `expand kind:"author"` → that author's works, cited-descending. OpenAlex sometimes returns `author.id: null` (for example `W2907492528`); the engine then resolves the id through ORCID, and when duplicate profiles share one ORCID it takes the highest `works_count`, breaking ties by the smaller id — deterministic and reproducible |
| Earlier / Later | `earlier` = the seed's references with `year < seed year`; `later` = its citing papers with `year > seed year`. **Strict inequality**: same-year and missing-year (`year = 0`) neighbours are excluded |
| Many seeds | Seed ceiling **50** (matching the Research Rabbit free tier); `expandAll` walks every seed over the chosen axes, one failing seed does not abort the batch (`perSeed[].error`), and re-running is idempotent (`added = 0` the second time) |
| Filters | Year interval / venue substring / open access / retracted / minimum citations / sort; identical semantics on every axis, and the response reports `found` (after filtering) and `considered` (before) honestly |
| Timeline view | X = year, Y = citation count (higher up = more citations); `year = 0` goes into a dedicated “year unknown” band on the far left; the axes carry year and citation ticks |
| Nested collections | Arbitrary depth, one paper may belong to several collections, deleting a collection cascades its subtree but **never deletes papers**, and both `itemCount` (direct members) and `itemCountDeep` (subtree, de-duplicated) are reported |
| Recently Found | Everything that entered the graph and is **not filed in any user collection**; saving into a collection removes it, removing brings it back; ceiling 500, oldest evicted first |
| Notes / tags / colours | One note per paper (≤10000 chars), a tag set (≤20 × ≤40 chars, de-duplicated, order kept), one colour (`red/orange/yellow/green/blue/purple/gray` or `null`); partial updates supported |
| BibTeX export | Fixed type map, unique deterministic citation keys, byte-identical repeated exports, LaTeX escaping, non-ASCII preserved |

**Not implemented (needs a user decision — `docs/COMPARISON.md` §3)**: BibTeX/RIS/CSV **import**, Zotero import, sharing and collaboration, cloud account library, multiple data sources (Crossref / Semantic Scholar), learned recommendations, RR+ advanced search (keyword filters / SJR quartile / journal H-index / 300 seeds / multiple projects), reading status, citation-style copying, Signals risk indicators, mobile / browser extension.

## Data source and quotas

- **OpenAlex public API** (`https://api.openalex.org`) — no API key; every request carries `mailto` (polite pool)
- Quotas (all overridable through plugin config, see §Configuration):
  - **50 search results per page** (`searchPerPage`)
  - **100** references / related / earlier / author per expand (`maxBatch`)
  - citations / later take the **top 100 by citation count** (`maxCitations`, not exhaustive)
  - hard ceiling of **1000 nodes** per graph (`maxNodes`); reaching it refuses further expansion and asks you to clear first
  - **50 seeds** (`maxSeeds`)
  - **4 concurrent requests** (`concurrency`); 8 s per-request timeout; one automatic retry on 429 / 5xx / network errors
- Reference metadata is fetched in **chunks of 50 ids** (OpenAlex's `openalex_id` OR-filter limit), so “100 per expand” is never silently truncated at 50
- `related` is empty for some papers (OpenAlex reports 0); the UI says so rather than inventing data
- **429 note**: keyless OpenAlex requests draw on a **free daily budget shared by your network's egress IP**. When it is spent, every live check returns HTTP 429 (`retry-after` points at the midnight-UTC reset); that is unrelated to the plugin. Offline checks and real-HTTP route checks are unaffected.

### Configuration

Override through the `config` block of `cordis.patch.yml` (or a profile patch layer):

| key | default | meaning |
|---|---|---|
| `exposeTool` | `true` | register the `research_cat` tool |
| `mailto` | `dsh-research-cat@localhost` | OpenAlex polite-pool contact address |
| `searchPerPage` | `50` | search page size |
| `maxBatch` | `100` | references / related / earlier / author per expand |
| `maxCitations` | `100` | citations / later per expand |
| `maxNodes` | `1000` | graph node ceiling |
| `maxSeeds` | `50` | seed ceiling |
| `concurrency` | `4` | concurrent OpenAlex requests |
| `storePath` | `${DSH_HOME:-$HOME/.dsh}/research-cat/library.json` | library file location (see below) |

## The persistent library (library on disk / graph in memory)

This section is the **AC-B1-9** documentation: where the library file lives, how the path is resolved, what happens when it is broken, and how tests must isolate it.

### File and path resolution

Default: **`${DSH_HOME:-$HOME/.dsh}/research-cat/library.json`** (on this machine `DSH_HOME=/Users/<user>/.dsh`, i.e. `~/.dsh/research-cat/library.json`). Resolution is **three levels deep** and never hardcodes a home directory:

1. an explicit `storePath` (a relative path is resolved against `${DSH_HOME:-$HOME/.dsh}`)
2. otherwise a non-empty `$DSH_HOME` → `${DSH_HOME}/research-cat/library.json`
3. otherwise `os.homedir() + '/.dsh/research-cat/library.json'`

Persisted content: `records` (work metadata cache), `collections` + `memberships` (nested collections and multi-membership), `recentlyFound`, `annotations` (notes / tags / colours), `version`, `savedAt`. **Citation edges (nodes/links) are not persisted** — after a restart the library is back and the graph is empty; expanding any entry rebuilds the neighbourhood (edges can always be recomputed from OpenAlex, and persisting them would only add stale edges and bulk).

Write strategy: temporary file + `fsync` + `rename` (so at any instant the file on disk is either the complete old version or the complete new one); 300 ms debounce with a 2 s maximum wait, coalesced on one serial chain; destructive operations such as `clear` write through immediately; the plugin flushes on unload.

### Broken files and degradation

| Situation | Behaviour |
|---|---|
| file absent | treated as a brand-new library; the default structure (including the system collection `seeds`) is written; `storeError: null` |
| corrupt / truncated / empty JSON | the file is renamed to `library.json.bak-<timestamp>`, an empty library starts, and `storeError` names the path and the reason (**no silent data loss, no crash**) |
| `version` newer than this build | same as above (`.bak` + empty library + `storeError`); no speculative parsing |
| broken invariants (dangling members / cycles / duplicates) | best-effort repair (drop dangling entries, restore the system collection, break cycles); the repair count goes into `storeError` and the repaired library is written immediately |
| `storePath` not writable | degrades to a pure in-memory library plus `storeError`; **plugin loading never fails** |

`storeError` is exposed as `library.storeError` on `/state`, shown as a warning bar at the top of the panel, and the library file location is shown in the panel footer.

### Tests must isolate storePath (important)

The library is a **real file shared by the whole process**: any test that calls `createLibrary(defaults)` or `POST /state` without isolating the path will read and write the **user's real library**.

Rules:

- tests and scripts must pass an explicit `storePath` (pointing into `os.tmpdir()`), or point `DSH_HOME` at a temporary directory before the process starts;
- the bundled suites are sealed: `test/local.mjs` points `DSH_HOME` at a fresh temporary directory before importing any module and gives the engine and the host half separate `storePath`s; `test/parity.mjs` also points `DSH_HOME` at a temporary directory and passes an explicit `storePath` to every library;
- `test/local.mjs` ends by asserting that the **user's real library was neither created nor modified**.

Reproducible verification (AC-B1-9):

```bash
# 1) sealing: run the whole suite; the real-library fingerprint is printed and the seal check passes
node test/local.mjs | tail -6
#   expected (offline / quota available):
#     PASS seal: the user's real ~/.dsh/research-cat/library.json was neither created nor modified by this run
#     sealed run: DSH_HOME=/var/folders/.../dsh-research-cat-XXXX  engineStore=/var/folders/.../engine/library.json
#     real library fingerprint: (absent)          <- or a sha256 if you really have one
#     local: all checks passed

# 2) sealing + persistence sections only (skip the live section)
node test/local.mjs 2>&1 | grep -E "seal:|AC-B1-"

# 3) path resolution, without touching any real file
DSH_HOME=/tmp/dsh-rc-demo node -e "import('./src/config.js').then(m => console.log(m.resolveConfig(undefined).storePath))"
#   expected: /tmp/dsh-rc-demo/research-cat/library.json
```

## Important limitations

1. **Library persistent, graph temporary.** Collections, subcollections, Recently Found, notes, tags, colours and work metadata live in `library.json`; citation edges (nodes / links) are in memory, so the graph is empty after a restart.
2. **Retrieval driven through the agent Tool lands in the harness session transcript**; panel-only use never passes through the model.
3. **Export only, no import.** BibTeX/RIS/CSV import and the Zotero importer need a file-upload channel or third-party OAuth, so they are “pending user decision” items (`docs/COMPARISON.md` §3).
4. **Single-file JSON size ceilings**: the library protects itself at 20000 records / 40000 memberships / 20000 annotations / 500 staging entries; beyond that it refuses new entries with a readable error. Reaching the tens of thousands would justify SQLite (a new dependency, i.e. a decision item).
5. **Two DSH instances sharing one `storePath` are last-writer-wins** (no lock file this round).
6. **OpenAlex's free budget is shared per egress IP**: once spent, every live operation returns 429 (`retry-after` points at the midnight-UTC reset).

## Layout algorithm

Not physics tuning — an explainable radial arrangement (`computeRadialLayout` in `src/client.js`):

1. **Hub**: the highest-degree node (ties prefer seeds, then citations) goes to the centre.
2. **BFS layers** from the hub; one radius band per layer.
3. **Role sectors**: within a layer, `seed` / `references` / `citations` / `related` / `earlier` / `later` / `author` each get a contiguous angular sector with gaps — you can see at a glance which side is cited-by and which is by-author.
4. **Ordering**: each sector is sorted by citation count, so the most important papers sit on the inner rings.
5. **Ring capacity** `⌊arc × r / minSpacing⌋`, and neighbouring nodes on a ring are at least the sum of their radii apart, so a ring never overlaps; overflow moves outward to the next ring (the radius keeps growing instead of being clamped), staggered by half a slot.
6. **Spoke separation**: hub edges are finally pushed apart to a minimum angle of 0.05 rad, which removes near-overlapping lines.
7. **Adaptive viewport**: when the layout exceeds 1200×800, `layoutExtent` grows the SVG `viewBox` symmetrically — a large graph is fully visible (smaller, but zoomable).

The timeline view (`computeTimelineLayout`) is a second pure function: X is monotone in year (equal years share one X), Y is monotone in citation count (more citations → higher up), and `year = 0` goes into a fixed-width “year unknown” band on the far left instead of being dropped; the axes are built by `timelineTicks`.

Node size and brightness are normalised by citation count; node stroke and line style distinguish the six edge kinds (`references` / `citations` / `related` / `earlier` / `later` / `author`, each with its own toggle); seeds and the top 18 papers keep permanent labels (all labels at zoom ≥ 1.8); selecting a node highlights its edges and dims everything unrelated.

## Verify locally

```bash
node test/local.mjs        # host end to end: loader contract / config defaults / engine (offline stubs + live OpenAlex) / persistence / host wiring over real HTTP
node test/parity.mjs       # the frozen spec's AC judges (139 checks, offline fetch stubs by default; the live smoke is reported separately and never counted as a failure)
node test/client.mjs       # client layout and panel (38 checks)
node lab/client-check.mjs  # panel self-test: loader contract + @parity pure functions + real render/interaction (91 checks)
```

Expected (with quota available): all four commands exit 0, `local.mjs` ends with `local: all checks passed`, and `parity.mjs` prints `parity: 139 passed, 0 failed`.

Part of `test/local.mjs` is **live network** (AC-A1/A3/A5 and friends). When the OpenAlex free budget is spent those checks are reported as `FAILED` per spec §10.4 (never downgraded to a pass), so the output looks like `local: 26 check(s) FAILED` while the offline and real-HTTP route sections stay green. Once the quota resets (midnight UTC), or through a keyed egress, the full green run is reproducible.

`test/parity.mjs` can prove its own discriminating power (all red, then all green):

```bash
git stash push -u -- src/ && node test/parity.mjs; echo "exit=$?"; git stash pop
# expected: exit=1 in the stashed state (a per-AC failure list), and the working tree restored after pop
```

## Repository layout

```
package.json               plugin manifest: exports / dsh.bundle.patch / dsh.client
cordis.patch.yml           composition patch: inserts this plugin's row into a profile (all nine config keys)
src/
  index.js                 host entry (name / inject / apply; awaits the library, flushes on dispose)
  graph.js                 engine: OpenAlex queries + in-memory graph + persistent library + six axes + filters + export
  store.js                 library file: path resolution / atomic write / debounce / version and corruption fallback
  bibtex.js                BibTeX rendering (pure: type map / escaping / citation keys)
  routes.js                /dsh-research-cat JSON routes (13, loopback-fenced)
  tools.js                 the research_cat agent tool (8 actions)
  client.js                browser half: __ModuleLoader__ contract + sidebar + panel (radial / timeline)
  config.js                config resolution (nine frozen keys)
test/
  local.mjs                host end-to-end local verification (sealed: DSH_HOME points into a temp dir)
  parity.mjs               the frozen spec's AC judges (offline-first + stash counter-proof)
  client.mjs               client layout and panel assertions
  AC-EVIDENCE.md           AC → status → evidence table (t5 verification artefact)
  evidence/                raw outputs kept on disk
  a0-baseline-check.mjs    independent A0 baseline probe
  findings-probe.mjs       findings reproduction probe
docs/
  rr-parity-spec.md        frozen acceptance spec (AC judges + interface contract)
  rr-parity-design.md      implementation design
  COMPARISON.md            item-by-item comparison with Research Rabbit (including what is missing)
  RELEASE-CHECKLIST.md     install and post-restart self-check list
dynamic/                   the pure dynamic-plugin archive (host.js / client.js / plugin.json)
lab/                       offline layout lab + panel self-test (client-check.mjs)
preview/                   before/after renders
```

## `lab/` — change the layout and see it immediately

```bash
npm i @resvg/resvg-js
node lab/fetch.mjs graph.json W2907492528 W3152893301   # fetch real data (two seeds)
node lab/render.mjs graph.json old before
node lab/render.mjs graph.json new after
node lab/client-check.mjs                               # panel self-test (loader contract / pure functions / real render)
```

`lab/computeLayout.new.js` is the same literal that runs in the plugin, and `lab/render.mjs` prints total edge length, longest edge, minimum hub angle and the **true crossing count** — objective numbers for deciding whether a change actually helped. `lab/client-check.mjs` extracts the **real pure functions shipped in `src/client.js`** from their `@parity:` marker blocks (radial / timeline / ticks / collection forest) and drives a real render of the panel through a mini hook runtime.

## Roadmap

- [x] Ship an installable plugin package (host tools + routes, browser half on the Loader contract)
- [x] Install it into a `desktop` profile and verify tool, sidebar entry, panel and a clean log across a restart
- [x] One Research Rabbit parity round: author axis / earlier-later / many seeds (≤50) / filters / timeline view / nested collections / Recently Found / notes-tags-colours / BibTeX export / persistent library
- [ ] Publish to the DSH plugin market so installation is a single click
- [ ] Pending user decisions: import (BibTeX/RIS/CSV, Zotero), collaboration, cloud account, multiple sources, learned recommendations, RR+ advanced search

## License

[MIT](LICENSE)
