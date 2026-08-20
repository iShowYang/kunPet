import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readKunPetSettings } from "../settings";

function fakeConfig(values: Record<string, boolean | undefined>) {
  return {
    get(key: string, defaultValue: boolean): boolean {
      const v = values[key];
      return typeof v === "boolean" ? v : defaultValue;
    },
  };
}

describe("readKunPetSettings", () => {
  it("defaults both flags to true when unset", () => {
    const out = readKunPetSettings((section) => {
      assert.equal(section, "kunpet");
      return fakeConfig({});
    });
    assert.deepEqual(out, { enabled: true, walkToCenter: true });
  });

  it("reads false values from configuration", () => {
    const out = readKunPetSettings(() =>
      fakeConfig({ enabled: false, walkToCenter: false })
    );
    assert.deepEqual(out, { enabled: false, walkToCenter: false });
  });

  it("reads mixed values", () => {
    const out = readKunPetSettings(() =>
      fakeConfig({ enabled: true, walkToCenter: false })
    );
    assert.deepEqual(out, { enabled: true, walkToCenter: false });
  });
});
