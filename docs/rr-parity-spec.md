# Research Rabbit 复刻 · 本轮验收规格（冻结版）

- **文档编号**：docs/rr-parity-spec.md
- **状态**：冻结（frozen）——本文件是 t3/t4 实现、t5 验证、t6/t7 评审的唯一判据
- **作者/责任人**：spec（团队 research-cat-rr-parity，任务 t1，requirements r1）
- **基线仓库**：`/Users/depengwang/DSH/dsh-research-cat`，git HEAD = `9a1bd7d`
- **验收单位**：本文件第 4/5 节每条 AC（Acceptance Criterion）都是**可判定通过或失败**的单一断言；判定结果只有 `passed` / `failed`，不接受“基本完成”。
- **明确禁止**：本文件只做需求与接口契约，不含任何实现代码；实现细节（数据模型字段、持久化原子写、client 组件拆分、OpenAlex 查询拼装）由 t2 设计文档展开，但不得与本文件第 6 节“冻结接口契约”冲突。

---

## 0. 本文件如何被使用

1. **t2（设计）**：必须逐条对齐第 6 节冻结契约；若认为某条契约不可实现，走第 11 节变更流程，不得静默偏离。
2. **t3（host 实现）/ t4（client 实现）**：只做第 4、5 节（档 1）的 AC；第 7 节（明确排除）与第 8 节（待用户决策）**不得实现**。
3. **t5（验证）**：对每条 AC 给出 passed/failed + 证据（命令、输出片段、文件路径、面板步骤）；failed 必须回写 AC 编号。
4. **t6/t7（评审）**：以 AC 编号为评审单元；发现“实现做了 C 档”或“AC 无证据”按 blocker 处理。
5. 任何 AC 的措辞变更必须走第 11 节，且在变更记录表追加一行。

---

## 1. 现状基线（冻结事实）

以下事实取自 HEAD `9a1bd7d` 的实际源码（`src/graph.js` / `src/routes.js` / `src/tools.js` / `src/config.js` / `src/index.js` / `test/local.mjs` / `README.md`），t2 起不得把它们当作“可能已改”。

| 维度 | 现状 | 源码位置 |
|---|---|---|
| 探索轴 | 仅 `references` / `citations` / `related` 三条，且**无任何时间约束** | `src/graph.js:312-332`、`src/graph.js:401-409` |
| 时间语义 | `related` 用 OpenAlex `related_works`；`citations` 按 `cited_by_count:desc` 取前 N；**没有** Earlier/Later 判定 | `src/graph.js:200-215` |
| 作者轴 | 作者只在 `details` 里作为显示名返回，**没有** author id、没有按作者展开 | `src/graph.js:100-112`、`src/graph.js:217-227` |
| 组织 | 单一扁平 collection（`seeds` 数组），无 collection 实体、无层级、无多归属 | `src/graph.js:139-141`、`src/graph.js:376-398` |
| 暂存区 | 无 Recently Found；节点进图即进图，没有“探索过但未收藏”的概念 | 全仓库无相关字段 |
| 持久化 | 纯内存（`nodes` / `links` / `catalog` / `seeds` / `cache` 五个 Map/数组），**无 fs / storage / localStorage**；重启即清空 | `src/graph.js:133-142`、`README.md:79-84` |
| 笔记/标签/颜色 | 无 | 全仓库无相关字段 |
| 导出 | 无任何导出；BibTeX 不存在 | 全仓库无 `bibtex` 字样 |
| 配额 | 搜索 `per-page=20`；`maxBatch=30`（references/related）；`maxCitations=25`；图上限 `maxNodes=400`；`expandAll` 只展开前 **6** 个 seed | `src/graph.js:169-174`、`src/config.js:11-18`、`src/graph.js:412-429` |
| 数据源 | 仅 OpenAlex（`https://api.openalex.org`，无 key，带 `mailto` polite pool） | `src/graph.js:17`、`src/graph.js:167` |
| 路由 | `POST /dsh-research-cat/{state,search,addSeed,removeSeed,expand,expandAll,details,clear}` + loopback 围栏 + `application/json` 强制；信封 `{ok,value}` / `{ok:false,error:{code,message}}` | `src/routes.js:17`、`src/routes.js:117-164` |
| agent 工具 | `research_cat`，4 个 action：`search` / `add` / `expand` / `list` | `src/tools.js:62-127` |
| 面板 | 侧栏图标 + 中央面板；径向布局 `computeLayout`；三个边类型开关；Auto-expand / Re-layout / Clear | `src/client.js`、`README.md:68-70` |
| 测试 | `test/local.mjs` 33 项本地检查（Loader 契约 / 配置默认值 / 引擎真实检索 / host 接线 / 工具 schema） | `test/local.mjs:20-190` |
| 网络依赖 | 引擎测试会真实访问 OpenAlex（离线时该项判 failed 并打印原因） | `test/local.mjs:80-87` |

**基线结论**：本轮 A 档的 7 项中，只有 `references/citations/related` 与径向引用图已有实现；作者轴、Earlier/Later、多 seed、筛选、配额、BibTeX 导出、时间线视图全部为**新增**。B 档 4 项全部为**新增**（持久化是从 0 到 1）。

---

## 2. 来源（已逐条抓取验证，2026-09 核对）

