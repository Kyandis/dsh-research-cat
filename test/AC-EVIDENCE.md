# t5 验收证据 — dsh-research-cat × Research Rabbit parity

- **任务**：t5（verification，attempt 1）· 验证者：verify
- **判据**：`docs/rr-parity-spec.md`（冻结版，A0–A7 / B1–B4 / C 档排除式，共 **99 条 AC**）
- **仓库**：`/Users/depengwang/DSH/dsh-research-cat`，git HEAD `9a1bd7d` + 本轮工作树改动
- **结论**：99 条 AC **全部**有可执行断言或可复现命令；87 passed、9 passed（当前配额窗口内重跑为真实 429，见 §6）、2 partial（F6/F7，已上报）、1 not covered（AC-B1-9 属 t8 README 交付）

---

## 1. 方法与隔离

1. **只改 `test/`**：本轮 t5 的代码改动只有 `test/local.mjs`（重基线 3 条陈旧断言 + 密封 + 失败路径 + 真实网络取证 + 面板源级断言）与新增 `test/make-evidence.mjs`（本报告生成器）。`src/`、`docs/`、`dynamic/` 未动。
2. **密封（先做，后采证）**：`test/local.mjs` 在任何模块解析 store 路径之前把 `DSH_HOME` 指向 `os.tmpdir()` 下的新目录；engine 段用 `engineStore`、host.apply 段用 `hostStore`（都在 tmp 下）；最后一条断言比较用户真实库 `~/.dsh/research-cat/library.json` 的 exists/size/mtime/sha256 在运行前后完全一致。
3. **独立验证而非复述**：`test/parity.mjs`（t3 产物）作为交叉证据单独运行；本报告另用**独立脚本**核对 t10 基线拆分、t9 的 F2/F3/F5，并对关键 AC 在 `test/local.mjs` 中重写断言（不 import parity.mjs 的任何结论）。
4. **真实网络保留**：`test/local.mjs` 的 live 段对 OpenAlex 发真实请求（`W2907492528` 的 search / addSeed / references / citations / details / authors / author 轴 / earlier / later）。离线可判定部分用注入桩。

## 2. 可复现命令与真实输出

### 2.1 `node test/local.mjs` — 密封后全绿（2026-09-19T08:11Z，OpenAlex 配额可用窗口）

> 当时 `test/local.mjs` sha256 = `56675ba3ad81d61e50b9f8208d9b6042eb52e25f447545fd7305000eb107a443`
> `142 PASS / 0 FAIL / 1 GAP / exit 0`，且真实库 sha256 运行前后均为 `1eda7992…`（未被创建或修改）。

```
  PASS client registers exactly one Loader module
  PASS loader id is the package name
  PASS client only requires react from the shell
  PASS client exports name
  PASS client injects slots
  PASS client exports apply
  PASS config defaults
  PASS AC-A5-1 the frozen config default set is complete and resolves storePath under DSH_HOME
  PASS config overrides + bad values fall back
  PASS AC-A5-6 every quota key can be overridden and the override is recorded
  PASS AC-B1-8 storePath level 2: DSH_HOME decides the default path (no hardcoded home)
  PASS AC-B1-8 storePath level 1: an explicit absolute storePath wins over DSH_HOME
  PASS AC-B1-8 storePath level 1: a relative storePath resolves against DSH_HOME
  PASS AC-B1-8 storePath level 3: with DSH_HOME unset the default falls back to <homedir>/.dsh (pure resolution, no IO)
  PASS uniqueWorkIds normalises and de-duplicates
  PASS AC-B1-8 the sealed engine storePath is the explicit config path under os.tmpdir()
  PASS fresh state is empty
  PASS search returns OpenAlex matches
  PASS search results carry work ids
  PASS AC-A5-2 search asks OpenAlex for per-page=50 and returns at most 50 rows
  PASS AC-A5-7 every OpenAlex request carries the polite-pool mailto
  PASS blank query is rejected
  PASS addSeed collects the paper
  PASS addSeed reports the record
  PASS expand pulls references
  PASS expand respects the batch cap
  PASS AC-A5-3 references beyond OpenAlex's 50-id filter limit are fetched in chunks (found > 50 needs >= 2 requests)
  PASS AC-A5-3 the chunking helper splits 100 ids into 2 chunks and never truncates silently
  PASS re-expanding adds nothing (dedup)
  PASS expand pulls citing papers
  PASS AC-A5-4 citations expand returns at most maxCitations
  PASS details returns authors + abstract
  PASS details reconstructs the abstract
  PASS state snapshots nodes and links
  PASS AC-A1-1 /authors returns the probe paper's OpenAlex author ids in authorships order
  PASS AC-A1-1 the probe paper's authorships carry author.id === null upstream, so the ORCID fallback is the legal path
  PASS AC-A1-2 the author axis links the probe paper to the author's works (kind author, source = probe id)
  PASS AC-A1-3 the author axis returns works with citedBy monotonically non-increasing
  PASS AC-A1-4 kind author without authorId is rejected with a usable hint (never silently picks the first author)
  PASS AC-A3-1 earlier returns only nodes strictly older than the seed (edge kind earlier)
  PASS AC-A3-2 later returns only nodes strictly newer than the seed (edge kind later)
  PASS removeSeed drops the seed and its exclusive neighbours
  PASS clear empties everything
  PASS bad work id is rejected
  PASS AC-A2-1 addSeed accepts 50 seeds and rejects the 51st with the ceiling in the message
  PASS AC-A2-1 the seed ceiling is configurable (maxSeeds=2 rejects the third seed with the ceiling in the message)
  PASS AC-A2-4 expandAll keeps at most 4 concurrent OpenAlex requests for 3 seeds x 2 axes
  PASS AC-A2-5 expandAll is idempotent: the second run adds nothing and does not change counts.papers
  PASS AC-A2-3 a failing seed is isolated: perSeed carries the error, the other seed still expands, skipped counts it
  PASS AC-A5-5 expanding past maxNodes is refused with a readable "clear it" message and never half-writes
  PASS AC-A2-6 expandAll reports skipped > 0 at the ceiling without throwing and keeps counts.papers <= maxNodes
  PASS AC-A3-3 earlier excludes the same-year and year===0 neighbours (strict comparison)
  PASS AC-A3-3 an empty earlier/later result returns found:0 as a success, not an error
  PASS AC-A1-5 the author axis obeys filters and the batch cap
  PASS AC-A4-6 found reports the post-filter count, never the unfiltered count
  PASS AC-A4-4 isOa/isRetracted filter on the new boolean record fields (never null)
  PASS AC-A4-4 isRetracted:true returns only retracted works and the field is a real boolean
  PASS AC-A4-3 venue matches case-insensitively by substring and venue:"" means "not provided"
  PASS AC-A4-8 filtering is deterministic: the same input yields the same id sequence
  PASS AC-A4-7 unknown keys, non-booleans, negative minimums and illegal sort are all invalid errors
  PASS AC-A4-2 yearFrom > yearTo is invalid instead of an empty success
  PASS AC-A4-2 yearFrom/yearTo are closed intervals (boundary years included)
  PASS normalizeFilters/applyFilters are pure and shared by every axis
  PASS AC-A1-1 the ORCID fallback is deterministic: richest profile wins, ties go to the smaller author id
  PASS AC-A1-2 an author-axis expand works offline through the same code path
  PASS AC-B1-1 a restart on the same storePath restores collections, memberships, annotations and Recently Found field-for-field
  PASS AC-B1-1 the exploration graph itself is temporary: a restart has 0 papers/links while the saved collection membership survives
  PASS AC-B3-7 Recently Found survives the restart
  PASS AC-B1-2 an injected write failure leaves the old complete JSON on disk (never a truncated file)
  PASS AC-B1-2 no temporary file is left behind after a failed write
  PASS AC-B1-2 the failed write is surfaced as a storeError instead of crashing
  PASS AC-B1-3 AC-B1-4 an unknown version or a corrupt/empty/truncated file starts from an empty library with a readable storeError and keeps a .bak
  PASS AC-B1-3 the current version constant is 1
  PASS AC-B1-5 five quick writes collapse into one disk write (debounced) and flush is a no-op afterwards
  PASS AC-B1-7 without network the persisted library still loads and only network operations fail
  PASS AC-B1-8 an unwritable storePath degrades to an in-memory library with a readable storeError (the plugin still loads)
  PASS AC-B2-1 collections list returns the tree shape and the system collection
  PASS AC-B2-2 collections nest at least three levels deep and a missing parent is refused
  PASS AC-B2-3 rename keeps the tree shape and duplicate names are allowed
  PASS AC-B2-6 AC-B2-7 one paper can belong to several collections and unknown ids are reported as skipped, never silently accepted
  PASS AC-B2-8 itemCount counts direct members and itemCountDeep counts the subtree
  PASS AC-B2-4 AC-B2-5 deleting a parent cascades its subtree but never deletes the papers
  PASS AC-B2-4 after deleting its only user collection the paper is back in Recently Found
  PASS AC-B3-1 AC-B3-2 Recently Found is a de-duplicated, most-recent-first list and a fresh addSeed lands first
  PASS AC-B3-4 promoting into a collection removes the id from Recently Found; removing it from the last collection brings it back
  PASS AC-B3-5 clearing Recently Found keeps the library articles and collection members
  PASS AC-B4-1 a partial annotate update leaves tags and colour untouched
  PASS AC-B4-2 a note over 10000 characters is rejected, not truncated
  PASS AC-B4-3 tags are de-duplicated in order, capped at 20, and 41-character tags are rejected
  PASS AC-B4-4 the colour enum is fixed, an illegal colour lists the legal values, and null clears it
  PASS AC-B4-6 annotating an unknown work id is refused (never invents a paper)
  PASS AC-A7-2 the BibTeX output parses into the same number of entries and every entry has title + year
  PASS AC-A7-2 parsed titles/years match the graph data
  PASS AC-A7-3 author is joined with " and " and never emitted empty
  PASS AC-A7-4 every entry carries doi or url (url always points at OpenAlex)
  PASS AC-A7-5 citation keys are unique, deterministic and byte-identical across two exports
  PASS AC-A7-6 the type map is the frozen one
  PASS AC-A7-7 LaTeX specials are escaped and non-ASCII stays untouched
  PASS AC-A7-8 an empty export is a legal comment-only BibTeX document with count 0
  PASS AC-A7-1 export returns {format, count, bibtex} for the graph and for a collection
  PASS AC-B4-9 annotations never leak into the BibTeX export
  PASS host name matches the package
  PASS host injects tools + webServer
  PASS apply registers exactly one agent tool
  PASS tool is named research_cat
  PASS tool exposes the four actions
  PASS AC-A0-3 the four original actions are still the first four enum entries (additive change only)
  PASS AC-A0-3 the tool output schema is still {ok, text}
  PASS AC-A0-3 the kind enum keeps the three original axes first and adds the three new ones
  PASS action is a required parameter
  PASS apply registers one route prefix
  PASS route path is the one the panel calls
  PASS route handler is callable
  PASS AC-B1-8 the host half uses the explicit storePath under os.tmpdir()
  PASS tool list action answers before anything is collected
  PASS schema rejects an action outside the enum
  PASS AC-A0-4 the tool list wording still reports the collection and graph totals
  PASS exposeTool:false registers no tool
  PASS exposeTool:false still registers the routes
  PASS AC-A0-4 /state returns the frozen graph/counts/library envelope over real HTTP
  PASS failure path: an illegal work id is HTTP 400 invalid
  PASS failure path: an empty search query is HTTP 400 invalid
  PASS failure path: a nonexistent collection is HTTP 400 invalid
  PASS AC-A4-2 route probe: yearFrom > yearTo is rejected as invalid, not an empty success
  PASS AC-B4-4 route probe: an illegal colour lists the frozen enum
  PASS AC-B4-6 route probe: annotating an unknown id is invalid
  PASS AC-A7-1 route probe: /export returns {format, count, bibtex}
  PASS AC-A7-8 route probe: an empty export is a success with count 0
  PASS AC-A0-6 route probe: a cross-site Origin is refused with 403 forbidden (loopback fence intact)
  PASS AC-A0-6 route probe: a non-JSON content-type is refused with 415
  PASS route probe: GET /dsh-research-cat answers the identity probe
  PASS AC-A0-2 route probe: expand still accepts references/citations/related and returns the frozen field set
  PASS the unknown-route 404 behaviour is unchanged
  PASS AC-A0-7 route probe: /clear empties papers and seeds
  PASS failure path: expanding past maxNodes is HTTP 200 with ok:false and code operation (a result, not a crash)
  PASS AC-C-1 no C-tier feature term appears in the host source
  PASS AC-C-1 the route table is exactly the frozen set (no C-tier route slipped in)
  PASS AC-C-2 the design doc references spec §8 and declares the C tier as not implemented / user-decision
  PASS AC-A2-7 (partial) Auto-expand calls the new expandAll and surfaces skipped/failed request counts
  GAP  AC-A2-7 gap: Auto-expand never displays the number of seeds expanded (only added/failed/skipped) -> finding F6 — see test/AC-EVIDENCE.md
  PASS AC-A0-1 every pre-t5 check label is still present and the suite only grew
  PASS coverage: every frozen spec AC id is referenced by test/local.mjs or test/parity.mjs
  PASS seal: the user's real ~/.dsh/research-cat/library.json was neither created nor modified by this run

sealed run: DSH_HOME=/var/folders/qy/tzfphq9d0y9gjvff7z8407nw0000gn/T/dsh-research-cat-local-VEf48l/home  engineStore=/var/folders/qy/tzfphq9d0y9gjvff7z8407nw0000gn/T/dsh-research-cat-local-VEf48l/engine/library.json
real library fingerprint: 1eda7992be8a8b54c66ad473e2bd935f679622a66cdb29ddbba4a5edd01dc9b9
reported gaps (not counted as passes): AC-A2-7 gap: Auto-expand never displays the number of seeds expanded (only added/failed/skipped)

local: all checks passed
```

