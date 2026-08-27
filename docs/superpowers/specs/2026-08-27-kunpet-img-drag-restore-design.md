# kunPet 鲲图片左键拖动恢复设计规格

**日期：** 2026-08-27  
**状态：** 已批准  
**基于：** [2026-08-27-kunpet-window-context-menu-design.md](./2026-08-27-kunpet-window-context-menu-design.md)  
**变更主题：** 在保留鲲图片右键菜单的前提下，恢复左键拖动鲲图片移动窗口

---

## 1. 问题

0.1.3 为修复 Windows 右键菜单，将 `#pet-img` 设为 `-webkit-app-region: no-drag` + `pointer-events: auto`。同区域无法同时作为 Chromium drag 区，导致左键无法从鲲图片拖动窗口。

## 2. 目标

| 成功标准 | 说明 |
|----------|------|
| 左键拖鲲 | idle/working 态左键按住鲲图片可拖动窗口 |
| 右键菜单 | 与托盘一致的五项菜单仍可用 |
| celebrate | 左键 dismiss，不触发拖动 |
| walking | 不因误触左键拖偏 tween |
| 位置持久化 | 拖动后位置仍经现有 `moved` 上报保存 |
| 范围 | 仅 `pet/` 改动 |

## 3. 决策

采用 **IPC 手动拖窗**：img 保持 `no-drag`，左键 mousedown/move/up 经 IPC 驱动 `win.setPosition()`。

## 4. 行为矩阵

| 状态 | 左键图片 | 右键图片 |
|------|---------|---------|
| idle / working | 手动拖窗 | 上下文菜单 |
| walking | 忽略 | 上下文菜单 |
| celebrate | dismiss | 上下文菜单 |

透明边距仍用 `body` drag 区拖动。

## 5. 涉及文件

- `pet/preload.js`
- `pet/main.js`
- `pet/renderer/pet.js`
