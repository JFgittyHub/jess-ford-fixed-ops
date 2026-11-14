import "./test-dom.ts";
import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import { bookableDay } from "./bookable-day.ts";
import { addDays, pinClock, resetClock, todayIso } from "./clock.ts";
import { cleanFreeText, lookupOnlineCustomer, phoneKey, revealSavedVehicles } from "./online-request.ts";
import { createSeed } from "./seed.ts";
import type { ShopStorage } from "./shop-storage.ts";
import { bookingDateMessage, createShopStore, nextOpenShopDay } from "./store.ts";
import { lengthLabel } from "./format.ts";

afterEach(() => resetClock());

function memoryStorage(): ShopStorage {
  const items = new Map<string, string>();
  return {
    getItem: (key) => items.get(key) ?? null,
    setItem: (key, value) => { items.set(key, value); },
    removeItem: (key) => { items.delete(key); },
  };
}

function weekday(iso: string) {
  return new Date(`${iso}T12:00:00.000Z`).getUTCDay();
}

describe("round 22 dates and lookup", () => {
  it("skips closed weekdays and holidays, including a Saturday pin", () => {
    pinClock("2026-11-07T20:00:00.000Z");
    assert.equal(todayIso(), "2026-11-07");
    assert.equal(weekday(bookableDay()), 6);
    const shop = createShopStore({ demoMode: true, storage: memoryStorage() });
    shop.getState().setWorkingAs("derek");
    shop.getState().updateDayHours(1, { closed: true });
    shop.getState().setWorkingAs("megan");
    const rules = shop.getState().settings.scheduling;
    const day = bookableDay(0, { hours: rules.hours, closedDates: rules.closedDates });
    assert.notEqual(weekday(day), 1);
    assert.equal(bookingDateMessage(day, rules), "");
    pinClock("2026-11-26T20:00:00.000Z");
    assert.notEqual(bookableDay(), "2026-11-26");
    pinClock("2026-12-24T20:00:00.000Z");
    assert.ok(bookableDay() > "2026-12-25");
    pinClock("2026-12-25T20:00:00.000Z");
    assert.ok(bookableDay() > "2026-12-25");
  });

  it("opens the book dialog on the next open day from a Saturday, a holiday, or a past day", () => {
    const shop = createShopStore({ demoMode: true, storage: memoryStorage() });
    const rules = shop.getState().settings.scheduling;
    pinClock("2026-11-07T20:00:00.000Z");
    assert.equal(nextOpenShopDay("2026-11-08", rules), "2026-11-09");
    assert.equal(nextOpenShopDay("2026-10-01", rules), "2026-11-07");
    pinClock("2026-11-20T20:00:00.000Z");
    assert.equal(nextOpenShopDay("2026-11-26", rules), "2026-11-27");
  });

  it("does not find a returning customer by name on the public lookup", () => {
    const shop = createSeed();
    for (const query of ["Helen Cho", "helen cho", "  Helen Cho  ", "Hel\u200Den Cho"]) {
      assert.equal(lookupOnlineCustomer(shop.customers, shop.vehicles, query).kind, "new", query);
    }
    const helen = shop.customers.find((row) => row.name === "Helen Cho");
    assert.ok(helen);
    assert.equal(lookupOnlineCustomer(shop.customers, shop.vehicles, helen.email).kind, "code");
  });

  it("shows B only their own last 4, code, and VIN", () => {
    const shop = createShopStore({ demoMode: true, storage: memoryStorage() });
    const state = shop.getState();
    const withMobile = state.customers.filter((row) => row.mobile.trim());
    const ownerA = withMobile[0];
    const ownerB = withMobile.find((row) => row.id !== ownerA.id && row.mobile.replace(/\D/g, "").slice(-4) !== ownerA.mobile.replace(/\D/g, "").slice(-4));
    const vinA = state.vehicles.find((row) => row.customerId === ownerA.id)?.vin ?? "";
    const vinB = state.vehicles.find((row) => row.customerId === ownerB?.id)?.vin ?? "";
    assert.ok(ownerA && ownerB && vinA && vinB && vinA !== vinB);
    const found = lookupOnlineCustomer(state.customers, state.vehicles, ownerB.phone);
    assert.equal(found.kind, "code");
    if (found.kind !== "code") return;
    assert.equal(found.customerId, ownerB.id);
    const issued = shop.getState().issueOnlineChallenge(found.customerId);
    assert.equal(issued.ok, true);
    if (!issued.ok) return;
    const last4A = ownerA.mobile.replace(/\D/g, "").slice(-4);
    assert.equal(issued.mobileLast4, ownerB.mobile.replace(/\D/g, "").slice(-4));
    assert.notEqual(issued.mobileLast4, last4A);
    const issuedA = shop.getState().issueOnlineChallenge(ownerA.id);
    assert.equal(issuedA.ok, true);
    if (!issuedA.ok) return;
    assert.notEqual(issued.code, issuedA.code);
    const revealed = revealSavedVehicles({
      customer: ownerB,
      vehicles: state.vehicles,
      issuedCode: issued.code,
      enteredCode: issued.code,
    });
    assert.equal(revealed.unlocked, true);
    assert.equal(revealed.vehicles.some((row) => row.vin === vinA || row.customerId === ownerA.id), false);
    assert.equal(revealed.vehicles.some((row) => row.vin === vinB), true);
    const byName = lookupOnlineCustomer(state.customers, state.vehicles, ownerA.name);
    assert.equal(byName.kind, "new");
  });
});

