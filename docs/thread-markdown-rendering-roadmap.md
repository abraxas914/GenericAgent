# Thread Markdown 渲染稳健化路线图

文档角色：实施路线图 + 测试计划
覆盖范围：React worktree (`frontends/desktop/src/components/chat/Thread/parts/`) 的 Markdown / TeX 渲染管线
参照物：Hermes Desktop `markdown-text.tsx` + `katex-memo.ts` + `markdown-preprocess.ts`

---

## 现状评估

React worktree 已具备完整骨架：

- `MarkdownPart.tsx`：`react-markdown` + `remarkGfm` + `remarkMath` + `rehypeKatex`
- `useSmoothReveal`：rAF 字符级 drain
- `agentProtocol.ts`：turn_segs 解析 + tool/result/thinking/summary/approval 分段
- `thread-grouping.ts`：turn-based grouping
- `CodeBlock.tsx`：Prism.js 高亮 + streaming defer

缺失的核心维度：
1. **输入预处理**（currency dollar / code fence 保护 / math fence 路由）
2. **渲染性能隔离**（deferred value / math memoization / block cache）
3. **边界兜底**（huge text / error fallback / render budget）

---

## 实施阶段

### Phase 1：预处理层（防误匹配）

目标：确保到达 `remark-math` 的文本不含假阳性 math trigger。

#### 1.1 创建 `src/lib/markdown-preprocess.ts`

职责：
- 按 code fence (```` ``` ````) / inline code (`` ` ``) 分段
- Math 相关转换只作用于 prose 段
- Prose 段内执行：
  - `escapeCurrencyDollars`：`$` 后跟数字 → `\$`（`$5`, `$19.99` 不被吃）
  - `rewriteLatexBracketDelimiters`：`\(...\)` → `$...$`, `\[...\]` → `$$...$$`（已有，移入此模块统一管理）

实现模型：
```
input text
  → split by CODE_FENCE_SPLIT_RE
  → prose segments: escapeCurrencyDollars → rewriteLatexBracketDelimiters
  → fence segments: pass through
  → join
```

