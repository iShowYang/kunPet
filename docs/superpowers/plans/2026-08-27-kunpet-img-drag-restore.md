# kunPet 鲲图片左键拖动恢复 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在保留 `#pet-img` 右键菜单的前提下，恢复 idle/working 态左键拖动鲲图片移动窗口。

**Architecture:** `#pet-img` 保持 `no-drag`；renderer 在左键 mousedown/move/up 时经 preload IPC 通知 main；main 用 `dragOffset` + `win.setPosition()` 手动拖窗；celebrate/walking 不启动拖窗。

**Tech Stack:** Electron IPC、现有 `win.on('moved')` 位置上报

## Global Constraints

- 左键拖动范围：**仅 `#pet-img`**（idle/working）；透明边距仍走 `body` drag
- 右键菜单行为不变（与托盘一致）
- celebrate 左键 dismiss，**不**进入拖窗
- walking 态**不**启动手动拖窗
- `style.css` 中 `#pet-img` 保持 `pointer-events: auto` + `-webkit-app-region: no-drag`
- 改动限定在 `pet/` 目录
- 规格来源：`docs/superpowers/specs/2026-08-27-kunpet-img-drag-restore-design.md`

---

## File Structure

| Path | Responsibility |
|------|----------------|
| `pet/main.js` | `dragOffset` 状态；IPC `pet:window-drag` handler |
| `pet/preload.js` | 暴露 `windowDrag(phase, coords)` |
| `pet/renderer/pet.js` | img 拖窗 mouse 事件；状态门控 |

---

### Task 1: main 进程拖窗 IPC

**Files:**
- Modify: `pet/main.js`

**Interfaces:**
- Consumes: 现有 `win`、`petState`（可选门控）
- Produces:
  - module-level `/** @type {{ x: number, y: number } | null} */ let dragOffset = null`
  - `ipcMain.on("pet:window-drag", (_event, payload) => ...)` 处理 `{ phase: "start"|"move"|"end", screenX: number, screenY: number }`

- [ ] **Step 1: 添加 dragOffset 与 handler**

在 `let win;` 附近添加：

```javascript
/** @type {{ x: number, y: number } | null} */
let dragOffset = null;
```

在 `setupRendererIpc()` 内添加：

```javascript
ipcMain.on("pet:window-drag", (_event, payload) => {
  if (!win || win.isDestroyed()) return;
  if (!payload || typeof payload !== "object") return;
  const { phase, screenX, screenY } = payload;
  if (typeof screenX !== "number" || typeof screenY !== "number") return;

  if (phase === "start") {
    const [wx, wy] = win.getPosition();
    dragOffset = { x: screenX - wx, y: screenY - wy };
    return;
  }
  if (phase === "move" && dragOffset) {
    win.setPosition(
      Math.round(screenX - dragOffset.x),
      Math.round(screenY - dragOffset.y)
    );
    return;
  }
  if (phase === "end") {
    dragOffset = null;
  }
});
```

- [ ] **Step 2: 确认 `moved` 仍触发**

现有 `createWindow()` 内：

```javascript
win.on("moved", () => {
  if (petState !== "idle") return;
  ...
});
```

手动 `setPosition` 会触发 `moved`；idle 拖窗后应仍上报位置。**无需改此段**，实现后手动验证。

---

### Task 2: preload 桥接

**Files:**
- Modify: `pet/preload.js`

**Interfaces:**
- Consumes: IPC channel `pet:window-drag`
- Produces: `window.kunpet.windowDrag(phase, screenX, screenY)`

- [ ] **Step 1: 暴露 API**

在 `contextBridge.exposeInMainWorld("kunpet", { ... })` 中添加：

```javascript
windowDrag: (phase, screenX, screenY) =>
  ipcRenderer.send("pet:window-drag", { phase, screenX, screenY }),
```

---

### Task 3: renderer 拖窗逻辑

**Files:**
- Modify: `pet/renderer/pet.js`

**Interfaces:**
- Consumes: `window.kunpet.windowDrag`
- Produces: img 上拖窗；`let imgDragging = false`

- [ ] **Step 1: 添加拖窗辅助函数与门控**

在 `img.addEventListener("contextmenu", ...)` 之前添加：

```javascript
function canDragFromImg() {
  return (
    pet.classList.contains("idle") || pet.classList.contains("working")
  );
}

let imgDragging = false;

img.addEventListener("mousedown", (event) => {
  if (event.button !== 0) return;
  if (!canDragFromImg()) return;
  imgDragging = true;
  window.kunpet.windowDrag("start", event.screenX, event.screenY);
});

window.addEventListener("mousemove", (event) => {
  if (!imgDragging) return;
  window.kunpet.windowDrag("move", event.screenX, event.screenY);
});

window.addEventListener("mouseup", (event) => {
  if (!imgDragging) return;
  imgDragging = false;
  window.kunpet.windowDrag("end", event.screenX, event.screenY);
});
```

- [ ] **Step 2: 确认 celebrate click 不冲突**

celebrate 态 `canDragFromImg()` 返回 false，左键 mousedown 不启动拖窗；现有 `pet.addEventListener("click", ...)` dismiss 逻辑不变。

---

### Task 4: 手动验收

- [ ] **Step 1: F5 或启用扩展后验证**

| 操作 | 预期 |
|------|------|
| idle 左键拖鲲图片 | 窗口跟随移动 |
| 拖动后重启 Cursor | 位置恢复 |
| idle 右键鲲图片 | 五项菜单 |
| celebrate 左键 | dismiss，不拖动 |
| walking 左键图片 | 不手动拖偏 |
| 透明边距左拖 | 仍可拖动 |

- [ ] **Step 2: 确认 diff 范围**

仅 `pet/main.js`、`pet/preload.js`、`pet/renderer/pet.js` 有功能改动。

---

## Spec Coverage

| 规格要求 | Task |
|----------|------|
| 左键拖鲲 idle/working | Task 3 |
| 右键菜单保留 | 无 CSS 改动 |
| celebrate dismiss | Task 3 门控 |
| walking 不拖 | Task 3 门控 |
| 位置持久化 | Task 1 + 现有 moved |
| 仅 pet/ 改动 | Task 4 |
