# GenericAgent frontend-react vs Hermes Desktop — Gap Analysis

> 系统对比：识别技术债、微功能缺失、交互逻辑差异
> 基准：Hermes Desktop (`~/.hermes/hermes-agent/apps/desktop/src/`)
> 被评估：GenericAgent frontend-react worktree (`frontends/desktop/src/`)

---

## 总览：6 个 Critical 级差距

| # | 领域 | 核心问题 |
|---|---|---|
| 1 | Streaming 架构 | HTTP 轮询 500ms vs Hermes 的 incremental external-store flush |
| 2 | Message runtime 抽象 | 无 per-part 订阅，每次 poll 整棵树 re-render |
| 3 | Rich editor | 纯 textarea vs contentEditable + chips + @mentions + slash |
| 4 | User message edit | 完全缺失 inline edit + rewind 能力 |
| 5 | Approval 系统 | 无 Run/Reject/Allow UI（terminal/execute_code 安全门） |
| 6 | Gateway RPC | 原始 WS notification vs 全双工 typed gateway |

---

## 1. 结构性技术债

| Gap | Hermes | GenericAgent | 严重度 |
|---|---|---|---|
| Message runtime | `@assistant-ui/react` 提供 per-message / per-part granular subscription，只有 streaming 的 leaf part re-render | 整个 `messages[]` 数组每 500ms 从 bridge poll 后 setState → 全 tree re-render | **Critical** |
| Part 类型路由 | `MESSAGE_PARTS_COMPONENTS` 常量对象（稳定引用），by type 路由到 Reasoning / Text / ToolGroup | `switch(segment.type)` 在 render 内，每次创建新 closure | Medium |
| Store 粒度 | nanostores 每个 atom 独立（`$sessions`, `$busy`, `$currentUsage`），组件只订阅需要的 atom | 单一 `useChatStore` Zustand store，所有 chat 状态在一个 slice，selector 切分不够细 | Medium |
| CSS 架构 | Tailwind utility classes + CSS variables，零 specificity 冲突 | 手写 BEM-ish CSS + Semi 组件内联覆写，存在 `!important` 和层级嵌套 | Low |
| 错误边界 | `MessageRenderBoundary` 包裹每个 group，单条消息渲染崩溃不影响其他 | 无错误边界，一条消息 parse 失败可能白屏 | Medium |

---

## 2. Streaming 交互逻辑差异

| Gap | Hermes | GenericAgent | 严重度 |
|---|---|---|---|
| 传输层 | Gateway WebSocket + incremental external store → 每个 token 直接写入 per-message store，触发最小粒度 re-render | HTTP GET `/api/chat/stream_status` 每 500ms 轮询，获取整个 messages 数组差异 | **Critical** |
| Smooth reveal | `useSmoothReveal`：500ms drain、30 chars/frame、33ms floor → 把 bursty token 到达平滑为视觉连续打字 | 无平滑层，poll 到什么直接渲染什么（可能出现大段跳变） | **Critical** |
| Deferred rendering | `useDeferredValue` 包裹 Markdown render → React 可以打断重计算，保持 UI 响应 | 同步渲染，长 markdown 可能阻塞 input | Medium |
| Stall detection | `StreamStallIndicator`：检测 token 停顿 → 显示 "thinking..." 或 spinner | 无 stall 检测，streaming 卡住时用户无任何反馈 | Medium |
| Cancel | `onCancel` → 发 gateway RPC `session.stop` → 立即反映在 UI（button 变 disabled） | 有 cancel 按钮但通过 bridge HTTP POST，无乐观 UI 更新 | Low |

---

## 3. UserMessage 呈现差异

| Gap | Hermes | GenericAgent | 严重度 |
|---|---|---|---|
| Sticky bubble | `position: sticky; top: var(--sticky-human-top)` + Fragment pattern（不用 wrapper div 避免 containing block 问题） | 有 sticky 但用了包裹 div → 可能在极端长 turn 中失效 | Medium |
| Clamp + fade | `max-height: calc(4 * line-height * font-size)` + CSS mask gradient fade | 有 2-line clamp 但用 `-webkit-line-clamp`（不等价，无 gradient fade） | Low |
| Inline edit | 点击 bubble → `ActionBarPrimitive.Edit` → inline composer 替换 bubble → 编辑后 resubmit | **完全缺失** | **Critical** |
| Restore / Rewind | `onRestoreToMessage` → confirm dialog → 回退到指定消息重新开始 | 缺失 | Medium |
| Branch picker | `BranchPicker`：显示 checkpoint，可切换到同一 user message 的不同 assistant 分支 | 缺失 | Low |
| Process notification | 正则检测 `[IMPORTANT: Background process...]` → 不渲染 bubble，改为 centered muted note | 所有 user message 统一渲染为 bubble，含系统注入的进程通知 | Low |
| Attachments | 支持图片/文件 attachments 在 bubble 上方，独立滚动 | 缺失 | Medium |
| UserMessageText 管线 | `splitFences` → `splitInlineCode` → `DirectiveContent`（解析 @file: @image: chips） | 纯文本渲染，无 fence/code/chip 解析 | Medium |

