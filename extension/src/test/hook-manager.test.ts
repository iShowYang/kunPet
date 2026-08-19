import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  mergeKunPetHook,
  mergeStopHook,
  removeKunPetHooks,
  removeStopHook,
} from "../hook-manager";

const CMD = 'node "C:/Users/x/.cursor/hooks/kunpet-notify.js" --event=stop';
const PROMPT_CMD = 'node "C:/Users/x/.cursor/hooks/kunpet-notify.js" --event=prompt';
const SESSION_CMD = 'node "C:/Users/x/.cursor/hooks/kunpet-notify.js" --event=session';
const STOP_CMD = CMD;

describe("mergeStopHook", () => {
  it("adds stop hook when missing", () => {
    const out = mergeStopHook({ version: 1, hooks: {} }, CMD) as any;
    assert.equal(out.hooks.stop.length, 1);
    assert.equal(out.hooks.stop[0].command, CMD);
  });
  it("does not duplicate existing kunpet command", () => {
    const once = mergeStopHook({ version: 1, hooks: {} }, CMD);
    const twice = mergeStopHook(once, CMD) as any;
    assert.equal(twice.hooks.stop.length, 1);
  });
  it("preserves other hooks", () => {
    const input = {
      version: 1,
      hooks: { stop: [{ command: "node other.js" }] },
    };
    const out = mergeStopHook(input, CMD) as any;
    assert.equal(out.hooks.stop.length, 2);
  });
  it("replaces stale kunpet command path instead of leaving it", () => {
    const stale = 'node "D:/old/.cursor/hooks/kunpet-notify.js"';
    const input = {
      version: 1,
      hooks: { stop: [{ command: stale }, { command: "node other.js" }] },
    };
    const out = mergeStopHook(input, CMD) as any;
    assert.equal(out.hooks.stop.length, 2);
    assert.equal(out.hooks.stop[0].command, CMD);
    assert.equal(out.hooks.stop[1].command, "node other.js");
  });
});

describe("removeStopHook", () => {
  it("removes only kunpet entries", () => {
    const input = {
      version: 1,
      hooks: {
        stop: [{ command: CMD }, { command: "node other.js" }],
      },
    };
    const out = removeStopHook(input, "kunpet-notify.js") as any;
    assert.equal(out.hooks.stop.length, 1);
    assert.match(out.hooks.stop[0].command, /other\.js/);
  });
});

describe("mergeKunPetHook", () => {
  it("adds beforeSubmitPrompt hook when missing", () => {
    const out = mergeKunPetHook({ version: 1, hooks: {} }, "beforeSubmitPrompt", PROMPT_CMD) as any;
    assert.equal(out.hooks.beforeSubmitPrompt.length, 1);
    assert.equal(out.hooks.beforeSubmitPrompt[0].command, PROMPT_CMD);
  });
  it("adds sessionStart hook when missing", () => {
    const out = mergeKunPetHook({ version: 1, hooks: {} }, "sessionStart", SESSION_CMD) as any;
    assert.equal(out.hooks.sessionStart.length, 1);
  });
  it("does not duplicate kunpet prompt hook", () => {
    const once = mergeKunPetHook({ version: 1, hooks: {} }, "beforeSubmitPrompt", PROMPT_CMD);
    const twice = mergeKunPetHook(once, "beforeSubmitPrompt", PROMPT_CMD) as any;
    assert.equal(twice.hooks.beforeSubmitPrompt.length, 1);
  });
});

describe("removeKunPetHooks", () => {
  it("removes kunpet entries from all three hook arrays", () => {
    const input = {
      version: 1,
      hooks: {
        stop: [{ command: STOP_CMD }, { command: "node other.js" }],
        beforeSubmitPrompt: [{ command: PROMPT_CMD }],
        sessionStart: [{ command: SESSION_CMD }, { command: "node keep.js" }],
      },
    };
    const out = removeKunPetHooks(input, "kunpet-notify.js") as any;
    assert.equal(out.hooks.stop.length, 1);
    assert.match(out.hooks.stop[0].command, /other\.js/);
    assert.equal(out.hooks.beforeSubmitPrompt.length, 0);
    assert.equal(out.hooks.sessionStart.length, 1);
    assert.match(out.hooks.sessionStart[0].command, /keep\.js/);
  });
});
