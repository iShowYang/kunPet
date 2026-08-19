# kunPet 走动庆祝与对话复位 设计规格

**日期：** 2026-08-19  
**状态：** 待用户审阅  
**基于：** [2026-08-19-kunpet-v2-design.md](./2026-08-19-kunpet-v2-design.md)  
**变更主题：** 完成提醒改为走到主屏中央庆祝；对话开始时自动走回待机位

---

## 1. 目标

在 v2「庆祝 + 气泡、点击结束」基础上，让完成提醒**更醒目**：

- Agent 完成（`stop`）时，鲲宠从当前位置**直线走到主屏中央**，到站后再庆祝
- 用户**点击鲲宠**或**开始新对话**时，对称**走回原待机位置**，回到 idle
- 不点击时 celebrate 可一直保持；一旦发消息或新 Session，自动复位

---

## 2. 决策摘要

| 决策点 | 结论 |
|--------|------|
| 庆祝位置 | 主屏 `workArea` 几何中心（窗口 160×210 居中） |
| 移动路径 | 直线 lerp（最短路径） |
| 庆祝时机 | **到达中央后**才切 celebrate 图 + 气泡 |
| 单屏行为 | 同样走到中央（距离短时瞬间到位） |
| 点击结束 | 对称走回 `originPosition`（庆祝前记录的位置） |
| 自动复位触发 | `beforeSubmitPrompt`（发消息）+ `sessionStart`（新 Session） |
| 自动复位行为 | 与点击一致：取消 celebrate → 走回 origin → idle |
| 移动期间 | 不可拖动、不可点击结束 |
| 位置持久化 | 只保存 idle 待机位；中央为临时点，不写 `kunpet.position` |

---

## 3. 架构

### 3.1 状态机

```
idle ──(agent_stop)──► walking-to-center ──(到达)──► celebrate
         ▲                    │                         │
         │              (中途 agent_start)              │
         │                    │                         │
         │                    ▼                         │
         │              walking-back ◄──(点击 / agent_start)──┘
         │                    │
         └────(到达)──────────┘
```

**`agent_start`** = 扩展收到 `agent_prompt` 或 `agent_session_start`（Hook 去重后统一处理）。

### 3.2 事件流

```
Agent stop (Hook)
    ↓
kunpet-notify.js --event=stop--> POST /event { type: "agent_stop" }
    ↓
扩展 handleStop() --> 桌宠 POST /ipc { type: "celebrate" }
    ↓
main.js: 记录 origin → tween 到主屏中心 → renderer celebrate

用户发消息 / 新 Session (Hook)
    ↓
kunpet-notify.js --event=prompt|session--> POST /event
    ↓
扩展 handleAgentStart() (500ms dedupe) --> 桌宠 { type: "return-idle" }
    ↓
main.js: 取消 tween → 退出 celebrate 视觉 → tween 回 origin → idle

用户点击鲲宠 (celebrate 态)
    ↓
renderer 通知 main 或本地触发 return-idle 同等逻辑
    ↓
walking-back → idle
```

### 3.3 Hook 扩展

| Hook | 事件 POST body.type | 说明 |
|------|---------------------|------|
| `stop`（已有） | `agent_stop` | Agent 本轮结束 |
| `beforeSubmitPrompt`（新增） | `agent_prompt` | 用户发送 Agent 消息 |
| `sessionStart`（新增） | `agent_session_start` | 新 Session / 新对话 |

- 脚本：`~/.cursor/hooks/kunpet-notify.js`，通过 CLI 参数区分事件，例如 `--event=stop|prompt|session`
- `hook-manager.ts`：幂等合并三条 Hook 条目，不覆盖用户其他 Hook
- 均为 observe-only，fail-open，`exit 0`

### 3.4 与 v2 的差异

| 项 | v2 | 本规格 |
|----|-----|--------|
| 庆祝位置 | 当前窗口位置 | 主屏中央（先 walk 再 celebrate） |
| 结束庆祝 | 仅点击 | 点击 **或** 发消息 / 新 Session |
| 结束后位置 | 留在原地 | 走回 `originPosition` |
| Hook 数量 | 仅 `stop` | `stop` + `beforeSubmitPrompt` + `sessionStart` |

---

## 4. 移动算法

| 项 | 规则 |
|----|------|
| 主屏 | `screen.getPrimaryDisplay().workArea` |
| 目标点 | `(workArea.x + (width - 160) / 2, workArea.y + (height - 210) / 2)` |
| 插值 | 线性 lerp，`setPosition` 驱动 |
| 时长 | `clamp(distance / 400px/s, 400ms, 1800ms)` |
| 极短距离 | `< 20px` 跳过 tween，直接到位 |
| 帧驱动 | `requestAnimationFrame` 或 ~16ms interval（main 进程） |

