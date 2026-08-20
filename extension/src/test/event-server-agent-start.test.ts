import { describe, it } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { startEventServer } from "../event-server";

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

describe("startEventServer agent_start", () => {
  it("accepts agent_prompt and dedupes within 500ms", async () => {
    let count = 0;
    const server = await startEventServer({
      onAgentStop: () => {},
      onAgentStart: () => {
        count += 1;
      },
    });
    try {
      await post(server.port, { type: "agent_prompt", ts: 1 });
      await post(server.port, { type: "agent_session_start", ts: 2 });
      assert.equal(count, 1);
    } finally {
      await server.close();
    }
  });

  it("still accepts agent_stop with a separate dedupe bucket from agent_start", async () => {
    let stopCount = 0;
    let startCount = 0;
    const server = await startEventServer({
      onAgentStop: () => {
        stopCount += 1;
      },
      onAgentStart: () => {
        startCount += 1;
      },
    });
    try {
      const stopRes = await post(server.port, { type: "agent_stop", ts: 100 });
      assert.equal(stopRes.status, 200);
      const promptRes = await post(server.port, { type: "agent_prompt", ts: 200 });
      assert.equal(promptRes.status, 200);
      assert.equal(stopCount, 1);
      assert.equal(startCount, 1);
    } finally {
      await server.close();
    }
  });

  it("rejects unknown event types", async () => {
    const server = await startEventServer({ onAgentStop: () => {}, onAgentStart: () => {} });
    try {
      const status: number = await new Promise((resolve, reject) => {
        const req = http.request(
          {
            host: "127.0.0.1",
            port: server.port,
            path: "/event",
            method: "POST",
            headers: { "Content-Type": "application/json", "Content-Length": 2 },
          },
          (res) => resolve(res.statusCode ?? 0)
        );
        req.on("error", reject);
        req.write("{}");
        req.end();
      });
      assert.equal(status, 400);
    } finally {
      await server.close();
    }
  });
});