### 2.2 `node test/local.mjs` — 当前重跑（OpenAlex 共享免费日预算耗尽 → 真实 429）

> `131 PASS / 26 FAIL / 2 GAP / exit 1`。26 条 FAIL **全部**来自 live OpenAlex 段，错误为真实的 `HTTP 429`；离线 + 真实 HTTP 路由段全绿，脚本没有崩溃（新加的 `LIVE_LABELS` 兜底把未跑到的网络 AC 标为 failed，符合 spec §10.4“不可达必须 failed，不得 passed”）。见 §6。

```
  PASS client registers exactly one Loader module
  PASS loader id is the package name
  PASS client only requires react from the shell
  PASS client exports name
  PASS client injects slots
  PASS client exports apply
  PASS config defaults
  PASS AC-A5-1 the frozen config default set is complete and resolves storePath under DSH_HOME
  PASS config overrides + bad values fall back
  PASS AC-A5-6 every quota key can be overridden and the override is recorded
  PASS AC-B1-8 storePath level 2: DSH_HOME decides the default path (no hardcoded home)
  PASS AC-B1-8 storePath level 1: an explicit absolute storePath wins over DSH_HOME
  PASS AC-B1-8 storePath level 1: a relative storePath resolves against DSH_HOME
  PASS AC-B1-8 storePath level 3: with DSH_HOME unset the default falls back to <homedir>/.dsh (pure resolution, no IO)
  PASS uniqueWorkIds normalises and de-duplicates
  PASS AC-B1-8 the sealed engine storePath is the explicit config path under os.tmpdir()
  PASS fresh state is empty
  FAIL search reaches OpenAlex -> OpenAlex answered HTTP 429.
  FAIL AC-A5-2 search asks OpenAlex for per-page=50 and returns at most 50 rows -> {"searchUrls":["https://api.openalex.org/works?search=graph+neural+networks&select=id%2Cdoi%2Ctitle%2Cdisplay_name%2Cpublication_year%2Ccited_by_count%2Ctype%2Cprimary_location%2Copen_access%2Cis_retracted&per-page=50&page=1&sort=cited_by_count%3Adesc&mailto=dsh-research-cat%40localhost","https://api.openalex.org/works?search=graph+neural+networks&select=id%2Cdoi%2Ctitle%2Cdisplay_name%2Cpublication_year%2Ccited_by_count%2Ctype%2Cprimary_location%2Copen_access%2Cis_retracted&per-page=50&page=1&sort=cited_by_count%3Adesc&mailto=dsh-research-cat%40localhost"],"rows":null}
  PASS AC-A5-7 every OpenAlex request carries the polite-pool mailto
  PASS blank query is rejected
  NOTE the live OpenAlex block aborted: OpenAlex answered HTTP 429.
  FAIL search returns OpenAlex matches -> live OpenAlex block aborted: OpenAlex answered HTTP 429.
  FAIL search results carry work ids -> live OpenAlex block aborted: OpenAlex answered HTTP 429.
  FAIL addSeed collects the paper -> live OpenAlex block aborted: OpenAlex answered HTTP 429.
  FAIL addSeed reports the record -> live OpenAlex block aborted: OpenAlex answered HTTP 429.
  FAIL expand pulls references -> live OpenAlex block aborted: OpenAlex answered HTTP 429.
  FAIL expand respects the batch cap -> live OpenAlex block aborted: OpenAlex answered HTTP 429.
  FAIL AC-A5-3 references beyond OpenAlex's 50-id filter limit are fetched in chunks (found > 50 needs >= 2 requests) -> live OpenAlex block aborted: OpenAlex answered HTTP 429.
  FAIL AC-A5-3 the chunking helper splits 100 ids into 2 chunks and never truncates silently -> live OpenAlex block aborted: OpenAlex answered HTTP 429.
  FAIL re-expanding adds nothing (dedup) -> live OpenAlex block aborted: OpenAlex answered HTTP 429.
  FAIL expand pulls citing papers -> live OpenAlex block aborted: OpenAlex answered HTTP 429.
  FAIL AC-A5-4 citations expand returns at most maxCitations -> live OpenAlex block aborted: OpenAlex answered HTTP 429.
  FAIL details returns authors + abstract -> live OpenAlex block aborted: OpenAlex answered HTTP 429.
  FAIL details reconstructs the abstract -> live OpenAlex block aborted: OpenAlex answered HTTP 429.
  FAIL state snapshots nodes and links -> live OpenAlex block aborted: OpenAlex answered HTTP 429.
  FAIL AC-A1-1 /authors returns the probe paper's OpenAlex author ids in authorships order -> live OpenAlex block aborted: OpenAlex answered HTTP 429.
  FAIL AC-A1-1 the probe paper's authorships carry author.id === null upstream, so the ORCID fallback is the legal path -> live OpenAlex block aborted: OpenAlex answered HTTP 429.
  FAIL AC-A1-2 the author axis links the probe paper to the author's works (kind author, source = probe id) -> live OpenAlex block aborted: OpenAlex answered HTTP 429.
  FAIL AC-A1-3 the author axis returns works with citedBy monotonically non-increasing -> live OpenAlex block aborted: OpenAlex answered HTTP 429.
  FAIL AC-A1-4 kind author without authorId is rejected with a usable hint (never silently picks the first author) -> live OpenAlex block aborted: OpenAlex answered HTTP 429.
  FAIL AC-A3-1 earlier returns only nodes strictly older than the seed (edge kind earlier) -> live OpenAlex block aborted: OpenAlex answered HTTP 429.
  FAIL AC-A3-2 later returns only nodes strictly newer than the seed (edge kind later) -> live OpenAlex block aborted: OpenAlex answered HTTP 429.
  FAIL removeSeed drops the seed and its exclusive neighbours -> live OpenAlex block aborted: OpenAlex answered HTTP 429.
  FAIL clear empties everything -> live OpenAlex block aborted: OpenAlex answered HTTP 429.
  FAIL bad work id is rejected -> live OpenAlex block aborted: OpenAlex answered HTTP 429.
  PASS AC-A2-1 addSeed accepts 50 seeds and rejects the 51st with the ceiling in the message
  PASS AC-A2-1 the seed ceiling is configurable (maxSeeds=2 rejects the third seed with the ceiling in the message)
  PASS AC-A2-4 expandAll keeps at most 4 concurrent OpenAlex requests for 3 seeds x 2 axes
  PASS AC-A2-5 expandAll is idempotent: the second run adds nothing and does not change counts.papers
  PASS AC-A2-3 a failing seed is isolated: perSeed carries the error, the other seed still expands, skipped counts it
  PASS AC-A5-5 expanding past maxNodes is refused with a readable "clear it" message and never half-writes
  PASS AC-A2-6 expandAll reports skipped > 0 at the ceiling without throwing and keeps counts.papers <= maxNodes
  PASS failure path: an OpenAlex 429 (over quota) is retried once and then surfaced as an operation error, never a crash or a silent pass
  PASS failure path: an OpenAlex 404 is mapped to an invalid error without retrying
  PASS failure path: a truncated OpenAlex body becomes a readable operation error
  PASS AC-A3-3 earlier excludes the same-year and year===0 neighbours (strict comparison)
  PASS AC-A3-3 an empty earlier/later result returns found:0 as a success, not an error
  PASS AC-A1-5 the author axis obeys filters and the batch cap
  PASS AC-A4-6 found reports the post-filter count, never the unfiltered count
  PASS AC-A4-4 isOa/isRetracted filter on the new boolean record fields (never null)
  PASS AC-A4-4 isRetracted:true returns only retracted works and the field is a real boolean
  PASS AC-A4-3 venue matches case-insensitively by substring and venue:"" means "not provided"
  PASS AC-A4-8 filtering is deterministic: the same input yields the same id sequence
  PASS AC-A4-7 unknown keys, non-booleans, negative minimums and illegal sort are all invalid errors
  PASS AC-A4-2 yearFrom > yearTo is invalid instead of an empty success
  PASS AC-A4-2 yearFrom/yearTo are closed intervals (boundary years included)
  PASS normalizeFilters/applyFilters are pure and shared by every axis
  PASS AC-A1-1 the ORCID fallback is deterministic: richest profile wins, ties go to the smaller author id
  PASS AC-A1-2 an author-axis expand works offline through the same code path
  PASS AC-B1-1 a restart on the same storePath restores collections, memberships, annotations and Recently Found field-for-field
  PASS AC-B1-1 the exploration graph itself is temporary: a restart has 0 papers/links while the saved collection membership survives
  PASS AC-B3-7 Recently Found survives the restart
  PASS AC-B1-2 an injected write failure leaves the old complete JSON on disk (never a truncated file)
  PASS AC-B1-2 no temporary file is left behind after a failed write
  PASS AC-B1-2 the failed write is surfaced as a storeError instead of crashing
  PASS AC-B1-3 AC-B1-4 an unknown version or a corrupt/empty/truncated file starts from an empty library with a readable storeError and keeps a .bak
  PASS AC-B1-3 the current version constant is 1
  PASS AC-B1-5 five quick writes collapse into one disk write (debounced) and flush is a no-op afterwards
  PASS AC-B1-7 without network the persisted library still loads and only network operations fail
  PASS AC-B1-8 an unwritable storePath degrades to an in-memory library with a readable storeError (the plugin still loads)
  PASS AC-B2-1 collections list returns the tree shape and the system collection
  PASS AC-B2-2 collections nest at least three levels deep and a missing parent is refused
  PASS AC-B2-3 rename keeps the tree shape and duplicate names are allowed
  PASS AC-B2-6 AC-B2-7 one paper can belong to several collections and unknown ids are reported as skipped, never silently accepted
  PASS AC-B2-8 itemCount counts direct members and itemCountDeep counts the subtree
  PASS AC-B2-4 AC-B2-5 deleting a parent cascades its subtree but never deletes the papers
  PASS AC-B2-4 after deleting its only user collection the paper is back in Recently Found
  PASS AC-B3-1 AC-B3-2 Recently Found is a de-duplicated, most-recent-first list and a fresh addSeed lands first
  PASS AC-B3-4 promoting into a collection removes the id from Recently Found; removing it from the last collection brings it back
  PASS AC-B3-5 clearing Recently Found keeps the library articles and collection members
  PASS AC-B4-1 a partial annotate update leaves tags and colour untouched
  PASS AC-B4-2 a note over 10000 characters is rejected, not truncated
  PASS AC-B4-3 tags are de-duplicated in order, capped at 20, and 41-character tags are rejected
  PASS AC-B4-4 the colour enum is fixed, an illegal colour lists the legal values, and null clears it
  PASS AC-B4-6 annotating an unknown work id is refused (never invents a paper)
  PASS AC-A7-2 the BibTeX output parses into the same number of entries and every entry has title + year
  PASS AC-A7-2 parsed titles/years match the graph data
  PASS AC-A7-3 author is joined with " and " and never emitted empty
  PASS AC-A7-4 every entry carries doi or url (url always points at OpenAlex)
  PASS AC-A7-5 citation keys are unique, deterministic and byte-identical across two exports
  PASS AC-A7-6 the type map is the frozen one
  PASS AC-A7-7 LaTeX specials are escaped and non-ASCII stays untouched
  PASS AC-A7-8 an empty export is a legal comment-only BibTeX document with count 0
  PASS AC-A7-1 export returns {format, count, bibtex} for the graph and for a collection
  PASS AC-B4-9 annotations never leak into the BibTeX export
  PASS host name matches the package
  PASS host injects tools + webServer
  PASS apply registers exactly one agent tool
  PASS tool is named research_cat
  PASS tool exposes the four actions
  PASS AC-A0-3 the four original actions are still the first four enum entries (additive change only)
  PASS AC-A0-3 the tool output schema is still {ok, text}
  PASS AC-A0-3 the kind enum keeps the three original axes first and adds the three new ones
  PASS action is a required parameter
  PASS apply registers one route prefix
  PASS route path is the one the panel calls
  PASS route handler is callable
  PASS AC-B1-8 the host half uses the explicit storePath under os.tmpdir()
  PASS tool list action answers before anything is collected
  PASS schema rejects an action outside the enum
  PASS AC-A0-4 the tool list wording still reports the collection and graph totals
  PASS exposeTool:false registers no tool
  PASS exposeTool:false still registers the routes
  PASS AC-A0-4 /state returns the frozen graph/counts/library envelope over real HTTP
  PASS failure path: an illegal work id is HTTP 400 invalid
  PASS failure path: an empty search query is HTTP 400 invalid
  PASS failure path: a nonexistent collection is HTTP 400 invalid
  PASS AC-A4-2 route probe: yearFrom > yearTo is rejected as invalid, not an empty success
  PASS AC-B4-4 route probe: an illegal colour lists the frozen enum
  PASS AC-B4-6 route probe: annotating an unknown id is invalid
  PASS AC-A7-1 route probe: /export returns {format, count, bibtex}
  PASS AC-A7-8 route probe: an empty export is a success with count 0
  PASS AC-A0-6 route probe: a cross-site Origin is refused with 403 forbidden (loopback fence intact)
  PASS AC-A0-6 route probe: a non-JSON content-type is refused with 415
  PASS route probe: GET /dsh-research-cat answers the identity probe
  PASS AC-A0-2 route probe: expand still accepts references/citations/related and returns the frozen field set
  PASS the unknown-route 404 behaviour is unchanged
  PASS AC-A0-7 route probe: /clear empties papers and seeds
  PASS failure path: expanding past maxNodes is HTTP 200 with ok:false and code operation (a result, not a crash)
  PASS AC-C-1 no C-tier feature term appears in the host or browser source
  PASS AC-C-1 the only "share" occurrences are the citation-share math variable and one English comment, not a sharing feature
  PASS AC-C-1 the route table is exactly the frozen set (no C-tier route slipped in)
  PASS AC-C-2 the design doc references spec §8 and declares the C tier as not implemented / user-decision
  PASS AC-A0-5 the panel ships a distinct style rule for each of the six edge kinds
  PASS AC-A0-5 every edge kind has an independent toggle and hidden kinds are filtered out of the drawn links
  PASS AC-A1-6 the detail panel lists clickable authors that call the author axis
  PASS AC-A3-5 the detail panel offers both Earlier and Later entries
  PASS AC-A4-9 the filter panel exposes all seven frozen filter keys and reports considered/total
  PASS AC-A6-1 Radial and Timeline toggles only switch layout state (no reload, no selection reset)
  PASS AC-A7-9 the panel downloads a .bib file with a stable research-cat-<collection|all>-<date>.bib name
  PASS AC-B2-10 the collection tree offers create-subcollection, rename, two-step delete and activation
  PASS AC-B3-8 Recently Found rows offer multi-select promote and a one-click clear
  PASS AC-B4-7 the detail panel has a note editor, a tag input, seven colour dots and a "No colour" button
  GAP  AC-B2-10 gap: the collection tree offers copy-into (save) but no "move" action -> finding F7 — see test/AC-EVIDENCE.md
  PASS AC-A2-7 (partial) Auto-expand calls the new expandAll and surfaces skipped/failed request counts
  GAP  AC-A2-7 gap: Auto-expand never displays the number of seeds expanded (only added/failed/skipped) -> finding F6 — see test/AC-EVIDENCE.md
  PASS AC-A0-1 every pre-t5 check label is still present and the suite only grew
  PASS coverage: every frozen spec AC id is referenced by test/local.mjs or test/parity.mjs
  PASS seal: the user's real ~/.dsh/research-cat/library.json was neither created nor modified by this run

sealed run: DSH_HOME=/var/folders/qy/tzfphq9d0y9gjvff7z8407nw0000gn/T/dsh-research-cat-local-9a6IgV/home  engineStore=/var/folders/qy/tzfphq9d0y9gjvff7z8407nw0000gn/T/dsh-research-cat-local-9a6IgV/engine/library.json
real library fingerprint: (absent)
reported gaps (not counted as passes): AC-B2-10 gap: the collection tree offers copy-into (save) but no "move" action | AC-A2-7 gap: Auto-expand never displays the number of seeds expanded (only added/failed/skipped)

local: 26 check(s) FAILED
```

