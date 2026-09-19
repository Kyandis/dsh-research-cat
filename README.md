# Research Cat · 文献引用网络工作台

[English](README.en.md) | **中文**

给 **DeepSeek Harness** 加一个文献探索工作台：一个侧栏面板 + 一个 agent 工具，两者**共用同一份库**——库（collection / 暂存区 / 笔记）**落盘持久**，引用网络图**在内存里临时**。搜 OpenAlex、把论文收进 collection 或子 collection、沿 references / citations / similar / 作者 / Earlier / Later 六条轴展开，在径向图或时间线视图上看清它长什么样，最后导出 BibTeX。

```
搜索 → 加入种子（≤50）→ 展开（references / citations / related / earlier / later / author）→ 看图与详情 → 存入 collection / 写笔记 / 导出 BibTeX
```

## 预览

| 改进前（力导向布局） | 改进后（径向布局） |
|---|---|
| ![before](preview/before-101-nodes.png) | ![after](preview/after-101-nodes.png) |

> **这两张图不是面板截图**，而是仓库自带 `lab/render.mjs` 生成的**离线布局渲染**（近似配色，用来评判布局本身）。数据是真实的：两个种子（各 29 篇参考文献 + 10 篇相似 + 25 篇施引文献）共 101 节点 / 118 边。
> 同一份数据在本地实测：总边长 28456 → 11516 px，**交叉数 6 → 0**，hub 处最小夹角 0.0° → 2.9°。

## 安装

### A. 作为可安装插件（推荐）

Research Cat 是一个标准 DSH 插件包：host 半边（`exports["."]`）在宿主进程里注册 `research_cat` 工具与 `/dsh-research-cat` 路由，client 半边（`exports["./client"]`）在 web GUI 里注册侧栏图标与中央面板。**没有构建步骤**——两半边都是普通 JS，client 按宿主契约调用 `window.__ModuleLoader__.load`，React 由 shell 的 `require` 提供。

```bash
dsh plugin --profile <你的 profile> add link:/path/to/dsh-research-cat
```

> ⚠️ **`desktop` profile 由 DSH 桌面应用独占管理**，CLI 会直接拒绝（源码里的 `rejectElectronProfile`）。桌面用户请走应用内的**插件市场**，来源填 `link:/path/to/dsh-research-cat`（dshmarket 支持 `link:` / `file:` 来源）。非桌面 profile 用上面那条命令即可。
>
> **桌面版实测可行的手动路径**（本仓库就是这么装上并验证的）：
> 1. 在 profile 目录（如 `~/.dsh/profiles/desktop`）执行 `pnpm add "link:/path/to/dsh-research-cat"`
> 2. 往该 profile 的 `package.json` 里，把 `"dsh-research-cat"` 加进 `dsh.profile.bundles`
> 3. 重启 DSH
>
> 两者差别：**在市场里点装会当场热挂载**（日志里会打 `[dsh-market] hot-mounted <plugin>`）；手动装则要重启一次才加载。
>
> 加载成功后可自查：侧栏 occupant 的 `registrant` 应是 **`dsh-research-cat`**；若以 `dyn/` 开头，那是会话里临时注册的动态插件，不是这个包。完整重启自检清单见 [`docs/RELEASE-CHECKLIST.md`](docs/RELEASE-CHECKLIST.md)。

### B. 作为动态 Cordis 插件（`dynamic/`）

`dynamic/` 保留了纯动态插件形态的源码（两个 function body）。它**不需要安装**，但只活在进程内存里、**重启即消失**，加载还要过 agent 授权：

```
请读取 dynamic/host.js 与 dynamic/client.js，然后：
1) 调用 cordis_define：plugin.kind = "new"，code.host 用 dynamic/host.js 全文，code.client 用 dynamic/client.js 全文
2) 用返回的 pluginId / packageId 调用 cordis_run，mode = "run"
```

客户端半边会返回 `awaiting-approval`，需要在会话里的 **Run 卡片上点一次授权**（单勾只授权当前版本，**双勾**可授权后续版本）。

**前提**：你的 DSH 会话具备动态 Cordis 动态插件能力（`cordis_define` / `cordis_run` / `cordis_inspect_self`）。

