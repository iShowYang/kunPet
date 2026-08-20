# kunPet 走动庆祝与对话复位 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Agent 完成时鲲宠直线走到主屏中央再庆祝；用户点击或开始新对话时对称走回原待机位。

**Architecture:** 扩展侧新增 `beforeSubmitPrompt` / `sessionStart` Hook，经 HTTP 事件服务转发 `return-idle`；桌宠主进程（`pet/main.js`）用 Electron `screen` API 计算主屏中心，以 `setPosition` tween 驱动状态机；renderer 仅负责走路/庆祝视觉，celebrate 由 main 在到站后触发。

**Tech Stack:** TypeScript、VS Code Extension API、Node `http`、Electron `screen`/`BrowserWindow`、`hooks.json`（Cursor）、Windows 优先。

## Global Constraints

- 庆祝位置：主屏 `workArea` 几何中心（窗口 160×210 居中）
- 移动路径：直线 lerp；时长 `clamp(distance / 400px/s, 400ms, 1800ms)`；距离 `< 20px` 瞬间到位
- 庆祝时机：**到达中央后**才切 celebrate 图 + 气泡
- 自动复位：`beforeSubmitPrompt` + `sessionStart`；扩展侧 **500ms** dedupe；行为同点击（走回 `originPosition`）
- 完成信号 dedupe：保留现有 **2000ms**（`DEDUPE_WINDOW_MS`）
- Hook/桌宠失败必须静默（exit 0），不得影响 Agent
- HTTP 仅监听 `127.0.0.1`；位置持久化仍只保存 idle 待机位
- 规格来源：`docs/superpowers/specs/2026-08-19-kunpet-walk-celebrate-design.md`

---

## File Structure

| Path | Responsibility |
|------|----------------|
| `extension/src/types.ts` | 新增 Agent 事件类型、`return-idle` IPC、`AGENT_START_DEDUPE_MS` |
| `extension/src/tween-math.ts` | 与桌宠共用的纯函数（测试在扩展侧跑；桌宠 `pet/tween.js` 镜像实现） |
| `extension/src/hook-manager.ts` | 合并/清理 `stop` + `beforeSubmitPrompt` + `sessionStart` 三条 Hook |
| `extension/hooks/kunpet-notify.js` | 读 `--event=stop\|prompt\|session`，POST 对应 body.type |
| `extension/src/event-server.ts` | 接收三种事件；分别 dedupe |
| `extension/src/extension.ts` | `handleAgentStart()` → `{ type: "return-idle" }` |
| `extension/src/test/*.test.ts` | hook-manager / event-server / tween-math 单测 |
| `pet/tween.js` | 主进程 tween 纯函数（与 `tween-math.ts` 逻辑一致） |
| `pet/main.js` | 状态机、tween 引擎、IPC `celebrate` / `return-idle` |
| `pet/preload.js` | 暴露 `onWalkStart` / `onWalkEnd` / `onCelebrate` / `dismissCelebrate` |
| `pet/renderer/pet.js` | 走路态 class、朝向翻转；点击 celebrate 通知 main |
| `pet/renderer/style.css` | `#pet.walking` 样式 |
| `README.md` | 交互说明与验收项更新 |

---

### Task 1: 共享类型与 tween 纯函数

**Files:**
- Modify: `extension/src/types.ts`
- Create: `extension/src/tween-math.ts`
- Create: `extension/src/test/tween-math.test.ts`
- Create: `pet/tween.js`

**Interfaces:**
- Consumes: 现有 `AgentStopEvent`、`PetIpcMessage`、`DEDUPE_WINDOW_MS`
- Produces:
  - `AgentPromptEvent`: `{ type: "agent_prompt"; ts: number }`
  - `AgentSessionStartEvent`: `{ type: "agent_session_start"; ts: number }`
  - `AgentStartEvent`: `AgentPromptEvent | AgentSessionStartEvent`
  - `AgentEvent`: `AgentStopEvent | AgentStartEvent`
  - `AGENT_START_DEDUPE_MS = 500`
  - `PetIpcMessage` 新增 `{ type: "return-idle" }`
  - `computeTweenDurationMs(fromX, fromY, toX, toY): number`（0 表示跳过 tween）
  - `computePrimaryCenter(workArea): { x: number; y: number }`
  - `lerp(a, b, t): number`
  - `walkDirection(fromX, toX): "left" | "right"`

- [ ] **Step 1: Write the failing test**

Create `extension/src/test/tween-math.test.ts`:

