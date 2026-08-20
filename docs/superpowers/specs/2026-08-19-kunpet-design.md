# kunPet 设计规格

**日期：** 2026-08-19  
**状态：** 待用户审阅  
**产品：** Cursor 桌宠扩展——Agent 本轮对话结束时，鲲桌宠庆祝并系统通知

---

## 1. 目标与成功标准

### 目标

在 Cursor 中安装 **一个扩展** 后即可使用：扩展激活后，屏幕上常驻可拖动的鲲桌宠；每次 Agent 本轮回复结束（`stop`），桌宠播放完成动画，并弹出系统通知，提醒用户「这轮 AI 沟通已完成」。

### 成功标准

- 安装/启用扩展后，无需再安装其他独立 App，桌宠窗口自动出现并置顶。
- 真实 Agent 对话结束后，能稳定触发：庆祝动画 + 系统 Toast。
- 提供「测试完成提醒」命令，不依赖真实 Agent 即可验收。
- Hook 或桌宠异常时 **不影响** Cursor Agent 正常运行（失败静默）。
- 重启 Cursor 后桌宠自动出现，并恢复上次窗口位置。

### 非目标（首版不做）

- 养成、喂食、心情、闲逛等玩法
- 皮肤商店 / 多宠物
- 非 Windows 的优先适配（先保证 Windows）
- 单独发行、需用户另行安装的桌面客户端

---

## 2. 约束与决策摘要

| 决策点 | 结论 |
|--------|------|
| 提醒形态 | 桌宠庆祝动画 + 系统通知 |
| 桌宠位置 | 真正的桌面悬浮窗（透明、置顶、可拖动） |
| 完成时机 | Cursor Agent `stop`（本轮结束） |
| 形象 | 鲲 / 小鱼主题 |
| 首版范围 | 常驻鲲 + 完成提醒；无养成 |
| 分发形态 | **仅一个 Cursor/VS Code 扩展**；桌宠由扩展拉起，不另装 App |
| 生命周期 | 扩展激活后桌宠 **默认一直显示**（可手动隐藏） |

---

## 3. 架构

### 3.1 总览

kunPet 以 **单一扩展包（VSIX）** 交付，内部包含三部分协作：

```
┌─────────────────────────────────────────────────────────┐
│  Cursor / VS Code Extension Host                        │
│  ┌──────────────────┐    ┌───────────────────────────┐  │
│  │ extension.ts     │───▶│  spawn 桌宠子进程          │  │
│  │ · 生命周期       │    │  (打包进扩展的 Electron    │  │
│  │ · 命令 / 通知    │◀──▶│   小窗，非独立安装包)      │  │
│  │ · Hook 注册      │    └───────────────────────────┘  │
│  └────────┬─────────┘              ▲                    │
│           │ 确保 hooks 配置        │ 本地 IPC/HTTP      │
└───────────┼────────────────────────┼────────────────────┘
            ▼                        │
   ~/.cursor/hooks.json              │
   + kunpet-notify 脚本 ──stop───────┘
            ▲
            │ Agent 本轮结束
         Cursor Agent
```

**对用户的感知：** 只安装 `kunPet` 扩展。桌宠窗口是扩展自带的子进程，不是第二个要去官网下载的软件。

### 3.2 为何需要子进程窗口

VS Code/Cursor 扩展宿主无法直接创建「离开 IDE、始终置顶」的透明桌面窗。因此扩展在 `activate` 时 **spawn 随扩展分发的 Electron 小窗进程**（仅本机、由扩展管理）。这与「另装独立 App」的区别是：二进制随 VSIX 分发，生命周期由扩展控制。

### 3.3 为何需要 Cursor Hook

扩展 API 对「Agent 本轮结束」没有稳定、公开的等价事件。使用 Cursor 用户级 `stop` Hook 是可靠信号源。扩展在激活时写入/合并 `~/.cursor/hooks.json` 中的 kunPet 条目，用户无需手改配置。

---

## 4. 组件职责

### 4.1 扩展主体（`extension.ts` 等）

- `activate`：
  - 启动（或附着到已有）桌宠子进程；默认显示窗口
  - 确保 `stop` Hook 已注册且指向扩展管理的脚本
  - 在扩展宿主内启动本机事件服务：**仅** `127.0.0.1` 上的 HTTP（扩展为唯一监听方；Hook 只把事件打到扩展）
- 命令（建议）：
  - `kunpet.show` / `kunpet.hide`：显示/隐藏桌宠
  - `kunpet.testCelebrate`：测试完成动画 + 通知
  - `kunpet.reregisterHook`：重新注册 Hook
- 收到 `agent_stop`：经 IPC 通知桌宠子进程进入 celebrate；同时调用系统通知 API
- `deactivate`：隐藏窗口即可（避免频繁冷启动）；扩展禁用/卸载时结束子进程并尽量清理 Hook
- 持久化：窗口位置等写入 `globalState`

