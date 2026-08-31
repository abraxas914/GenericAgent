# Desktop Maintainability Code Spec

规范级别：Normative

相关状态规范：[Session state management](session-state.md)

## Scenario: Safe desktop slimming and refactoring

### 1. Scope / Trigger

下列任一变更触发本规范：

- 新增、删除、移动 React Desktop 生产模块或入口。
- 拆分 store、component、service、Python bridge、Tauri host 或发布脚本。
- 删除、合并或重写 Vitest、pytest、Browser/Native E2E、packaging contract。
- 修改 Desktop CI `paths`、发布候选构建、runtime 文件集合或真包证据。
- 修改 Vite 依赖、lazy boundary、字体/样式资源或 bundle budget。
- 声称某项改动属于“死代码清理”“测试去重”“行为不变重构”或“包体积优化”。

目标是让维护面缩小的同时，仍能证明：生产入口完整、测试命中真实实现、CI 能被全部运行时依赖触发、跨层合同不变、发布证据来自同一候选提交和产物。

### 2. Signatures

#### React production entries

当前生产可达性根节点为：

```text
frontends/desktop/src/main.tsx
frontends/desktop/src/loading.tsx
frontends/desktop/src/setup.tsx
```

静态和动态 `import()` 都属于依赖边。测试引用、story、源码字符串断言或已经删除的入口不构成生产可达性。

#### Desktop CI runtime trigger surface

`.github/workflows/desktop-ci.yml` 必须至少覆盖：

```text
*.py
pyproject.toml
assets/**
memory/**
reflect/**
frontends/*.py
frontends/conductor_im_plugins/**
frontends/tests/**
frontends/desktop/**
.github/workflows/desktop-ci.yml
.github/workflows/desktop-release-package.yml
```

GitHub `paths` 使用保守 glob；未来即使引入 runtime manifest，也不得用 manifest 取代 workflow 触发范围，因为 workflow 不能在触发前动态读取仓库文件。

#### Verification lanes

```text
Node:    typecheck -> unit/contracts -> production build -> bundle/package contracts
Python:  frontends/tests on supported Python matrix
Rust:    fmt -> clippy --all-targets --all-features -D warnings -> production/e2e tests
E2E:     browser journeys -> native smoke/full -> packaged candidate journeys
Release: exact source SHA + artifact SHA + platform evidence -> publish
```

### 3. Contracts

#### 3.1 Source reachability contract

- 删除生产模块前，必须从三个 React entry 做静态和动态依赖遍历，并对零入边文件执行全仓引用检查。
- 只有历史入口已经移除、生产图不可达、无 runtime lookup、无 operator contract 的文件才可判定为死代码。
- barrel、hook、CSS 和测试 helper 必须随所属死子图一起审计，不能只删顶层组件。
- CSS selector 必须逐个检查活跃组件引用；不得按注释区间整段删除。共享 animation/keyframe 视为独立依赖。
- “以后可能用到”不能作为保留重复实现的理由；需要恢复时从 Git 历史重新实现并补当前合同。

#### 3.2 Refactor boundary contract

- 删除、机械移动、行为修改、安全修复、依赖升级和生成产物必须分成可独立审查的 commit 或 PR。
- 行为不变重构不得改变 bridge route、JSON shape、Tauri command/capability、session identity、文件布局或错误语义。
- `chat.ts`、Composer ingestion、Markdown security、bootstrap、titlebar、runtime staging 等高风险边界先补 characterization/journey，再拆实现。
- fork 功能分支不修改版本，不跟踪新 `dist`；compiled delivery 只能由完整验证后的精确 fork SHA 统一生成。

#### 3.3 Test evidence contract

- 单元测试必须导入生产函数、渲染生产组件或调用生产 handler/store。测试内复制生产算法再测试副本不算覆盖。
- 测试数量和源码行数不是目标。删除重复测试前，先列出其独有输入、边界和失败语义，并迁移到真实实现测试。
- DOM 行为使用 role、可见状态和事件断言；源码字符串断言只允许保护无法通过行为表达的架构、安全或发布边界。
- 第三方库自身行为不重复测试；只测试本应用传给第三方的选项、fallback、安全过滤和集成输出。
- session isolation、attachment ingestion、render disclosure、bridge ownership、settings atomicity、backup rollback、bootstrap、window chrome、browser/native/package journeys 属于不可静默削弱的回归组。

#### 3.4 CI closure contract

- 任一可能进入 Desktop runtime、被 bridge 动态加载、被 Tauri 调用或影响打包的 tracked 文件变化都必须触发 Desktop CI。
- 新 runtime 目录出现时，同一 PR 必须更新 workflow paths、package/runtime contract 和本规范或 runtime manifest。
- “CI 绿色”只有在该提交确实触发所有必需 lane 时才可作为无回归证据。
- 本地资源不足时允许把 Rust、Browser、Native 和真包验证交给 CI runner，但 PR 必须记录本地未运行项及原因。

