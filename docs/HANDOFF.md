# CSPAPER 交接文档（2026-10-28，v0.19.3 已发布）

> 面向下一个接手本仓库的人（人或 agent）。记录现状、已做过什么、怎么验证、哪里还有已知风险。不预设优先级——路线取舍留给接手者与用户。

## 1. 项目是什么

CSPAPER：Electron 桌面文献管理软件，定位「更适合中国人的 Zotero + AI 科研工作台」。

- **Paper 模式**：文献库（卡片墙/PDF 阅读器/RAG 问答/对比表/纵览/知识五视图/统计/笔记/网页检索），视觉走中文水墨风（宣纸底、朱砂 accent、衬线标题、水墨八色图表）
- **Work 模式**：Codex 式科研 agent 工作台（计划-确认-执行、斜杠命令、技能、MCP、自动化定时任务）
- 技术栈：Electron 35 + electron-vite 3 + React 18 + TypeScript strict + better-sqlite3（FTS5）+ pdf.js + Vercel AI SDK（agent）+ 本地 e5 向量（混合检索 RRF）

仓库：`F:\SelfSoftware\cspaper\cspaper-main`（git root 在此，不是外层目录）。远程 `Jensen-Yao/CSPAPER`，最新 `main@3a541b3`，tag/release `v0.19.3`。

## 2. 怎么跑起来

```bash
cd cspaper-main
npm run dev        # 开发（应用即起）
npx tsc --noEmit   # 类型检查
npx electron-vite build
```

用户实际数据目录：`%APPDATA%/CSPAPER`（cspaper.db）。用户模型配置：Agnes 免费中转（api.agnes-ai.cn/v1，agnes-3.0-flash 文本 / agnes-image-2.5-flash 生图预留）。**API key 存放在用户机器 `D:\Desktop\bot\api\agnes\`，绝不能进仓库**（有 gitignore 与历史扫描双重防护，推送前建议再跑一次密钥扫描）。

## 3. 验证体系（接手后第一件事：跑这些）

```bash
node scripts/probe-css.mjs       # CSS 体系卡口（色相/圆角/字号/!important/transition 断言，防 UI 回潮）
node scripts/probe-dialogs.mjs   # 弹窗真实创建（标签/独立笔记落库）
node scripts/probe-full.mjs      # 全应用巡检 19 项（斜杠/详情/知识五视图/统计/笔记/网页/对话命令）
node scripts/probe-bugs.mjs      # 历史卡死回归（详情滚动/主题星系）
node scripts/probe-features.mjs  # 功能全链路 7 项（周报/查重/便签/集合/回收站/行内编辑/阅读器）
node scripts/probe-hl-edit.mjs   # 高亮全链路（真实拖选→编辑条→改色不误删）
node scripts/probe-model.mjs     # 模型页两级视图
node scripts/probe-occlusion.mjs # 遮挡扫描（10 屏 + 窄屏）
node scripts/e2e-agent.mjs       # agent 端到端（mock LLM，计划→执行→完成）
node scripts/ui-audit-full.mjs   # 13 屏截图（含深色轮）到 ui-audit/
```

全部应绿。probe-full 的「详情分区」检查偶发时序 flake，复跑即过。截图产物在 `ui-audit/`（已 gitignore，别提交）。

## 4. 版本史要点（v0.12→v0.19.3 的 47 个提交在 git log）

| 版本 | 主题 |
|---|---|
| v0.12 | Work 对标 ZCode 重写；流式去重 |
| v0.13 | UI 设计系统重建（图标库/CHART_8/tokens）；深度强化（图谱语义化 K-means、paper_extract 结构化精读、agent 工具升级、Zotero related/标注增强） |
| v0.14 | 水墨风 + Work Codex 风；CLI 斜杠命令框架 |
| v0.15 | 统计视图重做（词云螺旋/气泡压平/热力居中）；对比表修复；六角色评审第一轮 14 项 |
| v0.16 | Zotero 五主线（Word 域引文/增量同步+写回/元数据列/集合/保存搜索入库）+ 中期七项 |
| v0.17 | 三路复审 30 项修复（含 models:fetch IPC 从未注册、Key 被静默清空根因） |
| v0.19 | 功能 P0 四连修（prompt 全废/笔记哨兵/标签写回 md/高亮编辑）+ CSS 收口 + P1 静默失败 11 项 + 双验证门 |

## 5. 架构速览（改哪找哪）

```
src/main/
  db.ts          # schema/迁移/扫描 scanLibrary（含 md 四元组门控、回收站过滤、根掉线保护）
  agent.ts       # agent 循环（streamText+tools、推理等级 customFetch 注入、ReAct 兜底）
  insight.ts     # 结构化精读 extractPaper、综述 map-reduce、知识图谱（pvec 融合+K-means）、笔记哨兵读写
  ingest.ts      # 混合检索 hybridSearch（向量进程内缓存）、buildIndex、分块
  zotero-api.ts  # Web 同步（版本 upsert、标注写回）；zotero.ts 是本地 sqlite 导入（两文件不同！）
  translators.ts # 抓取脚本框架（13 内置，vm 沙箱已加固）
  llm.ts / embed.ts / csl.ts / cite-formats.ts / bridge.ts（HTTP 桥）/ mcp.ts
  ipc/           # papers/ai/eco/extra/agent/translators/cite/integrate/context
