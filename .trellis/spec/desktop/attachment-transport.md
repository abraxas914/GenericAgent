# Desktop Attachment Transport Code Spec

规范级别：Normative

## Scenario: Browser file upload to the local bridge

### 1. Scope / Trigger

下列变更触发本规范：

- 修改 Composer 的 picker、paste、DOM drop 或 retry ingestion。
- 修改 `uploadFile`、bridge `/upload`、上传目录或文件元数据。
- 修改单文件大小、base64/JSON envelope、错误码或落盘时机。
- 修改 native Tauri drop 与 `/drop/stat`；该路径携带本机绝对路径，不等同于 browser upload。

目标是让浏览器文件上传在前后端遵循同一 50 MiB 产品上限，并让 bridge 独立拒绝绕过前端限制的请求。

### 2. Signatures

前端产品常量：

```ts
export const MAX_ATTACHMENT_SIZE = 50 * 1024 * 1024;
```

Bridge 权威常量和入口：

```py
MAX_UPLOAD_BYTES = 50 * 1024 * 1024

async def _read_bounded_upload_json(request, max_body_bytes: int) -> dict: ...
def _decode_upload_data(data_url: str, max_bytes: int) -> bytes: ...
async def upload_handler(request): ...
```

请求：

```json
{"name":"report.pdf","dataUrl":"data:application/pdf;base64,...","sid":"session-id"}
```

超限响应：

```http
HTTP/1.1 413 Payload Too Large
```

```json
{"ok":false,"code":"file_too_large","error":"file exceeds 50 MB limit"}
```

### 3. Contracts

#### 3.1 Product limit

- 单文件上限是 50 MiB，即 `50 * 1024 * 1024` decoded bytes。
- 恰好等于上限允许；大于上限一个字节也必须拒绝。
- 前端预检用于即时、本地化反馈；bridge 检查是独立安全边界，不能信任前端 `File.size`。
- picker、paste 和 DOM file drop 必须共用 ingestion；retry 不得绕过同一上限。

#### 3.2 Bounded request parsing

- `/upload` 不得先按 application-wide 500 MiB 上限完整读取后再判断单文件大小。
- 在 JSON 解析前必须同时检查 `Content-Length` 和实际读取字节数；chunked body 不能绕过。
- request envelope 上限必须覆盖 50 MiB 文件的标准 base64 膨胀和有限 JSON metadata。
- request envelope 上限只是内存保护，decoded bytes 才是产品大小的最终判定。

#### 3.3 Decode and side effects

- 只接受 ASCII 标准 base64；非法编码返回明确 decode error。
- 必须在 `_session_upload_dir` 创建目标文件并写入之前完成 decoded-size 检查。
- 超限、空文件、非法编码或非法 JSON 不得产生 upload file。
- 成功路径继续返回 bridge 管理的绝对路径；browser 不提供或推导本机绝对路径。

#### 3.4 Native path drop

- Tauri native drop 的本机路径通过 `/drop/stat` 检查，不经过 base64 `/upload`。
- native path 与 browser `File` 不得同时 ingestion，避免重复 attachment。
- 是否接受文件夹属于 native drop 产品策略，不得通过伪造 browser upload 表示文件夹。

### 4. Validation & Error Matrix

| 输入 | 结果 | 落盘 |
| --- | --- | --- |
| decoded size = 50 MiB | 200，`ok=true` | 一次 |
| decoded size = 50 MiB + 1 | 413，`code=file_too_large` | 无 |
| `Content-Length` 超 envelope | 413，`code=file_too_large` | 无 |
| chunked body 读取后超 envelope | 413，`code=file_too_large` | 无 |
| 空 payload | `ok=false`，empty-file error | 无 |
| 非 ASCII 或非法 base64 | `ok=false`，decode error | 无 |
| 合法 CJK filename | 200，保留安全化后的名称 | 一次 |

### 5. Good / Base / Bad Cases

#### Good

- 正常 Composer 在读取前拒绝 50 MiB + 1，并显示本地化 `upload.tooLarge`。
- 直接调用 `/upload` 上传超限文件时，bridge 返回 413 且上传目录无新文件。
- 恰好位于上限的文件通过前端和 bridge 两层检查。

#### Base

- 小型普通文件经 `/upload` 获得服务端路径并作为 file chip 发送。
- 图片仍按现有 Composer preview/send 合同处理。

#### Bad

- 只在 React 检查 `File.size`。
- 把 base64 字符数直接当作原始文件字节数。
- 在完整读取 500 MiB request 或落盘后才返回超限。
- 用前端传入的 filename、size 或 path 代替服务端验证。

### 6. Tests Required

- Python production decoder：data URL 和 raw base64 正常解码。
- Python production decoder：精确 decoded 边界允许，+1 拒绝。
- Python real aiohttp：成功 upload 只写一次且内容一致。
- Python real aiohttp：decoded 超限返回 413、稳定 code、无文件。
- Python real aiohttp：request body 超限在 JSON decode/落盘前拒绝。
- React：picker/paste/drop 超限显示本地化错误且不调用 upload。
- Existing browser/package journeys：普通文件 upload、send metadata 和 `/upload/raw` 回归通过。

测试不得构造真实 50 MiB fixture；production helper 应允许测试注入小阈值验证相同边界算法。

### 7. Wrong vs Correct

#### Wrong

```py
data = await request.json()
blob = base64.b64decode(data["dataUrl"])
target.write_bytes(blob)
```

#### Correct

```py
data = await _read_bounded_upload_json(request, request_limit)
blob = _decode_upload_data(data["dataUrl"], MAX_UPLOAD_BYTES)
target.write_bytes(blob)
```