两种形态装好后都一样：左侧栏出现 **Research Cat** 图标；agent 多出一个 `research_cat` 工具。

## 用法

**A. 让 agent 驱动**（`research_cat` 工具，8 个 action）

| action | 作用 |
|---|---|
| `search` | 按标题 / 作者 / 主题 / DOI 检索，返回 OpenAlex 命中与 work id（如 `W2094864959`）；可带 `filters` 与 `page` |
| `add` | 把某篇加入 collection（种子，上限 50） |
| `expand` | 拉某篇的邻居：`references`（它引用的）/ `citations`（引用它的）/ `related`（OpenAlex 认为相似的）/ `earlier`（早于它的参考文献）/ `later`（晚于它的施引文献）/ `author`（某作者的作品，需 `authorId`） |
| `list` | 列出当前 collection |
| `collections` | 组织库：`op` = list / create / rename / delete / save / remove（支持 `parentId` 建子 collection、批量 `ids`） |
| `recent` | Recently Found 暂存区：`op` = list / clear / promote |
| `annotate` | 读 / 写某篇的笔记、标签与颜色（`note` / `tags` / `color`） |
| `export` | 导出 BibTeX（`format:"bibtex"`，可给 `ids` 或 `collectionId`） |

`expand` 与 `search` 都接受 `filters`：`yearFrom` / `yearTo`（闭区间）、`venue`（大小写不敏感子串）、`isOa`、`isRetracted`、`minCitations`、`sort`（`"cited"` 默认 / `"year"`）。非法筛选值会被拒绝（`code: "invalid"`），不会静默忽略。

**B. 在面板里操作**：左侧栏 Research Cat →

- 顶部两个标签页：**Graph**（引用网络图）与 **Library**（collection 树 + Recently Found 暂存区）
- 工具栏：`Auto-expand`（对**全部**种子展开，不再只前 6 个）、`Re-layout`、`Clear`（清图 + 清系统 collection 成员，保留库）、`Radial` / `Timeline` 布局切换、`Filters`（年份区间 / 期刊 / OA / 撤稿 / 最低被引 / 排序）、`Export`（导出当前 collection 或全部为 `.bib`）
- Library 页：多层 collection 树（新建 / 重命名 / 删除 / 新建子 collection / 存入 / 移除）、Recently Found 列表（多选 → 存入 collection、一键清空）、`Reset library`（清空整个库，需二次确认）
- 详情面板：References / Cited by / Similar / **Earlier** / **Later** 五个入口 + 作者名可点（按作者展开）、笔记编辑框、标签输入、7 色标签；底部显示库文件位置与 `storeError`

**两者共享同一个库**：agent 加进来的论文会出现在面板里，反之亦然。所以最顺手的用法是分工 —— 让 agent 批量检索、建种子、展开邻域、整理 collection，你自己在面板里看图、点节点、读摘要、写笔记。

## 本轮与 Research Rabbit 的对齐

逐项对照（含**未做项**与原因）见 [`docs/COMPARISON.md`](docs/COMPARISON.md)。本轮落地的能力：

| 能力 | 说明 |
|---|---|
| 作者轴 | 点作者名或 `expand kind:"author"` → 该作者的作品（按被引降序）。OpenAlex 偶尔把 `author.id` 返回为 `null`（例如 `W2907492528`），此时按 ORCID 解析作者 id；同一 ORCID 有多个重复档案时取 `works_count` 最大、并列取 id 最小，结果确定可复现 |
| Earlier / Later | `earlier` = 该篇 references 中 `year < 种子年份` 的部分；`later` = 施引文献中 `year > 种子年份` 的部分。**严格不等**：同年与缺年份（`year=0`）都不计入 |
| 多 seed | 种子上限 **50**（对齐 RR 免费档）；`expandAll` 对全部种子按指定轴展开，单个种子失败不中断（`perSeed[].error`），重复展开幂等（第二次 `added = 0`） |
| 筛选 | 年份闭区间 / 期刊子串 / 开放获取 / 撤稿 / 最低被引 / 排序；所有轴语义一致，返回体如实报告 `found`（筛选后）与 `considered`（筛选前） |
| 时间线视图 | X = 年份、Y = 被引数（越靠上被引越高），`year=0` 进入最左“year unknown”带；轴上有年份与被引刻度 |
| 多层 collection | 任意深度子 collection、一篇文章可同时属于多个 collection、删除 collection 级联删子树但**不删文章**、`itemCount`（直接成员）与 `itemCountDeep`（子树去重）双口径 |
| Recently Found | = 进过图、但**未存入任何用户 collection** 的文章；存入任一 collection 后移出，移除后回归；上限 500（按最久未进入淘汰） |
| 笔记 / 标签 / 颜色 | 每篇一条笔记（≤10000 字符）、一组标签（≤20 个 × ≤40 字符，去重保序）、一个颜色（`red/orange/yellow/green/blue/purple/gray` 或 `null`）；支持部分更新 |
| BibTeX 导出 | 类型映射固定、citation key 唯一确定、两次导出 byte-identical、LaTeX 特殊字符转义、非 ASCII 原样保留 |

