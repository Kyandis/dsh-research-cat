# Research Cat × Research Rabbit 复刻 · 实现设计（t2）

- **输入**：`docs/rr-parity-spec.md`（t1 冻结版，本轮唯一判据）
- **基线**：仓库 HEAD `9a1bd7d`（本设计中的行号锚点均指该提交）
- **范围**：只产出设计，不改 `src/`、`test/`；不含实现代码
- **硬约束（不得突破）**
  1. host 是**普通 ESM**、**无构建步骤**、只依赖 `@deepseek-ai/dsh-tools`（外加 Node 内建模块）
  2. client 是**单文件**，走 `window.__ModuleLoader__.load` 契约，只能 `require('react')`，**无 JSX、无打包**
  3. 现有 4 个 agent action（`search`/`add`/`expand`/`list`）与既有路由信封不得破坏（spec AC-A0-2/3/4）
  4. 新增依赖、构建步骤、原生模块 = 必须单独立项并标为“待用户决策”

---

## 0. 设计结论速览

| 议题 | 决策 | 理由 |
|---|---|---|
| 持久化介质 | **单文件 JSON**（`${DSH_HOME:-$HOME/.dsh}/research-cat/library.json`），原子写 + 去抖 | 无依赖、可 diff、可手工备份；体量上限可控（见 2.8） |
| DSH storage 服务 | **不用**（实测未发现可用服务，见 2.1.1） | 唯一命中是 DSH 内部路径常量，非插件 API；引入未证实服务会牺牲零依赖可移植性 |
| SQLite | **不用**（含 `node:sqlite`） | 需新依赖/原生模块或依赖 Node 版本实验特性 → 违反硬约束 1；收益（万级以上条目查询）在本轮上限内不成立 |
| 库与图的关系 | **库持久 / 图临时**：`library` 落盘，`graph`（nodes+links）只在内存 | 保留既有语义“重启后库还在、图是空的”，同时让 collection 能显示标题 |
| collection 模型 | 邻接表 `collections[] + memberships[]`，多归属，层级任意深 | 复制入集天然支持；树只是视图，不是存储 |
| 旧 `seeds` 迁移 | 迁移为**系统集合** `id:"seeds"`（不可删、不可改父） | `graph.seeds` 语义可继续派生，旧测试与 `list` action 不破 |
| Recently Found | = 进过图的 id **减去**“已属于任一用户 collection 的 id”；系统集合 `seeds` 不参与减法 | 同时满足 spec AC-B3-2（addSeed 后仍在暂存区）与 AC-B3-4（存入 collection 后移出） |
| 新查询 | 全部走 OpenAlex 现有 filter/select 能力，**统一后置筛选**兜底 | 语义一致、可离线判定（AC-A4-8） |
| 并发/配额 | 并发 ≤4、每请求带 `mailto`、单轴单次 top-N、`truncated` 如实上报 | spec A2-4 / A5 / A4-6 |
| client 改造 | 复用 `ResearchCatPanel`，新增 5 个同文件组件与 1 个时间线布局纯函数 | 不引入打包、不改 Loader 契约 |
| 多 DSH 实例共享同一 storePath | **已知限制**，last-writer-wins，不引入锁文件 | spec B1 未要求；加锁属额外复杂度，登记为风险 |

---

## 1. 架构总览

| 层 | 载体 | 职责 | 本轮变化 |
|---|---|---|---|
| 引擎 | `src/graph.js`（ESM，Node 内建 fetch） | OpenAlex 查询、图（nodes/links）、库（collections/annotations/recentlyFound/records）、筛选、导出 | 大幅扩展；拆出 store 模块 |
| 持久化 | **新增** `src/store.js`（ESM，`node:fs/promises` + `node:path` + `node:os`） | 读/写/校验/降级/原子写 | 新增文件（t3 落地） |
| 导出 | **新增** `src/bibtex.js`（纯函数，无 IO） | 记录 → BibTeX 文本 | 新增文件（t3 落地） |
| 路由 | `src/routes.js` | HTTP 适配层，只做参数校验 + 信封 | 新增 5 条路由 |
| 工具 | `src/tools.js` | agent 文本视图 | 新增 4 个 action |
| 配置 | `src/config.js` | 默认值与覆盖 | 新增 5 个键 |
| 面板 | `src/client.js` | 单文件 React（createElement）UI | 见第 7 节 |

数据流（单向）：

`OpenAlex → 引擎 records/nodes/links →（写）store 落盘`；`面板 → post(route) → 引擎 →（读）envelope.value → 面板 state`。
面板**不直接读盘**，也不缓存库状态为唯一真源：库状态真源在引擎（进程内）+ 磁盘文件，面板每次写操作后用响应里的 `library` 覆盖本地副本。

---

## 2. 持久化层设计

### 2.1 落盘位置（不硬编码 home）

**默认路径模板**：`${DSH_HOME:-$HOME/.dsh}/research-cat/library.json`

解析规则（**必须按此顺序，不得硬编码 `~/.dsh`**）：

1. `config.storePath` 显式配置 → 直接使用（相对路径按 `${DSH_HOME:-$HOME/.dsh}` 解析）；
2. 否则 `process.env.DSH_HOME` 非空 → `${DSH_HOME}/research-cat/library.json`；
3. 否则 `os.homedir() + '/.dsh/research-cat/library.json'`。

**证据**：
- DSH 会把 home 注入宿主进程环境：bundle 内 `serializeHostEnvironment(snapshot, [...Object.keys(process.env), "DSH_HOME"])` 与 `environment.DSH_HOME = options.homeDir`（`/Applications/DSH Desktop Beta.app/Contents/Resources/app/lib/main.js`）。自定义 `DSH_HOME` 的部署因此自动写到正确位置。
- 本机 `DSH_HOME` 未显式设置时落点 = `~/.dsh/research-cat/library.json`，与 spec AC-B1 的示例路径一致（spec 允许 t2 记载实际路径），**不需要 spec 变更**。

**为什么不放 `~/.dsh/storages/`**：该目录是 DSH 内部命名空间（实测 `storages/session_projcache.json`、`storages/cost-meter/ledger.json`、`storages/workspace.json`），由 DSH 自己管理生命周期与格式；插件写入有被 DSH 升级/清理影响的风险。放**同级**独立目录 `research-cat/` 隔离更安全。

**为什么不放仓库内**：仓库是 git 工作区，数据会污染 `git status`，且插件可能以只读方式安装（`link:` 安装、市场安装）。

**备选（不采用，登记）**：profile 数据目录（`~/.dsh/profiles/<profile>/`）。理由：profile 目录归插件管理器所有，`pnpm` 操作可能重建；且同一用户切换 profile 会“丢库”，与 B1 的“重启存活”验收口径容易产生歧义。

### 2.1.1 fs 还是 DSH storage 服务（实测结论：用 fs）

**结论：默认使用普通 `node:fs`，零依赖。** 依据：

