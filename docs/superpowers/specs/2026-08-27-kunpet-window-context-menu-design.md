# kunPet 桌宠窗口右键菜单设计规格

**日期：** 2026-08-27  
**状态：** 已批准  
**基于：** [2026-08-19-kunpet-design.md](./2026-08-19-kunpet-design.md)  
**变更主题：** 桌宠窗口鲲图片区域右键弹出与托盘相同的上下文菜单

---

## 1. 目标

在桌宠悬浮窗的 **鲲图片（`#pet-img`）** 上右键时，弹出与系统托盘完全一致的原生菜单，包含：显示、隐藏、开启/关闭走到中间、禁用桌宠、打开设置。

### 成功标准

- 右键 `#pet-img` 区域 → 原生菜单，五项与托盘一致且行为相同
- 右键气泡或透明边距 → 不出菜单，左键拖动行为不变
- celebrate 态：左键仍 dismiss；右键出菜单且不 dismiss
- toggle「走到中间」后，托盘与桌宠菜单文案同步更新
- 扩展层无需改动

### 非目标

- 自定义 HTML/CSS 菜单
- macOS/Linux 优先适配（随现有 Windows 首版策略）
- 右键触发范围扩大到整个窗口

---

## 2. 决策摘要

| 决策点 | 结论 |
|--------|------|
| 触发范围 | 仅 `#pet-img`  bounding rect 内 |
| 命中方式 | Renderer 坐标检测 + `pointer-events: none` 保持不变 |
| 菜单实现 | 复用 Electron `Menu.buildFromTemplate`，与托盘共用模板 |
| 扩展通知 | 沿用现有 tray 通道（stdout 或 HTTP postTrayEvent） |
| 改动范围 | 仅 `pet/` 目录 |

---

## 3. 架构

```
右键 #pet-img（renderer 坐标命中）
  → preload.showContextMenu()
  → ipcMain pet:show-context-menu
  → Menu.popup({ window: win })  // 与 tray 同一 template
  → 菜单项 click → notifyExtension / win.show|hide
```

`buildContextMenuTemplate()` 供 `rebuildTrayMenu()` 与窗口 popup 共用。

---

## 4. 与现有交互

| 状态 | 左键图片 | 右键图片 |
|------|---------|---------|
| idle / working | 穿透拖动 | 弹出菜单 |
| walking | 穿透 | 弹出菜单 |
| celebrate | dismiss | 弹出菜单，不 dismiss |

气泡 `#celebrate-bubble` 已有 `pointer-events: none`，不参与命中。

---

## 5. 涉及文件

| 文件 | 变更 |
|------|------|
| `pet/main.js` | 抽出菜单模板；IPC handler；`Menu.popup` |
| `pet/preload.js` | `showContextMenu()` |
| `pet/renderer/pet.js` | contextmenu 命中检测 |

---

## 6. 验证计划

1. 右键鲲图片 → 菜单五项与托盘一致
2. 右键透明区/气泡 → 无菜单，可拖动
3. celebrate 左键 dismiss / 右键出菜单
4. toggle 走到中间 → 两处菜单文案同步
