import "./test-dom.ts";
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { clockTime, lengthLabel } from "../components/appointment-calendar.tsx";
import { VisitLengthPicker } from "../routes/schedule.tsx";
import { bookableDay } from "./bookable-day.ts";
import { addDays, now, todayIso } from "./clock.ts";
import { changeLogLine } from "./cancel.ts";
import { cleanFreeText, dedupeKey, lookupOnlineCustomer, phoneKey, submitOnlineRequest } from "./online-request.ts";
import { clampMileageForward, createSeed } from "./seed.ts";
import type { ShopStorage } from "./shop-storage.ts";
import { createShopStore } from "./store.ts";
import { fullVin } from "./vin.ts";

function memoryStorage(): ShopStorage {
  const items = new Map<string, string>();
  return {
    getItem: (key) => items.get(key) ?? null,
    setItem: (key, value) => { items.set(key, value); },
    removeItem: (key) => { items.delete(key); },
  };
}

function closedSunday() {
  let cursor = todayIso();
  for (let guard = 0; guard < 8; guard += 1) {
    if (new Date(`${cursor}T12:00:00.000Z`).getUTCDay() === 0) return cursor;
    cursor = addDays(cursor, 1);
  }
  return cursor;
}

describe("round 21 bookings and dates", () => {
  it("derives a bookable day from the clock and refuses a blank date", () => {
    const day = bookableDay();
    assert.notEqual(new Date(`${day}T12:00:00.000Z`).getUTCDay(), 0);
    assert.ok(day >= todayIso());
    const shop = createShopStore({ demoMode: true, storage: memoryStorage() });
    shop.getState().setWorkingAs("megan");
    const row = shop.getState().appointments.find((item) => item.status === "scheduled");
    assert.ok(row);
    assert.equal(shop.getState().addAppointment({ ...row, date: "" }), "");
    const saved = shop.getState().saveAdvisorAppointment({
      date: "",
      time: "09:00",
      minutes: 60,
      customerId: row.customerId,
      vehicleId: row.vehicleId,
      advisorId: row.advisorId,
      techId: row.techId,
      concern: "Oil",
      lines: [{ id: "a", code: "A", concern: "Oil" }],
      vin: "",
      laborOpIds: [],
      lane: "drop",
      status: "scheduled",
    });
    assert.match(saved.error ?? "", /not a real day/);
  });

  it("does not transfer a VIN when the day is closed or already past", () => {
    const shop = createShopStore({ demoMode: true, storage: memoryStorage() });
    shop.getState().setWorkingAs("megan");
    const helen = shop.getState().customers.find((row) => row.name === "Helen Cho");
    const other = shop.getState().customers.find((row) => row.id !== helen?.id);
    const helenVehicle = shop.getState().vehicles.find((row) => row.customerId === helen?.id);
    const otherVehicle = shop.getState().vehicles.find((row) => row.customerId === other?.id);
    assert.ok(helen && other && helenVehicle && otherVehicle);
    const book = (date: string) => shop.getState().saveAdvisorAppointment({
      date,
      time: "09:00",
      minutes: 60,
      customerId: other.id,
      vehicleId: otherVehicle.id,
      advisorId: "megan",
      techId: "marcus",
      concern: "Oil",
      lines: [{ id: "a", code: "A", concern: "Oil" }],
      vin: helenVehicle.vin,
      laborOpIds: [],
      lane: "drop",
      status: "scheduled",
    }, undefined, true, "Sold the truck to the new owner");
    const closed = book(closedSunday());
    assert.match(closed.error ?? "", /closed that day/);
    assert.equal(shop.getState().vehicles.find((row) => row.id === helenVehicle.id)?.customerId, helen.id);
    const past = book(addDays(todayIso(), -2));
    assert.match(past.error ?? "", /already past/);
    assert.equal(shop.getState().vehicles.find((row) => row.id === helenVehicle.id)?.customerId, helen.id);
    const added = shop.getState().addAppointment({
      date: bookableDay(),
      time: "11:00",
      minutes: 60,
      customerId: other.id,
      vehicleId: otherVehicle.id,
      advisorId: "megan",
      techId: "marcus",
      concern: "Oil",
      lines: [{ id: "b", code: "A", concern: "Oil" }],
      vin: helenVehicle.vin,
      laborOpIds: [],
      lane: "drop",
    });
    assert.ok(added);
    assert.equal(shop.getState().appointments.find((row) => row.id === added)?.vin, otherVehicle.vin);
  });

  it("keeps the second concern line and logs a real VIN change", () => {
    const shop = createShopStore({ demoMode: true, storage: memoryStorage() });
    shop.getState().setWorkingAs("megan");
    const row = shop.getState().appointments.find((item) => item.lines.length > 1);
    assert.ok(row);
    const before = shop.getState().settingsLog?.length ?? 0;
    const saved = shop.getState().updateAppointment(row.id, { lines: row.lines });
    assert.equal(saved.ok, true, saved.error ?? "");
    const stored = shop.getState().appointments.find((item) => item.id === row.id);
    assert.equal(stored?.lines.length, row.lines.length);
    assert.equal(stored?.lines[1]?.concern, row.lines[1]?.concern);
    assert.equal(shop.getState().settingsLog?.length ?? 0, before);
    const vehicle = shop.getState().vehicles.find((item) => item.customerId === row.customerId && item.id !== row.vehicleId);
    const nextVin = vehicle?.vin || fullVin({ prefix: "1FTAB12C", year: 2019, plant: "G", serial: 77 });
    const edited = shop.getState().updateAppointment(row.id, { vin: nextVin });
    if (edited.ok) {
      assert.equal(shop.getState().settingsLog?.some((item) => item.after.includes("VIN")), true);
    }
  });

  it("refuses an unknown status, an unknown visit, and a time that is not on the clock", () => {
    const shop = createShopStore({ demoMode: true, storage: memoryStorage() });
    shop.getState().setWorkingAs("megan");
    const row = shop.getState().appointments.find((item) => item.date >= todayIso()) ?? shop.getState().appointments[0];
    assert.match(shop.getState().setAppointmentStatus("missing", "arrived").error ?? "", /not on this store/);
    assert.match(shop.getState().setAppointmentStatus(row.id, "bogus" as "arrived").error ?? "", /status/);
    assert.match(shop.getState().moveAppointment(row.id, { time: "25:99" }).error ?? "", /not on the clock/);
    assert.equal(shop.getState().appointments.find((item) => item.id === row.id)?.time, row.time);
    assert.equal(clockTime("09:00"), "9:00 AM");
    assert.equal(lengthLabel(120), "2 hr");
    const html = renderToStaticMarkup(createElement(VisitLengthPicker, {
      minutes: 120,
      lengths: [30, 60, 90, 120],
      onChange: () => undefined,
    }));
    assert.match(html, /2 hr/);
    assert.match(html, /1\.5 hr/);
    assert.match(html, /30 min/);
    assert.match(html, /aria-label="Visit length"/);
  });
});

