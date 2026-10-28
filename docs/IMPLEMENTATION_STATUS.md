# 当前实施状态（2026-10-29）

**结论：原十四节 / A—G、用户后续 7 项缺陷和总体架构-功能-UI-对话要求已闭环；0.20.0 已推送 GitHub，远端 CI 与 GitHub Pages 均通过。**完整逐项对照见 [PLAN_ACCEPTANCE.md](./PLAN_ACCEPTANCE.md)。

## 本轮核心变化

- **统一运行引擎**：全屏问答、阅读侧栏、任务对话、旧 Work、自动化、划词翻译和整页翻译进入同一套持久会话、事件、工具、审批、恢复和来源体系。
- **可溯源证据**：显式论文、PDF 选区、笔记、Web 来源、集合成员和题录条目都生成持久 Source；引用回跳保留页码与文本，并在来源版本变化时警告。
- **真实平台能力**：三文献比较、保存对比表、局限追加对应笔记、重启恢复会话/来源/笔记/对比表、继续追问的固定验收链路通过。
- **模型能力档案**：多服务商 profile+model 精确绑定；思考档位跟随模型并支持自定义；AI SDK v7 system/instructions 适配和真实 Agnes 传输通过。
- **数据边界**：当前 105 篇用户库副本被识别为 91 个生成题录页与 14 个真实 PDF；14 个 PDF 全部有 chunks。真实用户库未被写入。
- **Zotero 修复**：新增按 Zotero key 精确匹配的原文修复服务，替换前保留原 PDF 与 Markdown 备份，操作 ID 幂等，支持单篇和批量入口。当前 Zotero 磁盘没有额外可修复 PDF。
- **运行可靠性**：迁移 checksum、WAL 备份、失败迁移回滚/重试、文件和 DB 强制中断、窗口销毁、单实例、托盘恢复、工具超时、PDF 抽取取消、扫描取消和跨工作区索引隔离均有回归。
- **UI/品牌**：指定品牌图成为应用、安装器、插件和页面唯一源；标题栏/Work/网页检索/初始化向导统一；题录徽标筛选、可拖拽分栏、图谱缩放和主题星系交互完成。

## 本地验证记录

| 验证 | 当前结果 |
|---|---|
| `npm run typecheck` | 通过（含 tests 工程） |
| `npm run test:core` | 73 / 73 |
| `npm run build` | 通过 |
| `npm run test:ui` | 63 / 63，无 renderer 异常 |
| `node scripts/probe-css.mjs` | 圆角 17 档、字号 14 档、important 5、half-px 0、transition-all 0，全绿 |
| `node scripts/landing-test.mjs` | 首页/功能/下载截图与 demo 资源检查通过 |
| 生命周期 | 单实例、窗口销毁清理、文件/DB 强制崩溃、托盘恢复 |
| 真实模型 | Agnes 3.0 Flash / 2.5 Flash 严格 JSON；三文献任务 7 工具、3 笔记、1 对比表 |
| 用户库副本 | 105 篇 = 91 题录 + 14 PDF；14 PDF 均有 chunks；未修改原库 |
| `dist:win` | `CSPAPER Setup 0.20.0.exe` 生成成功，194,290,941 字节，SHA-256 `D4B01B048ADBFF001BB0C3F99EC8476F06BC214AAAD6B032611A36D2F6B39AAA` |
| Installer | 首装、启动、升级、二次启动、卸载、残留检查通过 |
| Packaged UI | `win-unpacked/CSPAPER.exe` 63/63 通过，无 renderer 异常 |
| 远端 GitHub | main `a11d2c7` CI 通过（verify + verify-installer）；GitHub Pages 构建通过 |
| 本地发布 | 完整 check、CSS/Pages 探针、真实模型、安装器、打包 UI 全部完成 |

## 发布状态

main 与 GitHub Pages 已更新；远端 CI 已通过。此次用户指令为推送 GitHub，未创建 tag/release。若后续要发布正式版本，在当前 CI 绿色基线上创建 `v0.20.0` tag 即可触发 Windows/macOS/Android release workflow。


## 证据

最新证据目录：`design-plans/execution-review-2026-10-29/`。`ci.json`、`installer.json`、`real-model.json`、`benchmark.json` 和 `ui-results.json` 已记录本机与远端验收结果。
