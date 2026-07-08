# Hermes 源码精选参考

> 这份文件是 Hermes desktop 源码中最关键的组件结构和 CSS token，供 coding agent 实现时直接对照。
> 源码位置：`~/.hermes/hermes-agent/apps/desktop/src/`

---

## 1. Sidebar Row Geometry（chrome.tsx 精华）

这是所有 sidebar 行的 canonical dimensions，是整个 sidebar 的基底：

```typescript
// apps/desktop/src/app/chat/sidebar/chrome.tsx

const rowMinH = 'min-h-[1.625rem]'     // 26px — 行最小高度
const rowPadX = 'pl-2 pr-1'             // 左8px 右4px
const rowGap = 'gap-1.5'                // 6px — lead-to-label 间距
const rowLead = 'grid size-3.5 shrink-0 place-items-center'  // 14px lead cell
const rowInset = cn(rowPadX, rowGap, 'flex h-full min-w-0 items-center self-stretch py-0.5')
const rowLabel = 'min-w-0 truncate text-[0.8125rem] leading-none text-(--ui-text-secondary)'

export const SIDEBAR_LEAD_ICON_SIZE = '0.875rem' as const  // 14px icons
```

### SidebarRowShell（外框）
```tsx
<div className={cn(rowMinH, 'grid grid-cols-[minmax(0,1fr)_auto] items-stretch rounded-md')}>
  {children}
  {actions && <div className="flex shrink-0 items-center self-center">{actions}</div>}
</div>
```

### SidebarRowStack / SidebarRowNest
```tsx
// Stack: 行列表容器
<div className="grid grid-cols-[minmax(0,1fr)] gap-px" />

// Nest: 缩进子行
<SidebarRowStack className="pb-1 pl-4" />  // pl-4 = 16px indent
```

---

## 2. Section Label（sidebar-label.tsx 完整）

```tsx
// apps/desktop/src/app/shell/sidebar-label.tsx
export function SidebarPanelLabel({ children, className, dotClassName, ...props }) {
  return (
    <span className={cn(
      'flex min-w-0 items-center gap-2 pl-2',
      'text-[0.64rem] font-semibold uppercase tracking-[0.16em] text-(--theme-primary)',
      className
    )}>
      <span aria-hidden="true" className={cn(
        'dither inline-block size-2 shrink-0 rounded-[1px]',
        dotClassName
      )} />
      <span className="min-w-0 truncate leading-none">{children}</span>
    </span>
  )
}
```

---

## 3. Session Row（关键样式提取）

```tsx
// session-row.tsx — Shell 层
<SidebarRowShell className={cn(
  'group relative cursor-pointer transition-colors duration-100 ease-out',
  'hover:bg-(--ui-row-hover-background) hover:transition-none',
  isSelected && 'bg-(--ui-row-active-background)',
  isWorking && 'text-foreground',
  dragging && 'z-10 cursor-grabbing bg-(--ui-sidebar-surface-background)',
)}>

// Label 层
<SidebarRowLabel className="flex-1 font-normal group-hover:text-foreground">
  {title}
</SidebarRowLabel>

// Age（hover-only）
<span className="pointer-events-none absolute right-6 top-1/2 -translate-y-1/2
  text-[0.625rem] leading-none text-(--ui-text-tertiary)
  opacity-0 transition-opacity group-hover:opacity-100">
  {age}
</span>
```

### Lead Dot 三态
```tsx
// idle
<span className="size-1 rounded-full bg-(--ui-text-quaternary) opacity-80" />

// working
<span className="relative size-1.5 bg-(--ui-accent)
  shadow-[0_0_0.625rem_color-mix(in_srgb,var(--ui-accent)_55%,transparent)]
  before:absolute before:inset-0 before:animate-ping before:rounded-full
  before:bg-(--ui-accent) before:opacity-70" />

// needsInput
<span className="quest-glow relative size-1.5 rounded-full bg-amber-500" />
```

---

## 4. Nav Rail（index.tsx 渲染）

```tsx
// 四个 nav 项定义
const SIDEBAR_NAV = [
  { id: 'new-session', icon: 'robot',       action: 'new-session' },
  { id: 'skills',      icon: 'symbol-misc', route: SKILLS_ROUTE },
  { id: 'messaging',   icon: 'comment',     route: MESSAGING_ROUTE },
  { id: 'artifacts',   icon: 'files',       route: ARTIFACTS_ROUTE },
]

// Nav button 样式
className={cn(
  'flex h-7 w-full justify-start gap-2 rounded-md',
  'border border-transparent px-2 text-left',
  'text-[0.8125rem] font-medium text-(--ui-text-secondary)',
  'transition-colors duration-100 ease-out',
  'hover:bg-(--ui-control-hover-background) hover:text-foreground',
  active && 'border-(--ui-stroke-tertiary) bg-(--ui-control-active-background) text-foreground',
)}

// Icon
className="size-4 shrink-0 text-[color-mix(in_srgb,currentColor_72%,transparent)]"
```

---

## 5. Workspace Header（分级排版）

```tsx
// projects/workspace-header.tsx
<div className={cn(
  'group/workspace flex min-h-6 items-center gap-1 px-2 pt-1 text-[0.6875rem]',
  emphasis
    ? 'font-semibold text-(--ui-text-secondary)'   // repo 级
    : 'font-medium text-(--ui-text-tertiary)'       // worktree 级
)}>
```

