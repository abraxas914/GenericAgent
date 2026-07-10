# 连接本地仓库 — 设计逻辑与契约

## 1. Scope / Trigger

用户在设置 → 数据维护 → "连接本地仓库" 选择一个本地 GA 仓库目录，使桌面端切换运行时。

## 2. 连接流程

```
用户选目录 → 静态验证 → 持久化 → 切换 bridge → 等待就绪
```

### 2.1 静态验证（set_ga_source，同步/瞬间）

检查两个文件存在：
- `{dir}/agentmain.py`
- `{dir}/frontends/desktop_bridge.py`

任一缺失 → 立即返回错误，不写入设置。

### 2.2 持久化

写入 `~/.ga_desktop_settings.json`:
```json
{ "ga_source_override": "/path/to/repo" }
```

### 2.3 切换运行时（switch_bridge，异步，最多 ~26s）

1. **停止当前 bridge**：发 POST `/services/bridge/exit`；kill 进程；轮询端口释放（最多 ~11s）
2. **解析 Python 路径**：`find_python()` 优先 bundle 内置 Python → `.portable/uv-python` → 系统 `python3`
3. **启动新 bridge**：`spawn_bridge_process(python, new_dir)` — 用上述 Python 跑新仓库的 `desktop_bridge.py`
4. **等待就绪**：轮询 `127.0.0.1:14168`（最多 20s）
5. **刷新 WebView**：`show_bridge_window` 导航回 `tauri://localhost/index.html`

### 2.4 启动时重验证（valid_ga_source_override，每次 app 启动）

- 检查 `agentmain.py` + `frontends/desktop_bridge.py` 存在
- 无效 → 忽略 override，静默回退到内置 bundle

## 3. 契约

### 验证标准

| 检查项 | 实现 | 不检查 |
|--------|------|--------|
| agentmain.py 存在 | PathBuf::exists | 文件内容/版本 |
| desktop_bridge.py 存在 | PathBuf::exists | Python 环境/依赖 |

不验证：Python venv 完整性、依赖安装情况、mykey.py 有效性。bridge 是否能真正启动全靠 20s 超时兜底。

### 前端状态机

```
idle → (pick_directory) → switching → connected | idle(回滚)
connected → (change/disconnect) → switching → connected | idle
```

- `switching` 状态下按钮 disabled，显示 "切换中…" + 动画点
- 超时/错误 → 回滚到 prevState + Toast 错误

### 错误路由（mapSourceError）

| Rust 错误消息关键词 | 用户可见消息 |
|-------------------|-------------|
| `agentmain.py` | 无效仓库 — 未找到 agentmain.py |
| `desktop_bridge.py` | 无效仓库 — 未找到 desktop_bridge.py |
| `20s` / `ready` | 启动超时 — 仓库环境可能不完整 |
| `no GenericAgent source` | 无法定位运行时 |
| 其他 | 切换失败 |

## 4. 密钥与仓库的关系

切换仓库 = 切换 bridge 工作目录。每个仓库有独立的 `mykey.py`：

- 切到有 mykey 的仓库 → 模型列表立即反映新仓库的配置
- 切到无 mykey 的仓库 → bridge 从 `mykey_template.py` 生成空模板，模型列表为空
- 断开连接 → 回到内置 bundle 的 mykey
- "导入密钥配置" 写入的是**当前活跃仓库**的 mykey.py，不跨仓库迁移

## 5. Rust 命令签名

```rust
#[tauri::command]
async fn set_ga_source(app_handle: AppHandle, dir: String) -> Result<String, String>

#[tauri::command]
async fn clear_ga_source(app_handle: AppHandle) -> Result<String, String>

#[tauri::command]
fn get_ga_source() -> String  // 返回当前 override 路径或空串

#[tauri::command]
fn pick_directory(title: Option<String>) -> Option<String>  // rfd 文件夹选择器
```

`set_ga_source` / `clear_ga_source` 为 async — 切换过程在 tokio 线程池执行，不阻塞主线程（避免 macOS 彩虹球）。

## 6. Wrong vs Correct

### Wrong — 同步阻塞主线程
```rust
#[tauri::command]
fn set_ga_source(...) -> Result<String, String> {
    // switch_bridge 内有 thread::sleep 循环
    // → 主线程被阻塞 20+s → macOS 彩虹球
    switch_bridge(&app_handle)
}
```

### Correct — async 调度到后台
```rust
#[tauri::command]
async fn set_ga_source(...) -> Result<String, String> {
    // 同样的阻塞代码，但跑在 tokio 线程池
    // → 主线程空闲，前端 "切换中…" 动画正常渲染
    switch_bridge(&app_handle)
}
```

## 7. Tests Required

- 选一个有效仓库 → 20s 内显示"已连接" + 绿点 + 路径
- 选一个没有 agentmain.py 的目录 → 瞬间报错"无效仓库"
- 选一个有 agentmain.py 但 Python 环境缺依赖的仓库 → 20s 后报"启动超时"
- 断开连接 → 回到 idle，bridge 使用内置 runtime
- app 启动时 override 指向已删除目录 → 静默回退，无报错
- 切换期间 UI 不卡顿（无彩虹球），按钮 disabled，动画播放
