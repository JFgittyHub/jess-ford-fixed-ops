import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import { lengthHandleRange, planCalendarDrag } from "../components/appointment-calendar.tsx";
import { changeLogLine, requestLogLine } from "./cancel.ts";
import { advisorDayCapacity } from "./capacity.ts";
import { pinClock, resetClock, todayIso } from "./clock.ts";
import { lastVisitHint, lastVisitMileage } from "./mileage.ts";
import { advisorForWebRequest, cleanFreeText, phoneKey, submitOnlineRequest } from "./online-request.ts";
import { mergeVinDuplicates } from "./ownership.ts";
import { clampMileageForward, createSeed } from "./seed.ts";
import type { ShopStorage } from "./shop-storage.ts";
import { createShopStore } from "./store.ts";
import type { RepairOrder, SettingsChange } from "./types.ts";
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

describe("round 18 calendar drag", () => {
  it("moves a 30-minute and a 60-minute card from the center without changing length", () => {
    for (const minutes of [30, 60]) {
      const range = lengthHandleRange(minutes);
      assert.equal(range.center >= range.top && range.center < range.bottom, false);
      const moved = planCalendarDrag({
        mode: "move",
        time: "09:00",
        minutes,
        techId: "marcus",
        dx: 0,
        dy: 32,
        techIds: ["marcus", "elena"],
        colWidth: 140,
      });
      assert.equal(moved.minutes, minutes);
      assert.equal(moved.time, "09:30");
      assert.equal(moved.techId, "marcus");
      const sideways = planCalendarDrag({
        mode: "move",
        time: "09:00",
        minutes,
        techId: "marcus",
        dx: 140,
        dy: 0,
        techIds: ["marcus", "elena"],
        colWidth: 140,
      });
      assert.equal(sideways.minutes, minutes);
      assert.equal(sideways.techId, "elena");
      assert.equal(sideways.time, "09:00");
    }
  });

  it("changes length only from the handle and logs Length, not Moved", () => {
    const resized = planCalendarDrag({
      mode: "resize",
      time: "09:00",
      minutes: 30,
      techId: "marcus",
      dx: 20,
      dy: 64,
      techIds: ["marcus", "elena"],
      colWidth: 140,
    });
    assert.equal(resized.time, "09:00");
    assert.equal(resized.techId, "marcus");
    assert.equal(resized.minutes, 90);
    const shop = createShopStore({ demoMode: true, storage: memoryStorage() });
    shop.getState().setWorkingAs("megan");
    const row = shop.getState().appointments.find((item) => item.date >= todayIso() && item.status === "scheduled") ?? shop.getState().appointments[0];
    assert.ok(row);
    const before = row.minutes;
    const result = shop.getState().moveAppointment(row.id, { minutes: before + 60, time: row.time, techId: row.techId });
    assert.equal(result.ok, true, result.error ?? "");
    const logged = shop.getState().settingsLog?.find((item) => item.field === "Length");
    assert.match(logged?.after ?? "", /Length: .+ → /);
    assert.equal((logged?.after ?? "").includes("Moved"), false);
    assert.match(changeLogLine(logged as SettingsChange), new RegExp(`^${logged?.who} · Length: `));
  });
});

