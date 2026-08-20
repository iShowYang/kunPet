import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { shouldDedupe } from "../event-server";

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
