# GenericAgent Desktop fork main 整理实践报告

日期：2026-08-29

## 目标

在不改写既有功能分支、不修改版本号、不重建已跟踪 compiled dist 的前提下，将以下工作整理为可合入 fork `main` 的候选：

- Composer 图片和文件拖拽强化。
- 会话级聊天、transcript、草稿、附件和滚动状态隔离。
- fork `main` 后续加入的原生文件夹拖拽、图片显示、Mixin 图片降级和计时器修复。

## 分支与基线

- 最新审计时 fork `main`：`4a67226`（tag `desktop-portable-v0.2.8`）。
- 原功能基线：`e7bfb038b972c7cc5fda7134c777ef2df7ac222d`。
- 旧联合集成：`b5f3716128df9f8760d3a38e70d25a7c32d6ae8d`。
- main-ready 候选：`codex/desktop-next-phase-main-ready`。
- 已同步 upstream：`origin/main@7ad2162`。

候选从 `abraxas/main@4a67226` 创建，未直接移动或改写 `main`。

## 冲突与处理

旧集成与最新 fork `main` 在四处发生内容冲突：

1. `Composer/index.tsx`
2. `composer-attachments.test.tsx`
3. `AssistantMessage.tsx`
4. `stores/chat.ts`

处理原则：

- 会话运行态采用 `sessionsById`，消息、流式片段、队列、模型和计时器均归属具体 session。
- sidebar 计时器直接读取对应 session 的 `turnStartedAt`，保留切换会话后继续计时的最新行为。
- Composer 保留统一 ingestion、失败重试、稳定 attachment ID 和 session 草稿/附件隔离。
- 正式 Tauri 包继续使用最新 main 的 native drag/drop 绝对路径能力，支持文件夹和图片预览。
- 浏览器和组件测试继续保留 HTML5 `DataTransfer.files` 路径；Tauri native handler 与 DOM handler 不会重复处理同一次正式包拖拽。
- Mixin 会话继续把具有真实磁盘路径的图片降级为路径文本。
- Assistant action bar 保留每轮执行耗时。

## 当前自动验证

| 检查 | 结果 |
| --- | --- |
| TypeScript | `npm run typecheck` 通过 |
| 定向回归 | 4 个文件、33 个测试通过 |
| 全量前端单测 | 57 个文件、438 个测试通过 |
| E2E 类型 | `npm run test:e2e-types` 通过 |
| CI 契约 | `npm run test:ci-contract` 通过 |
| Python bridge | 274 个测试通过 |

全量前端测试需要本机 loopback 权限；受限沙箱中的 `listen EPERM` 属于测试环境限制，允许回环网络后全部通过。

## 尚待门禁

- Rust/Tauri 检查和 GitHub 三平台 runner。
- runner 产出的 macOS/Windows 真包执行 transcript 展开、离开、返回测试。
- macOS Finder 与 Windows Explorer 拖拽截图或录像证据。
- 所有门禁通过后，才通过 PR 合入 fork `main`。

## 发布约束

- 未修改版本号。
- 未重新生成或提交 compiled dist。
- 未改写 `codex/composer-file-drag-drop`、`codex/session-scoped-chat-state` 或旧集成分支。
- 未直接修改 fork `main`；所有整理工作位于隔离候选分支。
