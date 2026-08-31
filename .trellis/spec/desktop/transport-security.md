# Desktop Transport Security Code Spec

规范级别：Normative

## Scenario: Browser-origin enforcement for the local bridge

### 1. Scope / Trigger

下列变更触发本规范：

- 修改 Python bridge HTTP/WebSocket middleware、route 或 listener。
- 修改 Tauri bridge 子进程启动参数或环境变量。
- 修改 Vite dev origin、Tauri application origin、Bridge host/port 或 E2E port。
- 新增 browser-accessible bridge endpoint，尤其是 session、model、mykey、backup、upload 或 service control。

目标是阻止任意网页借助浏览器访问本机 bridge，同时保留 Tauri WebView、明确开发模式、隔离 E2E 和无 Origin 的本机 CLI。

### 2. Signatures

Python 权威入口：

```py
def _allowed_request_origins() -> set[str]: ...
def _request_origin_error(request) -> Optional[str]: ...

@web.middleware
async def cors_middleware(request, handler): ...
```

开发来源环境合同：

```text
GA_DESKTOP_DEV_ORIGIN=http://localhost:5173
```

允许格式只包括：

```text
http://localhost:<1..65535>
http://127.0.0.1:<1..65535>
```

E2E 来源继续使用独立合同：

```text
GA_E2E=1
VITE_PORT=<1..65535>
-> http://127.0.0.1:<VITE_PORT>
```

### 3. Contracts

#### 3.1 Production origin set

未显式启用开发/E2E 时，只允许：

```text
tauri://localhost
http://tauri.localhost
http://127.0.0.1:<BRIDGE_PORT>
http://localhost:<BRIDGE_PORT>
http://[::1]:<BRIDGE_PORT>
```

`http://localhost:5173` 不是 production origin，不得硬编码进默认集合。

#### 3.2 Explicit development opt-in

- Python bridge 只接受严格、完整、单一 loopback HTTP origin。
- 禁止 HTTPS、缺失端口、userinfo、path、query、fragment、非 loopback host 和无效端口。
- Tauri 只有在当前进程明确包含 `--dev` 时注入 canonical Vite origin。
- 正式 Tauri bridge command 必须 `env_remove("GA_DESKTOP_DEV_ORIGIN")`，不能继承父 shell 的值。
- Tauri retry/start command 必须复用当前进程的显式 dev mode，不能在重启 bridge 时悄悄改变 policy。

#### 3.3 E2E isolation

- `GA_E2E` 单独存在或 `VITE_PORT` 单独存在都不得授权来源。
- E2E 只授权 `127.0.0.1` 与严格端口，不自动授权 `localhost:5173`。
- production、development 和 E2E 开关不得互相推导。

#### 3.4 Request behavior

- 带 `Origin` 的 HTTP、preflight 和 WebSocket 必须在 handler/`prepare()` 前验证。
- 拒绝返回 `403`、`code=origin_forbidden`，且不得添加 CORS allow-origin header。
- 允许的 origin 只能逐值反射，并添加 `Vary: Origin`；禁止 `*` 和 credentials。
- 无 Origin 的本机 CLI 保持允许；`Sec-Fetch-Site: cross-site` 仍默认拒绝。
- `/upload/raw` 的只读 subresource exception 仅适用于既有 method/path/destination 白名单。

### 4. Validation & Error Matrix

| 输入 | 结果 |
| --- | --- |
| production + `Origin: http://localhost:5173` | 403，handler 不执行 |
| dev env 为 canonical Vite origin | GET/preflight 允许并精确反射 |
| dev env 为 `https://localhost:5173` | 忽略配置，来源 403 |
| dev env 含 path/query/fragment/userinfo | 忽略配置，来源 403 |
| dev env 端口 0、65536 或非数字 | 忽略配置，来源 403 |
| `GA_E2E=1` 且缺少合法 `VITE_PORT` | 不增加 E2E origin |
| evil WebSocket origin | prepare 前 403 |
| 无 Origin CLI 请求 | 允许，不添加 CORS header |
| cross-site document 请求 | 403 |
| `/upload/raw` image subresource、无 Origin | 允许只读资源响应 |

### 5. Good / Base / Bad Cases

#### Good

- 正式 app 启动 bridge；浏览器中占用 5173 的任意页面无法读取 `/services/mykey`。
- `tauri dev -- --dev` 启动 bridge；Vite GET、preflight 和 WebSocket 可用。
- dev bridge 重启后仍保留同一 explicit origin policy。

#### Base

- Tauri production WebView 使用 `tauri://localhost` 或 `http://tauri.localhost` 正常通信。
- 本机诊断 CLI 无 Origin 调用 `/status` 正常工作。

#### Bad

- 把常用开发端口永久加入 production allowlist。
- 用 `startswith("http://localhost")` 校验 origin。
- 只保护 POST，不保护 GET、OPTIONS 或 WebSocket handshake。
- production Tauri 继承用户 shell 中残留的开发开关。

### 6. Tests Required

- Python real aiohttp：production 拒绝 Vite origin且 handler 未执行。
- Python real aiohttp：显式 dev GET/preflight 精确反射，无 credentials/wildcard。
- Python：每种非法 dev origin 均 fail closed。
- Python：E2E 必须同时满足 mode 与合法 port。
- Python WebSocket：evil origin 在 `prepare()` 前失败。
- Rust：production child environment 移除 dev origin；explicit dev child 注入 canonical origin。
- Browser/Native：既有 bridge connectivity、bootstrap recovery 和 package ownership journeys 通过。

### 7. Wrong vs Correct

#### Wrong

```py
origins = {"tauri://localhost", "http://localhost:5173"}
```

#### Correct

```py
origins = production_origins()
if strict_loopback_origin(os.environ.get("GA_DESKTOP_DEV_ORIGIN")):
    origins.add(os.environ["GA_DESKTOP_DEV_ORIGIN"])
```

```rust
if dev_mode {
    command.env("GA_DESKTOP_DEV_ORIGIN", "http://localhost:5173");
} else {
    command.env_remove("GA_DESKTOP_DEV_ORIGIN");
}
```
