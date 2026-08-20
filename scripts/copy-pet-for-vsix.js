#!/usr/bin/env node
"use strict";

const fs = require("node:fs");
const fsp = require("node:fs/promises");
const path = require("node:path");

const REPO_ROOT = path.resolve(__dirname, "..");
const SRC = path.join(REPO_ROOT, "pet");
const DEST = path.join(REPO_ROOT, "extension", "pet");

const SKIP_DIR_NAMES = new Set([".git", "node_modules"]);
const SKIP_FILE_NAMES = new Set(["package-lock.json"]);

function shouldSkip(relativePosix) {
  const parts = relativePosix.split("/");
  if (parts.some((p) => SKIP_DIR_NAMES.has(p))) {
    return true;
  }
  return false;
}

async function copyDir(srcDir, destDir, relative = "") {
  await fsp.mkdir(destDir, { recursive: true });
  for (const entry of fs.readdirSync(srcDir, { withFileTypes: true })) {
    const rel = relative ? `${relative}/${entry.name}` : entry.name;
    const relPosix = rel.split(path.sep).join("/");
    if (shouldSkip(relPosix)) {
      continue;
    }
    if (entry.isFile() && SKIP_FILE_NAMES.has(entry.name)) {
      continue;
    }

    const from = path.join(srcDir, entry.name);
    const to = path.join(destDir, entry.name);
    if (entry.isDirectory()) {
      await copyDir(from, to, rel);
    } else if (entry.isFile()) {
      await fsp.copyFile(from, to);
    }
  }
}

async function main() {
  const mainJs = path.join(SRC, "main.js");
  if (!fs.existsSync(mainJs)) {
    console.error(`pet app not found: ${mainJs}`);
    process.exit(1);
  }

  if (fs.existsSync(DEST)) {
    fs.rmSync(DEST, { recursive: true, force: true });
  }

  await copyDir(SRC, DEST);
  console.log(
    "Copied pet/ -> extension/pet/ (without node_modules; Electron downloads on first run)"
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