1. **实测检索**：在 DSH 桌面 bundle（`.../Resources/app/lib/main.js` 等）中搜索面向插件的 storage 服务注册（`provide('storage*')`、`'storage-*'` 服务名、`ctx.storage`）**未发现任何可用服务**；`grep -oE "'[a-z-]*storage[a-z-]*'"` 无命中，唯一命中是内部路径常量 `const SESSION_PROJCACHE_RELATIVE_PATH = ["storages", "session_projcache.json"]`（`join(homeDir, ...SESSION_PROJCACHE_RELATIVE_PATH)`），即 DSH 自用，不是插件 API。
2. **零依赖是可移植性来源**：本插件目前只依赖 `@deepseek-ai/dsh-tools` + Node 内建；引入未经证实的服务会把可移植性押在未文档化的内部接口上。
3. **AC 等价性规则**：若将来**实测证明**存在可用的 storage 服务（需给出服务名 + 调用证据），方可替换存储介质；届时 spec AC-B1-2（原子性）、AC-B1-3（版本）、AC-B1-4（损坏降级）必须各有等价断言，否则不得替换。本轮不触发该分支。

### 2.2 文件格式取舍：JSON vs SQLite

| 方案 | 依赖/构建 | 事务与并发 | 查询能力 | 体积（本轮上限） | 结论 |
|---|---|---|---|---|---|
| 单文件 JSON | 零（Node 内建 `fs`） | 原子 rename 即可；单进程 | 全量载入内存，O(n) 过滤足够 | 见 2.8，约 0.3–6 MB | **采用** |
| `better-sqlite3` | 原生模块 + 编译/预编译产物 | 强 | 强 | 小 | 否：违反硬约束 1（原生依赖、平台矩阵、无构建步骤） |
| `node:sqlite` | 零依赖但需 Node ≥22.5 且为实验 API | 中 | 强 | 小 | 否：DSH 桌面内置 Node 版本不可假设；实验 API 可能在升级后变更 |
| 多文件（每 collection 一文件） | 零 | 弱（跨文件一致性） | 中 | 碎片多 | 否：多归属与 Recently Found 需要跨文件一致性，复杂度反升 |

**决策**：JSON；若未来条目规模突破 2 万或需要全文检索，再按“新增依赖 → 待用户决策”流程重新评估（第 9 节 R1）。

### 2.3 文件结构（v1 schema）

| 字段 | 类型 | 语义 | spec 依据 |
|---|---|---|---|
| `version` | number | schema 版本，本轮 `1` | AC-B1-3 |
| `savedAt` | ISO string | 最近一次成功写盘时间 | 诊断 |
| `records` | `{ [workId]: Record }` | 论文元数据缓存（`id,title,year,citedBy,doi,venue,kind,openAccess,retracted,authorIds`）；重启后用于渲染 collection 条目 | AC-B1-1、AC-B2-4 |
| `collections` | `[{id,name,parentId,createdAt,order,system?}]` | 集合邻接表；`parentId:null` 为顶层 | AC-B2-1/2 |
| `memberships` | `[{collectionId,workId,addedAt}]` | 多归属；主键 `collectionId + '|' + workId` | AC-B2-6 |
| `recentlyFound` | `[{workId,at}]` | MRU 列表，上限 500 | AC-B3-6 |
| `annotations` | `{ [workId]: {note,tags,color,updatedAt} }` | 笔记/标签/颜色 | AC-B4-1..5 |
| `seq` | number | 集合 id 序号（`c1`、`c2`…） | 稳定 id |
| `meta` | `{lastError?, writes}` | 可选诊断（不进 AC） | — |

不变量：
1. 每个 `memberships[].workId` 与每个 `recentlyFound[].workId`、`annotations` 键**必须**在 `records` 中有记录（写入时同步补 `records`）。
2. `collections` 中 `parentId` 必须指向存在的集合，且不存在环。
3. `id:"seeds"` 的系统集合恒存在（`system:true`，`parentId:null`）。
4. `recentlyFound` 去重；`memberships` 去重。

### 2.4 写入策略

| 议题 | 设计 |
|---|---|
| 触发 | 任何库写操作（addSeed/removeSeed/collection op/recentlyFound op/annotate/clear）后标记 dirty |
| 去抖 | 300 ms 去抖 + **最大等待 2 s**（持续写不会饿死落盘）；`clear` 与 `storePath` 变更立即写 |
| 序列化 | 单条 promise 链串行写；后到的写请求合并为“最新快照”一次写（不排队 N 次） |
| 原子性 | 写 `library.json.tmp-<pid>-<rand>` → `fsync` → `rename` 覆盖目标 →（可选）`fsync` 目录；失败则删临时文件并保留原文件 |
| 崩溃安全 | 任意时刻磁盘上要么是完整旧版本、要么是完整新版本（AC-B1-2） |
| 退出前 flush | `ctx.effect` 的 disposer 里 `await flush()`；另在 `apply()` 里注册 `process.once('beforeExit')` 兜底（只做同步尽力写，避免阻塞退出） |
| 写失败 | 不抛到 HTTP 层：记 `storeError`，后续 `/state` 携带可读消息；内存态继续可用（AC-B1-8 同族） |
| 阻塞预算 | 单次写 ≤200 ms（AC-B1-5 的本地实测口径）；写不在 HTTP 请求路径上（请求只改内存 + 标 dirty） |

### 2.5 读取、损坏与版本策略

| 场景 | 行为 |
|---|---|
| 文件不存在 | 视为全新库：写入默认结构（含系统集合 `seeds`），`storeError:null` |
| JSON 解析失败 / 截断 | 保留原文件为 `library.bak-<ISO>`，以空库启动，`storeError` 写明路径与原因（AC-B1-4） |
| `version` 高于当前 | 同上（`.bak` + 空库 + `storeError`），**不尝试猜测性解析**（AC-B1-3） |
| `version` 低于当前 | 走迁移函数（本轮只有 v1，迁移框架预留 `migrations` 表） |
| 结构校验失败（不变量 1–4 被破坏） | 尽力修复：丢弃悬空 membership/annotation/recentlyFound、补系统集合、断环（把环中节点 `parentId` 置 `null`）；修复数量记入 `storeError`；修复后立即落盘 |
| `storePath` 不可写 | 降级为纯内存库 + `storeError`，插件加载**不失败**（AC-B1-8） |

### 2.6 与现有内存图的关系（“重启后库还在、图是空的”）

现有语义（`README.md:79-84`）：图与 collection 都是内存态、重启清空。本轮把它拆成两层：

| 状态 | 归属 | 重启后 | 说明 |
|---|---|---|---|
| `records` / `collections` / `memberships` / `recentlyFound` / `annotations` | **库（持久）** | 保留 | 面板 Library 页可立即列出条目（标题/年份/被引来自 `records`，不需要联网） |
| `nodes` / `links`（探索图） | **图（临时）** | 清空 | 面板 Graph 页启动为空，提示“库已恢复，点 Expand 重新构图” |
| `seeds`（系统集合成员） | 库 | 保留 | `graph.seeds` 由 `memberships(system seeds)` 派生 → 旧 `list` action 与既有测试语义不变 |

**用户可见行为（写进 README 与面板提示）**：
1. 重启后侧栏能看到所有 collection 与其条目；
2. 图是空的，展开任意条目即可重建邻域；
3. 这不是数据丢失——`records` 让条目可离线显示，只是**引用边**不落盘（边可由 OpenAlex 随时重算，落盘会带来陈旧边与体量问题）。

### 2.7 并发与多实例（已知限制）

