import "./test-dom.ts";
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { RepairOrderPrint } from "../components/repair-order-print.tsx";
import { WaAuth } from "../components/wa-auth.tsx";
import { displayRecordedWhen } from "./cancel.ts";
import { migrateSavedShop, createShopStore, useShop } from "./store.ts";
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

describe("round 15", () => {
  it("keeps closed repair orders, logs, and rosters when the shop is cleared", () => {
    const shop = createShopStore({ demoMode: true, storage: memoryStorage() });
    shop.getState().setWorkingAs("derek");
    const closed = shop.getState().orders.filter((row) => row.status === "closed").map((row) => JSON.stringify(row));
    const requestLog = shop.getState().requestLog ?? [];
    shop.getState().clearShop();
    assert.deepEqual(shop.getState().orders.map((row) => JSON.stringify(row)), closed);
    assert.equal(shop.getState().orders.some((row) => row.status !== "closed"), false);
    assert.equal(shop.getState().appointments.length, 0);
    assert.ok(shop.getState().advisors.length > 0);
    assert.ok((shop.getState().techs ?? []).length > 0);
    assert.ok((shop.getState().serviceManagers ?? []).length > 0);
    assert.equal(shop.getState().dataset, "sample");
    assert.equal(shop.getState().workingAsId, "derek");
    const row = shop.getState().settingsLog?.find((item) => item.field === "Clear shop data");
    assert.ok(row);
    const reloaded = migrateSavedShop(JSON.parse(JSON.stringify(shop.getState())));
    assert.equal(reloaded.settingsLog?.some((item) => item.field === "Clear shop data" && item.who === row.who), true);
    assert.equal(JSON.stringify(reloaded.requestLog ?? []), JSON.stringify(requestLog));
    const worker = shop.getState().workingAsId;
    shop.getState().resetDemo(true);
    assert.equal(shop.getState().workingAsId, worker);
  });

  it("stamps a saved closed repair order from the seed header, not the live name", () => {
    const shop = createShopStore({ demoMode: true, storage: memoryStorage() });
    const order = shop.getState().orders.find((row) => row.status === "closed" && row.closeSnapshot?.storeName);
    assert.ok(order);
    const saved = {
      ...shop.getState(),
      settings: { ...shop.getState().settings, storeName: "Renamed Live" },
      orders: shop.getState().orders.map((row) => row.id === order.id
        ? { ...row, closeSnapshot: { ...row.closeSnapshot!, storeName: "" } }
        : row),
    };
    const loaded = migrateSavedShop(saved);
    const stamped = loaded.orders.find((row) => row.id === order.id);
    assert.equal(stamped?.closeSnapshot?.storeName, order.closeSnapshot?.storeName);
    assert.equal(stamped?.closeSnapshot?.storeName?.includes("Renamed Live"), false);
  });

  it("prints Header not recorded when a closed repair order has no store header", () => {
    const order = useShop.getInitialState().orders.find((row) => row.status === "closed" && row.closeSnapshot && !row.closeSnapshot.storeName?.trim());
    assert.ok(order);
    const html = renderToString(createElement(RepairOrderPrint, { orderId: order.id })).replace(/<!-- -->/g, "");
    assert.match(html, /Header not recorded/);
    assert.equal(html.includes("Jess Ford Grand Coulee"), false);
  });

  it("prints the customer copy header from the closed snapshot", () => {
    const order = useShop.getInitialState().orders.find((row) => row.closeSnapshot?.storeName === "Captured At Close");
    assert.ok(order);
    const html = renderToString(createElement(WaAuth, { orderId: order.id })).replace(/<!-- -->/g, "");
    assert.match(html, /Captured At Close/);
    assert.match(html, /Captured Road/);
    assert.equal(html.includes("Jess Ford Grand Coulee"), false);
  });

  it("lets the worker be cleared and refuses a blank worker", () => {
    const shop = createShopStore({ demoMode: true, storage: memoryStorage() });
    assert.equal(shop.getState().workingAsId, "");
    shop.getState().setWorkingAs("megan");
    shop.getState().setWorkingAs("");
    assert.equal(shop.getState().workingAsId, "");
    const before = shop.getState().appointments.length;
    const saved = shop.getState().saveAdvisorAppointment({
      date: "2026-11-02",
      time: "09:00",
      minutes: 60,
      customerId: shop.getState().customers[0].id,
      vehicleId: shop.getState().vehicles[0].id,
      advisorId: "megan",
      techId: "marcus",
      concern: "Oil",
      lines: [{ id: "a", code: "A", concern: "Oil" }],
      vin: "",
      laborOpIds: [],
      lane: "drop",
      status: "scheduled",
    });
    assert.equal(saved.ok, false);
    assert.equal(shop.getState().appointments.length, before);
    assert.equal(shop.getState().settingsLog?.some((row) => row.field === "Appointment"), false);
  });

  it("logs a move, a no-show, and a new appointment for an advisor", () => {
    const shop = createShopStore({ demoMode: true, storage: memoryStorage() });
    shop.getState().setWorkingAs("marcus");
    const row = shop.getState().appointments.find((item) => item.status === "scheduled");
    assert.ok(row);
    assert.equal(shop.getState().moveAppointment(row.id, { time: "12:30" }).ok, false);
    shop.getState().setWorkingAs("megan");
    assert.equal(shop.getState().moveAppointment(row.id, { time: "12:30" }).ok, true);
    assert.equal(shop.getState().settingsLog?.some((item) => item.field === "Move appointment" && item.who === "Megan Cho" && item.after.includes("12:30")), true);
    shop.getState().setAppointmentStatus(row.id, "no_show");
    assert.equal(shop.getState().appointments.find((item) => item.id === row.id)?.status, "no_show");
    assert.equal(shop.getState().settingsLog?.some((item) => item.field === "No-show" && item.after === "no_show"), true);
    const id = shop.getState().addAppointment({
      date: "2026-11-03",
      time: "10:00",
      minutes: 60,
      customerId: row.customerId,
      vehicleId: row.vehicleId,
      advisorId: "megan",
      techId: "marcus",
      concern: "Rotate",
      lines: [{ id: "b", code: "A", concern: "Rotate" }],
      vin: "",
      laborOpIds: [],
      lane: "drop",
    });
    assert.ok(id);
    assert.equal(shop.getState().settingsLog?.some((item) => item.field === "Appointment" && item.after.includes("2026-11-03")), true);
  });

  it("refuses a VIN transfer while a repair order is not closed, including a locked one", () => {
    const shop = createShopStore({ demoMode: true, storage: memoryStorage() });
    shop.getState().setWorkingAs("megan");
    const open = shop.getState().orders.find((row) => row.status !== "closed");
    const editor = shop.getState().orders.find((row) => row.status !== "closed" && row.id !== open?.id && row.customerId !== open?.customerId);
    assert.ok(open && editor);
    const vehicle = shop.getState().vehicles.find((row) => row.id === open.vehicleId);
    assert.ok(vehicle?.vin);
    const refused = shop.getState().updateOpenVin(editor.id, vehicle.vin, true, "Sold the truck to the new owner");
    assert.match(refused.error ?? "", /open repair order/);
    shop.setState({
      orders: shop.getState().orders.map((row) => row.id === open.id ? { ...row, authorizationLocked: true } : row),
    });
    const still = shop.getState().updateOpenVin(editor.id, vehicle.vin, true, "Sold the truck to the new owner");
    assert.match(still.error ?? "", /open repair order/);
  });

  it("refuses an 18-character VIN, a missing contact, and an aliased duplicate", () => {
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
      email: "pat.example@gmail.com",
    };
    const longVin = `${fullVin({ prefix: "1FTAB12C", year: 2020, plant: "G", serial: 41 })}X`;
    assert.equal(submitOnlineRequest(state, { ...base, vin: longVin }, "rq-long", "2026-10-31T16:00:00.000Z").ok, false);
    assert.equal(submitOnlineRequest(state, { ...base, vin: fullVin({ prefix: "1FTAB12C", year: 2020, plant: "G", serial: 42 }), phone: "", email: "" }, "rq-none", "2026-10-31T16:00:00.000Z").ok, false);
    assert.doesNotThrow(() => submitOnlineRequest(state, { ...base, vin: 17 as unknown as string, customerName: 4 as unknown as string }, "rq-bad", "2026-10-31T16:00:00.000Z"));
    const vin = fullVin({ prefix: "1FTAB12C", year: 2020, plant: "G", serial: 43 });
    const pending = {
      id: "rq-a", storeId: state.activeStoreId, status: "pending" as const, createdAt: "2026-10-31T16:00:00.000Z",
      serviceId: base.serviceId, serviceName: "Oil", laborHours: 1, date: base.date, time: base.time,
      advisorId: base.advisorId, advisorName: "Advisor", techId: "marcus", techName: "Tech",
      transportId: base.transportId, transportName: "Drop", contactMethod: "email" as const, verified: false,
      customerId: null, customerName: base.customerName, phone: base.phone, email: base.email, vehicleId: null,
      year: 2020, make: "Ford", model: "Escape", vin, plate: base.plate, appointmentId: null,
    };
    const alias = submitOnlineRequest({ ...state, onlineRequests: [pending, { ...pending, id: "rq-a2" }, { ...pending, id: "rq-a3" }] }, { ...base, email: "patexample+shop@googlemail.com", phone: "", vin: fullVin({ prefix: "1FTAB12C", year: 2020, plant: "G", serial: 44 }) }, "rq-b", "2026-10-31T16:00:00.000Z");
    assert.equal(alias.ok, false);
    if (!alias.ok) assert.equal(alias.reason, "limit");
  });

  it("caps the settings phone at 20 characters", () => {
    const shop = createShopStore({ demoMode: true, storage: memoryStorage() });
    shop.getState().setWorkingAs("megan");
    shop.getState().updateSettings({ phone: "123456789012345678901234" });
    assert.equal(shop.getState().settings.phone.length, 20);
    assert.equal(shop.getState().settingsLog?.filter((row) => row.field === "Shop phone").length, 1);
  });

  it("shows a change-log time in Pacific time", () => {
    const shown = displayRecordedWhen("2026-10-31T20:00:00.000Z");
    assert.equal(shown.includes("2026-10-31T"), false);
    assert.match(shown, /Oct 31, 2026/);
    assert.match(shown, /1:00/);
  });
});
