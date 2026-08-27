import fs from "node:fs";
import { randomUUID } from "node:crypto";
import path from "node:path";
import * as vscode from "vscode";
import { startEventServer } from "./event-server";
import { cleanupKunPetHook, ensureKunPetHook } from "./hook-manager";
import { HEARTBEAT_INTERVAL_MS, HostCoordinator } from "./host-coordinator";
import { resolveSessionStartMessage } from "./ipc-resilience";
import { cleanupElectronRuntimeAt } from "./runtime-cleanup";
import { PetProcess } from "./pet-process";
import { readKunPetSettings } from "./settings";
import {
  CONFIG_ENABLED,
  CONFIG_SECTION,
  CONFIG_WALK_TO_CENTER,
} from "./types";

const POSITION_KEY = "kunpet.position";

let channel: vscode.OutputChannel | undefined;
let pet: PetProcess | undefined;
let coordinator: HostCoordinator | undefined;
let closeServer: (() => Promise<void>) | undefined;
let eventPort: number | undefined;
let ownsEventServer = false;
let hookSource: string | undefined;
let extensionContext: vscode.ExtensionContext | undefined;
let heartbeatTimer: ReturnType<typeof setInterval> | undefined;
/** True after agent_prompt until celebrate/stop or forced idle. */
let awaitingCelebrate = false;
let restartingPet = false;

export function resolvePetRoot(extensionPath: string): string {
  const bundled = path.join(extensionPath, "pet");
  const sibling = path.join(extensionPath, "..", "pet");
  // Prefer repo-root pet/ during F5 so live assets win over a stale extension/pet copy.
  if (fs.existsSync(path.join(sibling, "main.js"))) return sibling;
  if (fs.existsSync(path.join(bundled, "main.js"))) return bundled;
  return sibling;
}

function readSavedPosition(
  state: vscode.Memento
): { x: number; y: number } | undefined {
  const raw = state.get<{ x?: unknown; y?: unknown }>(POSITION_KEY);
  if (typeof raw?.x === "number" && typeof raw?.y === "number") {
    return { x: raw.x, y: raw.y };
  }
  return undefined;
}

function currentSettings() {
  return readKunPetSettings((section) => vscode.workspace.getConfiguration(section));
}

async function updateSetting(key: string, value: boolean): Promise<void> {
  await vscode.workspace
    .getConfiguration(CONFIG_SECTION)
    .update(key, value, vscode.ConfigurationTarget.Global);
}

async function ensureEventServer(): Promise<void> {
  if (!coordinator || !extensionContext || !hookSource) return;
  if (ownsEventServer && eventPort !== undefined) return;

  const action = await coordinator.resolveEventServerAction();
  if (action.action === "attach" && action.port !== undefined) {
    eventPort = action.port;
    ownsEventServer = false;
    log(`attached to existing event server on 127.0.0.1:${action.port}`);
    return;
  }

  try {
    const server = await startEventServer({
      onAgentStop: () => handleStop(),
      onAgentStart: (e) => handleAgentStart(e),
      onTrayEvent: (e) => handleTrayEvent(e),
    });
    eventPort = server.port;
    closeServer = server.close;
    ownsEventServer = true;
    coordinator.setEventPort(server.port);
    await coordinator.heartbeat();
    log(`event server listening on 127.0.0.1:${server.port}`);
    await ensureKunPetHook({
      extensionHookSource: hookSource,
      port: server.port,
    });
    log("hook registered");
  } catch (err) {
    log(`failed to start event server: ${err instanceof Error ? err.message : String(err)}`);
  }
}

async function maybeTakeOverEventServer(): Promise<void> {
  if (!coordinator || !hookSource) return;
  if (ownsEventServer) return;
  const action = await coordinator.resolveEventServerAction();
  if (action.action === "attach") {
    eventPort = action.port;
    return;
  }
  log("event server dead; taking over");
  await ensureEventServer();
}

