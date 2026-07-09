# Tauri Shell Chrome & Window Drag

> macOS 顶部壳层对象模型、窗口拖拽实现契约、drag/click 分离架构。

---

## 1. Scope / Trigger

当修改以下内容时必须参照本文档：
- 顶部 titlebar / drag region 相关 CSS 或 DOM
- `AppLayout.tsx` 或 `TitlebarControls.tsx` 结构
- Tauri window 配置（`tauri.conf.json` 中 `titleBarStyle`、`title`）
- 任何涉及 `-webkit-app-region` 的变更
- 顶部区域的按钮/控件布局

---

## 2. Critical Gotcha: `-webkit-app-region: drag` 在 Tauri v2 / WKWebView 上完全无效

> **Warning**: 不要使用 CSS `-webkit-app-region: drag` 实现窗口拖拽。
>
> 在 Tauri v2 + macOS WKWebView 环境下，该属性**静默失效**：
> - Full-width overlay (`::before` + `position: fixed`) — 无效
> - Narrow carve-out strips (`position: absolute`) — 无效
> - 有无 `pointer-events: none` — 均无效
>
> 这与 Electron / Chromium 行为完全不同。Electron 上 `-webkit-app-region: drag` 工作正常，
> 但 WKWebView 不会将该 CSS 属性注册到 compositor 的 drag hit testing 中。

---

## 3. Correct Pattern: Event-Delegated Drag on Layout Root

### Signatures

```typescript
// AppLayout.tsx
function useDragWindow() {
  return useCallback((e: React.MouseEvent) => {
    if (e.button !== 0) return;
    const target = e.target as HTMLElement;
    if (target.closest('button, a, input, [data-no-drag]')) return;
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const y = e.clientY - rect.top;
    if (y > 38) return;
    e.preventDefault();
    const tauri = (window as any).__TAURI__;
    tauri?.window?.getCurrentWindow?.()?.startDragging?.();
  }, []);
}
```

### How it works

1. Single `onMouseDown` on `.ga-app-layout` (the root element)
2. Filter: left-click only, y within titlebar height, target is not interactive
3. No separate drag strip divs, no z-index layering, no stacking context conflicts

### Required Capability

```json
// src-tauri/capabilities/default.json
{
  "permissions": [
    "core:window:allow-start-dragging"
  ]
}
```

### DOM Structure

```tsx
<div className="ga-app-layout" onMouseDown={onDrag}>
  <TitlebarControls />  {/* absolute, z-index: 999, no-drag cluster */}
  <div className="ga-app-body">...</div>
  <Statusbar />
</div>
```

---

## 4. Shell Geometry Contract (CSS Variables)

```css
:root[data-platform="macos"] {
  --ga-titlebar-height: 38px;
  --ga-titlebar-controls-left: 72px;   /* after traffic lights */
  --ga-titlebar-controls-top: 6px;     /* vertical center with traffic lights */
}
```

### Traffic Light Positioning (Tauri v2.4+)

```json
// tauri.conf.json → app.windows[0]
"trafficLightPosition": { "x": 13, "y": 13 }
```

macOS defaults are approximately `(7, 7)`. We shift down to align traffic light vertical center (~19px) with our fold button center (~20px). This is a native NSWindow API exposed via Tauri config — CSS cannot move traffic lights.

### Stacking Context Isolation

```css
.ga-app-layout { position: relative; }           /* creates root stacking context */
.ga-titlebar-controls { position: absolute; z-index: 999; } /* always on top */
```

No z-index isolation needed on `.ga-app-body` — event delegation eliminates drag/click z-index conflicts entirely. Semi's internal z-indexes (ResizeItem z:10) are harmless because TitlebarControls at z:999 always wins.

---

## 5. Object Layer Model (4 layers)

| Layer | Responsibility | GenericAgent Implementation |
|-------|---------------|---------------------------|
| 1. System window shell | `titleBarStyle: "Overlay"`, `title: ""`, `trafficLightPosition` | `tauri.conf.json` |
| 2. Shell geometry contract | CSS variables propagated globally | `:root[data-platform="macos"]` in `layout.css` |
| 3. Event-delegated drag | Single mousedown handler with hit-test filter | `useDragWindow()` on `.ga-app-layout` |
| 4. Control clusters | Interactive buttons, filtered by `closest('button, a, input')` | `TitlebarControls` (left cluster, absolute z:999) |

---

## 5a. Panel Collapse & Drag Coexistence

Collapsible panels (e.g., Conductor WorkerPanel) must preserve both drag and click behavior across states:

### Contract

1. **Never unmount the panel entirely** — collapse by shrinking width (16rem → 2.5rem), not by conditional render. This keeps the toggle button in the same DOM position across states.
2. **Panel header retains `position: relative; z-index: 60`** — ensures the toggle button stays above drag strips in both expanded and collapsed states.
3. **Don't elevate entire rail containers** — giving a full-width rail `z-index: 60` blocks drag on the empty areas above it. Only elevate the specific interactive elements (buttons).
4. **Collapsed state hides chrome** — `border-bottom: none` on collapsed header to avoid orphaned dividers.

### Implementation

```tsx
// Panel always renders, width controlled by collapsed prop
<div className={`collab-worker-panel ${collapsed ? 'collab-worker-panel--collapsed' : ''}`}>
  <div className="collab-worker-panel-head">
    {!collapsed && <span>Title</span>}
    <button onClick={onToggle}>...</button>  {/* always in same position */}
  </div>
  {!collapsed && <div className="collab-worker-list">...</div>}
</div>
```

