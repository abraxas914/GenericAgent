# Desktop Frontend Specs

- [Session state management](session-state.md) — session identity、Zustand buckets、异步提交、UI 恢复、删除与测试契约。
- [Maintainability](maintainability.md) — 生产可达性、真实测试证据、CI 触发闭包、bundle/package 与发布证据契约。

修改 `stores/chat.ts`、`stores/thread-view.ts`、Composer、Thread、session sidebar 或 bridge session API 前必须阅读状态规范。删除/拆分 Desktop 源码、测试、CI、bridge、Tauri 或打包逻辑前必须同时阅读维护规范。
