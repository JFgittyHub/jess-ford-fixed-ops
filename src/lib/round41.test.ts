import "./test-dom.ts";
import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import { createElement } from "react";
import { flushSync } from "react-dom";
import { createRoot } from "react-dom/client";
import { AppointmentFields } from "../routes/schedule.tsx";
import { PAST_CLOSE_MESSAGE } from "./capacity.ts";
import { pinClock, resetClock } from "./clock.ts";
import { prepareConcernLines } from "./labor-lines.ts";
import type { ShopStorage } from "./shop-storage.ts";
import { createShopStore } from "./store.ts";
import type { Appointment } from "./types.ts";

afterEach(() => resetClock());

const when = "2026-11-10T20:00:00.000Z";
const friday = "2026-11-13";
const saturday = "2026-11-14";
const sunday = "2026-11-15";

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

function party(store: ReturnType<typeof shop>) {
  const state = store.getState();
  const customer = state.customers[0];
  const vehicle = state.vehicles.find((row) => row.customerId === customer.id) ?? state.vehicles[0];
  const misc = state.laborOps.find((op) => op.opcode === "MISC");
  assert.ok(customer && vehicle && misc);
  return { customer, vehicle, misc };
}

function input(store: ReturnType<typeof shop>, patch: Partial<Appointment> = {}): Omit<Appointment, "id" | "orderId"> {
  const { customer, vehicle, misc } = party(store);
  return {
    date: friday,
    time: "09:00",
    minutes: 60,
    customerId: customer.id,
    vehicleId: vehicle.id,
    advisorId: "megan",
    techId: "marcus",
    concern: "Oil",
    lines: [{ id: "a", code: "A", concern: "Oil", laborOpId: misc.id, hours: 1 }],
    vin: vehicle.vin,
    laborOpIds: [misc.id],
    lane: "drop",
    status: "scheduled",
    ...patch,
  };
}

