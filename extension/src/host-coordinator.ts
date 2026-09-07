import fs from "node:fs";
import { randomUUID } from "node:crypto";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { getCursorHome, readPortFile } from "./hook-manager";

export const HOSTS_FILE_NAME = "kunpet-hosts.json";
export const PET_FILE_NAME = "kunpet-pet.json";
export const HEARTBEAT_INTERVAL_MS = 5000;
export const HOST_STALE_MS = 15000;
export const PET_HEALTH_TIMEOUT_MS = 2000;
export const PET_STARTING_STALE_MS = 15000;
export const PET_WAIT_TIMEOUT_MS = 12000;
export const PET_WAIT_POLL_MS = 250;
export const LOCK_RETRIES = 5;
export const LOCK_RETRY_MS = 50;

export type HostRecord = {
  hostId: string;
  pid: number;
  eventPort?: number;
  registeredAt: number;
  lastSeen: number;
};

export type HostsFile = {
  hosts: HostRecord[];
};

export type PetReadyFile = {
  status?: "ready";
  ipcPort: number;
  ownerPid: number;
  ownerHostId?: string;
  startedAt: number;
};

export type PetStartingFile = {
  status: "starting";
  ownerHostId: string;
  ownerPid: number;
  startedAt: number;
};

export type PetFile = PetReadyFile | PetStartingFile;

function hostsPath(cursorHome: string): string {
  return path.join(cursorHome, HOSTS_FILE_NAME);
}

function petPath(cursorHome: string): string {
  return path.join(cursorHome, PET_FILE_NAME);
}

function lockPath(cursorHome: string): string {
  return path.join(cursorHome, "kunpet-coordinator.lock");
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function withCoordinatorLock<T>(
  cursorHome: string,
  fn: () => T | Promise<T>
): Promise<T> {
  for (let attempt = 0; attempt < LOCK_RETRIES; attempt++) {
    try {
      fs.mkdirSync(cursorHome, { recursive: true });
      const fd = fs.openSync(lockPath(cursorHome), "wx");
      fs.closeSync(fd);
      try {
        return await fn();
      } finally {
        try {
          fs.unlinkSync(lockPath(cursorHome));
        } catch {
          /* ignore */
        }
      }
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "EEXIST") {
        await sleep(LOCK_RETRY_MS);
        continue;
      }
      throw err;
    }
  }
  throw new Error("failed to acquire coordinator lock");
}

function readHostsFile(cursorHome: string): HostsFile {
  const file = hostsPath(cursorHome);
  if (!fs.existsSync(file)) return { hosts: [] };
  try {
    return JSON.parse(fs.readFileSync(file, "utf8")) as HostsFile;
  } catch {
    return { hosts: [] };
  }
}

function writeHostsFile(cursorHome: string, data: HostsFile): void {
  fs.mkdirSync(cursorHome, { recursive: true });
  const file = hostsPath(cursorHome);
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(data));
  fs.renameSync(tmp, file);
}

export function pruneStaleHosts(hosts: HostRecord[], now: number): HostRecord[] {
  return hosts.filter((host) => now - host.lastSeen <= HOST_STALE_MS);
}

export function isPetStarting(data: unknown): data is PetStartingFile {
  if (typeof data !== "object" || data === null) return false;
  const typed = data as PetStartingFile;
  return (
    typed.status === "starting" &&
    typeof typed.ownerHostId === "string" &&
    typeof typed.startedAt === "number"
  );
}

export function isPetReady(data: unknown): data is PetReadyFile {
  if (typeof data !== "object" || data === null) return false;
  const typed = data as Record<string, unknown>;
  if (typed.status === "starting") return false;
  return typeof typed.ipcPort === "number";
}

export function readPetFile(cursorHome: string): PetFile | null {
  const file = petPath(cursorHome);
  if (!fs.existsSync(file)) return null;
  try {
    const data = JSON.parse(fs.readFileSync(file, "utf8")) as unknown;
    if (isPetStarting(data) || isPetReady(data)) return data;
  } catch {
    /* ignore */
  }
  return null;
}

