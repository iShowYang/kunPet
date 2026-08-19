import fs from "node:fs";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { HOOK_SCRIPT_NAME, PORT_FILE_NAME, type PortFileContents } from "./types";

type HooksFile = {
  version?: number;
  hooks?: Record<string, Array<{ command?: string; [k: string]: unknown }>>;
};

export function getCursorHome(): string {
  return path.join(os.homedir(), ".cursor");
}

export function toHookPath(absPath: string): string {
  return absPath.replace(/\\/g, "/");
}

export function writePortFile(cursorHome: string, port: number): void {
  const file = path.join(cursorHome, PORT_FILE_NAME);
  const body: PortFileContents = { port, updatedAt: Date.now() };
  fs.mkdirSync(cursorHome, { recursive: true });
  fs.writeFileSync(file, JSON.stringify(body), "utf8");
}

export function readPortFile(cursorHome: string): PortFileContents | null {
  const file = path.join(cursorHome, PORT_FILE_NAME);
  if (!fs.existsSync(file)) return null;
  try {
    return JSON.parse(fs.readFileSync(file, "utf8")) as PortFileContents;
  } catch {
    return null;
  }
}

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

export function mergeStopHook(hooksJson: unknown, command: string): HooksFile {
  return mergeKunPetHook(hooksJson, "stop", command);
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

export function removeStopHook(hooksJson: unknown, marker: string): HooksFile {
  return removeKunPetHooks(hooksJson, marker);
}

export async function installHookScript(
  cursorHome: string,
  scriptSourcePath: string
): Promise<string> {
  const hooksDir = path.join(cursorHome, "hooks");
  await fsp.mkdir(hooksDir, { recursive: true });
  const dest = path.join(hooksDir, HOOK_SCRIPT_NAME);
  await fsp.copyFile(scriptSourcePath, dest);
  return toHookPath(dest);
}

export async function ensureKunPetHook(opts: {
  extensionHookSource: string;
  port: number;
}): Promise<void> {
  const cursorHome = getCursorHome();
  writePortFile(cursorHome, opts.port);
  const dest = await installHookScript(cursorHome, opts.extensionHookSource);
  const stopCmd = `node "${dest}" --event=stop`;
  const promptCmd = `node "${dest}" --event=prompt`;
  const sessionCmd = `node "${dest}" --event=session`;
  const hooksPath = path.join(cursorHome, "hooks.json");
  let current: unknown = { version: 1, hooks: {} };
  if (fs.existsSync(hooksPath)) {
    current = JSON.parse(await fsp.readFile(hooksPath, "utf8"));
  }
  let merged = mergeKunPetHook(current, "stop", stopCmd);
  merged = mergeKunPetHook(merged, "beforeSubmitPrompt", promptCmd);
  merged = mergeKunPetHook(merged, "sessionStart", sessionCmd);
  await fsp.writeFile(hooksPath, JSON.stringify(merged, null, 2), "utf8");
}

export async function cleanupKunPetHook(): Promise<void> {
  try {
    const cursorHome = getCursorHome();
    const hooksPath = path.join(cursorHome, "hooks.json");
    if (fs.existsSync(hooksPath)) {
      const current = JSON.parse(await fsp.readFile(hooksPath, "utf8"));
      const next = removeKunPetHooks(current, HOOK_SCRIPT_NAME);
      await fsp.writeFile(hooksPath, JSON.stringify(next, null, 2), "utf8");
    }

    const portFile = path.join(cursorHome, PORT_FILE_NAME);
    if (fs.existsSync(portFile)) {
      await fsp.unlink(portFile);
    }

    const hookScript = path.join(cursorHome, "hooks", HOOK_SCRIPT_NAME);
    if (fs.existsSync(hookScript)) {
      await fsp.unlink(hookScript);
    }
  } catch {
    /* ignore: disable/uninstall must not throw */
  }
}
