# kunPet 多窗口单实例设计规格

**日期：** 2026-08-27  
**状态：** 待用户审阅  
**基于：** [2026-08-19-kunpet-design.md](./2026-08-19-kunpet-design.md)  
**变更主题：** 多个 Cursor 窗口同时打开时，仅保留一个桌宠进程与一个系统托盘图标

---

## 1. 问题与目标

### 1.1 现状

每个 Cursor 窗口拥有独立的 Extension Host。扩展在 `activate` 时各自 `spawn` 一个 Electron 桌宠子进程；`pet/main.js` 中每个进程都会调用 `setupTray()`。因此打开两个 Cursor 窗口会出现两个 kunPet 托盘图标和两个桌宠窗口。

原设计文档（§6）已约定「多 Cursor 窗口 → 单一桌宠实例」，但实现尚未落地。

### 1.2 目标

| 成功标准 | 说明 |
|----------|------|
| 单一托盘 | 任意数量的 Cursor 窗口，系统托盘仅一个 kunPet 图标 |
| 单一桌宠 | 仅一个 Electron 进程、一个悬浮窗 |
| 窗口关闭 | 关闭其中一个窗口时桌宠**继续显示**（只要仍有窗口开着且 kunPet 启用） |
| 最后窗口 | 关闭最后一个 Cursor 窗口时桌宠正常 stop |
| 托盘可用 | spawn 者窗口先关闭时，托盘菜单（禁用、设置等）仍可用 |
| 向后兼容 | 单窗口场景行为与现版一致 |

### 1.3 非目标

- macOS / Linux 多窗口适配（首版仍聚焦 Windows）
- 多桌宠 / 多宠物实例
- 独立守护进程架构

---

## 2. 决策摘要

| 决策点 | 结论 |
|--------|------|
| 核心方案 | 扩展侧 Host 注册表 + 共享 Pet 状态文件 |
| Electron 双保险 | `app.requestSingleInstanceLock()` 防止竞态下重复 spawn |
| 托盘 → 扩展通信 | 改为 HTTP POST 到 event server，不再依赖 stdout |
| Event Server | 全机单实例；后续 Host 附着，不重复监听、不覆盖 port 文件 |
| 生命周期 | Host 引用计数；仅最后一个 Host 退出时 stop 桌宠 |
| 协调文件位置 | `~/.cursor/kunpet-hosts.json`、`~/.cursor/kunpet-pet.json`（与现有 `kunpet-port.json` 并列） |

---

## 3. 架构

### 3.1 总览

```
┌──────────────────┐     ┌──────────────────┐
│  Cursor 窗口 A   │     │  Cursor 窗口 B   │
│  Extension Host  │     │  Extension Host  │
└────────┬─────────┘     └────────┬─────────┘
         │ register               │ register
         ▼                        ▼
┌────────────────────────────────────────────┐
│  ~/.cursor/ 协调层                          │
│  kunpet-hosts.json   ← Host 列表 + 心跳    │
│  kunpet-pet.json     ← 桌宠 IPC 端口       │
│  kunpet-port.json    ← Event Server 端口   │
└────────────────────┬───────────────────────┘
                     │ HTTP IPC（celebrate 等）
                     ▼
         ┌───────────────────────┐
         │ 单一 Electron 桌宠     │
         │ · 一个悬浮窗           │
         │ · 一个系统托盘         │
         └───────────┬───────────┘
                     │ 托盘事件 HTTP POST
                     ▼
         Event Server（首个 Host 监听）
```

### 3.2 Host 角色

| 角色 | 职责 |
|------|------|
| **Pet Owner** | spawn 桌宠子进程，维护 stdout 日志；写 `kunpet-pet.json` |
| **Pet Client** | 读 `kunpet-pet.json`，经 HTTP 与已有桌宠通信，不 spawn |
| **Event Owner** | 启动 event server，写 `kunpet-port.json`，注册 Hook |
| **Event Client** | 检测到存活 event server 后跳过启动，不覆盖 port 文件 |

同一 Host 可同时是 Pet Owner 与 Event Owner；Pet Owner 与 Event Owner 不必是同一窗口（Pet Owner 退出后 Pet Client 仍可通信，Event Owner 通常保持到其窗口关闭）。

---

## 4. 协调文件格式

### 4.1 `kunpet-hosts.json`

```json
{
  "hosts": [
    {
      "pid": 12345,
      "eventPort": 19200,
      "registeredAt": 1710000000000,
      "lastSeen": 1710000005000
    }
  ]
}
```