---

## 4. AssistantMessage 差异

| Gap | Hermes | GenericAgent | 严重度 |
|---|---|---|---|
| Parts pipeline | `MESSAGE_PARTS_COMPONENTS` 常量路由：Reasoning / Text / ToolGroup / tools.Fallback | `switch` 路由：markdown / thinking / tool_call / tool_result / summary | Medium（结构在但不够稳定） |
| Footer stability | ActionBar **不 unmount** streaming 时（opacity-0 + pointer-events-none）→ 避免所有历史消息高度 reflow | streaming 时 footer 完全隐藏（unmount）→ 完成时所有消息跳动 | Medium |
| Enter animation | `useEnterAnimation(isRunning, key)` — 只有首次 streaming 挂载时才有 fade-in，历史消息静态 | 无 enter animation | Low |
| Error rendering | 专用 `ErrorPrimitive.Root` + `text-[0.78rem]` + destructive color mix | 简单 `<span className="error">` | Low |
| Preview attachments | 从完成的 assistant text 中提取 localhost URL → `PreviewAttachment` 卡片 | 缺失 | Low |
| Lazy text accessor | `getMessageText` 用 callback 而非 prop → footer copy 按钮不在每 delta 重渲染 | copy 按钮直接读 `message.content` prop → 每次 streaming re-render | Medium |

---

## 5. Composer 差异

| Gap | Hermes | GenericAgent | 严重度 |
|---|---|---|---|
| Rich editor | `contentEditable` div + hidden textarea binding → 支持 @file: @session: chips、不可编辑 node、IME 处理 | 纯 `<textarea>` | **Critical** |
| Glass surface | `backdrop-blur-[0.75rem] backdrop-saturate-[1.12]` + fill 状态机（4 档） | 有 `backdrop-filter: blur(12px)` 但无 fill 状态机（只一档） | Medium |
| Inline/Stacked 双模式 | 宽度 < 320px 或多行时自动切换 grid layout | 固定单一 layout，窄屏时挤压 | Medium |
| Status stack | `ComposerStatusStack`：queue/todos/background task/subagent 状态堆栈在 composer 上方 | 缺失 | Medium |
| Voice input | dictation button + voice conversation mode + auto-speak replies | 缺失 | Low |
| Completion popover | slash command / @ mention / URL dialog → 与 composer 共用 fill 语义 | 缺失 | Medium |
| Model pill | Composer 内嵌模型选择 quick-switch pill | 缺失（模型选择在别处） | Low |
| Attachment strip | 拖拽/粘贴文件 → thumbnail strip 在 composer 内 | 有基础文件上传但无 thumbnail strip | Low |

---

## 6. 滚动管理差异

| Gap | Hermes | GenericAgent | 严重度 |
|---|---|---|---|
| Stick-to-bottom 实现 | `use-stick-to-bottom` 库：`initial: 'instant', resize: 'instant'` | 自写 `useStickToBottom` hook（`useRef` + `scrollTop` 直写） | Medium（功能对了但稳定性差） |
| Session 切换稳定 | `stopScroll` → 立即置底 → rAF loop 等 scrollHeight 稳定 (5帧/90帧上限) → 恢复 stick | 简单 `scrollTop = scrollHeight` 无等待稳定 → 可能在图片加载后跳动 | Medium |
| overflow-anchor | `data-following` / `data-editing` 条件切换 `overflow-anchor: auto/none` | 无 overflow-anchor 管理 | Low |
| Scroll-to-bottom button | 带 approval-needed 变体 + scale 进出动画 + `bottom: calc(composer + stack + 0.625rem)` 精确定位 | 有 button 但固定定位，无 approval 变体 | Low |
| Render budget | 300 parts weight → "Show earlier" prepend → `restoreFromBottom` 保持 scroll position | 无 render budget，长会话全量渲染 → 性能线性退化 | **Critical**（长会话场景） |

---

## 7. Tool 渲染差异

| Gap | Hermes | GenericAgent | 严重度 |
|---|---|---|---|
| Disclosure row | `DisclosureRow`：header(glyph + title + duration + subtitle) + expandable body + border shell | 简单 `<Collapsible>` 包裹，无 glyph/duration/subtitle | Medium |
| Status glyphs | running=spinner(breathe) / error=AlertCircle(destructive) / warning=AlertCircle(amber) / success=CheckCircle2(emerald) | running=spinner / 其他无区分 | Medium |
| Approval inline bar | Run(⌘Enter) + dropdown(Allow session/Always/Reject) + fallback pill when out of viewport | **完全缺失** | **Critical** |
| Opacity fade | tool-block 默认 opacity 0.67 → hover/focus 1 → 120ms transition | 无 opacity 分级，tool 和 prose 同等强度 | Low |
| Tool icon routing | 按 toolName 映射不同 icon（terminal, browser, file, search...） | 统一 tool icon | Low |
| Duration timer | 实时 elapsed 计时（activity-timer.ts 模块级 Map 持久化） | 无计时 | Low |

