import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { afterEach, describe, it } from "node:test";
import { changeLogLine, requestLogLine } from "./cancel.ts";
import { advisorDayCapacity } from "./capacity.ts";
import { now, pinClock, resetClock } from "./clock.ts";
import { closedHeaderCopy, formatVisit, localStamp } from "./format.ts";
import { lastVisitMileage } from "./mileage.ts";
import { bookableDay } from "./bookable-day.ts";
import { advisorForWebRequest, submitOnlineRequest } from "./online-request.ts";
import { mergeVinDuplicates, vehicleHistoryEntries } from "./ownership.ts";
import { normalizeDeskPath } from "./section-lock.ts";
import type { ShopStorage } from "./shop-storage.ts";
import { createShopStore, migrateSavedShop } from "./store.ts";
import type { Appointment, RepairOrder, Vehicle } from "./types.ts";
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

function shop() {
  const store = createShopStore({ demoMode: true, storage: memoryStorage() });
  store.getState().setWorkingAs("megan");
  return store;
}

type Desk = ReturnType<ReturnType<typeof shop>["getState"]>;

function draft(state: Desk, patch: Partial<Appointment> = {}): Omit<Appointment, "id" | "orderId" | "status"> {
  const customer = state.customers[0];
  const vehicle = state.vehicles.find((row) => row.customerId === customer.id) ?? state.vehicles[0];
  return {
    date: bookableDay(),
    time: "09:00",
    minutes: 60,
    customerId: customer.id,
    vehicleId: vehicle.id,
    advisorId: "megan",
    concern: "Oil change",
    lines: [{ id: "line-a", code: "A", concern: "Oil change" }],
    vin: vehicle.vin,
    laborOpIds: [],
    techId: "marcus",
    lane: "drop",
    ...patch,
  };
}

function requestInput(state: Desk, patch: Record<string, unknown> = {}) {
  const serviceId = state.settings.scheduling.onlineMenu[0].id;
  const advisorId = state.advisors[0].id;
  return {
    serviceId,
    date: "2026-11-03",
    time: "09:00",
    advisorId,
    transportId: state.settings.scheduling.transportOptions[0].id,
    verified: false,
    customerName: "Pat Example",
    year: 2020,
    make: "Ford",
    model: "Escape",
    plate: "ABC123",
    phone: "(509) 555-0300",
    email: "pat@example.com",
    vin: fullVin({ prefix: "1FTAB12C", year: 2020, plant: "G", serial: 80 }),
    ...patch,
  };
}

describe("round 17 clock and change log", () => {
  it("stamps punches from the pinnable clock", () => {
    pinClock("2026-10-31T19:00:00.000Z");
    const stamp = localStamp();
    assert.match(stamp, /^2026-10-31T\d{2}:\d{2}:\d{2}$/);
    resetClock();
    const live = now();
    const pad = (n: number) => String(n).padStart(2, "0");
    assert.equal(localStamp().slice(0, 10), `${live.getFullYear()}-${pad(live.getMonth() + 1)}-${pad(live.getDate())}`);
  });

  it("writes hours as a weekday and clock time, and a move as one sentence", () => {
    const store = shop();
    store.getState().updateDayHours(1, { closed: true });
    const hours = store.getState().settingsLog?.find((row) => row.field === "Hours Mon");
    assert.ok(hours);
    assert.equal(hours.before.includes("{"), false);
    assert.match(hours.after, /Mon closed/);
    assert.match(changeLogLine(hours), /Hours Mon: .+ → Mon closed · .+ PT$/);
    const visit = draft(store.getState(), { date: bookableDay(1) });
    const id = store.getState().addAppointment(visit);
    const moved = store.getState().moveAppointment(id, { time: "12:30", techId: "elena" });
    assert.equal(moved.ok, true, moved.error ?? "");
    const row = store.getState().settingsLog?.find((item) => item.field === "Move appointment");
    assert.match(row?.after ?? "", /^Moved .+ from .+ with .+ to .+ with Elena Voss$/);
    assert.match(changeLogLine(row!), / PT$/);
    assert.equal((row?.after ?? "").includes("id"), false);
  });

  it("logs a cancel, a reinstate, and an approve override in the change log", () => {
    const store = shop();
    const id = store.getState().addAppointment(draft(store.getState(), { time: "15:00", concern: "Quiet visit", lines: [{ id: "q", code: "A", concern: "Quiet visit" }] }));
    const cancelled = store.getState().cancelAppointment(id, { reason: "customer-request", note: "They called" });
    assert.equal(cancelled.ok, true, cancelled.error ?? "");
    const cancelRow = store.getState().settingsLog?.find((row) => row.field === "Cancel appointment");
    assert.match(cancelRow?.after ?? "", /^Cancelled .+ for .+/);
    const back = store.getState().reinstateAppointment(id);
    assert.equal(back.ok, true, back.error ?? "");
    assert.match(store.getState().settingsLog?.find((row) => row.field === "Reinstate appointment")?.after ?? "", /^Reinstated /);
    const heavy = store.getState().saveAdvisorAppointment({
      ...draft(store.getState(), { time: "16:00", minutes: 600, concern: "Long diagnosis", lines: [{ id: "long", code: "A", concern: "Long diagnosis" }] }),
      status: "scheduled",
    });
    assert.equal(heavy.ok, true, heavy.error ?? "");
    assert.ok(heavy.overrideId);
    assert.match(store.getState().settingsLog?.find((row) => row.field === "Capacity override")?.after ?? "", /Approved an override for /);
    assert.ok((store.getState().overrides ?? []).some((row) => row.id === heavy.overrideId));
  });

  it("describes cleared work with counts and keeps the earlier log row", () => {
    const store = shop();
    store.getState().setWorkingAs("derek");
    store.getState().updateDayHours(1, { open: "08:00", close: "17:30" });
    const before = store.getState().settingsLog?.length ?? 0;
    const appointments = store.getState().appointments.length;
    const overrides = store.getState().overrides?.length ?? 0;
    store.setState({ requestLog: [{ at: "2026-10-31T16:00:00.000Z", who: "Derek Lang", whoId: "derek", requestId: "rq-clear", action: "approved", customerName: "Pat Example", visit: formatVisit("2026-11-03", "09:00") }] });
    store.getState().clearShop();
    const row = store.getState().settingsLog?.find((item) => item.field === "Clear shop data");
    assert.equal(row?.after, `Cleared open work (${appointments} appointments, ${overrides} overrides) — closed ROs kept`);
    assert.ok((store.getState().settingsLog?.length ?? 0) > before);
    assert.match(changeLogLine(row!), /Cleared open work \(\d+ appointments, \d+ overrides\) — closed ROs kept · .+ PT$/);
    assert.equal(store.getState().requestLog?.some((item) => item.requestId === "rq-clear"), true);
  });
});

