import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  computePrimaryCenter,
  computeTweenDurationMs,
  lerp,
  pickWalkStyleId,
  sampleWalkPose,
  walkDirection,
  WALK_STYLE_IDS,
  WIN_HEIGHT,
  WIN_WIDTH,
  type WalkStyleId,
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

describe("pickWalkStyleId", () => {
  it("returns one of the four style ids", () => {
    for (let i = 0; i < 20; i++) {
      const id = pickWalkStyleId(() => i / 20);
      assert.ok((WALK_STYLE_IDS as readonly string[]).includes(id));
    }
  });
});

describe("sampleWalkPose", () => {
  const from = { x: 0, y: 100 };
  const to = { x: 400, y: 200 };

  for (const styleId of WALK_STYLE_IDS) {
    it(`${styleId} endpoints match from/to`, () => {
      const a = sampleWalkPose(styleId, from, to, 0);
      const b = sampleWalkPose(styleId, from, to, 1);
      assert.equal(Math.round(a.x), from.x);
      assert.equal(Math.round(a.y), from.y);
      assert.equal(a.scale, 1);
      assert.equal(Math.round(b.x), to.x);
      assert.equal(Math.round(b.y), to.y);
      assert.equal(b.scale, 1);
    });
  }

  it("dash peaks scale above 1 near the end", () => {
    const mid = sampleWalkPose("dash", from, to, 0.925);
    assert.ok(mid.scale > 1);
  });

  it("arc lifts above the linear chord at mid", () => {
    const mid = sampleWalkPose("arc", from, to, 0.5);
    const linearY = lerp(from.y, to.y, 0.5);
    assert.ok(mid.y < linearY);
  });

  it("hop lifts above the linear chord mid-hop", () => {
    const mid = sampleWalkPose("hop" as WalkStyleId, from, to, 0.5 / 3);
    const linearY = lerp(from.y, to.y, 0.5 / 3);
    assert.ok(mid.y < linearY);
  });
});
