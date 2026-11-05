import "./test-dom.ts";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { afterEach, describe, it } from "node:test";
import { createElement } from "react";
import { flushSync } from "react-dom";
import { createRoot } from "react-dom/client";
import { AppointmentCalendar, lengthHandleRange, planCalendarDrag } from "../components/appointment-calendar.tsx";
import { OrderEditor } from "../components/order-editor.tsx";
import { ScorecardPulse } from "../components/scorecard/board.tsx";
import { bookableDay } from "./bookable-day.ts";
import { pinClock, resetClock, now, todayIso } from "./clock.ts";
import { closeGaps } from "./metrics.ts";
import { tomorrowIso } from "./notices.ts";
import { cleanFreeText, phoneKey, submitOnlineRequest } from "./online-request.ts";
import { transferReason } from "./ownership.ts";
import { paceFor } from "./scorecard/model.ts";
import { SAMPLE_MONTHS } from "./scorecard/sample.ts";
import { createSeed } from "./seed.ts";
import type { ShopStorage } from "./shop-storage.ts";
import { createShopStore, useShop } from "./store.ts";
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

function mount(node: ReturnType<typeof createElement>) {
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  flushSync(() => { root.render(node); });
  const text = document.body.textContent ?? "";
  flushSync(() => { root.unmount(); });
  host.remove();
  return text;
}

describe("round 19 calendar grip", () => {
  it("keeps the length grip inside the bottom of the card", () => {
    for (const minutes of [30, 60]) {
      const range = lengthHandleRange(minutes);
      assert.equal(range.bottom - range.top, 10);
      assert.equal(range.bottom, range.center * 2);
      assert.equal(range.center >= range.top && range.center < range.bottom, false);
    }
    const floor = planCalendarDrag({
      mode: "resize", time: "09:00", minutes: 30, techId: "marcus", dx: 0, dy: -64, techIds: ["marcus"], colWidth: 140,
    });
    assert.equal(floor.minutes, 30);
    assert.equal(floor.time, "09:00");
  });

  it("moves the lower card from its own surface and books an empty slot", () => {
    const moves: { id: string; minutes: number; time: string }[] = [];
    const slots: string[] = [];
    const day = "2026-11-02";
    const card = (id: string, time: string, techId: string, minutes = 30): Appointment => ({
      id, date: day, time, minutes, customerId: "c", vehicleId: "v", advisorId: "megan",
      concern: id, lines: [{ id: `${id}-a`, code: "A", concern: id }], vin: "", laborOpIds: [],
      techId, lane: "drop", status: "scheduled", orderId: null,
    });
    const summary = () => ({
      name: "Pat", vehicle: "Ford", advisor: "Megan", tech: "Marcus", when: "9:00", lane: "Drop",
      concern: "Oil", vin: "", ops: "", status: "Scheduled", canWrite: false,
    });
    const host = document.createElement("div");
    document.body.appendChild(host);
    const root = createRoot(host);
    flushSync(() => {
      root.render(createElement(AppointmentCalendar, {
        appointments: [card("upper", "09:00", "marcus"), card("lower", "09:30", "marcus"), card("solo", "09:00", "elena")],
        day,
        techs: [
          { id: "marcus", number: "1", name: "Marcus", board: "main" },
          { id: "elena", number: "2", name: "Elena", board: "express" },
        ],
        selectedId: "upper",
        onSelect: () => undefined,
        onSlot: (techId) => { slots.push(techId); },
        onMove: (id, patch) => { moves.push({ id, minutes: patch.minutes, time: patch.time }); },
        onWrite: () => undefined,
        onEdit: () => undefined,
        label: (row) => row.id,
        summary,
        hoursFor: () => 1,
      }));
    });
    const lower = document.body.querySelector("[data-appt-id='lower']");
    const upperGrip = document.body.querySelector("[data-appt-id='upper'] [data-drag='resize']");
    const soloColumn = document.body.querySelector("[data-tech='elena']");
    assert.ok(lower instanceof HTMLElement);
    assert.ok(upperGrip instanceof HTMLElement);
    assert.equal(upperGrip.closest("[data-appt-id]")?.getAttribute("data-appt-id"), "upper");
    assert.equal(lower.getAttribute("data-drag"), "move");
    const pointer = window.PointerEvent;
    const down = new pointer("pointerdown", { bubbles: true, clientX: 40, clientY: 40 });
    lower.dispatchEvent(down);
    window.dispatchEvent(new pointer("pointermove", { bubbles: true, clientX: 40, clientY: 80 }));
    window.dispatchEvent(new pointer("pointerup", { bubbles: true, clientX: 40, clientY: 80 }));
    assert.equal(moves.length, 1);
    assert.equal(moves[0]?.id, "lower");
    assert.equal(moves[0]?.minutes, 30);
    assert.notEqual(moves[0]?.time, "09:30");
    assert.ok(soloColumn instanceof HTMLElement);
    soloColumn.dispatchEvent(new MouseEvent("click", { bubbles: true, clientX: 10, clientY: 400 }));
    assert.deepEqual(slots, ["elena"]);
    flushSync(() => { root.unmount(); });
    host.remove();
    const calendar = readFileSync(new URL("../components/appointment-calendar.tsx", import.meta.url), "utf8");
    assert.match(calendar, /height: HANDLE/);
    assert.equal(calendar.includes("top-[calc(100%-1px)]"), false);
    assert.equal(calendar.includes("zIndex: selected ? 5"), false);
    const schedule = readFileSync(new URL("../routes/schedule.tsx", import.meta.url), "utf8");
    assert.match(schedule, /aria-label="Visit length"/);
    assert.match(schedule, /setLengthOpen\(true\)/);
    assert.match(schedule, /VisitLengthPicker/);
    assert.match(schedule, /onChange=\{onLength\}/);
    assert.match(schedule, /onChange\(Number\(event\.target\.value\)\)/);
  });
});

