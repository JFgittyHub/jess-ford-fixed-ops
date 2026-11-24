import "./test-dom.ts";
import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import { pastCloseMessage, visitTimeError } from "./capacity.ts";
import { pinClock, resetClock } from "./clock.ts";
import type { ShopStorage } from "./shop-storage.ts";
import { createShopStore } from "./store.ts";
import type { Appointment } from "./types.ts";
import { fullVin } from "./vin.ts";

afterEach(() => resetClock());

const when = "2026-11-10T20:00:00.000Z";
const friday = "2026-11-13";

function memoryStorage(): ShopStorage {
  const items = new Map<string, string>();
  return {
    getItem: (key) => items.get(key) ?? null,
    setItem: (key, value) => { items.set(key, value); },
    removeItem: (key) => { items.delete(key); },
  };
}

function shop(who = "megan") {
  pinClock(when);
  const store = createShopStore({ demoMode: true, storage: memoryStorage() });
  store.getState().setWorkingAs(who);
  return store;
}

function body(store: ReturnType<typeof shop>, patch: Partial<Appointment> = {}): Omit<Appointment, "id" | "orderId"> {
  const state = store.getState();
  const customer = state.customers[0];
  const vehicle = state.vehicles.find((row) => row.customerId === customer.id) ?? state.vehicles[0];
  const misc = state.laborOps.find((op) => op.opcode === "MISC");
  assert.ok(customer && vehicle && misc);
  return {
    date: friday,
    time: "08:00",
    minutes: 60,
    customerId: customer.id,
    vehicleId: vehicle.id,
    advisorId: "megan",
    techId: "elena",
    concern: "Oil",
    lines: [{ id: "a", code: "A", concern: "Oil", laborOpId: misc.id, hours: 1 }],
    vin: vehicle.vin,
    laborOpIds: [misc.id],
    lane: "drop",
    status: "scheduled",
    ...patch,
  };
}

describe("round 27 new customer capacity and closing time", () => {
  it("asks before a new customer overloads the technician and then writes one audit row", () => {
    const store = shop();
    const misc = store.getState().laborOps.find((op) => op.opcode === "MISC");
    assert.ok(misc);
    const fill = store.getState().saveAdvisorAppointment(body(store, {
      lines: [{ id: "a", code: "A", concern: "Fill", laborOpId: misc.id, hours: 6 }],
      minutes: 360,
    }));
    assert.equal(fill.ok, true, fill.error ?? "");
    const input = {
      name: "Rita Gomez",
      phone: "5095550199",
      email: "",
      year: 2021,
      make: "Ford",
      model: "Escape",
      vin: fullVin({ prefix: "1FTAB12C", year: 2021, plant: "G", serial: 2626 }),
      plate: "RITA9",
      date: friday,
      time: "08:00",
      minutes: 300,
      advisorId: "megan",
      techId: "elena",
      lane: "drop",
      concern: "Five hours",
      lines: [{ id: "n", code: "A", concern: "Five hours", laborOpId: misc.id, hours: 5 }],
      laborOpIds: [misc.id],
    };
    const before = {
      customers: store.getState().customers.length,
      appointments: store.getState().appointments.length,
      overrides: store.getState().overrides.length,
    };
    const asked = store.getState().saveNewCustomerAppointment(input);
    assert.equal(asked.ok, false);
    assert.equal(asked.needsOverride, true);
    assert.match(asked.warning ?? "", /would have|hours/i);
    assert.equal(store.getState().customers.length, before.customers);
    assert.equal(store.getState().appointments.length, before.appointments);
    assert.equal(store.getState().overrides.length, before.overrides);
    const saved = store.getState().saveNewCustomerAppointment(input, undefined, undefined, undefined, true);
    assert.equal(saved.ok, true, saved.error ?? "");
    const rows = store.getState().overrides.filter((row) => row.appointmentId === saved.appointmentId && row.reason === "tech-hours");
    assert.equal(rows.length, 1);
    assert.equal(saved.overrideId, rows[0]?.id);
    assert.equal(store.getState().appointments.find((row) => row.id === saved.appointmentId)?.minutes, 300);
  });

  it("names the closing time when a visit starts in hours and runs past close", () => {
    const store = shop();
    const scheduling = store.getState().settings.scheduling;
    assert.match(visitTimeError(scheduling, friday, "18:00") ?? "", /outside shop hours/);
    assert.equal(pastCloseMessage(scheduling, friday), "This visit runs past closing (5:30 PM). A service manager can approve it.");
    assert.equal(pastCloseMessage(scheduling, "2026-11-14"), "This visit runs past closing (1:00 PM). A service manager can approve it.");
    const late = store.getState().saveAdvisorAppointment(body(store, { time: "16:00", minutes: 120, lines: [{ id: "a", code: "A", concern: "Late" }], laborOpIds: [] }));
    assert.match(late.error ?? "", /This visit runs past closing \(5:30 PM\)/);
    const outside = store.getState().saveAdvisorAppointment(body(store, { time: "18:00", minutes: 60, lines: [{ id: "a", code: "A", concern: "After" }], laborOpIds: [] }));
    assert.match(outside.error ?? "", /outside shop hours/);
    assert.equal((outside.error ?? "").includes("runs past closing"), false);
  });
});