describe("round 21 text and phones", () => {
  it("keeps emoji and Persian joiners and strips Latin joiners and extra variation selectors", () => {
    assert.equal(cleanFreeText("e\u0301"), "é");
    assert.equal(cleanFreeText("1️⃣"), "1️⃣");
    assert.equal(cleanFreeText("⭐\uFE0F"), "⭐\uFE0F");
    assert.equal(cleanFreeText("©\uFE0F"), "©");
    const england = "\u{1F3F4}\u{E0067}\u{E0062}\u{E0065}\u{E006E}\u{E0067}\u{E007F}";
    assert.equal(cleanFreeText(england), england);
    assert.equal(cleanFreeText("a\u{E0067}b"), "ab");
    assert.equal(cleanFreeText("\u{1F468}\u200D\u{1F469}\u200D\u{1F467}"), "\u{1F468}\u200D\u{1F469}\u200D\u{1F467}");
    const persian = "علی\u200Cرضا";
    assert.equal(cleanFreeText(persian), persian);
    assert.equal(cleanFreeText("a\u200Db"), "ab");
    assert.equal(cleanFreeText("a\uFE00b"), "ab");
    assert.equal(cleanFreeText("a\u{E0100}b"), "ab");
    assert.equal(dedupeKey("pa\u200Dt@x.test"), "pat@x.test");
    const shop = createSeed();
    assert.equal(cleanFreeText("a\u200D b"), "a b");
    assert.equal(cleanFreeText("\u2764\uFE0F\u200D\u{1F525}"), "\u2764\uFE0F\u200D\u{1F525}");
    const found = lookupOnlineCustomer(shop.customers, shop.vehicles, "Hel\u200Den Cho");
    assert.equal(found.kind, "new");
    const byEmail = lookupOnlineCustomer(shop.customers, shop.vehicles, "pa\u200Dt@x.test");
    assert.equal(byEmail.kind, "new");
  });

  it("folds trunk zeros and unicode digits, and accepts an international customer phone", () => {
    const plain = phoneKey("+44 20 7946 0958");
    assert.equal(phoneKey("+44 0 20 7946 0958"), plain);
    assert.equal(phoneKey("+44 020 7946 0958"), plain);
    assert.equal(phoneKey("+44 00 20 7946 0958"), plain);
    assert.equal(phoneKey("+44 \u0662\u0660 7946 0958"), plain);
    assert.equal(phoneKey("+0 555 000 0000"), "");
    assert.equal(phoneKey("+1 555"), "");
    assert.equal(phoneKey("+1 000 000 0000"), "");
    assert.equal(phoneKey(`+44 ${"1".repeat(20)}`), "");
    const shop = createShopStore({ demoMode: true, storage: memoryStorage() });
    shop.getState().setWorkingAs("megan");
    const created = shop.getState().createCustomer({
      name: "Ana Ruiz",
      phone: "+44 20 7946 0958",
      email: "pa\u200Dt@x.test",
      year: 2020,
      make: "F".repeat(80),
      model: "Fiesta",
    });
    assert.equal(created.error ?? null, null, created.error ?? "");
    const customer = shop.getState().customers.find((row) => row.id === created.customerId);
    assert.equal(customer?.email, "pat@x.test");
    assert.ok((customer?.phone ?? "").includes("20"));
    const vehicle = shop.getState().vehicles.find((row) => row.id === created.vehicleId);
    assert.ok((vehicle?.make ?? "").length <= 40);
    const state = shop.getState();
    const first = submitOnlineRequest(state, {
      serviceId: state.settings.scheduling.onlineMenu[0].id,
      date: bookableDay(2),
      time: "09:00",
      advisorId: state.advisors[0].id,
      transportId: state.settings.scheduling.transportOptions[0].id,
      verified: false,
      customerName: "Pat Example",
      phone: "5095550199",
      email: "pa\u200Dt@x.test",
      year: 2020,
      make: "Ford",
      model: "Escape",
      plate: "PAT123",
      vin: fullVin({ prefix: "1FTAB12C", year: 2020, plant: "G", serial: 910 }),
    }, "rq-zwj", now().toISOString());
    assert.equal(first.ok, true, JSON.stringify(first));
    if (first.ok) assert.equal(first.request.email, "pat@x.test");
  });

  it("refuses the addAppointment cases that used to slip through", () => {
    const shop = createShopStore({ demoMode: true, storage: memoryStorage() });
    shop.getState().setWorkingAs("megan");
    const row = shop.getState().appointments.find((item) => item.status === "scheduled" && item.date >= todayIso());
    const other = shop.getState().customers.find((customer) => customer.id !== row?.customerId);
    const otherVehicle = shop.getState().vehicles.find((vehicle) => vehicle.customerId === other?.id);
    const op = shop.getState().laborOps[0];
    assert.ok(row && other && otherVehicle && op);
    const base = {
      date: bookableDay(),
      time: "11:30",
      minutes: 60,
      customerId: row.customerId,
      vehicleId: row.vehicleId,
      advisorId: row.advisorId,
      techId: row.techId,
      concern: "Oil",
      lines: [{ id: "a", code: "A", concern: "Oil" }],
      vin: "",
      laborOpIds: [] as string[],
      lane: "drop",
    };
    assert.equal(shop.getState().addAppointment({ ...base, bogus: 1 } as typeof base), "");
    assert.equal(shop.getState().addAppointment({ ...base, date: addDays(todayIso(), -3) }), "");
    assert.equal(shop.getState().addAppointment({ ...base, customerId: "nope" }), "");
    assert.equal(shop.getState().addAppointment({ ...base, vehicleId: otherVehicle.id }), "");
    assert.equal(shop.getState().addAppointment({ ...base, lane: "" }), "");
    assert.equal(shop.getState().addAppointment({ ...base, laborOpIds: [op.id, op.id] }), "");
    const saved = shop.getState().saveAdvisorAppointment({ ...base, customerId: "nope", status: "scheduled" });
    assert.equal(saved.ok, false);
    assert.notEqual(saved.error, "That appointment could not be saved.");
    const edited = shop.getState().updateAppointment(row.id, { lines: [{ id: "a", code: "A", concern: `Noise\u200B\u202E${"x".repeat(600)}` }] });
    assert.equal(edited.ok, true, edited.error ?? "");
    const stored = shop.getState().appointments.find((item) => item.id === row.id)?.lines[0]?.concern ?? "";
    assert.equal(stored.startsWith("Noisex"), true);
    assert.ok(stored.length <= 500);
    assert.match(changeLogLine({ at: now().toISOString(), who: "  ", whoId: "", field: "Appointment edited", before: "a", after: "Booked a visit" }), /^Unknown · /);
    const clamped = clampMileageForward([{ mileage: 1000 }, { mileage: 1000 }]);
    assert.ok(clamped[1].mileage > 1000);
    const state = shop.getState();
    const badVin = submitOnlineRequest(state, {
      serviceId: state.settings.scheduling.onlineMenu[0].id,
      date: bookableDay(),
      time: "10:00",
      advisorId: state.advisors[0].id,
      transportId: state.settings.scheduling.transportOptions[0].id,
      verified: false,
      customerName: "Vin Example",
      phone: "5095550188",
      email: "vin@x.test",
      year: 2020,
      make: "Ford",
      model: "F-150",
      plate: "ABC123",
      vin: 123 as unknown as string,
    }, "rq-vin", now().toISOString());
    assert.equal(badVin.ok, false);
    if (!badVin.ok) assert.equal(badVin.reason, "vin");
    const cleaned = submitOnlineRequest(state, {
      serviceId: state.settings.scheduling.onlineMenu[0].id,
      date: bookableDay(1),
      time: "10:30",
      advisorId: state.advisors[0].id,
      transportId: state.settings.scheduling.transportOptions[0].id,
      verified: false,
      customerName: "Clean Example",
      phone: "5095550188",
      email: "clean@x.test",
      year: 2020,
      make: "Ford\u202E",
      model: "F-150\u0000",
      plate: "ABC\u200B123",
      note: "Call me\u2066",
      vin: fullVin({ prefix: "1FTAB12C", year: 2020, plant: "G", serial: 911 }),
    }, "rq-clean", now().toISOString());
    assert.equal(cleaned.ok, true, JSON.stringify(cleaned));
    if (cleaned.ok) {
      assert.equal(cleaned.request.make, "Ford");
      assert.equal(cleaned.request.model, "F-150");
      assert.equal(cleaned.request.plate, "ABC123");
      assert.equal(cleaned.request.note, "Call me");
    }
  });
});
