import { spawn } from "node:child_process";
import fs from "node:fs";
import fsp from "node:fs/promises";
import http from "node:http";
import https from "node:https";
import path from "node:path";

const LOCALE_KEEP = new Set(["en-US.pak", "zh-CN.pak"]);

export function readElectronVersion(petRoot: string): string {
  const lockPath = path.join(petRoot, "package-lock.json");
  if (fs.existsSync(lockPath)) {
    const lock = JSON.parse(fs.readFileSync(lockPath, "utf8")) as {
      packages?: Record<string, { version?: string }>;
    };
    const fromLock = lock.packages?.["node_modules/electron"]?.version;
    if (fromLock) return fromLock;
  }

  const pkgPath = path.join(petRoot, "package.json");
  const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf8")) as {
    devDependencies?: { electron?: string };
  };
  const raw = pkg.devDependencies?.electron;
  if (!raw) {
    throw new Error("electron version not found in pet/package.json");
  }
  const exact = raw.match(/\d+\.\d+\.\d+/);
  return exact ? exact[0] : raw.replace(/^[\^~]/, "");
}

export function bundledElectronExe(petRoot: string): string {
  return path.join(petRoot, "node_modules", "electron", "dist", "electron.exe");
}

export function runtimeElectronExe(runtimeDir: string): string {
  return path.join(runtimeDir, "electron.exe");
}

function electronZipName(version: string): string {
  return `electron-v${version}-win32-x64.zip`;
}

function downloadUrls(version: string): string[] {
  const zip = electronZipName(version);
  const mirror = process.env.ELECTRON_MIRROR?.replace(/\/$/, "");
  const urls = [
    `https://github.com/electron/electron/releases/download/v${version}/${zip}`,
  ];
  if (mirror) {
    urls.unshift(`${mirror}/${version}/${zip}`);
  } else {
    urls.push(
      `https://cdn.npmmirror.com/binaries/electron/${version}/${zip}`
    );
  }
  return urls;
}

function downloadFile(url: string, dest: string, log?: (m: string) => void): Promise<void> {
  return new Promise((resolve, reject) => {
    const lib = url.startsWith("https:") ? https : http;
    const request = lib.get(url, (res) => {
      if (
        res.statusCode &&
        res.statusCode >= 300 &&
        res.statusCode < 400 &&
        res.headers.location
      ) {
        res.resume();
        downloadFile(res.headers.location, dest, log)
          .then(resolve)
          .catch(reject);
        return;
      }
      if (res.statusCode !== 200) {
        res.resume();
        reject(new Error(`HTTP ${res.statusCode} for ${url}`));
        return;
      }

      const total = Number(res.headers["content-length"] ?? 0);
      let received = 0;
      let lastPct = -1;
      const file = fs.createWriteStream(dest);
      res.on("data", (chunk: Buffer) => {
        received += chunk.length;
        if (total > 0) {
          const pct = Math.floor((received / total) * 100);
          if (pct >= lastPct + 10) {
            lastPct = pct;
            log?.(`downloading Electron runtime: ${pct}%`);
          }
        }
      });
      res.pipe(file);
      file.on("finish", () => file.close(() => resolve()));
      file.on("error", reject);
    });
    request.on("error", reject);
  });
}

async function extractZipWindows(zipPath: string, destDir: string): Promise<void> {
  await fsp.mkdir(destDir, { recursive: true });
  await new Promise<void>((resolve, reject) => {
    const ps = spawn(
      "powershell",
      [
        "-NoProfile",
        "-Command",
        `Expand-Archive -LiteralPath '${zipPath.replace(/'/g, "''")}' -DestinationPath '${destDir.replace(/'/g, "''")}' -Force`,
      ],
      { windowsHide: true }
    );
    ps.on("error", reject);
    ps.on("exit", (code) =>
      code === 0 ? resolve() : reject(new Error(`Expand-Archive exit ${code}`))
    );
  });
}

async function trimRuntimeDir(runtimeDir: string): Promise<void> {
  const licenseHtml = path.join(runtimeDir, "LICENSES.chromium.html");
  if (fs.existsSync(licenseHtml)) {
    await fsp.unlink(licenseHtml);
  }
  const localesDir = path.join(runtimeDir, "locales");
  if (!fs.existsSync(localesDir)) return;
  for (const file of fs.readdirSync(localesDir)) {
    if (!LOCALE_KEEP.has(file)) {
      await fsp.unlink(path.join(localesDir, file));
    }
  }
}

async function moveExtractedRuntime(tmpDir: string, runtimeDir: string): Promise<void> {
  const entries = fs.readdirSync(tmpDir, { withFileTypes: true });
  const inner = entries.find(
    (e) => e.isDirectory() && e.name.startsWith("electron-v")
  );
  const fromDir = inner ? path.join(tmpDir, inner.name) : tmpDir;
  await fsp.mkdir(runtimeDir, { recursive: true });
  for (const entry of fs.readdirSync(fromDir, { withFileTypes: true })) {
    const from = path.join(fromDir, entry.name);
    const to = path.join(runtimeDir, entry.name);
    await fsp.rename(from, to);
  }
}

async function downloadRuntime(
  version: string,
  runtimeDir: string,
  log?: (m: string) => void
): Promise<void> {
  const zipPath = path.join(runtimeDir, "_download.zip");
  const tmpDir = path.join(runtimeDir, "_tmp");
  await fsp.mkdir(runtimeDir, { recursive: true });

  let lastErr: Error | undefined;
  for (const url of downloadUrls(version)) {
    try {
      log?.(`fetching Electron ${version} from ${url}`);
      await downloadFile(url, zipPath, log);
      lastErr = undefined;
      break;
    } catch (err) {
      lastErr = err instanceof Error ? err : new Error(String(err));
      log?.(`download failed: ${lastErr.message}`);
      if (fs.existsSync(zipPath)) await fsp.unlink(zipPath);
    }
  }
  if (lastErr) throw lastErr;

  try {
    await extractZipWindows(zipPath, tmpDir);
    await moveExtractedRuntime(tmpDir, runtimeDir);
    await trimRuntimeDir(runtimeDir);
  } finally {
    if (fs.existsSync(zipPath)) await fsp.unlink(zipPath).catch(() => undefined);
    if (fs.existsSync(tmpDir)) await fsp.rm(tmpDir, { recursive: true, force: true });
  }
}

export async function ensureElectronRuntime(opts: {
  petRoot: string;
  runtimeDir: string;
  log?: (m: string) => void;
}): Promise<string> {
  const bundled = bundledElectronExe(opts.petRoot);
  if (fs.existsSync(bundled)) {
    return bundled;
  }

  const runtimeExe = runtimeElectronExe(opts.runtimeDir);
  if (fs.existsSync(runtimeExe)) {
    return runtimeExe;
  }

  const version = readElectronVersion(opts.petRoot);
  opts.log?.(
    `Electron runtime not bundled; downloading v${version} once (~100MB) to ${opts.runtimeDir}`
  );
  await downloadRuntime(version, opts.runtimeDir, opts.log);

  if (!fs.existsSync(runtimeExe)) {
    throw new Error(`Electron runtime missing after download: ${runtimeExe}`);
  }
  opts.log?.("Electron runtime ready");
  return runtimeExe;
}
