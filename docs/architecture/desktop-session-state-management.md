# GenericAgent Desktop 会话状态管理架构

状态：Accepted

适用范围：`frontends/desktop`、`frontends/desktop_bridge.py` 以及相关测试

首次制定：2026-08-29

规范入口：`.trellis/spec/desktop/frontend/session-state.md`

## 1. 为什么需要单独规范

Desktop 同时具有聊天应用、长任务执行器和 Tauri Webview 三种特征。一次会话可能在后台继续流式执行；用户可以在多个会话间切换；React 组件会卸载或重挂；bridge 和 Webview 还可能独立重启。因此，“组件还在不在”不能代表“用户工作是否还在”。

本次 `Show N earlier messages` 回归的根因就是生命周期错配：render budget 属于某个 session 的工作区状态，却曾由当前 `Thread` 组件局部持有。切换 session 后组件生命周期触发重置，返回时只能得到默认预算，于是先前展开的 transcript 再次折叠。

长期维护必须让每一项状态都明确回答四个问题：

1. **身份**：它属于哪个 app、window、session、turn、message 或 attachment？
2. **权威来源**：谁可以写，谁只是缓存或投影？
3. **生命周期**：它应跨过重渲染、session 切换、Webview 重载和 app 重启中的哪些边界？
4. **失效方式**：完成、取消、删除、过期、迁移失败时如何清理或降级？

## 2. 外部依据与本项目结论

### 2.1 React：组件树位置不是业务身份

React 将局部 state 绑定到组件在渲染树中的位置；组件被移除后，局部 state 会被销毁。`key` 可以显式区分身份，但不同 key 仍意味着不同的局部 state 生命周期。React 还建议避免冗余、重复和过深 state，并优先保存 ID 而不是对象副本。

本项目结论：

- hover、drag depth、popover open 等真正短暂的交互可以留在组件内。
- draft、scroll、render budget、disclosure 等“返回 session 后仍应存在”的状态必须放进 `sessionId` 分区的外部 store。
- `key={sessionId}` 适合主动重置组件内部的临时状态，不能代替 session workspace store。
- `activeSessionId` 只能是选择指针，不能兼任数据分区。