**未做（需用户拍板，见 `docs/COMPARISON.md` 第 3 节）**：BibTeX/RIS/CSV **导入**、Zotero 导入、分享与协作、账号云端库、多数据源聚合（Crossref / Semantic Scholar）、学习型推荐、RR+ 高级检索（关键词过滤 / SJR 分区 / 期刊 H-Index / 300 seeds / 多项目）、阅读状态、复制引文样式、Signals 风险指标、移动端 / 浏览器扩展。

## 数据来源与配额

- 数据源：**OpenAlex 公开 API**（`https://api.openalex.org`），**无需 API key**；每个请求都带 `mailto`（polite pool）
- 配额（全部可经插件配置覆盖，见 §配置）：
  - 搜索 **50 条/页**（`searchPerPage`）
  - `references` / `related` / `earlier` / `author` 每次最多 **100 条**（`maxBatch`）
  - `citations` / `later` 取**被引最高的 100 条**（`maxCitations`，不是全量）
  - 图上限 **1000 节点**（`maxNodes`），到顶会拒绝继续展开并提示先 Clear
  - 种子上限 **50**（`maxSeeds`）
  - 并发上限 **4**（`concurrency`）；单请求 8 s 超时；429 / 5xx / 网络错误自动重试 1 次
- `references` 的批量元数据请求按 **50 个 id 分块**（OpenAlex `openalex_id` OR 过滤的单次上限），所以“单次最多 100 条”不会被静默截断在 50
- `related` 对部分论文为空（OpenAlex 自己就是 0），面板会如实显示，不会编数据
- **429 提示**：OpenAlex 对无 key 请求按**网络出口 IP 共享免费日预算**。预算耗尽时所有真实联网检查都会返回 HTTP 429（`retry-after` 指向午夜 UTC 重置），这与插件本身无关；离线检查与真实 HTTP 路由检查不受影响。

### 配置

`cordis.patch.yml` 的 `config` 块（或 profile 的 patch 层）可覆盖：

| 键 | 默认值 | 说明 |
|---|---|---|
| `exposeTool` | `true` | 是否注册 `research_cat` 工具 |
| `mailto` | `dsh-research-cat@localhost` | OpenAlex polite-pool 联系地址 |
| `apiKey` | 空（无 key） | OpenAlex API key；**免费申请且有自己的预算**。不设时请求会算在整个出口 IP 共享的免费日预算上，用尽即 429 |
| `searchPerPage` | `50` | 搜索每页条数 |
| `maxBatch` | `100` | references / related / earlier / author 单次上限 |
| `maxCitations` | `100` | citations / later 单次上限 |
| `maxNodes` | `1000` | 图节点上限 |
| `maxSeeds` | `50` | 种子上限 |
| `concurrency` | `4` | OpenAlex 并发上限 |
| `storePath` | `${DSH_HOME:-$HOME/.dsh}/research-cat/library.json` | 库文件位置（见下） |

### 搜索被 429 限流时：配置 OpenAlex API key

无 key 的请求算在**整个出口 IP 共享的免费日预算**上，用尽即返回 429（`Insufficient budget`，午夜 UTC 重置）——表现是"搜索突然不工作"，但根因在上游配额，不是插件坏了。OpenAlex 的 key **免费且携带独立预算**：

1. 按 <https://help.openalex.org/api/authentication/> 申请免费 key
2. 在 `cordis.patch.yml` 的配置块里加 `apiKey: "你的key"`（该键**有意不写死**在仓库默认里，避免把私人 key 提交进版本库）
3. 重启 DSH