```typescript
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  computePrimaryCenter,
  computeTweenDurationMs,
  lerp,
  walkDirection,
  WIN_HEIGHT,
  WIN_WIDTH,
} from "../tween-math";

describe("computeTweenDurationMs", () => {
  it("returns 0 for distances under 20px", () => {
    assert.equal(computeTweenDurationMs(0, 0, 10, 0), 0);
  });
  it("scales duration by distance with min 400ms", () => {
    assert.equal(computeTweenDurationMs(0, 0, 160, 0), 400);
  });
  it("caps duration at 1800ms", () => {
    assert.equal(computeTweenDurationMs(0, 0, 5000, 0), 1800);
  });
});

describe("computePrimaryCenter", () => {
  it("centers 160x210 window in workArea", () => {
    assert.deepEqual(computePrimaryCenter({ x: 0, y: 0, width: 1920, height: 1040 }), {
      x: Math.round((1920 - WIN_WIDTH) / 2),
      y: Math.round((1040 - WIN_HEIGHT) / 2),
    });
  });
});

describe("lerp", () => {
  it("interpolates linearly", () => {
    assert.equal(lerp(0, 100, 0.5), 50);
  });
});

describe("walkDirection", () => {
  it("faces right when moving right", () => {
    assert.equal(walkDirection(0, 100), "right");
  });
  it("faces left when moving left", () => {
    assert.equal(walkDirection(100, 0), "left");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd extension && npm test -- src/test/tween-math.test.ts`

Expected: FAIL — module `../tween-math` not found

- [ ] **Step 3: Write minimal implementation**

Append to `extension/src/types.ts`:

```typescript
export type AgentPromptEvent = {
  type: "agent_prompt";
  ts: number;
};

export type AgentSessionStartEvent = {
  type: "agent_session_start";
  ts: number;
};

export type AgentStartEvent = AgentPromptEvent | AgentSessionStartEvent;

export type AgentEvent = AgentStopEvent | AgentStartEvent;

export const AGENT_START_DEDUPE_MS = 500;
```

Change `PetIpcMessage` to include `{ type: "return-idle" }`.

Create `extension/src/tween-math.ts`:

```typescript
export const WIN_WIDTH = 160;
export const WIN_HEIGHT = 210;
const MIN_DISTANCE_PX = 20;
const MIN_DURATION_MS = 400;
const MAX_DURATION_MS = 1800;
const SPEED_PX_PER_S = 400;

function clamp(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, n));
}

export function distance(x1: number, y1: number, x2: number, y2: number): number {
  const dx = x2 - x1;
  const dy = y2 - y1;
  return Math.hypot(dx, dy);
}

export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

export function computeTweenDurationMs(
  fromX: number,
  fromY: number,
  toX: number,
  toY: number
): number {
  const d = distance(fromX, fromY, toX, toY);
  if (d < MIN_DISTANCE_PX) return 0;
  return clamp(Math.round((d / SPEED_PX_PER_S) * 1000), MIN_DURATION_MS, MAX_DURATION_MS);
}

export function computePrimaryCenter(workArea: {
  x: number;
  y: number;
  width: number;
  height: number;
}): { x: number; y: number } {
  return {
    x: Math.round(workArea.x + (workArea.width - WIN_WIDTH) / 2),
    y: Math.round(workArea.y + (workArea.height - WIN_HEIGHT) / 2),
  };
}

export function walkDirection(fromX: number, toX: number): "left" | "right" {
  return toX >= fromX ? "right" : "left";
}
```

Create `pet/tween.js` (CommonJS mirror — keep constants identical):

```javascript
const WIN_WIDTH = 160;
const WIN_HEIGHT = 210;
const MIN_DISTANCE_PX = 20;
const MIN_DURATION_MS = 400;
const MAX_DURATION_MS = 1800;
const SPEED_PX_PER_S = 400;

function clamp(n, min, max) {
  return Math.max(min, Math.min(max, n));
}

function distance(x1, y1, x2, y2) {
  const dx = x2 - x1;
  const dy = y2 - y1;
  return Math.hypot(dx, dy);
}

function lerp(a, b, t) {
  return a + (b - a) * t;
}

function computeTweenDurationMs(fromX, fromY, toX, toY) {
  const d = distance(fromX, fromY, toX, toY);
  if (d < MIN_DISTANCE_PX) return 0;
  return clamp(Math.round((d / SPEED_PX_PER_S) * 1000), MIN_DURATION_MS, MAX_DURATION_MS);
}

function computePrimaryCenter(workArea) {
  return {
    x: Math.round(workArea.x + (workArea.width - WIN_WIDTH) / 2),
    y: Math.round(workArea.y + (workArea.height - WIN_HEIGHT) / 2),
  };
}

function walkDirection(fromX, toX) {
  return toX >= fromX ? "right" : "left";
}

module.exports = {
  WIN_WIDTH,
  WIN_HEIGHT,
  lerp,
  computeTweenDurationMs,
  computePrimaryCenter,
  walkDirection,
};
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd extension && npm test -- src/test/tween-math.test.ts`