走回使用相同算法，目标为庆祝开始时保存的 `originPosition`。

---

## 5. Renderer 表现

| 状态 | 视觉 |
|------|------|
| `walking-to-center` / `walking-back` | `kun-idle.png` + `breathe`；按 `dx` 对图片 `scaleX(-1)` 朝向移动方向 |
| `celebrate` | 现有竖大拇指 + 随机气泡（v2 不变） |
| `idle` | 现有 idle/rest 轮换（不变） |

Main → Renderer IPC channel：

- `pet:walk-start { direction: "left" | "right" }`
- `pet:walk-end`
- `pet:celebrate`（仅到达中央后发送）

---

## 6. 边界情况

| 场景 | 行为 |
|------|------|
| celebrate 中发消息 | 取消庆祝 → walking-back → origin |
| 走向中央途中发消息 | 取消前往 → 直接 walking-back → origin |
| walking-back 中再发消息 | 忽略（已在复位） |
| walking-back 中又来 stop | 取消走回；**当前位置**为新 origin，重新走向中央 |
| 已在 idle 时 agent_start | 无操作 |
| 窗口隐藏时 stop | `showInactive()` 后执行 walk → celebrate |
| 连续 stop | 扩展侧保留 2s dedupe（现有 `DEDUPE_WINDOW_MS`） |
| sessionStart + beforeSubmitPrompt 连发 | 扩展侧 **500ms** 内合并为一次 `return-idle` |
| origin 记录 | 仅在每次 `celebrate` 流程开始时写入；walking-back 中途 stop 不覆盖 origin |

---

## 7. 文件级改动范围

| 区域 | 改动 |
|------|------|
| `pet/main.js` | `screen` API、tween 引擎、状态机、`return-idle` / celebrate 流程 |
| `pet/preload.js` | 暴露 `onWalkStart` / `onWalkEnd` |
| `pet/renderer/pet.js` | 走路态 class、朝向翻转、celebrate 时机 |
| `pet/renderer/style.css` | `#pet.walking` 样式 |
| `extension/hooks/kunpet-notify.js` | 支持 `--event=stop|prompt|session` |
| `extension/src/hook-manager.ts` | 合并三种 Hook；必要时扩展 merge 函数 |
| `extension/src/event-server.ts` | 接收 `agent_prompt` / `agent_session_start` |
| `extension/src/extension.ts` | `handleAgentStart()` → `return-idle` |
| `extension/src/types.ts` | 新事件类型、`AGENT_START_DEDUPE_MS = 500` |
| `extension/src/test/*` | hook-manager / event-server 增量测试 |
| `README.md` | 更新交互说明与验收项 |

**不改：** 扩展 → 桌宠 的 celebrate 触发路径（仍发 `{ type: "celebrate" }`）；三张 PNG 资源。

---

## 8. 验收标准

1. 副屏角落 idle → Agent 完成 → 直线走到主屏中央 → 庆祝 + 气泡
2. 不点击，向 Agent 发消息 → 自动走回原位置 → idle
3. 不点击，新开 Session → 同样自动走回（无重复动画抖动）
4. 点击鲲宠结束庆祝 → 对称走回 origin → idle
5. 单屏且已在中央附近 → 短距离/瞬间到位 → 正常庆祝
6. 手动隐藏后完成 → 先 show 再 walk → 庆祝
7. walking 过程中不可点击结束；celebrate 中可点击
8. 关闭 Cursor → 无 kunPet 相关进程残留
9. `hooks.json` 合并后用户原有其他 Hook 条目仍在

---

## 9. 非目标

- 沿屏幕边缘绕路行走（用户选择直线）
- 走路精灵图序列帧（复用 idle 图 + 窗口位移）
- 可配置庆祝位置 / 开关走动（写死主屏中央）
- macOS/Linux 优先适配
- 养成、喂食等多宠物功能

---

## 10. 推荐实现策略

**方案：主进程窗口 tween（方案 1）**

在现有 extension + Electron pet + Hook + HTTP IPC 上扩展状态机与 Hook，不重构技术栈。跨副屏/主屏可靠，无需新美术资源，与 v2 代码结构一致。

备选方案（不采用）：

- Renderer CSS 位移模拟跨屏 — 无法真实从副屏走来
- 走路序列帧 — 复杂度高，YAGNI
