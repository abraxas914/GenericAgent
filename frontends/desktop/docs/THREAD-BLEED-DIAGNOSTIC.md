# Thread 内容穿透 Composer 诊断报告

> 2026-07-05 — 排错日志

---

## 现象

暗色/亮色模式下，当消息列表足够长需要滚动时，transcript 文字在 Composer 的半透明玻璃层下方依然可见（穿透）。

## 布局结构分析

```
.chat-view-root (position: relative; overflow: hidden; 100%×100%)
  ├── [data-slot="thread-root"]        (relative; grid; h:100%; contain: layout paint)
  │     └── [data-slot="aui_thread-viewport"]  (overflow-y: auto — THE SCROLLER)
  │           └── [data-slot="aui_thread-content"]  (max-w:780px; flex-col; gap:1.25rem)
  │                 ├── messages...
  │                 └── [data-slot="aui_composer-clearance"]  (height: var(--thread-last-message-clearance))
  │
  └── [data-slot="composer-root"]      (absolute; bottom:0; left:50%; z:30)
        └── [data-slot="composer-surface"]  (glass: 85% opac + backdrop-blur)
```

**关键参数**:
- `--thread-last-message-clearance: calc(var(--composer-measured-height, 62px) + 2rem)` — 约 94px
- `composer-root` padding: top 0.5rem + bottom 1rem = 1.5rem
- `composer-surface` background: `color-mix(in srgb, var(--semi-color-bg-0) 85%, transparent)`

## 根因

Composer 使用 `position: absolute; bottom: 0` 浮在 Thread 之上。Thread 滚动区 (viewport) 和 Composer 的可视区域**物理重叠**。

`aui_composer-clearance` 的作用是在内容末尾留白，使「最后一条消息滚到底时」不被 Composer 遮挡。**但中间位置滚动时**，被 Composer 覆盖的区域里仍然有渲染好的文本内容——只不过被半透明玻璃层遮住了一部分。

透明度 15% = 文字穿透清晰可见。

## 为什么 padding-bottom 失败

尝试方案：给 `thread-root` 添加 `padding-bottom` 等于 Composer 高度，让 viewport 的可见滚动区域缩短，使内容物理上不渲染到 Composer 覆盖区域。

**失败原因**:
1. `thread-root` 使用 `display: grid; grid-template-rows: minmax(0, 1fr)` — padding-bottom 会被 grid 计算吃掉，viewport 仍然占满 grid row
2. `contain: layout paint` 在 thread-root 上 — 改变 padding 不影响内部滚动区的裁剪边界
3. 如果加在 viewport 本身：viewport 的 `height: 100%` 基于 grid row 高度，加 padding-bottom 只会推内容但不改变**可视渲染区**。滚动区仍会在 padding-bottom 之上渲染文本
4. 与 `aui_composer-clearance` 的意图冲突——clearance 已经处理了「滚到底时的空白」，padding-bottom 额外加空白会导致底部多出双倍空白

**核心矛盾**: padding/margin 改变的是**布局空间**而非**视觉裁剪边界**。overflow:auto 容器里，内容在整个 viewport 的 `clientHeight` 范围内都是可见的，padding 不会让底部区域变成裁剪区。

---

## 方案对比

### 方案 A: Viewport 底部 clip-path / mask 裁剪

```css
[data-slot="aui_thread-viewport"] {
  mask-image: linear-gradient(to bottom,
    black 0%,
    black calc(100% - var(--thread-last-message-clearance)),
    transparent 100%
  );
}
```

| 维度 | 评价 |
|------|------|
| 效果 | 内容接近底部时渐隐消失 |
| 玻璃效果 | ✅ 保留 |
| Sticky msg | ⚠️ sticky 用户消息进入 mask 区域也会被裁掉 |
| 视觉 | ❌ 有可见的渐隐区域，违反「无渐隐/色块」约束 |
| 复杂度 | 低 |

