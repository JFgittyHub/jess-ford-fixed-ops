import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { NoShowMark } from "../components/no-show-mark.tsx";
import { noShowSuffix } from "./no-show-label.ts";
import type { ShopStorage } from "./shop-storage.ts";
import { createShopStore } from "./store.ts";
import type { Appointment } from "./types.ts";

describe("No-show", () => {
  it("marks the appointment and leaves the flag on the customer at that store", () => {
    const shop = createShopStore({ demoMode: true, storage: memoryStorage() });
    const helen = shop.getState().customers.find((row) => row.name === "Helen Cho");
    assert.ok(helen);
    const vehicle = shop.getState().vehicles.find((row) => row.customerId === helen.id);
    assert.ok(vehicle);
    const before = helen.noShows;
    const pullmanBefore = shop.getState().stores.pullman.customers.map((row) => row.noShows);
    shop.getState().addAppointment(draft(helen.id, vehicle.id, shop.getState().advisors[0].id));
    const added = shop.getState().appointments.find((row) => row.customerId === helen.id && row.concern.includes("Oil change") && row.status === "scheduled");
    assert.ok(added);
    shop.getState().setAppointmentStatus(added.id, "no_show");
    const marked = shop.getState().appointments.find((row) => row.id === added.id);
    assert.equal(marked?.status, "no_show");
    assert.equal(shop.getState().customers.find((row) => row.id === helen.id)?.noShows, before + 1);
    const flag = renderToString(createElement(NoShowMark, { count: before + 1 }));
    assert.match(flag, /No-show/);
    assert.equal(noShowSuffix(before + 1), " · No-show");
    assert.equal(renderToString(createElement(NoShowMark, { count: 0 })), "");

    shop.getState().addAppointment(draft(helen.id, vehicle.id, shop.getState().advisors[1].id, "11:00"));
    assert.equal(shop.getState().customers.find((row) => row.id === helen.id)?.noShows, before + 1);

    shop.getState().switchStore("pullman");
    assert.deepEqual(shop.getState().customers.map((row) => row.noShows), pullmanBefore);
    assert.equal(shop.getState().customers.some((row) => row.name === "Helen Cho"), false);
    shop.getState().switchStore("grand-coulee");
    assert.equal(shop.getState().customers.find((row) => row.id === helen.id)?.noShows, before + 1);
    assert.equal(shop.getState().appointments.find((row) => row.id === added.id)?.status, "no_show");

    shop.getState().setAppointmentStatus(added.id, "scheduled");
    assert.equal(shop.getState().appointments.find((row) => row.id === added.id)?.status, "scheduled");
    assert.equal(shop.getState().customers.find((row) => row.id === helen.id)?.noShows, before);
  });

  it("counts a No-show saved from the appointment edit, and keeps the sample mark", () => {
    const shop = createShopStore({ demoMode: true, storage: memoryStorage() });
    const seeded = shop.getState().appointments.find((row) => row.status === "no_show");
    assert.ok(seeded);
    const seededCustomer = shop.getState().customers.find((row) => row.id === seeded.customerId);
    assert.ok(seededCustomer);
    assert.equal(seededCustomer.noShows >= 1, true);
    const pullmanSeed = shop.getState().stores.pullman.customers.find((row) => row.noShows > 0);
    assert.ok(pullmanSeed);

    const helen = shop.getState().customers.find((row) => row.name === "Helen Cho");
    const vehicle = shop.getState().vehicles.find((row) => row.customerId === helen?.id);
    assert.ok(helen && vehicle);
    const before = helen.noShows;
    shop.getState().addAppointment(draft(helen.id, vehicle.id, shop.getState().advisors[0].id, "15:00"));
    const added = shop.getState().appointments.find((row) => row.customerId === helen.id && row.time === "15:00");
    assert.ok(added);
    shop.getState().updateAppointment(added.id, { status: "no_show" });
    assert.equal(shop.getState().appointments.find((row) => row.id === added.id)?.status, "no_show");
    assert.equal(shop.getState().customers.find((row) => row.id === helen.id)?.noShows, before + 1);
    assert.equal(shop.getState().stores.pullman.customers.find((row) => row.id === pullmanSeed.id)?.noShows, pullmanSeed.noShows);
  });
});

function draft(customerId: string, vehicleId: string, advisorId: string, time = "09:00"): Omit<Appointment, "id" | "orderId" | "status"> {
  return {
    date: "2026-10-23",
    time,
    minutes: 60,
    customerId,
    vehicleId,
    advisorId,
    concern: "Oil change",
    lines: [{ id: "", code: "A", concern: "Oil change" }],
    vin: "",
    laborOpIds: [],
    techId: "marcus",
    lane: "drop",
  };
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