describe("round 19 appointments, phones, and logs", () => {
  it("refuses a vehicle that belongs to someone else and unknown ids", () => {
    const shop = createShopStore({ demoMode: true, storage: memoryStorage() });
    shop.getState().setWorkingAs("megan");
    const row = shop.getState().appointments.find((item) => item.status === "scheduled" && item.date >= todayIso());
    assert.ok(row);
    const other = shop.getState().appointments.find((item) => item.customerId !== row.customerId && item.vehicleId);
    assert.ok(other);
    const otherVehicle = shop.getState().vehicles.find((item) => item.id === other.vehicleId);
    assert.equal(otherVehicle?.customerId, other.customerId);
    const kept = shop.getState().updateAppointment(row.id, { customerId: other.customerId });
    assert.equal(kept.ok, false);
    assert.match(kept.error ?? "", /belongs to another customer/);
    const swapped = shop.getState().updateAppointment(row.id, { customerId: other.customerId, vehicleId: other.vehicleId });
    assert.equal(swapped.ok, true, swapped.error ?? "");
    const saved = shop.getState().appointments.find((item) => item.id === row.id);
    assert.equal(saved?.customerId, other.customerId);
    assert.equal(saved?.vehicleId, other.vehicleId);
    const otherName = shop.getState().customers.find((item) => item.id === other.customerId)?.name ?? "";
    const customerLog = shop.getState().settingsLog?.find((item) => item.after.includes("customer "));
    assert.match(customerLog?.after ?? "", new RegExp(`for ${otherName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`));
    const unknownCustomer = shop.getState().updateAppointment(row.id, { customerId: "missing-customer" });
    assert.equal(unknownCustomer.ok, false);
    assert.match(unknownCustomer.error ?? "", /not on this store/);
    const unknownStatus = shop.getState().updateAppointment(row.id, { status: "bogus" as Appointment["status"] });
    assert.equal(unknownStatus.ok, false);
    assert.match(unknownStatus.error ?? "", /status/);
    const unknownLane = shop.getState().updateAppointment(row.id, { lane: "not-a-lane" });
    assert.equal(unknownLane.ok, false);
    assert.match(unknownLane.error ?? "", /lane/);
    const unknownOp = shop.getState().updateAppointment(row.id, { laborOpIds: ["missing-op"] });
    assert.equal(unknownOp.ok, false);
    assert.match(unknownOp.error ?? "", /labor operation/);
    const wrongVehicle = shop.getState().updateAppointment(row.id, { vehicleId: row.vehicleId });
    assert.equal(wrongVehicle.ok, false);
    assert.match(wrongVehicle.error ?? "", /belongs to another customer/);
  });

  it("logs a move and a length change, a cleaned concern, and a put-back in words", () => {
    const shop = createShopStore({ demoMode: true, storage: memoryStorage() });
    shop.getState().setWorkingAs("megan");
    const row = shop.getState().appointments.find((item) => item.id === "a8");
    assert.ok(row);
    const name = shop.getState().customers.find((item) => item.id === row.customerId)?.name ?? "";
    const moved = shop.getState().moveAppointment(row.id, { time: "11:30", minutes: row.minutes + 30, techId: row.techId });
    assert.equal(moved.ok, true, moved.error ?? "");
    const lines = shop.getState().settingsLog ?? [];
    assert.equal(lines.some((item) => item.field === "Move appointment"), true);
    const length = lines.find((item) => item.field === "Length");
    assert.match(length?.after ?? "", new RegExp(`Length: .+ → .+ for ${name}`));
    const concern = shop.getState().updateAppointment(row.id, { concern: "Rotate the tires\u202E now", time: row.time });
    assert.equal(concern.ok, true, concern.error ?? "");
    const stored = shop.getState().appointments.find((item) => item.id === row.id);
    assert.equal(stored?.lines[0]?.concern, "Rotate the tires now");
    assert.equal((stored?.concern ?? "").includes("\u202E"), false);
    const concernLog = shop.getState().settingsLog?.filter((item) => item.after.includes("concern")) ?? [];
    assert.equal(concernLog.length, 1);
    assert.match(concernLog[0]?.after ?? "", /Rotate the tires now/);
    assert.equal((concernLog[0]?.after ?? "").includes("\u202E"), false);
    assert.equal(shop.getState().settingsLog?.some((item) => item.after.includes("time ") && item.after.includes("Rotate")), false);
    const back = shop.getState().appointments.find((item) => item.status === "scheduled" && item.date >= todayIso());
    assert.ok(back);
    assert.equal(shop.getState().updateAppointment(back.id, { status: "no_show" }).ok, true);
    assert.equal(shop.getState().updateAppointment(back.id, { status: "scheduled" }).ok, true);
    const putBack = shop.getState().settingsLog?.find((item) => item.field === "Put back");
    assert.match(putBack?.after ?? "", /Put back to scheduled/);
    shop.getState().setWorkingAs("derek");
    assert.equal(shop.getState().addClosedDate("2026-12-24"), true);
    const closedDate = shop.getState().settingsLog?.find((item) => item.field === "Closed date" && item.after === "Thu, Dec 24");
    assert.ok(closedDate);
    assert.equal((closedDate?.after ?? "").includes("2026-12-24"), false);
  });

  it("strips hidden characters from stored text and accepts an international phone", () => {
    assert.equal(cleanFreeText("a\u0001b\u001Fc\u007F"), "abc");
    assert.equal(cleanFreeText("a\u0085b"), "ab");
    assert.equal(cleanFreeText("a\u2028b\u2029c"), "abc");
    assert.equal(cleanFreeText("a\u2066b\u2060c"), "abc");
    assert.equal(cleanFreeText("a\u200Eb\u200Fc"), "abc");
    assert.equal(cleanFreeText("a\u3164b\uFFF9c"), "abc");
    assert.equal(cleanFreeText("josé"), "josé");
    assert.equal(phoneKey("+52 509 555 0300"), "+525095550300");
    assert.equal(phoneKey("+44 20 7946 0958"), "+442079460958");
    assert.equal(phoneKey("+1 509 555 0300"), "5095550300");
    assert.notEqual(phoneKey("+52 509 555 0300"), phoneKey("(509) 555-0300"));
    const reason = transferReason("Sold the truck\u2066 to José");
    assert.equal("text" in reason, true);
    if ("text" in reason) {
      assert.equal(reason.text.includes("\u2066"), false);
      assert.match(reason.text, /José/);
    }
    const shop = createShopStore({ demoMode: true, storage: memoryStorage() });
    shop.getState().setWorkingAs("megan");
    shop.getState().updateSettings({ storeName: "North\u2066 Side", city: "Coulee\u0007", phone: "509\u200E5550100", address: "1 Main\u2028" });
    assert.equal(shop.getState().settings.storeName, "North Side");
    assert.equal(shop.getState().settings.city, "Coulee");
    assert.equal(shop.getState().settings.phone.includes("\u200E"), false);
    assert.equal(shop.getState().settings.address.includes("\u2028"), false);
    assert.equal(shop.getState().addTransportOption("Shuttle\u200E van"), true);
    assert.equal(shop.getState().settings.scheduling.transportOptions.some((row) => row.name === "Shuttle van"), true);
    assert.equal(shop.getState().addOnlineService({ name: "Oil\u0007 change", laborHours: 0.4 }), true);
    assert.equal(shop.getState().settings.scheduling.onlineMenu.some((row) => row.name === "Oil change" && row.laborHours === 0.4), true);
    const created = shop.getState().createCustomer({ name: "José\u0001 Alvarez", phone: "5095550199", year: 2020, model: "F-150\u2060" });
    assert.equal(created.error ?? null, null, created.error ?? "");
    const customer = shop.getState().customers.find((row) => row.id === created.customerId);
    assert.equal(customer?.name, "José Alvarez");
    const vehicle = shop.getState().vehicles.find((row) => row.id === created.vehicleId);
    assert.equal(vehicle?.model, "F-150");
    const state = shop.getState();
    const saved = submitOnlineRequest(state, {
      serviceId: state.settings.scheduling.onlineMenu[0].id,
      date: "2026-11-12",
      time: "09:00",
      advisorId: state.advisors[0].id,
      transportId: state.settings.scheduling.transportOptions[0].id,
      verified: false,
      customerName: "Pat Example",
      phone: "+52 509\u202E 555 0300",
      email: "pat.mx@example.com",
      year: 2020,
      make: "Ford",
      model: "Escape",
      plate: "PAT123",
      vin: fullVin({ prefix: "1FTAB12C", year: 2020, plant: "G", serial: 880 }),
      deviceId: "desk\u0001-1",
    }, "rq-mx", "2026-11-01T18:00:00.000Z");
    assert.equal(saved.ok, true, JSON.stringify(saved));
    if (saved.ok) {
      assert.equal(saved.request.phone, "+525095550300");
      assert.equal(saved.request.deviceId, "desk-1");
      assert.equal(phoneKey(saved.request.phone), "+525095550300");
    }
    const visit = shop.getState().appointments.find((item) => item.status === "scheduled" && !item.orderId && item.date >= todayIso());
    assert.ok(visit);
    const cancelled = shop.getState().cancelAppointment(visit.id, { reason: "other", note: "Customer called\u0001 ahead" });
    assert.equal(cancelled.ok, true, cancelled.error ?? "");
    const note = shop.getState().appointments.find((item) => item.id === visit.id)?.cancelHistory?.at(-1)?.note ?? "";
    assert.equal(note, "Customer called ahead");
    const long = "B".repeat(600);
    const { id: _ignored, status: _status, orderId: _orderId, cancelHistory: _history, ...visitInput } = visit;
    const booked = shop.getState().addAppointment({
      ...visitInput,
      date: bookableDay(),
      concern: long,
      lines: [{ id: "long-a", code: "A", concern: `${long}\u202E` }],
    });
    assert.ok(booked);
    const storedConcern = shop.getState().appointments.find((item) => item.id === booked)?.lines[0]?.concern ?? "";
    assert.equal(storedConcern.length, 500);
    assert.equal(storedConcern.includes("\u202E"), false);
  });
});

