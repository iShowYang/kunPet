import type { PetIpcMessage } from "./types";

export const IPC_TIMEOUT_MS = 3000;
export const IPC_MAX_ATTEMPTS = 3;
export const IPC_FAILURES_BEFORE_RESTART = 3;

export function formatIpcErrorLog(opts: {
  type: string;
  port: number;
  reason: string;
}): string {
  return `pet IPC ${opts.reason}: type=${opts.type} port=${opts.port}`;
}

export function nextIpcFailureCount(current: number, success: boolean): number {
  return success ? 0 : current + 1;
}

export function shouldRestartPet(
  failureCount: number,
  threshold: number = IPC_FAILURES_BEFORE_RESTART
): boolean {
  return failureCount >= threshold;
}

export function resolveSessionStartMessage(opts: {
  awaitingCelebrate: boolean;
}): Extract<PetIpcMessage, { type: "return-idle" }> {
  if (opts.awaitingCelebrate) {
    return { type: "return-idle", force: true };
  }
  return { type: "return-idle" };
}