- `pid`：Extension Host 进程 PID（`process.pid`）
- `eventPort`：该 Host 若拥有 event server 则填写端口，否则省略
- `lastSeen`：心跳更新时间；超过 **15s** 未更新视为 Host 已退出，协调器 prune 时移除

### 4.2 `kunpet-pet.json`

```json
{
  "ipcPort": 54321,
  "ownerPid": 12345,
  "startedAt": 1710000001000
}
```

- `ipcPort`：桌宠 HTTP IPC 端口（与现有 `ready` 消息中的 `ipcPort` 一致）
- `ownerPid`：spawn 该桌宠的 Extension Host PID
- 桌宠 health check：`GET http://127.0.0.1:{ipcPort}/health` 返回 200

### 4.3 文件锁

对 `kunpet-hosts.json` 的读写使用 **exclusive create + rename** 或 **proper-lockfile** 风格的原子更新，避免两窗口同时 activate 的竞态。首版可用 Node `fs.openSync(path, 'wx')` 短重试（最多 5 次，间隔 50ms）实现简易锁。

---

## 5. 组件变更

### 5.1 新增 `host-coordinator.ts`

| API | 行为 |
|-----|------|
| `registerHost()` | 写入 hosts 列表，返回 `{ isFirstHost, eventPortHint? }` |
| `unregisterHost()` | 移除自身；返回 `{ remainingHosts, shouldStopPet, isEventOwner }` |
| `heartbeat()` | 更新 `lastSeen`；prune 超时 Host |
| `resolvePetAction()` | 返回 `{ action: 'spawn' \| 'attach', ipcPort? }` |
| `publishPetInfo(ipcPort)` | Owner spawn 成功后写入 `kunpet-pet.json` |
| `clearPetInfo()` | 最后一个 Host 退出或强制清理时删除文件 |
| `resolveEventServerAction()` | 返回 `{ action: 'start' \| 'attach', port? }` |

常量：

- `HEARTBEAT_INTERVAL_MS = 5000`
- `HOST_STALE_MS = 15000`
- `PET_HEALTH_TIMEOUT_MS = 2000`

### 5.2 `PetProcess` 双模式

**Owner 模式（现有逻辑增强）：**

- spawn Electron 子进程
- 收到 `ready` 后调用 `publishPetInfo(ipcPort)`
- `stop()` 仅在 coordinator 返回 `shouldStopPet: true` 时 kill 子进程

**Client 模式（新增）：**

- 不 spawn；从 `kunpet-pet.json` 读取 `ipcPort`
- 对 ipcPort 做 health check；失败则降级为 Owner spawn
- `send()` / IPC 投递逻辑与 Owner 相同（已有 HTTP 实现）

### 5.3 `pet/main.js`

1. **单实例锁（双保险）：**

```javascript
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
  return;
}
```

第二个 Electron 进程立即退出，不创建托盘。

2. **Health 端点：**

在现有 HTTP IPC server 上增加 `GET /health` → `200 ok`。

3. **托盘回调改 HTTP：**

`emitToExtension()` 由 stdout 改为读取 `~/.cursor/kunpet-port.json`，向 `POST http://127.0.0.1:{port}/event` 发送：

```json
{ "type": "request-disable" }
{ "type": "request-walk-to-center", "value": true }
{ "type": "request-open-settings" }
```

连接失败时静默忽略（与 Hook 失败策略一致）。stdout 保留 `ready`、`moved` 等 Owner 侧仍需的消息。

### 5.4 `event-server.ts`

扩展 `/event` 处理，新增托盘来源事件类型（与现有 `AgentEvent` 并列）：

```typescript
type TrayEvent =
  | { type: "request-disable" }
  | { type: "request-walk-to-center"; value: boolean }
  | { type: "request-open-settings" };
```

回调注册方式与现有 `onAgentStop` 相同，由 `extension.ts` 传入 handler。

### 5.5 `extension.ts` 生命周期

**`activate`：**

1. `registerHost()` + 启动 heartbeat 定时器（`context.subscriptions`）
2. `resolveEventServerAction()` → start 或 attach
3. 若 enabled：`resolvePetAction()` → spawn 或 attach
4. 其余逻辑不变

**`deactivate`：**

1. 停止 heartbeat
2. `unregisterHost()` → 若 `shouldStopPet` 则 `pet.stop()` + `clearPetInfo()`；否则仅断开 Client 附着（**不** kill 桌宠子进程）
3. 若 `remainingHosts > 0`：**不**调用 `closeServer()`（但 Event Owner 窗口关闭后其进程内的 server 仍会随进程退出——见 §5.6）
4. 若 `remainingHosts === 0`：关闭 event server、stop 桌宠、清理 `kunpet-pet.json` 与 port 文件