### 2.3 `node test/parity.mjs` — t3 的 host 套件（离线桩为主）

> `parity: 139 passed, 0 failed`，exit 0；末尾 DEFER 清单是 parity 显式留给 t5/t8 的 panel/文档项。

```

== config (AC-A5-1, AC-A5-6, AC-A2-4) ==
  PASS AC-A5-1 resolveConfig defaults are the frozen quotas
  PASS AC-A5-1 invalid quota values fall back to the defaults
  PASS AC-A5-6 every quota key is overridable from config
  PASS AC-B1-8 storePath default resolves under DSH_HOME (no hardcoded home)
  PASS AC-A5-6 a relative storePath is resolved against DSH_HOME
  PASS AC-A5-1 resolveConfig exposes exactly the nine frozen keys

== chunking + filters (AC-A5-3, AC-A4-2..8) ==
  PASS AC-A5-3 chunkIds splits 100 ids into 2 requests of 50
  PASS AC-A5-3 chunkIds normalises, de-duplicates and drops non-work ids
  PASS AC-A4-2 yearFrom/yearTo is a closed interval and year 0 never passes a bounded side
  PASS AC-A4-2 yearFrom > yearTo is rejected as invalid (not an empty success)
  PASS AC-A4-3 venue matches case-insensitively as a substring; null venue never matches
  PASS AC-A4-3 venue:"" is treated as not provided
  PASS AC-A4-4 isOa / isRetracted compare the boolean record fields
  PASS AC-A4-5 minCitations is an inclusive lower bound
  PASS AC-A4-5 sort:"year" returns a year-descending sequence
  PASS AC-A4-7 unknown keys, wrong types and negative bounds are rejected with code invalid
  PASS AC-A4-8 filtering is deterministic: the same input yields the same id sequence

== BibTeX export (AC-A7-2..8) ==
  PASS AC-A7-2 bibtexOf renders a parseable document
  PASS AC-A7-2 the entry count matches the exported record count
  PASS AC-A7-2 every entry carries the record title and year
  PASS AC-A7-3 authors join with " and " and an authorless record omits the field
  PASS AC-A7-4 every entry has a doi or a url
  PASS AC-A7-5 citation keys are unique
  PASS AC-A7-5 two exports of the same input are byte-identical
  PASS AC-A7-6 the type map is fixed (article/book/incollection/inproceedings/misc)
  PASS AC-A7-6 the rendered entries use the mapped types
  PASS AC-A7-7 LaTeX specials are escaped and no raw & survives in a field
  PASS AC-A7-7 non-ASCII characters stay UTF-8 (not \uXXXX)
  PASS AC-A7-8 an empty input yields count 0 and a legal comment-only document
  PASS AC-A7-8 missing title/year fields still produce a parseable entry

== persistence (AC-B1-1..8) ==
  PASS AC-B1-1 a restart on the same storePath keeps collections, members, notes, tags, colour and Recently Found
  PASS AC-B3-7 Recently Found survives the restart
  PASS AC-B1-1 the graph itself is empty after a restart (library persisted, graph temporary)
  PASS AC-B1-1 /state reports the library storePath and no storeError on a healthy file
  PASS AC-B1-2 an injected write failure leaves the old complete JSON on disk (never a truncated file)
  PASS AC-B1-2 no temporary file is left behind after a failed write
  PASS AC-B1-6 clear:"graph" empties the graph + seeds but keeps the library; clear:"library" resets and syncs the file
  PASS AC-B1-3 a newer version is backed up as .bak and starts an empty library with storeError
  PASS AC-B1-4 a corrupt file is backed up as .bak and starts an empty library with storeError
  PASS AC-B1-4 an empty file is backed up as .bak and starts an empty library with storeError
  PASS AC-B1-5 three quick writes collapse into one disk write (debounced) and flush is a no-op afterwards
  PASS AC-B1-7 the library loads and /state answers with no network; only network operations fail
  PASS AC-B1-8 an unwritable storePath degrades to an in-memory library with a readable storeError

== exploration axes (AC-A1, AC-A2, AC-A3, AC-A4, AC-A5) ==
  PASS AC-A5-2 search requests per-page=50 and reports total/hasMore
  PASS AC-A5-7 every OpenAlex request carries mailto
  PASS AC-A4-7 an illegal page number is rejected as invalid
  PASS AC-A5-3 references expand chunks 100 ids into 2 requests and returns more than 50
  PASS AC-A5-4 citations expand returns up to 100 records
  PASS AC-A1-1 authors lists A-ids in authorships order
  PASS AC-A1-1 authors resolves an ORCID to an author id when OpenAlex leaves author.id null
  PASS AC-A1-1 authors drops entries that have neither an author id nor an ORCID (failure path)
  PASS AC-A1-2 kind:author links the seed to the author works
  PASS AC-A1-3 author works come back in citedBy-descending order
  PASS AC-A1-4 kind:author without authorId is invalid and names the available author ids
  PASS AC-A1-5 author results honour filters and the batch quota
  PASS AC-A1-6 (host prerequisite) the authors route + author axis exist for the panel click-through
  PASS AC-A3-1 earlier returns only references older than the seed
  PASS AC-A3-2 later returns only citing papers newer than the seed
  PASS AC-A3-3 same-year and year-0 neighbours are excluded; an empty result is still ok
  PASS AC-A3-4 each seed uses its own year as the boundary
  PASS AC-A3-6 earlier/later honour filters and the batch quota
  PASS AC-A3-5 (host prerequisite) earlier/later axes return data for the panel buttons
  PASS AC-A4-1 every axis accepts the same filters object
  PASS AC-A4-6 found is the filtered count and considered the pre-filter count
  PASS AC-A4-7 an unknown filter key on an axis is invalid
  PASS AC-A2-1 addSeed accepts 50 seeds and rejects the 51st with the limit in the message
  PASS AC-A2-2 expandAll runs every seed over the requested axes
  PASS AC-A2-7 (host prerequisite) expandAll reports perSeed/skipped for the panel Auto-expand
  PASS AC-A2-3 one failing seed does not stop the batch
  PASS AC-A2-5 expandAll is idempotent
  PASS AC-A2-4 concurrent OpenAlex requests stay at or below the configured 4
  PASS AC-A2-6 a small maxNodes stops the batch with skipped>0 and never exceeds the ceiling
  PASS AC-A5-5 expanding at the graph ceiling is rejected with a readable "clear first" message

== collections, Recently Found, annotations, export (AC-B2, AC-B3, AC-B4, AC-A7) ==
  PASS AC-B2-1 collections list is empty (system collection only) before any create
  PASS AC-B2-2 create nests three levels and rejects an unknown parent
  PASS AC-B2-3 rename keeps the tree and allows duplicate names
  PASS AC-B2-4 AC-B2-5 deleting a collection cascades its subtree but keeps the papers
  PASS AC-B2-6 one paper can belong to several collections
  PASS AC-B2-7 batch save reports skipped ids instead of silently succeeding
  PASS AC-B2-7 batch remove reports skipped ids instead of silently succeeding
  PASS AC-B2-8 itemCount and itemCountDeep match the memberships
  PASS AC-B2-9 a cyclic persisted tree is repaired instead of crashing
  PASS AC-B2-11 (host prerequisite) the collections tool action covers list/create/rename/delete/save/remove
  PASS AC-B2-10 (host prerequisite) collections list carries ids + itemCount for the panel tree
  PASS AC-B3-1 AC-B3-2 Recently Found starts empty and addSeed lands first
  PASS AC-B3-3 expanding puts new nodes into Recently Found
  PASS AC-B3-4 saving into a collection removes it from Recently Found; removing brings it back
  PASS AC-B3-5 clearing Recently Found keeps the papers and the collections
  PASS AC-B3-9 (host prerequisite) recentlyFound promote moves ids into a collection
  PASS AC-B3-8 (host prerequisite) /state carries records so the panel can title Recently Found entries
  PASS AC-B3-6 the 500-entry Recently Found ceiling evicts the oldest deterministically
  PASS AC-B4-1 AC-B4-3 annotations support partial updates and de-duplicate tags in order
  PASS AC-B4-2 AC-B4-3 oversized notes and tag lists are rejected as invalid
  PASS AC-B4-4 an unknown colour is rejected and the message lists the legal values
  PASS AC-B4-4 color:null clears the colour
  PASS AC-B4-5 AC-B4-6 annotations reject unknown works and are visible in /state
  PASS AC-B4-7 (host prerequisite) the annotate route carries note/tags/colour for the panel editor
  PASS AC-B4-8 (host prerequisite) the annotate tool action echoes note/tags/colour
  PASS AC-B4-9 annotations never leak into the BibTeX export
  PASS AC-A7-1 AC-A7-8 export renders the graph and a collection, and empty input is count 0
  PASS AC-A7-1 an unsupported export format is rejected as invalid

== routes and the agent tool (AC-A0-2..A0-7, AC-A0-5) ==
  PASS AC-A0-2 the host mounts one /dsh-research-cat prefix route and one research_cat tool
  PASS AC-A5-7 (route) OpenAlex requests from routes carry mailto
  PASS AC-A0-2 /expand keeps the three original kinds and their response keys
  PASS AC-A0-4 /state keeps graph + counts and only adds keys
  PASS AC-A0-6 the loopback fence and the JSON content-type guard still reject
  PASS AC-A0-7 /clear empties the graph and the seed membership
  PASS AC-A1-1 (route) /authors returns A-ids
  PASS AC-A4-7 (route) an invalid filter is a 400 with code invalid
  PASS AC-A4-2 (route) yearFrom > yearTo is a 400 with code invalid
  PASS AC-B2-1 (route) /collections op:list answers the tree
  PASS AC-B3-1 (route) /recentlyFound op:list answers a string array
  PASS AC-B4-1 (route) /annotate answers the updated annotation
  PASS AC-A0-5 (host prerequisite) all six axes are reachable through /expand
  PASS AC-A0-6 an unknown route still answers 404
  PASS AC-A7-1 (route) /export returns {format,count,bibtex}
  PASS AC-A7-9 (host prerequisite) /export gives the panel a downloadable BibTeX document
  PASS AC-A7-1 (route) an unsupported export format is a 400 with code invalid
  PASS AC-A0-3 the tool enum only grows (four original + four new actions)
  PASS AC-A0-3 RESULT_SCHEMA is still {ok,text} with additionalProperties:false
  PASS AC-A0-3 the tool keeps the four original actions and their wording
  PASS AC-A0-3 the original four actions keep their exact text contract
  PASS AC-A0-3 the tool schema still rejects an action outside the enum
  PASS AC-B2-11 the collections tool action answers a readable tree with ids
  PASS AC-B3-9 the recent tool action answers with a count and ids
  PASS AC-B4-8 the annotate tool action echoes note, tags and colour
  PASS AC-A7-10 the export tool action answers BibTeX text within the view limit
  PASS AC-A7-10 a long export is truncated with a note and never cuts mid-entry
  PASS AC-A4-9 (host prerequisite) the panel gets filters, considered and found to render 筛选前/后

== client timeline layout via @parity marker blocks (AC-A6) ==
  PASS AC-A6-2 timeline x is non-decreasing in year and equal for equal years
  PASS AC-A6-3 timeline y is monotone in citedBy (more citations -> higher on screen)
  PASS AC-A6-5 year===0 nodes are kept and placed in a dedicated band left of every dated node
  PASS AC-A6-4 the axis exposes non-empty year and citation tick arrays plus the unknown band
  PASS AC-A6-7 the radial layout is preserved as a pure function and places every node
  PASS AC-A6-1 the panel dispatches between the radial and timeline layouts without a reload
  PASS AC-A6-6 (host prerequisite) the six axes carry their own label, stroke and dash in the panel
  DEFER AC-A6-6 panel step: the six edge styles render and the toggles hide them (t5 panel evidence)
  DEFER AC-A6-1 panel step: switching Radial <-> Timeline keeps the selection (t5 panel evidence)

== C-tier exclusion (AC-C-1) ==
  PASS AC-C-1 no C-tier feature term appears in the host source
  PASS AC-C-1 the route table is exactly the frozen set (no C-tier route slipped in)
  DEFER AC-C-1 panel step: the panel entry list contains no C-tier entry (t5 review)
  DEFER AC-A0-1 regression: node test/local.mjs keeps its baseline checks green (t5 evidence)
  DEFER AC-B1-9 README drops the in-memory-only wording and documents the library file (t8/t5 evidence)

== coverage ==
  PASS the suite references every frozen AC id (checks or explicit DEFER)

== network smoke (not counted; t5 runs the networked acceptance) ==
  PASS (5 live results)

deferred (panel-step / t5): AC-A6-6 panel step: the six edge styles render and the toggles hide them (t5 panel evidence) | AC-A6-1 panel step: switching Radial <-> Timeline keeps the selection (t5 panel evidence) | AC-C-1 panel step: the panel entry list contains no C-tier entry (t5 review) | AC-A0-1 regression: node test/local.mjs keeps its baseline checks green (t5 evidence) | AC-B1-9 README drops the in-memory-only wording and documents the library file (t8/t5 evidence)
parity: 139 passed, 0 failed
```

