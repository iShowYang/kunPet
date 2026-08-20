# kunPet 设置开关 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 增加 `kunpet.enabled` / `kunpet.walkToCenter` 设置与对应命令：禁用时不启动桌宠（Hook 仅记 Output 日志）；关闭走到中间时原地庆祝。

**Architecture:** VS Code `contributes.configuration` 持久化两个布尔开关；命令通过 `workspace.getConfiguration().update` 写同一配置；`extension.ts` 在 activate / `onDidChangeConfiguration` 时 apply（启停桌宠）；celebrate IPC 携带 `walkToCenter`，`pet/main.js` 分支原地或走动。

**Tech Stack:** TypeScript、VS Code Extension API（Configuration）、现有 HTTP IPC、Electron pet main。

## Global Constraints

- 配置键：`kunpet.enabled`（默认 `true`）、`kunpet.walkToCenter`（默认 `true`）
- walk 关闭：原地庆祝（不 tween）；return-idle 原地回 idle
- 禁用：不 spawn / 停止桌宠；Hook 与事件服务仍运行；agent 事件写 Output 日志，形如 `[disabled] agent_stop received, pet not running`
- 入口：命令面板 + 设置页，双向同步
- 规格来源：`docs/superpowers/specs/2026-08-20-kunpet-settings-toggles-design.md`
- 在现有走动庆祝架构上增量改动，不重构 Hook/事件服务

---

## File Structure

| Path | Responsibility |
|------|----------------|
| `extension/package.json` | configuration 贡献点 + 4 个新命令 |
| `extension/src/types.ts` | 配置键常量；`celebrate` IPC 增加 `walkToCenter?: boolean` |
| `extension/src/settings.ts` | 纯函数：读配置、默认值（可单测） |
| `extension/src/test/settings.test.ts` | settings 单测 |
| `extension/src/extension.ts` | applyEnabled、celebrate 带标志、命令、配置监听、禁用日志 |
| `pet/main.js` | `beginCelebrate(walkToCenter)`；原地 return-idle |
| `README.md` | 设置/命令/验收说明 |

---

### Task 1: 配置类型、settings 辅助与 package.json 贡献点

**Files:**
- Modify: `extension/src/types.ts`
- Create: `extension/src/settings.ts`
- Create: `extension/src/test/settings.test.ts`
- Modify: `extension/package.json`

**Interfaces:**
- Consumes: 无
- Produces:
  - `CONFIG_SECTION = "kunpet"`
  - `CONFIG_ENABLED = "enabled"`
  - `CONFIG_WALK_TO_CENTER = "walkToCenter"`
  - `PetIpcMessage` 中 `{ type: "celebrate"; walkToCenter?: boolean }`
  - `readKunPetSettings(getConfig: (section: string) => { get(key: string, defaultValue: boolean): boolean }): { enabled: boolean; walkToCenter: boolean }`
  - package.json：`contributes.configuration` + 命令 `kunpet.enable` / `kunpet.disable` / `kunpet.enableWalkToCenter` / `kunpet.disableWalkToCenter`

- [ ] **Step 1: Write the failing test**

Create `extension/src/test/settings.test.ts`:

```typescript
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readKunPetSettings } from "../settings";

function fakeConfig(values: Record<string, boolean | undefined>) {
  return {
    get(key: string, defaultValue: boolean): boolean {
      const v = values[key];
      return typeof v === "boolean" ? v : defaultValue;
    },
  };
}

describe("readKunPetSettings", () => {
  it("defaults both flags to true when unset", () => {
    const out = readKunPetSettings((section) => {
      assert.equal(section, "kunpet");
      return fakeConfig({});
    });
    assert.deepEqual(out, { enabled: true, walkToCenter: true });
  });

  it("reads false values from configuration", () => {
    const out = readKunPetSettings(() =>
      fakeConfig({ enabled: false, walkToCenter: false })
    );
    assert.deepEqual(out, { enabled: false, walkToCenter: false });
  });

  it("reads mixed values", () => {
    const out = readKunPetSettings(() =>
      fakeConfig({ enabled: true, walkToCenter: false })
    );
    assert.deepEqual(out, { enabled: true, walkToCenter: false });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd extension && npm test -- src/test/settings.test.ts`

Expected: FAIL — cannot find module `../settings`

- [ ] **Step 3: Write minimal implementation**

Update `extension/src/types.ts` — change celebrate union member and add constants:

```typescript
export type PetIpcMessage =
  | { type: "celebrate"; walkToCenter?: boolean }
  | { type: "return-idle" }
  | { type: "show" }
  | { type: "hide" }
  | { type: "set-position"; x: number; y: number };

export const CONFIG_SECTION = "kunpet";
export const CONFIG_ENABLED = "enabled";
export const CONFIG_WALK_TO_CENTER = "walkToCenter";
```