| 代号 | 来源 | URL | 用于 |
|---|---|---|---|
| S1 | 官网首页 | https://www.researchrabbit.ai/ | 定位、种子/学习型推荐的官网表述 |
| S2 | 官网 Features | https://www.researchrabbit.ai/features | 迭代搜索、组织、连接可视化、学习型算法 |
| S3 | 官网 Pricing | https://www.researchrabbit.ai/pricing | 免费档 50 seeds / RR+ 300 seeds / 机构版 |
| S4 | 帮助中心首页 | https://learn.researchrabbit.ai/en/ | 栏目与文章索引 |
| S5 | Free Tier | https://learn.researchrabbit.ai/en/articles/12865509-researchrabbit-free-tier | **≤50 种子**、citations/references/similar、引用图、Collections/Subcollections、Zotero、分享、**BibTeX 导入导出**、**notes/stickers/colors** |
| S6 | What is RR+ | https://learn.researchrabbit.ai/en/articles/12454495-what-is-researchrabbit | RR+ 高级检索、300 seeds、Multiple Projects |
| S7 | Advanced Search filters in RR+ | https://learn.researchrabbit.ai/en/articles/14531882-using-advanced-search-filters-in-rr | 筛选维度：keywords / date / journal / quartile |
| S8 | Search algorithm | https://learn.researchrabbit.ai/en/articles/12875619-what-s-behind-researchrabbit-s-search-algorithm | 候选=连接（引用/共引/作者/语义）、排序固定、Basic/Advanced settings |
| S9 | The ResearchRabbit Database | https://learn.researchrabbit.ai/en/articles/12454605-the-researchrabbit-database | **3 个数据源**：Crossref / Semantic Scholar / OpenAlex |
| S10 | Organizing with Collections | https://learn.researchrabbit.ai/en/articles/12454600-organizing-your-articles-with-collections | **Recently Found**、多层 subcollection、move/copy/delete、Autosave |
| S11 | How to share papers and collections | https://learn.researchrabbit.ai/en/articles/13192798-how-to-share-papers-and-collections | 公开链接 / 邀请 Editor-Viewer、导出 BibTeX/RIS/CSV、复制引文、截图分享 |
| S12 | Zotero Importer | https://learn.researchrabbit.ai/en/articles/12796541-using-the-zotero-importer | Zotero OAuth 链接、按 Zotero collection 导入、单向导入、回写靠 BibTeX |
| S13 | Earlier Work | https://learn.researchrabbit.ai/en/articles/12454543-how-do-i-search-earlier-work-in-the-new-researchrabbit | Earlier = 种子**之前的** references（"All References"） |
| S14 | Later Work | https://learn.researchrabbit.ai/en/articles/12454547-how-do-i-search-later-work-in-the-new-researchrabbit | Later = 种子**之后的** citations（"All Citations"） |
| S15 | Similar Work | https://learn.researchrabbit.ai/en/articles/12454538-how-do-i-search-similar-work-in-the-new-researchrabbit | Similar = "Find Related Articles"；导入 BibTeX/RIS/CSV |
| S16 | Citations & References | https://learn.researchrabbit.ai/en/articles/12454564-how-do-i-see-citations-and-references-in-the-new-researchrabbit | "Refs" / "Cited by" 两个按钮，列表+可视化 |
| S17 | Explore authors | https://learn.researchrabbit.ai/en/articles/12439865-how-to-explore-authors | 点作者名 → 该作者全部文章的作者地图；可按年/关键词筛选 |
| S18 | How to search | https://learn.researchrabbit.ai/en/articles/12454528-how-to-search-in-researchrabbit | 关键词/DOI/Collection/导入四种起点；种子驱动迭代；"hops" |
| S19 | Welcome to the new RR | https://learn.researchrabbit.ai/en/articles/12440130-welcome-to-the-new-researchrabbit | 2025-10 改版：新搜索流、迭代、**任意论文集合作为种子**、内置笔记、RR+ |
| S20 | Getting started | https://learn.researchrabbit.ai/en/articles/12439939-how-to-get-started-with-researchrabbit | 引用网络、seed dots、**X 轴=时间 / Y 轴=被引**、Recently Found |
| S21 | Introduction | https://learn.researchrabbit.ai/en/articles/12454456-introduction-to-researchrabbit | **colors and labels**、"learns from your choices" |
| S22 | Build a citation map（官方博客） | https://www.researchrabbit.ai/articles/build-citation-map-with-researchrabbit | Citation view、backward/forward citations、filters（时间/关键词/作者）、tags/notes/颜色标签、导出 |
| S23 | Organize papers（官方博客） | https://www.researchrabbit.ai/articles/how-to-organize-research-papers | Zotero **单向**导入、BibTeX 回写、阅读状态、第三方浏览器连接器 |
| S24 | Reading Lists | https://learn.researchrabbit.ai/en/articles/15890653-track-your-reading-with-reading-lists | 五种阅读状态（To Read/Later/Up Next/Skimmed/Read Fully/Understood） |
| S25 | Signals | https://learn.researchrabbit.ai/en/articles/15888747-exploring-article-risk-with-signals-indicators | RR+ 学术风险指标（仅登记，见第 9 节） |

**来源勘误（必须记录）**：帮助文档多处把 RR+ 高级检索指向 `…/articles/12454601-advanced-search-with-rr`，该 URL 实测 **HTTP 404**；可用页为 S7（`14531882`）。本规格以 S7 为准。

---

## 3. 范围三档总表

| 档 | 含义 | 编号 | 功能 | RR 依据 | 本轮状态 |
|---|---|---|---|---|---|
| 1 本轮做 | 必须实现 + 必须验收 | A0 | 既有三轴 + 径向引用图回归，并为新边类型扩展图例 | S5,S16,S20,S22 | 已有部分，需扩展 |
| 1 | | A1 | **作者轴**（按作者展开其全部作品） | S17,S8,S22 | 新增 |
| 1 | | A2 | **多 seed 同时展开**（≤50 个种子） | S3,S5,S19,S18 | 新增 |
| 1 | | A3 | **Earlier / Later Work 时间轴** | S13,S14,S16 | 新增 |
| 1 | | A4 | **筛选**（年份区间 / 期刊 / 开放获取 / 撤稿 / 最低被引） | S7,S17,S22 | 新增 |
| 1 | | A5 | **配额提升**（搜索 20→50，引用 25→100，参考/相似 30→100，图上限 400→1000，expandAll 6→50） | S3,S5 | 改数值 |
| 1 | | A6 | **时间线视图**（X=年份，Y=被引） | S20,S22 | 新增 |
| 1 | | A7 | **BibTeX 导出** | S5,S11,S12,S23 | 新增 |
| 1 | | B1 | **持久化库**（本地落盘，重启存活） | S10,S19（"your data … right as you left them"） | 新增 |
| 1 | | B2 | **多 collection / 多层 subcollection**（含多归属、移动/复制） | S5,S10,S22 | 新增 |
| 1 | | B3 | **Recently Found 暂存区** | S10,S20,S18 | 新增 |
| 1 | | B4 | **笔记 / 标签 / 颜色** | S5,S19,S21,S22 | 新增 |
| 2 明确排除 | 本轮不做、且**不**作为待决策项 | X1–X6 | 见第 7 节 | — | 排除 |
| 3 待用户决策 | 只登记，**默认不纳入本轮**；须用户拍板 | C1–C11 | 见第 8 节 | — | 待决策 |

**C 档强制归属（契约要求，不得默认纳入本轮）**：协作分享（C3）、Zotero 导入（C2）、多数据源聚合（C5）、学习型推荐（C6）、移动端/浏览器插件（C8）。账号云端库（C4）、RR+ 高级检索（C7）、BibTeX/RIS/CSV 导入（C1）、阅读状态（C9）、复制引文（C10）、Signals（C11）同样只能进“待决策”。

---

## 4. A 档逐条验收（档 1，本轮必须做）

> 每条 AC 的“证据”列给出 t5 必须提交的最小证据形态。`test/local.mjs` 指扩展现有本地测试；`route probe` 指对 `POST /dsh-research-cat/*` 的真实 HTTP 调用（loopback + `application/json`）；`panel step` 指在 DSH web GUI 中的可复现人工步骤。

### A0 · 既有探索能力与引用图回归（RR-02 部分 / RR-04）

**RR 依据**：S5（free tier: "Fast browsing of citations, references, and similar articles"、"Visualisation of how articles connect using citation maps"）、S16、S20、S22。
**目标**：不因本轮改造而回退既有能力；新增的边类型（earlier/later/author）必须在图上有可区分表现。