### 2.4 client 侧交叉证据（在静默树上采集）

采集窗口内 `src/client.js` 与 `lab/client-check.mjs` 的哈希前后一致（见 §2.7），无 in-flight 写入。

```
$ node test/client.mjs      # exit 0
  PASS the default box stays 1200x800

client-radial: all checks passed

$ node lab/client-check.mjs # exit 0, 91 PASS（连续 10 次全绿）
  PASS scenario C: viewBox grew past the baseline 1200x800 and still covers every node
  PASS scenario C: rendered circles do not overlap (distance >= r1 + r2)

client-check: all checks passed
```

10 次连续运行结果：`client-check run 1..10 exit=0 PASS=91 FAIL=0`（无一次间歇失败）。

### 2.5 独立核对 t10 的基线拆分（RADIAL_BASELINE_IDENTICAL vs RADIAL_POST_T10/T11）

方法：从 `git show 9a1bd7d:src/client.js` 抽出旧 `computeLayout`，从工作树抽出 `@parity:computeRadialLayout` 块，对同一批冻结数据集各算一次规范坐标 sha256，并与 `lab/client-check.mjs` 内嵌的常量比对（脚本 `/tmp/t5_a0_baseline.mjs`，不 import 任何测试文件）。

```
== A0: old(9a1bd7d) vs new(worktree); the claimed digest must match the OLD output ==
  PASS star, seed is the hub (24 nodes, spin 0)
       old=c652299929f47b64348d169b new=c652299929f47b64348d169b claimed=c652299929f47b64348d169b keys=24/24
  PASS star, seed is the hub (40 nodes, spin 2)
       old=75ffd0c808c3b02072e84917 new=75ffd0c808c3b02072e84917 claimed=75ffd0c808c3b02072e84917 keys=40/40
  PASS random legacy graph, no seeds, clamp-free (24 nodes, spin 0)
       old=30a01314e1db4a1b5a6658fd new=30a01314e1db4a1b5a6658fd claimed=30a01314e1db4a1b5a6658fd keys=24/24
== post-t10/t11: the claimed digest must match NEW, and OLD must differ (the defect was real) ==
  PASS 3 seeds, 18 nodes, spin 0 oldKeys=16/18 newKeys=18
       old=230b3c9453ab6c57f3c6b467 new=5fa04849c8fccd2b41f5c37c claimed=5fa04849c8fccd2b41f5c37c
  PASS 3 seeds, 120 nodes, spin 1 oldKeys=118/120 newKeys=120
       old=57e4e4a05c7bae015a71e046 new=6dbc4c45c16df0b62df8bcea claimed=6dbc4c45c16df0b62df8bcea
  PASS 3 seeds, 260 nodes, spin 3 oldKeys=257/260 newKeys=260
       old=b74d00bb139cc65e41efd37a new=f9db7acb16a6491da1d3bd42 claimed=f9db7acb16a6491da1d3bd42
  PASS no seeds, 60 nodes, spin 0 oldKeys=60/60 newKeys=60
       old=750ed67c6301bc436c4ff588 new=55c832cfcf67cb32410023a0 claimed=55c832cfcf67cb32410023a0

t5-a0-baseline: all independent checks passed
```