describe("round 24 override and advisor checks", () => {
  it("refuses a bad length override on update and still checks the role, the shop hours, and past close", () => {
    const store = shop();
    const saved = store.getState().saveAdvisorAppointment(input(store));
    assert.equal(saved.ok, true, saved.error ?? "");
    const id = saved.appointmentId;
    const before = store.getState().appointments.find((row) => row.id === id);
    for (const lengthOverrideMinutes of [Number.NaN, Number.POSITIVE_INFINITY, 6, 1440, -30]) {
      const refused = store.getState().updateAppointment(id, { lengthOverrideMinutes });
      assert.equal(refused.ok, false, `update stored ${lengthOverrideMinutes}`);
      assert.match(refused.error ?? "", /not on this desk/);
    }
    assert.equal(store.getState().appointments.find((row) => row.id === id)?.minutes, before?.minutes);
    store.getState().setWorkingAs("");
    const locked = store.getState().updateAppointment(id, { lengthOverrideMinutes: 90 });
    assert.match(locked.error ?? "", /working/);
    assert.equal(store.getState().appointments.find((row) => row.id === id)?.lengthOverrideMinutes ?? null, null);
    store.getState().setWorkingAs("megan");
    const outside = store.getState().updateAppointment(id, { time: "18:00", lengthOverrideMinutes: 60 });
    assert.match(outside.error ?? "", /outside shop hours/);
    const past = store.getState().updateAppointment(id, { time: "16:00", lengthOverrideMinutes: 120 });
    assert.match(past.error ?? "", /past closing/);
    assert.equal(store.getState().appointments.find((row) => row.id === id)?.minutes, 60);
    store.getState().setWorkingAs("derek");
    const approved = store.getState().updateAppointment(id, { time: "16:00", lengthOverrideMinutes: 120 }, "Customer is waiting on this");
    assert.equal(approved.ok, true, approved.error ?? "");
    const row = store.getState().appointments.find((item) => item.id === id);
    assert.equal(row?.minutes, 120);
    assert.equal(row?.lengthOverrideMinutes, 120);
    assert.equal(row?.lines[0]?.hours, 1);
  });

  it("refuses a bad override and an unknown or other-store advisor on add, and allows another advisor here", () => {
    const store = shop();
    const { status: _status, ...base } = input(store);
    const before = store.getState().appointments.length;
    for (const lengthOverrideMinutes of [Number.NaN, Number.POSITIVE_INFINITY, 6, 1440]) {
      const added = store.getState().addAppointment({ ...base, lengthOverrideMinutes });
      assert.equal(added, "", `add stored ${lengthOverrideMinutes}`);
    }
    assert.equal(store.getState().addAppointment({ ...base, advisorId: "pl-megan" }), "");
    assert.equal(store.getState().addAppointment({ ...base, advisorId: "nobody" }), "");
    assert.equal(store.getState().appointments.length, before);
    const other = store.getState().addAppointment({ ...base, advisorId: "derek", time: "10:00" });
    assert.notEqual(other, "");
    assert.equal(store.getState().appointments.find((row) => row.id === other)?.advisorId, "derek");
    const saved = store.getState().saveAdvisorAppointment({ ...base, advisorId: "derek", time: "10:30" });
    assert.equal(saved.ok, true, saved.error ?? "");
    assert.equal(store.getState().appointments.find((row) => row.id === saved.appointmentId)?.advisorId, "derek");
  });

  it("refuses a line total of 6 or 1440 minutes and keeps a past-close reason when a concern-only line is added", () => {
    const store = shop();
    const { misc } = party(store);
    const brake = store.getState().laborOps.find((op) => op.opcode === "BRKF");
    assert.ok(brake);
    const saved = store.getState().saveAdvisorAppointment(input(store, { time: "16:00" }));
    assert.equal(saved.ok, true, saved.error ?? "");
    const tiny = store.getState().updateAppointment(saved.appointmentId, {
      lines: [{ id: "a", code: "A", concern: "Short", laborOpId: brake.id, hours: 0.1 }],
    });
    assert.match(tiny.error ?? "", /not on this desk/);
    const huge = store.getState().updateAppointment(saved.appointmentId, {
      lines: [{ id: "a", code: "A", concern: "All day", laborOpId: brake.id, hours: 24 }],
    });
    assert.match(huge.error ?? "", /not on this desk/);
    const { status: _ignored, ...tinyBody } = input(store, {
      time: "11:00",
      lines: [{ id: "a", code: "A", concern: "Short", laborOpId: brake.id, hours: 0.1 }],
      laborOpIds: [brake.id],
    });
    const addedTiny = store.getState().addAppointment(tinyBody);
    assert.equal(addedTiny, "");
    assert.equal(store.getState().appointments.find((row) => row.id === saved.appointmentId)?.minutes, 60);
    const late = store.getState().updateAppointment(saved.appointmentId, {
      lines: [
        { id: "a", code: "A", concern: "Late", laborOpId: misc.id, hours: 3 },
        { id: "b", code: "B", concern: "Also look at the noise" },
      ],
    });
    assert.equal(late.ok, false);
    assert.match(late.error ?? "", new RegExp(PAST_CLOSE_MESSAGE.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
    assert.equal(store.getState().appointments.find((row) => row.id === saved.appointmentId)?.minutes, 60);
    assert.equal(store.getState().appointments.find((row) => row.id === saved.appointmentId)?.lines.length, 1);
    store.getState().setWorkingAs("derek");
    const approved = store.getState().updateAppointment(saved.appointmentId, {
      lines: [
        { id: "a", code: "A", concern: "Late", laborOpId: misc.id, hours: 3 },
        { id: "b", code: "B", concern: "Also look at the noise" },
      ],
    }, "Customer is waiting on this");
    assert.equal(approved.ok, true, approved.error ?? "");
    const row = store.getState().appointments.find((item) => item.id === saved.appointmentId);
    assert.equal(row?.minutes, 180);
    assert.equal(row?.lines[1]?.concern, "Also look at the noise");
    assert.equal(row?.lines[1]?.hours, undefined);
    const prepared = prepareConcernLines(
      [{ id: "a", code: "A", concern: "Bad", laborOpId: misc.id, hours: Number.NaN }],
      [],
      60,
      store.getState().laborOps,
    );
    assert.equal(prepared[0]?.hours, undefined);
    const kept = prepareConcernLines(
      [{ id: "a", code: "A", concern: "Bit", laborOpId: brake.id, hours: 0.1 }],
      [],
      60,
      store.getState().laborOps,
    );
    assert.equal(kept[0]?.hours, 0.1);
  });

  it("hides out-of-hours, Saturday 12:30, and Sunday times from an advisor", () => {
    const store = shop();
    const state = store.getState();
    const { customer, vehicle } = party(store);
    const host = document.createElement("div");
    document.body.appendChild(host);
    const root = createRoot(host);
    const render = (date: string, time: string) => {
      flushSync(() => {
        root.render(createElement(AppointmentFields, {
          key: `${date}-${time}`,
          initial: {
            date, time, minutes: 60, customerId: customer.id, vehicleId: vehicle.id,
            advisorId: "megan", techId: "marcus", concern: "Oil",
            lines: [{ id: "a", code: "A", concern: "Oil" }],
            vin: vehicle.vin, laborOpIds: [], lane: "drop", status: "scheduled",
          },
          customers: state.customers, vehicles: state.vehicles, advisors: state.advisors, techs: state.techs,
          laborOps: state.laborOps, transports: state.settings.scheduling.transportOptions,
          submitLabel: "Book it", scheduling: state.settings.scheduling, onSubmit: () => null,
        }));
      });
      return [...host.querySelectorAll<HTMLOptionElement>("select.field option")]
        .map((option) => option.value)
        .filter((value) => /^\d{2}:\d{2}$/.test(value));
    };
    const saturdayTimes = render(saturday, "12:30");
    assert.equal(saturdayTimes.includes("12:30"), false);
    assert.equal(saturdayTimes.includes("15:30"), false);
    assert.ok(saturdayTimes.includes("08:00"));
    const sundayTimes = render(sunday, "12:30");
    assert.equal(sundayTimes.length, 0);
    const fridayTimes = render(friday, "18:00");
    assert.equal(fridayTimes.includes("18:00"), false);
    assert.equal(fridayTimes.includes("07:00"), false);
    assert.ok(fridayTimes.includes("09:00"));
    flushSync(() => root.unmount());
    host.remove();
  });
});