### 4.2 桌宠窗口（扩展内嵌 Electron 小窗）

- 约 128×128，透明背景，无边框，始终置顶，可拖动
- 状态机：`idle` ↔ `celebrate`（庆祝数秒后回到 `idle`）
- 首版视觉：鲲/鱼主题 SVG 或少量帧；idle 仅静态/轻微呼吸即可
- 系统托盘（推荐）：显示/隐藏桌宠；菜单保持精简
- 与扩展通信：子进程 IPC（stdin/stdout 行协议或 Electron `utilityProcess`/`MessagePort`）；**不**单独对外开端口
- 端口冲突时由扩展换端口，并把当前端口写入 Hook 可读的约定配置（例如 `~/.cursor/kunpet-port`）

### 4.3 Hook 脚本

- 由扩展安装到固定位置（例如 `~/.cursor/hooks/kunpet-notify.js`，便于 Cursor 在扩展路径变化时仍能调用）
- 唯一职责：读取当前端口配置，向扩展事件端点 `POST { "type": "agent_stop", "ts": <number> }`
- 扩展未运行或连接失败：**静默退出码 0**，不向 Cursor 抛错、不阻塞 Agent
- `hooks.json` 合并原则：只增补 kunPet 相关条目，不覆盖用户其他 Hook

---

## 5. 数据流

### 5.1 正常路径

1. 用户打开 Cursor → 扩展 `activate` → 桌宠窗口出现（恢复上次位置）
2. 用户与 Agent 对话；本轮结束触发 Cursor `stop`
3. Hook 脚本向 `127.0.0.1:<port>/event` 发送完成事件
4. 扩展接收 → 通知桌宠进入 `celebrate` → 同时弹出系统 Toast  
   - 建议文案：标题「鲲来报喜」，正文「这轮 AI 对话完成啦」
5. 动画结束后回到 `idle`，等待下一轮

### 5.2 测试路径

执行命令 `kunpet.testCelebrate`，跳过 Hook，直接走步骤 4–5。

---

## 6. 错误处理与边界

| 场景 | 行为 |
|------|------|
| Hook 失败 / 端口不通 | 静默忽略；不影响 Agent |
| 端口被占用 | 自动换端口，并更新 Hook/约定配置 |
| 多 Cursor 窗口 | 单一桌宠实例；短时间重复 `agent_stop` 去重（例如 2s 内只庆祝一次） |
| 扩展禁用/卸载 | 结束桌宠子进程；尽量从 `hooks.json` 移除 kunPet 条目（能清则清，失败不阻断） |
| 用户手动隐藏桌宠 | 仍可收通知；再次「显示」恢复窗口 |

---

## 7. 技术选型（首版）

| 项 | 选择 | 说明 |
|----|------|------|
| 扩展框架 | VS Code Extension API（Cursor 兼容） | 标准 `package.json` contribution |
| 桌宠窗 | 随扩展打包的 Electron 小窗 | 满足透明置顶；由扩展 spawn |
| 完成信号 | Cursor `stop` Hook | 用户级 hooks，扩展自动注册 |
| 本机通信 | `127.0.0.1` HTTP JSON（可后续换 named pipe） | 实现简单，便于 Hook 用 node/curl 调用 |
| 目标 OS | Windows 优先 | 按当前用户环境 |

---

## 8. 仓库结构（建议）

```
kunPet/
  docs/superpowers/specs/   # 本设计文档
  extension/                # VS Code/Cursor 扩展
    package.json
    src/extension.ts
    src/hook-manager.ts
    src/pet-process.ts
    hooks/kunpet-notify.js  # 随扩展分发的 hook 脚本模板
  pet/                      # 桌宠 Electron 小窗
    package.json
    main.js
    renderer/               # 鲲形象 + 动画
  README.md
```

具体目录可在实现计划中微调，但扩展与桌宠代码边界应保持清晰。

---

## 9. 验证计划

1. **命令自测**：`kunpet.testCelebrate` → 动画 + Toast
2. **真实 Agent**：完成一轮对话 → `stop` → 动画 + Toast
3. **常驻**：重启 Cursor → 桌宠自动出现、位置恢复
4. **静默失败**：退出桌宠进程后再触发 stop → Cursor 无报错
5. **Hook 合并**：预置其他 hooks 时安装扩展 → 原有条目仍在，kunPet 条目存在

---

## 10. 后续迭代（不在首版）

- idle 眨眼 / 走动 / 气泡文案
- macOS / Linux 适配
- 可配置通知文案、静音、勿扰时段
- 更轻量的窗体运行时（若 Electron 体积成为问题，再评估 Tauri 等）
