# 导入记忆与会话 — 设计逻辑与契约

## 1. Scope / Trigger

用户在设置 → 数据维护 → "导入记忆与会话" 选择一个本地 GA 仓库目录，将其中的 memory 文件和历史会话合并到当前运行时。

## 2. 导入流程

```
用户点"选择仓库" → Tauri pick_directory → 选中目录 → POST /memory/import → 显示结果
```

### 2.1 前端流程（DataSection.tsx handleImportData）

1. `bridge.tauriInvoke('pick_directory', {})` — 打开原生目录选择器
2. 用户选中目录后，设置 `importing = true`（按钮 disabled）
3. `POST http://127.0.0.1:14168/memory/import` body: `{ sourceDir: "/path/to/repo" }`
4. 根据响应显示结果 Toast
5. 成功后调 `useChatStore.getState().loadSessions()` 刷新会话列表

### 2.2 后端处理（desktop_bridge.py /memory/import）

桥接层扫描源目录，合并以下内容到当前工作目录：

| 数据源 | 源路径 | 目标路径 | 合并策略 |
|--------|--------|----------|----------|
| 记忆文件 | `{sourceDir}/memory/` | `{gaRoot}/memory/` | 复制新增文件，不覆盖已有同名文件 |
| 对话记录 | `{sourceDir}/responses/` | `{gaRoot}/responses/` | 复制新增文件，跳过同名已有 |
| 会话索引 | `{sourceDir}/sessions.json` 或类似 | 合并到当前 sessions | 追加不重复的条目 |

### 2.3 响应格式

```json
{
  "memoryCopied": 3,
  "responsesCopied": 5,
  "responsesSkipped": 2,
  "sessionsAdded": 4
}
```

错误响应：
```json
{ "error": "No memory or session data found in the selected directory" }
```

## 3. 契约

### 与"连接本地仓库"的区别

| | 导入记忆与会话 | 连接本地仓库 |
|--|--------------|------------|
| 本质 | 一次性文件复制 | 切换运行时 |
| bridge 是否重启 | 否 | 是 |
| 影响范围 | 仅 memory/responses/sessions | 整个运行时（含 mykey、bridge 进程） |
| 可逆性 | 文件已复制，需手动删除 | 可随时断开回到内置 |
| 源仓库要求 | 有 memory/ 或 responses/ 目录即可 | 必须有 agentmain.py + desktop_bridge.py |

### 前端状态

- `importing = true` 期间按钮显示 disabled
- 无独立动画（操作通常 < 2s）
- 成功：Toast 显示 "{copied} 个文件，{skipped} 个跳过"
- 失败：Toast 显示后端错误消息

### 安全边界

- 只读源目录，只写当前工作目录
- 不覆盖已有文件（防止丢失用户当前数据）
- 不执行源目录中的任何代码

## 4. Tauri 权限需求

- `allow-pick-directory` — 打开原生目录选择器
- CSP `null` + `remote.urls` 包含 `http://127.0.0.1:14168` — 允许 fetch 到 bridge

## 5. 错误场景

| 场景 | 行为 |
|------|------|
| 用户取消目录选择 | `pick_directory` 返回 null，静默退出 |
| 所选目录无 memory/responses | 后端返回 error，Toast "导入失败" |
| bridge 离线 | fetch 抛 network error，Toast "导入失败" |
| 部分文件复制失败 | 后端仍返回 200，skipped 计数增加 |

## 6. Wrong vs Correct

### Wrong — 用 Tauri IPC 传输大量文件内容
```typescript
// 把所有文件内容序列化到 IPC → 内存爆炸
const files = await bridge.tauriInvoke('read_all_memory', { dir });
await bridge.tauriInvoke('write_all_memory', { files });
```

### Correct — 让 bridge（同机 Python 进程）直接文件系统操作
```typescript
// 前端只传路径，bridge 做本地 cp
const res = await fetch('http://127.0.0.1:14168/memory/import', {
  method: 'POST',
  body: JSON.stringify({ sourceDir: picked }),
});
```

## 7. Tests Required

- 选一个有 memory/ 和 responses/ 的仓库 → Toast 显示正确计数，会话列表刷新
- 选一个空目录 → Toast "导入失败" 或 "未找到数据"
- 重复导入同一目录 → 第二次 copied=0, skipped=N（不重复）
- 导入期间按钮 disabled，导入后恢复
- bridge 离线时点导入 → Toast "导入失败"