Create `extension/src/settings.ts`:

```typescript
import {
  CONFIG_ENABLED,
  CONFIG_SECTION,
  CONFIG_WALK_TO_CENTER,
} from "./types";

export type KunPetSettings = {
  enabled: boolean;
  walkToCenter: boolean;
};

type ConfigLike = {
  get(key: string, defaultValue: boolean): boolean;
};

export function readKunPetSettings(
  getConfig: (section: string) => ConfigLike
): KunPetSettings {
  const cfg = getConfig(CONFIG_SECTION);
  return {
    enabled: cfg.get(CONFIG_ENABLED, true),
    walkToCenter: cfg.get(CONFIG_WALK_TO_CENTER, true),
  };
}
```

In `extension/package.json`, replace `contributes` with:

```json
"contributes": {
  "commands": [
    { "command": "kunpet.show", "title": "kunPet: 显示桌宠" },
    { "command": "kunpet.hide", "title": "kunPet: 隐藏桌宠" },
    { "command": "kunpet.enable", "title": "kunPet: 启用桌宠" },
    { "command": "kunpet.disable", "title": "kunPet: 禁用桌宠" },
    { "command": "kunpet.enableWalkToCenter", "title": "kunPet: 开启走到中间" },
    { "command": "kunpet.disableWalkToCenter", "title": "kunPet: 关闭走到中间" },
    { "command": "kunpet.testCelebrate", "title": "kunPet: 测试完成提醒" },
    { "command": "kunpet.reregisterHook", "title": "kunPet: 重新注册 Hook" }
  ],
  "configuration": {
    "title": "kunPet",
    "properties": {
      "kunpet.enabled": {
        "type": "boolean",
        "default": true,
        "description": "启用桌宠。关闭后不启动桌宠进程；Agent 事件仅写入 Output 日志。"
      },
      "kunpet.walkToCenter": {
        "type": "boolean",
        "default": true,
        "description": "Agent 完成时走到主屏中央再庆祝。关闭后在当前位置原地庆祝。"
      }
    }
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd extension && npm test -- src/test/settings.test.ts`

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add extension/src/types.ts extension/src/settings.ts extension/src/test/settings.test.ts extension/package.json
git commit -m "feat: add kunpet settings helpers and configuration contribution"
```

---

### Task 2: 扩展侧 apply 启用状态、celebrate 传 walk 标志、命令与配置监听

**Files:**
- Modify: `extension/src/extension.ts`

**Interfaces:**
- Consumes: `readKunPetSettings`、`CONFIG_SECTION`、`CONFIG_ENABLED`、`CONFIG_WALK_TO_CENTER`、`PetProcess.start/stop/send`
- Produces:
  - `handleStop()`：若 `!enabled` → log `[disabled] agent_stop received, pet not running`；否则 `pet.send({ type: "celebrate", walkToCenter })`
  - `handleAgentStart()`：若 `!enabled` → log `[disabled] agent_start received, pet not running`；否则 `return-idle`
  - `applyEnabled(context)`：enabled 且无进程 → start；!enabled 且有进程 → stop
  - 四个命令写 Configuration（`ConfigurationTarget.Global`）
  - `onDidChangeConfiguration` 影响 `kunpet` 时重新 apply

- [ ] **Step 1: Write the failing test**

本 Task 依赖 VS Code API，不做 Extension Host 集成单测。用编译 + 手动 smoke（Task 4）。先改代码，确保 `npm run compile` 通过。

- [ ] **Step 2: Update extension.ts imports and helpers**

在文件顶部增加：

```typescript
import { readKunPetSettings } from "./settings";
import {
  CONFIG_ENABLED,
  CONFIG_SECTION,
  CONFIG_WALK_TO_CENTER,
} from "./types";
```

在模块级增加（activate 内赋值）：

```typescript
let extensionContext: vscode.ExtensionContext | undefined;

function currentSettings() {
  return readKunPetSettings((section) => vscode.workspace.getConfiguration(section));
}

async function updateSetting(key: string, value: boolean): Promise<void> {
  await vscode.workspace
    .getConfiguration(CONFIG_SECTION)
    .update(key, value, vscode.ConfigurationTarget.Global);
}

async function startPetIfNeeded(): Promise<void> {
  if (!extensionContext || !pet) return;
  const saved = readSavedPosition(extensionContext.globalState);
  const petRoot = resolvePetRoot(extensionContext.extensionPath);
  const runtimeDir = path.join(extensionContext.globalStorageUri.fsPath, "electron-runtime");
  await pet.start({ petRoot, runtimeDir, x: saved?.x, y: saved?.y });
  log("pet process started");
}

