import { describe, it } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { isTrayEvent, shouldDedupe, startEventServer } from "../event-server";

async function post(port: number, body: unknown): Promise<{ status: number; text: string }> {
  return new Promise((resolve, reject) => {
    const payload = JSON.stringify(body);
    const req = http.request(
      {
        host: "127.0.0.1",
        port,
        path: "/event",
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Content-Length": Buffer.byteLength(payload),
          Connection: "close",
        },
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (c) => chunks.push(c));
        res.on("end", () =>
          resolve({ status: res.statusCode ?? 0, text: Buffer.concat(chunks).toString("utf8") })
        );
      }
    );
    req.on("error", reject);
    req.end(payload);
  });
}

describe("shouldDedupe", () => {
  it("dedupes within window", () => {
    assert.equal(shouldDedupe(1000, 500, 2000), true);
  });
  it("allows outside window", () => {
    assert.equal(shouldDedupe(3000, 500, 2000), false);
  });
  it("allows when never fired", () => {
    assert.equal(shouldDedupe(1000, 0, 2000), false);
  });
});

describe("isTrayEvent", () => {
  it("accepts request-disable", () => {
    assert.equal(isTrayEvent({ type: "request-disable" }), true);
  });
  it("accepts request-open-settings", () => {
    assert.equal(isTrayEvent({ type: "request-open-settings" }), true);
  });
  it("accepts request-walk-to-center with boolean value", () => {
    assert.equal(isTrayEvent({ type: "request-walk-to-center", value: true }), true);
  });
  it("rejects invalid walk-to-center", () => {
    assert.equal(isTrayEvent({ type: "request-walk-to-center", value: "yes" }), false);
  });
});

describe("startEventServer", () => {
  it("serves GET /health and dispatches tray events", async () => {
    const events: unknown[] = [];
    const server = await startEventServer({
      onAgentStop: () => {},
      onAgentStart: () => {},
      onTrayEvent: (e) => events.push(e),
      preferredPort: 19310,
    });
    try {
      const ok = await new Promise<boolean>((resolve, reject) => {
        const req = http.get(
          {
            host: "127.0.0.1",
            port: server.port,
            path: "/health",
            headers: { Connection: "close" },
          },
          (res) => {
            res.resume();
            res.on("end", () => resolve(res.statusCode === 200));
          }
        );
        req.on("error", reject);
      });
      assert.equal(ok, true);

      const res = await post(server.port, { type: "request-disable" });
      assert.equal(res.status, 200);
      assert.deepEqual(events, [{ type: "request-disable" }]);
    } finally {
      await server.close();
    }
  });
});