参考：[Choosing the State Structure](https://react.dev/learn/choosing-the-state-structure)、[Preserving and Resetting State](https://react.dev/learn/preserving-and-resetting-state)。

### 2.2 VS Code：保存可恢复状态，不要靠隐藏视图保活

VS Code Webview 文档说明，Webview 隐藏后其内容可能销毁，推荐通过 `getState`/`setState` 保存可序列化状态；`retainContextWhenHidden` 内存开销高，只应作为例外。Webview 被 dispose 后还必须停止定时器和后续更新。

本项目结论：

- session 切换、sidebar 折叠或 Webview 重建都不得依赖组件实例仍然存活。
- 可恢复 UI 状态应能序列化、校验、迁移并重新投影到组件。
- timer、RAF、AbortController、Promise、Blob URL 等资源只能保留在运行期 registry，不能序列化。
- session 删除必须同步取消这些资源，防止晚到结果复活已删除会话。

参考：[VS Code Webview lifecycle and persistence](https://code.visualstudio.com/api/extension-guides/webview#persistence)。

### 2.3 Redux/Zustand：按数据类型和稳定 ID 组织，持久化必须裁剪和迁移

Redux 建议按数据类型而非组件组织 state、归一化复杂数据、保持最小权威 state，并将异步状态视为有限状态机。Zustand 的 persist 文档提供 `partialize`、`version`、`migrate`、自定义 storage 和手动 hydration，说明“给整个 store 套 persist”不是完整设计。

本项目结论：

- `sessionsById[sessionId]` 与 `viewBySessionId[sessionId]` 是正确基本形状。
- `messages/status/pendingQueue/turnStartedAt/sessionModelNo` 顶层字段只是兼容投影；新增代码不得把它们作为第二权威来源。
- 若未来持久化 thread view，只允许 `partialize` 后的白名单字段，并必须提供 schema version、migration、大小限制和损坏降级。

参考：[Redux Style Guide](https://redux.js.org/style-guide/)、[Normalizing State Shape](https://redux.js.org/usage/structuring-reducers/normalizing-state-shape)、[Zustand persist](https://zustand.docs.pmnd.rs/reference/middlewares/persist.html)。

### 2.4 TanStack Query：异步结果也必须携带身份

TanStack Query 要求 query key 包含所有决定结果身份的变量，并通过 AbortSignal 取消过期请求。这个原则不要求 GA 引入 TanStack Query，但适用于现有 Zustand 异步逻辑。

本项目结论：

- 发起请求时捕获 `sessionId`，结果只能提交到同一 session bucket。
- 同一 session 的多次 load 使用递增 generation；只有最新 generation 可以提交。
- 可以取消的请求应使用 AbortSignal；无法取消时必须丢弃失效结果。
- “请求结束时当前激活的 session”不是请求身份。

参考：[Query Keys](https://tanstack.com/query/latest/docs/framework/react/guides/query-keys)、[Query Cancellation](https://tanstack.com/query/latest/docs/framework/react/guides/query-cancellation)。

### 2.5 桌面恢复：恢复交互点，但不要复制业务数据

Apple 的 AppKit 状态恢复示例保存 selection、tab、编辑状态和 window 标识，从而让用户返回离开时的交互点。其 UI restoration 指南同时强调：业务数据仍应由持久存储负责，恢复档案只保存引用和必要的临时 UI 值。

本项目结论：

- bridge session JSON 是聊天记录、LLM history、session metadata 的持久权威来源。
- frontend persistence 只保存恢复交互所需的 ID、draft 和有限 UI 状态，不复制完整 messages 或 LLM history。
- Tauri Store 或 Zustand persistence 若被采用，必须显式保存或使用 debounce autosave，并处理异步 hydration。

参考：[Restoring your app’s state with AppKit](https://developer.apple.com/documentation/AppKit/restoring-your-app-s-state-with-appkit)、[Tauri Store](https://v2.tauri.app/plugin/store/)。

## 3. 状态分层模型

| 层级 | 示例 | 权威所有者 | 跨 session 切换 | 跨 Webview 重载 | 跨 app 重启 |
| --- | --- | --- | --- | --- | --- |
| 组件瞬态 | hover、drop overlay、drag depth、popover | React 组件 | 不要求 | 否 | 否 |
| session 工作区 | render budget、scroll anchor、disclosure、draft、attachment UI | `thread-view.ts` | 必须 | 规划性恢复 | 按字段策略 |
| session 运行缓存 | messages cache、partial、status、queue、timer、generation、model runtime | `chat.ts` | 必须 | 从 bridge 重建 | 从 bridge 重建 |
| session 持久领域 | messages、LLM history、title、pin、model binding、timestamps | `desktop_bridge.py` | 必须 | 是 | 是 |
| app 偏好 | language、appearance、default model、窗口偏好 | settings/Tauri 边界 | 是 | 是 | 是 |

原则：**越靠下越持久，但越不能保存运行期资源；越靠上越临时，但不能误删用户仍认为属于 session 的工作。**

## 4. 当前权威模型

### 4.1 Bridge 是会话领域的单一持久权威

`frontends/desktop_bridge.py` 的 `Session` 和每会话 JSON 文件拥有长期领域数据。持久化必须继续遵守：

- 一会话一文件，避免全量会话写放大。
- 在 manager lock 内深拷贝 mutable collections，文件 I/O 在快照完成后执行。
- 写临时文件后 `os.replace`，失败不能破坏旧文件。
- 单个损坏文件被隔离，不能清空其他 session。
- `agent`、thread、cancel flag、partial、running model 等运行期对象不得写入 JSON。
- 进程重启后 `status` 不能盲目恢复为 running；需由实际运行环境重新确认。

长期建议给 session JSON 增加 `schema_version`，并将 migration 写成可重复、可回滚测试的纯转换。

### 4.2 `sessionsById` 是 frontend 运行态权威

`frontends/desktop/src/stores/chat.ts` 中：

- `sessionsById[sessionId]` 保存该 session 的 messages、partial、status、queue、timer timestamp、model 和 load generation。
- `runningSessions` 是跨 session 的集合索引。
- `messages/status/pendingQueue/turnStartedAt/sessionModelNo` 是当前兼容投影，只允许由 `activeProjection()` 与 `updateSession()` 同步生成。

迁移规则：新组件应直接通过 `activeSessionId` 选择 `sessionsById`；不得增加新的顶层镜像字段。兼容消费者清理完成后，应删除顶层投影，消除双写风险。

### 4.3 `viewBySessionId` 是 frontend 工作区权威

`frontends/desktop/src/stores/thread-view.ts` 中：

- `renderBudgetMultiplier`
- `scrollAnchor` / `followingTail`
- `expandedSegments`
- `composerDraft`
- `attachments`

都归属 `sessionViewId(sessionId)`。切换 session 只能更换选择指针，不得 reset 旧 bucket。只有显式新建、删除、用户清空或受控迁移才可以 reset。

`NEW_SESSION_VIEW_ID` 是尚未取得 bridge session ID 的临时命名空间。创建真实 session 后，如仍有需要保留的草稿/附件，必须通过显式 `claim`/`promote` 事务迁移，不能依赖组件恰好还挂载。

## 5. 每类状态的持久化策略

| 字段 | 切换 session | app 重启建议 | 约束 |
| --- | --- | --- | --- |
| `composerDraft` | 必须保留 | 应恢复 | 限长、按 session、删除时清除；含敏感文本，不能进日志 |
| `renderBudgetMultiplier` | 必须保留 | 可恢复 | JSON 不支持 `Infinity`；持久化时编码为有限整数或 `"all"` |
| `expandedSegments` | 必须保留 | 可恢复 | key 必须稳定且含 session/message/turn/index/type；数量要有上限 |
| `scrollAnchor` | 必须保留 | 可恢复 | 长期应使用 `messageId + offsetPx`，裸 `scrollTop` 仅作 fallback |
| `followingTail` | 必须保留 | 可恢复 | 若内容版本变化，应重新计算而非强制沿用 |
| pending upload | 必须保留 | 不恢复 | Promise、File、Blob URL 和上传中状态不能序列化 |
| ready attachment metadata | 必须保留 | 默认不恢复 | 若未来恢复，必须重新验证路径/权限/大小，禁止自动发送 |
| `pendingQueue` | 必须保留 | 默认不恢复 | 避免重启后重复发送；若要持久化，需 outbox ID 和幂等协议 |
| partial/streaming | 必须隔离 | 不直接恢复 | 重连后向 bridge 查询实际状态和 authoritative messages |
| messages/LLM history | frontend 缓存 | 从 bridge 恢复 | frontend 不重复持久化完整副本 |

任何新增字段必须在代码评审中填写同样的生命周期表，不允许默认“先放 store 再说”。

## 6. 核心不变量

### 6.1 身份不变量

1. 所有 session 级更新 API 必须接收显式 `sessionId`。
2. 所有异步请求、timer、RAF、WebSocket event 和 optimistic ID 必须携带或闭包捕获 `sessionId`。
3. message/segment/attachment ID 在其生命周期内稳定；展示顺序变化不能改变 disclosure key。
4. `activeSessionId` 只影响投影和可见副作用，不改变结果所属 session。

当前 `sessionId` 的唯一性范围是单个已连接 bridge。引入多 GA root、多 profile 或多 bridge 连接前，runtime identity 必须扩展为 `(bridgeInstanceId, sessionId)`；引入多窗口前，还要决定 view state 是共享于 session，还是隔离为 `(windowId, sessionId)`。不得继续复用全局 `NEW_SESSION_VIEW_ID` 或假设只有一个 active session。

### 6.2 提交不变量

异步结果提交前必须同时满足：

- session bucket 仍存在；
- generation/operation ID 仍是当前值；
- session 未被删除或 tombstone；
- payload 通过边界校验；
- active-only 副作用仍指向同一 session。

无法满足时应安静丢弃结果并记录无内容的诊断计数，不能回退写入当前 session。

### 6.3 切换不变量

一次 A → B → A 必须保持：

- A 的 messages、partial、queue、model、timer 不被 B 覆盖；
- A 的 draft、attachments、scroll、render budget、disclosures 不重置；
- B 的后台流式更新进入 B bucket；
- 返回 A 后 active projection 与 A bucket 一致；
- 不产生额外发送、重复上传或重复 poll timer。

### 6.4 删除不变量

删除 session 是资源清理事务，不只是从 sidebar 移除一行。必须：

1. 标记 deleting/tombstone，阻止晚到 event 重建。
2. 停止 poll timer、取消 RAF/AbortController、撤销 Blob URL。
3. 删除 runtime bucket、view bucket、query/cache entry 和 running index。
4. 删除 bridge 持久记录。
5. 后端失败时通过明确 reconciliation 恢复或显示错误，不能长期前后端分叉。

当前实现通过 bucket existence 和 generation 阻止大多数晚到 load，但尚未建立统一 tombstone；后续涉及 WebSocket 重放或离线恢复时必须先补上。

## 7. Hydration 与重连顺序

推荐启动流程：

1. 加载 app preferences 和可恢复 UI schema，进入显式 `hydrating` 状态。
2. 连接 bridge，加载 session metadata。
3. 校验 last active session 是否仍存在；不存在则选择最近 session 或 new-session workspace。
4. 按 session ID 加载 authoritative messages/model/status。
5. 应用该 session 的 draft、view anchor 和 disclosure 状态。
6. 结束 hydration 后才允许发送或 destructive action。

bridge 暂时断开时：

- 保留现有 session list 和 view buckets；
- 标记 connection state，不用空数组覆盖 UI；
- 重连后按 ID 增量 reconcile；
- session 数据与本地 draft 分别合并，bridge 数据不能清空 draft。

## 8. 内存、性能与隐私

- session runtime/view map 必须有可观测的大小。未来引入 LRU 时，先淘汰无 draft、无 attachment、非 running 的 dormant session。
- 有未发送 draft 的 bucket 不得静默淘汰；必须先可靠持久化或提示用户。
- transcript 继续使用 part-based render budget；展开状态不能通过“永久渲染全部历史”换取正确性。
- persistence 使用白名单和 schema version，禁止序列化整个 Zustand store。
- 高频 scroll/render 更新先写内存，磁盘 snapshot 必须 debounce；关键 draft 变更还要在 window close/graceful exit 尝试 final flush，但不能把 graceful exit 当作唯一可靠写入时机。
- 当前单窗口可以使用单 writer。未来多窗口共享同一 UI archive 前，必须定义 host coordinator 或 revision/CAS 合并规则，避免 last-close-wins 覆盖另一窗口状态。
- 日志只能记录 session ID 的安全摘要、generation、transition、计数和错误码；不得记录 prompt、draft、文件内容、绝对路径或 LLM history。

## 9. 设计禁区

### 错误：根据当前激活会话提交异步结果

```ts
const result = await pollMessages(sessionId);
set({ messages: result.messages });
```

### 正确：根据请求身份和 generation 提交

```ts
const requestedSessionId = sessionId;
const generation = beginLoad(requestedSessionId);
const result = await pollMessages(requestedSessionId);

if (!isCurrentLoad(requestedSessionId, generation)) return;
updateSession(requestedSessionId, (runtime) => ({
  ...runtime,
  messages: mergeMessages(runtime.messages, result.messages),
}));
```

其他禁止模式：

- 用 `useEffect(() => reset(), [activeSessionId])` 处理本应恢复的 session state。
- 为“方便”把业务数据、UI state 和运行期资源放进同一个持久化对象。
- 同时维护 `selectedSession` 对象副本和 `selectedSessionId`。
- 用数组 index 或随机 key 标识 message segment。
- 忽略 delete/reconnect 时的 timer、RAF、WebSocket 和 object URL 清理。
- 把 `Infinity`、`File`、Promise、AbortController、Set/Map 直接交给 JSON persistence。

## 10. 强制测试门禁

任何 session state 改动至少覆盖受影响项：

### Store 单元测试

- A/B 结果乱序到达，仍进入各自 bucket。
- 同 session 旧 generation 晚到，不覆盖新 generation。
- session 删除后晚到 load/event 不复活 bucket。
- active projection 始终等于 active bucket。
- new-session workspace 到真实 session 的迁移不丢 draft/attachments。

### 组件测试

- `Show N earlier messages` 展开 → 切 B → 返回 A，仍展开。
- disclosure 展开/折叠 → 组件 remount 或切 session → 状态恢复。
- draft、attachment、scroll/followingTail 在 A/B 间相互隔离。
- pending upload 只禁用所属 session 的发送。

### Bridge 测试

- session snapshot 在并发 mutation 下仍是合法 JSON。
- 原子 replace 失败不破坏旧文件。
- 单个损坏 session 不影响其他 session。
- 重启后 LLM history 与 model binding 恢复。
- persisted schema migration 可重复运行且保留未知安全字段的策略明确。

### E2E 与真包

- 两个 running session 至少切换 20 次，消息、状态、timer 和 model 不串桶。
- 长 transcript 展开 → 切换 → 返回。
- bridge restart / Webview refresh 后 authoritative data 恢复，draft 策略符合规范。
- macOS 和 Windows 正式包各执行一次真实 session round trip。

## 11. 运维路线

### 已完成

- `chat.ts` 使用 `sessionsById` 和 per-session generation。
- `thread-view.ts` 使用 `viewBySessionId` 保存 render、scroll、draft、attachment 和 disclosure。
- bridge 使用每会话原子 JSON 持久化并隔离损坏文件。
- 自动测试覆盖异步乱序、20 次切换、remount disclosure 和删除后的晚到结果。

### 下一阶段

1. 增加完整的 transcript 展开 → session 切换 → 返回组件测试。
2. 为 frontend 可恢复 UI state 设计 versioned、partial persistence；先只纳入 draft 和有限 view state。
3. 把 scrollTop 升级为稳定 message anchor。
4. 引入 session tombstone/operation registry 和统一 AbortController 清理。
5. 清理顶层 active projection，让 selector 直接读取 active bucket。
6. 为 runtime/view bucket 增加大小指标和安全淘汰策略。
7. 在支持多窗口、多 profile 或多个 bridge root 前扩展 identity namespace，并补并发写入规范。

这些阶段应逐项落地，不应一次性把整个 store 持久化。

## 12. 参考实现位置

- `frontends/desktop/src/stores/chat.ts`
- `frontends/desktop/src/stores/thread-view.ts`
- `frontends/desktop/src/components/chat/Thread/index.tsx`
- `frontends/desktop/src/components/chat/Thread/MessageList.tsx`
- `frontends/desktop/src/components/chat/Thread/parts/index.tsx`
- `frontends/desktop/src/components/chat/Composer/index.tsx`
- `frontends/desktop_bridge.py`
- `frontends/desktop/src/__tests__/chat-session-isolation.test.ts`
- `frontends/desktop/src/__tests__/thread-view-state.test.tsx`
- `frontends/desktop/e2e/specs/browser/critical-loops.e2e.ts`
- `frontends/tests/test_bridge_sessions.py`