async function applyEnabled(): Promise<void> {
  const { enabled } = currentSettings();
  if (!enabled) {
    pet?.stop();
    log("pet disabled; process stopped");
    return;
  }
  try {
    await startPetIfNeeded();
  } catch (err) {
    log(`failed to start pet: ${err instanceof Error ? err.message : String(err)}`);
  }
}
```

Replace handlers:

```typescript
function handleStop(): void {
  const { enabled, walkToCenter } = currentSettings();
  if (!enabled) {
    log("[disabled] agent_stop received, pet not running");
    return;
  }
  pet?.send({ type: "celebrate", walkToCenter });
}

function handleAgentStart(): void {
  const { enabled } = currentSettings();
  if (!enabled) {
    log("[disabled] agent_start received, pet not running");
    return;
  }
  pet?.send({ type: "return-idle" });
}
```

- [ ] **Step 3: Wire activate — settings-aware start + commands + config listener**

在 `activate` 开头：`extensionContext = context;`

将末尾无条件 `pet.start(...)` 替换为：

```typescript
void applyEnabled();
```

在 `context.subscriptions.push(...)` 的命令列表中增加：

```typescript
vscode.commands.registerCommand("kunpet.enable", async () => {
  await updateSetting(CONFIG_ENABLED, true);
  await applyEnabled();
}),
vscode.commands.registerCommand("kunpet.disable", async () => {
  await updateSetting(CONFIG_ENABLED, false);
  await applyEnabled();
}),
vscode.commands.registerCommand("kunpet.enableWalkToCenter", async () => {
  await updateSetting(CONFIG_WALK_TO_CENTER, true);
  log("walkToCenter enabled");
}),
vscode.commands.registerCommand("kunpet.disableWalkToCenter", async () => {
  await updateSetting(CONFIG_WALK_TO_CENTER, false);
  log("walkToCenter disabled");
}),
vscode.workspace.onDidChangeConfiguration((e) => {
  if (!e.affectsConfiguration(CONFIG_SECTION)) return;
  void applyEnabled();
}),
```

Update show/hide/testCelebrate 在禁用时安全：

```typescript
vscode.commands.registerCommand("kunpet.show", () => {
  if (!currentSettings().enabled) {
    log("[disabled] show ignored");
    return;
  }
  pet?.send({ type: "show" });
}),
vscode.commands.registerCommand("kunpet.hide", () => {
  if (!currentSettings().enabled) {
    log("[disabled] hide ignored");
    return;
  }
  pet?.send({ type: "hide" });
}),
vscode.commands.registerCommand("kunpet.testCelebrate", () => {
  handleStop();
}),
```

注意：`updateSetting` 会触发 `onDidChangeConfiguration`，再调 `applyEnabled` 可能重复。命令里可只 `updateSetting`，由 listener 调用 `applyEnabled`；或命令内 apply、listener 也 apply（`pet.start` 已有 `if (this.child) return` 幂等）。**采用两者都调用 apply（幂等）**，实现简单。

- [ ] **Step 4: Compile**

Run: `cd extension && npm run compile && npm test`

Expected: compile exit 0；全部测试 PASS

- [ ] **Step 5: Commit**

```bash
git add extension/src/extension.ts
git commit -m "feat: wire enabled and walkToCenter settings in extension host"
```

---

### Task 3: 桌宠 main.js 尊重 walkToCenter

**Files:**
- Modify: `pet/main.js`

**Interfaces:**
- Consumes: IPC `{ type: "celebrate", walkToCenter?: boolean }`（缺省 `true`）
- Produces:
  - `beginCelebrate(walkToCenter)`：`false` 时原地 celebrate（设 `originPosition` 为当前位置或不走）；`true` 时现有 tween 逻辑
  - `beginReturnIdle()`：若未走过（`!didWalkForCelebrate` 或当前位置即 origin），取消 celebrate 视觉并直接 idle；若走过则 tween 回 origin
  - `handleMessage` 解析 `msg.walkToCenter !== false` 为默认走动

- [ ] **Step 1: Add walk flag state**

Near other state vars:

```javascript
/** @type {boolean} */
let walkEnabledForCurrentCelebrate = true;
```

- [ ] **Step 2: Rewrite beginCelebrate / beginReturnIdle**

```javascript
function celebrateInPlace() {
  setPetState("celebrate");
  sendToRenderer("pet:celebrate");
}

