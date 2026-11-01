import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { advisorDayCapacity } from "./capacity.ts";
import { createShopStore, migrateSavedShop } from "./store.ts";
import { submitOnlineRequest } from "./online-request.ts";
import type { ShopStorage } from "./shop-storage.ts";
import { fullVin } from "./vin.ts";

function memoryStorage(): ShopStorage {
  const items = new Map<string, string>();
  return {
    getItem: (key) => items.get(key) ?? null,
    setItem: (key, value) => { items.set(key, value); },
    removeItem: (key) => { items.delete(key); },
  };
}

describe("round 16", () => {
  it("logs arrived, in shop, no-show, and put back for an advisor only", () => {
    const shop = createShopStore({ demoMode: true, storage: memoryStorage() });
    const row = shop.getState().appointments.find((item) => item.status === "scheduled");
    assert.ok(row);
    assert.equal(shop.getState().setAppointmentStatus(row.id, "arrived").ok, false);
    shop.getState().setWorkingAs("marcus");
    assert.match(shop.getState().setAppointmentStatus(row.id, "arrived").error ?? "", /advisor or service manager/);
    shop.getState().setWorkingAs("megan");
    assert.equal(shop.getState().setAppointmentStatus(row.id, "arrived").ok, true);
    assert.match(shop.getState().settingsLog?.find((item) => item.field === "Arrived")?.after ?? "", /Marked arrived/);
    assert.equal(shop.getState().setAppointmentStatus(row.id, "in_shop").ok, true);
    assert.equal(shop.getState().setAppointmentStatus(row.id, "no_show").ok, true);
    const shows = shop.getState().customers.find((item) => item.id === row.customerId)?.noShows ?? 0;
    assert.equal(shop.getState().setAppointmentStatus(row.id, "scheduled").ok, true);
    const putBack = shop.getState().settingsLog?.find((item) => item.field === "Put back");
    assert.match(putBack?.after ?? "", /no-show count goes down/);
    assert.equal(shop.getState().customers.find((item) => item.id === row.customerId)?.noShows, shows - 1);
    shop.getState().setWorkingAs("");
    assert.equal(shop.getState().setAppointmentStatus(row.id, "no_show").ok, false);
  });

  it("refuses a move from a technician and logs the move", () => {
    const shop = createShopStore({ demoMode: true, storage: memoryStorage() });
    const row = shop.getState().appointments.find((item) => item.status === "scheduled");
    assert.ok(row);
    shop.getState().setWorkingAs("marcus");
    assert.equal(shop.getState().moveAppointment(row.id, { time: "12:00" }).ok, false);
    shop.getState().setWorkingAs("megan");
    assert.equal(shop.getState().moveAppointment(row.id, { time: "12:00", techId: "elena" }).ok, true);
    const logged = shop.getState().settingsLog?.find((item) => item.field === "Move appointment");
    assert.match(logged?.after ?? "", /Elena/);
    assert.match(logged?.after ?? "", /PT/);
  });

  it("lets an advisor add a closed date and refuses a technician", () => {
    const shop = createShopStore({ demoMode: true, storage: memoryStorage() });
    shop.getState().setWorkingAs("marcus");
    const before = JSON.stringify(shop.getState().settings.scheduling);
    shop.getState().updateDayHours(1, { closed: true });
    assert.equal(shop.getState().addClosedDate("2026-12-24"), false);
    shop.getState().removeClosedDate("2026-12-25");
    shop.getState().updateBookingWindow({ daysAhead: 3, minLeadHours: 2 });
    shop.getState().addOnlineService({ name: "Nope", laborHours: 1 });
    shop.getState().addTransportOption("Nope");
    assert.equal(JSON.stringify(shop.getState().settings.scheduling), before);
    shop.getState().setWorkingAs("megan");
    assert.equal(shop.getState().addClosedDate("2026-12-24"), true);
    assert.equal(shop.getState().settingsLog?.some((row) => row.field === "Closed date" && row.who === "Megan Cho"), true);
  });

  it("leaves a blank closed header blank when a saved shop is loaded", () => {
    const blank = {
      settings: { storeName: "Jess Ford Grand Coulee", scheduling: { hours: [], closedDates: [], bookingWindow: { daysAhead: 1, minLeadHours: 0 }, onlineMenu: [], transportOptions: [] } },
      orders: [{ id: "h241202", status: "closed", closeSnapshot: { customerName: "A", phone: "", address: "", plate: "", vin: "", year: 2020, make: "Ford", model: "F-150", storeName: "" }, jobs: [], labor: [], parts: [], customerId: "c", vehicleId: "v", concern: "", mileage: 1, openedOn: "2026-10-01" }],
      customers: [],
      vehicles: [],
    };
    const before = JSON.stringify(blank.orders[0]);
    const first = migrateSavedShop(blank);
    assert.equal(JSON.stringify(first.orders[0]), before);
    assert.equal(first.orders[0]?.closeSnapshot?.storeName, "");
    assert.equal(advisorDayCapacity(createShopStore({ demoMode: true, storage: memoryStorage() }).getState().settings.scheduling, "2026-11-02") > 0, true);
  });

  it("refuses a missing date and a request once that advisor's day is full", () => {
    const shop = createShopStore({ demoMode: true, storage: memoryStorage() });
    const state = shop.getState();
    const base = {
      serviceId: state.settings.scheduling.onlineMenu[0].id,
      date: "2026-11-02",
      time: "09:00",
      advisorId: state.advisors[0].id,
      transportId: state.settings.scheduling.transportOptions[0].id,
      verified: false,
      customerName: "Pat Example",
      year: 2020,
      make: "Ford",
      model: "Escape",
      plate: "ABC123",
      phone: "5095550199",
      email: "pat@example.com",
    };
    const missing = submitOnlineRequest(state, { ...base, date: "", vin: fullVin({ prefix: "1FTAB12C", year: 2020, plant: "G", serial: 51 }) }, "rq-date", "2026-10-31T16:00:00.000Z");
    assert.equal(missing.ok, false);
    if (!missing.ok) assert.equal(missing.reason, "date");
    const cap = advisorDayCapacity(state.settings.scheduling, "2026-11-02");
    const pending = Array.from({ length: Math.max(0, cap - 1) }, (_, index) => ({
      id: `rq-${index}`, storeId: state.activeStoreId, status: "pending" as const, createdAt: "2026-10-31T16:00:00.000Z",
      serviceId: base.serviceId, serviceName: "Oil", laborHours: 0.3, date: "2026-11-02", time: "09:00",
      advisorId: base.advisorId, advisorName: "Advisor", techId: "marcus", techName: "Tech",
      transportId: base.transportId, transportName: "Drop", contactMethod: "text" as const, verified: false,
      customerId: null, customerName: `Person ${index}`, phone: `5095550${String(200 + index).padStart(3, "0")}`, email: `p${index}@example.com`,
      vehicleId: null, year: 2020, make: "Ford", model: "Escape", vin: fullVin({ prefix: "1FTAB12C", year: 2020, plant: "G", serial: 60 + index }),
      plate: "A", appointmentId: null,
    }));
    const held = submitOnlineRequest({ ...state, onlineRequests: pending }, { ...base, phone: "509-555-0199 x12", email: "pat+shop@example.com", vin: fullVin({ prefix: "1FTAB12C", year: 2020, plant: "G", serial: 90 }) }, "rq-cap", "2026-10-31T16:00:00.000Z");
    assert.equal(held.ok, false);
    if (!held.ok) assert.equal(held.reason, "limit");
  });

  it("keeps the current owner of a closed vehicle after clear", () => {
    const shop = createShopStore({ demoMode: true, storage: memoryStorage() });
    shop.getState().setWorkingAs("derek");
    const closed = shop.getState().orders.find((row) => row.status === "closed");
    assert.ok(closed);
    const vehicle = shop.getState().vehicles.find((row) => row.id === closed.vehicleId);
    assert.ok(vehicle);
    shop.setState({
      customers: [...shop.getState().customers, { id: "new-owner", name: "New Owner", phone: "5095550191", mobile: "", email: "new@example.com", noShows: 0 }],
      vehicles: shop.getState().vehicles.map((row) => row.id === vehicle.id ? { ...row, customerId: "new-owner" } : row),
    });
    shop.getState().clearShop();
    assert.equal(shop.getState().customers.some((row) => row.id === "new-owner"), true);
    assert.equal(shop.getState().vehicles.find((row) => row.id === vehicle.id)?.customerId, "new-owner");
  });
});