describe("round 17 appointment edits", () => {
  it("refuses a technician, a blank worker, and a ghost id, and logs an advisor edit", () => {
    const store = shop();
    const id = store.getState().addAppointment(draft(store.getState()));
    store.getState().setWorkingAs("marcus");
    const tech = store.getState().updateAppointment(id, { status: "arrived" });
    assert.equal(tech.ok, false);
    assert.equal(store.getState().appointments.find((row) => row.id === id)?.status, "scheduled");
    const added = store.getState().addAppointment(draft(store.getState(), { time: "10:00" }));
    assert.equal(added, "");
    store.getState().setWorkingAs("");
    assert.equal(store.getState().addAppointment(draft(store.getState(), { time: "10:30" })), "");
    store.setState({ workingAsId: "ghost" });
    assert.equal(store.getState().updateAppointment(id, { time: "11:00" }).ok, false);
    store.getState().setWorkingAs("megan");
    const edited = store.getState().updateAppointment(id, { time: "11:00", status: "arrived" });
    assert.equal(edited.ok, true, edited.error ?? "");
    const lines = store.getState().settingsLog?.filter((row) => row.field === "Appointment edited" || row.field === "Arrived") ?? [];
    assert.equal(lines.some((row) => row.after.includes("Appointment edited: time")), true);
    assert.equal(lines.some((row) => row.after.includes("Marked arrived")), true);
  });

  it("keeps a no-show on the original customer and refuses another customer's VIN", () => {
    const store = shop();
    const state = store.getState();
    const first = state.customers[0];
    const second = state.customers[1];
    const own = state.vehicles.find((row) => row.customerId === first.id);
    const other = state.vehicles.find((row) => row.customerId === second.id);
    assert.ok(own && other);
    const id = store.getState().addAppointment(draft(state, { customerId: first.id, vehicleId: own.id, vin: own.vin }));
    assert.equal(store.getState().setAppointmentStatus(id, "no_show").ok, true);
    const shows = store.getState().customers.find((row) => row.id === first.id)?.noShows ?? 0;
    const moved = store.getState().updateAppointment(id, { customerId: second.id });
    assert.equal(moved.ok, false);
    assert.equal(store.getState().customers.find((row) => row.id === first.id)?.noShows, shows);
    assert.equal(store.getState().customers.find((row) => row.id === second.id)?.noShows ?? 0, 0);
    const vin = store.getState().updateAppointment(id, { vin: other.vin });
    assert.equal(vin.ok, false);
    assert.match(vin.error ?? "", /another customer/);
    const bad = store.getState().updateAppointment(id, { vin: {} as unknown as string });
    assert.equal(bad.ok, false);
    assert.match(bad.error ?? "", /17-character VIN/);
    assert.equal(store.getState().appointments.find((row) => row.id === id)?.vin, own.vin);
  });

  it("refuses a non-string VIN on a new customer", () => {
    const store = shop();
    const before = store.getState().customers.length;
    const created = store.getState().createCustomer({ name: "Ada Miles", phone: "5095550188", year: 2020, model: "Escape", vin: 12345 as unknown as string });
    assert.match(created.error ?? "", /17-character VIN/);
    assert.equal(store.getState().customers.length, before);
  });
});