Expected: PASS (all tests)

- [ ] **Step 5: Commit**

```bash
git add extension/src/types.ts extension/src/tween-math.ts extension/src/test/tween-math.test.ts pet/tween.js
git commit -m "feat: add agent-start types and tween math helpers"
```

---

### Task 2: Hook 脚本与 hook-manager 三 Hook 合并

**Files:**
- Modify: `extension/hooks/kunpet-notify.js`
- Modify: `extension/src/hook-manager.ts`
- Modify: `extension/src/test/hook-manager.test.ts`

**Interfaces:**
- Consumes: `HOOK_SCRIPT_NAME`, `PORT_FILE_NAME`, `toHookPath`, `getCursorHome`
- Produces:
  - `mergeKunPetHook(hooksJson, hookKey, command): HooksFile` — 幂等合并单类 Hook
  - `removeKunPetHooks(hooksJson, marker): HooksFile` — 从 `stop` / `beforeSubmitPrompt` / `sessionStart` 移除含 marker 的条目
  - `ensureKunPetHook()` 注册三条 command：
    - `node "<dest>" --event=stop`
    - `node "<dest>" --event=prompt`
    - `node "<dest>" --event=session`

- [ ] **Step 1: Write the failing test**

Replace/extend `extension/src/test/hook-manager.test.ts` — add:

```typescript
import { mergeKunPetHook, removeKunPetHooks } from "../hook-manager";

const STOP_CMD = 'node "C:/Users/x/.cursor/hooks/kunpet-notify.js" --event=stop';
const PROMPT_CMD = 'node "C:/Users/x/.cursor/hooks/kunpet-notify.js" --event=prompt';
const SESSION_CMD = 'node "C:/Users/x/.cursor/hooks/kunpet-notify.js" --event=session';

describe("mergeKunPetHook", () => {
  it("adds beforeSubmitPrompt hook when missing", () => {
    const out = mergeKunPetHook({ version: 1, hooks: {} }, "beforeSubmitPrompt", PROMPT_CMD) as any;
    assert.equal(out.hooks.beforeSubmitPrompt.length, 1);
    assert.equal(out.hooks.beforeSubmitPrompt[0].command, PROMPT_CMD);
  });
  it("adds sessionStart hook when missing", () => {
    const out = mergeKunPetHook({ version: 1, hooks: {} }, "sessionStart", SESSION_CMD) as any;
    assert.equal(out.hooks.sessionStart.length, 1);
  });
  it("does not duplicate kunpet prompt hook", () => {
    const once = mergeKunPetHook({ version: 1, hooks: {} }, "beforeSubmitPrompt", PROMPT_CMD);
    const twice = mergeKunPetHook(once, "beforeSubmitPrompt", PROMPT_CMD) as any;
    assert.equal(twice.hooks.beforeSubmitPrompt.length, 1);
  });
});

describe("removeKunPetHooks", () => {
  it("removes kunpet entries from all three hook arrays", () => {
    const input = {
      version: 1,
      hooks: {
        stop: [{ command: STOP_CMD }, { command: "node other.js" }],
        beforeSubmitPrompt: [{ command: PROMPT_CMD }],
        sessionStart: [{ command: SESSION_CMD }, { command: "node keep.js" }],
      },
    };
    const out = removeKunPetHooks(input, "kunpet-notify.js") as any;
    assert.equal(out.hooks.stop.length, 1);
    assert.match(out.hooks.stop[0].command, /other\.js/);
    assert.equal(out.hooks.beforeSubmitPrompt.length, 0);
    assert.equal(out.hooks.sessionStart.length, 1);
    assert.match(out.hooks.sessionStart[0].command, /keep\.js/);
  });
});
```

Keep existing `mergeStopHook` tests passing — refactor `mergeStopHook` to call `mergeKunPetHook(..., "stop", cmd)` internally, or keep both.

- [ ] **Step 2: Run test to verify it fails**

Run: `cd extension && npm test -- src/test/hook-manager.test.ts`

Expected: FAIL — `mergeKunPetHook` / `removeKunPetHooks` not exported

- [ ] **Step 3: Write minimal implementation**

Update `extension/hooks/kunpet-notify.js`:

