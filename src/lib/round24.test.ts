import "./test-dom.ts";
import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import { createElement } from "react";
import { flushSync } from "react-dom";
import { createRoot } from "react-dom/client";
import { AppointmentFields } from "../routes/schedule.tsx";
import { clockTime } from "./format.ts";
import { filterDeskCustomers, tenDigitPhone } from "./desk-customers.ts";
import { nextOpenVisit, visitLengthError, visitRunsPastClose } from "./capacity.ts";
import { bookableDay } from "./bookable-day.ts";
import { addDays, pinClock, resetClock, todayIso } from "./clock.ts";
import { fullVin } from "./vin.ts";
import { createShopStore, setAppointmentCommitProbe } from "./store.ts";
import type { ShopStorage } from "./shop-storage.ts";
import type { Appointment } from "./types.ts";

afterEach(() => {
  resetClock();
  setAppointmentCommitProbe(null);
});

function memoryStorage(): ShopStorage {
  const items = new Map<string, string>();
  return {
    getItem: (key) => items.get(key) ?? null,
    setItem: (key, value) => { items.set(key, value); },
    removeItem: (key) => { items.delete(key); },
  };
}

function shop() {
  const store = createShopStore({ demoMode: true, storage: memoryStorage() });
  store.getState().setWorkingAs("megan");
  return store;
}

function bookInput(state: ReturnType<ReturnType<typeof shop>["getState"]>, patch: Partial<Appointment> = {}) {
  const row = state.appointments.find((item) => item.status === "scheduled" && item.date >= todayIso()) ?? state.appointments[0];
  const other = state.customers.find((customer) => customer.id !== row.customerId) ?? state.customers[0];
  const vehicle = state.vehicles.find((item) => item.customerId === other.id) ?? state.vehicles[0];
  return {
    date: bookableDay(2),
    time: "09:00",
    minutes: 60,
    customerId: other.id,
    vehicleId: vehicle.id,
    advisorId: "megan",
    techId: "marcus",
    concern: "Oil",
    lines: [{ id: "a", code: "A", concern: "Oil" }],
    vin: fullVin({ prefix: "1FTAB12C", year: 2019, plant: "G", serial: 8801 }),
    laborOpIds: [] as string[],
    lane: "drop",
    status: "scheduled" as const,
    ...patch,
  };
}

describe("round 24 atomic VIN transfer", () => {
  it("refuses each pre-claim check without moving the VIN", () => {
    const store = shop();
    const state = store.getState();
    const helen = state.customers.find((row) => row.name === "Helen Cho");
    const helenVehicle = state.vehicles.find((row) => row.customerId === helen?.id);
    const buyer = state.customers.find((row) => row.id !== helen?.id);
    const buyerVehicle = state.vehicles.find((row) => row.customerId === buyer?.id);
    assert.ok(helen && helenVehicle && buyer && buyerVehicle && helenVehicle.vin);
    const base = {
      ...bookInput(state),
      customerId: buyer.id,
      vehicleId: buyerVehicle.id,
      vin: helenVehicle.vin,
    };
    const owner = () => store.getState().vehicles.find((row) => row.id === helenVehicle.id)?.customerId;
    store.getState().setWorkingAs("derek");
    store.getState().updateDayHours(6, { open: "08:00", close: "10:00" });
    store.getState().setWorkingAs("megan");
    let saturday = todayIso();
    for (let guard = 0; guard < 10 && new Date(`${saturday}T12:00:00.000Z`).getUTCDay() !== 6; guard += 1) saturday = addDays(saturday, 1);
    const cases = [
      { ...base, date: saturday, time: "09:00", minutes: 90 },
      { ...base, time: "09:15" },
      { ...base, date: saturday, time: "15:00", minutes: 60 },
      { ...base, lines: [{ id: "a", code: "A", concern: "   " }, { id: "b", code: "B", concern: "" }], concern: "A. Oil · B. Brakes" },
    ];
    for (const input of cases) {
      const saved = store.getState().saveAdvisorAppointment(input, undefined, true, "Sold the truck");
      assert.equal(saved.ok, false, JSON.stringify(saved));
      assert.equal(owner(), helen.id);
    }
    assert.equal(visitLengthError(1440), "That length is not on this desk.");
    const huge = store.getState().saveAdvisorAppointment({ ...base, minutes: 1440 }, undefined, true, "Sold the truck");
    assert.equal(huge.ok, false);
    assert.equal(owner(), helen.id);
  });

  it("rolls the VIN back when the commit throws", () => {
    const store = shop();
    const state = store.getState();
    const helen = state.customers.find((row) => row.name === "Helen Cho");
    const helenVehicle = state.vehicles.find((row) => row.customerId === helen?.id);
    const buyer = state.customers.find((row) => row.id !== helen?.id);
    const buyerVehicle = state.vehicles.find((row) => row.customerId === buyer?.id);
    assert.ok(helen && helenVehicle && buyer && buyerVehicle);
    setAppointmentCommitProbe(() => { throw new Error("probe: midway"); });
    const saved = store.getState().saveAdvisorAppointment({
      ...bookInput(state),
      customerId: buyer.id,
      vehicleId: buyerVehicle.id,
      vin: helenVehicle.vin,
    }, undefined, true, "Sold the truck");
    assert.equal(saved.ok, false);
    assert.equal(store.getState().vehicles.find((row) => row.id === helenVehicle.id)?.customerId, helen.id);
    assert.equal(store.getState().customers.some((row) => row.id === buyer.id), true);
  });
});