describe("round 17 closed header and last visit", () => {
  it("does not write a header into a stored closed repair order", () => {
    const order = {
      id: "saved-241201",
      status: "closed",
      closeSnapshot: { customerName: "Ada", phone: "5552011400", address: "", plate: "", vin: "", year: 2020, make: "Ford", model: "F-150", storeName: "" },
      jobs: [],
      labor: [],
      parts: [],
      customerId: "c",
      vehicleId: "v",
      concern: "",
      mileage: 1,
      openedOn: "2026-10-01",
    };
    const before = JSON.stringify(order);
    const loaded = migrateSavedShop({
      settings: { storeName: "Jess Ford Grand Coulee" },
      orders: [order],
      customers: [],
      vehicles: [],
    });
    assert.equal(JSON.stringify(loaded.orders?.[0]), before);
    const named = migrateSavedShop({
      settings: { storeName: "New Live Name" },
      orders: [{ ...order, closeSnapshot: { ...order.closeSnapshot, storeName: "Old Name" } }],
    });
    assert.equal(named.orders?.[0]?.closeSnapshot?.storeName, "Old Name");
    const shown = closedHeaderCopy({
      status: "closed",
      closeSnapshot: { storeName: "Captured At Close", storeAddress: "Captured Road", storeCity: "Captured City", storePhone: "5551112222", phone: "5552011400" },
    }, { storeName: "LIVE", address: "Live", city: "Live", phone: "(555) 633-1400" });
    assert.equal(shown.name, "Header not recorded");
    assert.equal(shown.line.includes("201"), false);
    assert.equal(shown.line.includes("633"), false);
  });

  it("freezes the closed-only last visit when an order is closed", () => {
    const store = shop();
    const helen = store.getState().orders.find((row) => row.id === "open-helen");
    assert.ok(helen);
    store.setState({
      orders: store.getState().orders.map((row) => row.id === "open-helen"
        ? {
            ...row,
            status: "booked" as const,
            mileageOut: row.mileage + 4,
            parts: row.parts.map((line) => ({ ...line, condition: "new" as const })),
            wa: { choice: "cap" as const, initials: "HC", date: "2026-10-19", time: "09:00", estimate: 0, cap: 50000, returnParts: false, plate: "", address: "100 Main Street", extras: [] },
          }
        : row),
    });
    const closed = store.getState().closeOrder("open-helen");
    assert.equal(closed.ok, true, closed.error ?? "");
    const saved = store.getState().orders.find((row) => row.id === "open-helen");
    assert.equal(saved?.closeSnapshot?.storeName, store.getState().settings.storeName);
    assert.equal(typeof saved?.closeSnapshot?.lastVisitNote, "string");
    const frozen = saved?.closeSnapshot?.lastVisitNote;
    store.setState({
      orders: [...store.getState().orders, {
        ...helen,
        id: "later-open",
        number: 999999,
        status: "open" as const,
        openedAt: "2099-01-01T16:00:00.000Z",
        openedOn: "2099-01-01",
        mileage: (helen.mileage ?? 0) + 50000,
        mileageOut: null,
        authorizationLocked: false,
        closeSnapshot: undefined,
      }],
    });
    assert.equal(store.getState().orders.find((row) => row.id === "open-helen")?.closeSnapshot?.lastVisitNote, frozen);
  });

  it("ignores an open later visit when the last-visit hint is closed only", () => {
    const vehicle = { id: "v30", vin: fullVin({ prefix: "1FTAB12C", year: 2019, plant: "G", serial: 30 }) };
    const closedVisit = lastVisitMileage([{
      vehicles: [vehicle],
      orders: [
        { id: "c", number: 1, vehicleId: "v30", mileage: 80000, mileageOut: 84201, openedOn: "2026-10-01", openedAt: "2026-10-01T16:00:00.000Z", status: "closed" },
        { id: "o", number: 2, vehicleId: "v30", mileage: 90000, mileageOut: null, openedOn: "2026-10-20", openedAt: "2026-10-20T16:00:00.000Z", status: "open" },
      ],
    }], vehicle, { closedOnly: true, openedAt: "2026-11-01T16:00:00.000Z", openedOn: "2026-11-01", number: 3 });
    assert.equal(closedVisit?.mileage, 84201);
    const anyVisit = lastVisitMileage([{
      vehicles: [vehicle],
      orders: [
        { id: "c", number: 1, vehicleId: "v30", mileage: 80000, mileageOut: 84201, openedOn: "2026-10-01", openedAt: "2026-10-01T16:00:00.000Z", status: "closed" },
        { id: "o", number: 2, vehicleId: "v30", mileage: 90000, mileageOut: null, openedOn: "2026-10-20", openedAt: "2026-10-20T16:00:00.000Z", status: "open" },
      ],
    }], vehicle, { openedAt: "2026-11-01T16:00:00.000Z", openedOn: "2026-11-01", number: 3 });
    assert.equal(anyVisit?.orderId, "o");
  });
});

