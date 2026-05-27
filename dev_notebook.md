# GADesktop 开发笔记本

## 当前基线
- 分支: main (synced upstream/main e0d05f1)
- 入口: frontends/desktop_bridge.py --port 14168
- 前端文件: frontends/desktop/static/{index.html, styles.css, app.js}

## 代码关联 (Code Memory)
- `.bubble.md` (styles.css L604): 模型回复(assistant)的气泡样式，被 app.js 中 renderMsg 动态添加
- `.bubble` (styles.css L599): 所有消息气泡的基础样式
- `.msg.assistant` (styles.css L597): assistant 消息行布局

## 变更记录

### 2026-05-28: 去掉模型回复灰色气泡
- **改动**: styles.css L604 `.bubble.md` background 从 `var(--line-soft)` → `transparent`
- **原因**: 用户认为灰色气泡不需要，模型回复直接无背景展示
- **影响范围**: 仅影响 assistant 消息的 markdown 渲染气泡外观
- **验证**: CSS规则已确认生效 (background: transparent)

### 2026-05-28: 去掉工具调用/结果的蓝绿色折叠框
- **改动**: styles.css 3处
  - L625 `.fold`: border→none, background→transparent, border-radius→0
  - L628 `.bubble .fold pre`: 去掉 border-top
  - L1402-1403 `.fold.fold-tool` / `.fold.fold-result`: border→none, background→transparent
- **原因**: 蓝色/绿色框太丑，改为无框无背景的简洁折叠样式
- **影响范围**: 工具调用(fold-tool)和工具结果(fold-result)的折叠块外观
- **关联**: app.js L962-964 渲染 `<details class="fold fold-tool/fold-result">`；CSS变量 --fold-tool-border/bg 和 --fold-result-border/bg 仍保留但不再被引用

### 2026-05-28: 折叠框箭头旋转动画
- **改动**: styles.css L626-630 新增5条规则
  - `.bubble .fold summary`: 加 list-style:none, display:flex, align-items:center, gap:4px
  - `summary::-webkit-details-marker`: display:none (Chrome)
  - `summary::marker`: display:none; content:'' (Firefox)
  - `summary::before`: content:'▶', font-size:.7em, transition:transform .2s ease
  - `.fold[open] > summary::before`: transform:rotate(90deg)
- **原因**: 用户要求展开折叠框时箭头有流畅旋转动画
- **效果**: 箭头从右(▶)平滑旋转90°变为朝下，0.2s ease过渡
- **影响范围**: 所有 .bubble 内的 .fold 折叠块（tool/result/thinking/turn）

## 设计原则
- 不硬编码颜色/文本，使用 CSS 变量
- 高内聚低耦合，尽量单文件修改
- 在 app.js / index.html / styles.css 中开发
