import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  computePrimaryCenter,
  computeTweenDurationMs,
  lerp,
  walkDirection,
  WIN_HEIGHT,
  WIN_WIDTH,
} from "../tween-math";

describe("computeTweenDurationMs", () => {
  it("returns 0 for distances under 20px", () => {
    assert.equal(computeTweenDurationMs(0, 0, 10, 0), 0);
  });
  it("scales duration by distance with min 400ms", () => {
    assert.equal(computeTweenDurationMs(0, 0, 160, 0), 400);
  });
  it("caps duration at 1800ms", () => {
    assert.equal(computeTweenDurationMs(0, 0, 5000, 0), 1800);
  });
});

describe("computePrimaryCenter", () => {
  it("centers 160x210 window in workArea", () => {
    assert.deepEqual(computePrimaryCenter({ x: 0, y: 0, width: 1920, height: 1040 }), {
      x: Math.round((1920 - WIN_WIDTH) / 2),
      y: Math.round((1040 - WIN_HEIGHT) / 2),
    });
  });
});

describe("lerp", () => {
  it("interpolates linearly", () => {
    assert.equal(lerp(0, 100, 0.5), 50);
  });
});

describe("walkDirection", () => {
  it("faces right when moving right", () => {
    assert.equal(walkDirection(0, 100), "right");
  });
  it("faces left when moving left", () => {
    assert.equal(walkDirection(100, 0), "left");
  });
});
