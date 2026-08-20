# kunPet v2 设计规格

**日期：** 2026-08-19  
**状态：** 待用户审阅  
**基于：** [2026-08-19-kunpet-design.md](./2026-08-19-kunpet-design.md)（首版）  
**变更主题：** 纯 Cursor 插件体验、生命周期绑定、庆祝交互改版

---

## 1. 目标

用户安装 **一个 Cursor 扩展** 后：

- **打开 Cursor** → 桌面悬浮鲲宠立刻出现（idle）
- **Agent 本轮结束（`stop`）** → 鲲宠庆祝（运球姿势 + 动画 + 文字气泡）
- **点击鲲宠** → 结束庆祝，回到 idle
- **关闭 Cursor** → 桌宠进程结束，无后台残留

提醒要**明显**，但**不使用** Cursor 左下角 `showInformationMessage` / 系统 Toast；文字提示画在桌宠上方的气泡里。

---

## 2. 决策摘要

| 决策点 | v2 结论 |
|--------|---------|
| 分发形态 | 仅 Cursor/VS Code 扩展（VSIX），不另装 App |
| 桌宠位置 | 桌面悬浮窗（透明、置顶、可拖动） |
| 生命周期 | **严格绑定 Cursor**：启动即有，退出即停 |
| 出现时机 | Cursor 启动后立刻显示 idle |
| 完成信号 | Cursor Agent `stop` |
| 提醒形态 | 庆祝动画 + **桌宠内文字气泡**（非 IDE 通知） |
| 庆祝时长 | **不自动结束**；点击鲲宠才回 idle |
| 隐藏时完成 | 若已隐藏，庆祝时 **自动弹出** |
| 庆祝文案 | **随机轮换**：「完成了！」「搞定啦！」「这轮结束～」 |
| 形象资源 | `kun-idle.png` 插兜待机；`kun-rest.png` 趴篮球休息（偶尔）；`kun-celebrate.png` 竖大拇指庆祝 |
| 通信方式 | 扩展 ↔ 桌宠：本机 HTTP（127.0.0.1，已验证 Windows 可用） |
| 完成信号来源 | Cursor 用户级 `stop` Hook（扩展自动注册） |

---

## 3. 架构

### 3.1 组件

```
Cursor 启动
    ↓
扩展 activate
    ├─ 启动事件服务（127.0.0.1 HTTP，接收 agent_stop）
    ├─ 注册/更新 stop Hook → kunpet-notify.js
    └─ spawn Electron 桌宠（idle）

Agent stop
    ↓
Hook POST agent_stop → 扩展事件服务
    ↓
扩展 POST celebrate → 桌宠 HTTP /ipc
    ↓
桌宠：show（若隐藏）→ 运球图 + 动画 + 随机文案气泡

用户点击鲲宠
    ↓
桌宠：idle（竖大拇指，气泡消失）

Cursor 退出
    ↓
扩展 deactivate → 结束桌宠进程 + 关闭事件服务
```

### 3.2 与首版的差异

| 项 | 首版 | v2 |
|----|------|-----|
| 文字通知 | IDE 消息「鲲来报喜：…」 | **移除** |
| 庆祝结束 | ~2.8s 自动回 idle | **点击鲲宠**才回 idle |
| 庆祝文案 | 无（或 IDE 通知） | **桌宠上方气泡**，随机三句 |
| 隐藏时庆祝 | 会 show | **保持**：自动弹出 |
| 生命周期表述 | 扩展激活后常驻 | **强调**仅 Cursor 运行期间存在 |

### 3.3 仍保留 Electron 子进程的原因

VS Code/Cursor 扩展 API 无法创建「离开 IDE、始终置顶」的透明桌面窗。桌宠仍由扩展 spawn 内置 Electron 小窗；对用户感知仍是「只装了插件」，不是第二个独立 App。

---

## 4. 庆祝交互（详细）

### 4.1 触发

- Cursor `stop` Hook → `POST { type: "agent_stop" }` → 扩展 `handleStop()`
- 测试命令 `kunpet.testCelebrate` 走同一路径（便于验收）

### 4.2 桌宠侧行为