**扩展禁用 / 卸载：**

- 强制 `unregisterHost()` 并 `shouldStopPet = true`，不受 ref-count 约束

### 5.6 Event Server 存活检测与接管

Event Server 运行在 Extension Host 进程内。Event Owner 窗口关闭时，即便 `deactivate` 不主动 `closeServer()`，该 server 也会随进程退出。

因此**每个存活 Host 的心跳**除更新 `lastSeen` 外，还需：

1. 读取 `kunpet-port.json` 中的 port
2. 对 `POST /event` 或 `GET /health` 做探活（超时 2s）
3. 若探活失败且本 Host 尚未拥有 server → 本 Host 成为新 Event Owner：启动 server、更新 port 文件、调用 `ensureKunPetHook` 刷新 Hook

这样窗口 A 关闭后，窗口 B 的心跳（≤5s）会自动接管 Event Server，Hook 与托盘回调恢复指向 B 的 port。

---

## 6. 行为矩阵

| 场景 | 桌宠 | 托盘 | Event Server |
|------|------|------|--------------|
| 开窗口 A | spawn（1 个） | 1 个 | A 启动 |
| 再开窗口 B | attach，不 spawn | 仍 1 个 | B attach 到 A 的 port |
| 关 A，B 仍开 | 继续 | 仍 1 个 | B 心跳探活失败后接管 Event Server（≤5s） |
| 关 B（最后一个） | stop | 消失 | 关闭 |
| 托盘「禁用桌宠」 | hide + 后续不 spawn | 仍在（禁用态） | 保持 |
| 桌宠进程崩溃 | 存活 Host health fail → 重新 spawn | 恢复 1 个 | 不变 |
| `kunpet.enabled = false` | stop（若最后一个 enabled Host） | 消失 | Hook 仍注册，日志 only |

---

## 7. 错误处理与边界

| 场景 | 行为 |
|------|------|
| 两窗口同时首次 activate（竞态） | 文件锁 + Electron 单实例锁；至多一个 spawn 成功 |
| `kunpet-pet.json` 存在但进程已死 | health check 失败 → 删除 stale 文件 → spawn |
| Pet Owner 窗口崩溃（无 deactivate） | 15s 后 prune；桌宠进程仍存活；其他 Host 以 Client attach |
| `kunpet-port.json` 指向已死 server | 下一 Host activate 时 health fail → 新 Host 成为 Event Owner 并更新 port 文件 |
| Hook POST 到旧 port | 静默失败；存活 Host 心跳探活后接管 server 并刷新 port 文件与 Hook |

---

## 8. 测试计划

### 8.1 单元测试（`extension/src/test/`）

- `host-coordinator.test.ts`：register/unregister ref-count、stale prune、resolvePetAction spawn vs attach
- `event-server.test.ts`：托盘事件类型解析与 dispatch
- `pet-process.test.ts`（可选）：Client 模式 health check 降级 spawn

### 8.2 手动验收

1. 开两个 Cursor 窗口 → 托盘仅 1 个 kunPet
2. 关非 spawn 者窗口 → 桌宠仍在，托盘菜单可用
3. 关 spawn 者窗口（另一窗口仍开）→ 桌宠仍在，托盘「禁用桌宠」生效
4. 关最后一个窗口 → 桌宠与托盘消失
5. 单窗口场景：行为与现版一致（位置恢复、庆祝、Hook）
6. F5 调试 + 正式安装 VSIX 各测一遍

---

## 9. 涉及文件

| 文件 | 变更 |
|------|------|
| `extension/src/host-coordinator.ts` | **新增** |
| `extension/src/pet-process.ts` | Owner / Client 双模式 |
| `extension/src/event-server.ts` | 托盘事件、health（若 event server 也需要） |
| `extension/src/extension.ts` | 接入 coordinator 生命周期 |
| `extension/src/types.ts` | 协调文件名常量、TrayEvent 类型 |
| `pet/main.js` | 单实例锁、/health、托盘 HTTP 回调 |
| `extension/src/test/host-coordinator.test.ts` | **新增** |

---

## 10. 后续迭代（不在本次）

- Event Owner 热迁移（Owner 窗口关闭时无缝 handoff server）
- macOS / Linux 文件锁与托盘行为验证
- 协调文件迁移到 named pipe / 更轻量 IPC