describe("round 17 requests, roles, and ownership", () => {
  it("caps contact, device, and a full day without blaming the wrong thing", () => {
    const store = shop();
    const state = store.getState();
    const at = "2026-10-31T16:00:00.000Z";
    const send = (patch: Record<string, unknown>, id: string, pending = state.onlineRequests) => submitOnlineRequest(
      { ...state, onlineRequests: pending },
      requestInput(state, patch),
      id,
      at,
    );
    let pending = [...state.onlineRequests];
    for (let index = 0; index < 3; index += 1) {
      const result = send({ vin: fullVin({ prefix: "1FTAB12C", year: 2020, plant: "G", serial: 200 + index }), email: `cap${index}@example.com` }, `rq-${index}`, pending);
      assert.equal(result.ok, true, JSON.stringify(result));
      if (result.ok) pending = [...pending, result.request];
    }
    const fourth = send({ vin: fullVin({ prefix: "1FTAB12C", year: 2020, plant: "G", serial: 220 }) }, "rq-4", pending);
    assert.equal(fourth.ok, false);
    if (!fourth.ok) {
      assert.equal(fourth.reason, "limit");
      assert.equal(fourth.limit, 3);
      assert.equal(fourth.scope, "contact");
    }
    const foreign = send({ phone: "+52 509 555 0300", email: "other@example.com", vin: fullVin({ prefix: "1FTAB12C", year: 2020, plant: "G", serial: 221 }) }, "rq-foreign", pending);
    assert.equal(foreign.ok, true, JSON.stringify(foreign));
    const extension = send({ phone: "509-555-0300 ext 12", email: "ext@example.com", vin: fullVin({ prefix: "1FTAB12C", year: 2020, plant: "G", serial: 222 }) }, "rq-ext", pending);
    assert.equal(extension.ok, false);
    if (!extension.ok) assert.equal(extension.limit, 3);
    const hashed = send({ phone: "509-555-0300 #12", email: "hash@example.com", vin: fullVin({ prefix: "1FTAB12C", year: 2020, plant: "G", serial: 223 }) }, "rq-hash", pending);
    assert.equal(hashed.ok, false);
    if (!hashed.ok) assert.equal(hashed.scope, "contact");
    const eleven = send({ phone: "95095550300", email: "nine@example.com", vin: fullVin({ prefix: "1FTAB12C", year: 2020, plant: "G", serial: 224 }) }, "rq-11", pending);
    assert.equal(eleven.ok, false);
    if (!eleven.ok) assert.equal(eleven.scope, "contact");
  });

  it("keeps josé, folds the match key, and stores a lowercased email", () => {
    const store = shop();
    const state = store.getState();
    const at = "2026-10-31T16:00:00.000Z";
    const first = submitOnlineRequest(state, requestInput(state, {
      customerName: "José",
      email: "José@Example.com",
      phone: "",
      vin: fullVin({ prefix: "1FTAB12C", year: 2020, plant: "G", serial: 230 }),
    }), "rq-jose", at);
    assert.equal(first.ok, true, JSON.stringify(first));
    if (first.ok) {
      assert.equal(first.request.customerName, "José");
      assert.equal(first.request.email, "josé@example.com");
    }
    const dotted = submitOnlineRequest(state, requestInput(state, {
      email: "Pat@Example.COM.",
      phone: "5095550444",
      vin: fullVin({ prefix: "1FTAB12C", year: 2020, plant: "G", serial: 231 }),
    }), "rq-dot", at);
    assert.equal(dotted.ok, true, JSON.stringify(dotted));
    if (dotted.ok) assert.equal(dotted.request.email, "pat@example.com.");
    const dottedAgain = submitOnlineRequest(dotted.ok ? { ...state, onlineRequests: [dotted.request, dotted.request, dotted.request] } : state, requestInput(state, {
      email: "pat@example.com",
      phone: "",
      vin: fullVin({ prefix: "1FTAB12C", year: 2020, plant: "G", serial: 232 }),
    }), "rq-dot-2", at);
    assert.equal(dottedAgain.ok, false);
    if (!dottedAgain.ok) assert.equal(dottedAgain.limit, 3);
    let pending = first.ok ? [first.request] : [];
    for (let index = 0; index < 2; index += 1) {
      const result = submitOnlineRequest({ ...state, onlineRequests: pending }, requestInput(state, {
        customerName: "José",
        email: "josé@example.com",
        phone: "",
        vin: fullVin({ prefix: "1FTAB12C", year: 2020, plant: "G", serial: 240 + index }),
      }), `rq-jose-${index}`, at);
      assert.equal(result.ok, true, JSON.stringify(result));
      if (result.ok) pending = [...pending, result.request];
    }
    const folded = submitOnlineRequest({ ...state, onlineRequests: pending }, requestInput(state, {
      email: "jose@example.com",
      phone: "",
      vin: fullVin({ prefix: "1FTAB12C", year: 2020, plant: "G", serial: 250 }),
    }), "rq-fold", at);
    assert.equal(folded.ok, false);
    if (!folded.ok) assert.equal(folded.limit, 3);
    const zw = submitOnlineRequest(state, requestInput(state, {
      email: "pat\u200B@example.com",
      phone: "5095550455",
      vin: fullVin({ prefix: "1FTAB12C", year: 2020, plant: "G", serial: 251 }),
    }), "rq-zw", at);
    assert.equal(zw.ok, true, JSON.stringify(zw));
    let zwPending = zw.ok ? [zw.request] : [];
    for (let index = 0; index < 2; index += 1) {
      const result = submitOnlineRequest({ ...state, onlineRequests: zwPending }, requestInput(state, {
        email: "pat@example.com",
        phone: "",
        customerName: "Pat",
        vin: fullVin({ prefix: "1FTAB12C", year: 2020, plant: "G", serial: 260 + index }),
      }), `rq-zw-${index}`, at);
      assert.equal(result.ok, true, JSON.stringify(result));
      if (result.ok) zwPending = [...zwPending, result.request];
    }
    const again = submitOnlineRequest({ ...state, onlineRequests: zwPending }, requestInput(state, {
      email: `pat\u200B@example.com`,
      phone: "",
      vin: fullVin({ prefix: "1FTAB12C", year: 2020, plant: "G", serial: 270 }),
    }), "rq-zw-4", at);
    assert.equal(again.ok, false);
    if (!again.ok) assert.equal(again.limit, 3);
  });

  it("refuses a closed day, a bad contact, a long field, and a device cap", () => {
    const store = shop();
    const state = store.getState();
    const at = "2026-10-31T16:00:00.000Z";
    const closed = submitOnlineRequest({
      ...state,
      settings: { ...state.settings, scheduling: { ...state.settings.scheduling, closedDates: ["2026-11-03"] } },
    }, requestInput(state), "rq-closed", at);
    assert.equal(closed.ok, false);
    if (!closed.ok) assert.equal(closed.reason, "full");
    const contact = submitOnlineRequest(state, requestInput(state, { phone: "abc", email: "" }), "rq-bad", at);
    assert.equal(contact.ok, false);
    if (!contact.ok) assert.equal(contact.reason, "contact");
    const weirdVin = submitOnlineRequest(state, requestInput(state, { vin: 123 as unknown as string }), "rq-vin", at);
    assert.equal(weirdVin.ok, false);
    if (!weirdVin.ok) assert.equal(weirdVin.reason, "vin");
    const badVin = submitOnlineRequest(state, requestInput(state, { vin: "BADVIN" }), "rq-badvin", at);
    assert.equal(badVin.ok, false);
    if (!badVin.ok) assert.equal(badVin.reason, "vin");
    const longName = submitOnlineRequest(state, requestInput(state, { customerName: "A".repeat(200), phone: "5095550466", email: "long@example.com", vin: fullVin({ prefix: "1FTAB12C", year: 2020, plant: "G", serial: 280 }) }), "rq-name", at);
    assert.equal(longName.ok, true, JSON.stringify(longName));
    if (longName.ok) assert.equal(longName.request.customerName.length, 80);
    const longNote = submitOnlineRequest(state, requestInput(state, { note: "x".repeat(2000), phone: "5095550467", email: "note@example.com", vin: fullVin({ prefix: "1FTAB12C", year: 2020, plant: "G", serial: 281 }) }), "rq-note", at);
    assert.equal(longNote.ok, true, JSON.stringify(longNote));
    if (longNote.ok) assert.equal(longNote.request.note?.length ?? 0, 500);
    let pending = [...state.onlineRequests];
    for (let index = 0; index < 5; index += 1) {
      const result = submitOnlineRequest({ ...state, onlineRequests: pending }, requestInput(state, {
        deviceId: "browser-1",
        phone: `5095551${String(index).padStart(3, "0")}`,
        email: `dev${index}@example.com`,
        vin: fullVin({ prefix: "1FTAB12C", year: 2020, plant: "G", serial: 300 + index }),
      }), `rq-dev-${index}`, at);
      assert.equal(result.ok, true, JSON.stringify(result));
      if (result.ok) pending = [...pending, result.request];
    }
    const sixth = submitOnlineRequest({ ...state, onlineRequests: pending }, requestInput(state, {
      deviceId: "browser-1",
      phone: "5095551999",
      email: "dev6@example.com",
      vin: fullVin({ prefix: "1FTAB12C", year: 2020, plant: "G", serial: 320 }),
    }), "rq-dev-6", at);
    assert.equal(sixth.ok, false);
    if (!sixth.ok) {
      assert.equal(sixth.reason, "limit");
      assert.equal(sixth.limit, 5);
      assert.equal(sixth.scope, "device");
    }
  });

  it("spreads web requests and hits the store-day cap before every advisor is full", () => {
    const store = shop();
    const state = store.getState();
    const date = "2026-11-03";
    const per = Math.max(0, advisorDayCapacity(state.settings.scheduling, date) - 1);
    const picked = advisorForWebRequest(state.advisors, [], date, per);
    assert.equal(typeof picked, "string");
    assert.notEqual(picked, "");
    const full = Array.from({ length: per }, (_, index) => ({ advisorId: state.advisors[0].id, date, status: "pending", id: `p-${index}` }));
    const next = advisorForWebRequest(state.advisors, full, date, per);
    assert.notEqual(next, state.advisors[0].id);
    const storeCap = state.advisors.length * per - 1;
    const pending = [];
    for (const advisor of state.advisors) {
      const room = advisor.id === state.advisors[0].id ? per - 1 : per;
      for (let index = 0; index < room; index += 1) {
        pending.push({
          id: `hold-${advisor.id}-${index}`,
          storeId: state.activeStoreId,
          status: "pending" as const,
          createdAt: "2026-10-31T16:00:00.000Z",
          serviceId: state.settings.scheduling.onlineMenu[0].id,
          serviceName: "Oil",
          laborHours: 0.3,
          date,
          time: "09:00",
          advisorId: advisor.id,
          advisorName: advisor.name,
          techId: "marcus",
          techName: "Tech",
          transportId: state.settings.scheduling.transportOptions[0].id,
          transportName: "Drop",
          contactMethod: "text" as const,
          verified: false,
          customerId: null,
          customerName: `Hold ${advisor.id} ${index}`,
          phone: `509555${String(4000 + pending.length).slice(-4)}`,
          email: `hold${pending.length}@example.com`,
          vehicleId: null,
          year: 2020,
          make: "Ford",
          model: "Escape",
          vin: fullVin({ prefix: "1FTAB12C", year: 2020, plant: "G", serial: 400 + pending.length }),
          plate: "H",
          appointmentId: null,
        });
      }
    }
    assert.equal(pending.length, storeCap);
    const blocked = submitOnlineRequest({ ...state, onlineRequests: pending }, requestInput(state, {
      advisorId: state.advisors[0].id,
      phone: "5095550777",
      email: "storecap@example.com",
      vin: fullVin({ prefix: "1FTAB12C", year: 2020, plant: "G", serial: 900 }),
    }), "rq-store", "2026-10-31T16:00:00.000Z");
    assert.equal(blocked.ok, false);
    if (!blocked.ok) {
      assert.equal(blocked.reason, "limit");
      assert.equal(blocked.scope, "day");
    }
  });

  it("refuses scheduling, budget, and campaign writes from a technician", () => {
    const store = shop();
    const before = JSON.stringify(store.getState().settings.scheduling);
    store.getState().setWorkingAs("marcus");
    const menu = store.getState().settings.scheduling.onlineMenu[0];
    const ride = store.getState().settings.scheduling.transportOptions[0];
    assert.equal(store.getState().updateOnlineService(menu.id, { name: "Nope" }), false);
    store.getState().removeOnlineService(menu.id);
    assert.equal(store.getState().renameTransportOption(ride.id, "Nope"), false);
    assert.equal(store.getState().removeTransportOption(ride.id), false);
    assert.equal(JSON.stringify(store.getState().settings.scheduling), before);
    const budget = store.getState().budgets[0];
    const monthly = budget.monthly;
    store.getState().setBudget(budget.id, monthly + 25);
    store.getState().setWorkingAs("");
    store.getState().setBudget(budget.id, monthly + 40);
    assert.equal(store.getState().budgets.find((row) => row.id === budget.id)?.monthly, monthly);
    store.getState().setWorkingAs("marcus");
    store.getState().sendCampaign({ name: "X", message: "Hello", audience: "all", recipientIds: [store.getState().customers[0].id] });
    assert.equal(store.getState().campaigns.length, 0);
  });

  it("does not let an advisor load the sample month", () => {
    const store = shop();
    const id = store.getState().addAppointment(draft(store.getState(), { time: "16:00" }));
    store.getState().resetDemo(true);
    assert.equal(store.getState().appointments.some((row) => row.id === id), true);
    assert.equal(store.getState().settingsLog?.some((row) => row.field === "Load sample month"), false);
    store.getState().setWorkingAs("derek");
    const approved = store.getState().requestLog ?? [];
    store.setState({ requestLog: [...approved, { at: "2026-10-31T16:00:00.000Z", who: "Derek Lang", whoId: "derek", requestId: "rq-keep", action: "approved", customerName: "Pat Example", visit: formatVisit("2026-11-03", "09:00") }] });
    store.getState().resetDemo(true);
    assert.equal(store.getState().requestLog?.some((row) => row.requestId === "rq-keep"), true);
    assert.match(requestLogLine(store.getState().requestLog!.find((row) => row.requestId === "rq-keep")!), /Pat Example/);
    assert.equal(requestLogLine(store.getState().requestLog![0]).includes("rq-keep"), false);
  });

  it("uppercases a request VIN on approval", () => {
    const store = shop();
    const state = store.getState();
    const vin = fullVin({ prefix: "1FTAB12C", year: 2020, plant: "G", serial: 88 });
    const messy = `  ${vin.toLowerCase()}  `;
    store.setState({
      onlineRequests: [{
        id: "rq-vin",
        storeId: "grand-coulee",
        status: "pending",
        createdAt: "2026-10-31T16:00:00.000Z",
        serviceId: state.settings.scheduling.onlineMenu[0].id,
        serviceName: "Oil",
        laborHours: 0.5,
        date: "2026-11-03",
        time: "09:00",
        advisorId: "megan",
        advisorName: "Megan Cho",
        techId: "marcus",
        techName: "Marcus Hale",
        transportId: state.settings.scheduling.transportOptions[0].id,
        transportName: "Drop",
        contactMethod: "text",
        verified: false,
        customerId: null,
        customerName: "Vin Owner",
        phone: "5095550888",
        email: "",
        vehicleId: null,
        year: 2020,
        make: "Ford",
        model: "Escape",
        vin: messy,
        plate: "VIN123",
        appointmentId: null,
      }],
    });
    const approved = store.getState().approveOnlineRequest("rq-vin", "", true);
    assert.equal(approved.ok, true, "reason" in approved ? approved.reason : "");
    if (approved.ok) assert.equal(store.getState().appointments.find((row) => row.id === approved.appointmentId)?.vin, vin);
  });

  it("rejects a verified request with a short or over-long VIN", () => {
    const store = shop();
    const state = store.getState();
    const customer = state.customers.find((row) => row.mobile.trim());
    const vehicle = state.vehicles.find((row) => row.customerId === customer?.id);
    assert.ok(customer && vehicle);
    const at = "2026-10-31T16:00:00.000Z";
    const base = {
      ...requestInput(state),
      verified: true,
      code: "123456",
      customerId: customer.id,
      vehicleId: vehicle.id,
      phone: customer.phone,
      email: customer.email,
    };
    const shopWith = (vin: string) => ({
      ...state,
      vehicles: state.vehicles.map((row) => row.id === vehicle.id ? { ...row, vin } : row),
      onlineChallenges: [{ customerId: customer.id, code: "123456", issuedAt: at }],
    });
    const short = submitOnlineRequest(shopWith("1FT"), { ...base, vin: "1FT" }, "rq-short", at);
    assert.equal(short.ok, false);
    if (!short.ok) assert.equal(short.reason, "vin");
    const long = submitOnlineRequest(shopWith(vehicle.vin), { ...base, vin: `${vehicle.vin}XYZ` }, "rq-long", at);
    assert.equal(long.ok, false);
    if (!long.ok) assert.equal(long.reason, "vin");
  });

  it("ignores a 1970 visit and keeps a blank model from the duplicate", () => {
    const vin = fullVin({ prefix: "1FTAB12C", year: 2018, plant: "G", serial: 44 });
    const survivor: Vehicle = { id: "va", customerId: "ca", year: 2018, make: "Ford", model: "", vin };
    const duplicate: Vehicle = { id: "vb", customerId: "ca", year: 2018, make: "Ford", model: "F-150", vin };
    const orders = [
      { id: "old", vehicleId: "va", customerId: "ca", openedAt: "1970-01-01T00:00:00.000Z", openedOn: "1970-01-01", number: 1, status: "closed" },
      { id: "real", vehicleId: "va", customerId: "ca", openedAt: "2026-10-02T16:00:00.000Z", openedOn: "2026-10-02", number: 2, status: "closed" },
    ] as RepairOrder[];
    const merged = mergeVinDuplicates([duplicate, survivor], orders);
    assert.equal(merged.vehicles[0]?.model, "F-150");
    assert.equal(merged.vehicles[0]?.ownership?.[0]?.startedAt.startsWith("1970"), false);
    assert.match(merged.vehicles[0]?.ownership?.[0]?.startedAt ?? "", /^2026-10-02/);
    const historyVehicle: Vehicle = {
      id: "vh",
      customerId: "owner-a",
      year: 2018,
      make: "Ford",
      model: "F-150",
      vin,
      ownership: [
        { customerId: "owner-a", startedAt: "2024-01-01T16:00:00.000Z", endedAt: "2025-01-01T16:00:00.000Z", who: "", whoId: "", reason: "" },
        { customerId: "owner-b", startedAt: "2025-01-01T16:00:00.000Z", endedAt: "2026-01-01T16:00:00.000Z", who: "", whoId: "", reason: "" },
        { customerId: "owner-a", startedAt: "2026-01-01T16:00:00.000Z", endedAt: null, who: "", whoId: "", reason: "" },
      ],
    };
    const history = vehicleHistoryEntries([
      { id: "h1", vehicleId: "vh", customerId: "owner-a", openedAt: "2024-06-01T16:00:00.000Z", openedOn: "2024-06-01", number: 1, status: "closed" },
      { id: "h2", vehicleId: "vh", customerId: "owner-b", openedAt: "2025-06-01T16:00:00.000Z", openedOn: "2025-06-01", number: 2, status: "closed" },
      { id: "h3", vehicleId: "vh", customerId: "owner-a", openedAt: "2026-06-01T16:00:00.000Z", openedOn: "2026-06-01", number: 3, status: "closed" },
    ] as RepairOrder[], historyVehicle, [{ id: "owner-a", name: "Ada" }, { id: "owner-b", name: "Ben" }], [historyVehicle]);
    const dividers = history.filter((row) => row.kind === "divider");
    assert.equal(dividers.length, 1);
    assert.match(dividers[0].text, /New owner: Ben/);
    assert.match(dividers[0].text, / PT$/);
  });
});

