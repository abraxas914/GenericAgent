# Hermes Desktop Reference Bundle

此目录是给 coding agent 的 handoff 材料。

## 决策

**直接复刻 Hermes 技术栈**：Tailwind CSS + shadcn/ui + nanostores + Radix UI + dnd-kit。
丢弃 Semi Design。后端不新增业务，前端定义 interface + mock fallback。

## 文件说明

| 文件 | 角色 | 怎么用 |
|---|---|---|
| `HANDOFF-SPEC.md` | **实施指令** | agent 主入口——技术栈迁移 + 目标架构 + 组件规格 + 阶段计划 |
| `SOURCE-REFERENCE.md` | **Hermes 源码精选** | 实现时对照——精确 className、状态机、动效参数 |

## 给 Agent 的一句话指令

> 读 HANDOFF-SPEC.md 了解目标架构和实施阶段。读 SOURCE-REFERENCE.md 获取 Hermes 的精确 CSS token 和组件结构。从 Phase 0 开始（搭 Tailwind + 移除 Semi），然后做 Phase 1（左侧 sidebar 完整实现）。前端对后端不存在的 API 定义 TypeScript interface + mock，不改后端代码。

## 技术栈（最终态）

| 层 | 选型 |
|---|---|
| 构建 | Vite + React 18 + TypeScript |
| 样式 | Tailwind CSS v4 |
| 组件 | shadcn/ui (Radix + cva) |
| 状态 | nanostores + @nanostores/react |
| 拖拽 | @dnd-kit/core + @dnd-kit/sortable |
| 虚拟列表 | @tanstack/react-virtual |
| 图标 | lucide-react 或 Codicon subset |
| Bridge | 现有 services/bridge.ts（不改） |