describe("round 24 past days, close, and stores", () => {
  it("lets a past visit change to showed or no-show and blocks cancel and put back", () => {
    pinClock("2026-11-10T20:00:00.000Z");
    const store = shop();
    const sample = store.getState().appointments.find((item) => item.status === "scheduled");
    assert.ok(sample);
    store.setState({
      appointments: store.getState().appointments.map((item) => item.id === sample.id ? { ...item, date: "2026-11-09" } : item),
    });
    const row = store.getState().appointments.find((item) => item.id === sample.id);
    assert.ok(row);
    assert.equal(store.getState().updateAppointment(row.id, { status: "arrived" }).ok, true);
    assert.equal(store.getState().updateAppointment(row.id, { status: "scheduled" }).ok, false);
    assert.equal(store.getState().setAppointmentStatus(row.id, "no_show").ok, true);
    assert.match(store.getState().cancelAppointment(row.id, { reason: "customer-request" }).error ?? "", /past/);
    assert.match(store.getState().setAppointmentStatus(row.id, "in_shop").error ?? "", /showed or no-show/);
  });

  it("refuses a visit that runs past close unless a service manager approves it", () => {
    const store = shop();
    let saturday = todayIso();
    for (let guard = 0; guard < 10 && new Date(`${saturday}T12:00:00.000Z`).getUTCDay() !== 6; guard += 1) saturday = addDays(saturday, 1);
    const input = bookInput(store.getState(), { date: saturday, time: "12:30", minutes: 120, vin: "" });
    assert.equal(visitRunsPastClose(store.getState().settings.scheduling, saturday, "12:30", 120), true);
    const advisor = store.getState().saveAdvisorAppointment(input);
    assert.match(advisor.error ?? "", /past closing/);
    store.getState().setWorkingAs("derek");
    const manager = store.getState().saveAdvisorAppointment({ ...input, advisorId: "derek" });
    assert.equal(manager.ok, true, manager.error ?? "");
    assert.equal(store.getState().overrides.some((row) => row.reason === "past-close"), true);
  });

  it("refuses shop hours and closed dates from an advisor", () => {
    const store = shop();
    const before = store.getState().settings.scheduling.hours[1]?.close;
    store.getState().updateDayHours(1, { close: "12:00" });
    assert.equal(store.getState().settings.scheduling.hours[1]?.close, before);
    assert.equal(store.getState().addClosedDate("2026-12-31"), false);
    store.getState().setWorkingAs("derek");
    assert.equal(store.getState().addClosedDate("2026-12-31"), true);
  });

  it("does not log a concern change when the lines are the same", () => {
    const store = shop();
    const row = store.getState().appointments.find((item) => item.lines.length > 1 && item.date >= todayIso());
    assert.ok(row);
    const before = store.getState().settingsLog?.length ?? 0;
    const saved = store.getState().updateAppointment(row.id, { lines: row.lines, concern: row.concern });
    assert.equal(saved.ok, true, saved.error ?? "");
    const concernLogs = (store.getState().settingsLog ?? []).slice(before).filter((item) => item.after.includes("concern"));
    assert.equal(concernLogs.length, 0);
  });

  it("refuses a booking into the other store", () => {
    const store = shop();
    store.getState().switchStore("pullman");
    store.setState({ userStoreId: "grand-coulee" });
    store.getState().setWorkingAs("megan");
    const state = store.getState();
    const customer = state.customers[0];
    const vehicle = state.vehicles.find((row) => row.customerId === customer.id);
    assert.ok(vehicle);
    const saved = store.getState().saveAdvisorAppointment({
      date: bookableDay(1),
      time: "09:00",
      minutes: 60,
      customerId: customer.id,
      vehicleId: vehicle.id,
      advisorId: state.advisors[0].id,
      techId: state.techs[0].id,
      concern: "Oil",
      lines: [{ id: "a", code: "A", concern: "Oil" }],
      vin: "",
      laborOpIds: [],
      lane: "drop",
      status: "scheduled",
    });
    assert.match(saved.error ?? "", /own store/);
    const crossTech = store.getState().addAppointment({
      date: bookableDay(1),
      time: "10:00",
      minutes: 60,
      customerId: customer.id,
      vehicleId: vehicle.id,
      advisorId: "not-on-this-store",
      techId: state.techs[0].id,
      concern: "Oil",
      lines: [{ id: "a", code: "A", concern: "Oil" }],
      vin: "",
      laborOpIds: [],
      lane: "drop",
    });
    assert.equal(crossTech, "");
  });
});

