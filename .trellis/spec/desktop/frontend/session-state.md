# Desktop Session State Code Spec

规范级别：Normative

架构说明：`docs/architecture/desktop-session-state-management.md`

## Scenario: Session-scoped runtime and workspace state

### 1. Scope / Trigger

下列任一变更触发本规范：

- 新增或修改 session、turn、message、stream、queue、model、timer 状态。
- 新增或修改 transcript render budget、scroll、disclosure、draft、attachment 状态。
- 增加异步 poll、WebSocket event、RAF、timer、upload 或 optimistic update。
- 将 frontend state 写入 localStorage、Tauri Store 或其他持久层。
- 修改 session 创建、切换、删除、bridge 重连或进程重启流程。

目标是保证：**状态以稳定业务身份分区；异步结果写回原身份；组件生命周期不破坏 session 连续性；durable domain 只有一个权威来源。**

### 2. Signatures

#### Frontend runtime

当前权威类型位于 `frontends/desktop/src/stores/chat.ts`：

```ts
interface SessionRuntimeState {
  messages: Message[];
  status: 'idle' | 'running';
  partial: Message | null;
  pendingQueue: QueuedMessage[];
  turnStartedAt: number | null;
  sessionModelNo: number | null;
  model: LiveModel | null;
  loadGeneration: number;
}

interface ChatState {
  activeSessionId: string | null;
  sessionsById: Record<string, SessionRuntimeState>;
  runningSessions: Set<string>;
  setActiveSession(id: string | null): void;
  deleteSession(id: string): Promise<void>;
}
```

所有 runtime mutation 必须收敛到等价于以下签名的 session-keyed helper：

```ts
updateSession(
  sessionId: string,
  updater: (runtime: SessionRuntimeState) => SessionRuntimeState,
): boolean;
```

#### Frontend workspace

当前权威类型位于 `frontends/desktop/src/stores/thread-view.ts`：

```ts
interface SessionViewState {
  renderBudgetMultiplier: number;
  scrollAnchor: ScrollAnchor | null;
  followingTail: boolean;
  expandedSegments: Record<string, boolean>;
  composerDraft: string;
  attachments: AttachmentFile[];
}

setRenderBudget(sessionId: string | null, multiplier: number): void;
setScrollState(sessionId: string | null, anchor: ScrollAnchor | null, following: boolean): void;
setSegmentExpanded(sessionId: string | null, segmentId: string, expanded: boolean): void;
setComposerDraft(sessionId: string | null, draft: string): void;
updateAttachments(
  sessionId: string | null,
  updater: (attachments: AttachmentFile[]) => AttachmentFile[],
): void;
deleteSession(sessionId: string): void;
```

新增 session workspace 字段必须进入 `SessionViewState`，并由同样显式接收 `sessionId` 的 action 更新。

#### Bridge durable session

权威记录位于 `frontends/desktop_bridge.py`：

```py
@dataclass
class Session:
    id: str
    messages: list[dict]
    llm_history: Optional[list[dict]]
    llm_no: Optional[int]
    # title/cwd/timestamps/pin/plan metadata omitted here

def _persist_session(self, session: Session, *, strict: bool = False) -> None: ...
def _load_sessions(self) -> None: ...
```

完整 messages、LLM history 和 session metadata 只能由 bridge durable layer 持久化。Frontend persistence 不得复制这套领域记录。

### 3. Contracts

#### 3.1 Identity contract

- session bucket key 必须是 bridge `sessionId`。
- 该 key 当前只在一个 bridge connection scope 内唯一。多 root/profile/bridge 连接必须升级为 `(bridgeInstanceId, sessionId)`；多窗口的 view state 必须明确选择共享 session scope 或 `(windowId, sessionId)` scope。
- 尚未创建 session 使用 `NEW_SESSION_VIEW_ID`，取得真实 ID 后通过显式 promotion 迁移必要 workspace state。
- segment ID 必须稳定包含 session、message、turn、segment index 和 type；不得使用 render index 或随机值。
- optimistic message/attachment ID 必须包含或映射到所属 session。
- timer、RAF、poll、AbortController 和 upload operation registry 必须按 session/operation ID 索引。

#### 3.2 Ownership contract

| 数据 | 写入权威 | 允许的副本 |
| --- | --- | --- |
| messages / LLM history / session metadata | bridge | frontend runtime cache |
| partial / status / queue / timer / runtime model | `sessionsById` | active selector/projection |
| draft / attachments / scroll / render / disclosure | `viewBySessionId` | component props |
| language / appearance / default model | settings layer | boot cache |
| hover / overlay / drag depth | component | 无 |

