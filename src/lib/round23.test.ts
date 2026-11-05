import "./test-dom.ts";
import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import { createElement } from "react";
import { flushSync } from "react-dom";
import { createRoot } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { AppointmentCalendar } from "../components/appointment-calendar.tsx";
import { AppointmentFields } from "../routes/schedule.tsx";
import { bookableDay } from "./bookable-day.ts";
import { addDays, now, resetClock, todayIso } from "./clock.ts";
import { phoneKey, submitOnlineRequest } from "./online-request.ts";
import type { ShopStorage } from "./shop-storage.ts";
import { createShopStore } from "./store.ts";
import type { Appointment } from "./types.ts";
import { fullVin } from "./vin.ts";

afterEach(() => resetClock());

function memoryStorage(): ShopStorage {
  const items = new Map<string, string>();
  return {
    getItem: (key) => items.get(key) ?? null,
    setItem: (key, value) => { items.set(key, value); },
    removeItem: (key) => { items.delete(key); },
  };
}

describe("round 23 phones, edits, and past visits", () => {
  it("stores the full phone key and does not merge people who share a 20-character prefix", () => {
    const padded = "+44 (0) 20 - 7946 - 0958";
    const other = "+44 (0) 20 - 7946 - 0999";
    assert.equal(phoneKey(padded), phoneKey("+44 20 7946 0958"));
    assert.notEqual(phoneKey(padded), phoneKey(other));
    assert.equal(phoneKey("+39 (0)6 6982 1234"), phoneKey("+39 06 6982 1234"));
    assert.equal(phoneKey("+7 8 495 123 45 67"), phoneKey("+7 495 123 45 67"));
    assert.notEqual(phoneKey("+379 06 698 12345"), "");
    assert.equal(phoneKey("+1 155 555 0100"), "");
    assert.equal(phoneKey("+1 509 055 0100"), "");
    assert.equal(phoneKey("+1 509 555 0100"), "5095550100");
    const shop = createShopStore({ demoMode: true, storage: memoryStorage() });
    const state = shop.getState();
    const submit = (phone: string, id: string) => submitOnlineRequest(state, {
      serviceId: state.settings.scheduling.onlineMenu[0].id,
      date: bookableDay(6),
      time: "09:00",
      advisorId: state.advisors[0].id,
      transportId: state.settings.scheduling.transportOptions[0].id,
      verified: false,
      customerName: id,
      phone,
      email: `${id}@x.test`,
      year: 2020,
      make: "Ford",
      model: "Escape",
      plate: "PAD123",
      vin: fullVin({ prefix: "1FTAB12C", year: 2020, plant: "G", serial: id === "alice" ? 21 : 22 }),
    }, id, now().toISOString());
    const alice = submit(padded, "alice");
    const bob = submit(other, "bob");
    assert.equal(alice.ok, true, JSON.stringify(alice));
    assert.equal(bob.ok, true, JSON.stringify(bob));
    if (alice.ok && bob.ok) {
      assert.equal(alice.request.phone, "+442079460958");
      assert.notEqual(alice.request.phone, bob.request.phone);
      assert.ok(alice.request.phone.length > 12);
    }
  });

  it("does not move a VIN when the edit is refused, and a past day can change status only", () => {
    const shop = createShopStore({ demoMode: true, storage: memoryStorage() });
    shop.getState().setWorkingAs("megan");
    const row = shop.getState().appointments.find((item) => item.status === "scheduled");
    const helen = shop.getState().customers.find((customer) => customer.name === "Helen Cho");
    const other = shop.getState().customers.find((customer) => customer.id !== row?.customerId);
    const helenVehicle = shop.getState().vehicles.find((vehicle) => vehicle.customerId === helen?.id);
    assert.ok(row && helen && other && helenVehicle);
    const ownerBefore = shop.getState().vehicles.find((vehicle) => vehicle.id === helenVehicle.id)?.customerId;
    const refused = shop.getState().saveAdvisorAppointment({
      date: row.date,
      time: row.time,
      minutes: row.minutes,
      customerId: other.id,
      vehicleId: row.vehicleId,
      advisorId: row.advisorId,
      techId: row.techId,
      concern: row.concern,
      lines: row.lines,
      vin: helenVehicle.vin,
      laborOpIds: row.laborOpIds,
      lane: row.lane,
      status: "cancelled",
    }, row.id, true, "Sold the truck to the new owner");
    assert.equal(refused.ok, false);
    assert.equal(shop.getState().vehicles.find((vehicle) => vehicle.id === helenVehicle.id)?.customerId, ownerBefore);
    const blank = shop.getState().addAppointment({ ...row, time: "", date: addDays(todayIso(), 1) });
    assert.equal(blank, "");
    assert.equal(shop.getState().addAppointment({ ...row, time: "09:15", date: addDays(todayIso(), 1) }), "");
    assert.equal(shop.getState().addAppointment({ ...row, time: "03:00", date: addDays(todayIso(), 1) }), "");
    assert.equal(shop.getState().addAppointment({ ...row, time: "09:00", minutes: -50, date: addDays(todayIso(), 1) }), "");
    assert.equal(shop.getState().addAppointment({ ...row, time: "09:00", minutes: 99999, date: addDays(todayIso(), 1) }), "");
    const pastDate = addDays(todayIso(), -2);
    shop.setState({
      appointments: shop.getState().appointments.map((item) => item.id === row.id ? { ...item, date: pastDate, time: "09:00" } : item),
    });
    const before = shop.getState().settingsLog?.length ?? 0;
    const status = shop.getState().setAppointmentStatus(row.id, "arrived");
    assert.equal(status.ok, true, status.error ?? "");
    assert.equal((shop.getState().settingsLog?.length ?? 0) - before, 1);
    assert.equal(shop.getState().vehicles.find((vehicle) => vehicle.id === helenVehicle.id)?.customerId, ownerBefore);
    const moved = shop.getState().updateAppointment(row.id, { time: "10:00" });
    assert.match(moved.error ?? "", /past/);
    assert.equal(shop.getState().appointments.find((item) => item.id === row.id)?.time, "09:00");
    assert.equal(shop.getState().appointments.find((item) => item.id === row.id)?.status, "arrived");
    const lines = shop.getState().updateAppointment(row.id, { lines: [] });
    assert.equal(lines.ok, false);
    assert.equal(shop.getState().settingsLog?.length ?? 0, before + 1);
  });
});

