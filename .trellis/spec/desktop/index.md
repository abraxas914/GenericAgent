# Desktop Code Specs

Desktop 由 React Webview、Tauri host 与 Python bridge 组成。跨层变更必须分别确认 UI workspace、frontend runtime 和 bridge durable domain 的所有权。

## Frontend

- [Frontend index](frontend/index.md)
- [Session state management](frontend/session-state.md)
- [Desktop maintainability](frontend/maintainability.md)

## Cross-layer security

- [Desktop transport security](transport-security.md)

## Architecture rationale

- `docs/architecture/desktop-session-state-management.md`
