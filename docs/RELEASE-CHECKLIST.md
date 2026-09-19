# 安装与重启自检清单（t8 交付物）

- **适用对象**：`dsh-research-cat`（RR 对齐版）装入 DSH `desktop` profile
- **profile 目录**：`~/.dsh/profiles/desktop`（DSH 桌面应用独占管理，CLI 会拒绝 `rejectElectronProfile`）
- **前置**：`docs/COMPARISON.md` 与 `test/AC-EVIDENCE.md` 已随本次提交发布

> **为什么必须重启**：`desktop` profile 的手动 `link:` 安装不会热挂载，host 半边（工具 + 路由）与 client 半边（侧栏 + 面板）都在 **DSH 进程启动时**加载。只有应用内插件市场点装才会当场热挂载（日志里会打 `[dsh-market] hot-mounted <plugin>`）。
> 因此：**本清单第 2 节必须在重启 DSH 之后执行**；第 1 节（静态安装检查）可以在重启前做。
>
> **本清单的验证状态（重要）**：本任务交付的是**清单本身及其可执行性**，第 2 节**尚未**在进程内验证通过。实测当前 DSH 进程挂载的仍是**改动前**的 host 半边——运行期探针 `research_cat {action:"collections"}` 返回
> `invalid arguments: "action" must be one of ["search","add","expand","list"]`（即 4-action 旧版），而 `src/tools.js` 已经是 8 action。重启 DSH 后按第 2 节逐条勾选即可；在重启之前，第 2 节的任何一条都**不得**被表述为“已通过”。

---

## 1. 安装生效检查（重启前即可做）

### 1.1 三处配置（缺一不可）

```bash
PROFILE="$HOME/.dsh/profiles/desktop"

# a) dependencies 含 link: 指向本仓库
node -e "const p=require('$PROFILE/package.json'); console.log(p.dependencies['dsh-research-cat'])"
#   期望：link:/Users/depengwang/DSH/dsh-research-cat

# b) dsh.profile.bundles 含 dsh-research-cat
node -e "const p=require('$PROFILE/package.json'); console.log(p.dsh.profile.bundles.includes('dsh-research-cat'))"
#   期望：true

# c) node_modules 软链存在且指向本仓库
ls -l "$PROFILE/node_modules/dsh-research-cat"
#   期望：.../node_modules/dsh-research-cat -> ../../../../DSH/dsh-research-cat
readlink -f "$PROFILE/node_modules/dsh-research-cat" 2>/dev/null || (cd "$PROFILE/node_modules/dsh-research-cat" && pwd -P)
#   期望：/Users/depengwang/DSH/dsh-research-cat
```

若 `dependencies` 或 `bundles` 缺项，按 README「桌面版实测可行的手动路径」补齐：

```bash
cd "$PROFILE"
cp package.json "package.json.bak-$(date +%Y%m%d-%H%M%S)"   # 改前留备份
pnpm add "link:/Users/depengwang/DSH/dsh-research-cat"
# 再把 "dsh-research-cat" 追加进 package.json 的 dsh.profile.bundles
```

> 只动这两处；**不要改 profile 里 DSH 应用独占管理的其它配置项**（`cordis.yml`、`.dsh-market/`、`pnpm-workspace.yaml` 等）。

### 1.2 插件自身配置

```bash
grep -A 14 "dsh-research-cat" ~/.dsh/profiles/desktop/node_modules/dsh-research-cat/cordis.patch.yml | head -20
```

期望看到 9 个配置键（`exposeTool` / `mailto` / `searchPerPage` / `maxBatch` / `maxCitations` / `maxNodes` / `maxSeeds` / `concurrency` / `storePath`），且配额是新默认值（搜索 50、references/related/earlier/author 100、citations/later 100、图 1000、种子 50、并发 4）。

profile 的 patch 层（`~/.dsh/profiles/desktop/cordis.patch.yml`）**不应**覆盖 `dsh-research-cat`（本机只 disable 了 `archify-skill-filesystem`）。

### 1.3 交付物哈希（安装前确认工作树静默）

```bash
cd /Users/depengwang/DSH/dsh-research-cat && git status --porcelain && shasum -a 256 src/*.js test/parity.mjs test/local.mjs lab/client-check.mjs
```

本次发布的钉住哈希（评审 t9/t12 各自独立复算过）：

| 文件 | sha256（前 8 位） |
|---|---|
| `src/client.js` | `5798e598` |
| `src/store.js` | `41b80d78` |
| `src/bibtex.js` | `a659746d` |
| `src/graph.js` | `8c27a067` |
| `src/routes.js` | `2cbe78f1` |
| `src/tools.js` | `5922a6d5` |
| `src/config.js` | `7f0d2a0e` |
| `src/index.js` | `50d9ab17` |
| `test/parity.mjs` | `62ac5a6b` |
| `test/local.mjs` | `25a7c12c` |
| `test/client.mjs` | `00e8f407` |
| `lab/client-check.mjs` | `8e07c985` |