describe("round 23 past visit form and summary drag", () => {
  it("keeps every field but status read-only on a past visit", () => {
    const markup = renderToStaticMarkup(createElement(AppointmentFields, {
      initial: {
        date: "2026-10-01",
        time: "09:00",
        minutes: 60,
        customerId: "c",
        vehicleId: "v",
        advisorId: "megan",
        techId: "marcus",
        concern: "Oil",
        lines: [{ id: "a", code: "A", concern: "Oil" }],
        vin: "",
        laborOpIds: [],
        lane: "drop",
        status: "scheduled",
      },
      customers: [{ id: "c", name: "Pat" }],
      vehicles: [{ id: "v", customerId: "c", year: 2020, model: "Escape", vin: "1" }],
      advisors: [{ id: "megan", number: "1", name: "Megan" }],
      techs: [{ id: "marcus", number: "2", name: "Marcus" }],
      laborOps: [],
      transports: [{ id: "drop", name: "Drop-off" }],
      submitLabel: "Save changes",
      showStatus: true,
      onSubmit: () => null,
    }));
    assert.match(markup, /type="date" disabled=""/);
    assert.match(markup, /<select disabled="" class="field min-h-11[^"]*" aria-label="Visit length"/);
    assert.match(markup, /Status<select class="field"><option value="scheduled"/);
    assert.match(markup, /<option value="arrived">Showed<\/option>/);
    assert.match(markup, /<option value="no_show">No-show<\/option>/);
  });

  it("moves a card from the summary mark without opening details", () => {
    const moves: string[] = [];
    const selects: string[] = [];
    const day = "2026-11-02";
    const card = (id: string, time: string): Appointment => ({
      id, date: day, time, minutes: 30, customerId: "c", vehicleId: "v", advisorId: "megan",
      concern: id, lines: [{ id: `${id}-a`, code: "A", concern: id }], vin: "", laborOpIds: [],
      techId: "marcus", lane: "drop", status: "scheduled", orderId: null,
    });
    HTMLElement.prototype.setPointerCapture = () => undefined;
    const host = document.createElement("div");
    document.body.appendChild(host);
    const root = createRoot(host);
    flushSync(() => {
      root.render(createElement(AppointmentCalendar, {
        appointments: [card("upper", "09:00"), card("lower", "09:30")],
        day,
        techs: [{ id: "marcus", number: "1", name: "Marcus", board: "main" }],
        selectedId: null,
        onSelect: (id) => { selects.push(id); },
        onSlot: () => undefined,
        onMove: (id) => { moves.push(id); },
        onWrite: () => undefined,
        onEdit: () => undefined,
        label: (row) => row.id,
        summary: () => ({ name: "Pat", vehicle: "Ford", advisor: "Megan", tech: "Marcus", when: "9:00", lane: "Drop", concern: "Oil", vin: "", ops: "", status: "Scheduled", canWrite: false }),
        hoursFor: () => 1,
      }));
    });
    const button = document.querySelector("[data-appt-id='lower'] [aria-label='Appointment summary']");
    assert.ok(button instanceof HTMLElement);
    const upper = document.querySelector("[data-appt-id='upper']")?.getBoundingClientRect();
    const mark = button.getBoundingClientRect();
    assert.ok(upper);
    assert.equal(mark.top >= upper.bottom - 1 || mark.bottom <= upper.top + 1 || mark.left >= upper.right - 1, true);
    const pointer = window.PointerEvent;
    button.dispatchEvent(new pointer("pointerdown", { bubbles: true, clientX: 20, clientY: 20 }));
    window.dispatchEvent(new pointer("pointermove", { bubbles: true, clientX: 20, clientY: 80 }));
    window.dispatchEvent(new pointer("pointerup", { bubbles: true, clientX: 20, clientY: 80 }));
    assert.deepEqual(moves, ["lower"]);
    assert.deepEqual(selects, []);
    root.unmount();
    host.remove();
  });
});
