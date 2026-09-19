# Research Cat × Research Rabbit 逐项对照

- **对照对象**：本仓库 `dsh-research-cat`（本轮 RR 对齐版）vs Research Rabbit（官网 + 帮助中心，2026-09 核对）
- **判据来源**：`docs/rr-parity-spec.md`（冻结验收规格）、`docs/rr-parity-design.md`（实现设计）、`test/AC-EVIDENCE.md`（逐条 AC 证据）
- **阅读方式**：第 1 节是**已对齐**（有 AC 与自动化证据），第 2 节是**已实现但有意与 RR 不同**，第 3 节是**待用户拍板**，第 4 节是**明确排除**。

## 0. 一句话结论

本轮把 RR 免费档里**可离线/可单机验证**的部分做到了对齐：六条探索轴（含作者轴、Earlier/Later）、≤50 种子与多 seed 合并展开、基础筛选、径向图 + 时间线视图、多层 collection、Recently Found、笔记/标签/颜色、BibTeX **导出**、以及本地持久化库。
**没有做**的部分全部集中在需要账号体系、服务端、第三方 OAuth、第二个数据源或长期行为数据的场景（导入、Zotero、协作、云端库、多数据源、学习型推荐、RR+ 高级检索、移动端），这些在第 3 节逐条列出前置条件，等用户拍板。

## 1. 已对齐（本轮做，且有可复现证据）

| RR 编号 | RR 功能 | 本轮实现 | 与 RR 的对应关系 | 证据 |
|---|---|---|---|---|
| RR-01 | 种子检索（免费档 ≤50） | 种子上限 50；`addSeed` 第 51 个被拒绝并提示上限；搜索 50 条/页 | 对齐免费档的 ≤50 | AC-A2-1、AC-A5-1、AC-A5-2 |
| RR-02 | Citations / References / Similar / **作者** 四条探索轴 | `expand kind` = `references` / `citations` / `related` / `author`（+ `earlier` / `later`）；作者轴按 `author.id` 取该作者作品、被引降序；`author.id` 为 `null` 时按 ORCID 解析 | 对齐四条轴；作者轴输出的是作品列表而非 RR 的“作者地图”可视化（见 §2.4） | AC-A0-2、AC-A1-1..A1-5、AC-A5-3、AC-A5-4 |
| RR-03 | Earlier / Later Work 时间轴 | `earlier` = 该篇 references 中 `year < 种子年份`；`later` = 施引文献中 `year > 种子年份`；严格不等，同年与 `year=0` 不计入 | 对齐 RR 新版“Refs/Cited by + 时间约束”的解释 | AC-A3-1..A3-4、AC-A3-6 |
| RR-04 | 引用图 | 径向布局（hub 居中 + BFS 分层 + 角色扇区）+ 时间线布局；6 类边各有颜色/线型与开关；大图自适应 viewBox 且节点不重叠 | 对齐“可视化文章如何连接” | AC-A0-5、AC-A6-1..A6-7、`lab/client-check.mjs` |
| RR-05 | 多层 Collections / Subcollections | 任意深度子 collection；一篇文章可属多个 collection；删除 collection 级联删子树但**不删文章**；`itemCount` / `itemCountDeep` | 对齐；RR 的“分享子 collection”属 C3（未做） | AC-B2-1..B2-9 |
| RR-06 | Recently Found 暂存区 | = 进过图但未存入任何用户 collection 的文章；存入移出、移除回归；上限 500 | 对齐“探索 vs 组织”的分工语义 | AC-B3-1..B3-7 |
| RR-08（导出部分） | BibTeX 导出 | `/export {format:"bibtex"}` 与工具 `export`：类型映射固定、key 唯一确定、两次导出 byte-identical、LaTeX 转义、非 ASCII 保留 | 只做**导出**；**导入**属 C1（未做） | AC-A7-1..A7-10 |
| RR-09 | 笔记 / 贴纸 / 颜色 | 每篇一条笔记（≤10000 字符）、标签（≤20×≤40，去重保序）、7 色固定枚举 + 无颜色；支持部分更新 | 对齐 notes / labels / colors；**不做**“贴纸”图形与阅读状态（C9） | AC-B4-1..B4-9 |
| RR-14（基础筛选） | 筛选 | 年份闭区间 / 期刊子串 / 开放获取 / 撤稿 / 最低被引 / 排序；所有轴语义一致；`found`/`considered` 如实上报 | 只做 OpenAlex 原生可支撑的维度；SJR 分区、期刊 H-Index、关键词过滤属 C7（未做） | AC-A4-1..A4-9 |
| RR-15 | 时间线视图 | X = 年份、Y = 被引数；`year=0` 单独“year unknown”带；轴刻度 | 对齐官网“X 轴=时间 / Y 轴=影响力” | AC-A6-2..A6-5 |
| RR-16 | 筛选（面板） | 工具栏 `Filters` + 结果区“筛选前/后条数” | 对齐基础筛选 UI | AC-A4-9 |
| —（团队补充 B 档） | 持久化库 | `${DSH_HOME:-$HOME/.dsh}/research-cat/library.json`；原子写 + version + 坏文件/高版本 → `.bak` + 空库 + `storeError`；库持久、图临时 | RR 的“数据随时回到你离开时的样子”的**本地单机**对应物（非云同步） | AC-B1-1..B1-9 |