---

## 2. 重启后的自检清单

> **执行前提**：本节**只能在重启 DSH 之后**执行，且**当前尚未执行过**（进程内仍是改动前的 4-action 旧版 host 半边）。本任务交付的是清单本身；下面的每一项都是重启后**待勾选**的检查项，不是已通过的结论。

**步骤 0**：完全退出 DSH 桌面应用（不是关窗口），重新启动，打开 Research Cat 面板。

### 2.1 host 半边：工具与路由

| # | 检查 | 怎么做 | 期望 |
|---|---|---|---|
| H1 | `research_cat` 工具存在 | 让 agent 调一次 `research_cat {action:"list"}` | 返回可读文本（空库时 `The collection is empty.`），**不报 unknown tool** |
| H2 | **8 个 action 可用** | 依次调 `list` / `collections{op:"list"}` / `recent{op:"list"}` / `export{format:"bibtex"}` / `annotate` / `search` / `add` / `expand` | 全部 `ok:true`；`search`/`add`/`expand` 与旧版文案一致；新增 4 个 action 有输出 |
| H3 | 路由存活 + 围栏 | `curl -s http://127.0.0.1:43120/dsh-research-cat` | `{"ok":true,"value":{"name":"dsh-research-cat",...}}` |
| H4 | `/state` 含新字段 | `curl -s -X POST -H 'content-type: application/json' -d '{}' http://127.0.0.1:43120/dsh-research-cat/state` | `value.counts` 含 `papers/links/seeds/reference/citation/related`（+`earlier/later/author`）；`value.library` 含 `collections/recentlyFound/annotations/records/storePath/storeError` |
| H5 | `storePath` 位置 | 同上，看 `value.library.storePath` | `${DSH_HOME:-$HOME/.dsh}/research-cat/library.json`（本机 `/Users/depengwang/.dsh/research-cat/library.json`） |
| H6 | 库文件确实在写 | 面板里 Add 一篇后 `ls -l "$HOME/.dsh/research-cat/library.json"` | 文件存在、mtime 刚更新、`node -e "JSON.parse(require('fs').readFileSync(process.env.HOME+'/.dsh/research-cat/library.json'))"` 可解析 |
| H7 | 无 `storeError` | 面板顶部**没有**持久化警告条；`/state` 的 `library.storeError` 为 `null` | 警告条只在坏文件/不可写目录时出现 |

### 2.2 client 半边：侧栏与面板 UI

| # | 检查 | 期望 |
|---|---|---|
| C1 | 侧栏 occupant `registrant` | **`dsh-research-cat`**（若以 `dyn/` 开头，那是会话里的动态插件，不是本包） |
| C2 | 顶部标签页 | **Graph** 与 **Library** 两个标签可切换 |
| C3 | 布局切换 | `Radial` / `Timeline` 可切换；Timeline 下 X 轴为年份、Y 轴为被引数，`year=0` 的节点进入最左 “year unknown” 带 |
| C4 | 工具栏 | `Auto-expand` / `Re-layout` / `Clear` / `Filters` / `Export` 都在；`Clear` 只清图与系统 collection 成员（`counts.papers===0 && counts.seeds===0`），库内容保留 |
| C5 | 边类型开关 | 6 类边（references / citations / related / earlier / later / author）各有开关与可区分的颜色/线型；关掉某类后该类边不绘制 |
| C6 | 详情面板 | References / Cited by / Similar / **Earlier** / **Later** 五个按钮 + 作者名可点；笔记编辑框、标签输入、7 色选择（含“无颜色”） |
| C7 | Library 页 | 多层 collection 树（新建/重命名/删除/新建子 collection/存入/移除）、Recently Found 列表（多选→存入 collection、一键清空）、`Reset library`（二次确认） |
| C8 | 大图 | 节点多时整体自适应缩放（不重叠、不跑出画布），可 pan/zoom |
| C9 | 库文件位置可见 | 面板底部/“Export & storage”区显示库文件路径 |

### 2.3 host 日志

| # | 检查 | 怎么做 | 期望 |
|---|---|---|---|
| L1 | 启动无报错 | DSH 日志里搜 `dsh-research-cat` | 只有正常的挂载/注册行；**没有** `Error` / `failed to load` / `SyntaxError` / `ReferenceError` |
| L2 | 面板打开无报错 | 切到 Graph 与 Library、点几个节点、切一次 Timeline | 控制台/日志无新报错；`storeError` 为空 |
| L3 | 卸载路径干净 | （可选）退出 DSH 后再看日志 | 无 `flush` 相关异常（dispose 时会 flush 库） |