关键正则（参照 Hermes）：
```ts
const CODE_FENCE_SPLIT_RE = /((?:```|~~~)[\s\S]*?(?:```|~~~))/g;
const INLINE_CODE_SPLIT_RE = /(`[^`\n]+`)/g;
const CURRENCY_DOLLAR_RE = /(^|[^\\])\$(?=\d)/g;
```

#### 1.2 接入 `MarkdownPart.tsx`

将现有的 `normalizeLatexDelimiters` 替换为 `preprocessMarkdown`：
```tsx
// before
{normalizeLatexDelimiters(revealed)}

// after
{preprocessMarkdown(revealed)}
```

#### 1.3 ` ```math ` fence 路由

在 `makeComponents` 的 `code` 分支中添加 math 语言检测：
```tsx
code({ className, children }) {
  const match = /language-(\w+)/.exec(className || '');
  const code = String(children).replace(/\n$/, '');
  if (match && match[1] === 'math') {
    // 走 KaTeX display-mode 渲染而非 CodeBlock
    return <MathBlock expr={code} />;
  }
  // ... 原有逻辑
}
```

需要新增一个 `MathBlock` 组件（display math 渲染 + error fallback）。

---

### Phase 2：错误兜底 + 边界保护

#### 2.1 `MathBlock` + `InlineMath` 安全渲染组件

新建 `src/components/chat/Thread/parts/SafeMath.tsx`：

```tsx
interface MathBlockProps { expr: string; }

function MathBlock({ expr }: MathBlockProps) {
  try {
    const html = katex.renderToString(expr, { displayMode: true, throwOnError: true });
    return <div className="katex-block" dangerouslySetInnerHTML={{ __html: html }} />;
  } catch {
    try {
      const html = katex.renderToString(expr, { displayMode: true, throwOnError: false, strict: 'ignore' });
      return <div className="katex-block" dangerouslySetInnerHTML={{ __html: html }} />;
    } catch {
      return <div className="katex-block katex-error"><code>{`$$${expr}$$`}</code></div>;
    }
  }
}
```

此组件仅用于 ` ```math ` fence 路由。`remark-math` + `rehype-katex` 管线内的 inline/display math 继续由 rehype-katex 的 `strict: 'ignore'` 配置处理（已有 KATEX_OPTIONS 中配置）。

#### 2.2 Huge text fallback

在 `MarkdownPart.tsx` 入口处加长度门槛：
```tsx
const MAX_MARKDOWN_CHARS = 150_000;

if (content.length > MAX_MARKDOWN_CHARS) {
  return <HugeTextFallback text={content} />;
}
```

`HugeTextFallback`：monospace pre 展示，分 chunk，用 `content-visibility: auto` 懒渲染。

---

### Phase 3：流式渲染性能

#### 3.1 `useDeferredValue` 包裹

在 `MarkdownPart` 中：
```tsx
const revealed = useSmoothReveal(content, isStreaming);
const deferred = useDeferredValue(revealed);
// ReactMarkdown 使用 deferred 而非 revealed
```

效果：React concurrent mode 可以跳过中间态、中断阻塞渲染。

#### 3.2 KaTeX memoization

目标：streaming 时已渲染的公式不重复计算。

方案选择：
- **轻量方案**：对已完成消息（`!isStreaming`）用 `useMemo` 缓存整个 ReactMarkdown 输出。
- **完整方案**：参照 Hermes `katex-memo.ts` 写一个自定义 rehype 插件，LRU cache keyed by `(displayMode, mathSource)`。

建议先做轻量方案，观察数学重度场景是否真实存在，再决定是否投入完整方案。

#### 3.3 Block-level parse cache（可选）

如果使用 `@assistant-ui/react-streamdown`，可以接入 `parseMarkdownIntoBlocksCached`。
当前 GA 用的是 `react-markdown`（每次 re-render 都 full parse），如果不想迁移到 streamdown，替代方案是对完成态消息 memo 最终输出。

---

### Phase 4：中长期体验优化

#### 4.1 Render Budget
当 `groups.length > 30` 或 total weight > threshold 时，从最新 group 往前累加 weight，超限则隐藏旧 groups。提供 "Show earlier" 按钮按需展开。

#### 4.2 BiDi 处理
- Prose: `unicode-bidi: plaintext` on content containers
- Code (inline + fence): `dir="ltr"` isolate
- Lists / blockquotes: `dir="auto"`

#### 4.3 GFM Alert
检测 `> [!NOTE]` / `> [!WARNING]` / `> [!TIP]` 开头的 blockquote，渲染为 callout card。

#### 4.4 Embed 路由
Bare URL autolink 检测 YouTube / Mermaid / SVG 等，渲染为 inline embed 而非纯链接。

---

## 测试计划

### 一、单元测试：`preprocessMarkdown`

文件：`src/__tests__/markdown-preprocess.test.ts`

#### 1.1 Currency Dollar 保护

| 输入 | 期望输出 |
|------|----------|
| `The price is $5 and $10.` | `The price is \$5 and \$10.` |
| `$x^2 + y^2 = z^2$` | `$x^2 + y^2 = z^2$` （不动，因为 $ 后不是数字） |
| `Cost: $1,299.00 per unit` | `Cost: \$1,299.00 per unit` |
| `` `echo $HOME` `` | `` `echo $HOME` `` （inline code 内不处理） |

#### 1.2 Code Fence 保护

| 输入 | 期望 |
|------|------|
| ` ```bash\necho $HOME\n``` ` | fence 内 `$HOME` 不被 escape |
| ` ```python\nprice = "$5"\n``` ` | fence 内 `$5` 不被 escape |
| 混合：prose 有 `$5`，fence 内也有 `$5` | prose 段 escape，fence 段保留 |

#### 1.3 LaTeX Delimiter 转写

| 输入 | 期望输出 |
|------|----------|
| `\\(x^2\\)` | `$x^2$` |
| `\\[\\frac{1}{n}\\]` | `$$\\frac{1}{n}$$` |
| fence 内含 `\\(` | 不转写 |

---

### 二、单元测试：math fence 路由

文件：`src/__tests__/markdown-math-fence.test.ts`

使用 `@testing-library/react` render `MarkdownPart`，验证：

| 输入 | 期望 DOM |
|------|----------|
| ` ```math\n\\frac{1}{n}\\sum_i x_i\n``` ` | 存在 `.katex-block` 或 `.katex-display`，不存在 `[data-slot="code-card"]` |
| ` ```latex\n\\begin{equation}...\n``` ` | 存在 `[data-slot="code-card"]`（当做代码高亮） |
| ` ```python\nprint("hello")\n``` ` | 存在 `[data-slot="code-card"]` |

---

### 三、单元测试：SafeMath 组件

文件：`src/__tests__/safe-math.test.ts`

| 输入 expr | 期望行为 |
|-----------|----------|
| `x^2 + y^2` | 渲染为 KaTeX HTML，存在 `.katex` |
| `\frac{1}{n}\sum_i x_i` | 渲染为 KaTeX HTML |
| `\notacommand{x}` | 降级渲染（宽松模式红字）或原文兜底 |
| `\begin{` (未闭合) | 不抛异常，显示原文 |
| 空字符串 | 不崩溃，返回空 |

---

### 四、集成测试：MarkdownPart 完整管线

文件：`src/__tests__/markdown-part-integration.test.ts`

#### 4.1 合法 TeX 渲染

| 输入 content | 验证 |
|-------------|------|
| `This is $x^2+y^2=z^2$.` | 存在 `.katex` span |
| `$$\n\\frac{1}{n}\\sum_i x_i\n$$` | 存在 `.katex-display` |
| `Inline $\\alpha$ and block:\n$$E=mc^2$$` | 两个 `.katex` 节点 |

#### 4.2 不应被误渲染为 math

| 输入 content | 验证 |
|-------------|------|
| `The cost is $5 and you have $10.` | 不存在 `.katex`，文本原样显示 |
| `` `$HOME` `` | inline code 内的 `$` 不触发 math |
| ` ```bash\necho $PATH\n``` ` | code block 内无 math 渲染 |

#### 4.3 边界情况

| 输入 content | 验证 |
|-------------|------|
| `$` 单独出现 | 不崩溃 |
| `$$` 单独出现 | 不崩溃 |
| `$a$ $b$ $c$` | 三个独立 inline math 节点 |
| 150K+ 字符 | 走 HugeTextFallback，不走 ReactMarkdown |

---

### 五、集成测试：Streaming 场景

文件：`src/__tests__/markdown-streaming.test.ts`

#### 5.1 增量文本不破坏渲染

模拟 streaming：`content` 从 `"The"` → `"The answer is $x"` → `"The answer is $x^2$"` 逐步增长。

验证：
- 公式在 `$...$` 闭合前不报错
- 闭合后正确渲染
- 中间态不出现 error DOM

#### 5.2 Smooth reveal 不截断 math delimiter

`useSmoothReveal` 可能在 `$` 和 `$` 之间截断。验证：
- 截断态不会触发错误的 math parse（因为 remark-math 需要配对 `$`）
- 最终态正确渲染

---

### 六、视觉回归测试（手动 checklist）

在 dev server 中实际验证：

- [ ] 纯文本消息正常显示
- [ ] 含 inline math 的消息正确渲染
- [ ] 含 display math 的消息正确渲染
- [ ] 含 ` ```math ` fence 的消息渲染为公式
- [ ] 含 ` ```python ` fence 的消息渲染为代码卡片
- [ ] `$5` / `$10` 等 currency 不被吃掉
- [ ] code fence 内的 `$` 不触发 math
- [ ] 非法 TeX（如 `$\badcommand$`）不崩溃，有合理兜底显示
- [ ] streaming 时文字流畅显示，不卡顿
- [ ] 很长的 assistant 消息不卡页面
- [ ] 切换 session 后回来，旧消息正常渲染
- [ ] 中英文混排正常
- [ ] 暗色/亮色主题切换后 KaTeX 公式可读

---

## 文件变更清单（预估）

| 操作 | 文件 | 说明 |
|------|------|------|
| 新建 | `src/lib/markdown-preprocess.ts` | 预处理函数 |
| 新建 | `src/components/chat/Thread/parts/SafeMath.tsx` | math fence 安全渲染 |
| 新建 | `src/components/chat/Thread/parts/HugeTextFallback.tsx` | 超长文本兜底 |
| 修改 | `src/components/chat/Thread/parts/MarkdownPart.tsx` | 接入预处理 + math fence 路由 + deferred value |
| 修改 | `src/components/chat/Thread/parts/SummaryPart.tsx` | 接入预处理 |
| 新建 | `src/__tests__/markdown-preprocess.test.ts` | 预处理单测 |
| 新建 | `src/__tests__/markdown-math-fence.test.ts` | math fence 路由测试 |
| 新建 | `src/__tests__/safe-math.test.ts` | SafeMath 组件测试 |
| 新建 | `src/__tests__/markdown-part-integration.test.ts` | 管线集成测试 |
| 新建 | `src/__tests__/markdown-streaming.test.ts` | streaming 场景测试 |

---

## 依赖变更

**无新增依赖。** 所有需要的包已在 `package.json` 中：
- `react-markdown` ^10.1.0
- `remark-gfm` ^4.0.1
- `remark-math` ^6.0.0
- `rehype-katex` ^7.0.1
- `katex` ^0.17.0

Phase 3 的 `useDeferredValue` 来自 React 18+ 标准 API，无需额外依赖。

---

## 验收标准

Phase 1 完成时：
- `preprocessMarkdown` 单测全绿
- ` ```math ` fence 正确路由
- currency `$5` 不再被误识别

Phase 2 完成时：
- 非法 TeX 不崩溃，有合理显示
- 150K+ 字符消息不卡死

Phase 3 完成时：
- streaming 20 个公式的消息不出现明显卡顿
- `useDeferredValue` 接入后主线程 longtask 减少

---

## 设计决策记录

| 决策 | 选择 | 理由 |
|------|------|------|
| 预处理位置 | 独立 `lib/markdown-preprocess.ts` | 可测试、可复用于 SummaryPart |
| Math fence 路由 | 在 react-markdown components 层处理 | 不需要引入 streamdown 或自定义 remark 插件 |
| KaTeX 错误策略 | `strict: 'ignore'` + ` ```math ` fence 走 try/catch | 平衡：大多数 inline math 用 rehype-katex 默认宽容行为，只有 fence math 走显式 fallback |
| 不引入 streamdown | 继续用 react-markdown | 减少迁移风险，当前架构足够；streamdown 是更大的重构 |
| 不引入 Shiki | 继续用 Prism.js | 已有完整 token 主题，且 Prism 同步高亮 + budget gate 够用 |
