import "./test-dom.ts";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { RepairOrderPrint } from "../components/repair-order-print.tsx";
import { VehicleHistory } from "../components/order-editor.tsx";
import { pinClock, resetClock } from "./clock.ts";
import { repairOrderHeading, vehicleHistoryEntries } from "./ownership.ts";
import { createSeed } from "./seed.ts";
import type { ShopStorage } from "./shop-storage.ts";
import { createShopStore, migrateSavedShop, useShop } from "./store.ts";
import { fullVin } from "./vin.ts";

const flags = globalThis as {
  __RO_CREATION_ENABLED__?: boolean;
  __RO_WRITES_ENABLED__?: boolean;
  __SECTION_LOCK_ENABLED__?: boolean;
};

function memoryStorage(): ShopStorage {
  const items = new Map<string, string>();
  return {
    getItem: (key) => items.get(key) ?? null,
    setItem: (key, value) => { items.set(key, value); },
    removeItem: (key) => { items.delete(key); },
  };
}

function badCheck(vin: string) {
  return `${vin.slice(0, 8)}${vin[8] === "0" ? "1" : "0"}${vin.slice(9)}`;
}

describe("round 13 legal, verifier, and shop floor", () => {
  it("re-points 16 closed seed repair orders and keeps their snapshots", () => {
    const seed = createSeed();
    const host = seed.vehicles[0];
    const affected = seed.orders.filter((row) => row.status === "closed" && row.vehicleId === host.id).slice(0, 16);
    assert.equal(affected.length, 16);
    const duplicateId = "dup-seed-vehicle";
    const moved = new Set(affected.map((row) => row.id));
    const snapshots = new Map(affected.map((row) => [row.id, JSON.stringify(row.closeSnapshot)]));
    const loaded = migrateSavedShop({
      ...seed,
      vehicles: [...seed.vehicles, { ...host, id: duplicateId }],
      orders: seed.orders.map((row) => (moved.has(row.id) ? { ...row, vehicleId: duplicateId } : row)),
    });
    const ids = new Set(loaded.vehicles.map((row) => row.id));
    assert.equal(loaded.orders.every((row) => ids.has(row.vehicleId)), true);
    const survivor = loaded.vehicles.find((row) => row.vin === host.vin);
    assert.ok(survivor);
    assert.equal(loaded.vehicles.filter((row) => row.vin === host.vin).length, 1);
    for (const id of moved) {
      const order = loaded.orders.find((row) => row.id === id);
      assert.equal(order?.vehicleId, survivor.id);
      assert.equal(JSON.stringify(order?.closeSnapshot), snapshots.get(id));
    }
    const log = loaded.ownershipLog?.find((row) => row.vin === host.vin);
    assert.ok(log);
    assert.match(log.reason ?? "", /Merged duplicate VIN/);
    assert.equal(log.at.startsWith("1970"), false);
    assert.equal(survivor.ownership?.[0]?.startedAt.startsWith("1970"), false);
    assert.ok((survivor.ownership?.[0]?.startedAt ?? "") >= "1980");
    const history = vehicleHistoryEntries(loaded.orders, survivor, loaded.customers, loaded.vehicles);
    assert.equal(history.some((row) => row.kind === "divider"), false);
    const closed = loaded.orders.find((row) => row.id === affected[0].id);
    assert.ok(closed);
    const heading = repairOrderHeading(closed, undefined, undefined);
    assert.match(heading, /Ford/);
    assert.equal(heading.endsWith("· Vehicle"), false);
  });

  it("logs a settings change for an advisor and ignores locked fee fields", () => {
    const previous = flags.__SECTION_LOCK_ENABLED__;
    flags.__SECTION_LOCK_ENABLED__ = false;
    try {
      const shop = createShopStore({ demoMode: true, storage: memoryStorage() });
      shop.getState().setWorkingAs("marcus");
      const tax = shop.getState().settings.taxRate;
      shop.getState().updateSettings({ taxRate: tax + 1, storeName: "Tech Shop", cpRate: 1 });
      assert.equal(shop.getState().settings.taxRate, tax);
      assert.equal(shop.getState().settings.storeName === "Tech Shop", false);
      shop.getState().setWorkingAs("megan");
      shop.getState().updateSettings({ taxRate: tax + 1, storeName: "Coulee Desk" });
      assert.equal(shop.getState().settings.taxRate, tax + 1);
      assert.equal(shop.getState().settings.storeName, "Coulee Desk");
      const row = shop.getState().settingsLog?.find((item) => item.field === "Tax rate");
      assert.ok(row);
      assert.equal(row.who, "Megan Cho");
      assert.equal(row.before, String(tax));
      assert.equal(row.after, String(tax + 1));
      assert.ok(row.at);
      const overhead = shop.getState().overhead[0];
      assert.ok(overhead);
      shop.getState().setOverhead(overhead.id, overhead.monthly + 10);
      assert.equal(shop.getState().settingsLog?.some((item) => item.field.startsWith("Overhead") && item.who === "Megan Cho"), true);
      flags.__SECTION_LOCK_ENABLED__ = true;
      const lockedTax = shop.getState().settings.taxRate;
      const lockedRate = shop.getState().settings.cpRate;
      shop.getState().updateSettings({ taxRate: 1, cpRate: 4, fees: [], storeName: "Still Coulee" });
      assert.equal(shop.getState().settings.taxRate, lockedTax);
      assert.equal(shop.getState().settings.cpRate, lockedRate);
      assert.equal(shop.getState().settings.fees.length > 0, true);
      assert.equal(shop.getState().settings.storeName, "Still Coulee");
    } finally {
      flags.__SECTION_LOCK_ENABLED__ = previous;
    }
  });

  it("refuses a bad VIN on the customer form and on an online request", () => {
    const previous = flags.__RO_CREATION_ENABLED__;
    flags.__RO_CREATION_ENABLED__ = true;
    try {
      const shop = createShopStore({ demoMode: true, storage: memoryStorage() });
      shop.getState().setWorkingAs("megan");
      const good = fullVin({ prefix: "1FTAB12C", year: 2019, plant: "G", serial: 70 });
      const digit = badCheck(good);
      assert.match(shop.getState().createCustomer({ name: "Bad Digit", phone: "5095550101", year: 2019, model: "F-150", make: "Ford", vin: digit }).error ?? "", /check digit/);
      assert.match(shop.getState().createCustomer({ name: "Bad Letter", phone: "5095550101", year: 2019, model: "F-150", make: "Ford", vin: "1FTFW1E5O0NFA12345" }).error ?? "", /I, O, or Q/);
      assert.match(shop.getState().openWalkIn({
        name: "Walk In", phone: "5095550102", year: 2019, model: "F-150", make: "Ford", vin: "12345",
        advisorId: "megan", lines: [{ concern: "Oil" }], mileage: 1000, promiseTime: "",
      }).error ?? "", /17/);
      assert.equal(shop.getState().customers.some((row) => row.name === "Bad Digit" || row.name === "Walk In"), false);
      const state = shop.getState();
      const serviceId = state.settings.scheduling.onlineMenu[0].id;
      const saved = state.addOnlineRequest({
        serviceId,
        advisorId: "megan",
        transportId: state.settings.scheduling.transportOptions[0].id,
        date: "2026-11-02",
        time: "09:00",
        verified: false,
        customerName: "Online Bad",
        phone: "5552011999",
        year: 2020,
        make: "Ford",
        model: "Escape",
        vin: digit,
        plate: "BADVIN",
      });
      assert.equal(saved.ok, false);
      if (!saved.ok) assert.equal(saved.reason, "vin");
      const pending = {
        id: "rq-bad-vin",
        storeId: "grand-coulee" as const,
        status: "pending" as const,
        createdAt: "2026-10-30T16:00:00.000Z",
        serviceId,
        serviceName: "Oil",
        laborHours: 1,
        date: "2026-11-02",
        time: "09:00",
        advisorId: "megan",
        advisorName: "Megan Cho",
        techId: "marcus",
        techName: "Marcus Hale",
        transportId: "drop",
        transportName: "Drop",
        contactMethod: "text" as const,
        verified: false,
        customerId: null,
        customerName: "Held Bad",
        phone: "5095550199",
        email: "",
        vehicleId: null,
        year: 2020,
        make: "Ford",
        model: "Escape",
        vin: digit,
        plate: "HELD",
        appointmentId: null,
      };
      shop.setState({ onlineRequests: [pending] });
      const approved = shop.getState().approveOnlineRequest(pending.id, "");
      assert.equal(approved.ok, false);
      if (!approved.ok) assert.equal(approved.reason, "vin");
      assert.equal(shop.getState().onlineRequests[0]?.status, "pending");
    } finally {
      flags.__RO_CREATION_ENABLED__ = previous;
    }
  });

  it("records who ran a day-before reminder and refuses a technician", () => {
    pinClock("2026-10-30T16:00:00.000Z");
    try {
      const shop = createShopStore({ demoMode: true, storage: memoryStorage() });
      const state = shop.getState();
      const visit = state.appointments.find((row) => row.status !== "cancelled");
      assert.ok(visit);
      shop.setState({
        appointments: state.appointments.map((row) => (row.id === visit.id ? { ...row, date: "2026-10-31", status: "scheduled" as const } : row)),
      });
      shop.getState().setWorkingAs("marcus");
      assert.equal(shop.getState().simulateDayBeforeReminders().created, 0);
      shop.setState({ workingAsId: "" });
      assert.equal(shop.getState().simulateDayBeforeReminders().created, 0);
      shop.getState().setWorkingAs("megan");
      const ran = shop.getState().simulateDayBeforeReminders();
      assert.equal(ran.created > 0, true);
      const reminder = shop.getState().notices.find((row) => row.kind === "reminder" && row.appointmentId === visit.id);
      assert.ok(reminder);
      assert.equal(reminder.who, "Megan Cho");
      assert.equal(reminder.whoId, "megan");
    } finally {
      resetClock();
    }
  });

  it("prints the repair-order header fields and keeps new owners off that copy", () => {
    const css = readFileSync(new URL("../styles.css", import.meta.url), "utf8");
    const print = css.slice(css.lastIndexOf("@media print"));
    assert.match(print, /\.ro-print header \{ display: block !important; \}/);
    assert.equal(/aside,\s*header,/.test(print), false);
    const seed = createSeed();
    useShop.setState({ ...seed, focusOrderId: null, activeStoreId: "grand-coulee", stores: { "grand-coulee": seed, pullman: seed } });
    const order = seed.orders.find((row) => row.id === "open-helen");
    assert.ok(order);
    const html = renderToString(createElement(RepairOrderPrint, { orderId: order.id }));
    const text = html.replace(/<!-- -->/g, "");
    assert.match(text, /Jess Ford/);
    assert.match(text, new RegExp(`Repair order ${order.number}`));
    assert.match(text, new RegExp(`Opened ${order.openedOn}`));
    assert.match(text, /Promise/);
    assert.match(text, /Open|Working|Ready/);
    assert.match(text, /Megan Cho/);
    assert.equal(html.includes("New owner"), false);
    const history = renderToString(createElement(VehicleHistory, { vehicleId: order.vehicleId, vin: "" })).replace(/<!-- -->/g, "");
    assert.match(history, /Vehicle history/);
    assert.match(history, new RegExp(`RO ${order.number}`));
  });
});