function handleTrayEvent(
  e:
    | { type: "request-disable" }
    | { type: "request-walk-to-center"; value: boolean }
    | { type: "request-open-settings" }
): void {
  if (e.type === "request-disable") {
    void (async () => {
      await updateSetting(CONFIG_ENABLED, false);
      await applyEnabled();
      log("disabled via tray");
    })();
    return;
  }
  if (e.type === "request-walk-to-center") {
    void (async () => {
      await updateSetting(CONFIG_WALK_TO_CENTER, e.value);
      syncPrefsToPet();
      log(`walkToCenter ${e.value ? "enabled" : "disabled"} via tray`);
    })();
    return;
  }
  void vscode.commands.executeCommand("kunpet.openSettings");
}

async function startPetIfNeeded(): Promise<void> {
  if (!extensionContext || !pet || !coordinator) return;

  const action = await coordinator.resolvePetAction();
  if (action.action === "attach" && action.ipcPort !== undefined) {
    await pet.attach(action.ipcPort);
    log(`attached to existing pet on port ${action.ipcPort}`);
    return;
  }

  const saved = readSavedPosition(extensionContext.globalState);
  const petRoot = resolvePetRoot(extensionContext.extensionPath);
  const runtimeDir = path.join(extensionContext.globalStorageUri.fsPath, "electron-runtime");
  await pet.start({
    petRoot,
    runtimeDir,
    x: saved?.x,
    y: saved?.y,
    onReady: (ipcPort) => coordinator?.publishPetInfo(ipcPort),
  });
  log("pet process started");
}

async function restartPetAfterIpcFailure(): Promise<void> {
  if (restartingPet || !pet || !coordinator || !currentSettings().enabled) return;
  restartingPet = true;
  try {
    log("restarting pet process after IPC failures");
    const wasOwner = pet.isOwner();
    pet.stop({ killProcess: wasOwner });
    if (wasOwner) coordinator.clearPetInfo();
    await startPetIfNeeded();
    syncPrefsToPet();
  } catch (err) {
    log(
      `failed to restart pet: ${err instanceof Error ? err.message : String(err)}`
    );
  } finally {
    restartingPet = false;
  }
}

async function applyEnabled(): Promise<void> {
  const { enabled, walkToCenter } = currentSettings();
  if (!enabled) {
    if (pet?.isOwner()) {
      pet.stop({ killProcess: true });
      coordinator?.clearPetInfo();
    } else {
      pet?.stop({ killProcess: false });
    }
    awaitingCelebrate = false;
    log("pet disabled; process stopped");
    return;
  }
  try {
    await startPetIfNeeded();
    pet?.send({ type: "set-prefs", walkToCenter });
  } catch (err) {
    log(`failed to start pet: ${err instanceof Error ? err.message : String(err)}`);
  }
}

function syncPrefsToPet(): void {
  if (!currentSettings().enabled) return;
  const { walkToCenter } = currentSettings();
  pet?.send({ type: "set-prefs", walkToCenter });
}

function handleStop(): void {
  const { enabled, walkToCenter } = currentSettings();
  if (!enabled) {
    log("[disabled] agent_stop received, pet not running");
    return;
  }
  awaitingCelebrate = false;
  pet?.send({ type: "celebrate", walkToCenter });
}

function handleAgentStart(e: { type: string }): void {
  const { enabled } = currentSettings();
  if (!enabled) {
    log("[disabled] agent_start received, pet not running");
    return;
  }
  if (e.type === "agent_prompt") {
    awaitingCelebrate = true;
    pet?.send({ type: "working" });
    return;
  }
  const msg = resolveSessionStartMessage({ awaitingCelebrate });
  if (msg.force) {
    log("sessionStart force return-idle (celebrate was still awaiting)");
    awaitingCelebrate = false;
  }
  pet?.send(msg);
}

function log(message: string): void {
  channel?.appendLine(message);
}

function startHeartbeat(context: vscode.ExtensionContext): void {
  heartbeatTimer = setInterval(() => {
    void (async () => {
      if (!coordinator) return;
      await coordinator.heartbeat();
      await maybeTakeOverEventServer();
    })();
  }, HEARTBEAT_INTERVAL_MS);
  context.subscriptions.push({
    dispose: () => {
      if (heartbeatTimer !== undefined) {
        clearInterval(heartbeatTimer);
        heartbeatTimer = undefined;
      }
    },
  });
}