`chat.ts` 的顶层 `messages/status/pendingQueue/turnStartedAt/sessionModelNo` 是 legacy active projection。它们只能由 `activeProjection()` 或 `updateSession()` 生成；禁止从组件单独写入，禁止新增类似镜像。

#### 3.3 Session switch contract

`setActiveSession(B)` 只允许：

1. 设置 `activeSessionId`。
2. 从 B bucket 生成 active projection。
3. 同步仅对当前 session 可见的 settings/UI side effect。
4. 根据 B runtime 恢复或启动 B 的 polling。

它不得 reset、覆盖或移动 A bucket，也不得清空 A 的 view state。

#### 3.4 Async commit contract

发起异步操作时捕获 immutable identity：

```ts
const requestedSessionId = sessionId;
const generation = beginLoad(requestedSessionId);
const result = await pollMessages(requestedSessionId);

if (!isCurrentLoad(requestedSessionId, generation)) return;
updateSession(requestedSessionId, (runtime) => apply(runtime, result));

if (get().activeSessionId === requestedSessionId) {
  syncVisibleSideEffects(result);
}
```

必须同时满足：bucket 存在、generation/operation 当前、session 未删除、payload 合法。否则丢弃。不得在 `await` 后读取 `activeSessionId` 并把它当作请求目标。

可取消的 fetch/upload 必须消费 AbortSignal；无法取消的 Promise 必须通过 generation 或 operation token 防止过期提交。

#### 3.5 Persistence contract

若给 `SessionViewState` 增加跨 app 重启恢复：

- 使用字段白名单，不序列化整个 store。
- schema 必须包含 `version`，每次 shape 变化提供 migration。
- hydration 失败回到安全默认值，不阻塞 authoritative bridge session 加载。
- `Infinity` 编码为 `"all"`；`Set`/`Map` 转成明确 JSON shape。
- Promise、File、Blob URL、AbortController、timer handle 和 upload-in-progress 不得持久化。
- draft 可持久化；ready attachment 默认不持久化，除非重启时重新验证路径、权限、大小且不自动发送。
- pending queue 默认不持久化；若产品要求恢复，先建立带 idempotency key 的 outbox 协议。
- 持久化数据必须有大小上限、过期/淘汰策略，并在 session 删除时清理。
- 高频 view 更新先落内存，磁盘写入 debounce；draft 需要周期性可靠 snapshot，不能只依赖 graceful exit。
- 多窗口写同一 archive 前必须建立单 writer coordinator 或 revision/CAS 合并，禁止未定义的 last-writer-wins。

#### 3.6 Bridge persistence contract

- 每个 session 独立 JSON 文件。
- 在 manager lock 内 snapshot/deep-copy mutable data。
- 临时文件写完后以 `os.replace` 原子替换。
- 单文件损坏只跳过该文件并记录错误。
- runtime-only fields 不写磁盘；重启时 session 初始 status 为 idle，之后与真实运行状态 reconcile。
- schema 变化必须提供版本化 migration 和旧版本 fixture tests。

#### 3.7 Cleanup contract

删除 session 必须清理：poll timer、RAF、AbortController、object URL、runtime bucket、view bucket、running index、缓存和 bridge file。删除开始后，late response/event 不得重新 `ensureSession`；复杂重连场景应使用 tombstone/epoch。

### 4. Validation & Error Matrix

| 条件 | 必须行为 | 禁止行为 |
| --- | --- | --- |
| event 缺少 `sessionId` | 忽略并计数诊断 | 写入 active session |
| session bucket 不存在 | 丢弃晚到结果；必要时按受信 event 明确创建 | 隐式写入其他 bucket |
| generation 过期 | 丢弃 | 覆盖较新 messages/model |
| session 已删除 | 丢弃并取消资源 | 复活 sidebar/session bucket |
| bridge 暂时断开 | 保留已有 session/view，显示连接状态 | 用空数组清屏 |
| persisted UI schema 版本未知 | 跳过该 UI archive，使用默认值 | 阻止 bridge session 加载 |
| persisted JSON 损坏 | 隔离损坏记录并记录安全错误 | 清空全部 session |
| `renderBudgetMultiplier === Infinity` | 内存允许；序列化成 `"all"` | 直接 JSON stringify 后假设可恢复 |
| attachment path 重启后无权限/不存在 | 标记需重新选择或移除 | 自动发送旧路径 |
| optimistic delete 后 bridge 失败 | 明确 reconcile/恢复或提示 | 长期保持前后端静默分叉 |
| stale upload resolve | 只有 attachment ID 仍存在时更新 | 重新插入已移除 attachment |

