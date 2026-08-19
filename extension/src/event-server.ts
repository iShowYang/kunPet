import http from "node:http";
import type { AgentStartEvent, AgentStopEvent } from "./types";
import { AGENT_START_DEDUPE_MS, DEDUPE_WINDOW_MS } from "./types";

export function shouldDedupe(now: number, lastTs: number, windowMs: number): boolean {
  if (!lastTs) return false;
  return now - lastTs < windowMs;
}

function isAgentStop(body: unknown): body is AgentStopEvent {
  return (
    typeof body === "object" &&
    body !== null &&
    (body as AgentStopEvent).type === "agent_stop" &&
    typeof (body as AgentStopEvent).ts === "number"
  );
}

function isAgentStart(body: unknown): body is AgentStartEvent {
  if (typeof body !== "object" || body === null) return false;
  const typed = body as AgentStartEvent;
  return (
    (typed.type === "agent_prompt" || typed.type === "agent_session_start") &&
    typeof typed.ts === "number"
  );
}

export async function startEventServer(opts: {
  onAgentStop: (e: AgentStopEvent) => void;
  onAgentStart: (e: AgentStartEvent) => void;
  preferredPort?: number;
}): Promise<{ port: number; close: () => Promise<void> }> {
  let lastStopTs = 0;
  let lastStartTs = 0;

  const server = http.createServer((req, res) => {
    if (req.method === "POST" && req.url === "/event") {
      const chunks: Buffer[] = [];
      req.on("data", (c) => chunks.push(c));
      req.on("end", () => {
        try {
          const body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
          const now = Date.now();
          if (isAgentStop(body)) {
            if (shouldDedupe(now, lastStopTs, DEDUPE_WINDOW_MS)) {
              res.writeHead(200).end("deduped");
              return;
            }
            lastStopTs = now;
            opts.onAgentStop(body);
            res.writeHead(200).end("ok");
            return;
          }
          if (isAgentStart(body)) {
            if (shouldDedupe(now, lastStartTs, AGENT_START_DEDUPE_MS)) {
              res.writeHead(200).end("deduped");
              return;
            }
            lastStartTs = now;
            opts.onAgentStart(body);
            res.writeHead(200).end("ok");
            return;
          }
          res.writeHead(400).end("bad request");
        } catch {
          res.writeHead(400).end("bad json");
        }
      });
      return;
    }
    res.writeHead(404).end("not found");
  });

  const port = await new Promise<number>((resolve, reject) => {
    const tryListen = (p: number) => {
      const onError = (err: NodeJS.ErrnoException) => {
        server.off("error", onError);
        if (err.code === "EADDRINUSE" && p < 19300) {
          tryListen(p + 1);
        } else {
          reject(err);
        }
      };
      server.once("error", onError);
      server.listen(p, "127.0.0.1", () => {
        server.off("error", onError);
        const addr = server.address();
        if (addr && typeof addr === "object") resolve(addr.port);
        else reject(new Error("no address"));
      });
    };
    tryListen(opts.preferredPort ?? 19246);
  });

  return {
    port,
    close: () =>
      new Promise((resolve, reject) => {
        server.close((err) => (err ? reject(err) : resolve()));
      }),
  };
}
