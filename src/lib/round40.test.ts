import "./test-dom.ts";
import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import { createElement } from "react";
import { flushSync } from "react-dom";
import { createRoot } from "react-dom/client";
import { AppointmentFields } from "../routes/schedule.tsx";
import { bookingAdvisorId } from "./booking.ts";
import { pinClock, resetClock } from "./clock.ts";
import { laborLineError, minutesFromLineHours, prepareConcernLines } from "./labor-lines.ts";
import { commitPaste, copiedFrom, pasteAppointmentInput } from "./paste-appointment.ts";
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
  assert.ok(misc);
  return { customer, vehicle, misc };
}

function book(store: ReturnType<typeof shop>, patch: Partial<Appointment> = {}) {
  const { customer, vehicle, misc } = party(store);
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
  });
}

function setControl(control: HTMLInputElement | HTMLSelectElement, value: string) {
  const proto = control instanceof HTMLSelectElement ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(proto, "value")?.set?.call(control, value);
  control.dispatchEvent(new Event("input", { bubbles: true }));
  control.dispatchEvent(new Event("change", { bubbles: true }));
}

describe("round 23 drag override and hour checks", () => {
  it("keeps a dragged block length and still carries the line hours through paste", () => {
    const store = shop();
    const { misc } = party(store);
    const saved = book(store, {
      time: "08:00",
      lines: [{ id: "a", code: "A", concern: "Long", laborOpId: misc.id, hours: 4.1 }],
    });
    assert.equal(saved.ok, true, saved.error ?? "");
    const row = store.getState().appointments.find((item) => item.id === saved.appointmentId);
    assert.ok(row);
    assert.equal(row.minutes, 246);
    assert.equal(row.lines[0]?.hours, 4.1);
    const dragged = store.getState().moveAppointment(row.id, { minutes: 240, time: "08:00" });
    assert.equal(dragged.ok, true, dragged.error ?? "");
    const after = store.getState().appointments.find((item) => item.id === row.id);
    assert.equal(after?.minutes, 240);
    assert.equal(after?.lengthOverrideMinutes, 240);
    assert.equal(after?.lines[0]?.hours, 4.1);
    const edited = store.getState().saveAdvisorAppointment({
      date: after!.date,
      time: after!.time,
      minutes: after!.minutes,
      lengthOverrideMinutes: 240,
      customerId: after!.customerId,
      vehicleId: after!.vehicleId,
      advisorId: after!.advisorId,
      techId: after!.techId,
      concern: "Long",
      lines: [
        { id: "a", code: "A", concern: "Long", laborOpId: misc.id, hours: 4.1 },
        { id: "b", code: "B", concern: "Also", laborOpId: misc.id, hours: 1 },
      ],
      vin: after!.vin,
      laborOpIds: [misc.id, misc.id],
      lane: after!.lane,
      status: after!.status,
    }, after!.id);
    assert.equal(edited.ok, true, edited.error ?? "");
    const kept = store.getState().appointments.find((item) => item.id === row.id);
    assert.equal(kept?.minutes, 240);
    assert.equal(kept?.lengthOverrideMinutes, 240);
    assert.deepEqual(kept?.lines.map((line) => line.hours), [4.1, 1]);
    const copy = copiedFrom(kept!);
    assert.equal(copy.minutes, 240);
    assert.equal(copy.lengthOverrideMinutes, 240);
    assert.equal(copy.lines[0]?.hours, 4.1);
    const slot = pasteAppointmentInput(copy, { date: friday, time: "13:00", techId: "elena" });
    const asked = commitPaste(store, slot);
    const pasted = asked.needsOverride ? commitPaste(store, slot, { confirmOverride: true }) : asked;
    assert.equal(pasted.ok, true, pasted.error ?? "");
    const clone = store.getState().appointments.find((item) => item.id === pasted.appointmentId);
    assert.equal(clone?.minutes, 240);
    assert.equal(clone?.lengthOverrideMinutes, 240);
    assert.equal(clone?.lines[0]?.hours, 4.1);
    assert.equal(clone?.lines[1]?.hours, 1);
  });

  it("uses the dragged length for the overload warning and for a past-close reason", () => {
    const store = shop();
    const { misc } = party(store);
    const first = book(store, {
      time: "08:00",
      lines: [{ id: "a", code: "A", concern: "Fill", laborOpId: misc.id, hours: 6 }],
    });
    assert.equal(first.ok, true, first.error ?? "");
    const second = book(store, {
      time: "11:00",
      lines: [{ id: "a", code: "A", concern: "Short", laborOpId: misc.id, hours: 1 }],
    });
    assert.equal(second.ok, true, second.error ?? "");
    const warned = store.getState().moveAppointment(second.appointmentId, { time: "11:00", minutes: 360 });
    assert.equal(warned.needsOverride, true);
    assert.match(warned.warning ?? "", /overload/);
    assert.equal(store.getState().appointments.find((item) => item.id === second.appointmentId)?.minutes, 60);
    const late = book(store, {
      time: "16:00",
      lines: [{ id: "a", code: "A", concern: "Fit", laborOpId: misc.id, hours: 1 }],
    });
    assert.equal(late.ok, true, late.error ?? "");
    const past = store.getState().moveAppointment(late.appointmentId, { time: "16:00", minutes: 120 });
    assert.match(past.error ?? "", /past closing/);
    assert.equal(store.getState().appointments.find((item) => item.id === late.appointmentId)?.lines[0]?.hours, 1);
    assert.equal(store.getState().appointments.find((item) => item.id === late.appointmentId)?.minutes, 60);
  });

  it("rejects illegal hours on save, add, and update and stores 1.333 as 1.3", () => {
    const store = shop();
    const { customer, vehicle, misc } = party(store);
    const brake = store.getState().laborOps.find((op) => op.opcode === "BRKF");
    assert.ok(brake);
    const before = store.getState().appointments.length;
    for (const hours of [0, -1, -8.5, Number.NEGATIVE_INFINITY, Number.NaN, 100]) {
      const saved = book(store, { lines: [{ id: "a", code: "A", concern: "Bad", laborOpId: brake.id, hours }] });
      assert.equal(saved.ok, false, `save accepted ${hours}`);
      assert.equal(store.getState().appointments.length, before, `save wrote ${hours}`);
    }
    const miscLow = book(store, { lines: [{ id: "a", code: "A", concern: "Bad", laborOpId: misc.id, hours: 0 }] });
    assert.match(miscLow.error ?? "", /1\.0/);
    const rounded = book(store, { lines: [{ id: "a", code: "A", concern: "Thirds", laborOpId: brake.id, hours: 1.333 }] });
    assert.equal(rounded.ok, true, rounded.error ?? "");
    const row = store.getState().appointments.find((item) => item.id === rounded.appointmentId);
    assert.equal(row?.lines[0]?.hours, 1.3);
    assert.equal(row?.minutes, 78);
    const added = store.getState().addAppointment({
      date: friday,
      time: "10:00",
      minutes: 60,
      customerId: customer.id,
      vehicleId: vehicle.id,
      advisorId: "megan",
      concern: "NaN",
      lines: [{ id: "a", code: "A", concern: "NaN", laborOpId: misc.id, hours: Number.NaN }],
      vin: vehicle.vin,
      laborOpIds: [misc.id],
      techId: "marcus",
      lane: "drop",
    });
    assert.equal(added, "");
    const count = store.getState().appointments.length;
    const updated = store.getState().updateAppointment(row!.id, {
      lines: [{ id: "a", code: "A", concern: "Thirds", laborOpId: misc.id, hours: 0.2 }],
    });
    assert.match(updated.error ?? "", /1\.0/);
    const nan = store.getState().updateAppointment(row!.id, {
      lines: [{ id: "a", code: "A", concern: "Thirds", laborOpId: misc.id, hours: Number.NaN }],
    });
    assert.match(nan.error ?? "", /labor hour/);
    assert.equal(store.getState().appointments.length, count);
    assert.equal(store.getState().appointments.find((item) => item.id === row!.id)?.lines[0]?.hours, 1.3);
    const prepared = prepareConcernLines(
      [{ id: "a", code: "A", concern: "Bad", laborOpId: misc.id, hours: Number.NaN }],
      [],
      60,
      store.getState().laborOps,
    );
    assert.equal(Number.isNaN(prepared[0]?.hours), true);
    assert.match(laborLineError([{ laborOpId: misc.id, hours: Number.NaN }], store.getState().laborOps) ?? "", /labor hour/);
    assert.equal(minutesFromLineHours([{ hours: 4.1 }]), 246);
  });

  it("judges addAppointment from the line length before past close, for 16:00 and 16:30", () => {
    const store = shop();
    const { customer, vehicle, misc } = party(store);
    const before = store.getState().appointments.length;
    for (const time of ["16:00", "16:30"]) {
      const added = store.getState().addAppointment({
        date: friday,
        time,
        minutes: 30,
        customerId: customer.id,
        vehicleId: vehicle.id,
        advisorId: "megan",
        concern: "Late",
        lines: [{ id: "a", code: "A", concern: "Late", laborOpId: misc.id, hours: 3 }],
        vin: vehicle.vin,
        laborOpIds: [misc.id],
        techId: "marcus",
        lane: "drop",
      }, undefined, "Customer is waiting");
      assert.equal(added, "", `${time} was stored from the 30 minute field`);
    }
    assert.equal(store.getState().appointments.length, before);
    store.getState().setWorkingAs("derek");
    const approved = store.getState().addAppointment({
      date: friday,
      time: "16:00",
      minutes: 30,
      customerId: customer.id,
      vehicleId: vehicle.id,
      advisorId: "megan",
      concern: "Late",
      lines: [{ id: "a", code: "A", concern: "Late", laborOpId: misc.id, hours: 3 }],
      vin: vehicle.vin,
      laborOpIds: [misc.id],
      techId: "elena",
      lane: "drop",
    }, undefined, "Customer is waiting on this");
    assert.notEqual(approved, "");
    const row = store.getState().appointments.find((item) => item.id === approved);
    assert.equal(row?.minutes, 180);
    assert.equal(row?.lines[0]?.hours, 3);
  });

  it("opens Book on the Working-as advisor and requires one when nobody is", () => {
    assert.equal(bookingAdvisorId("megan", [{ id: "megan" }, { id: "derek" }]), "megan");
    assert.equal(bookingAdvisorId("marcus", [{ id: "megan" }]), "");
    assert.equal(bookingAdvisorId("", [{ id: "megan" }]), "");
    const store = shop();
    const state = store.getState();
    const { customer, vehicle } = party(store);
    const host = document.createElement("div");
    document.body.appendChild(host);
    const root = createRoot(host);
    let submitted = 0;
    flushSync(() => {
      root.render(createElement(AppointmentFields, {
        initial: {
          date: friday, time: "09:00", minutes: 60, customerId: customer.id, vehicleId: vehicle.id,
          advisorId: "", techId: "marcus", concern: "", lines: [], vin: vehicle.vin, laborOpIds: [], lane: "drop", status: "scheduled",
        },
        customers: state.customers, vehicles: state.vehicles, advisors: state.advisors, techs: state.techs,
        laborOps: state.laborOps, transports: state.settings.scheduling.transportOptions, submitLabel: "Book it",
        onSubmit: () => { submitted += 1; return null; },
      }));
    });
    const advisor = host.querySelector<HTMLSelectElement>("[aria-label='Advisor']");
    assert.equal(advisor?.value, "");
    assert.match(advisor?.textContent ?? "", /Choose an advisor/);
    flushSync(() => host.querySelector("form")?.requestSubmit());
    assert.match(host.textContent ?? "", /Choose an advisor/);
    assert.equal(submitted, 0);
    flushSync(() => root.unmount());
    host.remove();
  });

  it("keeps typed hours when the labor op changes and uses book time only on a fresh line", () => {
    const store = shop();
    const state = store.getState();
    const { customer, vehicle } = party(store);
    const brake = state.laborOps.find((op) => op.opcode === "BRKF");
    const misc = state.laborOps.find((op) => op.opcode === "MISC");
    assert.ok(brake && misc);
    const host = document.createElement("div");
    document.body.appendChild(host);
    const root = createRoot(host);
    flushSync(() => {
      root.render(createElement(AppointmentFields, {
        initial: {
          date: friday, time: "09:00", minutes: 60, customerId: customer.id, vehicleId: vehicle.id,
          advisorId: "megan", techId: "marcus", concern: "", lines: [], vin: vehicle.vin, laborOpIds: [], lane: "drop", status: "scheduled",
        },
        customers: state.customers, vehicles: state.vehicles, advisors: state.advisors, techs: state.techs,
        laborOps: state.laborOps, transports: state.settings.scheduling.transportOptions, submitLabel: "Book it",
        onSubmit: () => null,
      }));
    });
    const hours = host.querySelector<HTMLInputElement>("[aria-label='Hours for line A']");
    const op = host.querySelector<HTMLSelectElement>("[aria-label='Labor op for line A']");
    assert.ok(hours && op);
    flushSync(() => setControl(hours, "2.5"));
    flushSync(() => setControl(op, brake.id));
    assert.equal(host.querySelector<HTMLInputElement>("[aria-label='Hours for line A']")?.value, "2.5");
    flushSync(() => setControl(host.querySelector<HTMLSelectElement>("[aria-label='Labor op for line A']")!, misc.id));
    assert.equal(host.querySelector<HTMLInputElement>("[aria-label='Hours for line A']")?.value, "2.5");
    const add = [...host.querySelectorAll("button")].find((button) => button.textContent === "Add line");
    assert.ok(add);
    flushSync(() => add.click());
    const fresh = host.querySelector<HTMLSelectElement>("[aria-label='Labor op for line B']");
    assert.equal(host.querySelector<HTMLInputElement>("[aria-label='Hours for line B']")?.value, "1");
    flushSync(() => setControl(fresh!, brake.id));
    assert.equal(host.querySelector<HTMLInputElement>("[aria-label='Hours for line B']")?.value, "2.3");
    flushSync(() => root.unmount());
    host.remove();
  });

  it("offers a manager only the open hours, and still refuses a time outside them", () => {
    const store = shop("derek");
    const state = store.getState();
    const { customer, vehicle } = party(store);
    const host = document.createElement("div");
    document.body.appendChild(host);
    const root = createRoot(host);
    const render = (date: string) => {
      flushSync(() => {
        root.render(createElement(AppointmentFields, {
          key: date,
          initial: {
            date, time: "15:30", minutes: 60, customerId: customer.id, vehicleId: vehicle.id,
            advisorId: "derek", techId: "marcus", concern: "Oil", lines: [{ id: "a", code: "A", concern: "Oil" }],
            vin: vehicle.vin, laborOpIds: [], lane: "drop", status: "scheduled",
          },
          customers: state.customers, vehicles: state.vehicles, advisors: state.advisors, techs: state.techs,
          laborOps: state.laborOps, transports: state.settings.scheduling.transportOptions, submitLabel: "Book it",
          manager: true, scheduling: state.settings.scheduling,
          onSubmit: (value) => {
            const result = store.getState().saveAdvisorAppointment(value);
            return result.ok ? null : result.error;
          },
        }));
      });
    };
    render(saturday);
    const saturdayTimes = [...host.querySelectorAll<HTMLOptionElement>("select.field option")].map((option) => option.value).filter((value) => /^\d{2}:\d{2}$/.test(value));
    assert.ok(saturdayTimes.includes("08:00"));
    assert.ok(saturdayTimes.includes("12:30"));
    assert.equal(saturdayTimes.includes("13:00"), false);
    assert.equal(saturdayTimes.includes("15:30"), false);
    assert.equal(saturdayTimes.includes("17:30"), false);
    render(sunday);
    const sundayTimes = [...host.querySelectorAll<HTMLOptionElement>("select.field option")].map((option) => option.value);
    assert.equal(sundayTimes.includes("12:30"), false);
    assert.equal(sundayTimes.filter((value) => /^\d{2}:\d{2}$/.test(value)).length, 0);
    const refused = store.getState().saveAdvisorAppointment({
      date: saturday, time: "15:30", minutes: 60, customerId: customer.id, vehicleId: vehicle.id,
      advisorId: "derek", techId: "marcus", concern: "Oil", lines: [{ id: "a", code: "A", concern: "Oil" }],
      vin: vehicle.vin, laborOpIds: [], lane: "drop", status: "scheduled",
    });
    assert.match(refused.error ?? "", /outside shop hours/);
    flushSync(() => root.unmount());
    host.remove();
  });

  it("shows the line total beside a dragged block length", () => {
    const store = shop();
    const state = store.getState();
    const { customer, vehicle, misc } = party(store);
    const host = document.createElement("div");
    document.body.appendChild(host);
    const root = createRoot(host);
    flushSync(() => {
      root.render(createElement(AppointmentFields, {
        initial: {
          date: friday, time: "08:00", minutes: 240, lengthOverrideMinutes: 240,
          customerId: customer.id, vehicleId: vehicle.id, advisorId: "megan", techId: "marcus",
          concern: "Long", lines: [{ id: "a", code: "A", concern: "Long", laborOpId: misc.id, hours: 4.1 }],
          vin: vehicle.vin, laborOpIds: [misc.id], lane: "drop", status: "scheduled",
        },
        customers: state.customers, vehicles: state.vehicles, advisors: state.advisors, techs: state.techs,
        laborOps: state.laborOps, transports: state.settings.scheduling.transportOptions, submitLabel: "Save",
        onSubmit: () => null,
      }));
    });
    assert.match(host.querySelector("[data-length-compare]")?.textContent ?? "", /4\.1/);
    assert.match(host.querySelector("[data-length-compare]")?.textContent ?? "", /4 hr/);
    assert.equal(host.querySelector<HTMLInputElement>("[aria-label='Hours for line A']")?.value, "4.1");
    assert.equal(host.querySelector<HTMLSelectElement>("[aria-label='Visit length']")?.value, "240");
    flushSync(() => root.unmount());
    host.remove();
  });
});