function writePetFile(cursorHome: string, body: PetFile): void {
  fs.mkdirSync(cursorHome, { recursive: true });
  const file = petPath(cursorHome);
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(body));
  fs.renameSync(tmp, file);
}

function deletePetInfoFile(cursorHome: string): void {
  const file = petPath(cursorHome);
  if (fs.existsSync(file)) fs.unlinkSync(file);
}

export function checkPetHealth(ipcPort: number): Promise<boolean> {
  return probeHttpHealth(ipcPort, "/health");
}

export function checkEventServerHealth(port: number): Promise<boolean> {
  return probeHttpHealth(port, "/health");
}

function probeHttpHealth(port: number, pathName: string): Promise<boolean> {
  return new Promise((resolve) => {
    const req = http.get(
      {
        host: "127.0.0.1",
        port,
        path: pathName,
        timeout: PET_HEALTH_TIMEOUT_MS,
      },
      (res) => {
        res.resume();
        resolve(res.statusCode === 200);
      }
    );
    req.on("error", () => resolve(false));
    req.on("timeout", () => {
      req.destroy();
      resolve(false);
    });
  });
}

export class HostCoordinator {
  private readonly cursorHome: string;
  private readonly hostId: string;
  private readonly pid: number;
  private eventPort?: number;

  constructor(opts?: { cursorHome?: string; hostId?: string; pid?: number }) {
    this.cursorHome = opts?.cursorHome ?? getCursorHome();
    this.hostId = opts?.hostId ?? randomUUID();
    this.pid = opts?.pid ?? process.pid;
  }

  getHostId(): string {
    return this.hostId;
  }

  async registerHost(): Promise<{ isFirstHost: boolean }> {
    const now = Date.now();
    return withCoordinatorLock(this.cursorHome, () => {
      const data = readHostsFile(this.cursorHome);
      const pruned = pruneStaleHosts(data.hosts, now).filter(
        (host) => typeof host.hostId === "string"
      );
      const isFirstHost = pruned.length === 0;
      const existing = pruned.find((host) => host.hostId === this.hostId);
      if (existing) {
        existing.lastSeen = now;
        existing.pid = this.pid;
        if (this.eventPort !== undefined) existing.eventPort = this.eventPort;
      } else {
        pruned.push({
          hostId: this.hostId,
          pid: this.pid,
          registeredAt: now,
          lastSeen: now,
          eventPort: this.eventPort,
        });
      }
      writeHostsFile(this.cursorHome, { hosts: pruned });
      return { isFirstHost };
    });
  }

  async unregisterHost(): Promise<{ remainingHosts: number; shouldStopPet: boolean }> {
    const now = Date.now();
    return withCoordinatorLock(this.cursorHome, () => {
      const data = readHostsFile(this.cursorHome);
      const pruned = pruneStaleHosts(data.hosts, now)
        .filter((host) => typeof host.hostId === "string")
        .filter((host) => host.hostId !== this.hostId);
      writeHostsFile(this.cursorHome, { hosts: pruned });
      return {
        remainingHosts: pruned.length,
        shouldStopPet: pruned.length === 0,
      };
    });
  }

  async heartbeat(): Promise<void> {
    const now = Date.now();
    await withCoordinatorLock(this.cursorHome, () => {
      const data = readHostsFile(this.cursorHome);
      const pruned = pruneStaleHosts(data.hosts, now).filter(
        (host) => typeof host.hostId === "string"
      );
      const me = pruned.find((host) => host.hostId === this.hostId);
      if (me) {
        me.lastSeen = now;
        me.pid = this.pid;
        if (this.eventPort !== undefined) me.eventPort = this.eventPort;
      }
      writeHostsFile(this.cursorHome, { hosts: pruned });
    });
  }

  setEventPort(port: number): void {
    this.eventPort = port;
  }

  getEventPort(): number | undefined {
    return this.eventPort;
  }