- 单进程内：所有写经同一条 promise 链，无竞态。
- 两个 DSH 实例（或两个窗口共享同一 `storePath`）：last-writer-wins，可能互相覆盖。**本轮不加锁**（spec 未要求）；登记为风险 R2，缓解手段（若用户要求）：启动时获取 `library.lock`（`wx` 打开 + mtime 心跳 + 30 s 过期视为陈旧锁），或改为按 collection 分文件。

### 2.8 体量估算与上限

- `Record` 约 220–300 B（JSON）；`membership` 约 60 B；`annotation` 约 120 B + 笔记正文。
- 上限保护（写进引擎常量）：`records` 20000、`memberships` 40000、`annotations` 20000、`recentlyFound` 500。
- 最坏约 `20000×300 + 40000×60 + 20000×(120+note)` ≈ 6 MB + 笔记；单文件 JSON 读写耗时 <100 ms（本机 SSD 量级），可接受。
- 超限策略：拒绝新增（返回 `invalid` + 可读消息），不静默淘汰 `records`（避免 collection 条目突然消失）。

---

## 3. 多 collection 数据模型

### 3.1 实体与不变量

见 2.3。补充语义：

| 操作 | 语义 | spec 依据 |
|---|---|---|
| `create` | 生成 `c<seq>`；`parentId` 缺省为 `null`；父必须存在 | AC-B2-2 |
| `rename` | 只改 `name`；允许重名；id 不变 | AC-B2-3 |
| `delete` | **级联删除子树**：删除该集合及其所有后代集合，以及它们全部 memberships；**不动** `records`/`annotations`/`recentlyFound` | AC-B2-4/5（选定级联） |
| `save` | 复制入集：为每个 `workId` 增加 membership（已存在则跳过，计入 `skipped`）；**不移动** | AC-B2-6/7 |
| `remove` | 只删该集合下的 membership；若该 id 因此不再属于任何**用户**集合，则回到 Recently Found | AC-B2-6、AC-B3-4 |
| `itemCount` | **直接成员数**；另返回 `itemCountDeep`（子树去重后成员数） | AC-B2-8（口径固定） |

### 3.2 系统集合 `seeds` 与旧语义迁移

- `id:"seeds"`、`name:"Collection"`、`system:true`、`parentId:null`。
- `addSeed(id)` = `records.upsert(id)` + `save(seeds, [id])` + 进 Recently Found；`graph.seeds` = `memberships(seeds)` 的插入序（新在前，沿用现状 `seeds.unshift` 的方向）。
- `removeSeed(id)` = `remove(seeds,[id])` + 删节点 + 删与该节点相关的边（保留 `pruneOrphans`）。
- 系统集合**可改名**（无害）但**不可删除、不可改父**：`delete`/`create(parentId:"seeds")` 之外的父子操作对它是 `invalid`。
- 旧代码路径（`graph.seeds` 数组）改为派生 getter，`/state` 与工具输出形状不变 → AC-A0-3/4 兼容。
- 迁移：首次写入即生成 `seeds`；不存在的旧数据（无文件）从零开始。

### 3.3 Recently Found 语义（冻结）

定义（与 spec AC-B3 完全一致，并把与系统集合的边界写死）：

`recentlyFound` = `records` 中所有“曾进入过图”的 id，**减去** 属于任一**用户集合**（`system!==true`）的 id；按 `at` 降序；上限 500，超限淘汰最旧。

| 触发 | 结果 | spec |
|---|---|---|
| `search`（仅搜索不建图） | **不**进暂存区（搜索结果是候选，不是“探索过”） | 与 AC-B3-1 一致（进图才进） |
| `addSeed` | 进暂存区首位，且因系统集合不算“用户集合”而**留在**暂存区 | AC-B3-2 |
| `expand` / `expandAll` / 作者轴 / earlier·later 新进图节点 | 进暂存区 | AC-B3-3 |
| `save` 到用户集合 | 从暂存区移除 | AC-B3-4 |
| 从用户集合 `remove` 且不再属于任何用户集合 | 回到暂存区（`at` 刷新为当前时间） | AC-B3-4（选定规则） |
| `recentlyFound op:"clear"` | 清空列表；`records`/collections/memberships 不变 | AC-B3-5 |
| `recentlyFound op:"promote"` | 批量存入目标集合（等价 `save`），随即移出暂存区 | AC-B3-9 |

### 3.4 注解模型

`annotations[workId] = {note, tags, color, updatedAt}`；`note ≤ 10000` 字符、`tags ≤ 20 × 40` 字符、`color ∈ {red,orange,yellow,green,blue,purple,gray} | null`。部分更新语义：未出现的键保持原值，显式 `null` 表示清除（`note:""` 等价清空）。仅对 `records` 中存在的 id 生效。注解**不进入** BibTeX 导出（AC-B4-9）。

### 3.5 删除/移动/复制语义汇总（一张表定死）

| 动作 | 集合 | 成员 | records | 注解 | 暂存区 |
|---|---|---|---|---|---|
| 删集合（含后代） | 删除 | 删除 | 保留 | 保留 | 受影响 id 可能回归 |
| 删单条（`remove`） | 保留 | 删除该条 | 保留 | 保留 | 若不再属用户集合则回归 |
| 复制入集（`save`） | 保留 | 新增 | 补/保留 | 保留 | 移出 |
| `clear scope:"graph"` | 保留 | 保留 | 保留 | 保留 | 保留 |
| `clear scope:"library"` | 重置为仅 `seeds` | 清空 | 清空 | 清空 | 清空 |

---

## 4. OpenAlex 查询接口设计

### 4.1 公共要素

| 要素 | 设计 |
|---|---|
| 基址 | `https://api.openalex.org`（不变） |
| polite pool | 每个请求追加 `mailto=<config.mailto>`（AC-A5-7） |
| select 集 | `RECORD_SELECT_EXT = id,doi,title,display_name,publication_year,cited_by_count,type,primary_location,open_access,is_retracted`；作者 id 只在 `details`/`authors` 路径使用 `DETAIL_SELECT`（已含 `authorships`） |
| 归一化 | 沿用 `recordOf`，新增 `openAccess`（`work.open_access.is_oa === true`）、`retracted`（`work.is_retracted === true`）、`authorIds`（`authorships[].author.id` 去前缀；仅详情路径填充，列表路径为 `[]`） |
| 缓存 | URL→JSON 的 Map，`CACHE_LIMIT` 400→1000，超限整体清空（沿用现有策略）；同一 URL 的并发请求共享同一 promise（in-flight 去重） |
| 并发 | 全局信号量 `concurrency=4`（AC-A2-4） |
| 超时 | 单请求 8 s（`AbortSignal.timeout`），超时映射为 `operation` 错误并附 URL 摘要 |
| 重试 | 仅对 429 / 5xx / 网络错误重试 1 次，退避 500 ms，尊重 `Retry-After` |
| 错误映射 | 404 → `invalid`（“OpenAlex 没有该 work/author”）；400 → `invalid`（参数）；403/429/5xx/网络/超时 → `operation`；JSON 截断 → `operation`（沿用现有文案风格） |
| 分块 | `openalex_id` OR 过滤单次 **≤50** 个 id → `chunkIds(ids, 50)` 后再请求（AC-A5-3） |

### 4.2 搜索

