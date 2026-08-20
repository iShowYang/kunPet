import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { resolveElectronBinary, serializeIpc } from "../pet-process";

describe("serializeIpc", () => {
  it("writes one json line", () => {
    assert.equal(serializeIpc({ type: "celebrate" }), '{"type":"celebrate"}\n');
  });
});

describe("resolveElectronBinary", () => {
  it("returns electron.exe under petRoot when the file exists", () => {
    const petRoot = fs.mkdtempSync(path.join(os.tmpdir(), "kunpet-electron-"));
    const exe = path.join(petRoot, "node_modules", "electron", "dist", "electron.exe");
    fs.mkdirSync(path.dirname(exe), { recursive: true });
    fs.writeFileSync(exe, "");
    try {
      assert.equal(resolveElectronBinary(petRoot), exe);
    } finally {
      fs.rmSync(petRoot, { recursive: true, force: true });
    }
  });

  it("throws a clear error when electron.exe is missing", () => {
    const petRoot = fs.mkdtempSync(path.join(os.tmpdir(), "kunpet-no-electron-"));
    try {
      assert.throws(
        () => resolveElectronBinary(petRoot),
        (err: unknown) =>
          err instanceof Error &&
          /electron\.exe/i.test(err.message) &&
          err.message.includes(petRoot)
      );
    } finally {
      fs.rmSync(petRoot, { recursive: true, force: true });
    }
  });
});
