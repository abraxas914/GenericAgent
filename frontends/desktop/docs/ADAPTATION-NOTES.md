# React 赛道适配笔记

> 从 hermes 赛道 (Tailwind + shadcn) 向 react 赛道 (Semi Design + vanilla CSS) 适配的关键经验。
> 更新: 2026-07-02

---

## 已完成适配

| 组件 | 状态 | 关键文件 |
|------|------|----------|
| NavRail (4 项 Codicon) | ✓ | `components/layout/LeftSidebar.tsx`, `layout.css` |
| Statusbar shell (20px) | ✓ | `components/layout/AppLayout.tsx`, `layout.css` |
| Session section header (collapsible) | ✓ | `components/layout/SessionSectionHeader.tsx` |
| Session row (status dot + age) | ✓ | `components/layout/SessionRow.tsx` |
| Section header hover "+" 新建 | ✓ | `SessionSectionHeader.tsx` onAction prop |
| Codicon icon font | ✓ | `lib/icons.tsx`, `global.css` @font-face |
| Form element font reset | ✓ | `global.css` button/input/select/textarea inherit |
| Search ghost pill 样式 | ✓ | `layout.css` .ga-sidebar-search overrides |

## 踩坑总结

### 1. Button font-weight 渲染偏轻

**现象**: `.ga-nav-btn` 声明 `font-weight: 500` 但视觉比 hermes 赛道轻。

**根因**: 浏览器 UA stylesheet 对 `<button>` 使用 system font 而非继承 parent。Tailwind preflight 默认加了 `button { font: inherit }`，但 react 赛道没有 preflight。

**修正**: `global.css` 加:
```css
button, input, select, textarea {
  font-family: inherit;
  font-size: inherit;
  font-weight: inherit;
  line-height: inherit;
  color: inherit;
}
```

### 2. Icon-text 垂直不对齐

**现象**: Codicon 和旁边文字有 1-2px 偏移。

**根因**: 默认 line-height 1.5 让文字行高大于 icon 实际高度。

**修正**: nav/session 行都加 `line-height: 1`。

### 3. Semi Design 组件样式覆盖

**现象**: Semi 的 `<Input>` 视觉权重过大（厚边框、大 padding）。

**应对**: 用后代选择器 `.ga-sidebar-search .semi-input-wrapper` 覆盖 Semi 内部 class。需要 specificity 胜出 Semi 的 inline styles。

### 4. 中文字号

13px 对中文来说在窄 sidebar 中偏大（中文字形比拉丁宽约 30%）。nav/session 降到 12px (0.75rem) 后视觉密度更合理。Section header 的 0.64rem uppercase label 不受影响。

### 5. User Bubble 暗色模式双框 (2026-07-03)

**现象**: 暗色模式下用户消息出现明显的嵌套双框——外层暗色矩形包裹内层浅色圆角卡片。

**根因**: `thread.css` 中两个嵌套元素都有独立的可见背景:
```
[data-slot="aui_user-message-root"]  →  background: var(--ui-chat-surface-background)  // hsl(0 0% 8%)
  └─ [data-slot="user-bubble"]       →  background: var(--ui-chat-bubble-background)  // hsl(0 0% 14%)
                                         border-radius: 0.75rem
                                         border: 1px solid var(--ui-stroke-tertiary)
```
root 有 `padding-bottom: var(--conversation-turn-gap)` 和 `padding-top: 0.25rem`，导致 8% 底色在 14% 卡片周围露出一圈，形成两个可见矩形。

**修正**:
- `aui_user-message-root`: 改为 `background: transparent; padding: 0;`，纯布局容器不参与视觉渲染
- `user-bubble`: 作为**唯一可见卡片**，`border-radius: 2px`，保留 border + bubble-background

**注意**: root 原本用 background 做 sticky 遮挡。改透明后如果滚动时内容穿透可见，需要将 root background 改为页面底色 `var(--ui-surface-primary)` 而非独立的 surface-background token。

## CSS 变量完整性

所有 hermes token 已在 `global.css :root` 定义，两赛道变量名一致:
```
--foreground, --ui-text-secondary/tertiary/quaternary,
--ui-row-hover-background, --ui-row-active-background,
--ui-control-hover-background, --ui-control-active-background,
--ui-stroke-tertiary, --ui-accent, --theme-primary,
--chrome-action-hover, --ui-sidebar-surface-background
```

## i18n 当前状态

| Key | EN | ZH |
|-----|----|----|
| `nav.chat` | New Session | 新建会话 |
| `section.sessions` | Sessions | 会话 |

## 下一步

- Composer dock (Phase 2)
- Thread 消息区 (Phase 3)
- Context menu (pin/rename/delete) for sessions
- Right sidebar