function beginCelebrate(walkToCenter) {
  if (!win) return;
  win.showInactive();

  const shouldWalk = walkToCenter !== false;
  walkEnabledForCurrentCelebrate = shouldWalk;

  if (!shouldWalk) {
    cancelTween();
    if (petState === "walking-to-center" || petState === "walking-back") {
      sendWalkEnd();
    }
    originPosition = getWindowPos();
    celebrateInPlace();
    return;
  }

  // existing walking-back / celebrate / walking-to-center / idle branches unchanged
  if (petState === "walking-back") {
    cancelTween();
    sendWalkEnd();
    const pos = getWindowPos();
    originPosition = { x: pos.x, y: pos.y };
    setPetState("walking-to-center");
    const center = getPrimaryCenterPos();
    tweenTo(center.x, center.y, () => {
      celebrateInPlace();
    });
    return;
  }

  if (petState === "celebrate") {
    sendToRenderer("pet:celebrate");
    return;
  }

  if (petState === "walking-to-center") {
    return;
  }

  const pos = getWindowPos();
  originPosition = { x: pos.x, y: pos.y };
  setPetState("walking-to-center");
  const center = getPrimaryCenterPos();
  tweenTo(center.x, center.y, () => {
    celebrateInPlace();
  });
}

function beginReturnIdle() {
  if (!win) return;
  if (petState === "idle" || petState === "walking-back") return;

  cancelTween();

  if (!walkEnabledForCurrentCelebrate) {
    originPosition = null;
    setPetState("idle");
    sendWalkEnd();
    return;
  }

  const target = originPosition ?? getWindowPos();
  setPetState("walking-back");
  tweenTo(target.x, target.y, () => {
    originPosition = null;
    setPetState("idle");
    sendWalkEnd();
  });
}
```

Update `handleMessage`:

```javascript
case "celebrate":
  beginCelebrate(msg.walkToCenter !== false);
  break;
```

说明：`walkToCenter: false` → 不走；`undefined` / `true` → 走。与扩展侧显式传布尔一致。

- [ ] **Step 3: Manual smoke note**

本 Task 无自动化 GUI 测试。Task 4 验收。

- [ ] **Step 4: Commit**

```bash
git add pet/main.js
git commit -m "feat: honor walkToCenter flag for in-place celebrate"
```

---

### Task 4: README 与端到端验收

**Files:**
- Modify: `README.md`

**Interfaces:**
- Consumes: 全部前述产物
- Produces: 文档化设置项、命令、验收清单

- [ ] **Step 1: Update README**

在 Hook 表附近增加「设置」小节：

```markdown
## 设置

Cursor / VS Code 设置中搜索 `kunPet`：

| 设置 | 默认 | 说明 |
|------|------|------|
| `kunpet.enabled` | `true` | 启用桌宠；关闭后不启动进程，Agent 事件仅写 Output |
| `kunpet.walkToCenter` | `true` | 完成时走到主屏中央；关闭则原地庆祝 |

对应命令：`kunPet: 启用/禁用桌宠`、`kunPet: 开启/关闭走到中间`（与设置双向同步）。
```

验收清单追加：

```markdown
10. **关闭走到中间**：设置关掉 → 测试完成提醒 → 原地庆祝；点击后原地回 idle
11. **禁用桌宠**：禁用命令 → 无窗口；Agent 完成 → Output「kunPet」出现 `[disabled] agent_stop...`；启用后桌宠恢复
12. **设置持久化**：改两项后重启 Cursor → 状态保持
```

Spec 链接：`docs/superpowers/specs/2026-08-20-kunpet-settings-toggles-design.md`

- [ ] **Step 2: Run full suite**

Run: `cd extension && npm test && npm run compile`

Expected: all PASS, compile OK

- [ ] **Step 3: Manual acceptance (F5)**

1. F5 → 确认桌宠出现  
2. 「关闭走到中间」→ 测试庆祝 → 原地  
3. 「开启走到中间」→ 测试庆祝 → 走到中央  
4. 「禁用桌宠」→ 窗消失；模拟 stop（测试命令）→ Output 有 disabled 日志  
5. 「启用桌宠」→ 窗恢复  
6. 设置页勾选改两项 → 行为与命令一致  

- [ ] **Step 4: Commit**

```bash
git add README.md
git commit -m "docs: document enabled and walkToCenter settings"
```

---

## Plan Self-Review

**Spec coverage:**

| Spec § | Task |
|--------|------|
| §3 配置与命令 | Task 1–2 |
| §4.1 禁用行为 | Task 2 |
| §4.2–4.3 walk 开/关 | Task 2–3 |
| §5 IPC | Task 1–3 |
| §6 边界 | Task 2–3 |
| §8 验收 | Task 4 |

**Placeholder scan:** 无 TBD；GUI 用手测已标明。

**Type consistency:** `walkToCenter?: boolean` 在 types → extension send → main `msg.walkToCenter !== false` 一致；配置键 `kunpet.enabled` / `kunpet.walkToCenter` 与 package.json 一致。

---

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-08-20-kunpet-settings-toggles.md`. Two execution options:

**1. Subagent-Driven (recommended)** — I dispatch a fresh subagent per task, review between tasks, fast iteration

**2. Inline Execution** — Execute tasks in this session using executing-plans, batch execution with checkpoints

Which approach?
