import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export const RUNTIME_DIR_NAME = "electron-runtime";
export const EXTENSION_ID = "kunpet.kunpet";

const HOST_APPS = ["Cursor", "Code", "VSCodium"] as const;

export function getLikelyGlobalStorageDirs(): string[] {
  const home = os.homedir();
  const dirs: string[] = [];

  if (process.platform === "win32") {
    const appData =
      process.env.APPDATA || path.join(home, "AppData", "Roaming");
    for (const app of HOST_APPS) {
      dirs.push(path.join(appData, app, "User", "globalStorage", EXTENSION_ID));
    }
    return dirs;
  }

  if (process.platform === "darwin") {
    for (const app of HOST_APPS) {
      dirs.push(
        path.join(
          home,
          "Library",
          "Application Support",
          app,
          "User",
          "globalStorage",
          EXTENSION_ID
        )
      );
    }
    return dirs;
  }

  for (const app of HOST_APPS) {
    dirs.push(
      path.join(home, ".config", app, "User", "globalStorage", EXTENSION_ID)
    );
  }
  return dirs;
}

export function cleanupElectronRuntimeAt(globalStorageRoot: string): boolean {
  const runtimeDir = path.join(globalStorageRoot, RUNTIME_DIR_NAME);
  if (!fs.existsSync(runtimeDir)) {
    return false;
  }
  fs.rmSync(runtimeDir, { recursive: true, force: true });
  return true;
}

export function cleanupAllElectronRuntimeCaches(): number {
  let removed = 0;
  for (const dir of getLikelyGlobalStorageDirs()) {
    if (cleanupElectronRuntimeAt(dir)) {
      removed += 1;
    }
  }
  return removed;
}