结论：**拆分成立**。A0 三组输入 old == new == 冻结常量（逐字节一致）；post-t10/t11 四组输入 old 只放 16/18、118/120、257/260 个节点（缺陷），new 全放且等于有意更新的常量。任务里说的 `RADIAL_POST_T10` 在 t11 后改名为 `RADIAL_POST_T11`，t10 的 5 节点快照仍在 `test/client.mjs` 里以 “unchanged since t10” 钉住。

### 2.6 t9 findings F2 / F3 / F5 探针（全部在 os.tmpdir() 内，不碰真实库）

```
F5 before: records=1 memberships=1
F5 after : records=1 memberships=1 savedAt=null
F5 before keys=["W100"] after keys=["W200"] membershipsAfter=["W200"]
F5 VERDICT: CONFIRMED — the pre-existing library content was replaced by the new empty-instance write
F3 writeCount()=3  file meta.writes=2  file savedAt=2026-09-19T08:33:52.669Z  records=3
F3 VERDICT: CONFIRMED — on-disk meta.writes lags the real write count
F2 dir=["library.json","library.json.tmp-99999-orphan"]  main file parses: records=1
F2 VERDICT: an orphan .tmp can remain while the main file stays complete (AC-B1-2 not violated)

probe root: /var/folders/qy/tzfphq9d0y9gjvff7z8407nw0000gn/T/t5-findings-EN1LHP
```