| AC | 可判定判据 | 证据 |
|---|---|---|
| AC-A0-1 | `test/local.mjs` 原有 33 项检查全部通过（允许新增检查，不允许删除或弱化既有检查；`check()` 调用总数 ≥ 33 且原有 33 个标签仍在） | `node test/local.mjs` 输出 `local: all checks passed` + 标签清单 diff |
| AC-A0-2 | `POST /expand` 的 `kind` 仍接受 `references`/`citations`/`related`，且返回字段名不变（`kind`/`found`/`added`/`graph`/`counts`） | route probe 三次，断言 `ok===true` 且键集合一致 |
| AC-A0-3 | `research_cat` 工具的 `search`/`add`/`expand`/`list` 四个 action 行为与文案契约不变（`expand` 默认 kind 仍为 `related`） | `test/local.mjs` 工具 schema 检查 + tool probe |
| AC-A0-4 | `/state` 与工具 `list` 仍返回既有 `graph`/`counts` 结构；`counts` 新增的键只增不改（`papers`/`links`/`seeds`/`reference`/`citation`/`related` 仍在且语义不变） | 键集合断言 |
| AC-A0-5 | 图能同时渲染 ≥5 种边类型（references/citations/related/earlier/later/author），面板为每种边提供独立开关与可区分的线型/颜色，且任一开关关闭后该类边不绘制 | panel step（截图或文字描述操作序列 + 观察结果）+ client 源码中边类型枚举断言 |
| AC-A0-6 | loopback 围栏与 `application/json` 强制未回退：非 loopback 或错误 content-type 的请求仍被 403/415 拒绝 | route probe（伪造 `Origin`/content-type） |
| AC-A0-7 | 图上限与清空语义未回退：`Clear` 后 `counts.papers === 0 && counts.seeds === 0`；到上限时展开被拒绝并给出可读提示 | route probe `/clear` + `/expand` |

### A1 · 作者轴（RR-02 第四条轴）

**RR 依据**：S17（点作者名 → 该作者全部文章的作者地图，文章按被引与时间排序）、S8（"These Authors" 候选 = 种子作者本人；作者候选同样按连接排序）、S22（author filters）。
**现状差距**：`DETAIL_SELECT` 已含 `authorships`，但引擎丢弃 author id；无按作者查询。

| AC | 可判定判据 | 证据 |
|---|---|---|
| AC-A1-1 | `POST /authors {id}` 返回该论文的作者列表，每项含 `{id, name, worksCount?}`，其中 `id` 匹配 `^A\d+$`（OpenAlex author id），顺序与 `authorships` 一致 | route probe：对 `W2907492528` 断言 `authors.length>0` 且首项 id 匹配正则 |
| AC-A1-2 | `POST /expand {id, kind:"author", authorId}` 返回该作者的作品集合，边类型为 `author`，来源节点为传入的 `id` | route probe：断言 `kind==='author'`、`added>0`、`graph.links` 中存在 `kind==='author'` 且 `source===id` |
| AC-A1-3 | 作者作品按 `citedBy` 降序返回；并列时按 `year` 降序（稳定、可复现） | route probe：断言返回序列的 `citedBy` 单调不增 |
| AC-A1-4 | 未给 `authorId` 时 `kind:"author"` 报错且消息含可用作者 id 提示（不静默取第一作者） | route probe 断言 `ok===false` 且 `error.message` 含 `authorId` |
| AC-A1-5 | 作者轴结果同样受 A4 筛选与 A5 配额约束（`author` 轴单次 ≤ `maxBatch` 条） | route probe：带 `filters.yearFrom` 时结果年份全部 ≥ 阈值；返回条数 ≤ maxBatch |
| AC-A1-6 | 面板可从详情里的作者名一键展开作者轴；展开后作者节点/边与其它边类型视觉可区分 | panel step |

### A2 · 多 seed 同时展开（RR-01 的“多输入”面）

**RR 依据**：S3/S5（免费档 **up to 50 seed articles**）、S19（"Search from any set of articles"、可混合多个 collection 的文章）、S18（种子驱动迭代）。
**现状差距**：`expandAll` 硬编码 `seeds.slice(0, 6)` 且只跑 `references`+`related`。

| AC | 可判定判据 | 证据 |
|---|---|---|
| AC-A2-1 | `addSeed` 允许累计到 **50** 个种子；第 51 个被拒绝且消息含上限值 `50`（不得静默丢弃） | `test/local.mjs` 用 51 个 id 断言 + route probe |
| AC-A2-2 | `POST /expandAll {kinds?}` 对**全部**种子（上限 50）执行；`kinds` 缺省为 `["references","related"]`，可传任意子集含 `earlier`/`later`/`author` | route probe：3 个种子 + `kinds:["earlier","later"]`，断言每个种子都产生了对应边 |
| AC-A2-3 | 单个种子失败（如 OpenAlex 404/超时）**不中断**整批：返回 `{added, perSeed:[{id,kind,found,added,error?}], skipped, warning}`，至少一个 `error` 非空时 `ok===true` 仍成立 | route probe：注入一个不存在的 work id，断言其余种子仍被展开 |
| AC-A2-4 | 并发受限：同时进行的 OpenAlex 请求数 ≤ 4（配置 `concurrency`，默认 4）；50 种子 × 2 轴的最坏情况不产生 >4 并发 | 引擎内计数器断言（测试注入 fetch 计数器）+ 输出请求总数 |
| AC-A2-5 | 幂等：同一批种子连续 `expandAll` 两次，第二次 `added === 0` 且 `counts.papers` 不变 | route probe 两次 |
| AC-A2-6 | 图上限保护：接近 `maxNodes` 时停止继续拉取，返回 `skipped>0` 与原因，不抛未处理异常、不产生半写状态（`counts.papers <= maxNodes`） | route probe：`maxNodes` 调小后展开 |
| AC-A2-7 | 面板 `Auto-expand` 使用新的 `expandAll`（不再只覆盖前 6 个种子），并在 UI 上显示本次展开的种子数/跳过数 | panel step |

### A3 · Earlier / Later Work 时间轴（RR-03）

**RR 依据**：S13（Earlier = 种子的 "All References"，限定早于输入论文）、S14（Later = 种子的 "All Citations"，晚于输入论文）、S16（Refs / Cited by 两个入口）、S20（"Trace the origins of ideas (earlier work)" / "See how research has evolved over time (later work)"）。
**本轮解释（冻结）**：RR 新版把 Earlier/Later 实现为“references/citations + 时间约束”。因此本轮 `earlier` = 种子 references 中 `year < 种子 year` 的部分；`later` = 种子 citations 中 `year > 种子 year` 的部分。严格不等（同年不计入）。`year === 0`（OpenAlex 缺年份）**不计入** earlier/later，但在 references/citations 原轴中照常保留。

| AC | 可判定判据 | 证据 |
|---|---|---|
| AC-A3-1 | `POST /expand {id, kind:"earlier"}` 返回的每个新节点满足 `node.year < seed.year`，边类型为 `earlier`；结果集是种子 references 的子集 | route probe：断言所有新增节点年份严格小于种子年份 |
| AC-A3-2 | `POST /expand {id, kind:"later"}` 返回的每个新节点满足 `node.year > seed.year`，边类型为 `later`；结果集是种子 citations 的子集 | route probe：断言所有新增节点年份严格大于种子年份 |
| AC-A3-3 | 边界：与种子同年、以及 `year===0` 的邻居不出现在 earlier/later 结果中；若因此结果为空，返回 `found:0` 且 `ok===true`（不得报错） | `test/local.mjs` 构造同年/缺年份样本 |
| AC-A3-4 | 多 seed 场景下逐种子比较（阈值 = 该种子自身年份），不混用全局阈值 | route probe：两个不同年份种子，断言各自结果分别满足各自阈值 |
| AC-A3-5 | 面板在详情里提供 `Earlier` / `Later` 两个入口（对应 RR 的 Refs/Cited by 时间约束语义），点击后图上新增边可区分 | panel step |
| AC-A3-6 | `earlier`/`later` 结果同样受 A4 筛选与 A5 配额约束（单次 ≤ `maxBatch`） | route probe |

### A4 · 筛选（RR-16；不含 RR+ 专有维度）

