# GenericAgent Desktop — Hermes Shell 复刻 Handoff

> **技术选型决策：直接复刻 Hermes 技术栈。**
> 抛弃 Semi Design + 手写 CSS 方案，采用 Tailwind CSS + shadcn/ui + nanostores（和 Hermes 完全一致的前端栈）。
> 后端不新增业务逻辑，前端在 bridge 现有 RPC 能力范围内工作，对不存在的 API 留 interface + mock fallback。

---

## 0. 技术栈迁移清单

### 丢弃
- `@douyinfe/semi-ui` + `@douyinfe/semi-icons`
- 手写 `layout.css` / `settings.css`
- Zustand（改用 nanostores，和 Hermes 对齐便于参考）

### 引入
- `tailwindcss` (v4 或 v3) + `@tailwindcss/vite`
- `class-variance-authority` (cva)
- `radix-ui` (Slot, Dialog, Popover, ContextMenu, Tooltip 等)
- `@radix-ui/react-*` 按需
- `nanostores` + `@nanostores/react`
- `@dnd-kit/core` + `@dnd-kit/sortable`
- `@tanstack/react-virtual`
- `lucide-react` 或自建 Codicon subset icon component
- `clsx` + `tailwind-merge` (→ `cn()` utility)

### 保留
- Vite + React 18
- `services/bridge.ts`（现有 bridge layer）
- i18n 框架（简化为 nanostores atom）

---

## 1. 目标架构

```
src/
├── app/
│   ├── shell/              ← AppShell, titlebar, statusbar
│   ├── chat/
│   │   ├── sidebar/        ← 左侧 ChatSidebar (本次重点)
│   │   ├── thread/         ← 消息区
│   │   └── composer/       ← 底部输入 dock
│   ├── settings/           ← Settings overlay
│   └── right-sidebar/      ← terminal / files panel (Phase 5)
├── components/ui/          ← shadcn-style primitives (Button, Input, Sidebar, etc.)
├── lib/
│   ├── utils.ts            ← cn() helper
│   └── icons.ts            ← icon component
├── store/                  ← nanostores atoms
│   ├── layout.ts           ← sidebar open/collapsed, panes
│   ├── session.ts          ← sessions list, selected, working
│   └── profile.ts          ← profiles (future)
├── services/
│   └── bridge.ts           ← 现有 bridge，不改
├── styles.css              ← Tailwind directives + CSS variables
└── main.tsx
```

---

## 2. CSS Variables & Tailwind Config

直接从 Hermes 搬运 design token 层，映射到 Tailwind：

```css
/* styles.css */
@tailwind base;
@tailwind components;
@tailwind utilities;

@layer base {
  :root {
    /* 字体栈 */
    --font-sans: -apple-system, BlinkMacSystemFont, "SF Pro Text", system-ui,
                 "Segoe UI", sans-serif;
    --font-mono: "JetBrains Mono", ui-monospace, SFMono-Regular, Menlo, monospace;

    /* 文字层级 */
    --ui-text-secondary: hsl(0 0% 45%);
    --ui-text-tertiary: hsl(0 0% 55%);
    --ui-text-quaternary: hsl(0 0% 68%);
    --theme-primary: hsl(220 80% 56%);

    /* 背景层级 */
    --ui-row-hover-background: hsl(0 0% 95%);
    --ui-row-active-background: hsl(0 0% 92%);
    --ui-control-hover-background: hsl(0 0% 95%);
    --ui-control-active-background: hsl(0 0% 90%);
    --ui-sidebar-surface-background: hsl(0 0% 99%);
    --ui-stroke-tertiary: hsl(0 0% 90%);
    --sidebar-edge-border: hsl(0 0% 88%);
    --ui-accent: hsl(220 80% 56%);

    /* Composer */
    --dt-card: hsl(0 0% 100%);
    --dt-background: hsl(0 0% 97%);
    --composer-width: 48.75rem;
  }

  .dark {
    --ui-text-secondary: hsl(0 0% 72%);
    --ui-text-tertiary: hsl(0 0% 55%);
    --ui-text-quaternary: hsl(0 0% 40%);
    --theme-primary: hsl(220 80% 65%);
    --ui-row-hover-background: hsl(0 0% 15%);
    --ui-row-active-background: hsl(0 0% 18%);
    --ui-control-hover-background: hsl(0 0% 18%);
    --ui-control-active-background: hsl(0 0% 22%);
    --ui-sidebar-surface-background: hsl(0 0% 8%);
    --ui-stroke-tertiary: hsl(0 0% 20%);
    --sidebar-edge-border: hsl(0 0% 18%);
    --ui-accent: hsl(220 80% 65%);
    --dt-card: hsl(0 0% 12%);
    --dt-background: hsl(0 0% 6%);
  }
}
```