describe("round 18 change log and edits", () => {
  it("puts the actor on every change-log row and keeps blank values as removed", () => {
    const row: SettingsChange = { at: "2026-11-01T20:00:00.000Z", who: "Megan Cho", whoId: "megan", field: "Store name", before: "A", after: "" };
    const line = changeLogLine(row);
    assert.match(line, /^Megan Cho · Store name: A → removed · .+ PT$/);
    assert.equal(line.includes("2026-11-01T20:00"), false);
    const sentence = changeLogLine({ ...row, field: "Cancel appointment", before: "", after: "Cancelled Pat for Mon, Nov 2, 9:00 AM PT" });
    assert.match(sentence, /^Megan Cho · Cancelled Pat for Mon, Nov 2, 9:00 AM PT · .+ PT$/);
    const visit = requestLogLine({ at: row.at, who: "Megan Cho", whoId: "megan", requestId: "rq-1", action: "approved", customerName: "Pat Example", visit: "Thu, Nov 12, 9:00 AM PT" });
    assert.match(visit, /approved Pat Example for Thu, Nov 12, 9:00 AM PT/);
  });

  it("logs length, lane, and labor once, and skips an unchanged time", () => {
    const shop = createShopStore({ demoMode: true, storage: memoryStorage() });
    shop.getState().setWorkingAs("megan");
    const row = shop.getState().appointments.find((item) => item.status === "scheduled" && item.date >= todayIso());
    assert.ok(row);
    const same = shop.getState().updateAppointment(row.id, { time: row.time, date: row.date });
    assert.equal(same.ok, true);
    assert.equal(shop.getState().settingsLog?.some((item) => item.field === "Appointment edited" || item.field === "Length"), false);
    const lane = row.lane === "drop" ? "waiter" : "drop";
    const op = shop.getState().laborOps[0];
    const edited = shop.getState().updateAppointment(row.id, { minutes: row.minutes + 30, lane, laborOpIds: [op.id] });
    assert.equal(edited.ok, true, edited.error ?? "");
    const lines = shop.getState().settingsLog ?? [];
    assert.equal(lines.filter((item) => item.field === "Length").length, 1);
    assert.match(lines.find((item) => item.field === "Length")?.after ?? "", /Length: .+ for /);
    assert.equal(lines.some((item) => item.after.includes("lane") && item.after.includes("for ")), true);
    assert.equal(lines.some((item) => item.after.includes("labor") && item.after.includes(op.opcode)), true);
    assert.equal(lines.some((item) => item.after.includes(row.date)), false);
    shop.getState().setWorkingAs("marcus");
    const refused = shop.getState().updateAppointment(row.id, { minutes: 90 });
    assert.equal(refused.ok, false);
    assert.equal(shop.getState().appointments.find((item) => item.id === row.id)?.minutes, row.minutes + 30);
    shop.getState().setWorkingAs("");
    assert.equal(shop.getState().updateAppointment(row.id, { lane: "drop" }).ok, false);
  });

  it("refuses a vehicle that belongs to another customer and names an approved request", () => {
    const shop = createShopStore({ demoMode: true, storage: memoryStorage() });
    shop.getState().setWorkingAs("megan");
    const row = shop.getState().appointments.find((item) => item.date >= todayIso()) ?? shop.getState().appointments[0];
    const other = shop.getState().vehicles.find((vehicle) => vehicle.customerId !== row.customerId);
    assert.ok(other);
    const refused = shop.getState().updateAppointment(row.id, { vehicleId: other.id });
    assert.match(refused.error ?? "", /another customer/);
    assert.equal(shop.getState().appointments.find((item) => item.id === row.id)?.vehicleId, row.vehicleId);
    const vin = fullVin({ prefix: "1FTAB12C", year: 2020, plant: "G", serial: 44 });
    shop.setState({
      onlineRequests: [{
        id: "rq-name", storeId: "grand-coulee", status: "pending", createdAt: "2026-10-31T16:00:00.000Z",
        serviceId: shop.getState().settings.scheduling.onlineMenu[0].id, serviceName: "Oil", laborHours: 0.5,
        date: "2026-11-03", time: "09:00", advisorId: "megan", advisorName: "Megan Cho", techId: "marcus", techName: "Marcus Hale",
        transportId: "drop", transportName: "Drop", contactMethod: "text", verified: false, customerId: null,
        customerName: "Pat Example", phone: "5095550199", email: "", vehicleId: null, year: 2020, make: "Ford", model: "Escape",
        vin, plate: "PAT123", appointmentId: null,
      }],
    });
    const approved = shop.getState().approveOnlineRequest("rq-name", "", true);
    assert.equal(approved.ok, true, "reason" in approved ? approved.reason : "");
    assert.match(shop.getState().requestLog?.[0]?.customerName ?? "", /Pat Example/);
  });

  it("does not log hours when the day is saved unchanged", () => {
    const shop = createShopStore({ demoMode: true, storage: memoryStorage() });
    shop.getState().setWorkingAs("megan");
    const hours = shop.getState().settings.scheduling.hours.find((row) => row.weekday === 1);
    assert.ok(hours);
    shop.getState().updateDayHours(1, { open: hours.open, close: hours.close, closed: hours.closed });
    assert.equal(shop.getState().settingsLog?.some((row) => row.field.startsWith("Hours")), false);
  });
});