**RR 依据**：S7（RR+ 高级筛选：keywords / date / journal / quartile）、S17（作者地图可按年/关键词筛选）、S22（citation map 的 time/topic/author filters）。
**本轮范围（冻结）**：实现 OpenAlex 可原生支撑且可离线判定的 5 个维度；`quartile`（SJR 分区）与期刊 H-Index **不在本轮**（见 C7），keywords-in-title/abstract 也不在本轮（见 C7）。

| 筛选键 | 语义 | 判定方式 |
|---|---|---|
| `yearFrom` / `yearTo` | 闭区间，缺省 = 无界 | 结果 `year` 落在区间内（`year===0` 视为不满足任一侧有界条件） |
| `venue` | 期刊/venue 名，大小写不敏感子串匹配 | 结果 `venue` 含该子串（`venue===null` 视为不满足） |
| `isOa` | 布尔 | 结果 `openAccess` 与该值相等 |
| `isRetracted` | 布尔 | 结果 `retracted` 与该值相等 |
| `minCitations` | 整数下限（含） | 结果 `citedBy >= minCitations` |
| `sort` | `"cited"`（默认）或 `"year"` | 返回序列按该键单调不增/不增（`year` 排序允许并列） |

| AC | 可判定判据 | 证据 |
|---|---|---|
| AC-A4-1 | `search`、`expand`（全部 6 种 kind）、`authors`、`expandAll` 均接受 `filters` 对象；同一 `filters` 在不同轴上语义一致 | `test/local.mjs` 参数化断言 |
| AC-A4-2 | `yearFrom`/`yearTo` 为闭区间：边界年份的论文**包含**在结果中；`yearFrom > yearTo` 时返回 `ok:false` 且消息可读（不得返回空集冒充成功） | route probe：构造边界与非法区间 |
| AC-A4-3 | `venue` 大小写不敏感子串匹配；`venue:""` 视为未提供（等价于不筛） | `test/local.mjs` |
| AC-A4-4 | `isOa` / `isRetracted` 生效，且记录中新增 `openAccess` / `retracted` 字段（布尔，缺数据时为 `false` 而不是 `null`） | route probe：`isRetracted:true` 结果全部 `retracted===true` |
| AC-A4-5 | `minCitations` 生效且为闭区间下限 | route probe |
| AC-A4-6 | 筛选后结果数可以少于请求配额；返回体必须如实报告 `found`（实际通过筛选的条数），**不得**用未筛选条数冒充 | route probe：比较带/不带 filters 的 `found` |
| AC-A4-7 | 非法筛选值（未知键、非布尔、负数 `minCitations`、非法 `sort`）→ `ok:false` + `error.code==='invalid'`，不静默忽略 | route probe + `test/local.mjs` |
| AC-A4-8 | 筛选是**纯后置**判定（对 id 列表型轴）且结果确定：同一输入两次调用返回同一 id 序列 | route probe 两次比对 |
| AC-A4-9 | 面板提供筛选 UI（年份区间 + 期刊 + OA + 撤稿 + 最低被引），改动后重新查询并显示“筛选前/后条数” | panel step |

### A5 · 配额提升（RR-01 的“≤50”面）

**RR 依据**：S3/S5（免费档 50 种子）、S6（RR+ 300 种子，本轮不追）、S18（搜索/迭代）。
**现状差距**：搜索 20、references/related 30、citations 25、`maxNodes` 400、`expandAll` 6 个种子。

| AC | 可判定判据 | 证据 |
|---|---|---|
| AC-A5-1 | 配置默认值变为：`searchPerPage=50`、`maxBatch=100`、`maxCitations=100`、`maxNodes=1000`、`maxSeeds=50`、`concurrency=4`；`resolveConfig` 对非法值仍回落到默认值 | `test/local.mjs` 断言默认对象 |
| AC-A5-2 | 搜索实际请求 `per-page=50` 并返回 ≤50 条（OpenAlex 返回条数可能更少，如实报告） | route probe / fetch URL 断言 |
| AC-A5-3 | `expand {kind:"references"}` 单次最多拉取 100 条；**不得**因 OpenAlex `openalex_id` OR 过滤的单次 id 上限（50）而在 50 处静默截断——必须分块请求并返回 >50 条（当底层数据充足时） | `test/local.mjs`：断言分块函数对 100 个 id 生成 2 次请求；route probe 对高参考量论文断言 `found>50` |
| AC-A5-4 | `expand {kind:"citations"}` 单次最多 100 条 | route probe：`found <= 100` 且通常 >25 |
| AC-A5-5 | 图上限 1000：达到上限后的展开被拒绝并提示先 Clear；`counts.papers` 从不超过 `maxNodes` | route probe（小 `maxNodes` 覆盖） |
| AC-A5-6 | 全部配额键可经插件配置覆盖（`cordis.patch.yml` / profile 配置），覆盖值生效且被 `resolveConfig` 记录 | `test/local.mjs` 覆盖用例 |
| AC-A5-7 | 配额提升不改变 polite pool 行为：每个 OpenAlex 请求仍带 `mailto` | fetch URL 断言 |

### A6 · 时间线视图（RR-15）

**RR 依据**：S20（"**X-axis** = timeline (older to newer papers). **Y-axis** = influence (citation count)"）、S22（Citation view；X=publication date，Y=citation count）、S1/S2（交互式引用地图）。
**现状差距**：只有径向布局（hub 居中 + BFS 分层 + 角色扇区），无时间轴布局。

| AC | 可判定判据 | 证据 |
|---|---|---|
| AC-A6-1 | 面板提供布局切换：`Radial`（默认）与 `Timeline`；切换不重载页面、不丢选中状态 | panel step |
| AC-A6-2 | `Timeline` 下节点 x 坐标由 `year` 单调决定：按 `year` 升序排列后 x 非严格不减；同年节点 x 相同或按稳定次序紧邻 | client 布局函数单测（导出纯函数 + 断言） |
| AC-A6-3 | `Timeline` 下节点 y 坐标由 `citedBy` 决定：`citedBy` 越大 y 越靠上（或越靠下，但必须单调且方向在文档中写明） | client 布局函数单测 |
| AC-A6-4 | 轴标签可读：x 轴显示年份刻度（至少 min/max 与 3 个中间刻度），y 轴显示被引量刻度 | panel step + 断言刻度数组非空 |
| AC-A6-5 | `year===0` 的节点不被丢弃，也不被硬塞到最左/最右：进入单独的 “year unknown” 带或按文档写明的规则放置，且该规则在 AC 证据中写明 | client 布局函数单测 |
| AC-A6-6 | 边类型在图上有可区分表现（与 AC-A0-5 同一套样式），时间线模式下同样生效 | panel step |
| AC-A6-7 | `Radial` 模式输出与基线一致：同一份输入数据下节点坐标与 `9a1bd7d` 的实现一致（或差异有明确记录并由 t6 认可） | 基线快照对比（lab/render.mjs 或纯函数快照） |

### A7 · BibTeX 导出（RR-08 的“导出”面）

**RR 依据**：S5（"Import and Export articles using BibTeX files"）、S11（Library → 选文章 → Export → BibTeX/RIS/CSV）、S12/S23（"bring articles back into Zotero using the Export feature – Zotero will happily import the BibTeX file format"）。
**本轮范围（冻结）**：只做 **BibTeX 导出**；RIS/CSV 导出与全部导入见 C1。

