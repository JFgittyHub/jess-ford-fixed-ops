import "./test-dom.ts";
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { closedHeaderCopy } from "./format.ts";
import { VehicleHistory } from "../components/order-editor.tsx";
import { OnlineRequestList } from "../components/online-request-list.tsx";
import { deskActor } from "./cancel.ts";
import { repairOrderHeading } from "./ownership.ts";
import { devOverridesAllowed } from "./dev-overrides.ts";
import { isLockedPath } from "./section-lock.ts";
import { createSeed } from "./seed.ts";
import type { ShopStorage } from "./shop-storage.ts";
import { createShopStore, useShop } from "./store.ts";
import type { OnlineRequest } from "./types.ts";
import { fullVin, vinScheduleError } from "./vin.ts";

function memoryStorage(): ShopStorage {
  const items = new Map<string, string>();
  return {
    getItem: (key) => items.get(key) ?? null,
    setItem: (key, value) => { items.set(key, value); },
    removeItem: (key) => { items.delete(key); },
  };
}

describe("round 14", () => {
  it("lets only a service manager clear the shop or load the sample month, and logs it", () => {
    const shop = createShopStore({ demoMode: true, storage: memoryStorage() });
    shop.getState().setWorkingAs("megan");
    const before = shop.getState().orders.length;
    shop.getState().clearShop();
    shop.getState().resetDemo(true);
    assert.equal(shop.getState().orders.length, before);
    assert.equal(shop.getState().settingsLog?.some((row) => row.field === "Clear shop data"), false);
    shop.getState().setWorkingAs("derek");
    const worker = shop.getState().workingAsId;
    const closed = shop.getState().orders.filter((row) => row.status === "closed").map((row) => JSON.stringify(row));
    const advisors = shop.getState().advisors.length;
    shop.getState().clearShop();
    assert.ok(closed.length > 0);
    assert.deepEqual(shop.getState().orders.map((row) => JSON.stringify(row)), closed);
    assert.equal(shop.getState().dataset, "sample");
    assert.equal(shop.getState().advisors.length, advisors);
    assert.equal(shop.getState().appointments.length, 0);
    assert.equal(shop.getState().settingsLog?.some((row) => row.who === "Derek Lang" && row.field === "Clear shop data"), true);
    shop.getState().resetDemo(true);
    assert.equal(shop.getState().dataset, "sample");
    assert.equal(shop.getState().workingAsId, worker);
    assert.equal(shop.getState().settingsLog?.some((row) => row.field === "Load sample month" && row.who === "Derek Lang"), true);
  });

  it("logs a scheduling change for an advisor and refuses a technician", () => {
    const shop = createShopStore({ demoMode: true, storage: memoryStorage() });
    shop.getState().setWorkingAs("marcus");
    const hours = JSON.stringify(shop.getState().settings.scheduling.hours);
    shop.getState().updateDayHours(0, { closed: true });
    assert.equal(JSON.stringify(shop.getState().settings.scheduling.hours), hours);
    shop.getState().setWorkingAs("megan");
    assert.equal(shop.getState().addClosedDate("2026-12-24"), true);
    const row = shop.getState().settingsLog?.find((item) => item.field === "Closed date" && item.after === "Thu, Dec 24");
    assert.ok(row);
    assert.equal(row.who, "Megan Cho");
    assert.ok(row.at);
  });

  it("prints the header captured at close, and a fixture header as not recorded", () => {
    const live = { storeName: "LIVE", address: "Live Road", city: "Live", phone: "(555) 000-0000" };
    const captured = closedHeaderCopy({
      status: "closed",
      closeSnapshot: { storeName: "Jess Ford Grand Coulee", storeAddress: "Grand Coulee service drive", storeCity: "Grand Coulee, WA", storePhone: "5556331400", phone: "" },
    }, live);
    assert.equal(captured.name, "Jess Ford Grand Coulee");
    assert.match(captured.line, /Grand Coulee service drive/);
    assert.equal(captured.line.includes("LIVE"), false);
    const fixture = closedHeaderCopy({
      status: "closed",
      closeSnapshot: { storeName: "Captured At Close", storeAddress: "Captured Road", storeCity: "Captured City", storePhone: "5551112222", phone: "5552011400" },
    }, live);
    assert.equal(fixture.name, "Header not recorded");
    assert.equal(fixture.line.includes("Captured"), false);
    assert.equal(fixture.line.includes("201"), false);
  });

  it("keeps vehicle history out of print and off the repair order being viewed", () => {
    const seed = createSeed();
    useShop.setState({ ...seed, focusOrderId: null, activeStoreId: "grand-coulee", stores: { "grand-coulee": seed, pullman: seed } });
    const order = seed.orders.find((row) => row.id === "open-helen");
    assert.ok(order);
    const html = renderToString(createElement(VehicleHistory, { vehicleId: order.vehicleId, vin: "", excludeOrderId: order.id }));
    assert.match(html, /no-print/);
    assert.match(html, /<details>/);
    assert.equal(html.includes(`RO <!-- -->${order.number}`), false);
    assert.match(html, /Vehicle history/);
  });

  it("does not treat a blank worker as the first advisor", () => {
    const shop = createShopStore({ demoMode: true, storage: memoryStorage() });
    shop.setState({ workingAsId: "" });
    assert.equal(deskActor(shop.getState()), "customer");
    shop.setState({ workingAsId: "nobody" });
    assert.equal(deskActor(shop.getState()), "customer");
    const name = shop.getState().settings.storeName;
    shop.getState().updateSettings({ storeName: "Nope" });
    assert.equal(shop.getState().settings.storeName, name);
  });

  it("refuses a VIN transfer while that vehicle has an open repair order", () => {
    const shop = createShopStore({ demoMode: true, storage: memoryStorage() });
    shop.getState().setWorkingAs("megan");
    const order = shop.getState().orders.find((row) => row.status !== "closed");
    const vehicle = shop.getState().vehicles.find((row) => row.id === order?.vehicleId);
    const other = shop.getState().customers.find((row) => row.id !== order?.customerId);
    const otherVehicle = shop.getState().vehicles.find((row) => row.customerId === other?.id);
    assert.ok(order && vehicle && other && otherVehicle);
    const saved = shop.getState().saveAdvisorAppointment({
      date: "2026-10-30", time: "09:00", minutes: 60, customerId: other.id, vehicleId: otherVehicle.id,
      advisorId: "megan", techId: "marcus", concern: "Oil", lines: [{ id: "a", code: "A", concern: "Oil" }],
      vin: vehicle.vin, laborOpIds: [], lane: "drop", status: "scheduled",
    }, undefined, true, "Sold the truck to the new owner");
    assert.match(saved.error ?? "", /open repair order/);
    assert.equal(shop.getState().vehicles.find((row) => row.id === vehicle.id)?.customerId, vehicle.customerId);
  });

  it("checks a bad VIN on its own for length, letters, and the check digit", () => {
    const shop = createShopStore({ demoMode: true, storage: memoryStorage() });
    const base = {
      serviceId: shop.getState().settings.scheduling.onlineMenu[0].id,
      advisorId: "megan",
      transportId: shop.getState().settings.scheduling.transportOptions[0].id,
      date: "2026-11-02",
      time: "09:00",
      verified: false,
      customerName: "Vin Case",
      phone: "5552011888",
      year: 2020,
      make: "Ford",
      model: "Escape",
      plate: "CASE",
    };
    assert.equal(shop.getState().addOnlineRequest({ ...base, vin: "" }).ok, false);
    assert.equal(vinScheduleError("12345"), "VIN has to be 17 characters.");
    assert.match(vinScheduleError("1FTFW1E5O0NFA1234") ?? "", /I, O, or Q/);
    const good = fullVin({ prefix: "1FTAB12C", year: 2019, plant: "G", serial: 90 });
    const digit = `${good.slice(0, 8)}${good[8] === "0" ? "1" : "0"}${good.slice(9)}`;
    assert.match(vinScheduleError(digit) ?? "", /check digit/);
    const refused = shop.getState().addOnlineRequest({ ...base, vin: digit });
    assert.equal(refused.ok, false);
    if (!refused.ok) assert.equal(refused.reason, "vin");
  });

  it("hides approve and decline from a technician", () => {
    const row = {
      id: "rq", storeId: "grand-coulee" as const, status: "pending" as const, createdAt: "2026-10-30T16:00:00.000Z",
      serviceId: "oil", serviceName: "Oil", laborHours: 1, date: "2026-11-02", time: "09:00",
      advisorId: "megan", advisorName: "Megan Cho", techId: "marcus", techName: "Marcus Hale",
      transportId: "drop", transportName: "Drop", contactMethod: "text" as const, verified: false,
      customerId: null, customerName: "Pat", phone: "555", email: "", vehicleId: null, year: 2020, make: "Ford", model: "Escape",
      vin: fullVin({ prefix: "1FTAB12C", year: 2020, plant: "G", serial: 3 }), plate: "P", appointmentId: null,
    } satisfies OnlineRequest;
    const html = renderToString(createElement(OnlineRequestList, { rows: [row], onApprove: () => undefined, onDecline: () => undefined, canAct: false }));
    assert.equal(html.includes("Approve"), false);
    assert.equal(html.includes("Decline"), false);
    assert.match(html, /Only an advisor or service manager/);
  });

  it("uses the closed snapshot year, make, and model in the title", () => {
    const heading = repairOrderHeading({
      status: "closed",
      closeSnapshot: { customerName: "Helen Cho", phone: "", address: "", plate: "", vin: "1", year: 2024, make: "Ford", model: "F-150 XLT" },
    }, undefined, undefined);
    assert.equal(heading, "Helen Cho · 2024 Ford F-150 XLT");
    assert.equal(heading.includes("1970"), false);
  });

  it("logs a capacity override when an online request is approved past a warning", () => {
    const shop = createShopStore({ demoMode: true, storage: memoryStorage() });
    shop.getState().setWorkingAs("megan");
    const request = {
      id: "rq-heavy", storeId: "grand-coulee" as const, status: "pending" as const, createdAt: "2026-10-30T16:00:00.000Z",
      serviceId: "oil", serviceName: "Oil", laborHours: 20, date: "2026-11-02", time: "09:00",
      advisorId: "megan", advisorName: "Megan Cho", techId: "marcus", techName: "Marcus Hale",
      transportId: "drop", transportName: "Drop", contactMethod: "text" as const, verified: false,
      customerId: null, customerName: "Heavy Job", phone: "5095550191", email: "", vehicleId: null, year: 2020, make: "Ford", model: "Escape",
      vin: fullVin({ prefix: "1FTAB12C", year: 2020, plant: "G", serial: 31 }), plate: "HEAVY", appointmentId: null,
    } satisfies OnlineRequest;
    shop.setState({ onlineRequests: [request] });
    const held = shop.getState().approveOnlineRequest(request.id, "");
    assert.equal(held.ok, false);
    if (!held.ok) assert.equal(held.reason, "warning");
    assert.equal(shop.getState().onlineRequests.find((row) => row.id === request.id)?.status, "pending");
    assert.equal(shop.getState().overrides.length, 0);
    const approved = shop.getState().approveOnlineRequest(request.id, "", true);
    assert.equal(approved.ok, true);
    if (approved.ok) assert.match(approved.warning ?? "", /You can still book it/);
    assert.equal(shop.getState().overrides.some((row) => row.appointmentId && row.reason === "tech-hours"), true);
    const blocked = { ...request, id: "rq-off", techId: "not-on-store", customerName: "Off Store", vin: fullVin({ prefix: "1FTAB12C", year: 2020, plant: "G", serial: 32 }) };
    shop.setState({ onlineRequests: [blocked, ...shop.getState().onlineRequests] });
    const refused = shop.getState().approveOnlineRequest(blocked.id, "");
    assert.equal(refused.ok, false);
    if (!refused.ok) {
      assert.equal(refused.reason, "full");
      assert.match(refused.error ?? "", /technician isn't on this store/);
    }
    assert.equal(shop.getState().onlineRequests.find((row) => row.id === "rq-off")?.status, "pending");
  });

  it("ignores a dev lock override in production", () => {
    const previous = process.env.NODE_ENV;
    process.env.NODE_ENV = "production";
    (globalThis as { __SECTION_LOCK_ENABLED__?: boolean }).__SECTION_LOCK_ENABLED__ = false;
    try {
      assert.equal(devOverridesAllowed(), false);
      assert.equal(isLockedPath("/fees"), true);
    } finally {
      process.env.NODE_ENV = previous;
      delete (globalThis as { __SECTION_LOCK_ENABLED__?: boolean }).__SECTION_LOCK_ENABLED__;
    }
  });
});