### 2.4 新能力逐项冒烟（面板或 agent 均可）

| 能力 | 冒烟步骤 | 期望 |
|---|---|---|
| 作者轴 | 面板点某篇作者名，或 `expand {id, kind:"author", authorId:"A..."}` | 图上出现 `author` 类型的边，作者作品被加入并按被引降序 |
| Earlier / Later | 详情面板点 `Earlier` / `Later`，或 `expand {id, kind:"earlier"|"later"}` | 只加入严格早于/晚于种子年份的论文；同年与缺年份不出现；空结果时给出可读提示而不是报错 |
| 多 seed（≤50） | Add 3 篇以上，点 `Auto-expand` | 全部种子都被展开（不是只前 6 个）；面板显示 added/failed/skipped；再次点 `Auto-expand` 不重复加节点（幂等） |
| 筛选 | 工具栏 `Filters` 设年份区间 / 期刊 / OA / 撤稿 / 最低被引 / 排序后搜索 | 结果减少；结果区显示“筛选前/后条数”；非法值（如年份反向）报可读错误 |
| 时间线视图 | 切 `Timeline` | X 按年份、Y 按被引；刻度可读；切回 `Radial` 不丢选中状态 |
| 多层 collection | Library 页建 A → 在 A 下建 B → 在 B 下建 C；把一篇存入 A 与 B | 树 3 层；同一篇在两个 collection 都可见；删 A 后子树消失但**文章仍在库**（Recently Found 或其它 collection 里能找到） |
| Recently Found | Add 一篇（不存入 collection）→ 看 Library 页顶部；再存入某 collection | 未存入时在 Recently Found 首位；存入后移出；从该 collection 移除后回归 |
| 笔记 / 标签 / 颜色 | 详情面板写笔记、加 2 个标签、选一个颜色 → 重启 DSH 再看 | 笔记/标签/颜色都在（库持久）；节点或列表上有颜色标记 |
| BibTeX 导出 | 工具栏 `Export`（当前 collection / 全部） | 浏览器下载 `.bib`；文件里条目数 = 导出条数；`title`/`year`/`author`/`doi`/`url` 正常，特殊字符已转义 |
| 持久化（库 vs 图） | 建好 collection + 笔记后重启 DSH | collection / 子 collection / Recently Found / 笔记标签颜色**都在**；**图是空的**（符合设计：边不落盘，展开任意条目即可重建） |

### 2.5 用户真实库未被测试污染

```bash
# 真实库指纹（跑任何测试前后应一致；测试套件是密封的）
node -e "const fs=require('fs'),c=require('crypto'),p=process.env.HOME+'/.dsh/research-cat/library.json'; try{const b=fs.readFileSync(p); console.log(b.length, c.createHash('sha256').update(b).digest('hex').slice(0,16), fs.statSync(p).mtime.toISOString())}catch(e){console.log('(absent)')}"

# 密封性由套件自证：末尾一行会打印真实库指纹，并有一条 seal 检查
cd /Users/depengwang/DSH/dsh-research-cat && node test/local.mjs 2>&1 | grep -E "seal:|real library fingerprint"

# 目录里若出现孤儿临时文件（硬退出留下）可安全删除：主文件始终完整
ls -la "$HOME/.dsh/research-cat/" | grep -E '\.tmp-|\.bak-'
```

- 仓库自带套件（`test/local.mjs` / `test/parity.mjs` / `test/client.mjs` / `lab/client-check.mjs`）**已密封**：`DSH_HOME` 指向 `os.tmpdir()`，且每个库都显式给 `storePath`。
- 本轮之前，未密封的 `test/local.mjs` 曾把测试数据写进真实库；该文件已被保留为 **`library.json.test-residue.bak`**（不是活动库）。活动 `library.json` 不存在时，插件会在首次写入时新建一个干净的库。
- 若你写自己的脚本：**必须**显式传 `storePath` 或先设 `DSH_HOME`，否则会写真实库（详见 README「测试必须隔离 storePath」）。

---

## 3. 已知环境限制（不是插件缺陷）

| 事项 | 现象 | 处理 |
|---|---|---|
| OpenAlex 无 key 免费预算按出口 IP 共享 | 预算耗尽时所有**真实联网**操作返回 HTTP 429（`retry-after` 指向午夜 UTC 重置）；面板联网操作报错，`test/local.mjs` 的 live 段按 spec §10.4 判 FAILED | 见 §3.1；离线与真实 HTTP 路由检查不受影响 |
| 手动 `link:` 安装 | 不热挂载，必须重启 DSH | 用应用内插件市场点装可热挂载（日志 `[dsh-market] hot-mounted`） |
| 多实例共享同一 `storePath` | last-writer-wins | 已登记为限制；不要同时开两个 DSH 写同一个库 |

