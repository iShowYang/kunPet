#!/usr/bin/env node
/**
 * Cursor hook: notify kunPet extension. Always exit 0.
 * Usage: node kunpet-notify.js --event=stop|prompt|session
 */
const fs = require("fs");
const http = require("http");
const os = require("os");
const path = require("path");

const EVENT_MAP = {
  stop: "agent_stop",
  prompt: "agent_prompt",
  session: "agent_session_start",
};

function failOpen() {
  process.exit(0);
}

try {
  const eventArg = process.argv.find((a) => a.startsWith("--event="));
  const eventKey = eventArg ? eventArg.split("=")[1] : "stop";
  const bodyType = EVENT_MAP[eventKey] || EVENT_MAP.stop;

  const portFile = path.join(os.homedir(), ".cursor", "kunpet-port.json");
  if (!fs.existsSync(portFile)) failOpen();
  const { port } = JSON.parse(fs.readFileSync(portFile, "utf8"));
  if (!port) failOpen();

  const body = JSON.stringify({ type: bodyType, ts: Date.now() });
  const req = http.request(
    {
      host: "127.0.0.1",
      port,
      path: "/event",
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Content-Length": Buffer.byteLength(body),
      },
      timeout: 800,
    },
    (res) => {
      res.resume();
      res.on("end", failOpen);
    }
  );
  req.on("error", failOpen);
  req.on("timeout", () => {
    req.destroy();
    failOpen();
  });
  req.write(body);
  req.end();
} catch {
  failOpen();
}