设好后每个 OpenAlex 请求都会带上 `api_key=`；未设置时**完全不带**该参数。这两点都有断言覆盖（`AC-A5-7b` / `AC-A5-7c`），不是"看起来生效"。

> 注意：macOS 上 DSH 桌面应用由 Finder/Dock 启动，**拿不到你 shell 里 `export` 的环境变量**，所以 key 走配置而不是环境变量。

## 持久化库（库落盘 / 图临时）

这一节是 **AC-B1-9** 要求的说明：库文件在哪、怎么解析、坏了会怎样、测试必须怎么隔离。

### 库文件与路径解析

默认路径：**`${DSH_HOME:-$HOME/.dsh}/research-cat/library.json`**（本机 `DSH_HOME=/Users/<user>/.dsh`，即 `~/.dsh/research-cat/library.json`）。解析顺序**三级**，不硬编码 home：

1. 显式配置 `storePath`（相对路径按 `${DSH_HOME:-$HOME/.dsh}` 解析）
2. 否则 `$DSH_HOME` 非空 → `${DSH_HOME}/research-cat/library.json`
3. 否则 `os.homedir() + '/.dsh/research-cat/library.json'`

落盘内容：`records`（作品元数据缓存）、`collections` + `memberships`（多层集合与多归属）、`recentlyFound`、`annotations`（笔记/标签/颜色）、`version`、`savedAt`。**引用网络的边（nodes/links）不落盘**——重启后库还在、图是空的，展开任意条目即可重建邻域（边可由 OpenAlex 随时重算，落盘只会带来陈旧边与体量问题）。

写入策略：临时文件 + `fsync` + `rename` 原子替换（**任意时刻磁盘上要么是完整旧版本、要么是完整新版本**）；300 ms 去抖、最长等待 2 s、串行链合并；`clear` 这类破坏性操作立即写；插件卸载时 flush。

### 坏文件与降级

| 场景 | 行为 |
|---|---|
| 文件不存在 | 视为全新库，写入默认结构（含系统 collection `seeds`），`storeError: null` |
| JSON 损坏 / 截断 / 空文件 | 原文件改名为 `library.json.bak-<时间戳>`，以空库启动，`storeError` 写明路径与原因（**不静默丢数据、不崩溃**） |
| `version` 高于当前构建 | 同上（`.bak` + 空库 + `storeError`），不做猜测性解析 |
| 结构被破坏（悬空成员/环/重复） | 尽力修复（丢悬空项、补系统 collection、断环），修复条数写入 `storeError`，修复后立即落盘 |
| `storePath` 不可写 | 降级为纯内存库 + `storeError`，**插件加载不失败** |

`storeError` 会出现在 `/state` 的 `library.storeError`，面板顶部显示警告条，面板底部显示库文件位置。

### 测试必须隔离 storePath（重要）

库是**进程级共享的真实文件**：任何直接 `createLibrary(defaults)` 或 `POST /state` 的测试，只要不隔离路径，就会读写**用户真实库**。

规则：

- 测试/脚本必须显式传 `storePath`（指向 `os.tmpdir()`），或在进程启动时把 `DSH_HOME` 指向临时目录；
- 仓库自带套件已密封：`test/local.mjs` 在 import 任何模块前就把 `DSH_HOME` 指向新建的临时目录，并给引擎与 host 半边各自独立的 `storePath`；`test/parity.mjs` 同样把 `DSH_HOME` 指向临时目录，且每个库都显式给 `storePath`；
- `test/local.mjs` 结尾会断言**用户真实库未被创建或修改**。

可复现验证（AC-B1-9）：

```bash
# 1) 密封性：跑完整套件，末尾应打印真实库指纹，且 seal 检查为 PASS
node test/local.mjs | tail -6
#   期望（离线/配额正常时）：
#     PASS seal: the user's real ~/.dsh/research-cat/library.json was neither created nor modified by this run
#     sealed run: DSH_HOME=/var/folders/.../dsh-research-cat-XXXX  engineStore=/var/folders/.../engine/library.json
#     real library fingerprint: (absent)          <- 或一个 sha256（若你确实有库）
#     local: all checks passed

# 2) 只看密封与持久化段（不看联网段）
node test/local.mjs 2>&1 | grep -E "seal:|AC-B1-"

# 3) 路径解析行为（不改任何真实文件）
DSH_HOME=/tmp/dsh-rc-demo node -e "import('./src/config.js').then(m => console.log(m.resolveConfig(undefined).storePath))"
#   期望：/tmp/dsh-rc-demo/research-cat/library.json
```