### 1.1 自动化证据怎么跑

```bash
node test/parity.mjs        # 冻结 spec 的 AC 判据（139 项，离线优先）
node test/local.mjs         # host 全链路（含真实 OpenAlex 段；配额耗尽时该段按 spec 判 FAILED）
node test/client.mjs        # client 布局与面板（38 项）
node lab/client-check.mjs   # 面板自检：Loader 契约 + @parity 纯函数 + 真实渲染（91 项）
```

AC → 状态 → 证据的完整对照表在 `test/AC-EVIDENCE.md`。

## 2. 已实现但与 RR 有意不同

| 项 | RR 的做法 | 本插件 | 为什么 |
|---|---|---|---|
| 1. 存储 | 账号 + 云端库，跨设备同步 | 本地单文件 JSON（`library.json`），库持久、图临时 | 无账号体系（C4）；引用边可随时由 OpenAlex 重算，落盘只会带来陈旧边与体量 |
| 2. 数据源 | Crossref + Semantic Scholar + OpenAlex 三源聚合 | 只 OpenAlex，带 `mailto` polite pool | 跨源去重/引用边语义合并需要额外设计（C5） |
| 3. 排序 | 官方称排序固定、不可调 | `sort` 可选 `cited`（默认）/ `year`，其余维度用筛选 | 本轮把“可解释、可判定”放在“模仿固定排序”之前；默认与 RR 的“按连接/被引”一致 |
| 4. 作者轴呈现 | 点作者名 → 该作者的**作者地图**（可视化 + 按年/关键词筛选） | 点作者名 → 该作者作品进入同一张引用图，边类型 `author`；可按年筛选 | 独立作者地图需要另一套布局与状态，本轮以“同图 + 可区分边”达成可验收对齐 |
| 5. 配额 | 免费档 50 seeds；RR+ 300 seeds | 50 seeds；全部配额键可配置（`maxBatch` 100 / `maxCitations` 100 / `maxNodes` 1000） | 对齐免费档；300 seeds 属 C7 |
| 6. 多 seed 展开 | 迭代式“hops”，每次由用户挑选 | `Auto-expand` 一次展开全部种子（≤50）× 选定轴，失败隔离 + 幂等 | “hops 导航历史”属 UI 增强（spec §9 已登记为不设独立 AC） |
| 7. 图上限 | 未公开硬上限 | 1000 节点，到顶拒绝展开并提示 Clear | 保护进程内存与 OpenAlex 预算；可配置 |
| 8. 撤销/冲突 | 服务端权威 | 单实例串行写；多实例共享同一文件时 last-writer-wins（不加锁） | 单机插件的合理边界，已写入 README 限制 |

## 3. 待用户拍板（默认不纳入本轮）

> 规则（spec §8）：下列各项在用户明确拍板前**不得实现**；拍板后需先补 A/B 编号与 AC，再走实现流程。前置条件是开工的最小条件，缺一不可。

