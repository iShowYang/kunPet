import fs from "node:fs";
import path from "node:path";
import * as vscode from "vscode";
import { startEventServer } from "./event-server";
import { cleanupKunPetHook, ensureKunPetHook } from "./hook-manager";
import { cleanupElectronRuntimeAt } from "./runtime-cleanup";
import { PetProcess } from "./pet-process";

const POSITION_KEY = "kunpet.position";

let channel: vscode.OutputChannel | undefined;
let pet: PetProcess | undefined;
let closeServer: (() => Promise<void>) | undefined;
let eventPort: number | undefined;
let hookSource: string | undefined;

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

function handleStop(): void {
  pet?.send({ type: "celebrate" });
}

function handleAgentStart(): void {
  pet?.send({ type: "return-idle" });
}

function log(message: string): void {
  channel?.appendLine(message);
}

export async function activate(context: vscode.ExtensionContext): Promise<void> {
  channel = vscode.window.createOutputChannel("kunPet");
  context.subscriptions.push(channel);
  log("activating kunPet");

  pet = new PetProcess({ log: (m) => channel?.appendLine(m) });
  pet.onMoved = (x, y) => {
    void context.globalState.update(POSITION_KEY, { x, y });
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
      pet?.send({ type: "show" });
    }),
    vscode.commands.registerCommand("kunpet.hide", () => {
      pet?.send({ type: "hide" });
    }),
    vscode.commands.registerCommand("kunpet.testCelebrate", () => {
      handleStop();
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

  const saved = readSavedPosition(context.globalState);
  const petRoot = resolvePetRoot(context.extensionPath);
  const runtimeDir = path.join(context.globalStorageUri.fsPath, "electron-runtime");
  void pet
    .start({ petRoot, runtimeDir, x: saved?.x, y: saved?.y })
    .then(() => log("pet process started"))
    .catch((err) => {
      log(`failed to start pet: ${err instanceof Error ? err.message : String(err)}`);
    });
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