### 5. Good / Base / Bad Cases

#### Good

- A、B 同时 running；20 次切换后各自 messages、timer、model、queue 正确。
- A 展开 earlier messages、折叠 Tool output、写 draft；切 B 再返回 A，三者恢复。
- B 的 poll 比 A 先返回；每个结果仍写入原 session。
- bridge 重启后从 session JSON 恢复 messages/LLM history，frontend view 只恢复允许的 UI state。

#### Base

- 单 session、无并发、无重启，行为与当前产品一致。
- 新 session 没有 history/draft/view archive，使用明确默认值。
- session 列表为空时显示 new-session workspace。

#### Bad

- `useEffect(() => setBudget(1), [activeSessionId])`。
- `await pollMessages(id); set({ messages: result.messages })`。
- 为每个组件各保存一份 selected session 对象。
- 对整个 Zustand store 使用默认 localStorage persist。
- session 删除只更新 sidebar，保留 timer、RAF 或 object URL。

### 6. Tests Required

#### Unit: `chat-session-isolation.test.ts`

- A/B response out of order：assert active projection 仍为 active bucket，A/B bucket 内容分别正确。
- same-session generation race：assert old result 不覆盖 new result。
- partial RAF after switch：assert partial 进入 source session。
- two running sessions：assert timer/poll 独立且 running index 正确。
- queue drain：assert B idle 不消费 A queue。
- delete + late load/event：assert bucket 不复活。
- model optimistic update rollback：assert只回滚同一 operation 的旧值。

#### Component: `thread-view-state.test.tsx` and Composer tests

- render budget 展开 → A/B/A：assert `show-earlier-btn` 不重新出现。
- Thinking/Tool/Result disclosure remount：assert显式状态恢复。
- draft/attachments/scroll：assert A/B buckets 不串写。
- removed attachment + late upload：assert attachment 不被重新插入。
- pending upload：assert只禁用对应 session send。

#### Bridge: `test_bridge_sessions.py`

- concurrent snapshot mutation、atomic replace failure、corrupt file isolation。
- restart LLM history/model continuity。
- schema migration、unknown/corrupt version fallback、path/ID validation。

#### E2E / package

- Browser: 两个 running session 至少 20 次切换。
- Native: 长 transcript 展开 → 切换 → 返回。
- Native: bridge restart/Webview refresh 后恢复策略符合字段矩阵。
- macOS/Windows 正式包至少各验收一次。

修改本规范触发范围内代码时，PR 描述必须列出实际执行的上述测试子集和未执行原因。

### 7. Wrong vs Correct

#### Wrong: state follows the active component

```ts
const [budgetMultiplier, setBudgetMultiplier] = useState(1);

useEffect(() => {
  setBudgetMultiplier(1);
}, [activeSessionId]);
```

这会把“session A 已展开”错误解释为“当前 Thread 实例的临时状态”。

#### Correct: state follows the session identity

```ts
const viewId = sessionViewId(activeSessionId);
const budgetMultiplier = useThreadViewStore(
  (state) => state.viewBySessionId[viewId]?.renderBudgetMultiplier ?? 1,
);
const setRenderBudget = useThreadViewStore((state) => state.setRenderBudget);

function showEarlier() {
  setRenderBudget(activeSessionId, budgetMultiplier + 1);
}
```

#### Wrong: duplicate authority

```ts
set({ sessionsById: next, messages: unrelatedMessages });
```

#### Correct: bucket first, projection derived in the same transaction

```ts
set((state) => {
  const next = updater(state.sessionsById[sessionId]);
  return {
    sessionsById: { ...state.sessionsById, [sessionId]: next },
    ...(state.activeSessionId === sessionId ? activeProjection(next) : {}),
  };
});
```

## Review checklist

- [ ] 每个新增 state 字段标注 scope、owner、durability、cleanup。
- [ ] 所有 session mutation 显式接收 `sessionId`。
- [ ] async operation 有 generation/operation ID 或 AbortSignal。
- [ ] session switch 不 reset 旧 bucket。
- [ ] delete/reconnect 路径清理资源且防止晚到复活。
- [ ] persistence 是 versioned partial schema，不含运行期对象。
- [ ] active projection 没有新增镜像字段。
- [ ] store、component、bridge、E2E 测试按风险覆盖。