1. 若窗口隐藏 → `showInactive()`
2. 切换图片为 `kun-celebrate.png`（竖大拇指），加 `celebrate` CSS 动画类
3. 显示文字气泡，文案从池中**随机选一条**：
   - 「完成了！」
   - 「搞定啦！」
   - 「这轮结束～」
4. **不设自动超时**；一直保持 celebrate 状态
5. 用户**点击鲲宠区域** → 移除 celebrate 状态与气泡 → 回 `kun-idle.png`（idle）

### 4.3 点击与拖动

- idle：整窗可拖动（`-webkit-app-region: drag`）
- celebrate：需可点击结束庆祝
  - 方案：庆祝时气泡+鲲体区域 `-webkit-app-region: no-drag` 并绑定 click；或整窗 celebrate 态改为 click 结束、拖动仅在 idle 启用
  - 首版优先：**点击鲲宠任意可见区域**即结束庆祝

### 4.4 重复 stop

- 已在 celebrate 态时再次 `stop`：可重新随机文案并 replay 动画（可选，首版允许简单重置 celebrate 计时/动画即可）
- 事件去重：扩展侧保留短时间 dedupe（如 2s），避免连触发刷爆

---

## 5. 生命周期

| 事件 | 行为 |
|------|------|
| Cursor 启动 / 扩展 activate | 启动桌宠（idle），恢复上次位置 |
| Cursor 运行中 | 桌宠常驻；可 `kunpet.hide` / 托盘隐藏 |
| Cursor 退出 / 扩展 deactivate | 杀桌宠进程，关事件服务 |
| 扩展禁用/卸载 | 结束桌宠；尽量从 `hooks.json` 移除 kunPet 条目 |

**不做：** 开机自启、Cursor 关闭后仍运行的守护进程。

---

## 6. 移除项

- `notify.ts` 及对 `showInformationMessage` 的调用
- 庆祝自动回 idle 的 `setTimeout`（如 2800ms）
- 验收项中「左下角 Toast / 鲲来报喜 IDE 消息」

**保留：**

- Hook 机制、端口文件、`kunpet-notify.js`
- HTTP 桌宠 IPC（`ready` + `ipcPort`）
- 三张 PNG 与 idle 偶尔切 rest 的待机逻辑（celebrate 期间暂停 idle 轮换）

---

## 7. 文件级改动范围（实现参考）

| 区域 | 改动 |
|------|------|
| `extension/src/extension.ts` | `handleStop` 仅发 celebrate，去掉 notify |
| `extension/src/notify.ts` | 删除或空置不再使用 |
| `pet/renderer/index.html` | 增加庆祝气泡 DOM |
| `pet/renderer/style.css` | 气泡样式；celebrate 态 click/drag 分区 |
| `pet/renderer/pet.js` | 随机文案、点击结束庆祝、去掉自动 timeout |
| `pet/main.js` | 可选：IPC `dismiss-celebrate` 或由 renderer 本地处理点击 |
| `README.md` | 更新 v2 交互与验收说明 |

---

## 8. 验收标准

1. 打开 Cursor → 鲲宠立刻 idle 出现
2. 完成一轮 Agent → 运球庆祝 + 气泡随机文案，**不自动结束**
3. 点击鲲宠 → 回 idle，气泡消失
4. 手动隐藏后完成 Agent → 鲲宠自动弹出并庆祝
5. 关闭 Cursor → 无 kunPet 相关 `electron.exe` 残留
6. **不出现** Cursor 左下角「鲲来报喜」类 IDE 通知
7. 连续多次完成：文案可在三句间随机变化

---

## 9. 非目标（v2 仍不做）

- 养成、喂食、多宠物
- 可配置文案 UI（首版写死三句池）
- macOS/Linux 优先适配
- 单实例多窗口合并（可后续迭代）

---

## 10. 推荐实现策略

**方案：首版架构演进（方案 1）**

在现有 extension + Electron pet + Hook + HTTP IPC 上改交互，不重构技术栈。风险低、与当前代码库一致。

后续可选：单实例锁、崩溃自动重启（方案 2）。