  /**
   * Decide whether this host should spawn or attach.
   * Uses a "starting" claim so two windows activating together do not both spawn.
   */
  async resolvePetAction(): Promise<{ action: "spawn" | "attach" | "wait"; ipcPort?: number }> {
    const now = Date.now();
    const petFile = readPetFile(this.cursorHome);

    if (petFile && isPetReady(petFile)) {
      const alive = await checkPetHealth(petFile.ipcPort);
      if (alive) return { action: "attach", ipcPort: petFile.ipcPort };
      await withCoordinatorLock(this.cursorHome, () => {
        const current = readPetFile(this.cursorHome);
        if (current && isPetReady(current) && current.ipcPort === petFile.ipcPort) {
          deletePetInfoFile(this.cursorHome);
        }
      });
    }

    // Orphaned Electron still holding the single-instance lock — attach instead of spawn.
    const livePort = await this.discoverLivePetPort();
    if (livePort !== undefined) {
      this.publishPetInfo(livePort);
      return { action: "attach", ipcPort: livePort };
    }

    return withCoordinatorLock(this.cursorHome, () => {
      const current = readPetFile(this.cursorHome);
      if (current && isPetReady(current)) {
        // Another host may have published while we waited for the lock.
        return { action: "wait" as const };
      }
      if (current && isPetStarting(current)) {
        if (
          current.ownerHostId !== this.hostId &&
          now - current.startedAt <= PET_STARTING_STALE_MS
        ) {
          return { action: "wait" as const };
        }
      }
      writePetFile(this.cursorHome, {
        status: "starting",
        ownerHostId: this.hostId,
        ownerPid: this.pid,
        startedAt: now,
      });
      return { action: "spawn" as const };
    });
  }

  async waitForPetReady(
    timeoutMs = PET_WAIT_TIMEOUT_MS
  ): Promise<{ ipcPort: number } | null> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const petFile = readPetFile(this.cursorHome);
      if (petFile && isPetReady(petFile)) {
        const alive = await checkPetHealth(petFile.ipcPort);
        if (alive) return { ipcPort: petFile.ipcPort };
      }
      if (petFile && isPetStarting(petFile) && petFile.ownerHostId === this.hostId) {
        // Our own stale claim — let caller spawn again.
        return null;
      }
      if (!petFile) return null;
      await sleep(PET_WAIT_POLL_MS);
    }
    return null;
  }

  publishPetInfo(ipcPort: number): void {
    writePetFile(this.cursorHome, {
      status: "ready",
      ipcPort,
      ownerPid: this.pid,
      ownerHostId: this.hostId,
      startedAt: Date.now(),
    });
  }

  clearPetInfo(): void {
    deletePetInfoFile(this.cursorHome);
  }

  clearStartingClaim(): void {
    const current = readPetFile(this.cursorHome);
    if (current && isPetStarting(current) && current.ownerHostId === this.hostId) {
      deletePetInfoFile(this.cursorHome);
    }
  }

  /**
   * Fallback when Electron single-instance lock blocks a new spawn:
   * the live pet writes ipc-port.json under the shared userData dir.
   */
  async discoverLivePetPort(): Promise<number | undefined> {
    const file = path.join(os.tmpdir(), "kunpet-electron", "ipc-port.json");
    if (!fs.existsSync(file)) return undefined;
    try {
      const data = JSON.parse(fs.readFileSync(file, "utf8")) as { ipcPort?: unknown };
      if (typeof data.ipcPort !== "number") return undefined;
      const alive = await checkPetHealth(data.ipcPort);
      return alive ? data.ipcPort : undefined;
    } catch {
      return undefined;
    }
  }

  async resolveEventServerAction(): Promise<{ action: "start" | "attach"; port?: number }> {
    const portFile = readPortFile(this.cursorHome);
    if (!portFile) return { action: "start" };
    const alive = await checkEventServerHealth(portFile.port);
    if (alive) return { action: "attach", port: portFile.port };
    return { action: "start" };
  }
}
