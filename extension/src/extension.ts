import fs from "node:fs";
import path from "node:path";
import * as vscode from "vscode";
import { startEventServer } from "./event-server";
import { cleanupKunPetHook, ensureKunPetHook } from "./hook-manager";
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
let closeServer: (() => Promise<void>) | undefined;
let eventPort: number | undefined;
let hookSource: string | undefined;
let extensionContext: vscode.ExtensionContext | undefined;

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

async function startPetIfNeeded(): Promise<void> {
  if (!extensionContext || !pet) return;
  const saved = readSavedPosition(extensionContext.globalState);
  const petRoot = resolvePetRoot(extensionContext.extensionPath);
  const runtimeDir = path.join(extensionContext.globalStorageUri.fsPath, "electron-runtime");
  await pet.start({ petRoot, runtimeDir, x: saved?.x, y: saved?.y });
  log("pet process started");
}

async function applyEnabled(): Promise<void> {
  const { enabled, walkToCenter } = currentSettings();
  if (!enabled) {
    pet?.stop();
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

function log(message: string): void {
  channel?.appendLine(message);
}

export async function activate(context: vscode.ExtensionContext): Promise<void> {
  extensionContext = context;
  channel = vscode.window.createOutputChannel("kunPet");
  context.subscriptions.push(channel);
  log("activating kunPet");

  pet = new PetProcess({ log: (m) => channel?.appendLine(m) });
  pet.onMoved = (x, y) => {
    void context.globalState.update(POSITION_KEY, { x, y });
  };
  pet.onRequestDisable = () => {
    void (async () => {
      await updateSetting(CONFIG_ENABLED, false);
      await applyEnabled();
      log("disabled via tray");
    })();
  };
  pet.onRequestWalkToCenter = (value) => {
    void (async () => {
      await updateSetting(CONFIG_WALK_TO_CENTER, value);
      syncPrefsToPet();
      log(`walkToCenter ${value ? "enabled" : "disabled"} via tray`);
    })();
  };
  pet.onRequestOpenSettings = () => {
    void vscode.commands.executeCommand("kunpet.openSettings");
  };

  hookSource = path.join(context.extensionPath, "hooks", "kunpet-notify.js");

  try {
    const server = await startEventServer({
      onAgentStop: () => handleStop(),
      onAgentStart: () => handleAgentStart(),
    });
    eventPort = server.port;
    closeServer = server.close;
    log(`event server listening on 127.0.0.1:${server.port}`);
  } catch (err) {
    log(`failed to start event server: ${err instanceof Error ? err.message : String(err)}`);
  }

  if (eventPort !== undefined) {
    try {
      await ensureKunPetHook({
        extensionHookSource: hookSource,
        port: eventPort,
      });
      log("hook registered");
    } catch (err) {
      log(`failed to register hook: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

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
        pet?.stop();
        log("extension removed; cleaned hook, runtime cache, and stopped pet");
        return;
      }

      void cleanupKunPetHook();
      pet?.stop();
      log("extension disabled; cleaned hook and stopped pet (runtime cache kept)");
    })
  );

  log(
    "入口: Ctrl+Shift+P 搜「kunPet」→ 切换走到中间 / 启用禁用 / 打开设置；托盘可勾选「走到中间」"
  );
  void applyEnabled();
}

export async function deactivate(): Promise<void> {
  pet?.send({ type: "hide" });
  if (closeServer) {
    try {
      await closeServer();
    } catch {
      /* ignore */
    }
    closeServer = undefined;
  }
  pet?.stop();
  eventPort = undefined;
}