```javascript
#!/usr/bin/env node
/**
 * Cursor hook: notify kunPet extension. Always exit 0.
 * Usage: node kunpet-notify.js --event=stop|prompt|session
 */
const fs = require("fs");
const http = require("http");
const os = require("os");
const path = require("path");

const EVENT_MAP = {
  stop: "agent_stop",
  prompt: "agent_prompt",
  session: "agent_session_start",
};

function failOpen() {
  process.exit(0);
}

try {
  const eventArg = process.argv.find((a) => a.startsWith("--event="));
  const eventKey = eventArg ? eventArg.split("=")[1] : "stop";
  const bodyType = EVENT_MAP[eventKey] || EVENT_MAP.stop;

  const portFile = path.join(os.homedir(), ".cursor", "kunpet-port.json");
  if (!fs.existsSync(portFile)) failOpen();
  const { port } = JSON.parse(fs.readFileSync(portFile, "utf8"));
  if (!port) failOpen();

  const body = JSON.stringify({ type: bodyType, ts: Date.now() });
  const req = http.request(
    {
      host: "127.0.0.1",
      port,
      path: "/event",
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Content-Length": Buffer.byteLength(body),
      },
      timeout: 800,
    },
    (res) => {
      res.resume();
      res.on("end", failOpen);
    }
  );
  req.on("error", failOpen);
  req.on("timeout", () => {
    req.destroy();
    failOpen();
  });
  req.write(body);
  req.end();
} catch {
  failOpen();
}
```

In `extension/src/hook-manager.ts`, add:

```typescript
export function mergeKunPetHook(
  hooksJson: unknown,
  hookKey: string,
  command: string
): HooksFile {
  const base: HooksFile =
    hooksJson && typeof hooksJson === "object"
      ? (JSON.parse(JSON.stringify(hooksJson)) as HooksFile)
      : {};
  base.version = base.version ?? 1;
  base.hooks = base.hooks ?? {};
  const list = Array.isArray(base.hooks[hookKey]) ? base.hooks[hookKey]! : [];
  let found = false;
  for (const h of list) {
    if (typeof h?.command === "string" && h.command.includes(HOOK_SCRIPT_NAME)) {
      found = true;
      if (h.command !== command) h.command = command;
    }
  }
  if (!found) list.push({ command });
  base.hooks[hookKey] = list;
  return base;
}

export function removeKunPetHooks(hooksJson: unknown, marker: string): HooksFile {
  const base: HooksFile =
    hooksJson && typeof hooksJson === "object"
      ? (JSON.parse(JSON.stringify(hooksJson)) as HooksFile)
      : { version: 1, hooks: {} };
  base.hooks = base.hooks ?? {};
  for (const key of ["stop", "beforeSubmitPrompt", "sessionStart"]) {
    const list = Array.isArray(base.hooks[key]) ? base.hooks[key]! : [];
    base.hooks[key] = list.filter(
      (h) => !(typeof h?.command === "string" && h.command.includes(marker))
    );
  }
  return base;
}
```

Refactor `mergeStopHook` to delegate:

```typescript
export function mergeStopHook(hooksJson: unknown, command: string): HooksFile {
  return mergeKunPetHook(hooksJson, "stop", command);
}
```

Refactor `removeStopHook` → use `removeKunPetHooks` (update `cleanupKunPetHook` accordingly).

Update `ensureKunPetHook`:

```typescript
const dest = await installHookScript(cursorHome, opts.extensionHookSource);
const stopCmd = `node "${dest}" --event=stop`;
const promptCmd = `node "${dest}" --event=prompt`;
const sessionCmd = `node "${dest}" --event=session`;
let current: unknown = { version: 1, hooks: {} };
// ... read hooks.json ...
let merged = mergeKunPetHook(current, "stop", stopCmd);
merged = mergeKunPetHook(merged, "beforeSubmitPrompt", promptCmd);
merged = mergeKunPetHook(merged, "sessionStart", sessionCmd);
```

Update `cleanupKunPetHook` to call `removeKunPetHooks(current, HOOK_SCRIPT_NAME)`.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd extension && npm test -- src/test/hook-manager.test.ts`

Expected: PASS (all hook-manager tests)

- [ ] **Step 5: Commit**

```bash
git add extension/hooks/kunpet-notify.js extension/src/hook-manager.ts extension/src/test/hook-manager.test.ts
git commit -m "feat: register stop, prompt, and session hooks for kunPet"
```

---

### Task 3: 事件服务与扩展接线（agent_start → return-idle）

**Files:**
- Modify: `extension/src/event-server.ts`
- Modify: `extension/src/extension.ts`
- Create: `extension/src/test/event-server-agent-start.test.ts`

**Interfaces:**
- Consumes: `AgentEvent`, `AGENT_START_DEDUPE_MS`, `DEDUPE_WINDOW_MS`, `shouldDedupe`
- Produces:
  - `startEventServer(opts: { onAgentStop; onAgentStart; preferredPort? })`
  - `extension.ts` 中 `handleAgentStart(): void` → `pet?.send({ type: "return-idle" })`

- [ ] **Step 1: Write the failing test**

Create `extension/src/test/event-server-agent-start.test.ts`:

```typescript
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { startEventServer } from "../event-server";