| AC | 可判定判据 | 证据 |
|---|---|---|
| AC-A7-1 | `POST /export {format:"bibtex", ids?:[...], collectionId?:string}` 返回 `{format:"bibtex", count, bibtex}`；`ids` 缺省导出当前图全部节点，`collectionId` 导出该 collection 的成员（含子 collection 成员，规则须在 t2 写明并在此引用） | route probe |
| AC-A7-2 | 输出是**可解析**的 BibTeX：`test/local.mjs` 内置解析器能数出 `count` 个条目，且每个条目有 `title` 与 `year`，且 `title`/`year` 与图内数据一致 | `test/local.mjs` 解析断言 |
| AC-A7-3 | 每个条目含 `author`（作者多于 1 人时以 ` and ` 连接）；作者数据缺失时该字段可省略，但不得输出空 `author={}` | `test/local.mjs` |
| AC-A7-4 | 每个条目至少含 `doi` 或 `url` 之一（`doi` 来自 work，`url` 为 `https://openalex.org/<id>`） | `test/local.mjs` |
| AC-A7-5 | citation key 唯一且确定：同名作者同年的多篇不冲突（追加 work id 或字母后缀）；同一输入两次导出 **byte-identical** | `test/local.mjs` 两次导出字符串相等 |
| AC-A7-6 | 类型映射固定并在文档中列出：`journal-article→@article`、`book→@book`、`book-chapter→@incollection`、`proceedings-article→@inproceedings`、`dataset→@misc`、其余→`@misc` | `test/local.mjs` 逐类型断言 |
| AC-A7-7 | LaTeX 转义：`& % $ # _ { } ~ ^ \` 在 `title`/`author`/`venue` 中被转义（`~`→`\textasciitilde{}`、`^`→`\textasciicircum{}`、`\`→`\textbackslash{}`）；UTF-8 非 ASCII 字符原样保留（不转成 `\uXXXX`） | `test/local.mjs` 含特殊字符样本 |
| AC-A7-8 | 空输入（图与 collection 均空）返回 `count:0` 与合法空 BibTeX（不得报错、不得输出半截条目） | route probe |
| AC-A7-9 | 面板提供导出入口（导出当前 collection / 导出全部），浏览器实际下载 `.bib` 文件；文件名稳定（如 `research-cat-<collection|all>-<date>.bib`） | panel step + 下载文件抽查 |
| AC-A7-10 | agent 工具新增 `export` action，返回 BibTeX 文本（超长时截断并注明“已截断，完整内容请用面板导出”），且截断不产生无法解析的半条目 | tool probe + `test/local.mjs` |

---

## 5. B 档逐条验收（档 1，本轮必须做）

### B1 · 持久化库（本地落盘，重启存活）

**RR 依据**：S10（Recently Found 与 Collections 构成 Library）、S19（"Your data, including your collections and saved articles are safe and right as you left them"）、S2（"your research organizes itself as you go"）。
**本轮范围（冻结）**：本地文件持久化，**不是**云端账号（C4）。默认路径 `~/.dsh/research-cat/library.json`，可由配置 `storePath` 覆盖；若 t2 找到等价的 DSH 官方 storage 服务，可替换存储介质，但必须满足下列全部 AC，并把实际路径写入 t2 文档与本表引用。

| AC | 可判定判据 | 证据 |
|---|---|---|
| AC-B1-1 | 写盘后重启进程（或重新 `createLibrary` 指向同一路径），`/state` 返回的 collections / 成员 / 笔记 / 标签 / 颜色 / Recently Found 与重启前**逐字段相等** | `test/local.mjs`：两次实例化同一 `storePath`，深比较 |
| AC-B1-2 | 落盘是原子的：写入过程使用临时文件 + rename（或等价机制）；测试在写入中途注入异常后，磁盘上要么是旧完整内容、要么是新完整内容，绝不出现截断 JSON | `test/local.mjs` 注入异常 + 断言文件可解析 |
| AC-B1-3 | 文件含 `version` 字段；读取到未知/更高版本时**不崩溃**：保留原文件为 `.bak`，以空库启动，并在 `/state` 返回 `storeError` 可读消息 | `test/local.mjs` 构造坏版本文件 |
| AC-B1-4 | 文件损坏（非 JSON / 截断 / 空文件）时同上：不崩溃、不静默丢数据（保留 `.bak`）、`storeError` 非空 | `test/local.mjs` |
| AC-B1-5 | 写入有节流/合并（连续 N 次写操作不产生 N 次磁盘写，或每次写都完整且原子），且不阻塞 HTTP 响应超过 200ms（本地实测） | 测试统计写次数 + route probe 计时 |
| AC-B1-6 | 持久化不影响既有语义：`/clear` 清空图与库（并按 t2 写明是否删除文件）；`removeSeed` 后落盘内容同步 | route probe + 文件内容检查 |
| AC-B1-7 | 无网络也能启动与读取库：断网时 `/state` 仍返回已持久化数据（仅网络型操作报错） | `test/local.mjs` 屏蔽 fetch |
| AC-B1-8 | `storePath` 可配置；非法路径（不可写目录）不导致插件加载失败，而是降级为内存态 + `storeError` | `test/local.mjs` |
| AC-B1-9 | README 更新：删除“内存态、不落盘”的旧限制描述，写明库文件位置、清空方式、备份方式（文档变更属 t8，但 AC 在此登记） | README diff（t8 交付） |

### B2 · 多 collection / 多层 subcollection

**RR 依据**：S5（"Saving articles to Collections and Subcollections"）、S10（Parent 可形成多层 sub-subcollection；move/copy/delete；文章移动后仍在 Library；子 collection 随父一起被分享——分享属 C3）。
**现状差距**：`seeds` 是唯一扁平集合。

| AC | 可判定判据 | 证据 |
|---|---|---|
| AC-B2-1 | `POST /collections {op:"list"}` 返回 collection 树（含 `id`/`name`/`parentId`/`itemCount`），无 collection 时返回空数组 | route probe |
| AC-B2-2 | `op:"create"` 支持 `parentId`，可形成 **≥3 层**嵌套（父→子→孙）；父不存在时 `ok:false` | route probe |
| AC-B2-3 | `op:"rename"` 改名成功且树结构不变；重名允许（id 唯一即可），不得因重名报错 | route probe |
| AC-B2-4 | `op:"delete"` 删除 collection **不删除** Library 中的文章：文章仍可通过其它 collection 或 Recently Found 访问 | route probe：删掉唯一 collection 后断言文章仍在库 |
| AC-B2-5 | 删除含子 collection 的父 collection 时行为明确且被测试固定（级联删除子树 或 拒绝删除并提示，二者择一写入 t2；AC 断言所选行为） | route probe + t2 引用 |
| AC-B2-6 | 一篇文章可同时属于**多个** collection（多归属），`save` 是“复制入集”语义，`remove` 只解除该归属 | route probe：同一 id 存入两个 collection，断言两处都在 |
| AC-B2-7 | `op:"save"` / `op:"remove"` 支持批量 `ids`；对不存在的 id 返回明确错误或 `skipped` 列表，不静默成功 | route probe |
| AC-B2-8 | 每个 collection 的 `itemCount` 与实际成员数一致（含子 collection 时口径在 t2 写明并断言所选口径） | route probe 计数比对 |
| AC-B2-9 | 树结构在 B1 持久化下重启存活；循环父子（把祖先设为子）被拒绝 | `test/local.mjs` |
| AC-B2-10 | 面板提供 collection 树：创建/重命名/删除/新建子 collection、拖拽或按钮移动/复制、点击 collection 显示其文章 | panel step |
| AC-B2-11 | agent 工具新增 `collections` action，覆盖 list/create/rename/delete/save/remove，输出为可读文本且含 collection id | tool probe |

### B3 · Recently Found 暂存区

**RR 依据**：S10（Recently Found = ① 用作种子的文章 + ② 探索过但未存入 collection 的文章；位于 Library 顶部；与 Collections 分工：探索 vs 组织）、S20（"leave it in Recently Found while you explore"）、S18（"Save To" 随时保存）。
**冻结语义**：进入过图的文章（无论来自搜索/展开/作者轴/时间轴）只要**未显式存入任何 collection**，就出现在 Recently Found；一旦存入任一 collection，则从 Recently Found 移除，但仍留在 Library。

| AC | 可判定判据 | 证据 |
|---|---|---|
| AC-B3-1 | `POST /recentlyFound {op:"list"}` 返回按“最近进入图”降序的 work id 列表（去重，每 id 仅一次），无则空数组 | route probe |
| AC-B3-2 | `addSeed` 后该 id 出现在 Recently Found 首位 | route probe |
| AC-B3-3 | `expand`/`expandAll`/作者轴/时间轴新进图的节点自动进入 Recently Found | route probe |
| AC-B3-4 | 把某 id `save` 进任一 collection 后，该 id 从 Recently Found 移除；`remove` 出该 collection 且不再属于任何 collection 时，该 id 回到 Recently Found（或按 t2 写明的确定规则处理，AC 断言所选规则） | route probe |
| AC-B3-5 | `op:"clear"` 清空暂存区**不删除** Library 文章、不影响 collection 成员 | route probe |
| AC-B3-6 | 暂存区有上限（写入 t2，建议 500）并在超限时按最久未进入丢弃，丢弃是确定性的 | `test/local.mjs` |
| AC-B3-7 | 暂存区在 B1 持久化下重启存活 | `test/local.mjs` |
| AC-B3-8 | 面板在 Library 顶部显示 Recently Found，支持勾选后“存入 collection”（含新建 collection），并可一键清空 | panel step |
| AC-B3-9 | agent 工具新增 `recent` action（list/clear/promote），输出含条数与 id | tool probe |

### B4 · 笔记 / 标签 / 颜色

**RR 依据**：S5（"Personalize research with notes, stickers, and colors"）、S19（内置笔记，位于文章详情）、S21（"Use collections, colors, and labels"）、S22（tags、notes、color-coded labels 用于按主题/方法/相关性分类）。
**冻结语义**：每篇文章（work id）一条笔记（多行文本）、一组标签（短字符串集合）、一个颜色标签（固定枚举）。**不**做 RR 的“阅读状态”下拉（见 C9）。

| AC | 可判定判据 | 证据 |
|---|---|---|
| AC-B4-1 | `POST /annotate {id, note?, tags?, color?}` 支持部分更新：只传 `note` 不影响 `tags`/`color`；返回更新后的完整注解对象 | route probe |
| AC-B4-2 | 笔记为多行文本，上限 10000 字符；超限返回 `ok:false`（不静默截断） | `test/local.mjs` |
| AC-B4-3 | `tags` 为字符串数组，单标签 ≤40 字符、最多 20 个；去重且保序；非法输入（非数组/超限）返回 `ok:false` | `test/local.mjs` |
| AC-B4-4 | `color` 取值限定在固定枚举 `["red","orange","yellow","green","blue","purple","gray"]`；非法值返回 `ok:false` 且消息列出合法值；`color:null` 表示清除 | `test/local.mjs` |
| AC-B4-5 | 注解随 B1 持久化重启存活；`/state` 中返回 `library.annotations`（或 t2 写明的等价字段） | `test/local.mjs` 深比较 |
| AC-B4-6 | 注解只对已有 work id 生效；对图中不存在的 id 返回 `ok:false`（不得凭空创建文章） | route probe |
| AC-B4-7 | 面板在详情面板中提供笔记编辑框、标签输入、颜色选择（含“无颜色”），改动即时保存并在节点/列表上可见（颜色至少体现在节点描边或列表色点） | panel step |
| AC-B4-8 | agent 工具新增 `annotate` action（读/写），输出含该 id 的 note 摘要、tags、color | tool probe |
| AC-B4-9 | 注解不进入 BibTeX 导出（导出契约见 A7；如未来要 `note={}` 字段，属变更） | `test/local.mjs` 断言导出不含注解文本 |

---

## 6. 冻结接口契约（t2/t3/t4 必须遵守）

### 6.1 路由（全部 `POST`，loopback 围栏 + `application/json`，信封形状不变）

| 路径 | 请求体 | 响应 `value` |
|---|---|---|
| `/dsh-research-cat/state` | `{}` | `{graph, counts, library:{collections, recentlyFound, annotations, storePath, storeError}}` |
| `/dsh-research-cat/search` | `{query, filters?, page?}` | `{term, results, filters, graph, counts}` |
| `/dsh-research-cat/addSeed` | `{id}` | 既有形状 + 暂存区影响 |
| `/dsh-research-cat/removeSeed` | `{id}` | 既有形状 |
| `/dsh-research-cat/expand` | `{id, kind, authorId?, filters?}` | `{kind, found, added, graph, counts}` |
| `/dsh-research-cat/expandAll` | `{kinds?, filters?}` | `{added, skipped, perSeed:[…], warning, graph, counts}` |
| `/dsh-research-cat/details` | `{id}` | `{paper}` |
| `/dsh-research-cat/authors` | `{id}` | `{authors:[{id,name}]}` |
| `/dsh-research-cat/collections` | `{op, id?, name?, parentId?, collectionId?, ids?}` | `{collections}` 或 `{collection}` |
| `/dsh-research-cat/recentlyFound` | `{op:"list"｜"clear"｜"promote", ids?, collectionId?}` | `{recentlyFound}` |
| `/dsh-research-cat/annotate` | `{id, note?, tags?, color?}` | `{annotation}` |
| `/dsh-research-cat/export` | `{format:"bibtex", ids?, collectionId?}` | `{format, count, bibtex}` |
| `/dsh-research-cat/clear` | `{scope?:"graph"｜"library"}` | `{graph, counts, library}` |

`kind` 枚举冻结为 `references | citations | related | earlier | later | author`。
`filters` 键冻结为 `yearFrom | yearTo | venue | isOa | isRetracted | minCitations | sort`。
错误码冻结为 `invalid`（参数错）/ `operation`（业务失败）/ `forbidden`（围栏）/ `notfound`（未知路由保持现状 404）。

### 6.2 agent 工具 `research_cat`

action 枚举冻结为 `search | add | expand | list | collections | recent | annotate | export`。
参数冻结为 `action, query, id, kind, authorId, filters, collectionId, parentId, op, ids, note, tags, color, format`。
输出仍为 `{ok, text}`（`RESULT_SCHEMA` 不变）。

### 6.3 配置键（`src/config.js`）

| 键 | 默认值 | 说明 |
|---|---|---|
| `exposeTool` | `true` | 既有 |
| `mailto` | `dsh-research-cat@localhost` | 既有，必须保留在每个 OpenAlex 请求上 |
| `searchPerPage` | `50` | 新增 |
| `maxBatch` | `100` | references/related/earlier/later/author 单次上限 |
| `maxCitations` | `100` | citations/later 单次上限 |
| `maxNodes` | `1000` | 图节点上限 |
| `maxSeeds` | `50` | 种子上限（RR 免费档对齐） |
| `concurrency` | `4` | OpenAlex 并发上限 |
| `storePath` | `~/.dsh/research-cat/library.json` | B1 库文件 |

### 6.4 记录字段（引擎对外节点对象）

在既有 `{id,title,year,citedBy,doi,venue,kind,seed}` 基础上**新增**：`openAccess`（bool）、`retracted`（bool）、`authorIds`（string[]，可为空数组）、`inLibrary`（bool）。既有键不得改名或删除。

---

## 7. 明确排除（本轮不做，且不作为待决策项）

| 编号 | 排除项 | RR 依据 | 排除理由 |
|---|---|---|---|
| X1 | RR+ 订阅计费、国家折扣、Institution 版（LibKey 集成、用户管理、用量统计） | S3,S6 | 纯商业/机构侧能力，与本地插件形态无关；无账号体系（见 C4） |
| X2 | 服务端托管形态与 SaaS 化（RR 是托管 Web 应用） | S1,S2 | 本插件是 DSH 进程内插件，不做独立后端 |
| X3 | 教学与督导资料、教程视频、社区内容 | S4,S25 索引 | 内容型资产，非功能 |
| X4 | 多语言 UI / 浏览器翻译引导 | S4（"Use ResearchRabbit in your own language"） | 依赖浏览器能力；面板保持现有中英文文案 |
| X5 | Multiple Projects（RR+ 的独立工作区，跨项目隔离文章/笔记） | S6 | 多 collection/子 collection（B2）已覆盖组织需求；若用户要求独立项目概念，转 C |
| X6 | Autosave 开关（种子自动存入指定 collection） | S10 | Recently Found（B3）已覆盖“不丢失”；开关是 RR 的便利项，不增加本轮可验收价值 |
| X7 | 图导出的图片/截图分享 | S11,S22 | 浏览器截图即可满足，非插件功能 |

> 说明：X 档不进入 t3/t4 的任何代码路径；评审若在实现中发现 X 档代码，按 blocker 处理。

---

## 8. 待用户决策（C 档：只登记，默认不纳入本轮）

**规则**：C 档在用户明确拍板前**不得实现**；拍板后必须由 spec 追加一条 A/B 编号与 AC，并重走 t1→t2 流程。每条 C 都写明前置条件（缺一不可）。

| 编号 | 功能 | RR 依据 | 前置条件（全部满足才可开工） | 若纳入的建议档位 |
|---|---|---|---|---|
| C1 | **BibTeX / RIS / CSV 导入**（含拖拽上传、按条目选择） | S5,S11,S15,S18 | ① 文件上传/读取通道（host 读本地文件或面板 File API）② BibTeX+RIS+CSV 解析器与字段映射 ③ 去重策略（DOI→标题归一）④ 与 C2 共用通道以避免两套解析 | 先做 BibTeX 导入（最小闭环），RIS/CSV 延后 |
| C2 | **Zotero 导入**（OAuth 链接、按 Zotero collection 选择、单向导入） | S5,S12,S23 | ① 第三方 OAuth 客户端注册与回调地址（本地插件无公网回调，需用户指定方案）② Zotero API key 的本地安全存储 ③ 用户确认“单向导入 + BibTeX 回写”可接受 ④ 网络出口策略 | 独立一轮 |
| C3 | **分享与协作**（公开链接、邀请 Editor/Viewer、共享子 collection、协作者可见笔记） | S5,S10,S11,S22 | ① 账号体系 ② 服务端存储与权限模型 ③ 多用户实时/准实时同步与冲突解决 ④ 共享链接的访问控制与撤销 | 独立一轮（跨多个仓库改动） |
| C4 | **账号云端库**（登录、云端集合同步、跨设备） | S3,S19 | ① 账号体系 ② 后端存储 ③ 同步冲突解决 ④ 隐私与数据归属说明 | 独立一轮 |
| C5 | **多数据源聚合**（Crossref + Semantic Scholar + OpenAlex） | S9,S19 | ① 各源鉴权与速率策略 ② 跨源去重合并（DOI/标题/年份归一）③ 引用边语义合并规则与来源标注 ④ 覆盖率与冲突的可解释策略 | 独立一轮（B1 数据模型需预留 source 字段） |
| C6 | **学习型推荐**（从用户选择中学习并改进排序） | S1,S2,S8,S21 | ① 账号级或本地长期行为数据 ② 特征/排序管线与离线评估集 ③ 隐私与可解释性说明 ④ 与“排序固定不可调”的 RR 现状对齐的口径 | 独立一轮（需先定义评估指标） |
| C7 | **RR+ 高级检索**（关键词/短语过滤、SJR 分区、期刊 H-Index、OA PDF、撤回状态、300 seeds、多项目） | S6,S7,S8 | ① SJR 分区与期刊 H-Index 的第三方数据源与许可（OpenAlex 无此字段）② 300 seeds 的速率与图上限策略 ③ 与 A4 基础筛选的 UI 分层 ④ 若涉及付费墙需产品决策 | 拆两批：关键词过滤（易）→ 分区/H-Index（难，需外部数据） |
| C8 | **移动端 / 浏览器插件** | S23（仅第三方浏览器连接器提及）；**官网与帮助中心未发现官方移动 App 或官方浏览器扩展条目** | ① 用户确认是否确有该需求及其形态（浏览器扩展 / 移动 Web / PWA）② 若为浏览器扩展：DSH 插件形态无法承载，需另立仓库与发布通道 ③ 若为移动端：面板布局的响应式改造范围 | 待用户定义形态后再评估 |
| C9 | **阅读状态 / Reading Lists**（To Read / Later / Up Next / Skimmed / Read Fully / Understood，属个人且按项目） | S23,S24 | ① 与 B4 标签体系的关系定义（独立字段 vs 特殊标签）② “未保存即标记自动入库”的行为确认 | 若用户要，可小步并入 B4 |
| C10 | **复制引文（按引用样式）** | S11 | ① CSL 样式引擎与样式选择 UI ② 样式库许可 | 低优先，可并入 A7 的导出家族 |
| C11 | **Signals 学术风险指标** | S25 | ① 撤稿/期刊风险数据源（OpenAlex 仅有 `is_retracted`）② 指标口径与免责说明 | 与 C5 数据源议题合并讨论 |

### 8.1 C 档的“本轮判定标准”（排除式验收，可判定）

C 档功能在本轮的验收判据是**“确实没做 + 前置条件已登记”**，因此同样可判定通过或失败：

| AC | 可判定判据 | 证据 |
|---|---|---|
| AC-C-1 | 本轮交付的代码/路由/工具 action/面板 UI 中不存在任何 C 档功能的入口、字段或分支：C1 文件上传与解析、C2 Zotero/OAuth、C3 分享/协作者/公开链接、C4 登录/云端同步、C5 第二数据源（Crossref/Semantic Scholar）、C6 行为学习排序、C7 关键词过滤与 SJR 分区/H-Index/300 seeds/多项目、C8 移动端或浏览器扩展形态、C9 阅读状态字段、C10 CSL 样式引擎、C11 Signals | ① 路由表与 `research_cat` action 枚举清单（应为第 6.1/6.2 节的冻结集合）② `grep` 检索结果为空（`zotero`/`oauth`/`collaborator`/`public link`/`invite`/`login`/`crossref`/`semanticscholar`/`quartile`/`h-index`/`readingStatus`/`csl`/`signals`）③ 面板入口清单 |
| AC-C-2 | 第 8 节 C1–C11 每一项的前置条件非空且可执行（指向具体缺口，而非“以后再说”）；t2 设计文档明确引用第 8 节并声明不实现 | 文档 diff + t2 文档交叉引用 |

> 若用户在 t1 之后拍板纳入某项 C，AC-C-1 的对应子项即失效：必须先在变更记录登记，再为该功能新增 A/B 编号与 AC（见第 11 节），否则 t5 仍按“未实现”判 passed、按“私自实现”判 failed。

---

## 9. 清单外发现项（已核实但不在团队冻结清单内）

以下 RR 功能在核对来源时被确认存在，但不在团队给定的 17 项清单中；按第 7/8 节处置，避免评审时被当作“遗漏”。

| 发现项 | 来源 | 处置 |
|---|---|---|
| 阅读状态 / Reading Lists | S24 | C9（待决策） |
| Autosave | S10 | X6（排除） |
| Multiple Projects | S6 | X5（排除；如需转 C） |
| RIS / CSV 导出 | S11 | C1 的导出部分（本轮只做 BibTeX，A7） |
| 公开链接 / 协作者（Editor-Viewer） | S11 | C3（待决策） |
| 复制引文样式 | S11 | C10（待决策） |
| Signals 风险指标 | S25 | C11（待决策） |
| 引用地图图片导出 | S22 | X7（排除） |
| 迭代“hops”导航历史（可回退到上一步搜索） | S18,S19 | **本轮不设独立 AC**：A2 的多次 `expandAll` + 图快照已覆盖“迭代”的可验证部分；hops 式导航属 UI 增强，若用户要求转 C |

---

## 10. 验收执行方式（t5 的证据规范）

1. **自动化优先**：每条 AC 尽量落到 `test/local.mjs` 的一个 `check()`（标签中含 AC 编号，如 `check('AC-A3-1 …')`），使 `node test/local.mjs` 的输出可直接映射 AC。
2. **route probe**：需要真实 HTTP 的 AC，用脚本对 `127.0.0.1` 上的 DSH webServer 发 `POST`（`application/json`，带 `Origin: http://127.0.0.1:<port>`），记录请求体与响应体。
3. **panel step**：无法自动化的 UI AC，必须写出“操作序列 → 期望观察 → 实际观察”，并附截图路径或文字证据；仅写“手动测试通过”不算证据。
4. **网络类 AC**（A2/A3/A5 的真实检索）：若 OpenAlex 不可达，必须标 `failed` 并附错误，**不得**标 passed；离线可验证的部分（分块、边界、幂等、筛选）必须用注入/桩数据在离线状态下验证。
5. **回归 AC**（A0）：必须附 `node test/local.mjs` 的完整输出与检查标签清单。
6. t5 的最终产物须是一张 AC → passed/failed → 证据 的对照表；任何 failed 必须给出最小复现步骤。