#### 3.5 Bundle and package contract

- 继续满足原 React rewrite 的 `< 2 MB gzip` 总预算；新增代码还必须报告主入口 eager JS/CSS、最大 chunk、字体资源和 lazy route 增量。
- 删除生产不可达源码通常不会改变 bundle；报告必须分别列出“维护面减少”和“运行时产物减少”，不得混为一项收益。
- runtime/package 文件集合长期应由 allowlist manifest 驱动；迁移到 manifest 前必须先生成与当前候选完全相同的文件集合，再逐项删除。
- legacy Desktop v1 与 React/Tauri v2 是独立产品边界，未获产品决策前不得以“重复”为由删除 `static/`。

#### 3.6 Release evidence contract

- 候选构建与发布提升分离。构建 job 产出包和摘要，平台 journey 消费该包，publisher 只消费验证通过的报告。
- 三平台报告必须对应同一 source SHA，并记录实际 artifact SHA、进程身份、启动/清理结果和设置恢复。
- dev server、unpacked Tauri build、另一提交的截图或手工口述不能替代正式包证据。

### 4. Validation & Error Matrix

| 条件 | 必须行为 | 禁止行为 |
| --- | --- | --- |
| 模块仅被测试引用 | 视为生产不可达，继续查历史/operator contract | 因测试能 import 就判定为生产功能 |
| CSS 区间含一个活 selector | 逐 selector 删除并保留共享规则 | 整段删除 |
| 测试复制生产算法 | 先改为导入/调用生产实现 | 因当前为绿就保留或直接整文件删除 |
| runtime 新增 tracked Python 文件 | 保守 glob 触发 Desktop CI | 只维护三个手写文件名 |
| 本地机器资源受限 | 限流运行快速测试，重型 lane 交 CI 并记录 | 同时启动多 Agent、默认 Vitest 并发和 Cargo |
| 仅源码行数下降 | 报告维护收益，bundle 标记不变 | 声称安装包变小 |
| bundle 超预算 | 阻止合并或提供经批准的基线更新 | 只检查单个 JS chunk |
| package journey 与 source/artifact SHA 不匹配 | 拒绝发布 | 手动覆盖结论 |
| 安全修复同时需要结构重构 | 拆成独立、可验证变更 | 混入大规模死代码删除 |

### 5. Good / Base / Bad Cases

#### Good

- 删除一个从三个 entry 都不可达的完整旧 UI 子图；保留仍被活组件使用的共享 pulse animation；所有行为门禁通过。
- 将 cloned test 改为 table-driven 真实生产函数测试，迁移全部独有边界后再删副本。
- bridge 依赖新增到 `frontends/*.py` 后自动触发 Python、Browser 和 Native lanes。
- fork exact-head 通过 CI，三平台 journey 对同一包摘要出具证据后再发布。

#### Base

- 只改活组件内部命名，相关单元测试、typecheck 和 production build 通过，bundle 不增长。
- 文档或 spec 变更不触碰 runtime，但 CI contract 仍能读取并验证边界。

#### Bad

- 看到文件没有 JSX 引用就删除，却忽略动态 import、Tauri command 或 operator script。
- 通过删测试让 CI 更快，但测试原本是唯一的跨会话或安全回归证据。
- 因 release workflow 构建成功就宣布真包验收通过。
- 在本机同时运行多个审计 Agent、默认并发 Vitest、Cargo 和真包构建。

### 6. Tests Required

每个 Desktop 精简 PR 至少记录并执行适用子集：

- 静态：生产 entry reachability、全仓引用、dead selector 搜索、变更文件边界。
- Node：`typecheck`、Vitest、E2E typecheck、CI/package contracts、production build、bundle isolation。
- Python：真实 bridge/domain tests；不得用复制实现测试作为唯一证据。
- Rust：format、clippy、production/e2e feature tests，由具备资源的本机或 CI runner 执行。
- Browser：session critical loops、bootstrap recovery、与本次 UI 行为相关 journey。
- Native/package：改动触及 Tauri、drag/drop、bootstrap、runtime 或 package 时执行相应平台 journey。
- 删除测试时，PR 描述必须列出被删除测试的每项独有合同及其新落点，或证明它从未进入任何执行/操作路径。

### 7. Wrong vs Correct

#### Wrong: copied implementation test

```ts
// Test file silently reimplements production merge behavior.
function mergeMessages(left: Message[], right: Message[]) { /* copy */ }
expect(mergeMessages(a, b)).toEqual(expected);
```

#### Correct: production behavior test

```ts
import { mergeMessages } from '../../stores/chat';
expect(mergeMessages(a, b)).toEqual(expected);
```

#### Wrong: comment-range CSS deletion

```text
Delete everything under the old Statusbar comment.
```

#### Correct: selector dependency deletion

```text
Delete selectors exclusive to the dead Statusbar component; retain the pulse
animation because the live sidebar BridgeMenuPanel still consumes it.
```