describe("round 18 contacts, mileage, and last visit", () => {
  it("keeps josé, drops a leading 9 and bidi, and keys a foreign country code on its own digits", () => {
    assert.equal(cleanFreeText("josé"), "josé");
    assert.equal(cleanFreeText("jo\u00ADse\u202E"), "jose");
    assert.equal(phoneKey("15095550300"), phoneKey("5095550300"));
    assert.equal(phoneKey("95095550300"), "5095550300");
    assert.equal(phoneKey("５０９５５５０３００"), "5095550300");
    assert.equal(phoneKey("+52 509 555 0300"), "+525095550300");
    assert.notEqual(phoneKey("+52 509 555 0300"), phoneKey("5095550300"));
    const state = { ...createSeed(), activeStoreId: "grand-coulee" as const };
    const at = "2026-10-31T16:00:00.000Z";
    const base = {
      serviceId: state.settings.scheduling.onlineMenu[0].id,
      date: "2026-11-03",
      time: "09:00",
      advisorId: state.advisors[0].id,
      transportId: state.settings.scheduling.transportOptions[0].id,
      verified: false,
      customerName: "Pat\u202E Example",
      year: 2020,
      make: "Ford",
      model: "Escape",
      plate: "ABC123",
      phone: "(509) 555-0300",
      email: "pat@example.com",
      vin: fullVin({ prefix: "1FTAB12C", year: 2020, plant: "G", serial: 70 }),
    };
    const saved = submitOnlineRequest(state, base, "rq-bidi", at);
    assert.equal(saved.ok, true, JSON.stringify(saved));
    if (saved.ok) assert.equal(saved.request.customerName.includes("\u202E"), false);
    const cap = advisorDayCapacity(state.settings.scheduling, "2026-11-03");
    const pending = Array.from({ length: Math.max(0, cap - 1) }, (_, index) => ({
      id: `hold-${index}`, storeId: state.activeStoreId, status: "pending" as const, createdAt: at,
      serviceId: base.serviceId, serviceName: "Oil", laborHours: 0.3, date: "2026-11-03", time: "09:00",
      advisorId: base.advisorId, advisorName: "A", techId: "marcus", techName: "T",
      transportId: base.transportId, transportName: "Drop", contactMethod: "text" as const, verified: false,
      customerId: null, customerName: `P${index}`, phone: `509555${String(7000 + index).slice(-4)}`, email: `p${index}@example.com`,
      vehicleId: null, year: 2020, make: "Ford", model: "Escape", vin: fullVin({ prefix: "1FTAB12C", year: 2020, plant: "G", serial: 400 + index }),
      plate: "A", appointmentId: null,
    }));
    const full = submitOnlineRequest({ ...state, onlineRequests: pending }, { ...base, phone: "5095550888", email: "fresh@example.com", vin: fullVin({ prefix: "1FTAB12C", year: 2020, plant: "G", serial: 499 }) }, "rq-day", at);
    assert.equal(full.ok, false);
    if (!full.ok) assert.deepEqual({ reason: full.reason, scope: full.scope }, { reason: "limit", scope: "day" });
    const picked = advisorForWebRequest(
      [{ id: "a", name: "A" }, { id: "b", name: "B" }],
      [{ advisorId: "a", date: "2026-11-03", status: "approved" }, { advisorId: "b", date: "2026-11-03", status: "pending" }],
      "2026-11-03",
      5,
    );
    assert.equal(picked, "a");
  });

  it("raises a backward mileage pair and ignores a 1970 summer visit", () => {
    const rows = [{ mileage: 100 }, { mileage: 40 }, { mileage: 200 }];
    clampMileageForward(rows);
    assert.deepEqual(rows.map((row) => row.mileage), [100, 117, 200]);
    const vin = fullVin({ prefix: "1FTAB12C", year: 2018, plant: "G", serial: 19 });
    const merged = mergeVinDuplicates(
      [
        { id: "va", customerId: "ca", year: 2018, make: "Ford", model: "F-150", vin },
        { id: "vb", customerId: "ca", year: 2018, make: "Ford", model: "", vin },
      ],
      [
        { id: "old", vehicleId: "vb", customerId: "ca", openedAt: "1970-06-15T16:00:00.000Z", openedOn: "1970-06-15", number: 1, status: "closed" },
        { id: "real", vehicleId: "vb", customerId: "ca", openedAt: "2026-10-02T16:00:00.000Z", openedOn: "2026-10-02", number: 2, status: "closed" },
      ] as RepairOrder[],
    );
    assert.equal(merged.vehicles[0]?.ownership?.some((span) => span.startedAt.startsWith("1970")), false);
  });

  it("freezes the last visit from closed repair orders when a newer open ticket exists", () => {
    const vehicle = { id: "v-lv", vin: fullVin({ prefix: "1FTAB12C", year: 2019, plant: "G", serial: 33 }) };
    const orders = [
      { id: "closed-old", number: 1, vehicleId: "v-lv", mileage: 1000, mileageOut: 84201, openedOn: "2026-10-01", openedAt: "2026-10-01T16:00:00.000Z", status: "closed" as const },
      { id: "open-new", number: 2, vehicleId: "v-lv", mileage: 90000, mileageOut: null, openedOn: "2026-10-20", openedAt: "2026-10-20T16:00:00.000Z", status: "open" as const },
    ];
    const closedOnly = lastVisitMileage([{ vehicles: [vehicle], orders }], vehicle, { closedOnly: true, excludeOrderId: "closing", openedAt: "2026-10-21T16:00:00.000Z", openedOn: "2026-10-21", number: 3 });
    const anyVisit = lastVisitMileage([{ vehicles: [vehicle], orders }], vehicle, { excludeOrderId: "closing", openedAt: "2026-10-21T16:00:00.000Z", openedOn: "2026-10-21", number: 3 });
    assert.equal(lastVisitHint(closedOnly), "Last visit: left at 84,201 mi on Oct 1, 2026.");
    assert.equal(anyVisit?.orderId, "open-new");
    pinClock("2026-10-19T19:00:00.000Z");
    const shop = createShopStore({ demoMode: true, storage: memoryStorage() });
    shop.getState().setWorkingAs("megan");
    const helen = shop.getState().orders.find((row) => row.id === "open-helen");
    assert.ok(helen);
    const helenVehicle = shop.getState().vehicles.find((row) => row.id === helen.vehicleId);
    assert.ok(helenVehicle);
    shop.setState({
      vehicles: [...shop.getState().vehicles, { ...helenVehicle, id: "v-lv3", vin: fullVin({ prefix: "1FTAB12C", year: 2019, plant: "G", serial: 8803 }) }],
      orders: [
        ...shop.getState().orders.map((row) => row.id === "open-helen"
          ? { ...row, vehicleId: "v-lv3", status: "booked" as const, mileage: 91000, mileageOut: 91004, openedAt: "2026-10-18T16:00:00.000Z", openedOn: "2026-10-18", parts: row.parts.map((line) => ({ ...line, condition: "new" as const })), wa: { choice: "cap" as const, initials: "HC", date: "2026-10-19", time: "09:00", estimate: 0, cap: 50000, returnParts: false, plate: "", address: "100 Main Street", extras: [] } }
          : row),
        { ...helen, id: "prior-closed", vehicleId: "v-lv3", number: 999000, status: "closed" as const, openedAt: "2026-10-01T16:00:00.000Z", openedOn: "2026-10-01", mileage: 80000, mileageOut: 84201, authorizationLocked: true },
        { ...helen, id: "prior-open", vehicleId: "v-lv3", number: 999001, status: "open" as const, openedAt: "2026-10-10T16:00:00.000Z", openedOn: "2026-10-10", mileage: 90000, mileageOut: null, closeSnapshot: undefined, authorizationLocked: false },
      ],
    });
    const closed = shop.getState().closeOrder("open-helen");
    assert.equal(closed.ok, true, closed.error ?? "");
    const note = shop.getState().orders.find((row) => row.id === "open-helen")?.closeSnapshot?.lastVisitNote ?? "";
    assert.equal(note, "Last visit: left at 84,201 mi on Oct 1, 2026.");
    assert.equal(note.includes("90,000"), false);
  });
});