---

## 11. 变更控制

- 本文件冻结后，任何 AC 的新增/删除/措辞变更都必须：① 由 spec 记录变更原因；② 追加下表一行；③ 若影响 t3/t4 已开工内容，通知 captain 决定是否重排任务。
- 实现方**不得**通过修改本文件来“让验收通过”；评审发现此类改动按 blocker 处理。
- C 档转正（用户拍板）时：先在变更记录登记，再新增 A/B 编号与 AC，再交 t2。

### 变更记录

| 日期 | 变更 | 原因 | 影响 |
|---|---|---|---|
| 2026-09（t1 r1） | 初版冻结 | 完成 RR 功能清单 → 可验收 spec | 冻结 A0–A7、B1–B4、X1–X7、C1–C11 |
| 2026-09（t8，勘误） | AC-C-1 的 grep 词表：移除 `share`，替换为更精确的 `public link` 与 `invite` | `share` 是普通英文词，会命中**非 C 档文本**（假阳性）：`src/client.js` 的布局数学里有 `share = citedBy / top` 变量、注释里有 “year share the same x”；旧版 `src/tools.js` 的说明句也含 “share one library”。用它判“是否私自实现了 C3 分享功能”会把布局代码判成违规。C3 的真实特征是**公开链接**与**邀请协作者**，故用 `public link` / `invite` 替代（`collaborator` 原样保留）。判定范围同时明确为 host 侧 7 个文件（`graph.js`/`routes.js`/`tools.js`/`store.js`/`bibtex.js`/`config.js`/`index.js`），client 侧入口由面板入口清单与 t4/t7 证据覆盖 | AC-C-1 的词表更精确；**AC 编号与判定强度不变**，只是去掉假阳性来源。实现方与验证方都应使用新词表重跑 grep |