describe("round 24 book desk", () => {
  it("filters customers by name, phone, and the last 8 of the VIN", () => {
    const customers = [
      { id: "a", name: "Helen Cho", phone: "5095550140" },
      { id: "b", name: "Pat Example", phone: "2085550199" },
    ];
    const vehicles = [
      { customerId: "a", vin: "1FTAB12C3NG000111" },
      { customerId: "b", vin: "1FTAB12C3NG999888" },
    ];
    assert.deepEqual(filterDeskCustomers(customers, vehicles, "hel").map((row) => row.id), ["a"]);
    assert.deepEqual(filterDeskCustomers(customers, vehicles, "208555").map((row) => row.id), ["b"]);
    assert.deepEqual(filterDeskCustomers(customers, vehicles, "NG999888").map((row) => row.id), ["b"]);
    assert.equal(tenDigitPhone("509-555-0140"), "5095550140");
    assert.equal(tenDigitPhone("5095550140 x12"), "");
  });

  it("keeps the book fields when the day changes", () => {
    const host = document.createElement("div");
    document.body.appendChild(host);
    const root = createRoot(host);
    flushSync(() => {
      root.render(createElement(AppointmentFields, {
        initial: {
          date: "2026-11-12", time: "09:00", minutes: 60, customerId: "c", vehicleId: "v",
          advisorId: "megan", techId: "marcus", concern: "Oil and filter", lines: [{ id: "a", code: "A", concern: "Oil and filter" }],
          vin: "1FTAB12C3NG000111", laborOpIds: [], lane: "drop", status: "scheduled",
        },
        customers: [{ id: "c", name: "Pat Example", phone: "5095550100" }, { id: "d", name: "Helen Cho", phone: "5095550140" }],
        vehicles: [{ id: "v", customerId: "c", year: 2020, model: "Escape", vin: "1FTAB12C3NG000111" }],
        advisors: [{ id: "megan", number: "1", name: "Megan" }],
        techs: [{ id: "marcus", number: "2", name: "Marcus" }],
        laborOps: [],
        transports: [{ id: "drop", name: "Drop-off" }, { id: "waiter", name: "Waiter" }],
        submitLabel: "Book it",
        onSubmit: () => null,
      }));
    });
    const day = host.querySelector<HTMLInputElement>("input[type='date']");
    const vin = host.querySelector<HTMLInputElement>("input.font-mono");
    assert.ok(day && vin);
    vin.value = "1FTAB12C3NG000222";
    vin.dispatchEvent(new Event("input", { bubbles: true }));
    flushSync(() => { day.value = "2026-11-13"; day.dispatchEvent(new Event("change", { bubbles: true })); });
    const vinAfter = host.querySelector<HTMLInputElement>("input.font-mono");
    const combo = host.querySelector<HTMLInputElement>("input[role='combobox']");
    assert.equal(vinAfter?.value, "1FTAB12C3NG000222");
    assert.equal(combo?.value, "Pat Example");
    root.unmount();
    host.remove();
  });

  it("books a brand-new customer from the book dialog", () => {
    const store = shop();
    const host = document.createElement("div");
    document.body.appendChild(host);
    const root = createRoot(host);
    const state = store.getState();
    flushSync(() => {
      root.render(createElement(AppointmentFields, {
        initial: {
          date: bookableDay(4), time: "09:30", minutes: 60, customerId: state.customers[0].id,
          vehicleId: state.vehicles[0].id, advisorId: "megan", techId: "marcus", concern: "",
          lines: [{ id: "a", code: "A", concern: "New brakes" }], vin: "", laborOpIds: [], lane: "drop", status: "scheduled",
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
        onCreate: (value, confirm, reason) => {
          const result = store.getState().saveNewCustomerAppointment(value, confirm, reason);
          if (result.needsTransfer) return { error: result.error, needsTransfer: true, warning: result.warning };
          return result.ok ? null : result.error;
        },
      }));
    });
    const opener = [...host.querySelectorAll("button")].find((button) => button.textContent === "New customer");
    assert.ok(opener);
    flushSync(() => opener.click());
    const labeled = (name: string) => [...host.querySelectorAll("[data-new-customer] label")].find((label) => label.textContent?.startsWith(name))?.querySelector("input") as HTMLInputElement;
    const type = (input: HTMLInputElement, value: string) => {
      const proto = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value");
      proto?.set?.call(input, value);
      input.dispatchEvent(new Event("input", { bubbles: true }));
    };
    type(labeled("Name"), "Rita Gomez");
    type(labeled("Phone"), "5095550188");
    type(labeled("Year"), "2021");
    type(labeled("Make"), "Ford");
    type(labeled("Model"), "Escape");
    type(labeled("Plate"), "RITA1");
    type(labeled("VIN"), fullVin({ prefix: "1FTAB12C", year: 2021, plant: "G", serial: 4242 }));
    flushSync(() => { host.querySelector("form")?.requestSubmit(); });
    const created = store.getState().customers.find((row) => row.name === "Rita Gomez");
    assert.ok(created);
    assert.equal(created.phone, "5095550188");
    const vehicle = store.getState().vehicles.find((row) => row.customerId === created.id);
    assert.equal(vehicle?.plate, "RITA1");
    assert.equal(store.getState().appointments.some((row) => row.customerId === created.id), true);
    root.unmount();
    host.remove();
  });

  it("opens the book window on the next open slot and titles the edit in 12-hour time", () => {
    pinClock("2026-11-10T18:10:00.000Z");
    const store = shop();
    const next = nextOpenVisit(store.getState().settings.scheduling, todayIso(), new Date("2026-11-10T18:10:00.000Z"), 60);
    assert.equal(next.date, "2026-11-10");
    assert.ok(next.time > "10:00");
    assert.equal(clockTime("14:00"), "2:00 PM");
    assert.equal(clockTime("14:00").includes("14:00"), false);
  });
});