| 编号 | 功能 | RR 依据 | 前置条件 | 建议档位 |
|---|---|---|---|---|
| C1 | BibTeX / RIS / CSV **导入**（含拖拽上传、按条目选择） | S5,S11,S15,S18 | ① 文件上传/读取通道 ② BibTeX+RIS+CSV 解析器与字段映射 ③ 去重策略（DOI→标题归一）④ 与 C2 共用通道避免两套解析 | 先做 BibTeX 导入（最小闭环），RIS/CSV 延后 |
| C2 | Zotero 导入（OAuth、按 collection 选择、单向导入） | S5,S12,S23 | ① 第三方 OAuth 客户端与回调地址（本地插件无公网回调）② Zotero API key 本地安全存储 ③ 用户确认“单向导入 + BibTeX 回写” ④ 网络出口策略 | 独立一轮 |
| C3 | 分享与协作（公开链接、Editor/Viewer、共享子 collection） | S5,S10,S11,S22 | ① 账号体系 ② 服务端存储与权限模型 ③ 多用户同步与冲突解决 ④ 链接访问控制与撤销 | 独立一轮（跨仓库） |
| C4 | 账号云端库（登录、云同步、跨设备） | S3,S19 | ① 账号体系 ② 后端存储 ③ 同步冲突解决 ④ 隐私与数据归属说明 | 独立一轮 |
| C5 | 多数据源聚合（Crossref + Semantic Scholar + OpenAlex） | S9,S19 | ① 各源鉴权与速率策略 ② 跨源去重合并 ③ 引用边语义合并与来源标注 ④ 覆盖率/冲突的可解释策略 | 独立一轮（数据模型需预留 `source`） |
| C6 | 学习型推荐（从选择中学习并改进排序） | S1,S2,S8,S21 | ① 账号级或本地长期行为数据 ② 特征/排序管线与离线评估集 ③ 隐私与可解释性说明 ④ 与“排序固定”现状对齐的口径 | 独立一轮（先定义评估指标） |
| C7 | RR+ 高级检索（关键词/短语过滤、SJR 分区、期刊 H-Index、OA PDF、撤回状态、300 seeds、多项目） | S6,S7,S8 | ① SJR/H-Index 的第三方数据源与许可（OpenAlex 无此字段）② 300 seeds 的速率与图上限策略 ③ 与基础筛选的 UI 分层 ④ 若涉付费墙需产品决策 | 拆两批：关键词过滤（易）→ 分区/H-Index（难） |
| C8 | 移动端 / 浏览器插件 | S23（仅第三方连接器） | ① 用户确认形态（扩展 / 移动 Web / PWA）② 浏览器扩展无法由 DSH 插件承载，需另立仓库与发布通道 ③ 移动端需定义面板响应式改造范围 | 待用户定义形态 |
| C9 | 阅读状态 / Reading Lists（To Read / Later / Up Next / Skimmed / Read Fully / Understood） | S23,S24 | ① 与 B4 标签体系的关系（独立字段 vs 特殊标签）② “未保存即标记自动入库”的行为确认 | 若需要，可小步并入 B4 |
| C10 | 复制引文（按引用样式） | S11 | ① CSL 样式引擎与样式选择 UI ② 样式库许可 | 低优先，可并入 A7 导出家族 |
| C11 | Signals 学术风险指标 | S25 | ① 撤稿/期刊风险数据源（OpenAlex 仅有 `is_retracted`）② 指标口径与免责说明 | 与 C5 数据源议题合并 |

本轮对 C 档的验收判据是**排除式**的：AC-C-1 断言代码/路由/工具 action/面板入口中不存在任何 C 档功能的入口、字段或分支（host 侧 grep 词表 + 冻结路由表 + 冻结 action 枚举），AC-C-2 断言前置条件已登记（即本节）。

## 4. 明确排除（本轮不做，也不作为待决策项）

| 编号 | 排除项 | 理由 |
|---|---|---|
| X1 | RR+ 订阅计费、国家折扣、Institution 版（LibKey、用户管理、用量统计） | 纯商业/机构侧能力，与本地插件形态无关 |
| X2 | 服务端托管形态与 SaaS 化 | 本插件是 DSH 进程内插件，不做独立后端 |
| X3 | 教学与督导资料、教程视频、社区内容 | 内容型资产，非功能 |
| X4 | 多语言 UI / 浏览器翻译引导 | 依赖浏览器能力；面板保持现有中英文文案 |
| X5 | Multiple Projects（RR+ 的独立工作区） | 多层 collection 已覆盖组织需求；若要独立项目概念转 C |
| X6 | Autosave 开关（种子自动存入指定 collection） | Recently Found 已覆盖“不丢失” |
| X7 | 图导出的图片/截图分享 | 浏览器截图即可满足 |

## 5. 来源（逐条抓取核对，2026-09）