---

## 3. 左侧 Sidebar 实现规格

### 3.1 组件树

```tsx
<Sidebar collapsible="none" className="relative h-full min-w-0 overflow-hidden border-r border-(--sidebar-edge-border) bg-(--ui-sidebar-surface-background)">
  <SidebarContent className="gap-0 overflow-hidden bg-transparent px-2.5">
    {/* Nav group */}
    <SidebarGroup className="shrink-0 p-0 pb-2 pt-10">
      <NavRail />
    </SidebarGroup>

    {/* Search */}
    <SearchField />

    {/* Sessions */}
    <div className="flex min-h-0 flex-1 flex-col overflow-y-auto overflow-x-hidden pb-2">
      <SessionsSection label="Pinned" ... />
      <SessionsSection label="Sessions" ... />
    </div>

    {/* Profile Rail */}
    <ProfileRail />
  </SidebarContent>
</Sidebar>
```

### 3.2 精确尺寸 Token（直接照搬 Hermes chrome.tsx）

```typescript
// components/ui/sidebar-row.tsx
export const ROW_MIN_H = 'min-h-[1.625rem]'        // 26px
export const ROW_PAD_X = 'pl-2 pr-1'                // 8px / 4px
export const ROW_GAP = 'gap-1.5'                    // 6px
export const ROW_LEAD = 'grid size-3.5 shrink-0 place-items-center' // 14px
export const ROW_LABEL = 'min-w-0 truncate text-[0.8125rem] leading-none text-(--ui-text-secondary)'
export const LEAD_ICON_SIZE = '0.875rem'            // 14px
```

### 3.3 Section Header

```tsx
export function SectionHeader({ label, count, open, onToggle }) {
  return (
    <div className="group/section flex shrink-0 items-center justify-between gap-1 pb-1 pt-1.5">
      <button className="flex items-center gap-1 bg-transparent text-left" onClick={onToggle}>
        <SidebarPanelLabel>{label}</SidebarPanelLabel>
        <span className="text-[0.6875rem] font-medium text-(--ui-text-quaternary)">{count}</span>
        <DisclosureCaret open={open}
          className="text-(--ui-text-tertiary) opacity-0 transition group-hover/section:opacity-100" />
      </button>
    </div>
  )
}

// SidebarPanelLabel — 照搬 Hermes shell/sidebar-label.tsx
export function SidebarPanelLabel({ children }) {
  return (
    <span className="flex min-w-0 items-center gap-2 pl-2 text-[0.64rem] font-semibold uppercase tracking-[0.16em] text-(--theme-primary)">
      <span className="inline-block size-2 shrink-0 rounded-[1px] bg-(--theme-primary)" />
      <span className="min-w-0 truncate leading-none">{children}</span>
    </span>
  )
}
```

### 3.4 Session Row

```tsx
export function SessionRow({ session, isSelected, isWorking }) {
  return (
    <div className={cn(
      ROW_MIN_H, 'group grid grid-cols-[minmax(0,1fr)_auto] items-stretch rounded-md cursor-pointer transition-colors duration-100 ease-out',
      'hover:bg-(--ui-row-hover-background) hover:transition-none',
      isSelected && 'bg-(--ui-row-active-background)',
      isWorking && 'text-foreground',
    )}>
      <button className={cn(ROW_PAD_X, ROW_GAP, 'flex h-full min-w-0 items-center self-stretch py-0.5 bg-transparent text-left')}>
        <span className={ROW_LEAD}>
          <StatusDot status={isWorking ? 'working' : 'idle'} />
        </span>
        <span className={cn(ROW_LABEL, 'flex-1 font-normal group-hover:text-foreground')}>
          {session.title}
        </span>
      </button>
      {/* hover-only actions */}
      <span className="text-[0.625rem] text-(--ui-text-tertiary) opacity-0 group-hover:opacity-100 self-center pr-2">
        {session.age}
      </span>
    </div>
  )
}
```