---

## 8. 代码块差异

| Gap | Hermes | GenericAgent | 严重度 |
|---|---|---|---|
| CodeCard chrome | `rounded-[0.625rem] border` + header(language + copy + expand) + body(mono 0.7rem) | Semi `CodeHighlight` 组件，样式由 Semi 控制 | Medium |
| Expandable block | collapsed `max-h-[7.5rem]` → expanded `max-h-[40dvh]`，阈值 `scrollHeight > 121` | 无折叠，长代码块全量展示 | Medium |
| Diff rendering | `parseDiff()` → emerald/rose color tokens + border-left indicator + line numbers | 缺失 | Low |
| Shiki integration | Dual-theme Shiki + budget check（超预算 skip）+ streaming defer | Semi 内置 highlight.js，无 budget | Low |
| Streaming animation | `code-card-stream-enter` keyframe 180ms cubic-bezier | 无 | Low |
| Mermaid / SVG | 专用 `RichCodeBlock` 路由到 mermaid 渲染器或 SVG embed | 缺失 | Low |

---

## 9. 排版/字体/色彩差异

| Gap | Hermes | GenericAgent | 严重度 |
|---|---|---|---|
| CSS variable 系统 | 14 个 `--conversation-*` 变量统一管理所有 thread 排版 | 部分硬编码 px 值在 CSS 中 | Medium |
| Font size hierarchy | 5 级离散字号（9/10/11/13/14px）+ heading scale (13→16px) | 类似但不完全对齐（用了 Semi 的 14px base 而非 13px） | Medium |
| Color tokens | 5 级文字 + 4 级背景，通过 CSS 变量统一 | Semi 的 text-0/1/2/3 体系（已对齐大部分），但 `--theme-primary` / `--ui-accent` 缺少映射 | Low |
| Turn gap | `--conversation-turn-gap: 0.375rem` (6px) | 硬编码 `gap: 8px` | Low |
| Message text indent | `--message-text-indent: 0.75rem` (12px) assistant 左缩进 | 无缩进（assistant 和 user 左对齐一致） | Low |
| Paragraph gap | `--paragraph-gap: 0.7rem` (~11.2px) | 用 Semi 默认的 `<p>` margin（16px） | Low |

---

## 10. 缺失的微功能

| 功能 | Hermes 实现 | GenericAgent 状态 | 严重度 |
|---|---|---|---|
| **Timeline 标尺** | 右侧 vertical ticks + popover preview + jump scroll (170ms easeOutCubic) | 缺失 | Medium |
| **Thinking auto-collapse** | pending→auto-open, complete→auto-close, user-toggle→永久尊重 | 有 thinking 但永久展开（无自动收起） | Low |
| **BiDi 策略** | prose: `unicode-bidi: plaintext`; code: `dir: ltr` isolate; blockquote: `dir: auto` | 无 BiDi 处理 | Low |
| **Activity timer** | 模块级 Map 持久化 startedAt，unmount/remount 不重置 | 缺失 | Low |
| **Branch stems** | `└─` / `├─` mono 字符连接分支消息 | 缺失 | Low |
| **Render budget** | 300 parts weight → "Show earlier" | 缺失 → 100+ 消息时严重卡顿 | **Medium → Critical at scale** |
| **Process notification detection** | 正则 `/^\[IMPORTANT: Background process/` → 不渲染 bubble | 缺失 | Low |
| **Preview attachments** | 从 assistant text 提取 localhost URL → iframe/card | 缺失 | Low |
| **Scroll-to-bottom approval pill** | 当有 pending approval 时变身为 "Approval needed" CTA | 缺失 | Low |
| **Secondary window mode** | 检测 `isSecondaryWindow()` → 调整 titlebar/sticky/padding | 缺失 | Low |

---

## 已对齐的部分 ✓

以下方面你的实现已经和 Hermes 基本对齐：
- Glass-surface composer CSS（blur + saturate）
- Sticky human bubble 基本机制
- Session-switch 时 scroll 置底（虽然不够稳定）
- Tool opacity fade 概念（虽然值不对）
- Font-size 使用 13px base
- Heading scale 方向正确
- Turn-pair grouping 结构
- Agent protocol segment parser 基本覆盖

---

## 建议优先级排序

### P0（不做就不能用）
1. Streaming 架构重写：WebSocket + incremental store → per-part subscription
2. Render budget：100+ 消息性能必须解决
3. Approval 系统：安全门缺失 = 不可上线

### P1（体验严重受损）
4. Rich editor（contentEditable + chips）
5. User message inline edit + rewind
6. Smooth reveal + deferred rendering
7. Footer 不 unmount（布局稳定性）

### P2（明显不如 Hermes）
8. CSS variable 系统统一
9. CodeCard chrome + expandable
10. Tool disclosure row + status glyphs
11. Composer fill 状态机 + inline/stacked
12. Timeline 标尺

### P3（精细打磨）
13. BiDi / thinking auto-collapse / activity timer / branch stems / process notification
