import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { isDemoMode } from "./demo.ts";

describe("demo mode", () => {
  it("stays off unless the flag is an explicit on value", () => {
    assert.equal(isDemoMode(""), false);
    assert.equal(isDemoMode("0"), false);
    assert.equal(isDemoMode("false"), false);
    assert.equal(isDemoMode("true"), true);
    assert.equal(isDemoMode("YES"), true);
    assert.equal(isDemoMode("1"), true);
    assert.equal(isDemoMode("on"), true);
  });

  it("reads an unset browser flag as off", () => {
    assert.equal(isDemoMode(), false);
  });
});
