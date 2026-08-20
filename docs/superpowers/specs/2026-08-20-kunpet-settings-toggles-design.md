# kunPet 设置开关（启用桌宠 / 走到中间）设计规格

**日期：** 2026-08-20  
**状态：** 待用户审阅  
**基于：** [2026-08-19-kunpet-walk-celebrate-design.md](./2026-08-19-kunpet-walk-celebrate-design.md)  
**变更主题：** 「走到屏幕中间」可开关；桌宠可启用/禁用且持久化

---

## 1. 目标

在走动庆祝能力之上增加两个用户可控开关：

1. **走到中间** — 关闭时 Agent 完成仍庆祝，但**原地**庆祝（v2 行为），不 tween 到主屏中央
2. **启用/禁用桌宠** — 禁用后不启动桌宠进程；重新启用后恢复。禁用期间 Hook 仍触发，仅在 Output「kunPet」记日志

操作方式：**命令面板命令 + Cursor 设置页勾选**，二者双向同步，重启后仍有效。

---

## 2. 决策摘要

| 决策点 | 结论 |
|--------|------|
| walk 关闭时庆祝 | **原地**庆祝（不移动） |
| 禁用时 agent_stop / agent_start | Output 日志，不启动桌宠、不庆祝 |
| 开关入口 | 命令 + `contributes.configuration` 设置页 |
| 持久化 | VS Code Configuration（用户级） |
| 默认值 | `kunpet.enabled = true`，`kunpet.walkToCenter = true` |

---

## 3. 配置与命令

### 3.1 设置项

| 键名 | 类型 | 默认 | 说明 |
|------|------|------|------|
| `kunpet.enabled` | boolean | `true` | `false` 时不 spawn 桌宠 |
| `kunpet.walkToCenter` | boolean | `true` | `false` 时原地庆祝 |

### 3.2 命令

| 命令 ID | 标题 | 作用 |
|---------|------|------|
| `kunpet.enable` | kunPet: 启用桌宠 | 写 `enabled=true` 并启动桌宠 |
| `kunpet.disable` | kunPet: 禁用桌宠 | 写 `enabled=false` 并停止桌宠 |
| `kunpet.enableWalkToCenter` | kunPet: 开启走到中间 | 写 `walkToCenter=true` |
| `kunpet.disableWalkToCenter` | kunPet: 关闭走到中间 | 写 `walkToCenter=false` |

设置页修改后立即生效：`onDidChangeConfiguration` 同步启停桌宠；下次 `celebrate` 读取最新 `walkToCenter`。

---

## 4. 行为矩阵

### 4.1 `kunpet.enabled = false`

- activate 时：不 `pet.start()`；事件服务与 Hook **照常**注册
- 若已在运行：执行 `pet.stop()`，关窗杀进程
- `agent_stop` / `agent_start`：`log("[disabled] agent_stop received, pet not running")`（或对应 start 文案），不发 IPC
- `kunpet.show` / `hide` / `testCelebrate`：若禁用则日志提示、无操作（或 testCelebrate 仅日志）
- 重新启用：读保存位置，`pet.start()` → idle

### 4.2 `kunpet.walkToCenter = false`（且 enabled）

- `celebrate` → 原地：`showInactive` + 切 celebrate 图/气泡，**不** tween
- 点击 / `return-idle` → 原地回 idle（取消 celebrate 视觉，**不** walking-back）
- 隐藏后完成 → show 后原地庆祝

### 4.3 `kunpet.walkToCenter = true`

- 保持现有走动庆祝 + 对称走回逻辑

---

## 5. 架构与 IPC

```
Settings / Commands
    ↓ updateConfiguration
extension.ts 读 kunpet.enabled / kunpet.walkToCenter
    ↓
enabled=false → pet.stop(); hooks 仍收事件 → Output 日志
enabled=true  → pet.start(); celebrate 带 walk 标志
    ↓
POST /ipc { type: "celebrate", walkToCenter: boolean }
POST /ipc { type: "return-idle" }  // pet 侧按当前 celebrate 是否走过决定原地或走回
```

**IPC 变更：**

```typescript
{ type: "celebrate"; walkToCenter?: boolean }  // 缺省 true，兼容旧调用
```

`return-idle` 无需新字段：桌宠若本次庆祝未走动（`origin` 未设或同位置），`beginReturnIdle` 原地结束即可。

---

## 6. 边界情况

| 场景 | 行为 |
|------|------|
| 禁用中改 walk 设置 | 仅影响下次启用后的 celebrate |
| 走动中途关闭 walk | 本次进行中不变；下次 celebrate 生效 |
| 禁用时正在 celebrate | 杀进程；启用后从 idle 启动 |
| 位置持久化 | 仍只存 idle 位置；禁用不清除 |

---

## 7. 文件级改动范围

| 区域 | 改动 |
|------|------|
| `extension/package.json` | `contributes.configuration` + 4 命令 |
| `extension/src/types.ts` | `celebrate` 增加可选 `walkToCenter`；配置键常量 |
| `extension/src/extension.ts` | 读配置、启停、配置监听、命令、禁用日志 |
| `extension/src/settings.ts`（新建） | 纯函数：读布尔配置、默认值 |
| `extension/src/test/settings.test.ts` | 配置辅助单测 |
| `pet/main.js` | `beginCelebrate(walkToCenter)` 分支；原地 return-idle |
| `README.md` | 设置与命令说明、验收项 |

---

## 8. 验收标准

1. 设置页可勾选两项，重启 Cursor 后仍有效
2. 命令与设置页状态一致
3. 关闭走到中间 → 原地庆祝 + 原地回 idle
4. 禁用桌宠 → 无窗口；Agent 完成 → Output 有日志、无庆祝
5. 启用桌宠 → 窗口恢复；走动开关仍生效
6. 打开走到中间 → 恢复走动庆祝行为

---

## 9. 非目标

- 托盘菜单开关
- 禁用时临时弹出庆祝
- 按工作区分别配置（用户级即可）
- 改动 Hook 注册策略（禁用时仍保留 Hook）

---

## 10. 推荐实现策略

**方案：VS Code Configuration + 命令（方案 1）**

用 `contributes.configuration` 持久化；命令写配置并触发同一套 apply 逻辑；桌宠经 IPC 接收 `walkToCenter` 标志。不引入独立设置 UI。
