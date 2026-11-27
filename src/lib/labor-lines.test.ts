import "./test-dom.ts";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { afterEach, describe, it } from "node:test";
import { createElement } from "react";
import { flushSync } from "react-dom";
import { createRoot } from "react-dom/client";
import { CopyBar, AppointmentFields } from "../routes/schedule.tsx";
import { advisorBookingNote, advisorDayCapacity, assessAppointment } from "./capacity.ts";
import { pinClock, resetClock } from "./clock.ts";
import { clampLaborHours, laborLineError, minutesFromLineHours, MISC_MIN_HOURS } from "./labor-lines.ts";
import { commitPaste, copiedFrom, pasteAppointmentInput } from "./paste-appointment.ts";
import type { ShopStorage } from "./shop-storage.ts";
import { createShopStore } from "./store.ts";
import type { Appointment } from "./types.ts";

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

function book(store: ReturnType<typeof shop>, patch: Partial<Appointment> = {}, closeReason?: string) {
  const state = store.getState();
  const customer = state.customers[0];
  const vehicle = state.vehicles.find((row) => row.customerId === customer.id) ?? state.vehicles[0];
  const misc = state.laborOps.find((op) => op.opcode === "MISC");
  assert.ok(misc);
  return store.getState().saveAdvisorAppointment({
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
  }, undefined, undefined, undefined, closeReason);
}

function setControl(control: HTMLInputElement | HTMLSelectElement, value: string) {
  const proto = control instanceof HTMLSelectElement ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(proto, "value")?.set?.call(control, value);
  control.dispatchEvent(new Event("input", { bubbles: true }));
  control.dispatchEvent(new Event("change", { bubbles: true }));
}