| 项 | 内容 |
|---|---|
| 签名 | `GET /works?search=<term>&filter=<pushedDown>&select=<RECORD_SELECT_EXT>&sort=<sort>&per-page=<searchPerPage≤50>&page=<n>` |
| DOI 短路 | 沿用：查询串含 DOI 时先 `GET /works?filter=doi:<doi>&per-page=1` |
| 筛选下推 | `yearFrom/yearTo → from_publication_date/to_publication_date`（`<y>-01-01` / `<y>-12-31`）、`isOa → is_oa:true`、`isRetracted → is_retracted:true`、`minCitations → cited_by_count:>N-1`；`venue` **不下推**（统一后置） |
| 后置 | 对返回集统一跑 4.7 的筛选器（含 `venue`），保证语义一致 |
| 排序 | `sort:"cited" → cited_by_count:desc`；`sort:"year" → publication_year:desc` |
| 分页 | `page` 默认 1；响应新增 `page`、`total`（取 `meta.count`）、`hasMore`（`page*perPage < total`） |
| 失败 | 空结果 → `ok:true, results:[]`；`page<1` 或非整数 → `invalid` |

### 4.3 作者轴

| 项 | 内容 |
|---|---|
| 列作者 | `GET /works/<id>?select=id,authorships` → `{authors:[{id:"A…",name}]}`（顺序同 `authorships`） |
| 作者作品 | `GET /works?filter=author.id:<Aid>[,<pushedDown>]&sort=cited_by_count:desc&select=<RECORD_SELECT_EXT>&per-page=<maxBatch≤100>` |
| 边 | `putLink(源 workId, 作者作品 workId, "author")`：**source 必须是传入的 work id**（AC-A1-2）；本轮**不创建作者节点**（不在 spec 内） |
| 排序 | 服务端 `cited_by_count:desc`；后置稳定化：`citedBy` 降序、并列按 `year` 降序、再并列按 id 升序（AC-A1-3） |
| 缺参 | `kind:"author"` 且无 `authorId` → `invalid`，消息含该论文可用作者 id 列表（AC-A1-4） |
| 失败 | 未知 `authorId`（404 或空结果）→ `ok:true, found:0` + 可读提示；非法 id 格式 → `invalid` |

### 4.4 Earlier / Later（时间轴）

| 项 | 内容 |
|---|---|
| Earlier | ① `GET /works/<id>?select=referenced_works` ② `chunkIds(refs, 50)` 批量取元数据（≤`maxBatch` 个 id）③ 后置 `year < seed.year && year > 0` ④ `putLink(id, target, "earlier")` |
| Later | ① `GET /works?filter=cites:<id>&sort=cited_by_count:desc&per-page=<maxCitations≤100>` ② 后置 `year > seed.year && year > 0` ③ `putLink(id, target, "later")` |
| 时间比较口径 | 一律用 `publication_year`（整数），**严格不等**；`year===0` 两边都不计入（AC-A3-3） |
| 是否下推日期 | **不下推** `from_publication_date`：OpenAlex 中部分 work 的 `publication_date` 为空，下推会静默丢条目，破坏“确定性后置筛选”口径（AC-A4-8） |
| 截断语义 | `references` 只取前 `maxBatch` 个 id → `earlier` 可能在长参考列表上欠采样；响应带 `truncated:true` 与 `considered`（实际取到的参考数），面板提示“仅基于前 100 条参考”（AC-A3 家族；spec 未要求全量） |
| 多 seed | `expandAll` 中逐 seed 用**该 seed 自己的年份**做阈值（AC-A3-4） |
| 失败 | 无 references（`referenced_works` 空）→ `found:0`；全部同年/缺年份 → `found:0` + `note:"no earlier/later work at this time boundary"` |

### 4.5 References / Related / Citations（既有轴 + 配额）

| 轴 | 签名 | 配额 | 备注 |
|---|---|---|---|
| references | `GET /works/<id>?select=referenced_works` → `chunkIds(≤50)` → `GET /works?filter=openalex_id:<chunk>&select=…&per-page=50` | 取前 `maxBatch=100` 个 id → 2 次分块请求 | 顺序由 OpenAlex 给定；展示前按 `sort` 后置排序 |
| related | 同上，源字段 `related_works` | `maxBatch=100` | OpenAlex 对部分论文返回空（沿用“如实显示”） |
| citations | `GET /works?filter=cites:<id>[,pushedDown]&sort=cited_by_count:desc&per-page=<maxCitations=100>` | 100 | 后置筛选兜底 |
| 幂等 | `putLink` 复合键天然幂等；`added` 只计新节点 | — | AC-A2-5 |

### 4.6 多 seed 合并（`expandAll`）

伪签名（设计级，不是代码）：`expandAll({kinds=["references","related"], filters}) → {added, skipped, perSeed:[{id,kind,found,added,error?}], truncated, warning, graph, counts}`

| 规则 | 设计 | spec |
|---|---|---|
| 种子范围 | 系统集合 `seeds` 全部成员，上限 `maxSeeds=50` | AC-A2-1/2 |
| 遍历顺序 | 种子插入序（新→旧） × `kinds` 传入序 | 确定性 |
| 合并 | 按 `workId` 去重；`added` 只计首次入图的节点；已存在的边幂等跳过 | AC-A2-5 |
| 展示排序 | 合并完成后对**本次新增**节点按 `citedBy desc, year desc, id asc` 排序，仅影响面板列表顺序（图布局由布局函数决定） | 确定性 |
| 失败隔离 | 每个 `(seed,kind)` 独立 try/catch，失败写 `perSeed[].error`，整体仍 `ok:true` | AC-A2-3 |
| 上限保护 | 循环内每步检查 `nodes.size >= maxNodes`，达上限则停止并在 `skipped`/`warning` 说明（不抛异常、不半写） | AC-A2-6 |
| 并发 | 4.1 的全局信号量（≤4） | AC-A2-4 |
| 结果为空 | 全部 seed 都无新增 → `added:0` + `warning`（沿用现状文案风格） | AC-A0 家族 |

### 4.7 筛选器求值（统一后置，确定）

| 键 | 下推 | 后置判定（权威） | 缺数据时 |
|---|---|---|---|
| `yearFrom`/`yearTo` | 是（搜索/引用/作者轴） | `year >= yearFrom && year <= yearTo` | `year===0` → 任一侧有界即不通过 |
| `venue` | 否 | `venue` 非 null 且小写后包含小写 `venue` 子串 | `venue===null` → 不通过 |
| `isOa` | 是 | `openAccess === isOa` | 缺字段视为 `false` |
| `isRetracted` | 是 | `retracted === isRetracted` | 缺字段视为 `false` |
| `minCitations` | 是 | `citedBy >= minCitations` | `0` 通过 |
| `sort` | 是（服务端排序） | 结果序列单调性校验（测试用） | — |

校验：未知键、非布尔、负数、`yearFrom > yearTo`、非法 `sort` → `invalid`（AC-A4-7）。`venue:""` 视为未提供（AC-A4-3）。筛选后 `found` 必须是筛选后的实际条数（AC-A4-6），并额外返回 `considered`（筛选前条数）供面板显示“筛选前/后”。

### 4.8 失败路径总表

