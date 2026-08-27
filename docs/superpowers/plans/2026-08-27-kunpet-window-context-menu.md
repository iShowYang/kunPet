# kunPet 桌宠窗口右键菜单 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在 `#pet-img` 区域右键时弹出与托盘相同的原生上下文菜单，菜单项行为完全一致。

**Architecture:** 从 `rebuildTrayMenu` 抽出共享 `buildContextMenuTemplate()`；renderer 用 `getBoundingClientRect` 做图片区域命中；preload IPC 触发 main 进程 `Menu.popup({ window: win })`；扩展通知走现有 `notifyExtension` 辅助函数（兼容 stdout / HTTP）。

**Tech Stack:** Electron Menu/IPC、现有 pet renderer（无扩展层改动）

## Global Constraints

- 触发范围：**仅 `#pet-img` bounding rect**，不含气泡与透明边距
- 菜单项与托盘完全一致：显示、隐藏、走到中间 toggle、禁用桌宠、打开设置
- 不改变 idle/working 左键拖动（`#pet-img` 保持 `pointer-events: none`，用坐标命中）
- celebrate 左键 dismiss 行为不变；右键不触发 dismiss
- 规格来源：`docs/superpowers/specs/2026-08-27-kunpet-window-context-menu-design.md`
- 改动限定在 `pet/` 目录

---

## File Structure

| Path | Responsibility |
|------|----------------|
| `pet/main.js` | `buildContextMenuTemplate()`、`notifyExtension()`、`popupPetContextMenu()`、IPC handler |
| `pet/preload.js` | 暴露 `showContextMenu()` |
| `pet/renderer/pet.js` | `contextmenu` 命中检测 |

---

### Task 1: 抽出共享菜单模板与 notifyExtension

**Files:**
- Modify: `pet/main.js`

**Interfaces:**
- Consumes: 现有 `prefsWalkToCenter`、`win`、`rebuildTrayMenu` 逻辑
- Produces:
  - `function notifyExtension(msg)` — 统一扩展通知（若已有 `postTrayEvent` 则调用它，否则 `emitToExtension`）
  - `function buildContextMenuTemplate()` → Electron menu template 数组
  - `function popupPetContextMenu()` — `Menu.buildFromTemplate(...).popup({ window: win })`
  - `rebuildTrayMenu()` 改为调用 `buildContextMenuTemplate()`

- [ ] **Step 1: 添加 notifyExtension 与 buildContextMenuTemplate**

在 `emitToExtension` / `postTrayEvent` 之后添加：

```javascript
function notifyExtension(msg) {
  if (typeof postTrayEvent === "function") {
    postTrayEvent(msg);
    return;
  }
  emitToExtension(msg);
}

function buildContextMenuTemplate() {
  return [
    { label: "显示", click: () => win?.showInactive() },
    { label: "隐藏", click: () => win?.hide() },
    { type: "separator" },
    {
      label: prefsWalkToCenter ? "关闭走到中间" : "开启走到中间",
      click: () => {
        const next = !prefsWalkToCenter;
        prefsWalkToCenter = next;
        notifyExtension({ type: "request-walk-to-center", value: next });
        rebuildTrayMenu();
      },
    },
    { type: "separator" },
    {
      label: "禁用桌宠",
      click: () => notifyExtension({ type: "request-disable" }),
    },
    {
      label: "打开设置",
      click: () => notifyExtension({ type: "request-open-settings" }),
    },
  ];
}

function popupPetContextMenu() {
  if (!win || win.isDestroyed()) return;
  const menu = Menu.buildFromTemplate(buildContextMenuTemplate());
  menu.popup({ window: win });
}
```

- [ ] **Step 2: 重构 rebuildTrayMenu 使用模板**

```javascript
function rebuildTrayMenu() {
  if (!tray) return;
  trayMenu = Menu.buildFromTemplate(buildContextMenuTemplate());
  if (process.platform === "win32") {
    tray.setContextMenu(null);
  } else {
    tray.setContextMenu(trayMenu);
  }
}
```

同时将原 `rebuildTrayMenu` 内 toggle/disable/settings 的 `emitToExtension` 调用已在模板中改为 `notifyExtension`（Step 1 完成）。

- [ ] **Step 3: 手动冒烟**

启动桌宠，托盘右键 → 五项仍正常。  
Run: F5 或 `node pet/main.js`（开发环境）

---

### Task 2: IPC 与 preload 桥接

**Files:**
- Modify: `pet/main.js` — `setupRendererIpc`
- Modify: `pet/preload.js`

**Interfaces:**
- Consumes: `popupPetContextMenu()` from Task 1
- Produces: `window.kunpet.showContextMenu()` in renderer

- [ ] **Step 1: setupRendererIpc 注册 handler**

在 `setupRendererIpc()` 内添加：

```javascript
ipcMain.on("pet:show-context-menu", () => {
  popupPetContextMenu();
});
```

- [ ] **Step 2: preload 暴露 API**

```javascript
contextBridge.exposeInMainWorld("kunpet", {
  // ...existing...
  showContextMenu: () => ipcRenderer.send("pet:show-context-menu"),
});
```

- [ ] **Step 3: 手动验证 IPC**

DevTools 控制台执行 `window.kunpet.showContextMenu()` → 菜单弹出。

---

### Task 3: Renderer 图片区域右键命中

**Files:**
- Modify: `pet/renderer/pet.js`

**Interfaces:**
- Consumes: `window.kunpet.showContextMenu()`
- Produces: `isPointInPetImg(clientX, clientY)` 纯函数（可内联）

- [ ] **Step 1: 添加命中检测与 contextmenu 监听**

在 `pet.addEventListener("click", ...)` 附近添加：

```javascript
function isPointInPetImg(clientX, clientY) {
  const rect = img.getBoundingClientRect();
  return (
    clientX >= rect.left &&
    clientX <= rect.right &&
    clientY >= rect.top &&
    clientY <= rect.bottom
  );
}

pet.addEventListener("contextmenu", (event) => {
  if (!isPointInPetImg(event.clientX, event.clientY)) return;
  event.preventDefault();
  event.stopPropagation();
  window.kunpet.showContextMenu();
});
```

- [ ] **Step 2: 手动验收**

| 操作 | 预期 |
|------|------|
| 右键鲲图片 | 菜单弹出，五项与托盘一致 |
| 右键窗口透明区 | 无菜单，可拖动 |
| 庆祝态右键图片 | 菜单弹出，不 dismiss |
| 庆祝态左键图片 | dismiss（不变） |
| 切换走到中间 | 托盘与桌宠菜单文案同步 |

---

### Task 4: 完成检查

- [ ] **Step 1: 确认无 extension 改动**

`git diff -- extension/` 应为空。

- [ ] **Step 2: 确认三文件 diff 范围**

仅 `pet/main.js`、`pet/preload.js`、`pet/renderer/pet.js` 有功能改动。

---

## Spec Coverage

| 规格要求 | 对应 Task |
|----------|-----------|
| 仅 #pet-img 触发 | Task 3 坐标命中 |
| 菜单与托盘一致 | Task 1 共享 template |
| 不改变拖动 | Task 3 保持 pointer-events: none |
| celebrate 左/右键分离 | Task 3 仅 contextmenu 调菜单 |
| 扩展层无改动 | Task 4 检查 |