### 3.1 live 段：环境受限，**当前窗口未通过**（deferred 取证）

> 这一节是**如实登记**，不是“已通过”。在配额受限窗口内跑 `node test/local.mjs` 时，26 项真实联网检查会 FAILED；这属于环境条件，不是实现、安装或文档缺陷。

**① 根因（实测数据）**

- 触发时间与现象：`2026-09-19 08:48:33Z` 起，对 `https://api.openalex.org/works?...&mailto=...` 的无 key 请求返回 **HTTP 429**；响应头 `retry-after: 54687`（≈15.2 h）、`x-ratelimit-remaining: 0`、`x-ratelimit-remaining-usd: 0`、`x-ratelimit-reset: 54687`。
- 机制：OpenAlex 对**无 API key** 的请求按**网络出口 IP 共享的免费日预算**计费；预算耗尽后该 IP 的全部请求被限流，直到 **午夜 UTC 重置**（本次约 `2026-09-20 00:00Z` = `08:00 CST`）。成员在同一出口上做过大量真实联网验证，是预算耗尽的直接原因。
- 影响范围：`node test/local.mjs` 的 **live 段 26 项**（`search reaches OpenAlex`、`AC-A5-2/3/4`、`addSeed`/`expand`/`details`/`removeSeed`/`clear`、`AC-A1-1..A1-4`、`AC-A3-1/2` 等）。实测输出：`131 PASS / 26 FAIL / 2 GAP`，`local: 26 check(s) FAILED`，exit 1。
- **不受影响**：离线段（Loader 契约 / 配置 / 持久化 / 分块 / 筛选 / 失败路径）、真实 HTTP 路由段、以及 `test/parity.mjs`（139/0）、`test/client.mjs`、`lab/client-check.mjs` 全部保持全绿；密封自证也照常 PASS（`seal: the user's real ~/.dsh/research-cat/library.json was neither created nor modified by this run`，`real library fingerprint: (absent)`）。
- **同一批 live AC 曾全绿**：`2026-09-19 08:11–08:13Z`（配额耗尽之前）t5 已采集 `node test/local.mjs` 全绿证据 `142 PASS / 0 FAIL / 1 GAP / exit 0`，含真实网络 AC-A1-1（`/authors` 4 个 A-id + author 轴 citedBy 单调不增）、AC-A1-2/3/4、AC-A3-1/2、AC-A5-2/3/4/7，并附 `test/local.mjs` 与真实库的前后 sha256（见 `test/AC-EVIDENCE.md` §2 与 `test/evidence/local-green.txt`）。因此当前只是**配额耗尽后的重跑**，不是证据丢失。

**② 配额恢复后的重跑方式**

```bash
# 0) 先确认配额已恢复（期望 http=200；429 表示仍在窗口内）
curl -s -o /dev/null -w "http=%{http_code}\n" \
  "https://api.openalex.org/works?search=graph%20neural%20networks&per-page=1&mailto=dsh-research-cat@localhost"

# 1) 重跑完整判据（期望末尾：local: all checks passed；exit 0）
cd /Users/depengwang/DSH/dsh-research-cat && node test/local.mjs; echo "exit=$?"

# 2) 只看 live 段与密封自证
node test/local.mjs 2>&1 | grep -E "AC-A1-|AC-A3-|AC-A5-|seal:|real library fingerprint|local:"

# 3) 若你的出口已接入自有 OpenAlex API key：把出口切到该通道后重复 1)，无需改动插件
#    （插件本身不需要 key；key 只影响 429 预算，属网络出口配置）
```

期望结果：`142 PASS / 0 FAIL / 1 GAP / exit 0`，且密封自证仍为 PASS、真实库指纹前后不变（或 `(absent)`）。

**③ 明确不写成已通过**

- 本清单与本次交付**不主张** live 段在当前窗口已通过：它的状态是 **deferred（环境受限）**。
- 在 `test/AC-EVIDENCE.md` 中，同一批 live AC 的状态是“**08:11–08:13Z 采集为 passed；当前配额窗口内重跑为 429**”，两者都如实登记，不互相替代。
- 配额恢复后请把 `node test/local.mjs` 的完整输出（含 `local: all checks passed`）追加到 `test/evidence/` 并在 `test/AC-EVIDENCE.md` 更新，作为 live 段恢复的收尾证据。