| 触发 | 返回 | 面板表现 |
|---|---|---|
| 未知 work/author（404 或空） | `invalid` / `ok:true,found:0`（按语义） | 行内提示，不弹错误 |
| 参数缺失/类型错/非法枚举 | `invalid` + 字段名 | 行内提示 |
| 429 限流 | 1 次重试后 `operation` + “稍后再试” | 错误条 |
| 5xx / 网络不可达 / 超时 8 s | `operation` + URL 摘要 | 错误条（保留现有“OpenAlex is unreachable”风格） |
| JSON 截断 | `operation` | 错误条 |
| 图达上限 | `operation`（“先 Clear”） | 错误条 |
| 库达上限 | `invalid` | 错误条 |
| 库文件损坏/不可写 | 请求成功 + `library.storeError` | 顶部持久化警告条 |

### 4.9 配额与截断语义

- 单轴单次 top-N：`references/related/earlier/author ≤ maxBatch(100)`，`citations/later ≤ maxCitations(100)`。
- `truncated:true` 表示“底层还有更多但按配额截断”，与 `found`（本次实际返回）区分；面板文案：“显示前 100 / 共 N 条（按被引排序）”。
- 搜索 `total/hasMore` 支持翻页；展开轴**不做**翻页（spec 未要求，避免配额与图上限冲突）。

---

## 5. 路由表增量与向后兼容

新增 5 条（全部 `POST`、`application/json`、loopback 围栏、`{ok,value|error}` 信封不变）：

| 路由 | 请求体 | `value` | spec |
|---|---|---|---|
| `/dsh-research-cat/authors` | `{id}` | `{authors:[{id,name}]}` | AC-A1-1 |
| `/dsh-research-cat/collections` | `{op:"list"｜"create"｜"rename"｜"delete"｜"save"｜"remove", id?, name?, parentId?, collectionId?, ids?}` | `{collections:[…], collection?}` | AC-B2-1..8 |
| `/dsh-research-cat/recentlyFound` | `{op:"list"｜"clear"｜"promote", ids?, collectionId?}` | `{recentlyFound:[…], promoted?}` | AC-B3-1..6 |
| `/dsh-research-cat/annotate` | `{id, note?, tags?, color?}` | `{annotation:{id,note,tags,color,updatedAt}}` | AC-B4-1..6 |
| `/dsh-research-cat/export` | `{format:"bibtex", ids?, collectionId?}` | `{format, count, bibtex}` | AC-A7-1 |

既有路由的**增量**（不改形状）：

| 路由 | 变化 | 兼容性 |
|---|---|---|
| `/state` | `value` 新增 `library`（collections/recentlyFound/annotations/storePath/storeError）；`graph`/`counts` 键集合只增不改 | AC-A0-4 |
| `/search` | 新增可选 `filters`、`page`；`value` 新增 `filters`/`page`/`total`/`hasMore` | 旧调用（只有 `query`）行为不变 |
| `/expand` | `kind` 扩展为 6 值（含 `earlier`/`later`/`author`）；新增可选 `authorId`、`filters`；`value` 新增 `truncated`/`considered` | 旧 3 值行为不变；`kind` 缺省仍 `related` |
| `/expandAll` | 新增可选 `kinds`、`filters`；`value` 新增 `perSeed`/`skipped`/`truncated`；`warning` 保留 | 旧调用（空体）行为不变 |
| `/addSeed` `/removeSeed` `/details` | 无形状变化（`addSeed` 额外影响暂存区） | 不变 |
| `/clear` | 新增可选 `scope`（缺省 `graph`，即旧语义） | 旧调用语义不变 |
| `GET /dsh-research-cat`（探针） | 不变 | 不变 |
| 未知路径 | 仍 404 | 不变 |

错误码：保留 `invalid`/`operation`/`forbidden`，新增 `notfound` 仅用于资源不存在时的显式场景（默认仍走 404）。

---

## 6. `research_cat` 工具 action 增量与兼容

| action | 状态 | 参数 | 输出（文本） |
|---|---|---|---|
| `search` | **不变**（新增可选 `filters`） | `query, filters?` | 与现状同格式；带筛选时追加“筛选前/后条数” |
| `add` | **不变** | `id` | 与现状同文案 |
| `expand` | **扩展**（3→6 kind，新增 `authorId`/`filters`） | `id, kind, authorId?, filters?` | 与现状同句式；`earlier`/`later` 追加时间边界说明；`author` 追加作者名 |
| `list` | **不变**（数据源改为库派生的 seeds） | — | 与现状同格式 |
| `collections` | 新增 | `op, id?, name?, parentId?, collectionId?, ids?` | 树形缩进 + `id`/`name`/直接条数/子树条数 |
| `recent` | 新增 | `op, ids?, collectionId?` | 条数 + 前 N 条 `title (year) -- id` |
| `annotate` | 新增 | `id, note?, tags?, color?` | 回显 note 摘要（前 120 字）、tags、color |
| `export` | 新增 | `format:"bibtex", ids?, collectionId?` | BibTeX 文本；超 8000 字符截断并注明“完整内容请用面板导出”（AC-A7-10） |

兼容性保证：
1. `parameters.action.enum` 只**增加**成员，`search`/`add`/`expand`/`list` 仍在其中；`kind` enum 只增加成员（AC-A0-3）。
2. `RESULT_SCHEMA`（`{ok,text}`）不变。
3. 旧调用方（只用 4 个 action、不传新参数）走默认分支，行为与 `9a1bd7d` 一致。

---

## 7. client 半边改造点（精确到函数/区块，锚点 = HEAD `9a1bd7d`）

> 全部改动都在 `src/client.js` 的 `factory` 闭包内；**不新增 `require`**（仍只有 `react`），**不引入 JSX/打包**。

### 7.1 常量区（行 30–46）

| 位置 | 改动 |
|---|---|
| `EMPTY_GRAPH`(31) | 不变（新增 `EMPTY_LIBRARY = {collections:[],recentlyFound:[],annotations:{},storePath:'',storeError:null}`） |
| `KIND_LABEL`(32) | 增加 `earlier:'Earlier work'`、`later:'Later work'`、`author:'By author'` |
| `ROLE_STROKE`(33-39) | 为 6 种边类型各给一个颜色 token（复用现有 `var(--dsw-alias-*)` 体系） |
| 新增 `EDGE_DASH` | 每类边的 `stroke-dasharray`，使 6 类边在图上可区分（AC-A0-5、AC-A6-6） |
| 新增 `COLOR_CHOICES` | 7 个固定色值（对应 `red/orange/yellow/green/blue/purple/gray`），用于颜色点与选择器（AC-B4-4/7） |
| `EXAMPLES`(41-46) | 不变 |

### 7.2 CSS 数组（行 48–120）

新增 class（追加到同一 `CSS` 数组，不拆文件）：`.rr-tabs`、`.rr-tab`、`.rr-tab-on`、`.rr-tree`、`.rr-tree-row`、`.rr-tree-caret`、`.rr-tree-count`、`.rr-recent`、`.rr-filter`、`.rr-filter-row`、`.rr-filter-input`、`.rr-note`、`.rr-note-input`、`.rr-tags`、`.rr-tag`、`.rr-color-row`、`.rr-color-dot`、`.rr-color-on`、`.rr-timeline-axis`、`.rr-tick`、`.rr-warnbar`（持久化警告条）、`.rr-export-row`。

### 7.3 布局纯函数（行 141–319）

