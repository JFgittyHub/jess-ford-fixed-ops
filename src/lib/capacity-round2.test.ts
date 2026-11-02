import "./test-dom.ts";
import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import { createElement } from "react";
import { flushSync } from "react-dom";
import { createRoot } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { AppointmentCalendar } from "../components/appointment-calendar.tsx";
import { CapacitySettings } from "../components/capacity-settings.tsx";
import { assessAppointment, capacityLogForActor, onlineSlots, timeOffForActor, unavailableBands } from "./capacity.ts";
import { addDays, pinClock, resetClock, todayIso } from "./clock.ts";
import { pendingHoldsCapacity, requestHolds } from "./online-request.ts";
import { createSeed } from "./seed.ts";
import type { ShopStorage } from "./shop-storage.ts";
import { closedCapacity, normalizeScheduling } from "./scheduling.ts";
import { createShopStore, useShop } from "./store.ts";
import type { OnlineRequest, WeekdayIndex } from "./types.ts";

afterEach(() => resetClock());

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
  store.getState().setWorkingAs("derek");
  return store;
}

function tomorrow() {
  return addDays(todayIso(), 1);
}

describe("capacity round 2", () => {
  it("refuses bad hours, weekdays, dates, and blocks with a specific message and no log for a bad weekday", () => {
    pinClock("2026-11-02T20:00:00.000Z");
    const store = shop();
    const before = store.getState().settingsLog?.length ?? 0;
    const weekday = store.getState().updateTechCapacityHours("marcus", 1.5, 4);
    assert.equal(weekday.ok, false);
    assert.equal(weekday.error, "That weekday is not a day of the week.");
    const shopDay = store.getState().updateDayHours(8 as WeekdayIndex, { closed: true });
    assert.equal(shopDay.ok, false);
    assert.equal(shopDay.error, "That weekday is not a day of the week.");
    assert.equal(store.getState().settingsLog?.length ?? 0, before);

    const sunday = store.getState().updateTechCapacityHours("marcus", 0, 4);
    assert.equal(sunday.ok, false);
    assert.equal(sunday.error, "Open that day before setting technician hours.");
    const steps = store.getState().updateTechCapacityHours("marcus", 2, 4.333);
    assert.equal(steps.ok, false);
    assert.equal(steps.error, "Hours go in quarter-hour steps, such as 4 or 4.25.");
    const over = store.getState().updateTechCapacityHours("marcus", 2, 11);
    assert.equal(over.ok, false);
    assert.equal(over.error, "Those hours are more than the shop is open that day.");
    const hex = store.getState().updateTechCapacityHours("marcus", 2, "0x10");
    assert.equal(hex.ok, false);
    assert.equal(hex.error, "Enter a plain number. 0x10 and 1e2 are not accepted.");
    const exp = store.getState().updateCapacityLimits({ maxWaiterPerSlot: "1e2" });
    assert.equal(exp.ok, false);
    assert.equal(exp.error, "Enter a plain number. 0x10 and 1e2 are not accepted.");
    assert.equal(store.getState().updateTechCapacityHours("marcus", 2, 4).ok, true);

    assert.equal(store.getState().addTechTimeOff({ techId: "marcus", date: "2026-02-31" }).error, "That date is not a real day.");
    assert.equal(store.getState().addTechTimeOff({ techId: "marcus", date: "2026-13-01" }).error, "That date is not a real day.");
    assert.equal(store.getState().addTechTimeOff({ techId: "marcus", date: "2026-11-01" }).error, "That date is already past.");
    assert.equal(store.getState().addTechTimeOff({ techId: "marcus", date: "2026-11-26" }).error, "The shop is closed that day.");
    assert.equal(store.getState().addClosedDate("2026-02-31").error, "That date is not a real day.");

    const day = tomorrow();
    assert.equal(store.getState().addTechTimeOff({ techId: "marcus", date: day, start: "06:00", end: "07:00" }).error, "That block is outside shop hours.");
    assert.equal(store.getState().addTechTimeOff({ techId: "marcus", date: day, start: "09:15", end: "10:15" }).error, "Time off starts and ends on the half hour.");
    assert.equal(store.getState().addTechTimeOff({ techId: "marcus", date: day, start: "12:00", end: "13:00" }).ok, true);
    assert.equal(store.getState().addTechTimeOff({ techId: "marcus", date: day, start: "12:00", end: "13:00" }).error, "That time off is already on the schedule.");
    assert.equal(store.getState().addTechTimeOff({ techId: "marcus", date: day, start: "12:30", end: "13:30" }).error, "That time off overlaps time already off.");
    const whole = addDays(day, 1);
    assert.equal(store.getState().addTechTimeOff({ techId: "marcus", date: whole }).ok, true);
    assert.equal(store.getState().addTechTimeOff({ techId: "marcus", date: whole, start: "09:00", end: "10:00" }).error, "That technician is already off the whole day.");

    const opened = store.getState().updateDayHours(0, { closed: false });
    assert.equal(opened.ok, true);
    assert.equal(store.getState().updateTechCapacityHours("marcus", 0, 4).ok, true);
    const logged = store.getState().readCapacityLog();
    assert.ok(logged.some((row) => row.field.includes("Capacity tech hours") && row.after === "4"));
    assert.equal(logged[0].at >= logged[logged.length - 1].at, true);
  });

  it("lets only a service manager change hours, closed dates, labor hours, roster capacity, and time off", () => {
    pinClock("2026-11-02T20:00:00.000Z");
    const store = shop();
    const day = tomorrow();
    assert.equal(store.getState().addTechTimeOff({ techId: "marcus", date: day }).ok, true);
    const offId = store.getState().settings.scheduling.capacity.timeOff[0]?.id ?? "";
    const menu = store.getState().settings.scheduling.onlineMenu[0];
    for (const who of ["megan", "marcus", ""]) {
      store.getState().setWorkingAs(who);
      assert.equal(store.getState().removeTechTimeOff(offId).ok, false);
      assert.match(store.getState().updateDayHours(1, { close: "16:00" }).error ?? "", /service manager|Choose who is working/);
      assert.match(store.getState().addClosedDate("2026-12-31").error ?? "", /service manager|Choose who is working/);
      assert.match(store.getState().removeClosedDate("2026-11-26").error ?? "", /service manager|Choose who is working/);
      assert.equal(store.getState().addOnlineService({ name: "Battery", laborHours: 0.4 }), false);
      assert.equal(store.getState().updateOnlineService(menu.id, { laborHours: 1.5 }), false);
      assert.equal(store.getState().addTech({ number: "99", name: "Temp", skill: "b", payStyle: "flat", flagRate: 20, hourlyRate: 20, board: "main" }), false);
      assert.equal(store.getState().updateTech("marcus", { board: "express" }), false);
      assert.equal(store.getState().readTimeOff().length, 0);
      assert.equal(store.getState().readCapacityLog().length, 0);
      assert.equal(timeOffForActor(who === "" ? "customer" : who === "marcus" ? "technician" : "advisor", store.getState().settings.scheduling.capacity.timeOff).length, 0);
    }
    store.getState().setWorkingAs("derek");
    assert.equal(store.getState().readTimeOff().some((row) => row.date === day), true);
    assert.ok(store.getState().readCapacityLog().length > 0);
    assert.equal(capacityLogForActor("advisor", store.getState().settingsLog ?? []).length, 0);
    assert.equal(store.getState().removeTechTimeOff(offId).ok, true);
    assert.ok(store.getState().readCapacityLog().some((row) => row.after === "removed"));
    assert.equal(store.getState().updateDayHours(1, { close: "16:00" }).ok, true);
    assert.equal(store.getState().addClosedDate("2026-12-31").ok, true);
    assert.equal(store.getState().removeClosedDate("2026-12-31").ok, true);
    assert.equal(store.getState().updateOnlineService(menu.id, { laborHours: 0.8 }), true);
    const tech = store.getState().techs.find((row) => row.number === "99");
    assert.equal(tech, undefined);
    assert.equal(store.getState().addTech({ number: "99", name: "Temp\u202E Tech", skill: "b", payStyle: "flat", flagRate: 20, hourlyRate: 20, board: "main" }), true);
    const added = store.getState().techs.find((row) => row.number === "99");
    assert.ok(added);
    assert.equal(added.name.includes("\u202E"), false);
    assert.equal(store.getState().removeTech(added.id), "ok");
  });

  it("fails closed on corrupt capacity, keeps a missing save open, and drops a stored reason", () => {
    const corrupt = normalizeScheduling({ capacity: "nope" });
    assert.equal(corrupt.capacity.maxWaiterPerSlot, 0);
    assert.equal(corrupt.capacity.maxArrivalsPerSlot, 0);
    assert.equal(corrupt.capacity.maxAdvisorAppointmentsPerHour, 0);
    assert.equal(corrupt.capacity.onlineSharePercent, 0);
    assert.equal(corrupt.capacity.loadNotice, closedCapacity().loadNotice);
    const bad = normalizeScheduling({ capacity: { maxWaiterPerSlot: 1.5, onlineSharePercent: 140, timeOff: [{ id: "x", techId: "marcus", date: "2026-12-02", start: "", end: "", reason: "vacation" }] } });
    assert.equal(bad.capacity.maxWaiterPerSlot, 0);
    assert.equal(bad.capacity.onlineSharePercent, 0);
    assert.equal(bad.capacity.loadNotice.length > 0, true);
    assert.equal("reason" in (bad.capacity.timeOff[0] ?? {}), false);
    const missing = normalizeScheduling({});
    assert.equal(missing.capacity.maxWaiterPerSlot, null);
    assert.equal(missing.capacity.onlineSharePercent, 100);
    assert.equal(missing.capacity.loadNotice, "");
  });

  it("keeps drop-off off the waiter cap, including after Waiter is removed and added again", () => {
    const store = shop();
    assert.equal(store.getState().updateCapacityLimits({ maxWaiterPerSlot: 1 }).ok, true);
    assert.equal(store.getState().removeTransportOption("waiter"), true);
    assert.equal(store.getState().addTransportOption("Waiter"), true);
    const waiter = store.getState().settings.scheduling.transportOptions.find((row) => row.name === "Waiter");
    assert.ok(waiter);
    assert.equal(waiter.kind, "waiter");
    assert.notEqual(waiter.id, "waiter");
    const scheduling = store.getState().settings.scheduling;
    const base = {
      scheduling,
      advisors: store.getState().advisors,
      techs: store.getState().techs,
      appointments: [],
      laborOps: [],
    };
    const parked = [{ id: "w1", date: "2026-11-03", time: "09:00", advisorId: "megan", techId: "elena", laborHours: 0.5, counts: true, lane: waiter.id, status: "pending" as const }];
    const another = assessAppointment({ ...base, holds: parked, proposal: { date: "2026-11-03", time: "09:00", advisorId: "jordan", techId: "marcus", laborOpIds: [], minutes: 30, lane: waiter.id } });
    assert.equal(another.waiter.overloaded, true);
    const drop = assessAppointment({ ...base, holds: parked, proposal: { date: "2026-11-03", time: "09:00", advisorId: "jordan", techId: "marcus", laborOpIds: [], minutes: 30, lane: "drop" } });
    assert.equal(drop.waiter.overloaded, false);
    assert.equal(drop.warning, null);
    const over = [{ ...parked[0], id: "w2" }, { ...parked[0], id: "w3", advisorId: "jordan" }];
    const dropPast = assessAppointment({ ...base, holds: over, proposal: { date: "2026-11-03", time: "09:00", advisorId: "alicia", techId: "marcus", laborOpIds: [], minutes: 30, lane: "drop" } });
    assert.equal(dropPast.waiter.overloaded, false);
    const express = assessAppointment({ ...base, holds: [], proposal: { date: "2026-11-03", time: "09:00", advisorId: "megan", techId: "marcus", laborOpIds: [], minutes: 30, lane: "express" } });
    assert.equal(express.waiter.adding, 1);
    const slots = onlineSlots({
      scheduling: { ...scheduling, capacity: { ...scheduling.capacity, maxWaiterPerSlot: 0 } },
      advisors: [{ id: "megan" }],
      techs: [{ id: "marcus", board: "main" }],
      loads: [],
      serviceId: "gc-oil",
      now: new Date("2026-11-02T16:00:00.000Z"),
      from: "2026-11-03",
      through: "2026-11-03",
      techId: "marcus",
      advisorId: "megan",
      transportId: "drop",
    });
    assert.ok(slots.length > 0);
    const closed = onlineSlots({ ...{
      scheduling: { ...scheduling, capacity: { ...scheduling.capacity, maxWaiterPerSlot: 0 } },
      advisors: [{ id: "megan" }],
      techs: [{ id: "marcus", board: "main" }],
      loads: [],
      serviceId: "gc-oil",
      now: new Date("2026-11-02T16:00:00.000Z"),
      from: "2026-11-03",
      through: "2026-11-03",
      techId: "marcus",
      advisorId: "megan",
    }, transportId: waiter.id });
    assert.equal(closed.length, 0);
  });

  it("stops counting a pending request after 48 hours and does not prune old time off", () => {
    pinClock("2026-11-02T20:00:00.000Z");
    const fresh = { createdAt: "2026-11-01T21:00:00.000Z", status: "pending" } as OnlineRequest;
    const stale = { createdAt: "2026-10-30T20:00:00.000Z", status: "pending" } as OnlineRequest;
    assert.equal(pendingHoldsCapacity(fresh), true);
    assert.equal(pendingHoldsCapacity(stale), false);
    assert.equal(requestHolds([fresh, stale]).length, 1);
    const store = shop();
    const old = { id: "old-off", techId: "marcus", date: "2020-01-06", start: "", end: "" };
    store.setState((state) => ({
      settings: {
        ...state.settings,
        scheduling: {
          ...state.settings.scheduling,
          capacity: { ...state.settings.scheduling.capacity, timeOff: [old] },
        },
      },
    }));
    assert.equal(store.getState().addTechTimeOff({ techId: "marcus", date: tomorrow() }).ok, true);
    assert.equal(store.getState().settings.scheduling.capacity.timeOff.some((row) => row.id === "old-off"), true);
    const many = store.getState();
    const rows = Array.from({ length: 366 }, (_, index) => ({ id: `cap-${index}`, techId: "elena", date: addDays("2026-11-03", index), start: "", end: "" }));
    store.setState({
      settings: {
        ...many.settings,
        scheduling: { ...many.settings.scheduling, capacity: { ...many.settings.scheduling.capacity, timeOff: rows } },
      },
    });
    assert.equal(store.getState().addTechTimeOff({ techId: "elena", date: addDays("2027-11-04", 1) }).error, "That technician already has 366 future days off.");
  });

  it("names capacity and time off in the clear-shop log", () => {
    const store = shop();
    let added = false;
    for (let offset = 1; offset < 21 && !added; offset += 1) {
      const result = store.getState().addTechTimeOff({ techId: "marcus", date: addDays(todayIso(), offset) });
      added = result.ok;
      if (!result.ok && result.error !== "The shop is closed that day.") assert.fail(result.error ?? "time off");
    }
    assert.equal(added, true);
    store.getState().clearShop();
    const row = store.getState().settingsLog?.find((item) => item.field === "Clear shop data");
    assert.match(row?.after ?? "", /Reset capacity settings and 1 time-off entries/);
    assert.match(row?.after ?? "", /Closed repair orders kept/);
  });

  it("draws unavailable time on the grid without a reason or a date list", () => {
    pinClock("2026-11-02T20:00:00.000Z");
    const store = shop();
    store.getState().addTechTimeOff({ techId: "marcus", date: "2026-11-03", start: "09:00", end: "11:00" });
    const bands = unavailableBands(store.getState().settings.scheduling, "2026-11-03", "marcus");
    assert.equal(bands.length, 1);
    assert.equal("reason" in bands[0], false);
    const html = renderToStaticMarkup(createElement(AppointmentCalendar, {
      appointments: [],
      day: "2026-11-03",
      techs: [{ id: "marcus", number: "1", name: "Marcus Hale", board: "main" }],
      selectedId: null,
      onSelect: () => undefined,
      onSlot: () => undefined,
      onMove: () => undefined,
      onWrite: () => undefined,
      onEdit: () => undefined,
      label: () => "Customer",
      summary: () => ({ name: "", vehicle: "", advisor: "", tech: "", when: "", lane: "", concern: "", vin: "", ops: "", status: "", canWrite: false }),
      hoursFor: () => 1,
      unavailableFor: () => bands,
    }));
    assert.match(html, /Unavailable/);
    assert.equal(html.includes("2026-11-03"), false);
    assert.equal(html.includes("vacation"), false);
    assert.match(html, /data-unavailable="yes"/);

    const seed = createSeed();
    seed.settings.scheduling.capacity.timeOff = [{ id: "off-1", techId: "marcus", date: "2026-12-02", start: "", end: "" }];
    seed.settingsLog = [{ at: "2026-11-02T20:00:00.000Z", who: "Derek Lang", whoId: "derek", field: "Capacity time off · Marcus Hale", before: "", after: "2026-12-02 off" }];
    useShop.setState({ ...seed, workingAsId: "megan", dataset: "sample", activeStoreId: "grand-coulee", stores: { "grand-coulee": seed, pullman: seed } });
    const host = document.createElement("div");
    document.body.appendChild(host);
    const root = createRoot(host);
    flushSync(() => { root.render(createElement(CapacitySettings)); });
    const hidden = host.textContent ?? "";
    assert.equal(hidden.includes("2026-12-02"), false);
    assert.match(hidden, /stay with the service manager/);
    assert.equal(hidden.includes("Capacity time off"), false);
    useShop.setState({ workingAsId: "derek" });
    flushSync(() => { root.render(createElement(CapacitySettings)); });
    const shown = host.textContent ?? "";
    assert.match(shown, /2026-12-02/);
    assert.match(shown, /PT/);
    flushSync(() => { root.unmount(); });
    host.remove();
  });
});
