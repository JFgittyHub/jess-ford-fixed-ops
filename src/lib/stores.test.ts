import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { textingAdapter } from "./adapters/texting.ts";
import { createSeed } from "./seed.ts";
import type { ShopStorage } from "./shop-storage.ts";
import { addOnlineService, addTransportOption, normalizeScheduling, removeTransportOption } from "./scheduling.ts";
import { createShopStore } from "./store.ts";
import { isFullVin, vinCheckDigit } from "./vin.ts";

describe("two stores", () => {
  it("keeps customers, staff, vehicles, appointments, and repair orders apart", () => {
    const shop = createShopStore({ demoMode: true, storage: memoryStorage() });
    const coulee = snapshot(shop.getState());
    assert.equal(shop.getState().activeStoreId, "grand-coulee");
    assert.equal(coulee.customers.some((row) => row.name === "Helen Cho"), true);
    assert.equal(coulee.customers.some((row) => row.mobile === ""), true);
    assert.equal(coulee.customers.every((row) => row.email.endsWith("@example.com")), true);

    shop.getState().switchStore("pullman");
    const pullman = snapshot(shop.getState());
    assert.equal(shop.getState().activeStoreId, "pullman");
    assert.equal(pullman.customers.some((row) => row.name === "Marisol Vega"), true);
    assert.equal(pullman.customers.some((row) => row.mobile === ""), true);
    assertNoOverlap(coulee.customers.map((row) => row.id), pullman.customers.map((row) => row.id));
    assertNoOverlap(coulee.customers.map((row) => row.name), pullman.customers.map((row) => row.name));
    assertNoOverlap(coulee.advisors.map((row) => row.id), pullman.advisors.map((row) => row.id));
    assertNoOverlap(coulee.advisors.map((row) => row.name), pullman.advisors.map((row) => row.name));
    assertNoOverlap(coulee.techs.map((row) => row.id), pullman.techs.map((row) => row.id));
    assertNoOverlap(coulee.techs.map((row) => row.name), pullman.techs.map((row) => row.name));
    assertNoOverlap(coulee.vehicles.map((row) => row.id), pullman.vehicles.map((row) => row.id));
    assertNoOverlap(coulee.vehicles.map((row) => row.vin), pullman.vehicles.map((row) => row.vin));
    assertNoOverlap(coulee.appointments.map((row) => row.id), pullman.appointments.map((row) => row.id));
    assertNoOverlap(coulee.orders.map((row) => row.id), pullman.orders.map((row) => row.id));

    for (const store of [coulee, pullman]) {
      assert.equal(store.vehicles.every((row) => isFullVin(row.vin)), true);
      assert.equal(store.vehicles.every((row) => vinCheckDigit(row.vin) === row.vin[8]), true);
      const last8 = store.vehicles.map((row) => row.vin.slice(-8));
      assert.equal(new Set(last8).size, last8.length);
    }

    const created = shop.getState().createCustomer({ name: "Pullman Only", phone: "5553329999", year: 2021, model: "Escape" });
    assert.equal(shop.getState().customers.some((row) => row.id === created.customerId), true);
    shop.getState().switchStore("grand-coulee");
    assert.equal(shop.getState().customers.some((row) => row.name === "Pullman Only"), false);
    assert.equal(shop.getState().customers.some((row) => row.name === "Helen Cho"), true);
    shop.getState().switchStore("pullman");
    assert.equal(shop.getState().customers.some((row) => row.name === "Pullman Only"), true);
    assert.equal(shop.getState().customers.some((row) => row.name === "Helen Cho"), false);
  });

  it("keeps scheduling settings on the store that edited them", () => {
    const shop = createShopStore({ demoMode: true, storage: memoryStorage() });
    const couleeWindow = shop.getState().settings.scheduling.bookingWindow.daysAhead;
    const couleeSaturday = shop.getState().settings.scheduling.hours[6]?.close;
    assert.equal(couleeWindow, 21);
    assert.equal(couleeSaturday, "13:00");
    assert.deepEqual(shop.getState().settings.scheduling.closedDates, ["2026-11-26", "2026-12-25"]);
    assert.deepEqual(
      shop.getState().settings.scheduling.transportOptions.map((row) => row.name),
      ["Waiter", "Drop-off"],
    );
    assert.equal(shop.getState().settings.scheduling.onlineMenu.every((row) => !("price" in row)), true);

    shop.getState().switchStore("pullman");
    assert.equal(shop.getState().settings.scheduling.bookingWindow.daysAhead, 14);
    assert.equal(shop.getState().settings.scheduling.bookingWindow.minLeadHours, 4);
    assert.equal(shop.getState().settings.scheduling.hours[6]?.close, "16:00");
    assert.deepEqual(shop.getState().settings.scheduling.closedDates, ["2026-11-27", "2026-12-24"]);
    assert.equal(shop.getState().settings.storeName, "Jess Ford Pullman");

    shop.getState().updateBookingWindow({ daysAhead: 9, minLeadHours: 6 });
    shop.getState().updateDayHours(6, { close: "12:00" });
    assert.equal(shop.getState().addClosedDate("2026-12-31"), true);
    assert.equal(shop.getState().addOnlineService({ name: "Battery test", laborHours: 0.3 }), true);
    assert.equal(shop.getState().addOnlineService({ name: "Battery test", laborHours: 0 }), false);
    assert.equal(shop.getState().addTransportOption("Shuttle"), true);
    assert.equal(shop.getState().addTransportOption("shuttle"), false);
    const shuttle = shop.getState().settings.scheduling.transportOptions.find((row) => row.name === "Shuttle");
    assert.ok(shuttle);
    assert.equal(shop.getState().settings.scheduling.onlineMenu.some((row) => "price" in row), false);

    shop.getState().switchStore("grand-coulee");
    assert.equal(shop.getState().settings.scheduling.bookingWindow.daysAhead, 21);
    assert.equal(shop.getState().settings.scheduling.hours[6]?.close, "13:00");
    assert.equal(shop.getState().settings.scheduling.closedDates.includes("2026-12-31"), false);
    assert.equal(shop.getState().settings.scheduling.transportOptions.some((row) => row.name === "Shuttle"), false);
    assert.equal(shop.getState().settings.scheduling.onlineMenu.some((row) => row.name === "Battery test"), false);

    shop.getState().switchStore("pullman");
    assert.equal(shop.getState().settings.scheduling.bookingWindow.daysAhead, 9);
    assert.equal(shop.getState().settings.scheduling.hours[6]?.close, "12:00");
    assert.equal(shop.getState().settings.scheduling.transportOptions.some((row) => row.name === "Shuttle"), true);
  });
});

