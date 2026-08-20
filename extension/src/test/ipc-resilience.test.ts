import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  formatIpcErrorLog,
  nextIpcFailureCount,
  shouldRestartPet,
  resolveSessionStartMessage,
  IPC_FAILURES_BEFORE_RESTART,
} from "../ipc-resilience";

describe("formatIpcErrorLog", () => {
  it("includes message type, port, and reason", () => {
    const line = formatIpcErrorLog({
      type: "celebrate",
      port: 19246,
      reason: "timed out",
    });
    assert.match(line, /celebrate/);
    assert.match(line, /19246/);
    assert.match(line, /timed out/);
  });
});

describe("nextIpcFailureCount", () => {
  it("increments on failure and resets on success", () => {
    assert.equal(nextIpcFailureCount(0, false), 1);
    assert.equal(nextIpcFailureCount(2, false), 3);
    assert.equal(nextIpcFailureCount(3, true), 0);
  });
});

describe("shouldRestartPet", () => {
  it("restarts after threshold consecutive failures", () => {
    assert.equal(shouldRestartPet(IPC_FAILURES_BEFORE_RESTART - 1), false);
    assert.equal(shouldRestartPet(IPC_FAILURES_BEFORE_RESTART), true);
    assert.equal(shouldRestartPet(IPC_FAILURES_BEFORE_RESTART + 2), true);
  });
});

describe("resolveSessionStartMessage", () => {
  it("force-returns idle when celebrate was expected but not completed", () => {
    assert.deepEqual(resolveSessionStartMessage({ awaitingCelebrate: true }), {
      type: "return-idle",
      force: true,
    });
  });

  it("uses normal return-idle when not awaiting celebrate", () => {
    assert.deepEqual(resolveSessionStartMessage({ awaitingCelebrate: false }), {
      type: "return-idle",
    });
  });
});