| 代号 | 来源 | URL |
|---|---|---|
| S1 | 官网首页 | https://www.researchrabbit.ai/ |
| S2 | Features | https://www.researchrabbit.ai/features |
| S3 | Pricing | https://www.researchrabbit.ai/pricing |
| S4 | 帮助中心首页 | https://learn.researchrabbit.ai/en/ |
| S5 | Free Tier | https://learn.researchrabbit.ai/en/articles/12865509-researchrabbit-free-tier |
| S6 | What is RR+ | https://learn.researchrabbit.ai/en/articles/12454495-what-is-researchrabbit |
| S7 | Advanced Search filters in RR+ | https://learn.researchrabbit.ai/en/articles/14531882-using-advanced-search-filters-in-rr |
| S8 | Search algorithm | https://learn.researchrabbit.ai/en/articles/12875619-what-s-behind-researchrabbit-s-search-algorithm |
| S9 | The ResearchRabbit Database | https://learn.researchrabbit.ai/en/articles/12454605-the-researchrabbit-database |
| S10 | Organizing with Collections | https://learn.researchrabbit.ai/en/articles/12454600-organizing-your-articles-with-collections |
| S11 | Share papers and collections | https://learn.researchrabbit.ai/en/articles/13192798-how-to-share-papers-and-collections |
| S12 | Zotero Importer | https://learn.researchrabbit.ai/en/articles/12796541-using-the-zotero-importer |
| S13 | Earlier Work | https://learn.researchrabbit.ai/en/articles/12454543-how-do-i-search-earlier-work-in-the-new-researchrabbit |
| S14 | Later Work | https://learn.researchrabbit.ai/en/articles/12454547-how-do-i-search-later-work-in-the-new-researchrabbit |
| S15 | Similar Work | https://learn.researchrabbit.ai/en/articles/12454538-how-do-i-search-similar-work-in-the-new-researchrabbit |
| S16 | Citations & References | https://learn.researchrabbit.ai/en/articles/12454564-how-do-i-see-citations-and-references-in-the-new-researchrabbit |
| S17 | Explore authors | https://learn.researchrabbit.ai/en/articles/12439865-how-to-explore-authors |
| S18 | How to search | https://learn.researchrabbit.ai/en/articles/12454528-how-to-search-in-researchrabbit |
| S19 | Welcome to the new RR | https://learn.researchrabbit.ai/en/articles/12440130-welcome-to-the-new-researchrabbit |
| S20 | Getting started | https://learn.researchrabbit.ai/en/articles/12439939-how-to-get-started-with-researchrabbit |
| S21 | Introduction | https://learn.researchrabbit.ai/en/articles/12454456-introduction-to-researchrabbit |
| S22 | Build a citation map | https://www.researchrabbit.ai/articles/build-citation-map-with-researchrabbit |
| S23 | Organize papers | https://www.researchrabbit.ai/articles/how-to-organize-research-papers |
| S24 | Reading Lists | https://learn.researchrabbit.ai/en/articles/15890653-track-your-reading-with-reading-lists |
| S25 | Signals | https://learn.researchrabbit.ai/en/articles/15888747-exploring-article-risk-with-signals-indicators |

**来源勘误**：帮助文档多处把 RR+ 高级检索指向 `…/articles/12454601-advanced-search-with-rr`，该 URL 实测 **HTTP 404**；可用页为 S7（`14531882`）。本对照表以 S7 为准。

## 6. 已知差异与残留风险（不影响本轮 AC）

| 编号 | 事项 | 影响 | 状态 |
|---|---|---|---|
| R1 | 单文件 JSON 在 >2 万条时全量读写变慢 | 体验 | 已设上限保护（20000 records / 40000 memberships）；突破需 SQLite（新依赖）→ 待决策 |
| R2 | 两个 DSH 实例共享同一 `storePath` → last-writer-wins | 数据 | 已登记为限制；加锁或分文件属额外工作量 |
| R3 | `earlier` 在超长参考文献列表上只取前 `maxBatch` 条（欠采样） | 完整性 | 响应带 `truncated`；全量采样待决策 |
| R4 | 面板不引入日期选择器/取色器/图表库（用原生 input + 色点） | 观感 | 引入库 = 新依赖 → 待决策 |
| R5 | 库文件含用户笔记（隐私） | 隐私 | 文件在用户 home 下、权限 0600；不做云同步（C4） |
| R6 | `records` 里的元数据会随 OpenAlex 更新而过期 | 正确性 | 复用 `details` 刷新；不自动后台刷新 |
| R7 | 多 seed 径向布局与 `9a1bd7d` 的逐字节基线只对“缺陷不可能触发”的输入成立 | 回归判据 | 有意放宽并冻结 post-t10/post-t11 摘要，理由写在 `src/client.js` 与两套测试头部 |
| R8 | 面板未显示“本次展开的种子数”（只显示 added/failed/skipped） | 观感 | AC-A2-7 记为 gap，未伪装通过（`test/AC-EVIDENCE.md`） |