| 位置 | 改动 |
|---|---|
| `radiusOf`(141-146) | 不变 |
| `computeLayout`(147-319) | **改名/保留为 `computeRadialLayout`**（逻辑不动，AC-A6-7 的基线一致性靠它） |
| `roleOf`(213-222) | 角色判定链扩展：references → citations → related → **earlier → later → author** → lonely |
| `ORDER`(223) | 扩为 `['references','citations','related','earlier','later','author','lonely']`（扇区顺序） |
| 新增 `computeTimelineLayout(nodeList, linkList)` | 纯函数：x = 按 `year` 升序映射到 `[pad, BOX_W-pad]`；y = 按 `citedBy` 映射（越大越靠上，写进注释与 AC 证据）；`year===0` 归入左侧 “year unknown” 带（等宽列）；返回与 radial 相同的 `place` 形状（`{id:{x,y}}`），使 `positionOf`/拖拽/缩放零改动 |

### 7.4 `ResearchCatPanel` state 与 effects（行 366–401）

| 位置 | 改动 |
|---|---|
| state 块(367-381) | 新增：`library`、`tab`（`'graph'｜'library'`）、`activeCollectionId`、`filters`、`layoutMode`（`'radial'｜'timeline'`）、`noteDraft`、`recentSelected` |
| `signature`(385-389) | 追加 `layoutMode`（否则切布局不重算） |
| layout effect(391-393) | 按 `layoutMode` 分派 `computeRadialLayout` / `computeTimelineLayout` |
| 初始 state effect(395-401) | 追加 `setLibrary(res.library)`；若 `res.library.storeError` 非空则设 `error`（顶部警告条） |

### 7.5 操作函数（行 403–489）

| 函数 | 改动 |
|---|---|
| `runSearch`(403-416) | 传 `filters`；结果区显示“筛选前/后条数”与 `total`；支持 `page`（“加载更多”） |
| `loadDetail`(418-427) | 不变 |
| `addPaper`(429-439) | 响应带 `library` 时同步 `setLibrary` |
| `dropSeed`(441-447) | 同上 |
| `expand`(449-458) | 传 `filters`；`KIND_LABEL` 已含新 kind；`truncated` 时追加提示 |
| 新增 `expandAuthor(id, authorId)` | 调 `/expand {kind:"author"}` |
| `expandAll`(460-470) | 展示 `perSeed` 失败条数与 `skipped` |
| `clearAll`(472-481) | 加 `scope` 选择（Graph / Library），Library 需二次确认 |
| `toggleKind`(483-489) | `showKinds` 初始集合扩为 6 类 |
| 新增库操作 | `loadLibrary()`、`createCollection(name,parentId)`、`renameCollection(id,name)`、`deleteCollection(id)`、`saveToCollection(collectionId,ids)`、`removeFromCollection(collectionId,ids)`、`promoteRecent(ids,collectionId)`、`clearRecent()`、`saveAnnotation(id,patch)`、`exportBibtex(scope)` |
| 新增 `setFilter(patch)` / `toggleLayout()` | 纯本地 state |

### 7.6 渲染区块（行 676–885）

| 区块 | 位置 | 改动 |
|---|---|---|
| `resultRows` | ~676-689 | 结果行增加“存入 collection”下拉（复用 `saveToCollection`） |
| `seedRows` | ~691-707 | 由 `graph.seeds` 改为“当前激活集合的条目”（系统集合时即原语义） |
| `detailBody` | ~710-756 | ① `rr-actions` 行(737-742) 扩展为 `References / Cited by / Similar / **Earlier** / **Later**`；② 作者名可点（`expandAuthor`）；③ 新增 `NoteEditor`（笔记文本域 + 标签输入 + 7 色点）；④ 显示所属 collection 与“存入”入口 |
| 根布局 | ~760-885 | ① `rr-side` 顶部加 `rr-tabs`（Graph / Library）；② Library 页渲染 `LibraryTree` + `RecentlyFoundList`；③ `rr-toolbar`(803-827) 增加布局切换、筛选入口、导出按钮；④ `rr-legend`(857-871) 扩到 6 类边 + 颜色标签说明；⑤ 顶部 `rr-warnbar` 显示 `library.storeError` |
| `PanelIcon`(342-364) | 不变 |
| `post`(322-340) | 不变（信封已是通用） |

### 7.7 新增组件（同文件、`createElement`、无 hooks 之外依赖）

| 组件 | 职责 | 依赖的既有函数 |
|---|---|---|
| `LibraryTree` | 递归渲染 collection 树（展开/折叠、创建/重命名/删除、点击激活、条数） | `createCollection`/`renameCollection`/`deleteCollection` |
| `RecentlyFoundList` | 暂存区列表 + 多选 + “存入 collection” + 清空 | `promoteRecent`/`clearRecent` |
| `FilterBar` | 年份区间（两个 `input type="date"` 的年份部分用 `input type="number"` 亦可）、期刊文本框、OA/撤稿复选框、最低被引、排序 | `setFilter` |
| `NoteEditor` | 笔记文本域、标签输入、7 色选择（**不引入取色器依赖**） | `saveAnnotation` |
| `TimelineAxis` | x 轴年份刻度、y 轴被引刻度、`year unknown` 带标注 | `computeTimelineLayout` 的返回值 |

### 7.8 禁止事项（本半边的红线）

1. 不新增 `require`（含 `react-dom`、日期/取色/图形库）→ 需要时按第 9 节 R4 走“待用户决策”。
2. 不引入 JSX/TS/打包产物；所有节点用 `React.createElement`。
3. 不改 `window.__ModuleLoader__.load` 契约与 `exports.apply` 的 slots 注册（`sidebar.panellist` + `main`）。
4. 不在 client 直接访问磁盘/`fetch` 其它域名（只走 `/dsh-research-cat/*`）。
5. 不改 `PANEL_KEY`/`ROUTE`（否则既有面板与测试契约破裂）。

---

## 8. 对 t3/t4/t5 的交接

### 8.1 文件级改动清单

| 文件 | 动作 | 责任 |
|---|---|---|
| `src/store.js` | 新增：默认路径解析、读、校验/修复、原子写、去抖 flush、`.bak` 降级 | t3 |
| `src/bibtex.js` | 新增：`bibtexOf(records, opts)` 纯函数（类型映射、转义、key 生成） | t3 |
| `src/graph.js` | 扩展：库操作、6 轴查询、筛选、分块、并发信号量、`truncated/considered/total` | t3 |
| `src/config.js` | 扩展：`searchPerPage/maxSeeds/concurrency/storePath` | t3 |
| `src/routes.js` | 新增 5 路由 + 既有路由参数扩展 | t3 |
| `src/tools.js` | 新增 4 action + `expand` 参数扩展 | t3 |
| `src/client.js` | 第 7 节全部改造点 | t4 |
| `test/parity.mjs` | **新增**（t3 契约 amend 要求）：每条新能力的成功路径 + 失败路径断言，见 8.4 | t3 写、t5 扩 |
| `test/local.mjs` | 新增 AC 编号检查（含离线桩） | t5 |
| `lab/` | 可选：时间线布局镜像（仅当 8.4 的“标记块提取”方案不可行时） | t4 |
| `README.md` / `README.en.md` | 配额、持久化、库/图关系、新入口 | t8 |

### 8.2 可测试接缝（t5 需要的可导出纯函数）

