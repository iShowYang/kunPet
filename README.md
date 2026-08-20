# kunPet

Cursor/VS Code 桌宠扩展：平常抱篮球睡觉；对话进行中插兜 wink；Agent 本轮结束时走到主屏中央竖大拇指庆祝（可关走动）；走到中间时在 straight / arc / hop / dash 四种走法中随机一种，走回用同一种。

## 仓库结构

```
kunPet/
  extension/   # VS Code/Cursor 扩展（含 hooks/、编译产物 out/）
  pet/         # Electron 桌宠小窗（开发期与 extension/ 并列）
  scripts/     # 打包辅助脚本
  docs/        # 设计与实现计划
```

开发期扩展通过 `../pet` 找到桌宠；打 VSIX 时会把 `pet/` **源码**复制到 `extension/pet/`（**不含** `node_modules/electron`）。

## 开发

### 前置安装

```bash
cd extension && npm install && npm run compile
cd ../pet && npm install
```

桌宠依赖 `pet/node_modules/electron`；未安装时扩展仍可激活，但桌宠窗口无法启动（见 Output「kunPet」）。

若通知能弹出但屏幕上没有鲲：打开 Output 面板选「kunPet」。若见 `app.whenReady` / `ELECTRON_RUN_AS_NODE` 相关报错，说明桌宠进程被扩展宿主环境变量干扰——当前版本已在启动时清除该变量，请重新 F5。

### F5 调试

1. 在 Cursor 中打开本仓库**根目录**（`kunPet`，不要只打开 `extension/`）。
2. Run and Debug → 选择 **「Run kunPet Extension」** → 按 **F5**。
3. 在新开的 Extension Development Host 窗口中，扩展会自动激活；确认桌宠出现，并检查下方「Hook 与端口文件」。

若 Tasks 面板出现 `npm 任务检测: 无法分析 …/package.json`：这是 Cursor 自动扫描 npm 脚本时的误报（文件本身合法）。本仓库已在 `.vscode/settings.json` 关闭 `npm.autoDetect`，并用手动 `tasks.json` 编译；**Reload Window** 后一般不再弹出。

### 打包 VSIX

在 `extension/` 目录执行：

```bash
npm run package
```

- **VSIX 体积**：约 **2–5 MB**（仅扩展 + 桌宠脚本/图片，不含 Electron）
- **首次启动**：会自动下载 Electron 运行时（约 100 MB，一次性缓存到 Cursor 全局存储）
- 开发机 F5 仍使用 `pet/node_modules/electron`，无需重复下载

流程：`copy-pet-for-vsix.js` 复制 `pet/` 源码 → `vsce package` 生成 `kunpet-*.vsix`。

安装：Cursor 扩展面板 → **从 VSIX 安装…**

### 卸载

卸载扩展时会自动清理：

| 清理项 | 路径 |
|--------|------|
| Electron 运行时缓存 | `%APPDATA%\Cursor\User\globalStorage\kunpet.kunpet\electron-runtime`（Code / VSCodium 同理） |
| Hook 注册 | `%USERPROFILE%\.cursor\hooks.json` 中的 kunPet `stop` / `beforeSubmitPrompt` / `sessionStart` 条目 |
| 端口文件 | `%USERPROFILE%\.cursor\kunpet-port.json` |
| Hook 脚本 | `%USERPROFILE%\.cursor\hooks\kunpet-notify.js` |

**仅禁用**扩展时不会删除 Electron 缓存，下次启用可复用已下载的运行时。

### Hook 与端口文件（Windows）

扩展激活后，用户目录应出现：

| 路径 | 说明 |
|------|------|
| `%USERPROFILE%\.cursor\hooks.json` | 含指向 `kunpet-notify.js` 的三类 Hook |
| `%USERPROFILE%\.cursor\kunpet-port.json` | 本机事件服务端口（127.0.0.1 HTTP） |

Hook 脚本由扩展复制到 `%USERPROFILE%\.cursor\hooks\kunpet-notify.js`（或扩展内 `hooks/kunpet-notify.js` 的副本，以实际注册为准）。

| Hook 名 | 触发 | POST type |
|---------|------|-----------|
| `stop` | Agent 完成 | `agent_stop` |
| `beforeSubmitPrompt` | 发送 Agent 消息 | `agent_prompt` |
| `sessionStart` | 新 Session | `agent_session_start` |

## 设置与入口

**怎么找到开关：**

| 功能 | 命令面板 (`Ctrl+Shift+P` 搜 `kunPet`) | 托盘右键 | 设置页 |
|------|--------------------------------------|----------|--------|
| 启用/禁用桌宠 | 启用桌宠 / 禁用桌宠 | 禁用桌宠 | `kunpet.enabled` |
| 走到中间 | **切换走到中间**（一键开关） | 勾选「走到中间」 | `kunpet.walkToCenter` |
| 打开全部设置 | **打开设置** | 打开设置… | `Ctrl+,` 搜 `kunPet` |

禁用后托盘会消失；再启用请用命令面板或设置页。F5 后若看不到新命令，请 **Reload Window**。

| 设置 | 默认 | 说明 |
|------|------|------|
| `kunpet.enabled` | `true` | 启用桌宠；关闭后不启动进程，Agent 事件仅写 Output |
| `kunpet.walkToCenter` | `true` | 完成时走到主屏中央；关闭则原地庆祝 |

命令与设置双向同步。

## 验收清单

按顺序在本机 Cursor（扩展开发宿主或已安装 VSIX）上逐项确认：

1. **走动庆祝**：命令面板执行「kunPet: 测试完成提醒」→ 鲲宠以随机走法（直线/弧线/弹跳/冲刺）到主屏中央 → 竖大拇指 + 随机气泡；多次测试可看到不同走法
2. **点击走回**：点击鲲宠 → 对称走回原位置 → idle
3. **发消息复位**：celebrate 中向 Agent 发消息 → 自动走回 idle（无需点击）
4. **新 Session 复位**：celebrate 中新开对话 → 走回 idle；连续 Hook 无动画抖动
5. **真实 Agent**：完成一轮 Agent 对话 → 同走动庆祝；**无** Cursor 左下角文字通知
6. **常驻与位置**：重启 Cursor → 桌宠自动出现，idle 位置与上次一致（中央为临时庆祝点，不持久化）
7. **隐藏后完成**：手动隐藏 → Agent 完成 → 先 show 再 walk → 庆祝
8. **静默失败**：手动结束桌宠进程后，再触发 Hook 或测试命令 → Cursor 无报错、Agent 正常
9. **Hook 合并**：预置其他 Hook 条目 → 激活后 kunPet 三条均在且原有条目保留
10. **关闭走到中间**：设置关闭 → 测试完成提醒 → 原地庆祝；点击后原地回 idle
11. **禁用桌宠**：禁用命令 → 无窗口；Agent 完成 → Output「kunPet」出现 `[disabled] agent_stop...`；启用后桌宠恢复
12. **设置持久化**：改两项后重启 Cursor → 状态保持

详细设计见 [docs/superpowers/specs/2026-08-19-kunpet-walk-celebrate-design.md](docs/superpowers/specs/2026-08-19-kunpet-walk-celebrate-design.md)；设置开关见 [docs/superpowers/specs/2026-08-20-kunpet-settings-toggles-design.md](docs/superpowers/specs/2026-08-20-kunpet-settings-toggles-design.md)。