- **F2 确认**：硬退出（tmp 写入后、rename 前被杀）会留下孤儿 `.tmp-`，主文件仍完整 → AC-B1-2 不违反。真实目录里实测遗留 `library.json.tmp-60403-rlyp6u` / `library.json.tmp-70142-ic86rh`（§2.7 已随真实库一并被改名清走）。
- **F3 确认**：`writeCount()=3` 而磁盘上 `meta.writes=2`（`JSON.stringify` 在自增之前执行）→ 仅元数据滞后一次写，不影响数据完整性。
- **F4 确认**：OpenAlex 404 被映射为 `invalid`（HTTP 400）而非 `operation`（见 `test/local.mjs` 的离线断言 “an OpenAlex 404 is mapped to an invalid error without retrying”，calls=1）。spec 未钉死错误码，低。
- **F5 确认（API 级）**：跳过 `ready()` 直接写，会把既有库文件内容替换为新实例的空库+本次写入（探针：磁盘 `W100` → `W200`，memberships 同样被替换）。**可达性**：仓库内唯一的 `createLibrary` 调用点是 `src/index.js:53`，且 `src/index.js:59` 先 `await library.ready()`，到 `61`/`68` 才注册路由与工具 → **shipped 路径不可达**。因此按 **medium（API 级隐患）** 上报而非 blocker；建议给 store 加一道“未 open 前拒绝/延迟写入”的护栏（一行）。若 captain 对“数据覆盖”零容忍，可开修复任务。

### 2.7 隔离与静默树核对

```
=== evidence capture start 2026-09-19T08:11:56Z ===
--- git status ---
 M src/client.js
 M src/config.js
 M src/graph.js
 M src/index.js
 M src/routes.js
 M src/tools.js
 M test/local.mjs
?? docs/
?? lab/client-check.mjs
?? src/bibtex.js
?? src/store.js
?? test/client.mjs
?? test/parity.mjs
--- hashes before ---
src/client.js 5798e5982a20815bc0c1448ad5b8715b5a465e9e3630cdac8cdfff3ed4074b9a
   mtime=2026-09-19T15:19:58 size=121987
lab/client-check.mjs 8e07c9857402804c81bb5c70d40205366f576a158a216e278f81afdca1ce5056
   mtime=2026-09-19T15:23:02 size=50119
test/client.mjs 00e8f40740a9c049c7c69fbe08cff7710955e6eccbd1dc3a64c7d8a1afb12a6e
   mtime=2026-09-19T15:21:50 size=17660
test/parity.mjs 62ac5a6b6328c551af1308bed93480fbfaa3fc23c325bf7c76345763b7b115b8
   mtime=2026-09-19T14:50:27 size=98965
test/local.mjs 56675ba3ad81d61e50b9f8208d9b6042eb52e25f447545fd7305000eb107a443
   mtime=2026-09-19T16:10:14 size=77130
```

```
=== hashes after 2026-09-19T08:13:22Z ===
src/client.js 5798e5982a20815bc0c1448ad5b8715b5a465e9e3630cdac8cdfff3ed4074b9a
   mtime=2026-09-19T15:19:58 size=121987
lab/client-check.mjs 8e07c9857402804c81bb5c70d40205366f576a158a216e278f81afdca1ce5056
   mtime=2026-09-19T15:23:02 size=50119
test/client.mjs 00e8f40740a9c049c7c69fbe08cff7710955e6eccbd1dc3a64c7d8a1afb12a6e
   mtime=2026-09-19T15:21:50 size=17660
test/parity.mjs 62ac5a6b6328c551af1308bed93480fbfaa3fc23c325bf7c76345763b7b115b8
   mtime=2026-09-19T14:50:27 size=98965
test/local.mjs 56675ba3ad81d61e50b9f8208d9b6042eb52e25f447545fd7305000eb107a443
   mtime=2026-09-19T16:10:14 size=77130
--- git status ---
 M src/client.js
 M src/config.js
 M src/graph.js
 M src/index.js
 M src/routes.js
 M src/tools.js
 M test/local.mjs
?? docs/
?? lab/client-check.mjs
?? src/bibtex.js
?? src/store.js
?? test/client.mjs
?? test/parity.mjs
--- real library dir (outside repo) ---
total 528
drwxr-xr-x   5 depengwang  staff    160 Sep 19 15:32 .
drwx------@ 18 depengwang  staff    576 Sep 19 13:56 ..
-rw-------   1 depengwang  staff  87656 Sep 19 15:32 library.json
-rw-------   1 depengwang  staff  87703 Sep 19 15:22 library.json.tmp-60403-rlyp6u
-rw-------   1 depengwang  staff  87703 Sep 19 15:32 library.json.tmp-70142-ic86rh
--- real library fingerprint now ---
1eda7992be8a8b54c66ad473e2bd935f679622a66cdb29ddbba4a5edd01dc9b9  /Users/depengwang/.dsh/research-cat/library.json
mtime=2026-09-19T15:32:40 size=87656
```

- `src/client.js` `5798e598…`、`lab/client-check.mjs` `8e07c985…` 在全部 client 证据采集前后**逐字节不变**（mtime 也一致）→ 工作树静默，无并发写造成的假间歇失败。
- 真实库 `~/.dsh/research-cat/library.json` 在我密封后的所有运行中 **mtime/sha256 均未变化**；密封后它被外部（t9 复核/清理）改名为 `library.json.test-residue.bak`（sha256 `1eda7992…`，即此前被 `test/local.mjs` 污染的 87656 字节文件），原 `.tmp-` 孤儿一并消失。之后各次运行里真实路径为 **absent → absent**，即“未被创建”。

## 3. AC → 状态 → 证据（99 条）