| 接缝 | 用途 | 对应 AC |
|---|---|---|
| `createStore({storePath, fs?})` | 注入内存 fs 做损坏/降级/原子写测试 | AC-B1-1..4/8 |
| `applyFilters(records, filters)` | 筛选语义离线可判定 | AC-A4-2..8 |
| `chunkIds(ids, 50)` | 分块不截断 | AC-A5-3 |
| `bibtexOf(records)` | 导出解析/转义/确定性 | AC-A7-2..8 |
| `computeTimelineLayout(nodes, links)` | x/y 单调性 | AC-A6-2..5 |
| `computeRadialLayout(...)` | 与基线快照一致 | AC-A6-7 |
| `expander` 的 `perSeed` 汇总 | 失败隔离与幂等 | AC-A2-3/5/6 |

### 8.3 实施顺序建议（t3 内部）

1. `config` + `store`（可先无网络跑通重启存活）
2. 库/collection/暂存区/注解 + 路由 + 工具（B 档闭环）
3. 查询扩展（作者轴 → earlier/later → 筛选 → 配额/分块 → expandAll 合并）
4. `bibtex` + `/export` + 工具 `export`
5. t4 面板（先 Library 页 → 再筛选/导出 → 最后时间线）

### 8.4 parity 测试计划（`test/parity.mjs`，t3 契约 amend 要求）

**目的**：每条新能力都有“成功路径 + 至少一条失败路径”断言，并证明该测试在实现落地前会失败——防止质量门被“什么都不做”骗过。

**责任人**：t3 编写并随实现同步提交（host 侧断言为主）；t5 在验证阶段扩充并复核覆盖；t4 只负责 8.4.4 的 client 侧标记块。**t2 不写测试文件（inScope=docs/）**，只定契约。

#### 8.4.1 覆盖矩阵（AC → 成功路径 + 失败路径）

| AC 编号 | 成功路径断言 | 失败路径断言（必须至少一条） |
|---|---|---|
| AC-A0-2/3/4 | `/expand` 旧 3 kind + 工具 4 action 形状不变 | 未知 kind → `invalid`；旧调用缺参数 → 与 `9a1bd7d` 同文案 |
| AC-A1-1/2/3 | `/authors` 返回 `A\d+`；`kind:author` 建边且 `source===id`；`citedBy` 单调不增 | 缺 `authorId` → `invalid`；未知 authorId → `found:0` 且有提示 |
| AC-A2-1/3/5/6 | 50 seeds 通过；51 → 拒绝；一个坏 seed 不中断；重复 expandAll `added:0`；`papers<=maxNodes` | 第 51 个种子；注入 404 种子；小 `maxNodes` 下继续展开被拒 |
| AC-A3-1/2/3/4 | earlier 全 `year<seed.year`；later 全 `year>seed.year`；边界（同年、`year=0`）不入选 | 同年/缺年份样本 → `found:0` 且 `ok:true`（不是错误） |
| AC-A4-2/4/5/7 | 年份闭区间含边界；`isRetracted:true` 结果全为真；`minCitations` 生效 | `yearFrom>yearTo`、未知键、非布尔、负 `minCitations`、非法 `sort` → `invalid` |
| AC-A4-6/8 | 带/不带 filters 的 `found` 不同且 `considered` 如实；两次调用 id 序列相同 | 用未筛选条数冒充 `found` → 断言失败（比较 `found===filteredIds.length`） |
| AC-A5-1/3/4 | 默认配置值正确；`chunkIds(100 ids)` 生成 2 次请求；references 可 `found>50` | 若实现截断在 50 → 断言失败（`found<=50 && considered>50`） |
| AC-A5-7 | 每个请求 URL 含 `mailto=` | 缺 `mailto` 的请求 → 断言失败 |
| AC-A6-2/3/5 | 时间线 x 随 `year` 单调、y 随 `citedBy` 单调；`year=0` 不丢弃 | 若 `year=0` 节点消失或 x 非单调 → 断言失败 |
| AC-A6-7 | `computeRadialLayout` 输出与基线快照一致 | 快照被改动 → 断言失败（基线文件随 t3 首次提交固化） |
| AC-A7-2/3/5/7/8 | 解析出 `count` 条；`title/year` 一致；两次导出字符串相等；转义正确；空输入 `count:0` | 缺 `title`/`year` 的条目；未转义 `&`/`%`；两次导出不等 → 断言失败 |
| AC-A7-6 | 6 种 OpenAlex type → 5 种 BibTeX 类型映射正确 | 未知 type 落到 `@misc`（不是 `@article`） |
| AC-B1-1/2/3/4/8 | 同 `storePath` 二次实例化字段相等；注入异常后文件仍可解析；未知版本 → `.bak` + 空库 + `storeError`；不可写目录 → 内存降级 | 每个失败分支各一条断言（损坏 JSON / 高版本 / 只读目录） |
| AC-B2-2/4/5/6/7/9 | ≥3 层嵌套；删集合不删文章；级联删子树；多归属；批量 `skipped`；重启后树存活 | 父不存在 → `invalid`；把祖先设为子 → `invalid`（断环）；删系统集合 → `invalid` |
| AC-B3-1/2/3/4/5/6 | 进图即入暂存区；`addSeed` 在首位；存入用户集合后移出；`clear` 不删库；超 500 淘汰最旧 | 存入后仍在暂存区 → 断言失败；`clear` 后文章消失 → 断言失败 |
| AC-B4-2/3/4/5/6 | note/tags/color 往返；部分更新不互相覆盖；重启存活 | 超长 note、>20 tags、非法 color、不存在的 id → `invalid` |
| AC-A7-1/9、AC-A2-2/7、AC-A4-1/9、AC-B2-1/8/10/11、AC-B3-8/9、AC-B4-7/8、AC-A6-1/4/6、AC-A1-6、AC-A3-5、AC-A0-5/6/7 | route/tool 级断言可覆盖的部分在此断言；纯 UI 部分标注 `panel-step`（由 t5 按 spec 第 10 节第 3 条取证） | 对应的非法输入/越界路径 |
| AC-C-1 | `grep` 断言：`zotero/oauth/collaborator/share/login/crossref/semanticscholar/quartile/h-index/readingStatus/csl/signals` 在 `src/` 无命中 | 任一命中 → 断言失败（C 档被私自实现） |

#### 8.4.2 “实现前先失败”的证明机制（含 `git stash` 陷阱）

要求 t3 提交**逐字证据**：命令 + 完整输出（含断言失败清单）。

- **陷阱（必须写进 parity.mjs 的设计）**：新模块（如 `src/store.js`）是 **untracked** 文件，`git stash` 默认**不会**移除 untracked 文件 → 若 parity.mjs 顶部直接 `import '../src/store.js'`，stash 后模块仍在，测试可能仍然通过，证明无效。
- **推荐命令**（按路径 stash，保留测试文件）：
  `git stash push -u -- src/ && node test/parity.mjs; echo "exit=$?"; git stash pop`
  说明：`-u` 让 `src/` 下的新文件一起被 stash；`test/parity.mjs` 不在 pathspec 内，保持在场。
