# GenericAgent Desktop upstream #787 fork 集成报告

日期：2026-08-30

## 目标与结论

本轮将 upstream `lsdefine/GenericAgent#787` 纳入 fork 历史，同时保持
`abraxas914/GenericAgent` 作为 React Desktop 2.0 源码权威仓库。

集成结论：fork 在 #787 涉及的源码、bridge、Tauri、安全与发布能力上已经是其超集。
合并应记录 upstream 祖先并保留 fork 源码实现，但不得把基于旧源码提交构建的 compiled
`dist` 当作当前 fork renderer。

## 基线

- fork 基线：`abraxas/main@ec8b2ef711320013abcecfcaacd07c96cd6f7d2f`
- upstream 基线：`origin/main@efb3bc6ad1db0d7a82dce9eb38aacdf954286513`
- upstream PR：`lsdefine/GenericAgent#787`
- #787 renderer 源码：`abraxas/main@4a67226e18cb003db1210357ea4a283774773acc`
- 集成分支：`codex/upstream-787-integration`

`4a67226` 是 fork #36 的祖先。#36 和 #37 在其后分别加入会话级 transcript/附件状态实现、
回归验证，以及状态管理架构与代码规范。

## 能力对照

| #787 交付项 | fork 集成前状态 | 处理 |
| --- | --- | --- |
| Desktop metadata `0.2.1` | npm、Cargo、Tauri、qualification 已统一为 `0.2.1` | 保留 fork |
| macOS `macos-26`、Xcode 26.5、SDK 26.5 固定 | workflow 和 CI contract 已覆盖 | 保留 fork |
| `/services/capabilities` | bridge、frontend service、Python 测试已存在 | 保留 fork |
| `/upload/raw` 安全跨站资源读取 | allowlist、Fetch-Dest 校验和测试已存在 | 保留 fork |
| `/drop/stat`、文件夹和图片 native drop | bridge、frontend ingestion 和测试已存在 | 保留 fork |
| turn start 与 `executionMs` | bridge、renderer 和测试已存在 | 保留 fork |
| macOS 原生标题栏指标 | 已存在，且 fork 额外具有原生截图验收命令 | 保留 fork 超集 |
| compiled renderer | #787 为 `dist@4a67226` | 不引入 fork；当前源码构建时生成 |
| compiled-only verifier | 只适用于 upstream 提交边界 | 不引入源码型 fork |
| session transcript 状态修复 | #787 不包含，fork #36 已完成 | 保留 fork |
| 状态管理架构/spec | #787 不包含，fork #37 已完成 | 保留 fork |

## 冲突处理原则

### 源码文件

`index.html`、`loading.html`、`setup.html`、完整 `package.json` 和 Tauri 的
`beforeBuildCommand`/`beforeDevCommand` 属于 fork 源码开发链。upstream #787 的对应文件是
compiled-only 包装入口，不能覆盖 fork 的 Vite、TypeScript、Vitest 和 E2E 配置。

### Bridge、Tauri 与安全能力

对 #787 的具体 patch 逐项检查。fork 已具有所有能力，并额外包含后续验收和测试支持，因此保留
fork 版本。没有丢弃 upstream 独有的运行时或安全行为。

### compiled dist

fork 的 `frontends/desktop/.gitignore` 将 `dist/` 定义为生成目录。#787 跟踪的 dist 来自
`4a67226`，早于 #36 的 session state 和 attachment ingestion。若将其带入 fork，会形成
“最新源码 + 旧 renderer”错配。

本轮使用当前 fork 源码实际执行 `npm run build` 和 `npm run test:bundle` 验证生成结果，但不跟踪
生成目录。下一次向 upstream 交付 compiled renderer 时，必须从届时已验收的 fork `main` SHA
重新生成，并更新 `build-provenance.json`、manifest SHA-256 和 upstream compiled-only verifier。

## 集成时附带修正

macOS 上以 `cargo clippy --all-targets --all-features -- -D warnings` 检查时发现标题栏指标与截图
命令各有一个 `needless_return`。将两个 cfg 分支改为尾表达式；返回值、错误传播和平台条件均不变。

首次 fork PR preflight 还暴露出旧 CI 边界把整个 `.trellis/**` 视为本地临时目录，而 #37 已正式
跟踪 `.trellis/spec/**/*.md`。边界现改为只允许 Trellis 规范 Markdown，继续拒绝 `.agents/**`、
`.codex/**` 以及 `.trellis` 下其他运行时文件；`verify-ci-contract.mjs` 同步锁定这条规则。

## 验证结果

| 层级 | 结果 |
| --- | --- |
| TypeScript | `npm run typecheck` 通过 |
| 前端单元测试 | 57 个文件、438 个测试通过 |
| E2E 类型 | `npm run test:e2e-types` 通过 |
| CI contract | 通过 |
| packaging contract | PASS 81、FAIL 0、WARN 1；本机无 `pwsh`，跳过 PowerShell parser |
| 当前源码 build | Vite build 通过 |
| bundle contract | 17 个 JS、14 个 CSS，约 4271 KB，完整性检查通过 |
| 浏览器 E2E | 2 个 spec、11 条 journey 通过，包括双 running session 20 次切换 |
| Python bridge | 274 个测试通过 |
| Rust format | `cargo fmt --check` 通过 |
| Rust clippy | all targets/all features，`-D warnings` 通过 |
| Rust tests | 默认与 `e2e` feature 各 23 个测试通过 |

前端、Python 和 Rust 各有少量测试需要绑定本机 loopback。受限沙箱首次运行出现 `EPERM`；允许
本机回环后完整套件通过。该现象与此前 main-ready 验收一致。

## 后续基线规则

1. fork `main` 是 Desktop 2.0 React 源码、测试、设计和状态规范的权威基线。
2. upstream 的 compiled-only PR 是某个已验收 fork SHA 的发布快照，不反向覆盖较新的 fork 源码。
3. 每次同步 upstream，先核对 upstream PR 的来源 SHA；来源早于 fork `main` 时，dist 按生成物处理。
4. 新 upstream renderer 交付必须从 fork `main` 的明确 SHA 重建，provenance 与提交一一对应。
5. 合并后必须至少通过类型、单测、CI/packaging contract、build/bundle、Python、Rust 和浏览器关键链路。
