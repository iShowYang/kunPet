import { spawn, type ChildProcess } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import readline from "node:readline";
import type { PetIpcMessage } from "./types";
import { ensureElectronRuntime } from "./electron-runtime";
import {
  formatIpcErrorLog,
  IPC_FAILURES_BEFORE_RESTART,
  IPC_MAX_ATTEMPTS,
  IPC_TIMEOUT_MS,
  nextIpcFailureCount,
  shouldRestartPet,
} from "./ipc-resilience";

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

export type PetStartOpts = {
  petRoot: string;
  runtimeDir: string;
  x?: number;
  y?: number;
};

export class PetProcess {
  onMoved?: (x: number, y: number) => void;
  onRequestDisable?: () => void;
  onRequestWalkToCenter?: (value: boolean) => void;
  onRequestOpenSettings?: () => void;
  /** Fired when IPC keeps failing; extension should stop+start the pet. */
  onIpcBroken?: () => void;

  private child?: ChildProcess;
  private startPromise?: Promise<void>;
  private stopping = false;
  private ipcPort?: number;
  private pendingMessages: PetIpcMessage[] = [];
  private readonly log?: (line: string) => void;
  private consecutiveIpcFailures = 0;
  private restartRequested = false;

  constructor(opts?: { log?: (line: string) => void }) {
    this.log = opts?.log;
  }

  async start(opts: PetStartOpts): Promise<void> {
    if (this.child) return;
    if (this.startPromise) return this.startPromise;

    this.restartRequested = false;
    this.consecutiveIpcFailures = 0;

    this.startPromise = this.startInternal(opts).finally(() => {
      this.startPromise = undefined;
    });
    return this.startPromise;
  }

  private async startInternal(opts: PetStartOpts): Promise<void> {
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
    void this.deliver(msg);
  }

  stop(): void {
    if (!this.child) {
      this.ipcPort = undefined;
      this.pendingMessages = [];
      return;
    }
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
      void this.deliver(msg);
    }
  }

  private postIpcOnce(msg: PetIpcMessage, port: number): Promise<void> {
    const body = JSON.stringify(msg);
    return new Promise((resolve, reject) => {
      const req = http.request(
        {
          host: "127.0.0.1",
          port,
          path: "/ipc",
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Content-Length": Buffer.byteLength(body),
          },
          timeout: IPC_TIMEOUT_MS,
        },
        (res) => {
          res.resume();
          res.on("end", () => {
            if (res.statusCode && res.statusCode >= 200 && res.statusCode < 300) {
              resolve();
            } else {
              reject(new Error(`HTTP ${res.statusCode ?? "??"}`));
            }
          });
        }
      );
      req.on("error", (err) => {
        reject(err);
      });
      req.on("timeout", () => {
        req.destroy();
        reject(new Error("timed out"));
      });
      req.write(body);
      req.end();
    });
  }

  private async deliver(msg: PetIpcMessage): Promise<void> {
    let lastErr: Error | undefined;
    for (let attempt = 1; attempt <= IPC_MAX_ATTEMPTS; attempt++) {
      const port = this.ipcPort;
      if (!port) {
        this.pendingMessages.push(msg);
        return;
      }
      try {
        await this.postIpcOnce(msg, port);
        this.consecutiveIpcFailures = nextIpcFailureCount(
          this.consecutiveIpcFailures,
          true
        );
        return;
      } catch (err) {
        lastErr = err instanceof Error ? err : new Error(String(err));
        this.log?.(
          formatIpcErrorLog({
            type: msg.type,
            port,
            reason: `${lastErr.message} (attempt ${attempt}/${IPC_MAX_ATTEMPTS})`,
          })
        );
      }
    }

    this.consecutiveIpcFailures = nextIpcFailureCount(
      this.consecutiveIpcFailures,
      false
    );
    if (
      !this.restartRequested &&
      shouldRestartPet(this.consecutiveIpcFailures, IPC_FAILURES_BEFORE_RESTART)
    ) {
      this.restartRequested = true;
      this.log?.(
        `pet IPC broken after ${this.consecutiveIpcFailures} consecutive failures; requesting restart`
      );
      this.onIpcBroken?.();
    }
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
        this.consecutiveIpcFailures = 0;
        this.restartRequested = false;
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
      return;
    }
    if (rec.type === "request-open-settings") {
      this.onRequestOpenSettings?.();
    }
  }
}