---

## 附录 A · RR 功能清单 → 档位映射（一页速查）

| RR 编号 | 功能（团队清单原文） | 来源 | 档位 | 对应编号 |
|---|---|---|---|---|
| RR-01 | 种子检索(≤50) | S3,S5 | 本轮做 | A2, A5 |
| RR-02 | Citations/References/Similar/作者四条探索轴 | S5,S16,S17,S8 | 本轮做 | A0, A1 |
| RR-03 | Earlier/Later Work 时间轴 | S13,S14 | 本轮做 | A3 |
| RR-04 | 引用图 | S5,S20,S22 | 本轮做 | A0, A6 |
| RR-05 | 多层 Collections/Subcollections | S5,S10 | 本轮做 | B2 |
| RR-06 | Recently Found 暂存区 | S10,S20 | 本轮做 | B3 |
| RR-07 | Zotero 导入 | S5,S12 | 待用户决策 | C2（本轮按 AC-C-1/AC-C-2 判定“未实现”） |
| RR-08 | BibTeX 导入导出 | S5,S11,S12 | 本轮做（仅导出）/ 待决策（导入） | A7 / C1 |
| RR-09 | 笔记/贴纸/颜色 | S5,S19,S21,S22 | 本轮做 | B4 |
| RR-10 | 分享与协作 | S5,S10,S11 | 待用户决策 | C3（本轮按 AC-C-1/AC-C-2 判定“未实现”） |
| RR-11 | 账号云端库 | S3,S19 | 待用户决策 | C4（本轮按 AC-C-1/AC-C-2 判定“未实现”） |
| RR-12 | 3 个数据源 | S9 | 待用户决策 | C5（本轮按 AC-C-1/AC-C-2 判定“未实现”） |
| RR-13 | 学习型推荐 | S1,S2,S8 | 待用户决策 | C6（本轮按 AC-C-1/AC-C-2 判定“未实现”） |
| RR-14 | RR+ 高级检索 | S6,S7 | 待用户决策（基础筛选本轮做） | C7 / A4 |
| RR-15 | 时间线视图 | S20,S22 | 本轮做 | A6 |
| RR-16 | 筛选 | S7,S17,S22 | 本轮做 | A4 |
| RR-17 | 移动端/插件 | S23（仅第三方连接器） | 待用户决策 | C8（本轮按 AC-C-1/AC-C-2 判定“未实现”） |
| — | 持久化库（团队补充 B 档） | S10,S19 | 本轮做 | B1 |