describe("scheduling helpers", () => {
  it("drops a price if one is passed in, and will not empty the transport list", () => {
    const scheduling = normalizeScheduling({
      onlineMenu: [{ id: "x", name: "Oil", laborHours: 0.5, price: 49 }],
      transportOptions: [{ id: "waiter", name: "Waiter" }],
    });
    assert.equal("price" in scheduling.onlineMenu[0], false);
    assert.equal(scheduling.onlineMenu[0]?.laborHours, 0.5);
    assert.equal(removeTransportOption(scheduling, "waiter"), null);
    const withShuttle = addTransportOption(scheduling, "Loaner", "loaner");
    assert.ok(withShuttle);
    assert.deepEqual(withShuttle.transportOptions.map((row) => row.name), ["Waiter", "Loaner"]);
    assert.equal(addOnlineService(scheduling, { name: "", laborHours: 1 }, "nope"), null);
  });
});

describe("texting adapter", () => {
  it("is off and delivers nothing", () => {
    assert.equal(textingAdapter.enabled, false);
    const result = textingAdapter.send({ to: "5552011400", body: "Code 123456", purpose: "one-time-code" });
    assert.deepEqual(result, { delivered: false, reason: "adapter-off" });
  });
});

describe("sample seeds", () => {
  it("builds each store on its own", () => {
    const coulee = createSeed("grand-coulee");
    const pullman = createSeed("pullman");
    assert.equal(coulee.settings.storeName, "Jess Ford Grand Coulee");
    assert.equal(pullman.settings.storeName, "Jess Ford Pullman");
    assert.notEqual(coulee.settings.scheduling.bookingWindow.daysAhead, pullman.settings.scheduling.bookingWindow.daysAhead);
    coulee.customers.push({ id: "extra", name: "Extra", phone: "", mobile: "", email: "extra@example.com" });
    assert.equal(pullman.customers.some((row) => row.id === "extra"), false);
  });
});

function snapshot(state: { customers: { id: string; name: string; mobile: string; email: string }[]; advisors: { id: string; name: string }[]; techs: { id: string; name: string }[]; vehicles: { id: string; vin: string }[]; appointments: { id: string }[]; orders: { id: string }[] }) {
  return {
    customers: state.customers.map((row) => ({ ...row })),
    advisors: state.advisors.map((row) => ({ ...row })),
    techs: state.techs.map((row) => ({ ...row })),
    vehicles: state.vehicles.map((row) => ({ ...row })),
    appointments: state.appointments.map((row) => ({ ...row })),
    orders: state.orders.map((row) => ({ ...row })),
  };
}

function assertNoOverlap(left: string[], right: string[]) {
  const other = new Set(right);
  for (const id of left) assert.equal(other.has(id), false, id);
}

function memoryStorage(): ShopStorage {
  const items = new Map<string, string>();
  return {
    getItem: (key) => items.get(key) ?? null,
    setItem: (key, value) => {
      items.set(key, value);
    },
    removeItem: (key) => {
      items.delete(key);
    },
  };
}