| AC | 状态 | 证据（命令 + 断言标签） |
|---|---|---|
| AC-A0-1 | passed | node test/local.mjs: AC-A0-1 every pre-t5 check label is still present and the suite only grew |
| AC-A0-2 | passed | node test/local.mjs: AC-A0-2 route probe: expand still accepts references/citations/related and returns the frozen field set |
| AC-A0-3 | passed | node test/local.mjs: AC-A0-3 the four original actions are still the first four enum entries (additive change only) |
| AC-A0-4 | passed | node test/local.mjs: AC-A0-4 the tool list wording still reports the collection and graph totals |
| AC-A0-5 | passed | node test/local.mjs: AC-A0-5 the panel ships a distinct style rule for each of the six edge kinds |
| AC-A0-6 | passed | node test/local.mjs: AC-A0-6 route probe: a cross-site Origin is refused with 403 forbidden (loopback fence intact) |
| AC-A0-7 | passed | node test/local.mjs: AC-A0-7 route probe: /clear empties papers and seeds |
| AC-A1-1 | passed (quota-blocked re-run) | node test/local.mjs: AC-A1-1 the ORCID fallback is deterministic: richest profile wins, ties go to the smaller author id [sealed green 08:11Z; current re-run hit the real OpenAlex 429] |
| AC-A1-2 | passed (quota-blocked re-run) | node test/local.mjs: AC-A1-2 an author-axis expand works offline through the same code path [sealed green 08:11Z; current re-run hit the real OpenAlex 429] |
| AC-A1-3 | passed (quota-blocked re-run) | node test/local.mjs: AC-A1-3 the author axis returns works with citedBy monotonically non-increasing [sealed green 08:11Z; current re-run hit the real OpenAlex 429] |
| AC-A1-4 | passed (quota-blocked re-run) | node test/local.mjs: AC-A1-4 kind author without authorId is rejected with a usable hint (never silently picks the first author) [sealed green 08:11Z; current re-run hit the real OpenAlex 429] |
| AC-A1-5 | passed | node test/local.mjs: AC-A1-5 the author axis obeys filters and the batch cap |
| AC-A1-6 | passed | node test/local.mjs: AC-A1-6 the detail panel lists clickable authors that call the author axis |
| AC-A2-1 | passed | node test/local.mjs: AC-A2-1 addSeed accepts 50 seeds and rejects the 51st with the ceiling in the message |
| AC-A2-2 | passed | node test/parity.mjs: AC-A2-2 expandAll runs every seed over the requested axes |
| AC-A2-3 | passed | node test/local.mjs: AC-A2-3 a failing seed is isolated: perSeed carries the error, the other seed still expands, skipped counts it |
| AC-A2-4 | passed | node test/local.mjs: AC-A2-4 expandAll keeps at most 4 concurrent OpenAlex requests for 3 seeds x 2 axes |
| AC-A2-5 | passed | node test/local.mjs: AC-A2-5 expandAll is idempotent: the second run adds nothing and does not change counts.papers |
| AC-A2-6 | passed | node test/local.mjs: AC-A2-6 expandAll reports skipped > 0 at the ceiling without throwing and keeps counts.papers <= maxNodes |
| AC-A2-7 | **partial** | local.mjs: Auto-expand uses expandAll and shows added/failed/skipped; the seed count is NOT displayed (F6) |
| AC-A3-1 | passed (quota-blocked re-run) | node test/local.mjs: AC-A3-1 earlier returns only nodes strictly older than the seed (edge kind earlier) [sealed green 08:11Z; current re-run hit the real OpenAlex 429] |
| AC-A3-2 | passed (quota-blocked re-run) | node test/local.mjs: AC-A3-2 later returns only nodes strictly newer than the seed (edge kind later) [sealed green 08:11Z; current re-run hit the real OpenAlex 429] |
| AC-A3-3 | passed | node test/local.mjs: AC-A3-3 earlier excludes the same-year and year===0 neighbours (strict comparison) |
| AC-A3-4 | passed | node test/parity.mjs: AC-A3-4 each seed uses its own year as the boundary |
| AC-A3-5 | passed | node test/local.mjs: AC-A3-5 the detail panel offers both Earlier and Later entries |
| AC-A3-6 | passed | node test/parity.mjs: AC-A3-6 earlier/later honour filters and the batch quota |
| AC-A4-1 | passed | node test/parity.mjs: AC-A4-1 every axis accepts the same filters object |
| AC-A4-2 | passed | node test/local.mjs: AC-A4-2 yearFrom > yearTo is invalid instead of an empty success |
| AC-A4-3 | passed | node test/local.mjs: AC-A4-3 venue matches case-insensitively by substring and venue:"" means "not provided" |
| AC-A4-4 | passed | node test/local.mjs: AC-A4-4 isOa/isRetracted filter on the new boolean record fields (never null) |
| AC-A4-5 | passed | node test/parity.mjs: AC-A4-5 minCitations is an inclusive lower bound |
| AC-A4-6 | passed | node test/local.mjs: AC-A4-6 found reports the post-filter count, never the unfiltered count |
| AC-A4-7 | passed | node test/local.mjs: AC-A4-7 unknown keys, non-booleans, negative minimums and illegal sort are all invalid errors |
| AC-A4-8 | passed | node test/local.mjs: AC-A4-8 filtering is deterministic: the same input yields the same id sequence |
| AC-A4-9 | passed | node test/local.mjs: AC-A4-9 the filter panel exposes all seven frozen filter keys and reports considered/total |
| AC-A5-1 | passed | node test/local.mjs: AC-A5-1 the frozen config default set is complete and resolves storePath under DSH_HOME |
| AC-A5-2 | passed (quota-blocked re-run) | node test/local.mjs: AC-A5-2 search asks OpenAlex for per-page=50 and returns at most 50 rows [sealed green 08:11Z; current re-run hit the real OpenAlex 429] |
| AC-A5-3 | passed (quota-blocked re-run) | node test/local.mjs: AC-A5-3 references beyond OpenAlex's 50-id filter limit are fetched in chunks (found > 50 needs >= 2 requests) [sealed green 08:11Z; current re-run hit the real OpenAlex 429] |
| AC-A5-4 | passed (quota-blocked re-run) | node test/local.mjs: AC-A5-4 citations expand returns at most maxCitations [sealed green 08:11Z; current re-run hit the real OpenAlex 429] |
| AC-A5-5 | passed | node test/local.mjs: AC-A5-5 expanding past maxNodes is refused with a readable "clear it" message and never half-writes |
| AC-A5-6 | passed | node test/local.mjs: AC-A5-6 every quota key can be overridden and the override is recorded |
| AC-A5-7 | passed | node test/local.mjs: AC-A5-7 every OpenAlex request carries the polite-pool mailto |
| AC-A6-1 | passed | node test/local.mjs: AC-A6-1 Radial and Timeline toggles only switch layout state (no reload, no selection reset) |
| AC-A6-2 | passed | node test/parity.mjs: AC-A6-2 timeline x is non-decreasing in year and equal for equal years |
| AC-A6-3 | passed | node test/parity.mjs: AC-A6-3 timeline y is monotone in citedBy (more citations -> higher on screen) |
| AC-A6-4 | passed | node test/parity.mjs: AC-A6-4 the axis exposes non-empty year and citation tick arrays plus the unknown band |
| AC-A6-5 | passed | node test/parity.mjs: AC-A6-5 year===0 nodes are kept and placed in a dedicated band left of every dated node |
| AC-A6-6 | passed | node test/parity.mjs: AC-A6-6 (host prerequisite) the six axes carry their own label, stroke and dash in the panel |
| AC-A6-7 | passed | node test/parity.mjs: AC-A6-7 the radial layout is preserved as a pure function and places every node |
| AC-A7-1 | passed | node test/local.mjs: AC-A7-1 export returns {format, count, bibtex} for the graph and for a collection |
| AC-A7-2 | passed | node test/local.mjs: AC-A7-2 the BibTeX output parses into the same number of entries and every entry has title + year |
| AC-A7-3 | passed | node test/local.mjs: AC-A7-3 author is joined with " and " and never emitted empty |
| AC-A7-4 | passed | node test/local.mjs: AC-A7-4 every entry carries doi or url (url always points at OpenAlex) |
| AC-A7-5 | passed | node test/local.mjs: AC-A7-5 citation keys are unique, deterministic and byte-identical across two exports |
| AC-A7-6 | passed | node test/local.mjs: AC-A7-6 the type map is the frozen one |
| AC-A7-7 | passed | node test/local.mjs: AC-A7-7 LaTeX specials are escaped and non-ASCII stays untouched |
| AC-A7-8 | passed | node test/local.mjs: AC-A7-8 an empty export is a legal comment-only BibTeX document with count 0 |
| AC-A7-9 | passed | node test/local.mjs: AC-A7-9 the panel downloads a .bib file with a stable research-cat-<collection/all>-<date>.bib name |
| AC-A7-10 | passed | node test/parity.mjs: AC-A7-10 the export tool action answers BibTeX text within the view limit |
| AC-B1-1 | passed | node test/local.mjs: AC-B1-1 a restart on the same storePath restores collections, memberships, annotations and Recently Found field-for-field |
| AC-B1-2 | passed | node test/local.mjs: AC-B1-2 an injected write failure leaves the old complete JSON on disk (never a truncated file) |
| AC-B1-3 | passed | node test/local.mjs: AC-B1-3 AC-B1-4 an unknown version or a corrupt/empty/truncated file starts from an empty library with a readable storeError and keeps a .bak |
| AC-B1-4 | passed | node test/local.mjs: AC-B1-3 AC-B1-4 an unknown version or a corrupt/empty/truncated file starts from an empty library with a readable storeError and keeps a .bak |
| AC-B1-5 | passed | node test/local.mjs: AC-B1-5 five quick writes collapse into one disk write (debounced) and flush is a no-op afterwards |
| AC-B1-6 | passed | node test/parity.mjs: AC-B1-6 clear:"graph" empties the graph + seeds but keeps the library; clear:"library" resets and syncs the file |
| AC-B1-7 | passed | node test/local.mjs: AC-B1-7 without network the persisted library still loads and only network operations fail |
| AC-B1-8 | passed | node test/local.mjs: AC-B1-8 storePath level 2: DSH_HOME decides the default path (no hardcoded home) |
| AC-B1-9 | **not covered** | t8 deliverable: README must drop the in-memory wording (parity DEFER, t8 pending) |
| AC-B2-1 | passed | node test/local.mjs: AC-B2-1 collections list returns the tree shape and the system collection |
| AC-B2-2 | passed | node test/local.mjs: AC-B2-2 collections nest at least three levels deep and a missing parent is refused |
| AC-B2-3 | passed | node test/local.mjs: AC-B2-3 rename keeps the tree shape and duplicate names are allowed |
| AC-B2-4 | passed | node test/local.mjs: AC-B2-4 AC-B2-5 deleting a parent cascades its subtree but never deletes the papers |
| AC-B2-5 | passed | node test/local.mjs: AC-B2-4 AC-B2-5 deleting a parent cascades its subtree but never deletes the papers |
| AC-B2-6 | passed | node test/local.mjs: AC-B2-6 AC-B2-7 one paper can belong to several collections and unknown ids are reported as skipped, never silently accepted |
| AC-B2-7 | passed | node test/local.mjs: AC-B2-6 AC-B2-7 one paper can belong to several collections and unknown ids are reported as skipped, never silently accepted |
| AC-B2-8 | passed | node test/local.mjs: AC-B2-8 itemCount counts direct members and itemCountDeep counts the subtree |
| AC-B2-9 | passed | node test/parity.mjs: AC-B2-9 a cyclic persisted tree is repaired instead of crashing |
| AC-B2-10 | **partial** | client-check.mjs: create/rename/two-step delete/subcollection/activate; no move action (F7) |
| AC-B2-11 | passed | node test/parity.mjs: AC-B2-11 (host prerequisite) the collections tool action covers list/create/rename/delete/save/remove |
| AC-B3-1 | passed | node test/local.mjs: AC-B3-1 AC-B3-2 Recently Found is a de-duplicated, most-recent-first list and a fresh addSeed lands first |
| AC-B3-2 | passed | node test/local.mjs: AC-B3-1 AC-B3-2 Recently Found is a de-duplicated, most-recent-first list and a fresh addSeed lands first |
| AC-B3-3 | passed | node test/parity.mjs: AC-B3-3 expanding puts new nodes into Recently Found |
| AC-B3-4 | passed | node test/local.mjs: AC-B3-4 promoting into a collection removes the id from Recently Found; removing it from the last collection brings it back |
| AC-B3-5 | passed | node test/local.mjs: AC-B3-5 clearing Recently Found keeps the library articles and collection members |
| AC-B3-6 | passed | node test/parity.mjs: AC-B3-6 the 500-entry Recently Found ceiling evicts the oldest deterministically |
| AC-B3-7 | passed | node test/local.mjs: AC-B3-7 Recently Found survives the restart |
| AC-B3-8 | passed | node test/local.mjs: AC-B3-8 Recently Found rows offer multi-select promote and a one-click clear |
| AC-B3-9 | passed | node test/parity.mjs: AC-B3-9 (host prerequisite) recentlyFound promote moves ids into a collection |
| AC-B4-1 | passed | node test/local.mjs: AC-B4-1 a partial annotate update leaves tags and colour untouched |
| AC-B4-2 | passed | node test/local.mjs: AC-B4-2 a note over 10000 characters is rejected, not truncated |
| AC-B4-3 | passed | node test/local.mjs: AC-B4-3 tags are de-duplicated in order, capped at 20, and 41-character tags are rejected |
| AC-B4-4 | passed | node test/local.mjs: AC-B4-4 the colour enum is fixed, an illegal colour lists the legal values, and null clears it |
| AC-B4-5 | passed | node test/parity.mjs: AC-B4-5 AC-B4-6 annotations reject unknown works and are visible in /state |
| AC-B4-6 | passed | node test/local.mjs: AC-B4-6 annotating an unknown work id is refused (never invents a paper) |
| AC-B4-7 | passed | node test/local.mjs: AC-B4-7 the detail panel has a note editor, a tag input, seven colour dots and a "No colour" button |
| AC-B4-8 | passed | node test/parity.mjs: AC-B4-8 (host prerequisite) the annotate tool action echoes note/tags/colour |
| AC-B4-9 | passed | node test/local.mjs: AC-B4-9 annotations never leak into the BibTeX export |
| AC-C-1 | passed | node test/local.mjs: AC-C-1 no C-tier feature term appears in the host or browser source |
| AC-C-2 | passed | node test/local.mjs: AC-C-2 the design doc references spec §8 and declares the C tier as not implemented / user-decision |