describe("round 17 source locks", () => {
  it("normalizes a locked path with a capital letter and extra slashes", () => {
    assert.equal(normalizeDeskPath("/Fees/"), "/fees");
    assert.equal(normalizeDeskPath("/fees///"), "/fees");
  });

  it("keeps the 44px tap target rule and the class names that use it", () => {
    const css = readFileSync(new URL("../styles.css", import.meta.url), "utf8");
    assert.match(css, /\.desk-actions \.btn,\s*\.tap-targets \.btn,\s*\.modal-panel \.btn \{\s*min-height: 44px;\s*min-width: 44px;/);
    const shell = readFileSync(new URL("../components/shell.tsx", import.meta.url), "utf8");
    assert.match(shell, /className="tap-targets flex flex-wrap items-center gap-2"/);
    assert.match(shell, /Choose who is working to book or change anything\./);
    assert.match(shell, /Choose who is working first\./);
    assert.match(shell, /tone="danger"/);
    assert.match(shell, /Clear open work now/);
    assert.match(shell, /Sample data resets when you reload\./);
    assert.match(shell, /changeLogLine\(row\)/);
    assert.match(shell, /requestLogLine\(row\)/);
    assert.match(shell, /actor === "service-manager"/);
    const request = readFileSync(new URL("../routes/request.tsx", import.meta.url), "utf8");
    assert.match(request, /tap-targets mt-4 flex flex-wrap gap-2/);
    assert.match(request, /aria-label="Open times"/);
    assert.match(request, /tap-targets flex flex-wrap gap-2/);
    assert.match(request, /That day is full\. Pick another day\./);
    assert.match(request, /advisorForWebRequest/);
    assert.match(request, /Pick a service, a day, a time, and waiter/);
    const schedule = readFileSync(new URL("../routes/schedule.tsx", import.meta.url), "utf8");
    assert.match(schedule, /canAct=\{actor === "advisor" \|\| actor === "service-manager"\}/);
    assert.match(schedule, /className="tap-targets flex flex-wrap items-center gap-2"/);
    assert.match(schedule, /Choose who is working to book or change anything\./);
    assert.match(schedule, /formatVisit\(request\.date, request\.time\)/);
    assert.match(schedule, /openRequests \|\| wantsOnlineRequests\(locationHash\)/);
    const calendar = readFileSync(new URL("../components/appointment-calendar.tsx", import.meta.url), "utf8");
    assert.match(calendar, /aria-label="Change length"[\s\S]*min-h-11 min-w-11/);
    assert.match(calendar, /aria-label="Appointment summary"[\s\S]*min-h-11 min-w-11/);
    assert.match(calendar, /Cancel appointment<\/button>/);
    assert.match(calendar, /min-h-11 min-w-11" onClick=\{\(\) => onEdit/);
    const fees = readFileSync(new URL("../routes/fees.tsx", import.meta.url), "utf8");
    assert.match(fees, /component: guardLocked\(FeesPage\)/);
    const online = readFileSync(new URL("../routes/online-requests.tsx", import.meta.url), "utf8");
    assert.match(online, /<SchedulePage openRequests \/>/);
    const format = readFileSync(new URL("./format.ts", import.meta.url), "utf8");
    assert.equal(format.includes("snap?.phone"), false);
    assert.match(format, /localStamp\(date = now\(\)\)/);
  });
});
