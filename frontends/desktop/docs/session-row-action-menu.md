# Session Row Action Menu

## 背景

左侧 Sidebar 的会话列表当前只有点击切换会话的单一交互。缺少对会话的管理操作入口（重命名、删除、置顶等）。本次为每行会话增加一个 overflow action menu。

## 后端能力盘点

| 动作 | 端点 | 状态 |
|------|------|------|
| Rename | `PATCH /session/{sid}` body `{title}` | 已实现 |
| Delete | `DELETE /session/{sid}` | 已实现 |
| Pin/Unpin | `PATCH /session/{sid}` body `{pinned}` | 已实现 |
| Branch | 无 HTTP 端点（TUI 有 /branch 但是纯内存操作） | 暂不做 |

## 设计参考

取自 Hermes Desktop `session-row.tsx` 第 6.5–6.6 节：

- Age Timestamp：`absolute right-6`，hover-only（opacity 0→1）
- Actions Button：22px 宽格子，默认 `text-transparent`，hover 时 `text-(--ui-text-tertiary)`
- Body 层 hover 时追加 `pr-12`（48px）给 age + actions 腾空间
- 菜单触发后按钮保持 `data-[state=open]` 高亮

## 交互行为

### Kebab 按钮

- 位置：行最右侧，absolute 定位，垂直居中
- 可见性：默认隐藏，行 hover 或菜单 open 时显示
- 尺寸：20×20px，icon `kebab-vertical` 14px
- 点击弹出 Dropdown Menu（向下对齐右边缘）

### Menu 项

1. **Rename** — 触发 inline 编辑模式
2. **Pin / Unpin** — 切换置顶（已置顶显示 Unpin）
3. **Delete** — 带确认的删除

### Rename 流程

1. 点击 Rename 后，title 区域变为受控 Input
2. Enter 确认 → 调用 `PATCH /session/{sid}` → 刷新列表
3. Escape 或失焦取消 → 恢复原 title
4. 空值不允许提交

### Delete 流程

1. 点击 Delete → 弹出 Semi `Modal.confirm` 或内联二次确认
2. 确认 → 调用 `DELETE /session/{sid}` → 如果删除的是当前活跃会话则清空主区域
3. 取消 → 关闭菜单

### Pin 流程

- 纯 toggle，调用 `PATCH /session/{sid}` 后刷新列表排序（pinned 排最前）

## 文件变更清单

| 文件 | 变更 |
|------|------|
| `services/chat.ts` | 新增 `renameSession()` / `pinSession()` |
| `stores/chat.ts` | 新增 `renameSession` / `deleteSession` / `pinSession` actions |
| `components/layout/SessionRow.tsx` | 重构为支持 inline rename + kebab + dropdown |
| `components/layout/layout.css` | 新增 action button hover-reveal 样式 |
| `i18n/zh.ts` + `i18n/en.ts` | 新增 menu 项文案 |

## CSS 方案

采用 Hermes 的 right-reveal 模式，用 CSS group hover 控制可见性：

```
.ga-session-item (group)
  ├─ .ga-session-content (flex, 正常文档流)
  │   ├─ .ga-status-dot
  │   └─ .ga-session-title (or inline input when renaming)
  ├─ .ga-session-age (absolute, right-28, hover-reveal)
  └─ .ga-session-actions (absolute, right-4, hover-reveal)
      └─ kebab button → Dropdown
```

Age 和 Actions 都用 absolute 定位，避免布局抖动。行 hover 时 session-content 追加 `padding-right` 避免 title 文字与浮出控件重叠。
