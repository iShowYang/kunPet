import { spawn, type ChildProcess } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import readline from "node:readline";
import type { PetIpcMessage } from "./types";
import { ensureElectronRuntime } from "./electron-runtime";

export function serializeIpc(msg: PetIpcMessage): string {
  return JSON.stringify(msg) + "\n";
}

export function resolveElectronBinary(petRoot: string): string {
  const exe = path.join(petRoot, "node_modules", "electron", "dist", "electron.exe");
  if (!fs.existsSync(exe)) {
    throw new Error(
      `Electron binary not found at ${exe}. Run npm install inside the pet app directory.`
    );
  }
  return exe;
}

export class PetProcess {
  onMoved?: (x: number, y: number) => void;
  onRequestDisable?: () => void;
  onRequestWalkToCenter?: (value: boolean) => void;

  private child?: ChildProcess;
  private startPromise?: Promise<void>;
  private stopping = false;
  private ipcPort?: number;
  private pendingMessages: PetIpcMessage[] = [];
  private readonly log?: (line: string) => void;

  constructor(opts?: { log?: (line: string) => void }) {
    this.log = opts?.log;
  }

  async start(opts: {
    petRoot: string;
    runtimeDir: string;
    x?: number;
    y?: number;
  }): Promise<void> {
    if (this.child) return;
    if (this.startPromise) return this.startPromise;

    this.startPromise = this.startInternal(opts).finally(() => {
      this.startPromise = undefined;
    });
    return this.startPromise;
  }

  private async startInternal(opts: {
    petRoot: string;
    runtimeDir: string;
    x?: number;
    y?: number;
  }): Promise<void> {
    const electron = await ensureElectronRuntime({
      petRoot: opts.petRoot,
      runtimeDir: opts.runtimeDir,
      log: this.log,
    });
    const args = ["."];
    if (opts.x !== undefined) args.push(`--x=${opts.x}`);
    if (opts.y !== undefined) args.push(`--y=${opts.y}`);

    this.stopping = false;
    this.ipcPort = undefined;
    this.pendingMessages = [];

    // Extension Host sets ELECTRON_RUN_AS_NODE; if inherited, electron.exe
    // runs as Node and crashes (app.whenReady is undefined) — no pet window.
    const env = { ...process.env };
    delete env.ELECTRON_RUN_AS_NODE;

    const child = spawn(electron, args, {
      cwd: opts.petRoot,
      env,
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    });
    this.child = child;

    const readyTimeoutMs = 15_000;
    return new Promise<void>((resolve) => {
      let settled = false;
      const settle = () => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve();
      };
      const timer = setTimeout(() => {
        this.log?.(`pet process start timed out waiting for ready (${readyTimeoutMs}ms)`);
        settle();
      }, readyTimeoutMs);

      if (child.stdout) {
        const rl = readline.createInterface({ input: child.stdout });
        rl.on("line", (line) => this.handleStdoutLine(line, settle));
      }

      if (child.stderr) {
        const errRl = readline.createInterface({ input: child.stderr });
        errRl.on("line", (line) => this.log?.(line));
      }

      child.on("error", (err) => {
        this.log?.(`pet process error: ${err.message}`);
        if (this.child === child) this.child = undefined;
        settle();
      });

      child.on("exit", (code, signal) => {
        this.ipcPort = undefined;
        if (!this.stopping && (code ?? 0) !== 0) {
          this.log?.(
            `pet process exited abnormally (code ${code}, signal ${signal ?? "none"})`
          );
        }
        if (this.child === child) this.child = undefined;
        settle();
      });
    });
  }

  send(msg: PetIpcMessage): void {
    if (!this.ipcPort) {
      this.pendingMessages.push(msg);
      return;
    }
    this.postIpc(msg);
  }

  stop(): void {
    if (!this.child) return;
    this.stopping = true;
    this.ipcPort = undefined;
    this.pendingMessages = [];
    const child = this.child;
    this.child = undefined;
    child.kill();
  }

  private flushPendingMessages(): void {
    const queued = this.pendingMessages.splice(0);
    for (const msg of queued) {
      this.postIpc(msg);
    }
  }

  private postIpc(msg: PetIpcMessage): void {
    if (!this.ipcPort) return;
    const body = JSON.stringify(msg);
    const req = http.request(
      {
        host: "127.0.0.1",
        port: this.ipcPort,
        path: "/ipc",
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Content-Length": Buffer.byteLength(body),
        },
        timeout: 1000,
      },
      (res) => {
        res.resume();
      }
    );
    req.on("error", (err) => {
      this.log?.(`pet IPC failed: ${err.message}`);
    });
    req.on("timeout", () => {
      req.destroy();
      this.log?.("pet IPC timed out");
    });
    req.write(body);
    req.end();
  }

  private handleStdoutLine(line: string, onReady: () => void): void {
    let msg: unknown;
    try {
      msg = JSON.parse(line);
    } catch {
      return;
    }
    if (!msg || typeof msg !== "object") return;
    const rec = msg as {
      type?: unknown;
      x?: unknown;
      y?: unknown;
      ipcPort?: unknown;
      value?: unknown;
    };
    if (rec.type === "ready") {
      if (typeof rec.ipcPort === "number") {
        this.ipcPort = rec.ipcPort;
        this.flushPendingMessages();
      }
      onReady();
      return;
    }
    if (rec.type === "moved" && typeof rec.x === "number" && typeof rec.y === "number") {
      this.onMoved?.(rec.x, rec.y);
      return;
    }
    if (rec.type === "request-disable") {
      this.onRequestDisable?.();
      return;
    }
    if (rec.type === "request-walk-to-center" && typeof rec.value === "boolean") {
      this.onRequestWalkToCenter?.(rec.value);
    }
  }
}