---

## 4. Bridge 接口契约（前端留口，不新增后端）

```typescript
// services/session-api.ts — 纯 interface，bridge 有就用，没有就 mock

export interface SessionInfo {
  id: string
  title: string | null
  started_at: number
  last_active: number
  is_active: boolean
  preview: string | null
  model: string | null
  source: string | null
}

export interface SessionApi {
  listSessions(limit?: number, offset?: number): Promise<{ sessions: SessionInfo[]; total: number }>
  getSession(id: string): Promise<SessionInfo>
  deleteSession(id: string): Promise<void>
  searchSessions(query: string): Promise<{ results: SessionInfo[] }>
}

// 实现：尝试 bridge RPC，fallback mock
export function createSessionApi(): SessionApi {
  return {
    async listSessions(limit = 50, offset = 0) {
      // TODO: when bridge supports 'sessions/list' RPC, call it
      return { sessions: MOCK_SESSIONS.slice(offset, offset + limit), total: MOCK_SESSIONS.length }
    },
    // ...
  }
}
```

同理定义：
- `CronApi` — listJobs / triggerJob / getJobRuns
- `ProfileApi` — listProfiles / selectProfile / createProfile
- `ProjectApi` — listProjects / getProjectTree

每个 API 都是 interface + mock 实现，bridge 能力到了直接接上。

---

## 5. Nanostores 状态设计

```typescript
// store/session.ts
import { atom, computed } from 'nanostores'

export const $sessions = atom<SessionInfo[]>([])
export const $selectedSessionId = atom<string | null>(null)
export const $workingSessionIds = atom<string[]>([])
export const $sessionsLoading = atom(false)

// store/layout.ts
export const $sidebarOpen = atom(true)
export const $sidebarPinsOpen = atom(true)
export const $sidebarSessionsOpen = atom(true)
```

---

## 6. 实施阶段

| Phase | 交付物 | 依赖 |
|---|---|---|
| 0 | Tailwind + shadcn/ui 基础搭建，cn() utility，CSS variables，移除 Semi | 无 |
| 1 | 左侧 Sidebar 完整实现（nav + search + sections + session row + profile rail） | Phase 0 |
| 2 | Composer dock（glass surface + input + controls + inline/stacked 双模式） | Phase 0 |
| 3 | Thread 消息区（message list + streaming + tool call 折叠） | Phase 2 |
| 4 | Settings overlay（左右分栏 + appearance + model config） | Phase 0 |
| 5 | Right sidebar（terminal + file tree） | Phase 1 |

**Phase 0 + 1 是本次最小可交付。**

---

## 7. 不做的事

- **不新增后端 RPC endpoint** — 前端定义 interface + mock
- **不实现真实 session 持久化** — mock data 演示 UI
- **不接入 WebSocket streaming** — composer/thread 留好接口但用静态消息
- **不做 Electron/Tauri shell** — 纯 web，保持 Vite dev server
- **不实现 project/workspace 完整逻辑** — 只做 UI 壳，数据 mock

---

## 8. 验收标准

Phase 1 完成后，应该能看到：
1. 左侧 sidebar 有 nav rail（4 个按钮，28px 高，active 态有 border + fill）
2. Search field 正确位置
3. Section headers 有 uppercase primary-color label + dither dot + count chip
4. Session rows 有 26px 高、14px lead dot、13px label、hover 时出现 age + actions
5. Dot 三态（idle 4px / working 6px+ping / attention 6px+amber）
6. Profile rail 在底部（20px squares + 拖拽排序 + active ring）
7. Dark mode 切换正常
8. Sidebar resize 200-340px 正常
