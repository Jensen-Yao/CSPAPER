# 前置计划与用户新增要求验收（2026-10-29）

本文是对原十四节 / A—G 计划、用户随后补充的 7 个实际缺陷、总体架构功能 UI 要求和发布层要求的逐项审阅。原则：没有代码、测试和可追溯证据就不标记完成；用户真实库只读诊断或使用副本验证，不做未授权写入。

## 结论

**本地实现与本地验收已闭环，可进入发布前最后构建与 GitHub 推送准备。** GitHub Actions 远端 CI 是推送后的发布门禁；若 CI 失败，不创建 tag/release。Zotero 原始库中当前没有额外可修复 PDF：46 条 PDF 附件记录里仅 14 个文件存在，而这 14 个已作为当前库 PDF 导入；剩余条目在 Zotero 磁盘上也没有可读原文，因此只能保留题录并等待用户补齐附件。

## 一、原十四节逐项验收

| 节次 | 要求 | 当前证据 |
|---|---|---|
| 1 固定基线 | 类型、构建、取消、窗口销毁、单实例、崩溃恢复先验收 | `npm run check` 曾完整通过；本轮后续改动继续跑 typecheck/core/build/UI；生命周期脚本覆盖单实例、请求清理、文件/DB 强制中断、托盘恢复。 |
| 2 共享契约 | `src/shared/*` 定义会话、IPC、上下文、工具、来源、模型 | `chat.ts`、`chat-ipc.ts`、`context.ts`、`tools.ts`、`sources.ts`、`models.ts` 均存在；渲染端和主进程复用共享模型与校验。 |
| 3 可追踪迁移与持久会话 | checksum 迁移、WAL 备份、会话/消息/运行/事件/来源/产物落库 | 8 个迁移；重复初始化、WAL、checksum 漂移、迁移语句失败回滚与可重试均有核心回归。 |
| 4 唯一运行引擎 | ask/act/翻译/自动化共用提交、排队、取消、恢复、审批 | `chat/runtime.ts` + `events.ts` + `recovery.ts` + `legacy-agent.ts`；同会话串行、跨会话并行、中断恢复、计划修订、审批和真实工具写入已测。 |
| 5 模型适配 | profile+model 精确绑定、能力、推理参数、凭据不落会话 | `model-config.ts`、`models/provider.ts`、`models/capabilities.ts`；同名模型跨服务商测试、AI SDK v7 instructions 适配、Agnes 真实传输通过。 |
| 6 上下文与来源 | 显式对象、来源版本、页码、选区、预算、取消 | `context.ts`、`retrieval.ts`、`citations.ts`、集中 `prompts.ts`；题录元数据 Source、集合题录 Source、PDF 选区、版本变化提示、抽取取消/超时已测。 |
| 7 统一工具 | registry/executor/policy/service 化、UI 与模型共用水路 | `tools/*`、paper/note/collection/comparison 服务；MCP 入统一执行器；审批、幂等、超时、取消后不写入已测。 |
| 8 写入恢复 | 操作日志、备份、幂等操作 ID、恢复状态 | `operations/journal.ts` 支持文本和二进制原子替换；文件替换前后、DB 提交中断、Zotero PDF 修复幂等均测试。 |
| 9 IPC 重放 | snapshot/subscribe/submit/cancel/approve/retry/edit | `ipc/chat.ts` + preload 结构化 API；WebContents 定向事件、游标补发、会话归属校验和 renderer reload 测试。 |
| 10 三入口共享组件 | full/sidebar/task 共用组件与 store | `features/chat/*`；长会话虚拟滚动、分页、新消息不抢阅读位置、GFM/KaTeX/代码渲染测试。 |
| 11 平台嵌入 | 阅读、笔记、对比、检索、Web、产物均可进入统一对话 | 三文献固定验收链路通过：比较、引用回原文、保存对比、追加三篇笔记、重启恢复、继续追问。 |
| 12 全软件作用域 | 工作区隔离、扫描线程化、索引隔离、样式与窄窗 | library worker 分批对账并支持进度/取消；重建当前库不再清空其他工作区索引；统计/相关/移动端查询限定 active papers；CSS 门槛与窄窗 UI 测试通过。 |
| 13 测试体系 | 主进程 Electron 测试、UI 真实渲染、CI、发布前检查 | 当前 core 73/73、UI 63/63；`ci.yml` push/PR 验证，release 先 verify 再构建；probe CSS 与 Pages landing 测试通过。 |
| 14 A—G | 每包代码+测试+记录 | A—G 全部见下表。 |