## 重要限制（先读这段）

1. **库持久、图临时。** collection / 子 collection / Recently Found / 笔记 / 标签 / 颜色 / 作品元数据都在 `library.json` 里；引用边（nodes / links）只在内存，重启后图是空的。
2. **通过 agent 工具发起的检索会进入 DSH 的会话记录**；只在面板里操作则不经过模型、不进会话记录。
3. **只做导出，不做导入。** BibTeX/RIS/CSV 导入、Zotero 导入都需要文件上传通道或第三方 OAuth，属“待用户决策”项（`docs/COMPARISON.md` §3）。
4. **单文件 JSON 的体量上限**：库内保护上限为 20000 条 records / 40000 条 memberships / 20000 条注解 / 500 条暂存区；超过时拒绝新增并给出可读错误。突破 2 万条规模再评估 SQLite（需新增依赖，属待决策项）。
5. **多个 DSH 实例共享同一 `storePath` 时是 last-writer-wins**（本轮不加锁文件）。
6. **OpenAlex 免费预算是按出口 IP 共享的**：预算耗尽时联网操作全部 429（`retry-after` 指向午夜 UTC）。

## 布局算法

不是力导向调参，而是可解释的径向排布（`src/client.js` 的 `computeRadialLayout`）：

1. **找 hub**：度最大的节点（平手时优先种子、再比被引）→ 放到画布正中心
2. **BFS 分层**：每层占一个半径带
3. **同层按角色分扇区**：`seed` / `references` / `citations` / `related` / `earlier` / `later` / `author` 各占一段连续角度，扇区间留空隙 —— 一眼能看出哪半边是被引、哪半边是作者
4. **扇区内按被引数降序**：越重要的越靠内环
5. **环容量公式** `capacity = ⌊arc × r / minSpacing⌋`，且相邻两点间距 ≥ 两节点半径和：同环不重叠，装不下就加一环（半径持续外扩，不再钳制），相邻环**错开半格**
6. **辐条角度分离**：最后把 hub 的各条边拉开到最小 0.05 rad，消除“两条线几乎叠在一起”
7. **自适应视口**：布局超出 1200×800 时按 `layoutExtent` 对称扩张 SVG `viewBox`，大图整体变小但完整可见、可缩放

时间线视图（`computeTimelineLayout`）是另一套纯函数：X 按年份单调（同年同 X），Y 按被引数单调（越大越靠上），`year=0` 进入最左的固定宽度“year unknown”带、绝不丢弃；轴上给出年份与被引刻度（`timelineTicks`）。

节点大小与亮度按被引数归一化；节点描边与线型按 6 类边区分（`references` / `citations` / `related` / `earlier` / `later` / `author`，各有关闭开关）；种子与被引前 18 名常显标签（缩放 ≥1.8 全显）；选中节点时高亮其邻边、淡化无关节点与边。

## 验证

```bash
node test/local.mjs        # host 全链路：加载器契约 / 配置默认值 / 引擎（离线桩 + 真实 OpenAlex）/ 持久化 / host 接线（真实 HTTP）
node test/parity.mjs       # 冻结 spec 的 AC 判据（139 项，默认离线 fetch 桩；联网冒烟单列不计失败）
node test/client.mjs       # client 布局与面板（38 项）
node lab/client-check.mjs  # 面板自测：Loader 契约 + @parity 纯函数 + 真实渲染交互（91 项）
```

期望输出（配额正常时）：四个命令全部 `exit 0`，`local.mjs` 末尾打印 `local: all checks passed`，`parity.mjs` 打印 `parity: 139 passed, 0 failed`。

