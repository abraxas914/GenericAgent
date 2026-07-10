# Handoff: 白屏排查 — React Track (localhost:5176)

## 症状

- `http://127.0.0.1:5176/` 打开白屏
- HTML 正常返回（`<div id="app"></div>` + `<script type="module" src="/src/main.tsx">`）
- Vite dev server 无报错，HMR 活跃
- `npx tsc --noEmit` 通过
- `npx vite build` 成功
- 所有模块通过 Vite transform 正常提供

## 最近变更

本次 session 在以下文件做了改动（thread-render-quality 任务）：

### 新增文件
- `src/lib/prism-setup.ts` — Prism 语言注册
- `src/hooks/useSmoothReveal.ts` — 字符级 reveal buffer（**刚修过 hooks 顺序问题**）
- `src/hooks/useEnterAnimation.ts` — Web Animations API
- `src/hooks/useToolTimer.ts` — 工具计时推断
- `src/components/chat/Thread/parts/CodeBlock.tsx` — 代码块组件
- `src/components/chat/Thread/parts/CodeBlock.css` — 代码块样式 + Prism token theme
- `src/components/chat/Thread/StreamIndicators.tsx` — loading/stall 指示器

### 修改文件
- `src/components/chat/Thread/parts/MarkdownPart.tsx` — 添加自定义 `code` component + `useSmoothReveal`
- `src/components/chat/Thread/parts/index.tsx` — 添加 `messageId` prop, 集成 indicators
- `src/components/chat/Thread/parts/ToolPart.tsx` — 添加 `useEnterAnimation` + `useToolTimer`
- `src/components/chat/Thread/parts/ResultPart.tsx` — 添加 `useEnterAnimation`
- `src/components/chat/Thread/parts/ThinkingPart.tsx` — mask + shimmer + pinned state
- `src/components/chat/Thread/AssistantMessage.tsx` — 移除 early return, 传递 messageId
- `src/components/chat/Thread/thread.css` — 新增 indicator + thinking 增强样式
- `package.json` — 添加 `prismjs` + `@types/prismjs`

## 排查步骤

1. **打开浏览器 DevTools Console**（`http://127.0.0.1:5176/`）
2. 查看是否有红色 runtime 错误：
   - 如果是 `Invalid hook call` → 某个组件仍有 hooks 顺序问题
   - 如果是 `Cannot read properties of undefined/null` → import 路径或 props 传递问题
   - 如果是 Prism 相关 → `src/lib/prism-setup.ts` 的 import 顺序
3. **如果无报错**：检查 `#app` 是否有子元素（`document.getElementById('app').innerHTML`）
4. **如果 #app 为空**：`main.tsx` 的 `createRoot` 执行了但 `<App />` render 抛错被 React 吞掉
   - 尝试在 Console 运行：`import('/src/App.tsx').then(m => console.log(m))`

## 最可能的 root cause

1. **`useSmoothReveal` 仍有问题**：虽然修过了 hooks 顺序，但如果 HMR 没有完全刷新（stale module cache），old version 可能还在执行。**硬刷新**（Cmd+Shift+R）是第一步。
2. **`react-markdown` Components 类型不兼容**：`MarkdownPart.tsx` 传入的 `components` 对象可能和 react-markdown v10 的 `Components` 类型有 runtime mismatch（TS 通过但 runtime 报错）。
3. **CodeBlock.css 中的 Prism token selectors 导致 CSS parse error**：不太可能导致白屏，但排除一下。

## 快速验证

```bash
# 硬确认是否有 runtime 错误（通过 puppeteer/playwright）
# 在 page.goto('http://127.0.0.1:5176/') 之前注册 console listener
page.on('console', msg => console.log(msg.type(), msg.text()));
page.on('pageerror', err => console.error('PAGE ERROR:', err.message));
await page.goto('http://127.0.0.1:5176/');
await page.waitForTimeout(3000);
const appHtml = await page.$eval('#app', el => el.innerHTML);
console.log('App innerHTML length:', appHtml.length);
```

## 回退方案

如果排查后确认是某个新文件导致的 crash，可以逐步 comment out：

1. 先在 `MarkdownPart.tsx` 中移除 `useSmoothReveal` 调用（直接 `const revealed = content`）
2. 如果仍白屏，移除 `CodeBlock` import，恢复默认 `code` 渲染
3. 如果仍白屏，在 `parts/index.tsx` 移除 `StreamIndicators` import
4. 逐步缩小范围

## 文件位置

```
/Users/ethan/workspace/explore/harness/repos/GenericAgent/.claude/worktrees/frontend-react/frontends/desktop/
```

## Dev server

- PID: 检查 `lsof -iTCP:5176 -sTCP:LISTEN`
- 启动命令: `npx vite --host 127.0.0.1 --port 5176`