- **parity.mjs 自身的写法约束**：所有 `src/` 导入使用**动态 `import()` + try/catch**，缺失模块时把“能力缺失”记为断言失败（而不是让进程以 import error 退出）；这样 stash 后的输出是一份**逐条 AC 的失败清单**，而非单行崩溃。要求失败清单里至少包含 8.4.1 表中的**每一个** AC 编号（即：测试必须先全红，再全绿）。
- **备选**（若 t3 先提交 parity.mjs 使 `git stash` 语义可用）：`git stash && node test/parity.mjs && git stash pop`，但**仅当** `src/` 新增文件已被跟踪（`git add`）时才等价——设计上仍推荐 `push -u -- src/`。
- **t5 复核**：独立重跑该命令一次，比对两次失败清单一致；并把“全红→全绿”两次输出作为 AC-A0 回归证据的一部分。

#### 8.4.3 离线优先

- parity.mjs **默认不联网**：OpenAlex 相关断言全部走注入桩（`fetchImpl` 计数器/固定 JSON），覆盖分块、筛选、截断、失败隔离、重试与 `mailto`。
- 需要真实网络的少量“冒烟”断言（如 `search` 真返回）必须单独分组，离线时打印 `SKIP` 且**不**计入失败；spec 第 10 节第 4 条的“网络类 AC 不可达必须判 failed”约束的是 **t5 的验收证据**，不是 parity 的离线套件——t5 必须另跑一次联网验收并单独记录。

#### 8.4.4 client 侧（时间线布局）的 parity 处理

`src/client.js` 在导入时会调用 `window.__ModuleLoader__.load`，**无法被 Node 直接 import**，因此：

1. **首选：标记块提取**。t4 在 client.js 里给纯函数加标记注释
   `/* @parity:computeTimelineLayout:start */ … /* @parity:computeTimelineLayout:end */`；
   parity.mjs 用 `node:fs` 读 `src/client.js`，按标记切出该段文本，用 `new Function` 求值后断言 AC-A6-2/3/5（x/y 单调、`year=0` 不丢）。**测的是随包发布的真实代码**，不复制。
2. **兜底**（仅当标记块方案因任何原因不可行）：在 `lab/` 放一份镜像（沿用仓库既有约定：`lab/computeLayout.new.js` 与运行实例“同一份字面量”），parity.mjs 断言镜像行为 **且** 断言镜像与 client.js 中该段文本一致（逐字节）。
3. 纯视觉 AC（AC-A6-1/4/6、AC-A0-5、AC-B2-10、AC-B3-8、AC-B4-7）仍由 t5 的 `panel-step` 取证，不在 parity.mjs 里伪造“自动通过”。

---

## 9. 风险与需用户决策项

| 编号 | 风险/议题 | 影响 | 处理 |
|---|---|---|---|
| R1 | JSON 单文件在条目 >2 万时全量读写变慢 | 体验 | 本轮上限保护（2.8）；突破需 SQLite → **待用户决策**（新依赖） |
| R2 | 两个 DSH 实例共享同一 `storePath` → last-writer-wins | 数据 | 登记限制；若用户要求，加锁或分文件（额外工作量）→ **待用户决策** |
| R3 | `earlier` 在长参考列表上欠采样（只取前 100 条参考） | 完整性 | 面板明示 `truncated`；全量需更多请求 → **待用户决策**（是否放宽配额/加翻页） |
| R4 | 面板若要日期选择器/取色器/图表库 | 依赖 | 本轮用原生 input + 色点按钮；引入库 = 新依赖 → **待用户决策** |
| R5 | 库文件含用户笔记（隐私） | 隐私 | 文件在用户 home 下、权限 0600（t3 落地时 `mode:0o600`）；不做云同步（C4） |
| R6 | `records` 中的元数据会随 OpenAlex 更新而过期 | 正确性 | 提供“刷新元数据”（复用 `details`）；不自动后台刷新 |
| R7 | 旧动态插件归档 `dynamic/` 与安装版并存 | 混淆 | 本轮不动 `dynamic/`；README 注明推荐安装版（t8） |

**需要用户拍板的（汇总，均为 spec C 档或本节新议题）**：SQLite/更大库规模（R1）、多实例共享库（R2）、earlier 全量采样（R3）、面板引入第三方 UI 库（R4）；其余 C 档（协作分享/Zotero/多数据源/学习型推荐/移动端/账号云库/RR+ 高级检索/导入/阅读状态/复制引文/Signals）见 spec 第 8 节。

---

## 10. 与冻结 spec 的一致性检查

| spec 验收 | 本设计的落点 |
|---|---|
| AC-A0-2/3/4（旧契约不破） | 5/6 节兼容矩阵 + 3.2 系统集合派生 `graph.seeds` |
| AC-A1-1..6（作者轴） | 4.3 + 5(`/authors`) + 6(`expand kind=author`) + 7.6（作者名可点） |
| AC-A2-1..7（多 seed） | 4.6 + 6.3(`maxSeeds=50`) + 4.1 并发 4 |
| AC-A3-1..6（Earlier/Later） | 4.4（严格 `publication_year`、不下推日期、`truncated`） |
| AC-A4-1..9（筛选） | 4.7（统一下推+后置、`considered`）+ 7.7 `FilterBar` |
| AC-A5-1..7（配额） | 6.3 配置表 + 4.5 分块 + 4.1 `mailto` |
| AC-A6-1..7（时间线） | 7.3 `computeTimelineLayout` + 7.4 `layoutMode` + 7.6 刻度 |
| AC-A7-1..10（BibTeX） | `src/bibtex.js` + 5(`/export`) + 6(`export` action) + 7.6 下载入口 |
| AC-B1-1..9（持久化） | 2.1–2.8（路径/格式/原子写/降级/库图关系） |
| AC-B2-1..11（多 collection） | 3.1–3.2、3.5 + 5(`/collections`) + 6 + 7.7 `LibraryTree` |
| AC-B3-1..9（暂存区） | 3.3 + 5(`/recentlyFound`) + 6(`recent`) + 7.7 `RecentlyFoundList` |
| AC-B4-1..9（笔记/标签/颜色） | 3.4 + 5(`/annotate`) + 6(`annotate`) + 7.7 `NoteEditor` |
| AC-C-1（C 档不得实现） | 第 9 节把新增议题全部标“待用户决策”；7.8 红线禁止引入 C 档依赖 |
| 硬约束（无构建/无新依赖/单文件 client） | 0 节决策表、2.2 格式取舍、7.8 禁止事项 |
| **captain 修正：持久化根路径不得硬编码** | 2.1（`${DSH_HOME:-$HOME/.dsh}/research-cat/library.json` 三级解析）+ 2.1.1（fs 实测结论；仅当实测证明存在 storage 服务才替换，且 AC 等价） |
| **t3 契约 amend：`test/parity.mjs` 先失败后通过** | 8.4（AC 覆盖矩阵、失败路径清单、`git stash push -u -- src/` 证明机制与陷阱、client 标记块方案） |

**设计结论**：在现有约束内可实现 spec 的全部档 1 验收项，无需新增依赖、无需构建步骤。与 spec 冻结路径相关的细化只有一处：默认路径解析为 `${DSH_HOME:-$HOME/.dsh}/research-cat/library.json`（**不硬编码 home**，兼容自定义 `DSH_HOME` 的部署），本机等价于 `~/.dsh/research-cat/library.json`，因此不需要 spec 变更。持久化介质固定为普通 fs（2.1.1 实测未发现可用的 DSH storage 服务，不引入未经证实的依赖）。`test/parity.mjs` 的覆盖矩阵、失败路径与“实现前先失败”证明机制见 8.4，由 t3 编写、t5 复核。