`test/local.mjs` 里有一部分是**真实联网**检查（AC-A1/A3/A5 等）；OpenAlex 免费预算耗尽时它们会按 spec §10.4 判 `FAILED`（如实报告，不降级为 pass），此时输出形如 `local: 26 check(s) FAILED`，离线与真实 HTTP 路由段仍全绿。配额恢复（午夜 UTC）或提供带 key 的出口后即可复现全绿。

`test/parity.mjs` 的判别力可以自证（先全红、后全绿）：

```bash
git stash push -u -- src/ && node test/parity.mjs; echo "exit=$?"; git stash pop
# 期望：暂存态 exit=1（逐条 AC 失败清单），pop 后工作树恢复
```

## 目录结构

```
package.json               插件清单：exports / dsh.bundle.patch / dsh.client
cordis.patch.yml           组合补丁：把本插件的行 insert 进 profile（含全部 9 个配置键）
src/
  index.js                 host 入口（name / inject / apply，await 库就绪，卸载时 flush）
  graph.js                 引擎：OpenAlex 查询 + 内存图 + 持久化库 + 6 轴 + 筛选 + 导出
  store.js                 库文件：路径解析 / 原子写 / 去抖 / 版本与坏文件降级
  bibtex.js                BibTeX 渲染（纯函数：类型映射 / 转义 / citation key）
  routes.js                /dsh-research-cat JSON 路由（13 条，带 loopback 围栏）
  tools.js                 research_cat agent 工具（8 个 action）
  client.js                browser 半边：__ModuleLoader__ 契约 + 侧栏 + 面板（径向/时间线）
  config.js                配置解析（9 个冻结键）
test/
  local.mjs                host 全链路本地验证（密封：DSH_HOME 指向临时目录）
  parity.mjs               冻结 spec 的 AC 判据（离线优先 + stash 反证）
  client.mjs               client 布局与面板断言
  AC-EVIDENCE.md           AC → 状态 → 证据 对照表（t5 验证产物）
  evidence/                原始输出留档
  a0-baseline-check.mjs    独立 A0 基线探针
  findings-probe.mjs       findings 复现探针
docs/
  rr-parity-spec.md        冻结验收规格（AC 判据 + 接口契约）
  rr-parity-design.md      实现设计
  COMPARISON.md            与 Research Rabbit 的逐项对照（含未做项）
  RELEASE-CHECKLIST.md     安装与重启自检清单
dynamic/                   纯动态插件归档（host.js / client.js / plugin.json）
lab/                       离线布局实验台 + 面板自测（client-check.mjs）
preview/                   布局对比渲染图
```

## `lab/` —— 自己改布局并立刻看到效果

```bash
npm i @resvg/resvg-js
node lab/fetch.mjs graph.json W2907492528 W3152893301   # 抓真实数据（两个种子）
node lab/render.mjs graph.json old before               # 旧布局 + 指标
node lab/render.mjs graph.json new after                # 新布局 + 指标
node lab/client-check.mjs                               # 面板自测（Loader 契约 / 纯函数 / 真实渲染）
```

- `lab/computeLayout.new.js` 是**与运行实例同源的布局代码**（同一份字面量），改完可以直接贴回 `client.js`
- `lab/render.mjs` 会打印总边长 / 最长边 / hub 最小夹角 / **真实交叉数**，用来客观判断“是不是真的变好了”
- `lab/client-check.mjs` 从 `src/client.js` 的 `@parity:` 标记块里提取**随包发布的真实纯函数**求值（径向 / 时间线 / 刻度 / collection 树），并用 mini hook runtime 真实渲染面板驱动交互

## Roadmap

- [x] 打包成**可安装插件**：`dsh.bundle.patch` + `dsh.client`，client 半边按 Loader 契约手写，**不需要构建步骤**
- [x] 装进 `desktop` profile 并验证：工具、侧栏、面板、日志无报错，且**重启后仍在**
- [x] 与 Research Rabbit 对齐一轮：作者轴 / Earlier-Later / 多 seed(≤50) / 筛选 / 时间线视图 / 多层 collection / Recently Found / 笔记标签颜色 / BibTeX 导出 / 持久化库
- [ ] 发布到 DSH 插件市场，让安装变成一次点击
- [ ] 待用户拍板：导入（BibTeX/RIS/CSV、Zotero）、协作分享、账号云端库、多数据源、学习型推荐、RR+ 高级检索

## License

[MIT](LICENSE)