describe("round 19 last visit and pulse", () => {
  it("shows the closed visit in the editor when a newer open ticket exists", () => {
    const seed = createSeed();
    const template = seed.orders.find((row) => row.status === "closed" && row.closeSnapshot && row.jobs.length > 0);
    assert.ok(template);
    const vehicle = {
      ...(seed.vehicles.find((row) => row.id === template.vehicleId) ?? seed.vehicles[0]),
      id: "v-lv4",
      vin: fullVin({ prefix: "1FTAB12C", year: 2019, plant: "G", serial: 919 }),
    };
    const priorClosed = {
      ...template,
      id: "prior-closed",
      vehicleId: vehicle.id,
      number: 1,
      status: "closed" as const,
      openedOn: "2026-10-01",
      openedAt: "2026-10-01T16:00:00.000Z",
      mileage: 80000,
      mileageOut: 84201,
    };
    const priorOpen = {
      ...template,
      id: "prior-open",
      vehicleId: vehicle.id,
      number: 2,
      status: "open" as const,
      openedOn: "2026-10-20",
      openedAt: "2026-10-20T16:00:00.000Z",
      mileage: 90000,
      mileageOut: null,
      closeSnapshot: undefined,
      authorizationLocked: false,
    };
    const snapshot = { ...template.closeSnapshot! };
    delete snapshot.lastVisitNote;
    const viewed = {
      ...template,
      id: "viewed-closed",
      vehicleId: vehicle.id,
      number: 3,
      status: "closed" as const,
      openedOn: "2026-10-21",
      openedAt: "2026-10-21T16:00:00.000Z",
      closeSnapshot: snapshot,
    };
    const orders = [priorClosed, priorOpen, viewed];
    useShop.setState({
      ...seed,
      vehicles: [...seed.vehicles, vehicle],
      orders,
      focusOrderId: viewed.id,
      activeStoreId: "grand-coulee",
      stores: {
        "grand-coulee": { ...seed, vehicles: [...seed.vehicles, vehicle], orders },
        pullman: { ...seed, orders: [], vehicles: [] },
      },
    });
    const text = mount(createElement(OrderEditor, { orderId: viewed.id, onClose: () => undefined }));
    assert.match(text, /Last visit: left at 84,201 mi on Oct 1, 2026\./);
    assert.equal(text.includes("Last visit: mileage in 90,000"), false);
  });

  it("labels a finished month without MTD or Projected on the first, the middle, and the next month", () => {
    for (const pin of ["2026-11-01T20:00:00.000Z", "2026-11-17T20:00:00.000Z", "2026-12-01T20:00:00.000Z"]) {
      pinClock(pin);
      const text = mount(createElement(ScorecardPulse, {}));
      assert.match(text, /October 2026 \(Oct 19–23\)/);
      assert.equal(text.includes("MTD"), false);
      assert.equal(text.includes("Projected"), false);
    }
  });

  it("reads the pinnable clock for pace, reminders, and open punches", () => {
    pinClock("2026-10-15T19:00:00.000Z");
    const pace = paceFor(SAMPLE_MONTHS["2026-10"]);
    assert.equal(pace.future, false);
    assert.equal(pace.closed, false);
    assert.ok(pace.elapsed > 0 && pace.elapsed < pace.total);
    pinClock("2026-11-17T20:00:00.000Z");
    assert.equal(tomorrowIso(), "2026-11-18");
    assert.equal(paceFor(SAMPLE_MONTHS["2026-10"]).closed, true);
    pinClock("2099-06-15T19:00:00.000Z");
    const seed = createSeed();
    const helen = seed.orders.find((row) => row.id === "open-helen");
    assert.ok(helen);
    const start = new Date(now().getTime() - 60 * 60 * 1000).toISOString();
    const gaps = closeGaps(helen, seed.techs, seed.advisors, [{
      id: "open-punch", techId: "chris", orderId: helen.id, startedAt: start, endedAt: null,
    }]);
    assert.equal(gaps.includes("Clock time"), false);
  });
});
