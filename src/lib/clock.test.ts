import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import { addDays, daysBetween, daysInMonth, dayOfMonth, monthKey, paceRatio, pinClock, resetClock, todayIso, todayLabel } from "./clock.ts";

describe("shop clock", () => {
  afterEach(() => resetClock());

  it("reads the dealership day in Pacific Time, including across UTC midnight", () => {
    pinClock("2026-10-20T06:30:00.000Z");
    assert.equal(todayIso(), "2026-10-19");
    assert.equal(todayLabel(), "Monday, October 19");
    assert.equal(monthKey(), "2026-10");
    assert.equal(dayOfMonth(), 19);
    assert.equal(daysInMonth(), 31);
    assert.equal(paceRatio(), 19 / 31);

    pinClock("2026-10-20T07:30:00.000Z");
    assert.equal(todayIso(), "2026-10-20");
  });

  it("uses the real length of February when the clock is pinned there", () => {
    pinClock("2026-02-01T20:00:00.000Z");
    assert.equal(todayIso(), "2026-02-01");
    assert.equal(daysInMonth(), 28);
    assert.equal(paceRatio(), 1 / 28);
  });

  it("adds and counts calendar days without a timezone shift", () => {
    assert.equal(addDays("2026-10-19", -2), "2026-10-17");
    assert.equal(addDays("2026-03-01", -1), "2026-02-28");
    assert.equal(daysBetween("2026-10-19", "2026-09-02"), -47);
  });
});