describe("labor ops on each concern line", () => {
  it("keeps Misc at 1.0 hr and turns line hours into the visit length", () => {
    assert.equal(clampLaborHours("MISC", 0.4), MISC_MIN_HOURS);
    assert.equal(clampLaborHours("BRKF", 0.04), 0.1);
    assert.equal(minutesFromLineHours([{ hours: 1 }, { hours: 2.3 }]), 198);
    assert.equal(minutesFromLineHours([{ hours: 4.1 }]), 246);
    assert.equal(minutesFromLineHours([{ hours: 1 }, {}]), 60);
    const store = shop();
    const misc = store.getState().laborOps.find((op) => op.opcode === "MISC");
    const brake = store.getState().laborOps.find((op) => op.opcode === "BRKF");
    assert.ok(misc && brake);
    assert.match(laborLineError([{ laborOpId: misc.id, hours: 0.5 }], store.getState().laborOps) ?? "", /at least 1\.0/);
    const low = book(store, { lines: [{ id: "a", code: "A", concern: "Oil", laborOpId: misc.id, hours: 0.5 }] });
    assert.match(low.error ?? "", /at least 1\.0/);
    const both = book(store, {
      lines: [
        { id: "a", code: "A", concern: "Noise", laborOpId: brake.id, hours: 2.3 },
        { id: "b", code: "B", concern: "Also", laborOpId: misc.id, hours: 1 },
      ],
    });
    assert.equal(both.ok, true, both.error ?? "");
    const row = store.getState().appointments.find((item) => item.id === both.appointmentId);
    assert.equal(row?.minutes, 210);
    assert.deepEqual(row?.lines.map((line) => line.hours), [2.3, 1]);
    assert.equal(row?.laborOpIds.length, 2);
  });

  it("refuses a line total that runs past close or starts outside shop hours", () => {
    const store = shop();
    const misc = store.getState().laborOps.find((op) => op.opcode === "MISC");
    assert.ok(misc);
    const late = book(store, {
      time: "16:00",
      lines: [{ id: "a", code: "A", concern: "Late", laborOpId: misc.id, hours: 2 }],
    });
    assert.equal(late.ok, false);
    assert.match(late.error ?? "", /This visit runs past closing \(5:30 PM\)/);
    const outside = book(store, {
      time: "18:00",
      lines: [{ id: "a", code: "A", concern: "After", laborOpId: misc.id, hours: 1 }],
    });
    assert.match(outside.error ?? "", /outside shop hours/);
    store.getState().setWorkingAs("derek");
    const approved = book(store, {
      time: "16:00",
      lines: [{ id: "a", code: "A", concern: "Late", laborOpId: misc.id, hours: 2 }],
    });
    assert.equal(approved.ok, false);
    assert.equal(approved.needsCloseReason, true);
    const withReason = book(store, {
      time: "16:00",
      lines: [{ id: "a", code: "A", concern: "Late", laborOpId: misc.id, hours: 2 }],
    }, "Customer is waiting on this");
    assert.equal(withReason.ok, true, withReason.error ?? "");
    assert.equal(store.getState().appointments.find((item) => item.id === withReason.appointmentId)?.minutes, 120);
  });

  it("warns when the line-hour total overloads the technician and keeps that warning on Paste", () => {
    const store = shop();
    const state = store.getState();
    const misc = state.laborOps.find((op) => op.opcode === "MISC");
    assert.ok(misc);
    const heavy = book(store, {
      time: "08:00",
      lines: [{ id: "a", code: "A", concern: "Long", laborOpId: misc.id, hours: 6 }],
    });
    assert.equal(heavy.ok, true, heavy.error ?? "");
    const row = store.getState().appointments.find((item) => item.id === heavy.appointmentId);
    assert.ok(row);
    assert.equal(row.minutes, 360);
    const judged = assessAppointment({
      scheduling: state.settings.scheduling,
      advisors: state.advisors,
      techs: state.techs,
      appointments: store.getState().appointments,
      laborOps: state.laborOps,
      proposal: { date: friday, time: "11:00", minutes: 360, advisorId: "megan", techId: "marcus", laborOpIds: [misc.id], laborHours: 6 },
    });
    assert.match(advisorBookingNote(judged) ?? "", /overload technician hours/);
    const copy = copiedFrom(row);
    assert.equal(copy.lines[0]?.hours, 6);
    assert.equal(copy.lines[0]?.laborOpId, misc.id);
    assert.equal(copy.minutes, 360);
    const pasted = commitPaste(store, pasteAppointmentInput(copy, { date: friday, time: "11:00", techId: "marcus" }));
    assert.equal(pasted.needsOverride, true);
    assert.match(pasted.warning ?? "", /overload/);
    assert.equal(store.getState().appointments.filter((item) => item.time === "11:00" && item.techId === "marcus").length, 0);
    const host = document.createElement("div");
    document.body.appendChild(host);
    const root = createRoot(host);
    flushSync(() => {
      root.render(createElement(CopyBar, {
        copiedName: "Helen",
        notice: { kind: "override", techId: "marcus", time: "11:00", warning: pasted.warning ?? "" },
        onOverride: () => undefined,
        onReason: () => undefined,
        onDismiss: () => undefined,
      }));
    });
    assert.match(host.textContent ?? "", /overload/);
    assert.match(host.textContent ?? "", /Paste anyway/);
    flushSync(() => root.unmount());
    host.remove();
  });

  it("stops a paste once the advisor is full and shows the capacity notice", () => {
    const store = shop();
    const state = store.getState();
    const cap = advisorDayCapacity(state.settings.scheduling, friday);
    const customer = state.customers[0];
    const vehicle = state.vehicles.find((row) => row.customerId === customer.id) ?? state.vehicles[0];
    const times = ["08:00", "08:30", "09:00", "09:30", "10:00", "10:30", "11:00", "11:30", "12:00", "12:30", "13:00", "13:30"];
    let guard = 0;
    while (store.getState().appointments.filter((row) => row.date === friday && row.advisorId === "megan" && row.status !== "cancelled" && row.status !== "no_show").length < cap) {
      const time = times[guard];
      assert.ok(time, "ran out of filler times");
      const saved = store.getState().saveAdvisorAppointment({
        date: friday,
        time,
        minutes: 30,
        customerId: customer.id,
        vehicleId: vehicle.id,
        advisorId: "megan",
        techId: "elena",
        concern: `Fill ${time}`,
        lines: [{ id: time, code: "A", concern: `Fill ${time}` }],
        vin: vehicle.vin,
        laborOpIds: [],
        lane: "drop",
        status: "scheduled",
      });
      assert.equal(saved.ok, true, saved.error ?? time);
      guard += 1;
    }
    const seed = store.getState().appointments.find((row) => row.lines.some((line) => line.laborOpId));
    const source = seed ?? store.getState().appointments.find((row) => row.date === friday);
    assert.ok(source);
    const before = store.getState().appointments.length;
    const stopped = commitPaste(store, pasteAppointmentInput(copiedFrom(source), { date: friday, time: "14:00", techId: "marcus" }));
    assert.equal(stopped.ok, false);
    assert.equal(stopped.needsOverride, true);
    assert.match(stopped.warning ?? "", /advisor capacity/);
    assert.equal(store.getState().appointments.length, before);
  });

  it("starts a new line on Misc at 1.0 hr and recomputes the length from the lines", () => {
    const store = shop();
    const state = store.getState();
    const customer = state.customers[0];
    const vehicle = state.vehicles.find((row) => row.customerId === customer.id) ?? state.vehicles[0];
    const host = document.createElement("div");
    document.body.appendChild(host);
    const root = createRoot(host);
    flushSync(() => {
      root.render(createElement(AppointmentFields, {
        initial: {
          date: friday,
          time: "09:00",
          minutes: 60,
          customerId: customer.id,
          vehicleId: vehicle.id,
          advisorId: "megan",
          techId: "marcus",
          concern: "",
          lines: [],
          vin: vehicle.vin,
          laborOpIds: [],
          lane: "drop",
          status: "scheduled",
        },
        customers: state.customers,
        vehicles: state.vehicles,
        advisors: state.advisors,
        techs: state.techs,
        laborOps: state.laborOps,
        transports: state.settings.scheduling.transportOptions,
        submitLabel: "Book it",
        scheduling: state.settings.scheduling,
        onSubmit: () => null,
      }));
    });
    assert.match(host.textContent ?? "", /Demo labor ops/);
    assert.match(host.textContent ?? "", /Dealertrack \(Opentrack\)/);
    const op = host.querySelector<HTMLSelectElement>("[aria-label='Labor op for line A']");
    const hours = host.querySelector<HTMLInputElement>("[aria-label='Hours for line A']");
    const length = host.querySelector<HTMLSelectElement>("[aria-label='Visit length']");
    assert.ok(op && hours && length);
    assert.equal(op.value, state.laborOps.find((row) => row.opcode === "MISC")?.id);
    assert.equal(hours.value, "1");
    assert.equal(length.value, "60");
    assert.equal(length.disabled, true);
    const brake = state.laborOps.find((row) => row.opcode === "BRKF");
    assert.ok(brake);
    flushSync(() => setControl(op, brake.id));
    assert.equal(hours.value, "2.3");
    assert.equal(length.value, "150");
    const add = [...host.querySelectorAll("button")].find((button) => button.textContent === "Add line");
    assert.ok(add);
    flushSync(() => add.click());
    const lineB = host.querySelector<HTMLInputElement>("[aria-label='Hours for line B']");
    assert.equal(lineB?.value, "1");
    flushSync(() => setControl(lineB!, "0.5"));
    assert.equal(lineB?.value, "1");
    assert.match(host.textContent ?? "", /at least 1\.0 hr/);
    assert.equal(length.value, "210");
    const removes = [...host.querySelectorAll("button")].filter((button) => button.textContent === "Remove");
    assert.ok(removes.length > 1);
    flushSync(() => removes[removes.length - 1].click());
    assert.equal(host.querySelector("[aria-label='Hours for line B']"), null);
    assert.equal(length.value, "150");
    flushSync(() => root.unmount());
    host.remove();
  });

  it("leaves the customer request page without a labor-op list", () => {
    const source = readFileSync(new URL("../routes/request.tsx", import.meta.url), "utf8");
    assert.equal(source.includes("Demo labor ops"), false);
    assert.equal(source.includes("data-demo-labor"), false);
    assert.equal(source.includes("Labor op for line"), false);
    assert.equal(source.includes("laborOpId"), false);
    assert.equal(source.includes("MISC"), false);
  });
});