src/renderer/src/
  App.tsx        # 壳（Work 常挂载+pane-hidden、菜单、快捷键、浮动条）
  WorkbenchView  # Work（wb.css）；ChatView/PdfViewer/SidePanel/OverviewView/StatsView/KnowledgeViews
  Dialog.tsx     # 弹窗系统（prompt/confirm/toast）——原生 prompt 在 Electron 抛错，禁用
  Icon.tsx       # 唯一图标来源（细线 SVG）；chart-palette.ts 水墨八色；model-caps-presets.ts 模型能力预置
  slash.ts       # 斜杠命令表
  styles.css     # 全局（必须先于组件 css 加载——main.tsx 里顺序是修过的，别动）
```

数据事实源约定：**md frontmatter 是唯一事实源**（标签增删/元数据编辑都会写回 md；扫描再从 md 覆盖 DB；笔记区用 `<!-- cspaper:notes:start/end -->` 哨兵界定）。

## 6. 已知风险与未竟事项（仅记录，不排序）

- **CSS 收口是值级批量归一**，没逐屏设计复核；合并重复选择器只做了 top 几个（.side-tab×9 等仍有残留层叠）。衬线无 webfont，Windows 落 SimSun。内置浏览器首页仍是另一套棕渐变语言。
- **性能**：105 篇库实测 listPapers 2.1ms；万条库专项压测没跑完（electron ABI 问题），scanLibrary 仍全同步在主进程（worker 化在 ROADMAP）。
- **Work 模式定位**：产品评审一直质疑其与目标用户（中文科研人）的匹配；斜杠命令是极客向。降级为 Paper 内入口的方案在 ROADMAP 里，未决策。
- **Zotero**：写回仅高亮→annotation 子条目；远端删除不传播；多 collection 只取第一个建分类（其余进集合表）。
- **CSL**：citeproc 引擎按需静默下载（CPAL 许可不随包分发）；12 内置样式是手写近似。
- 未做：便签以外的标注类型、嵌套分类 UI（表已建）、独立笔记富文本、Word 换样式一键全文档重排的完整验证（代码在，缺真机 Word 实测）、iOS、云同步。
- 探针 flake 点：probe-full 详情分区（时序）、设置弹窗在 ui-audit-full 中靠 title 定位齿轮（勿改 title）。
- 三次「python 补丁静默失败」事故（read_paper/goal 注入/ChatView notice/高亮 onClick）——教训已写进提交信息：**凡脚本改码，改完必须 grep 验证落盘**。

## 7. 与用户的协作约定（经验性）

- 用户说「上传」= push + tag + GitHub release（本次已做：v0.19.3 release 已发布）。
- 用户习惯夜间连发指令驱动迭代；对 UI 极敏感（多次「太丑」），对过时信息零容忍（模型表必须 2026-10 现状）。
- 有效工作法已验证：多角色智能体评审（产品/UI/后端/美术/Zotero 工程师/用户六路）→ 量化清单 → 逐项修 → 探针卡口防回潮。
- 密钥安全：推送前扫 `git log -S` + 索引全量 grep（上次确认零泄漏）。

## 8. 当前应用状态

`npm run dev` 常驻在跑（最新构建 v0.19.3）。工作树干净，本地与远程一致。