## 二、A—G 出口

| 包 | 出口 | 结果 |
|---|---|---|
| A 验收当前改动 | 类型/构建/回归通过，未验证项有结论 | 通过；新缺口均继续补齐后复测。 |
| B 契约与持久化 | 会话、工作区、分支落盘 | 通过；repository/persistence/workspace 测试。 |
| C 运行与模型 | 不串流、可停止、绑定正确 | 通过；runtime/provider/model 测试和真实 Agnes。 |
| D 上下文与工具 | 原文可核实、真实平台结果 | 通过；来源版本、题录边界、工具审批与产物测试。 |
| E 三入口 | 界面切换不丢运行 | 通过；renderer reload 和三入口共享 store 测试。 |
| F 平台集成与 UI | 完整科研任务连续完成 | 通过；固定三文献链路、窄窗、分栏、图谱缩放测试。 |
| G 性能与交付 | 大库/长会话响应，真实模型任务 | 本地通过；最新完整 check 与 0.20 打包结果见实施状态。远端 CI 是推送后的 tag/release 前置门禁。 |

## 三、用户补充的 7 个缺陷

| # | 反馈 | 闭环方式 |
|---|---|---|
| 1 | “问这篇论文”识别不到论文 | 显式 paper context 不再退化成 JSON ID：题录生成可引用元数据 Source；PDF 无 chunks 时首页/元数据兜底；prompt 明确题录不得推断全文结论；侧栏显示证据边界。 |
| 2 | 105 篇文献大量 `CSPAPER·文献题录`，原 Zotero 文献去哪了 | 结论：不是丢失。真实库副本迁移识别为 **91 个生成题录页 + 14 个真实 PDF**；14 个 PDF 均有 chunks。UI 提供“原文/题录”徽标和筛选；新增 Zotero key 精确修复、原文件备份、操作幂等和批量入口。当前 Zotero 磁盘没有额外可修复 PDF。 |
| 3 | 右侧小按钮都跳对话 | 未打开 PDF 时只有“问答”进入 chat，其余保持文献首页并提示先打开文献；打开后竖轨切回阅读区并展开对应侧栏。 |
| 4 | 思考强度固定几档 | `thinkingLevel` 改为字符串；思考档跟随当前模型 `reasoningLevels`，支持 none/minimal/xhigh/max 和自定义；对话、阅读侧栏、Work、设置一致。 |
| 5 | 各栏模块化和左侧拖拽条 | 新增可复用 `ResizeHandle`，文献栏/助手栏/引用栏支持拖拽、键盘、双击/Home 复位和持久化；窄窗助手 overlay 保持阅读优先。 |
| 6 | 纵览图不能滚轮缩放 | 相似网络、关键词共现、作者合作和主题星系均支持鼠标滚轮缩放、空白拖拽/平移、百分比和重置。 |
| 7 | 详情提取提不出来 | 题录条目禁用深度精读并说明原因；PDF 索引缺失显示“索引缺失”和重建入口；抽取错误保留具体信息；PDF 抽取取消/超时不再被兜底吞掉。 |

## 四、总体“架构、功能、UI、对话”要求

- **架构**：统一 Runtime、共享契约、持久事件、操作日志、服务化业务和 workspace 作用域已落地；旧 `agent.ts` 是兼容门面，旧 LLM API 保留兼容但渲染端已不再依赖。
- **功能**：阅读、翻译、问答、集合上下文、多文献对比、笔记、Web 来源、产物导航、Zotero 修复和真实模型工具链可连续使用。
- **UI**：品牌一源多出口、题录状态可见、分栏可控、图谱可缩放、窄窗可读、深浅主题与长会话虚拟列表通过真实 Electron 回归。
- **对话可用性**：与 Codex 式工作台的差距不可能一次消除，但本轮把“能执行、可审批、可恢复、可引用、可继续追问”的核心科研任务链路打通，并用 mock + 真实 Agnes 验收。

## 五、边界与后续路线

这些不是本轮阻塞项，已在 ROADMAP/状态文档中保留：更多真实服务商矩阵、macOS/Android 真机发布验证、Zotero 附件补齐后的实际修复、Word/WPS 真机样式矩阵、CNKI 深度适配、iOS/WebDAV。推送后若 GitHub Actions 或远端发布检查失败，tag/release 保持阻塞并回滚修复。