## 4. 未覆盖 / 部分覆盖项与原因

| AC | 状态 | 原因 / 处置 |
|---|---|---|
| AC-B1-9 | **not covered** | README 更新属 t8（integration）交付；t8 尚 pending。已在此登记，不得写成通过。 |
| AC-A2-7 | **partial（F6）** | 面板 Auto-expand 已改用新 `expandAll`，且会显示 added/failed/skipped；但**从不显示本次展开的种子数**（只有 `perSeed.length` 驱动失败计数，没有任何 setError/setBusy 文案带种子数）。t7 的 F1 已记录同一问题；由 captain 决定是否开修复。 |
| AC-B2-10 | **partial（F7）** | collection 树有 新建子集/重命名/两步删除/激活/显示成员；**没有 move（移动）动作**，只有 copy-into（save）。spec 原文“拖拽或按钮移动/复制”，move 未实现。 |
| AC-A6-1 的“不丢选中状态” | 部分 | 源级断言已证 layout 切换只调 `setLayoutMode`（无 reload、不重置 selected）；`lab/client-check.mjs` 也验证了切回 Radial 后面板存活，但**没有断言选中态保持**。浏览器内实机点击留作 panel step。 |
| AC-A7-9 的“浏览器实际下载 .bib” | 部分 | 源级断言已证下载代码路径与稳定文件名 `research-cat-<collection|all>-<date>.bib`；真实浏览器下载动作未在无头环境执行。 |
| AC-A0-5 / A6-6 / B4-7 的“肉眼可见的线型/颜色/描边” | 部分 | 由 `lab/client-check.mjs` 的真实 mini-runtime 渲染断言覆盖（六类边 class、开关移除边、节点环颜色）；未做像素级截图比对。 |

## 5. Findings（按严重度）

| id | 严重度 | 问题 | 建议 |
|---|---|---|---|
| F5 | medium（API 级；shipped 不可达） | `createLibrary` 后不 `ready()` 就写会覆盖既有库（数据覆盖） | store 加护栏：未 `open()` 前 `save/saveNow` 直接拒绝或排队到 open 之后 |
| F6 | medium | AC-A2-7 面板不显示“本次展开的种子数” | Auto-expand 成功文案加 `N seed(s) expanded`（`perSeed` 可按 seed 去重计数） |
| F7 | low | AC-B2-10 缺 move（只有 copy-into） | 加 `collections op:"move"`（save 到目标 + 从源 remove）或明确记录“以 copy 替代 move” |
| F2 | low | 硬退出留下孤儿 `.tmp-` | 启动时清理 `library.json.tmp-*`；主文件不受影响 |
| F3 | low | 磁盘 `meta.writes/savedAt` 滞后一次写 | 在 `writeAtomic` 里先自增再 stringify |
| F4 | low | OpenAlex 404 → `invalid(400)` 而非 `operation` | spec 未钉；如需区分业务失败，把 404 归 `operation` |
| F8 | info | 真实库曾被未密封的 `test/local.mjs` 污染（185 records / 1 seed / 185 recentlyFound / 2 个孤儿 tmp） | 已密封；污染文件现保留为 `library.json.test-residue.bak`（未删除，等用户处置） |
| F9 | info | AC-C-1 的 grep 词 `share` 是假阳性：client.js 里全部 8 个匹配窗口均为“citation share”数学变量/一处英文注释 | 建议 spec 的 AC-C-1 词表去掉 `share`（保留 `zotero/oauth/collaborator/login/…`），本报告已按特征词判定 |

## 6. 环境限制（影响最终“全绿”重跑）

- 2026-09-19T08:25Z 起 OpenAlex 对所有无 API key 的请求返回 **HTTP 429**：`Insufficient budget … free daily budget shared by everyone on your network's IP address … resets at midnight UTC`，`retry-after: 56070`，`x-ratelimit-remaining: 0`。这是 IP 级共享免费预算被团队本轮大量真实请求（parity 冒烟、t9 的 127 探针、多次 `test/local.mjs`）耗尽，不是实现缺陷。
- 因此 **§2.1 的全绿输出是本轮配额可用窗口内的最后一次完整真实网络取证**（08:11–08:13Z，密封后，142 PASS/exit 0，文件 sha `56675ba3…`）；§2.2 是同一份 live 段在配额耗尽后的行为（真实 429 → 显式 FAIL，不崩溃、不静默通过）。
- 恢复全绿需要：等午夜 UTC 预算重置，或提供 OpenAlex API key（`?api_key=` / `Authorization: Bearer`）。
- 当前修订相对 §2.1 版本的差异**只在 live 段之外**：新增 panel 源级断言、AC-C-1 `share` 断言、离线 429/404/截断失败路径断言、AC-B2-10 gap 报告，以及把 live 段包进 `try/catch + LIVE_LABELS`；**live 段的请求与断言标签未变**。

## 7. `test/local.mjs` 本轮变更摘要

- **重基线 3 条陈旧断言**（标签不变、数量不减、加强为完整集合）：`config defaults`（9 键完整默认集 + storePath 落在 tmp）、`config overrides + bad values fall back`（回退值 100）、`tool exposes the four actions`（enum 改为冻结的 8 action，另加 AC-A0-3 断言原四轴仍是前四项）。
- **密封**：`DSH_HOME`/engine storePath/host storePath 全部指向 `os.tmpdir()`；新增 3 级路径解析断言（config → DSH_HOME → homedir，homedir 级只做纯解析不做 IO）；新增“真实库未被创建或修改”断言。
- **失败路径断言**：非法 work id、空查询、超 `maxNodes` 配额（引擎 + 真实 HTTP）、不存在的 collection、损坏/空/截断/高版本持久化文件、OpenAlex 429（重试一次后 operation）、404（invalid）、截断响应。
- **真实网络取证**：AC-A5-2/3/4/7、AC-A1-1（含上游 `author.id === null` 的事实采集与 ORCID 回退）、AC-A1-2/3/4、AC-A3-1/2。
- **真实 HTTP 路由探针**：起真实 `http.Server` 于 127.0.0.1 随机端口，覆盖 /state、/expand（三种 kind）、/export、/clear、403 围栏、415 content-type、404、非法 id/空查询/不存在 collection/非法颜色/未知 id。
- **覆盖率自检**：断言 spec 的 99 条 AC id 均出现在 `test/local.mjs` 或 `test/parity.mjs`；断言 t5 之前的 38 条标签全部仍在且总数只增。

---

*生成器：`node test/make-evidence.mjs`（读取 /tmp/t5_evidence 下的原始输出）。证据文件：`local_run_2.txt`（全绿）、`local_run_current.txt`（429）、`parity.txt`、`client_mjs.txt`、`client_check_1..10.txt`、`hashes_before.txt`/`hashes_after.txt`、`a0_baseline.txt`、`findings.txt`、`table_rows.txt`。*