```css
.collab-worker-panel--collapsed { width: 2.5rem; }
.collab-worker-panel--collapsed .collab-worker-panel-head {
  justify-content: center;
  border-bottom: none;
}
```

### Why not conditional render (`{open && <Panel />}`)

When the panel is unmounted, the toggle must move to a different container (e.g., WorkerRail). This creates two problems:
- The button physically shifts position on screen (different parent, different layout context)
- The new container may need its own z-index elevation, which then blocks drag on its empty areas

---

## 6. Drag Geometry (Event Delegation)

```
┌─────────────────────────────────────────────────────────────┐
│  mousedown anywhere in top 38px that is NOT button/a/input  │
│  → startDragging()                                          │
└─────────────────────────────────────────────────────────────┘
  height: 38px (--ga-titlebar-height)
```

- No separate drag strip divs needed
- Interactive elements are excluded by `target.closest('button, a, input, [data-no-drag]')`
- `y > 38` check ensures only titlebar zone triggers drag
- Works regardless of page content, panel state, or stacking context

---

## 7. Validation & Error Matrix

| Condition | Expected | Failure Mode |
|-----------|----------|--------------|
| mousedown on Strip A/B | `startDragging()` called, window moves | If `__TAURI__` undefined (browser), no-op (graceful) |
| click on TitlebarControls button | Normal DOM click fires | If strip z-index > button z-index, click swallowed |
| click on page-top objects (below 38px) | Normal interaction | If drag strip height exceeds 38px, interference |
| click on collapsed panel toggle | Normal DOM click fires | If parent rail elevated z-index covers drag strip, drag breaks on empty areas |
| panel collapse/expand toggle | Button stays in same screen position | If panel unmounts and button moves to different container, position shifts |
| Missing `allow-start-dragging` capability | `startDragging()` silently fails | Window won't drag; add capability |
| `titleBarStyle` not "Overlay" | Traffic lights in separate bar | Layout shifts; strip geometry wrong |

---

## 8. Good/Base/Bad Cases

### Good
```tsx
// Event delegation — single handler, no z-index conflicts
<div className="ga-app-layout" onMouseDown={onDrag}>
  <TitlebarControls />
  <div className="ga-app-body">...</div>
</div>
```

### Base
```typescript
// Hit-test filter — buttons naturally excluded
if (target.closest('button, a, input, [data-no-drag]')) return;
if (y > 38) return;
```

### Bad
```css
/* NEVER: drag strip divs with z-index — causes stacking context wars */
.ga-drag-strip { position: absolute; z-index: 50; }
/* Then every button needs z-index: 60+ to escape, breaking isolation */
```

---

## 9. Forbidden Patterns

### Don't: CSS `-webkit-app-region: drag` for window dragging

**Why it's bad**: Completely non-functional in Tauri v2 / WKWebView.

**Instead**: Use programmatic `startDragging()` via event delegation.

### Don't: Separate drag strip divs with z-index layering

**Why it's bad**: Creates cascading stacking context conflicts. Every interactive element in the titlebar zone needs its own z-index elevation, which then conflicts with Semi's internal z-indexes (ResizeItem z:10), which then needs body-level isolation, which then traps panel buttons below drag strips. An unwinnable z-index war.

**Instead**: Event delegation on the root element with hit-test filtering. Zero z-index concerns.

### Don't: Elevate entire containers (rail, panel-head) with z-index to escape drag strips

**Why it's bad**: Full-width z-index elevation blocks drag on empty areas of that container.

**Instead**: No drag strips = no escape needed. Buttons are naturally excluded by the event filter.

---

## 10. Tests Required

| Test | Type | Assertion |
|------|------|-----------|
| `useDragWindow` returns stable callback | Unit | `renderHook` → same reference across renders |
| Drag strips render only on macOS | Unit | With `data-platform="macos"` → visible; without → `display: none` |
| TitlebarControls onClick fires | Integration | Click sidebar toggle → store updates `sidebarCollapsed` |
| No `__TAURI__` → no throw | Unit | Call `onDrag` with mock event in browser env → no error |
| Build passes | CI | `npm run build` exits 0 |

---

## 11. Wrong vs Correct

### Wrong — CSS drag region (any variant)
```css
/* Broken in WKWebView, unreliable in Electron with overlapping elements */
:root[data-platform="macos"] .ga-app-layout::before {
  content: '';
  position: fixed;
  top: 0; left: 0; right: 0;
  height: 38px;
  -webkit-app-region: drag;
}
```

### Correct — Programmatic drag on scoped strips
```tsx
function useDragWindow() {
  return useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    const tauri = (window as any).__TAURI__;
    tauri?.window?.getCurrentWindow?.()?.startDragging?.();
  }, []);
}

// In render:
<div className="ga-drag-strip ga-drag-strip--main" onMouseDown={onDrag} />
```

---

## 12. Extension Points

- **Right control cluster**: When added, shrink Strip B's `right` to `calc(right-cluster-width + gap)`
- **Overlay/modal drag**: Full-window overlays can define their own card-top drag strip (same pattern, scoped to overlay)
- **Fullscreen mode**: If traffic lights disappear, Strip A becomes unnecessary; controls shift to `left: 14px` edge inset
- **Double-click to maximize**: Add `onDoubleClick` on strips → `window.toggleMaximize()`