**结论**: 违反约束（无渐隐），且影响 sticky。

### 方案 B: Viewport 高度缩短 + Composer 区域独立

将 Composer 从 `absolute` 改为文档流内的 flex 布局兄弟：

```css
.chat-view-root {
  display: flex;
  flex-direction: column;
}
[data-slot="thread-root"] {
  flex: 1;
  min-height: 0;
}
[data-slot="composer-root"] {
  position: relative;   /* 不再 absolute */
  flex-shrink: 0;
}
```

然后移除 `aui_composer-clearance`，因为不再需要。

| 维度 | 评价 |
|------|------|
| 效果 | ✅ 完全解决穿透——Thread 渲染区物理上不与 Composer 重叠 |
| 玻璃效果 | ⚠️ 失去。Composer 下方没有内容可 blur，glass 变成普通 bg |
| Sticky msg | ✅ 不受影响 |
| Stick-to-bottom | ✅ scrollRef 尺寸变了但逻辑不变 |
| 视觉 | 干净，但失去 glass 的高级感 |
| 复杂度 | 中（需改 chatView.css + composer.css + 移除 clearance） |

**结论**: 根治穿透但牺牲 glass 效果。

### 方案 C: 保持 absolute Composer + viewport overflow clip

在 viewport 外加一个 **clip 容器**：让 viewport 的渲染溢出被裁剪到只显示 "Composer 之上" 的区域：

```css
[data-slot="thread-root"] {
  /* 已有 contain: layout paint — 这本身就是裁剪！ */
  /* 关键：让 viewport 的实际高度小于 thread-root */
  padding-bottom: var(--thread-last-message-clearance);
  box-sizing: border-box;
}
[data-slot="aui_thread-viewport"] {
  height: 100%;  /* 这里的 100% 是 grid row height 减去 padding */
}
```

等等——上面的分析说 grid 会吃掉 padding。那换一种：**不用 grid**：

```css
[data-slot="thread-root"] {
  display: flex;
  flex-direction: column;
  height: 100%;
  overflow: hidden;
  contain: layout paint;
}
[data-slot="aui_thread-viewport"] {
  flex: 1;
  min-height: 0;
  margin-bottom: var(--thread-last-message-clearance);  /* 缩短 viewport 可视区 */
}
```

不行——margin-bottom 不裁剪渲染。

**真正的方案 C**: viewport 上用 `clip-path: inset()` 精确裁剪底部：

```css
[data-slot="aui_thread-viewport"] {
  clip-path: inset(0 0 var(--thread-last-message-clearance) 0);
}
```

| 维度 | 评价 |
|------|------|
| 效果 | ✅ 内容在 Composer 区域被硬裁切，不可见 |
| 玻璃效果 | ⚠️ 部分失去——被裁掉的区域没有内容了，blur 无源 |
| Sticky msg | ⚠️ sticky 消息进入裁切区也会消失 |
| Stick-to-bottom | ⚠️ 滚动行为看起来正常但视觉上 clearance 需要重新调整 |
| 视觉 | 硬切边，可能比渐隐好但仍是突然消失 |
| 复杂度 | 低 |

**结论**: 简单但 clip-path 会影响 sticky 和 glass。

### 方案 D: 增大 clearance + 保持 glass（推荐）

**核心洞察**: 穿透可见的原因是**用户在中间位置滚动时**内容出现在 Composer 下。如果我们接受「当用户滚到底时最后消息在 Composer 上方」（clearance 已处理），那问题只在「用户往上滚时」。

这时 Composer 下方的内容其实是**已经读过的旧消息**。真正的问题是 glass 只有 85% 不透明度。

**方案**: 给 `composer-root` 加一个与页面底色相同的 `::before` 伪元素作为**不透明底层**，然后 `composer-surface` 保持 glass。

```css
[data-slot="composer-root"]::before {
  content: '';
  position: absolute;
  inset: 0;
  background: var(--semi-color-bg-0);
  border-radius: 0;  /* 覆盖整个 composer-root 区域 */
  z-index: -1;
}
```

