# 导入记忆与会话：可恢复覆盖契约

## 调用边界

React 通过原生文件/目录选择器取得路径，先调用 `/memory/import/inspect` 展示来源摘要，
用户确认后只向包内 bridge 发送：

```http
POST /memory/import
Content-Type: application/json

{"sourcePath":"/path/to/source"}
```

源目录中的代码永不执行。目标始终是当前有效 `GA_ROOT`。

## 并发边界

- bridge 在同一把进程内维护锁下检查所有桌面会话（包含已取消/删除但任务队列尚未
  `task_done` 的会话）和所有受管理服务。任一仍运行时返回 HTTP 409，并列出
  `runningSessions` 与 `runningExtras`。
- 空闲检查通过后，bridge 在正式合并前设置 maintenance gate；gate 期间拒绝新会话、
  prompt、会话/模型/配置写入、服务启动、上传写入、bridge 退出与连接源切换触发的退出。
  只读和停止操作仍允许。导入成功、失败或 HTTP 请求取消时都要等后台线程真正结束后再清 gate。
- 导入不会自动终止任务或服务。React 在已知桌面会话或受管理服务运行时禁用导入/导出，
  但 bridge 的 409 是最终权威。
- 此 gate 只覆盖当前 Desktop bridge 进程。用户必须先停止使用同一数据目录的其他 TUI、CLI、
  独立 conductor/scheduler 或其他自动化；不得声称跨进程强一致性。

## 文件语义

| 数据 | 源 | 目标 | 规则 |
| --- | --- | --- | --- |
| memory | `memory/**` | `<GA_ROOT>/memory/**` | 先备份整个现有 memory，再覆盖同名文件并补齐新文件 |
| responses | `temp/model_responses/**` | `<GA_ROOT>/temp/model_responses/**` | 只补缺；同名文件跳过，不覆盖 |
| sessions | `temp/desktop_sessions/*.json` 及旧单文件 | 当前 session store | 按 session id 去重，只持久化新增项；忽略内部 `tui_*` 会话 |

备份目录为 `<GA_ROOT>/temp/memory_import_backup_<timestamp>/memory`。只要目标 memory
原先非空且本次导入包含 memory，`backupDir` 必须指向可恢复的完整备份。

## 响应

```json
{
  "ok": true,
  "memoryCopied": 3,
  "responsesCopied": 5,
  "responsesSkipped": 2,
  "sessionsAdded": 4,
  "sessionsSkipped": 1,
  "sessionsFileFound": true,
  "backupDir": "/path/to/temp/memory_import_backup_20260821_120000"
}
```

这些字段是公共接口，不得更名或改成仅供 UI 展示的字符串。

## 与连接本地核心的区别

- 导入是一次性文件操作，不重启 bridge、不改变 `GA_ROOT`。
- 连接只改变有效数据根，不复制 memory、responses 或 sessions。
- 导入接受只有 memory 或 responses 的目录；连接要求 `agentmain.py` 并通过 compatibility
  probe。
- 导入也接受仅含新版 per-session 文件或旧 `desktop_sessions.json(.migrated)` 的会话备份；
  完全空的备份/文件夹一律拒绝。

## 必测场景

- 同名 memory 被新内容覆盖，旧内容可从 `backupDir` 恢复。
- 同名 response 保持旧内容并计入 `responsesSkipped`。
- 重复 session id 不新增，内部 `tui_*` session 不进入 Desktop。
- 源等于目标、源为空、复制失败和 bridge 离线均明确失败。
- 导出和导入使用相同的 100,000 文件、2 GiB 解压后大小上限；导出目标不得位于
  `memory`、responses、sessions、上传目录或任何可由 bridge 静态读取的目录。
- symlink、Windows junction/reparse point、目标祖先绕出数据根均在读取/写入前拒绝。
- 导出前所有 Desktop session 必须严格落盘；任一落盘失败时旧目标文件保持原字节。
- 导入 session 先经过 canonical schema 校验；非字符串 id、非有限时间、负 msg_seq、
  非对象 messages/history 等记录跳过，落盘文件只包含 canonical 字段且 bridge 可重启加载。
- 使用隔离的发布包副本验证真实文件结果，测试结束不污染用户数据。
