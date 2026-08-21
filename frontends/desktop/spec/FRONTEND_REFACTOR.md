# React Desktop 2.0 — 当前前端边界

## 架构状态

Desktop 2.0 是完整的 React 18 + Semi Design 应用，不再是挂在 Desktop v1 上的 React
Island。生产界面通过 HTTP bridge 和 Tauri IPC 直接完成配置、会话、模型、上传、协作与本地
文件操作，不依赖 `static/app.js` 提供的运行时全局对象。

fork 保留完整 React/TypeScript 源码、测试和 Vite 构建；如 upstream 只接受编译产物，交付分支
可将同一 fork commit 的 `dist/**` 发布到 upstream 的 `frontends/desktop/static/**`，但不能据此
把 fork 的源码与 upstream 的 Desktop v1 源码重新耦合。

## 入口与恢复链

- `index.html`：React Desktop 2.0 主界面。
- `loading.html`：Semi 启动界面；优先消费 fork 的 bootstrap snapshot/event，同时兼容 upstream
  旧壳注入的 `window.gaProgress(pct, key)`。
- `setup.html`：React/Semi 恢复界面；模块加载、初始化、Promise 异常或看门狗超时会转到
  `fallback.html`。
- `public/fallback.html`：无 React、Semi 或 Vite chunk 依赖的独立恢复页；优先调用 fork 的
  `get_bootstrap_snapshot` / `retry_bootstrap`，缺少这些命令时兼容 upstream 的
  `get_prepare_error` / `start_bridge_with_config`。

## 生产接口

```text
React stores/components
    ├── HTTP bridge: config, models, sessions, chat, uploads, services
    └── Tauri IPC: directory picker, workspace connection/move, shell actions
```

设置变更由 Zustand 更新 React 状态与 DOM，再通过 bridge 持久化；语言、外观和默认模型不得
调用 Desktop v1 全局对象。连接本地仓库和移动工作区遵守
`spec/local-repo-connection.md` 的包内 bridge + 外部 `GA_ROOT` 契约。

## 样式与组件

- Semi Design 提供主界面、loading、setup、异常页和确认框组件。
- `public/styles.css` 是 React 主界面的独立生产样式，不链接 `static/styles.css`。
- `public/fallback.html` 的自定义 class 统一使用 `.ga-` 前缀，保证独立资源损坏恢复能力。
- 首屏内联骨架只负责避免空白与闪烁，React 挂载后由正式组件接管。

## 必要验证

- TypeScript、Vitest、生产构建与 bundle/isolation contract。
- 浏览器 E2E 覆盖主界面与恢复旅程。
- fork 真包验证新 bootstrap snapshot/event；compiled-only upstream 候选还必须验证旧
  `gaProgress`、旧恢复命令、首次启动失败和重试成功路径。
- 构建产物不得包含对 `window.gaLegacy` 的引用。