| 维度 | 评价 |
|------|------|
| 效果 | ✅ 文字完全被遮挡，不可能穿透 |
| 玻璃效果 | 🟡 surface 本身仍有 glass 外观（border, shadow, blur），但 blur 效果实际为 blur(底色) = 底色本身，视觉上等同于略带毛玻璃质感的实色 |
| Sticky msg | ✅ 不受影响 |
| Stick-to-bottom | ✅ 不受影响 |
| 视觉 | ⚠️ 约束说「不能有可见色块出现在 Composer 周围」——但 ::before 不会比 composer-root padding 区域大 |
| 复杂度 | 极低（纯 CSS 3行） |

**结论**: 最低侵入性，但 glass 效果退化为 "形式上的 glass"。

### 方案 E: Viewport 可见区底部截断（overflow + 独立滚动容器嵌套）（推荐）

在 viewport 和 thread-root 之间加一个**裁剪层**：

```tsx
<div data-slot="thread-root">
  <div data-slot="thread-clip" style={{ overflow: 'hidden', height: '100%', paddingBottom: 'var(--thread-last-message-clearance)' }}>
    <div ref={scrollRef} data-slot="aui_thread-viewport" ...>
```

```css
[data-slot="thread-clip"] {
  overflow: hidden;
  height: 100%;
  padding-bottom: 0;  /* clip 层不加 padding */
}
[data-slot="aui_thread-viewport"] {
  height: calc(100% - var(--thread-last-message-clearance));
  /* viewport 物理高度 = chat 区高度 - composer 遮挡高度 */
}
```

viewport 变矮了 → 可视渲染区在 Composer 之上 → 内容滚出 viewport 底边时被 `overflow:hidden` (来自 thread-root 的 `contain: paint`) 裁掉。

但 clearance 需要保留——它保证「滚到底时最后消息能被完全显示」。viewport 变矮后 clearance 的值要相应减小（或者直接去掉 clearance，因为 viewport 已经短了）。

| 维度 | 评价 |
|------|------|
| 效果 | ✅ 完全解决——渲染区不与 Composer 重叠 |
| 玻璃效果 | ⚠️ 同 B/C——Composer 下方无内容可 blur |
| Sticky msg | ✅ sticky 在 viewport 内，不受影响 |
| Stick-to-bottom | ⚠️ 需要重新计算。scrollHeight 和 clientHeight 的差值变了。BOTTOM_THRESHOLD 可能需要调整 |
| 视觉 | 干净硬切，内容消失在 Composer 下沿 |
| 复杂度 | 中（需改 thread-root 的 grid → flex，调整 viewport 高度计算，调整 clearance） |

**结论**: 理论最正确（分离关注），但改动面较大且 glass blur 失效。

---

## 综合推荐

| 优先级 | 方案 | 理由 |
|--------|------|------|
| 1 | **D (::before 实色底层)** | 最小改动（3行CSS）、不影响 sticky/scroll、保持 glass 外观形式 |
| 2 | **B (Composer 入流)** | 最干净的架构方案，但需要接受放弃 glass |
| 3 | **E (Viewport 缩短)** | 正确但改动大，且 glass 同样失效 |

**关于 glass 的权衡**: 如果 glass 是硬需求（Composer 下面必须能看到内容透出），那穿透就是 by design 的——不可能同时做到「看得到背后内容」和「看不到背后内容」。三选一：
1. 接受穿透（现状）
2. 接受 glass 退化（方案 D）
3. 完全放弃 glass（方案 B/E）

---

## 下一步

等用户确认选择哪个方案后实施。方案 D 可以在 5 分钟内完成验证。

---

## 实施记录 (2026-07-05)

### 最终方案: D — `::before` 实色底层

#### 实施代码

