import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { confirmedDemoStaffAccess, isDemoMode, isExplicitDemoFlag } from "./demo.ts";

const confirmed = { demoFlag: "true", dataset: "sample" };

describe("demo mode", () => {
  it("stays off unless the flag is an explicit on value", () => {
    assert.equal(isDemoMode(""), false);
    assert.equal(isDemoMode("0"), false);
    assert.equal(isDemoMode("false"), false);
    assert.equal(isDemoMode("true"), true);
    assert.equal(isDemoMode(" 1 "), true);
    assert.equal(isDemoMode(" true "), true);
    assert.equal(isDemoMode("1"), true);
    for (const flag of ["YES", "yes", "on", "ON", "TRUE", "True", " true\n", "1 ", "01", "truee"]) {
      assert.equal(isExplicitDemoFlag(flag), flag.trim() === "true" || flag.trim() === "1", flag);
      assert.equal(isDemoMode(flag), flag.trim() === "true" || flag.trim() === "1", flag);
    }
  });

  it("reads an unset browser flag as off", () => {
    assert.equal(isDemoMode(), false);
  });
});

describe("demo desk access", () => {
  it("opens the desk and the staff picker when demo mode is explicitly confirmed", () => {
    assert.equal(confirmedDemoStaffAccess(confirmed), true);
    assert.equal(confirmedDemoStaffAccess({ ...confirmed, demoFlag: " true " }), true);
    assert.equal(confirmedDemoStaffAccess({ ...confirmed, demoFlag: "1" }), true);
    assert.equal(confirmedDemoStaffAccess({ ...confirmed, demoFlag: " 1 " }), true);
    assert.equal(confirmedDemoStaffAccess({ ...confirmed, demoFlag: "YES" }), false);
    assert.equal(confirmedDemoStaffAccess({ ...confirmed, demoFlag: "on" }), false);
    assert.equal(confirmedDemoStaffAccess({ ...confirmed, demoFlag: "TRUE" }), false);
  });

  it("does not treat a development server as confirmation", () => {
    assert.equal(confirmedDemoStaffAccess({ demoFlag: "true", dataset: "sample" }), true);
    assert.equal(confirmedDemoStaffAccess({ dataset: "sample" }), false);
    assert.equal(confirmedDemoStaffAccess({ demoFlag: "", dataset: "sample" }), false);
  });

  it("locks the desk when the flag or dataset is off, missing, or unknown", () => {
    for (const demoFlag of ["", "false", "0", "maybe", "demo", null]) {
      assert.equal(confirmedDemoStaffAccess({ ...confirmed, demoFlag }), false);
    }
    for (const dataset of ["shop", "real", "", null, undefined]) {
      assert.equal(confirmedDemoStaffAccess({ ...confirmed, dataset }), false);
    }
    assert.equal(confirmedDemoStaffAccess(), false);
  });
});