async function post(port: number, body: unknown): Promise<string> {
  return new Promise((resolve, reject) => {
    const payload = JSON.stringify(body);
    const req = http.request(
      {
        host: "127.0.0.1",
        port,
        path: "/event",
        method: "POST",
        headers: { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(payload) },
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (c) => chunks.push(c));
        res.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
      }
    );
    req.on("error", reject);
    req.write(payload);
    req.end();
  });
}

describe("startEventServer agent_start", () => {
  it("accepts agent_prompt and dedupes within 500ms", async () => {
    let count = 0;
    const server = await startEventServer({
      onAgentStop: () => {},
      onAgentStart: () => {
        count += 1;
      },
    });
    try {
      await post(server.port, { type: "agent_prompt", ts: 1 });
      await post(server.port, { type: "agent_session_start", ts: 2 });
      assert.equal(count, 1);
    } finally {
      await server.close();
    }
  });

  it("still accepts agent_stop with separate 2s dedupe bucket", async () => {
    let stopCount = 0;
    let startCount = 0;
    const server = await startEventServer({
      onAgentStop: () => {
        stopCount += 1;
      },
      onAgentStart: () => {
        startCount += 1;
      },
    });
    try {
      await post(server.port, { type: "agent_stop", ts: 100 });
      await post(server.port, { type: "agent_prompt", ts: 200 });
      assert.equal(stopCount, 1);
      assert.equal(startCount, 1);
    } finally {
      await server.close();
    }
  });

  it("rejects unknown event types", async () => {
    const server = await startEventServer({ onAgentStop: () => {}, onAgentStart: () => {} });
    try {
      const req = http.request({
        host: "127.0.0.1",
        port: server.port,
        path: "/event",
        method: "POST",
        headers: { "Content-Type": "application/json", "Content-Length": 2 },
      });
      const status: number = await new Promise((resolve, reject) => {
        req.on("response", (res) => resolve(res.statusCode ?? 0));
        req.on("error", reject);
        req.write("{}");
        req.end();
      });
      assert.equal(status, 400);
    } finally {
      await server.close();
    }
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd extension && npm test -- src/test/event-server-agent-start.test.ts`

Expected: FAIL — `onAgentStart` not in `startEventServer` options / prompt not accepted

- [ ] **Step 3: Write minimal implementation**

Update `extension/src/event-server.ts`:

```typescript
import type { AgentEvent, AgentStartEvent, AgentStopEvent } from "./types";
import { AGENT_START_DEDUPE_MS, DEDUPE_WINDOW_MS } from "./types";

function isAgentStop(body: unknown): body is AgentStopEvent {
  return (
    typeof body === "object" &&
    body !== null &&
    (body as AgentStopEvent).type === "agent_stop" &&
    typeof (body as AgentStopEvent).ts === "number"
  );
}

function isAgentStart(body: unknown): body is AgentStartEvent {
  return (
    typeof body === "object" &&
    body !== null &&
    ((body as AgentStartEvent).type === "agent_prompt" ||
      (body as AgentStartEvent).type === "agent_session_start") &&
    typeof (body as AgentStartEvent).ts === "number"
  );
}

export async function startEventServer(opts: {
  onAgentStop: (e: AgentStopEvent) => void;
  onAgentStart: (e: AgentStartEvent) => void;
  preferredPort?: number;
}): Promise<{ port: number; close: () => Promise<void> }> {
  let lastStopTs = 0;
  let lastStartTs = 0;

  const server = http.createServer((req, res) => {
    if (req.method === "POST" && req.url === "/event") {
      const chunks: Buffer[] = [];
      req.on("data", (c) => chunks.push(c));
      req.on("end", () => {
        try {
          const body = JSON.parse(Buffer.concat(chunks).toString("utf8")) as AgentEvent;
          const now = Date.now();
          if (isAgentStop(body)) {
            if (shouldDedupe(now, lastStopTs, DEDUPE_WINDOW_MS)) {
              res.writeHead(200).end("deduped");
              return;
            }
            lastStopTs = now;
            opts.onAgentStop(body);
            res.writeHead(200).end("ok");
            return;
          }
          if (isAgentStart(body)) {
            if (shouldDedupe(now, lastStartTs, AGENT_START_DEDUPE_MS)) {
              res.writeHead(200).end("deduped");
              return;
            }
            lastStartTs = now;
            opts.onAgentStart(body);
            res.writeHead(200).end("ok");
            return;
          }
          res.writeHead(400).end("bad request");
        } catch {
          res.writeHead(400).end("bad json");
        }
      });
      return;
    }
    res.writeHead(404).end("not found");
  });
  // ... rest unchanged (port binding) ...
}
```

Update `extension/src/extension.ts`:

```typescript
function handleAgentStart(): void {
  pet?.send({ type: "return-idle" });
}

// in activate():
const server = await startEventServer({
  onAgentStop: () => handleStop(),
  onAgentStart: () => handleAgentStart(),
});
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd extension && npm test`

Expected: PASS (all extension tests)

- [ ] **Step 5: Commit**

```bash
git add extension/src/event-server.ts extension/src/extension.ts extension/src/test/event-server-agent-start.test.ts
git commit -m "feat: handle agent_start events and send return-idle to pet"
```

---

### Task 4: 桌宠主进程状态机与 tween 引擎

**Files:**
- Modify: `pet/main.js`

**Interfaces:**
- Consumes: `pet/tween.js` 导出函数；Electron `screen.getPrimaryDisplay()`；现有 `handleMessage` IPC
- Produces:
  - 模块内状态：`"idle" | "walking-to-center" | "celebrate" | "walking-back"`
  - `originPosition: { x, y } | null`
  - `beginCelebrate()` — 保存 origin → walk to center → `sendToRenderer("pet:celebrate")`
  - `beginReturnIdle()` — 取消 tween → 若 celebrate 则 `pet:walk-end` → walk to origin → idle
  - IPC：`celebrate` 调用 `beginCelebrate()`；`return-idle` 调用 `beginReturnIdle()`
  - walking-back 中收到 `celebrate`：取消走回，**当前位置**为新 origin，重新 `beginCelebrate()`

- [ ] **Step 1: Write the failing test**

桌宠主进程依赖 Electron 窗口，不做 Electron 集成单测。本 Task 以 **手动 smoke** 代替：先实现代码，Task 6 统一验收。在 commit 前运行 `cd extension && npm run compile` 确保扩展仍可编译。

- [ ] **Step 2: Implement tween helper in main.js**

在 `pet/main.js` 顶部引入：

```javascript
const { screen, ipcMain } = require("electron");
const {
  lerp,
  computeTweenDurationMs,
  computePrimaryCenter,
  walkDirection,
} = require("./tween");
```

添加状态变量与 tween 控制：

```javascript
/** @type {"idle"|"walking-to-center"|"celebrate"|"walking-back"} */
let petState = "idle";
/** @type {{x:number,y:number}|null} */
let originPosition = null;
/** @type {ReturnType<typeof setInterval>|null} */
let activeTween = null;

function cancelTween() {
  if (activeTween !== null) {
    clearInterval(activeTween);
    activeTween = null;
  }
}

function getWindowPos() {
  if (!win || win.isDestroyed()) return { x: 0, y: 0 };
  const [x, y] = win.getPosition();
  return { x, y };
}

function sendWalkStart(direction) {
  if (!win || win.isDestroyed()) return;
  win.webContents.send("pet:walk-start", { direction });
}

function sendWalkEnd() {
  if (!win || win.isDestroyed()) return;
  win.webContents.send("pet:walk-end");
}

function tweenTo(targetX, targetY, onDone) {
  cancelTween();
  if (!win || win.isDestroyed()) return;
  const { x: fromX, y: fromY } = getWindowPos();
  const durationMs = computeTweenDurationMs(fromX, fromY, targetX, targetY);
  sendWalkStart(walkDirection(fromX, targetX));

  if (durationMs === 0) {
    win.setPosition(targetX, targetY);
    sendWalkEnd();
    onDone();
    return;
  }

  const started = Date.now();
  activeTween = setInterval(() => {
    if (!win || win.isDestroyed()) {
      cancelTween();
      return;
    }
    const t = Math.min(1, (Date.now() - started) / durationMs);
    const x = Math.round(lerp(fromX, targetX, t));
    const y = Math.round(lerp(fromY, targetY, t));
    win.setPosition(x, y);
    if (t >= 1) {
      cancelTween();
      sendWalkEnd();
      onDone();
    }
  }, 16);
}

function getPrimaryCenterPos() {
  const workArea = screen.getPrimaryDisplay().workArea;
  return computePrimaryCenter(workArea);
}

function setPetState(next) {
  petState = next;
}

function beginCelebrate() {
  if (!win) return;
  win.showInactive();

  if (petState === "walking-back") {
    cancelTween();
    sendWalkEnd();
    const pos = getWindowPos();
    originPosition = { x: pos.x, y: pos.y };
    setPetState("walking-to-center");
    const center = getPrimaryCenterPos();
    tweenTo(center.x, center.y, () => {
      setPetState("celebrate");
      sendToRenderer("pet:celebrate");
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
    setPetState("celebrate");
    sendToRenderer("pet:celebrate");
  });
}

function beginReturnIdle() {
  if (!win) return;
  if (petState === "idle" || petState === "walking-back") return;

  cancelTween();
  if (petState === "celebrate") {
    sendWalkEnd();
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

- [ ] **Step 3: Wire IPC handlers**

Replace `handleMessage` celebrate branch and add return-idle:

```javascript
function handleMessage(msg) {
  if (!win) return;
  switch (msg.type) {
    case "celebrate":
      beginCelebrate();
      break;
    case "return-idle":
      beginReturnIdle();
      break;
    case "show":
      win.showInactive();
      break;
    case "hide":
      win.hide();
      break;
    case "set-position":
      if (petState === "idle") {
        win.setPosition(msg.x, msg.y);
      }
      break;
  }
}
```

Register renderer dismiss:

```javascript
function setupRendererIpc() {
  ipcMain.on("pet:dismiss-celebrate", () => {
    if (petState === "celebrate") {
      beginReturnIdle();
    }
  });
}

// in app.whenReady():
setupRendererIpc();
```

Prevent position persistence during walk: in existing `win.on("moved")` handler, only emit moved stdout when `petState === "idle"` (extension saves position on moved events).

- [ ] **Step 4: Compile extension**

Run: `cd extension && npm run compile`

Expected: exit 0, no TypeScript errors

- [ ] **Step 5: Commit**

```bash
git add pet/main.js
git commit -m "feat: add pet window tween state machine for walk celebrate"
```

---

### Task 5: Renderer 走路态与 celebrate 时机

**Files:**
- Modify: `pet/preload.js`
- Modify: `pet/renderer/pet.js`
- Modify: `pet/renderer/style.css`

**Interfaces:**
- Consumes: main 进程 channels `pet:walk-start`、`pet:walk-end`、`pet:celebrate`
- Produces:
  - `window.kunpet.onWalkStart(cb)` / `onWalkEnd(cb)` / `onCelebrate(cb)` / `dismissCelebrate()`
  - renderer 仅在收到 `pet:celebrate` 时调用 `enterCelebrate()`
  - walking 态：`#pet.walking`、`-webkit-app-region: no-drag`、图片 `scaleX(-1)` 朝左

- [ ] **Step 1: Update preload.js**

```javascript
const { contextBridge, ipcRenderer } = require("electron");
contextBridge.exposeInMainWorld("kunpet", {
  onCelebrate: (cb) => ipcRenderer.on("pet:celebrate", () => cb()),
  onWalkStart: (cb) =>
    ipcRenderer.on("pet:walk-start", (_e, payload) => cb(payload)),
  onWalkEnd: (cb) => ipcRenderer.on("pet:walk-end", () => cb()),
  dismissCelebrate: () => ipcRenderer.send("pet:dismiss-celebrate"),
});
```

- [ ] **Step 2: Update pet/renderer/style.css**

Add after `#pet.idle img`:

```css
#pet.walking {
  -webkit-app-region: no-drag;
}

#pet.walking img {
  animation: breathe 2.5s ease-in-out infinite;
}

#pet.walking img.face-left {
  transform: scaleX(-1);
}
```

- [ ] **Step 3: Update pet/renderer/pet.js**

Key changes:

```javascript
function enterWalking(direction) {
  clearInterval(idleFlipTimer);
  pet.classList.remove("idle", "celebrate");
  pet.classList.add("walking");
  document.body.style.webkitAppRegion = "no-drag";
  setIdleFrame(false);
  img.classList.toggle("face-left", direction === "left");
}

function exitWalking() {
  pet.classList.remove("walking");
  img.classList.remove("face-left");
}

function enterCelebrate() {
  exitWalking();
  clearInterval(idleFlipTimer);
  pet.classList.remove("idle");
  pet.classList.add("celebrate");
  document.body.style.webkitAppRegion = "no-drag";
  img.src = CELEBRATE_SRC;
  showBubble(pickCelebrateMessage());
}

function exitCelebrateToIdle() {
  if (!pet.classList.contains("celebrate")) return;
  pet.classList.remove("celebrate");
  pet.classList.add("idle");
  document.body.style.webkitAppRegion = "drag";
  bubble.hidden = true;
  bubble.classList.remove("is-visible");
  setIdleFrame(false);
  startIdleCycle();
}

// Remove direct enterCelebrate on pet:celebrate from old code path during walk.
// Replace window.kunpet.onCelebrate handler — keep enterCelebrate as above.

window.kunpet.onWalkStart(({ direction }) => {
  enterWalking(direction);
});

window.kunpet.onWalkEnd(() => {
  exitWalking();
  if (!pet.classList.contains("celebrate")) {
    pet.classList.add("idle");
    document.body.style.webkitAppRegion = "drag";
    startIdleCycle();
  }
});

window.kunpet.onCelebrate(() => {
  enterCelebrate();
});

pet.addEventListener("click", () => {
  if (pet.classList.contains("celebrate")) {
    window.kunpet.dismissCelebrate();
  }
});
```

Remove old `exitCelebrate` that immediately returned to idle on click — click now delegates to main for walk-back.

- [ ] **Step 4: Manual smoke (F5)**

1. F5 启动扩展开发宿主
2. 命令面板「kunPet: 测试完成提醒」→ 鲲宠应**先移动**到主屏中央，再庆祝
3. 点击鲲宠 → 应走回原位置并 idle
4. 再次测试庆祝，不点击，在 Agent 输入框发送消息 → 应自动走回（可用 `curl` 模拟 `agent_prompt` 若 Hook 未就绪）：

```powershell
$port = (Get-Content "$env:USERPROFILE\.cursor\kunpet-port.json" | ConvertFrom-Json).port
Invoke-WebRequest -Uri "http://127.0.0.1:$port/event" -Method POST -ContentType "application/json" -Body '{"type":"agent_prompt","ts":1}'
```

Expected: 鲲宠从 celebrate 走回 origin

- [ ] **Step 5: Commit**

```bash
git add pet/preload.js pet/renderer/pet.js pet/renderer/style.css
git commit -m "feat: renderer walk state and defer celebrate until arrival"
```

---

### Task 6: README 与端到端验收

**Files:**
- Modify: `README.md`

**Interfaces:**
- Consumes: 全部前述 Task 产物
- Produces: 文档化走动庆祝、自动复位、三 Hook 注册说明

- [ ] **Step 1: Update README.md**

在「Hook 与端口文件」表增加：

| Hook 名 | 触发 | POST type |
|---------|------|-----------|
| `stop` | Agent 完成 | `agent_stop` |
| `beforeSubmitPrompt` | 发送 Agent 消息 | `agent_prompt` |
| `sessionStart` | 新 Session | `agent_session_start` |

更新验收清单（替换/追加）：

1. **走动庆祝**：命令「kunPet: 测试完成提醒」→ 鲲宠直线走到主屏中央 → 竖大拇指 + 气泡
2. **点击走回**：点击鲲宠 → 对称走回原位置 → idle
3. **发消息复位**：celebrate 中向 Agent 发消息 → 自动走回 idle（无需点击）
4. **新 Session 复位**：celebrate 中新开对话 → 走回 idle；连续 Hook 无动画抖动
5. **隐藏后完成**：手动隐藏 → Agent 完成 → 先 show 再 walk → 庆祝
6. **Hook 合并**：预置其他 `stop` / `beforeSubmitPrompt` 条目 → 激活后 kunPet 三条均在且原有条目保留
7. **静默失败 / 无 IDE Toast / 关闭 Cursor 无残留** — 保留 v2 条目

Spec 链接改为：`docs/superpowers/specs/2026-08-19-kunpet-walk-celebrate-design.md`

- [ ] **Step 2: Run full test suite**

Run: `cd extension && npm test && npm run compile`

Expected: all tests PASS, compile exit 0

- [ ] **Step 3: Full manual acceptance**

按 README 验收清单逐项在 Windows + Cursor F5 环境确认（规格 §8 全部 9 条）。

- [ ] **Step 4: Commit**

```bash
git add README.md
git commit -m "docs: update README for walk-celebrate and auto-return idle"
```

---

## Plan Self-Review

**Spec coverage:**

| Spec § | Task |
|--------|------|
| §2 决策摘要 | Task 1–5 |
| §3 状态机 / 事件流 | Task 3–5 |
| §3.3 三 Hook | Task 2 |
| §4 移动算法 | Task 1, 4 |
| §5 Renderer 表现 | Task 5 |
| §6 边界情况 | Task 4 (`beginCelebrate` / `beginReturnIdle` 分支), Task 3 (dedupe) |
| §8 验收标准 1–9 | Task 6 |
| §9 非目标 | 未纳入任务 |

**Placeholder scan:** 无 TBD；Task 4 用 Task 6 手动验收替代 Electron 单测（已说明原因）。

**Type consistency:** `agent_prompt` / `agent_session_start` / `return-idle` / `pet:dismiss-celebrate` 全链路透传一致。

---

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-08-19-kunpet-walk-celebrate.md`. Two execution options:

**1. Subagent-Driven (recommended)** — I dispatch a fresh subagent per task, review between tasks, fast iteration

**2. Inline Execution** — Execute tasks in this session using executing-plans, batch execution with checkpoints

Which approach?