### Lane Label（头尾分离截断 — 独创）
```tsx
function LaneLabel({ label }) {
  const tailLen = Math.min(14, Math.floor(label.length / 2))
  const head = label.slice(0, label.length - tailLen)
  const tail = label.slice(label.length - tailLen)
  return (
    <span className="flex min-w-0">
      <span className="truncate">{head}</span>
      <span className="shrink-0 whitespace-pre">{tail}</span>
    </span>
  )
}
```

---

## 6. Profile Rail（profile-switcher.tsx 精华）

```tsx
// 容器
<div className="flex items-center gap-0.5" role="tablist">

// Profile Square
<button className={cn(
  'grid size-5 shrink-0 cursor-grab touch-none select-none place-items-center rounded-[3px]',
  'text-[0.5625rem] font-semibold uppercase leading-none transition-opacity hover:opacity-100',
  active ? 'opacity-100' : 'opacity-55',
)}
  style={{
    backgroundColor: profileColorSoft(hue, active ? 30 : 22),
    boxShadow: active ? `inset 0 0 0 1.5px ${hue}` : undefined,
    color: color ?? undefined,
  }}>
  {label.replace(/[^a-z0-9]/gi, '').charAt(0) || '?'}
</button>

// DnD config
const SPRING = 'cubic-bezier(0.34, 1.56, 0.64, 1)'  // easeOutBack
const RAIL_TRANSITION = { duration: 300, easing: SPRING }
// horizontalListSortingStrategy, stepThroughCells (snap to grid)
// triggerHaptic('selection') on cross-cell, triggerHaptic('success') on drop
```

---

## 7. Cron Job Row

```tsx
// cron-jobs-section.tsx
<div className="group/cron relative grid min-h-[1.625rem]
  grid-cols-[minmax(0,1fr)_auto] items-center rounded-md
  hover:bg-(--chrome-action-hover)">

  // 左：dot + label + caret
  <button className="flex min-w-0 items-center gap-1.5 bg-transparent py-0.5 pl-2 pr-1">
    <span className="grid w-3.5 shrink-0 place-items-center">
      <span className={cn('size-1 rounded-full', STATE_DOT[state],
        state === 'running' && 'size-1.5 animate-pulse')} />
    </span>
    <span className="min-w-0 truncate text-[0.8125rem] text-(--ui-text-secondary)
      group-hover/cron:text-foreground">
      {label}
    </span>
  </button>

  // 右：countdown ↔ action buttons 交替
  <span className="text-[0.6875rem] text-(--ui-text-tertiary) tabular-nums
    group-hover/cron:hidden">
    {meta}
  </span>
  <div className="hidden items-center gap-0.5 group-hover/cron:flex">
    {/* trigger + manage buttons, size-5, rounded-sm */}
  </div>
</div>
```

---

## 8. Composer（index.tsx 定位 + 表面）

```tsx
// Composer root positioning
className="absolute bottom-0 left-1/2 -translate-x-1/2 rounded-2xl z-30
  w-[min(var(--composer-width),calc(100%-2rem))]"

// --composer-width: 48.75rem = 780px

// Surface (glass)
className="backdrop-blur-[0.75rem] backdrop-saturate-[1.12]"

// Fill state machine (CSS custom property --composer-fill):
// default:      color-mix(in srgb, var(--dt-card) 72%, transparent)
// scrolled up:  color-mix(in srgb, var(--dt-card) 48%, transparent)
// focus-within: var(--ui-chat-bubble-background)
// drawer-open:  color-mix(in srgb, var(--dt-card) 90%, var(--dt-background))
```

---

## 9. Layout Constants

```typescript
// apps/desktop/src/app/layout-constants.ts
export const PAGE_INSET_X = 'px-[clamp(1.25rem,4vw,4rem)]'
export const SIDEBAR_COLLAPSE_BREAKPOINT_PX = 768
```

---

## 10. Sidebar 整体容器

```tsx
// ChatSidebar return
<Sidebar collapsible="none"
  className={cn(
    'relative h-full min-w-0 overflow-hidden border-t-0 border-b-0 text-foreground transition-none',
    panesFlipped ? 'border-l border-r-0' : 'border-r border-l-0',
    sidebarOpen
      ? 'border-(--sidebar-edge-border) bg-(--ui-sidebar-surface-background) opacity-100'
      : 'pointer-events-none border-transparent bg-transparent opacity-0',
  )}>
  <SidebarContent className="gap-0 overflow-hidden bg-transparent px-2.5">
    {/* Nav group: pt-[calc(var(--titlebar-height)+0.375rem)] */}
    {/* Search: px-2 pb-1 pt-1 */}
    {/* Sessions: flex min-h-0 flex-1 flex-col pb-1.75 overflow-y-auto */}
    {/* Profile rail: shrink-0 px-0.5 pb-1 pt-0.5 */}
  </SidebarContent>
</Sidebar>
```

---

## 11. 关键设计模式总结

| 模式 | 实现策略 | GenericAgent 翻译 |
|---|---|---|
| 统一行高 | chrome.tsx 定义一次，所有 row 继承 | 抽一个 `SessionRow.css` 定义基础 |
| Lead column 对齐 | 14px grid cell，所有 lead 居中 | `.row-lead { width: 14px; display: grid; place-items: center }` |
| Hover 渐进揭示 | `group-hover` 控制 opacity | `.row:hover .reveal { opacity: 1 }` |
| Section 独立滚动 | 各 section max-height + overflow-y-auto | 给每个 section 加 max-height cap |
| 颜色分级 | 5 级 text token，不用 opacity 做层级 | 映射到 Semi 的 text-0/1/2/3 + primary |
| Compact 模式 | CSS variant 清除 max-height | media query 或 data-attr 切换 |