describe("round 22 lines, transfers, and phones", () => {
  it("replaces concern lines exactly and logs only a real change", () => {
    const shop = createShopStore({ demoMode: true, storage: memoryStorage() });
    shop.getState().setWorkingAs("megan");
    const row = shop.getState().appointments.find((item) => item.lines.length > 1 && item.status === "scheduled");
    assert.ok(row);
    const before = shop.getState().settingsLog?.length ?? 0;
    const same = shop.getState().updateAppointment(row.id, { lines: row.lines });
    assert.equal(same.ok, true, same.error ?? "");
    assert.equal(shop.getState().settingsLog?.length ?? 0, before);
    const removed = shop.getState().updateAppointment(row.id, { lines: [row.lines[0]] });
    assert.equal(removed.ok, true, removed.error ?? "");
    const stored = shop.getState().appointments.find((item) => item.id === row.id);
    assert.equal(stored?.lines.length, 1);
    assert.equal(stored?.lines[0]?.concern, row.lines[0]?.concern);
    assert.ok((shop.getState().settingsLog?.length ?? 0) > before);
    const blanked = shop.getState().updateAppointment(row.id, { lines: [{ id: "x", code: "A", concern: "   " }] });
    assert.equal(blanked.ok, false);
    assert.match(blanked.error ?? "", /concern/);
    assert.equal(shop.getState().appointments.find((item) => item.id === row.id)?.lines.length, 1);
    const length = shop.getState().updateAppointment(row.id, { minutes: 120 });
    assert.equal(length.ok, true, length.error ?? "");
    assert.match(shop.getState().settingsLog?.find((item) => item.after.includes("Length"))?.after ?? "", /2 hr/);
    assert.equal(lengthLabel(120), "2 hr");
  });

  it("does not transfer a VIN when the time, lane, or labor is refused", () => {
    const shop = createShopStore({ demoMode: true, storage: memoryStorage() });
    shop.getState().setWorkingAs("megan");
    const helen = shop.getState().customers.find((row) => row.name === "Helen Cho");
    const other = shop.getState().customers.find((row) => row.id !== helen?.id);
    const helenVehicle = shop.getState().vehicles.find((row) => row.customerId === helen?.id);
    const otherVehicle = shop.getState().vehicles.find((row) => row.customerId === other?.id);
    assert.ok(helen && other && helenVehicle && otherVehicle);
    const book = (patch: { time?: string; lane?: string; laborOpIds?: string[] }) => shop.getState().saveAdvisorAppointment({
      date: bookableDay(),
      time: patch.time ?? "09:00",
      minutes: 60,
      customerId: other.id,
      vehicleId: otherVehicle.id,
      advisorId: "megan",
      techId: "marcus",
      concern: "Oil",
      lines: [{ id: "a", code: "A", concern: "Oil" }],
      vin: helenVehicle.vin,
      laborOpIds: patch.laborOpIds ?? [],
      lane: patch.lane ?? "drop",
      status: "scheduled",
    }, undefined, true, "Sold the truck");
    const badTime = book({ time: "25:99" });
    assert.match(badTime.error ?? "", /not on the clock/);
    assert.equal(shop.getState().vehicles.find((row) => row.id === helenVehicle.id)?.customerId, helen.id);
    const badLane = book({ lane: "nope" });
    assert.match(badLane.error ?? "", /lane/);
    assert.equal(shop.getState().vehicles.find((row) => row.id === helenVehicle.id)?.customerId, helen.id);
    const op = shop.getState().laborOps[0];
    const badLabor = book({ laborOpIds: [op.id, op.id] });
    assert.equal(badLabor.ok, false);
    assert.equal(shop.getState().vehicles.find((row) => row.id === helenVehicle.id)?.customerId, helen.id);
    const row = shop.getState().appointments.find((item) => item.date >= todayIso()) ?? shop.getState().appointments[0];
    assert.match(shop.getState().updateAppointment(row.id, { time: "25:99" }).error ?? "", /not on the clock/);
    assert.equal(shop.getState().addAppointment({ ...row, time: "25:99", date: bookableDay() }), "");
    assert.equal(shop.getState().addAppointment({ ...row, date: bookableDay(), customerId: "nope" }), "");
    const edited = shop.getState().saveAdvisorAppointment({
      date: bookableDay(),
      time: row.time,
      minutes: row.minutes,
      customerId: row.customerId,
      vehicleId: row.vehicleId,
      advisorId: row.advisorId,
      techId: row.techId,
      concern: row.concern,
      lines: row.lines,
      vin: row.vin,
      laborOpIds: row.laborOpIds,
      lane: row.lane,
      status: "bogus" as "arrived",
    }, row.id);
    assert.equal(edited.ok, false);
    assert.match(edited.error ?? "", /status/);
    shop.getState().setWorkingAs("derek");
    shop.getState().updateDayHours(1, { closed: true });
    shop.getState().setWorkingAs("megan");
    let monday = todayIso();
    for (let guard = 0; guard < 14 && weekday(monday) !== 1; guard += 1) monday = addDays(monday, 1);
    assert.equal(shop.getState().addAppointment({ ...row, date: monday, time: "09:00", lane: "drop", laborOpIds: [], vin: "" }), "");
  });

  it("keeps an Italian trunk zero, refuses a bad phone or email, and limits flags", () => {
    const uk = phoneKey("+44 20 7946 0958");
    assert.equal(phoneKey("+44 0 20 7946 0958"), uk);
    assert.notEqual(phoneKey("+39 0331 234567"), phoneKey("+39 331 234567"));
    assert.notEqual(phoneKey("+39 06 6982 1234"), phoneKey("+39 6 6982 1234"));
    assert.equal(phoneKey("+39 06 6982 1234").includes("3906"), true);
    assert.equal(phoneKey("+378 0549 882 377").includes("3780"), true);
    assert.equal(phoneKey("+999999999999999"), "");
    assert.equal(phoneKey("+1 555"), "");
    const shop = createShopStore({ demoMode: true, storage: memoryStorage() });
    shop.getState().setWorkingAs("megan");
    const mobile = shop.getState().createCustomer({ name: "Ada", phone: "5095550101", mobile: "not a phone", year: 2020, model: "Fiesta" });
    assert.match(mobile.error ?? "", /phone/);
    const email = shop.getState().createCustomer({ name: "Ada", phone: "5095550101", email: `${"a".repeat(200)}@x.test`, year: 2020, model: "Fiesta" });
    assert.match(email.error ?? "", /120/);
    assert.equal(cleanFreeText("1\uFE0F"), "1");
    assert.equal(cleanFreeText("1\uFE0F\u20E3"), "1\uFE0F\u20E3");
    assert.equal(cleanFreeText("©\uFE0F"), "©");
    assert.equal(cleanFreeText("1\u200D2"), "12");
    const england = "\u{1F3F4}\u{E0067}\u{E0062}\u{E0065}\u{E006E}\u{E0067}\u{E007F}";
    const scotland = "\u{1F3F4}\u{E0067}\u{E0062}\u{E0073}\u{E0063}\u{E0074}\u{E007F}";
    const wales = "\u{1F3F4}\u{E0067}\u{E0062}\u{E0077}\u{E006C}\u{E0073}\u{E007F}";
    assert.equal(cleanFreeText(england), england);
    assert.equal(cleanFreeText(scotland), scotland);
    assert.equal(cleanFreeText(wales), wales);
    assert.equal(cleanFreeText("\u{1F3F4}\u{E0067}\u{E0062}\u{E0078}\u{E007F}abc"), "\u{1F3F4}abc");
    assert.equal(cleanFreeText("\u{1F3F4}\u0000"), "\u{1F3F4}");
  });
});