```css
/* composer.css — 在 [data-slot="composer-root"] 之后 */

/* Opaque backdrop — blocks thread text bleed-through while keeping glass surface above */
[data-slot="composer-root"]::before {
  content: '';
  position: absolute;
  inset: 0.5rem 0 0 0; /* skip padding-top area so text isn't clipped above surface */
  background: var(--semi-color-bg-0);
  border-radius: var(--composer-border-radius, 1rem) var(--composer-border-radius, 1rem) 0 0;
  z-index: -1;
}
```

#### 踩坑: `inset: 0` 导致截断线

**现象**: 第一次实施用 `inset: 0`，文字在 Composer 可见表面上方 ~8px 处被截断，出现一条明显的分界线。

**根因**: `composer-root` 有 `padding-top: 0.5rem`（给 surface 上方留呼吸空间）。`::before` 的 `inset: 0` 从 root 边界开始，比 surface 的视觉上边缘高了 0.5rem — 这就是那条截断线。

**修正**: 改为 `inset: 0.5rem 0 0 0`，`::before` 顶部对齐 surface 的视觉上缘。同时加 `border-radius` 匹配 surface 的圆角。

#### 效果验证

- ✅ 穿透完全消除 — 暗色/亮色模式下无文字可见
- ✅ 无可见色块/分界线 — `::before` 精确对齐 surface 边界
- ✅ Glass 外观保留 — surface 仍有 border + shadow + blur（实际 blur 源为底色）
- ✅ Sticky user message 不受影响
- ✅ Stick-to-bottom 行为正常
- ✅ 暗色/亮色主题均正确（`--semi-color-bg-0` 自动跟随主题）

#### 关键认知

> 不可能同时做到「看得到背后内容」（glass 本意）和「看不到背后内容」（防穿透需求）。
> 方案 D 是最优折中：glass 退化为「形式上的毛玻璃」，视觉上仍有高级感但不再真正透视内容。


---

## 深色模式后续修复 (2026-07-06)

### Fix 1: Composer `::before` 深色模式色差

**现象**: 深色模式下 Composer 区域底部有一块明显更深的色块，与面板背景不协调。

**根因**: `::before` 使用 `var(--semi-color-bg-0)`，但深色模式下：
- `--semi-color-bg-0` = `rgba(22, 22, 26, 1)` — body 最底层色（接近纯黑）
- `--semi-color-bg-1` = `rgba(35, 36, 41, 1)` — 面板实际背景色

亮色模式两者都是白色所以之前没暴露。

**修复**: `composer.css:33`
```css
/* before */
background: var(--semi-color-bg-0);
/* after */
background: var(--semi-color-bg-1);
```

---

### Fix 2: 代码块逐行阴影

**现象**: 深色模式下代码块中每行代码下方有一条半透明阴影带。

**根因**: CSS 特异性冲突 + `display: inline` 逐行渲染：

1. `thread.css:441` 为内联代码设置样式：
   ```css
   [data-slot="aui_markdown-part"] code {
     background: var(--semi-color-fill-0); /* rgba(255,255,255,0.12) in dark */
   }
   ```
2. `CodeBlock.css:66` 试图覆盖：
   ```css
   [data-slot="code-card-body"] code {
     background: none;
   }
   ```
3. 两者特异性相同（各两个属性选择器），thread.css 因加载顺序后置而胜出
4. `code` 默认 `display: inline` — 行内元素的背景按行独立绘制，`line-height > font-size` 时行间出现背景断裂（即"阴影条"）

**修复**: `CodeBlock.css:66`
```css
[data-slot="code-card-body"] code {
  font-family: inherit;
  font-size: inherit;
  background: none !important;  /* 确保胜过 thread.css inline code 规则 */
  padding: 0;
  display: block;               /* block 消除逐行背景分割 */
}
```

**关键认知**:
> `display: inline` + 背景色 = 行间缝隙。这是 CSS 行内格式化模型的固有行为，不是 bug。解法要么去背景，要么改 `display: block`——这里两者都做了作为防御。