export async function activate(context: vscode.ExtensionContext): Promise<void> {
  extensionContext = context;
  channel = vscode.window.createOutputChannel("kunPet");
  context.subscriptions.push(channel);
  log("activating kunPet");

  coordinator = new HostCoordinator({ hostId: randomUUID() });
  await coordinator.registerHost();
  startHeartbeat(context);

  pet = new PetProcess({ log: (m) => channel?.appendLine(m) });
  pet.onIpcBroken = () => {
    void restartPetAfterIpcFailure();
  };
  pet.onMoved = (x, y) => {
    void context.globalState.update(POSITION_KEY, { x, y });
  };

  hookSource = path.join(context.extensionPath, "hooks", "kunpet-notify.js");
  await ensureEventServer();

  context.subscriptions.push(
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
      syncPrefsToPet();
      log("walkToCenter enabled");
    }),
    vscode.commands.registerCommand("kunpet.disableWalkToCenter", async () => {
      await updateSetting(CONFIG_WALK_TO_CENTER, false);
      syncPrefsToPet();
      log("walkToCenter disabled");
    }),
    vscode.commands.registerCommand("kunpet.toggleWalkToCenter", async () => {
      const next = !currentSettings().walkToCenter;
      await updateSetting(CONFIG_WALK_TO_CENTER, next);
      syncPrefsToPet();
      log(`walkToCenter ${next ? "enabled" : "disabled"}`);
      void vscode.window.setStatusBarMessage(
        next ? "kunPet: 已开启走到中间" : "kunPet: 已关闭走到中间（原地庆祝）",
        2500
      );
    }),
    vscode.commands.registerCommand("kunpet.openSettings", async () => {
      await vscode.commands.executeCommand("workbench.action.openSettings", "kunPet");
    }),
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (!e.affectsConfiguration(CONFIG_SECTION)) return;
      void applyEnabled();
      syncPrefsToPet();
    }),
    vscode.commands.registerCommand("kunpet.reregisterHook", async () => {
      if (eventPort === undefined || !hookSource) {
        log("cannot reregister hook: event server not ready");
        return;
      }
      try {
        await ensureKunPetHook({
          extensionHookSource: hookSource,
          port: eventPort,
        });
        log("hook re-registered");
      } catch (err) {
        log(`failed to reregister hook: ${err instanceof Error ? err.message : String(err)}`);
      }
    }),
    vscode.extensions.onDidChange(() => {
      const self = vscode.extensions.getExtension(context.extension.id);
      if (self?.isActive) return;

      if (!self) {
        cleanupElectronRuntimeAt(context.globalStorageUri.fsPath);
        void cleanupKunPetHook();
        pet?.stop({ killProcess: true });
        coordinator?.clearPetInfo();
        log("extension removed; cleaned hook, runtime cache, and stopped pet");
        return;
      }

      void cleanupKunPetHook();
      pet?.stop({ killProcess: true });
      coordinator?.clearPetInfo();
      log("extension disabled; cleaned hook and stopped pet (runtime cache kept)");
    })
  );

  log(
    "入口: Ctrl+Shift+P 搜「kunPet」→ 切换走到中间 / 启用禁用 / 打开设置；托盘可勾选「走到中间」"
  );
  void applyEnabled();
}

export async function deactivate(): Promise<void> {
  let shouldStopPet = true;
  let remainingHosts = 0;
  if (coordinator) {
    const result = await coordinator.unregisterHost();
    shouldStopPet = result.shouldStopPet;
    remainingHosts = result.remainingHosts;
  }

  if (shouldStopPet) {
    pet?.send({ type: "hide" });
    pet?.stop({ killProcess: pet?.isOwner() ?? true });
    coordinator?.clearPetInfo();
  } else {
    pet?.stop({ killProcess: false });
  }

  if (remainingHosts === 0 && ownsEventServer && closeServer) {
    try {
      await closeServer();
    } catch {
      /* ignore */
    }
    closeServer = undefined;
  }

  eventPort = undefined;
  ownsEventServer = false;
  coordinator = undefined;
}
