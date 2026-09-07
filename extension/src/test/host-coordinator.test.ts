import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  HostCoordinator,
  HOSTS_FILE_NAME,
  PET_FILE_NAME,
  pruneStaleHosts,
  type HostRecord,
} from "../host-coordinator";

function tempCursorHome(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "kunpet-coord-"));
}

describe("pruneStaleHosts", () => {
  it("removes hosts older than stale window", () => {
    const now = 20_000;
    const hosts: HostRecord[] = [
      { hostId: "a", pid: 1, registeredAt: 0, lastSeen: 19_000 },
      { hostId: "b", pid: 2, registeredAt: 0, lastSeen: 4_000 },
    ];
    assert.deepEqual(pruneStaleHosts(hosts, now), [hosts[0]]);
  });
});

describe("HostCoordinator", () => {
  let cursorHome: string;

  beforeEach(() => {
    cursorHome = tempCursorHome();
  });

  afterEach(() => {
    fs.rmSync(cursorHome, { recursive: true, force: true });
  });

  it("registers hosts and tracks ref count", async () => {
    const a = new HostCoordinator({ cursorHome, hostId: "host-a", pid: 101 });
    const b = new HostCoordinator({ cursorHome, hostId: "host-b", pid: 202 });

    assert.equal((await a.registerHost()).isFirstHost, true);
    assert.equal((await b.registerHost()).isFirstHost, false);

    const raw = JSON.parse(
      fs.readFileSync(path.join(cursorHome, HOSTS_FILE_NAME), "utf8")
    ) as { hosts: HostRecord[] };
    assert.equal(raw.hosts.length, 2);
  });

  it("unregister last host requests pet stop", async () => {
    const host = new HostCoordinator({ cursorHome, hostId: "host-c", pid: 303 });
    await host.registerHost();
    const out = await host.unregisterHost();
    assert.equal(out.remainingHosts, 0);
    assert.equal(out.shouldStopPet, true);
  });

  it("unregister with remaining host does not stop pet", async () => {
    const a = new HostCoordinator({ cursorHome, hostId: "host-d", pid: 404 });
    const b = new HostCoordinator({ cursorHome, hostId: "host-e", pid: 505 });
    await a.registerHost();
    await b.registerHost();
    const out = await a.unregisterHost();
    assert.equal(out.remainingHosts, 1);
    assert.equal(out.shouldStopPet, false);
  });

  it("resolvePetAction attach when pet health ok", async () => {
    fs.writeFileSync(
      path.join(cursorHome, PET_FILE_NAME),
      JSON.stringify({ ipcPort: 59999, ownerPid: 1, startedAt: 1 })
    );

    const http = await import("node:http");
    const server = http.createServer((req, res) => {
      if (req.url === "/health") {
        res.writeHead(200).end("ok");
        return;
      }
      res.writeHead(404).end();
    });
    await new Promise<void>((resolve) => server.listen(59999, "127.0.0.1", resolve));

    try {
      const coord = new HostCoordinator({ cursorHome, hostId: "host-f", pid: 606 });
      const action = await coord.resolvePetAction();
      assert.deepEqual(action, { action: "attach", ipcPort: 59999 });
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });

  it("resolvePetAction spawn when pet health fails", async () => {
    fs.writeFileSync(
      path.join(cursorHome, PET_FILE_NAME),
      JSON.stringify({ ipcPort: 58888, ownerPid: 1, startedAt: 1 })
    );
    const coord = new HostCoordinator({ cursorHome, hostId: "host-g", pid: 707 });
    const action = await coord.resolvePetAction();
    assert.deepEqual(action, { action: "spawn" });
    const claim = JSON.parse(
      fs.readFileSync(path.join(cursorHome, PET_FILE_NAME), "utf8")
    ) as { status: string; ownerHostId: string };
    assert.equal(claim.status, "starting");
    assert.equal(claim.ownerHostId, "host-g");
  });

  it("second host waits while first holds starting claim", async () => {
    const a = new HostCoordinator({ cursorHome, hostId: "host-h", pid: 808 });
    const b = new HostCoordinator({ cursorHome, hostId: "host-i", pid: 909 });
    assert.deepEqual(await a.resolvePetAction(), { action: "spawn" });
    assert.deepEqual(await b.resolvePetAction(), { action: "wait" });
  });

  it("waitForPetReady attaches after publish", async () => {
    const a = new HostCoordinator({ cursorHome, hostId: "host-j", pid: 1010 });
    const b = new HostCoordinator({ cursorHome, hostId: "host-k", pid: 1111 });
    await a.resolvePetAction();

    const http = await import("node:http");
    const server = http.createServer((req, res) => {
      if (req.url === "/health") {
        res.writeHead(200).end("ok");
        return;
      }
      res.writeHead(404).end();
    });
    await new Promise<void>((resolve) => server.listen(57777, "127.0.0.1", resolve));

    try {
      setTimeout(() => a.publishPetInfo(57777), 100);
      const ready = await b.waitForPetReady(3000);
      assert.deepEqual(ready, { ipcPort: 57777 });
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });
});
