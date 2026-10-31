import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { customerCopyIdentity, mergeVinDuplicates } from "./ownership.ts";
import { createSeed } from "./seed.ts";
import type { ShopStorage } from "./shop-storage.ts";
import { SHOP_STORAGE_KEY } from "./shop-storage.ts";
import { createShopStore, migrateSavedShop, repairOrderWriterError } from "./store.ts";
import type { RepairOrder } from "./types.ts";
import { fullVin } from "./vin.ts";

const vinA = fullVin({ prefix: "1FTAB12C", year: 2019, plant: "G", serial: 77 });

function memoryStorage(initial?: string): ShopStorage {
  const items = new Map<string, string>();
  if (initial) items.set(SHOP_STORAGE_KEY, initial);
  return {
    getItem: (key) => items.get(key) ?? null,
    setItem: (key, value) => { items.set(key, value); },
    removeItem: (key) => { items.delete(key); },
  };
}

describe("round 12 security", () => {
  it("keeps each store's service managers and role log on that store", async () => {
    const coulee = createSeed("grand-coulee");
    const pullman = createSeed("pullman");
    pullman.serviceManagers = [];
    for (const advisor of pullman.advisors) advisor.role = "advisor";
    pullman.roleLog = [];
    coulee.roleLog = [{ at: "2026-10-30T17:00:00.000Z", who: "Megan Cho", whoId: "megan", advisorId: "derek", before: "advisor", after: "service-manager", advisorName: "Derek Lang" }];
    const raw = JSON.stringify({
      state: { ...coulee, activeStoreId: "grand-coulee", stores: { "grand-coulee": coulee, pullman } },
      version: 38,
    });
    const shop = createShopStore({ demoMode: false, storage: memoryStorage(raw) });
    await shop.persist.rehydrate();
    assert.ok(shop.getState().serviceManagers.some((row) => row.name === "Derek Lang"));
    shop.getState().switchStore("pullman");
    assert.equal(shop.getState().serviceManagers.length, 0);
    assert.equal(shop.getState().roleLog?.some((row) => row.advisorName === "Derek Lang"), false);
    const advisor = shop.getState().advisors[0];
    shop.getState().setWorkingAs(advisor.id);
    const added = shop.getState().addServiceManager({ number: "3", name: "Pat Reyes", base: 4000, laborPercent: 5, partsPercent: 2 });
    assert.equal(added.ok, true, added.error ?? "");
    shop.getState().switchStore("grand-coulee");
    assert.equal(shop.getState().serviceManagers.some((row) => row.name === "Pat Reyes"), false);
  });

  it("merges duplicate VIN records on load and leaves closed repair orders byte-identical", () => {
    const closed: RepairOrder = {
      id: "closed-1", number: 10, status: "closed", openedOn: "2026-10-01", openedAt: "2026-10-01T16:00:00.000Z",
      customerId: "helen", vehicleId: "old-car", concern: "Oil", jobs: [], mileage: 1000, mileageOut: 1004,
      fees: [], taxRate: 0, labor: [], parts: [], invoicedOn: "2026-10-01", stockApplied: false, inspection: null,
      bay: "ready", promiseTime: "", advisorId: "megan", authorizationLocked: true,
      closeSnapshot: { customerName: "Helen Cho", phone: "5095550199", address: "", plate: "", vin: vinA, year: 2019, make: "Ford", model: "F-150" },
    };
    const open: RepairOrder = { ...closed, id: "open-1", number: 11, status: "open", authorizationLocked: false, vehicleId: "new-car", customerId: "pat", openedAt: "2026-10-30T16:00:00.000Z", closeSnapshot: undefined };
    const before = JSON.stringify(closed);
    const merged = mergeVinDuplicates([
      { id: "old-car", customerId: "helen", year: 2019, make: "Ford", model: "F-150", vin: vinA },
      { id: "new-car", customerId: "pat", year: 2019, make: "Ford", model: "F-150", vin: vinA.toLowerCase() },
    ], [closed, open]);
    assert.equal(merged.vehicles.filter((row) => row.vin.toUpperCase() === vinA).length, 1);
    assert.equal(merged.vehicles[0]?.customerId, "pat");
    assert.equal(merged.vehicles[0]?.ownership?.length, 2);
    assert.equal(JSON.stringify(merged.orders.find((row) => row.id === "closed-1")), before);
    assert.equal(merged.orders.find((row) => row.id === "closed-1")?.closeSnapshot?.customerName, "Helen Cho");
    const loaded = migrateSavedShop({ vehicles: [
      { id: "old-car", customerId: "helen", year: 2019, make: "Ford", model: "F-150", vin: vinA },
      { id: "new-car", customerId: "pat", year: 2019, make: "Ford", model: "F-150", vin: vinA },
    ], orders: [closed, open] });
    assert.equal(JSON.stringify(loaded.orders.find((row) => row.id === "closed-1")), before);
  });

  it("edits a phone in place, even when a closed repair order uses that customer", () => {
    const shop = createShopStore({ demoMode: true, storage: memoryStorage() });
    shop.getState().setWorkingAs("megan");
    const created = shop.getState().createCustomer({ name: "Helen Cho", phone: "5095550199", year: 2019, model: "F-150", make: "Ford", vin: vinA });
    const openId = shop.getState().createOrder({
      customerId: created.customerId, vehicleId: created.vehicleId, advisorId: "megan",
      lines: [{ concern: "Oil" }], mileage: 4000, mileageOut: 4000, promiseTime: "",
    });
    const open = shop.getState().orders.find((row) => row.id === openId);
    assert.ok(open);
    const closed = { ...open, id: "held", status: "closed" as const, authorizationLocked: true, closeSnapshot: { customerName: "Helen Cho", phone: "5095550199", address: "", plate: "", vin: vinA, year: 2019, make: "Ford", model: "F-150" } };
    shop.setState({ orders: [closed, open] });
    const before = JSON.stringify(shop.getState().orders.find((row) => row.id === "held"));
    shop.getState().updateOpenContact(openId, { phone: "5095550100" });
    assert.equal(shop.getState().customers.filter((row) => row.formerRecord).length, 0);
    assert.equal(shop.getState().customers.some((row) => row.formerRecord), false);
    assert.equal(shop.getState().customers.find((row) => row.id === created.customerId)?.phone, "5095550100");
    assert.equal(shop.getState().vehicles.filter((row) => row.vin === vinA).length, 1);
    assert.match(shop.getState().orders.find((row) => row.id === openId)?.history?.at(-1)?.text ?? "", /Megan Cho/);
    assert.equal(JSON.stringify(shop.getState().orders.find((row) => row.id === "held")), before);
  });

  it("caps a flagged punch at the clock-out or close and does not write on the closed repair order", () => {
    const shop = createShopStore({ demoMode: true, storage: memoryStorage() });
    shop.getState().setWorkingAs("megan");
    const created = shop.getState().createCustomer({ name: "Helen Cho", phone: "5095550199", year: 2019, model: "F-150", make: "Ford" });
    const orderId = shop.getState().createOrder({
      customerId: created.customerId, vehicleId: created.vehicleId, advisorId: "megan",
      lines: [{ concern: "Brakes" }], mileage: 4000, mileageOut: 4000, promiseTime: "",
    });
    shop.getState().addLabor(orderId, { opcode: "BRK", description: "Pads", hours: 1, rate: 10, payType: "cp", techId: "marcus" });
    shop.getState().clockIn("marcus", orderId);
    const punch = shop.getState().timeLogs.find((row) => row.orderId === orderId && !row.endedAt);
    assert.ok(punch);
    const start = Date.parse(punch.startedAt);
    const closedAt = new Date(start + 3_600_000).toISOString();
    const clockedOutAt = new Date(start + 1_800_000).toISOString();
    shop.setState({
      orders: shop.getState().orders.map((row) => row.id === orderId ? { ...row, status: "closed" as const, authorizationLocked: true, closedAt } : row),
      timeLogs: shop.getState().timeLogs.map((row) => row.id === punch.id ? { ...row, needsReview: true, clockedOutAt, note: "Still open" } : row),
    });
    const before = JSON.stringify(shop.getState().orders.find((row) => row.id === orderId));
    shop.getState().setWorkingAs("derek");
    assert.equal(shop.getState().resolveFlaggedPunch(punch.id, new Date(start + 2_400_000).toISOString()).ok, false);
    assert.equal(shop.getState().resolveFlaggedPunch(punch.id, new Date(start + 3_000_000).toISOString()).ok, false);
    assert.equal(shop.getState().resolveFlaggedPunch(punch.id, new Date(start + 1_200_000).toISOString()).ok, true);
    assert.match(shop.getState().timeLogs.find((row) => row.id === punch.id)?.note ?? "", /resolved the punch/);
    assert.equal(JSON.stringify(shop.getState().orders.find((row) => row.id === orderId)), before);
  });

  it("refuses a mileage-in override above mileage out", () => {
    const shop = createShopStore({ demoMode: true, storage: memoryStorage() });
    shop.getState().setWorkingAs("derek");
    const order = shop.getState().orders.find((row) => row.status !== "closed");
    assert.ok(order);
    shop.getState().updateOrder(order.id, { mileageOut: order.mileage + 10 });
    const saved = shop.getState().orders.find((row) => row.id === order.id);
    assert.equal(shop.getState().recordMileageOverride(order.id, (saved?.mileageOut ?? 0) + 5, "the odometer was misread on the way in").ok, false);
    assert.equal(shop.getState().orders.find((row) => row.id === order.id)?.mileage, order.mileage);
  });

  it("lets only a named advisor or service manager add a vehicle or write a repair order", () => {
    const shop = createShopStore({ demoMode: true, storage: memoryStorage() });
    const before = shop.getState().orders.length;
    shop.setState({ workingAsId: "" });
    assert.match(repairOrderWriterError(shop.getState()) ?? "", /who is working/);
    assert.equal(shop.getState().createOrder({
      customerId: shop.getState().customers[0].id, vehicleId: shop.getState().vehicles[0].id, advisorId: "megan",
      lines: [{ concern: "Oil" }], mileage: 1000, promiseTime: "",
    }), "");
    assert.equal(shop.getState().orders.length, before);
    shop.getState().setWorkingAs("marcus");
    assert.match(repairOrderWriterError(shop.getState()) ?? "", /advisor or service manager/);
    assert.match(shop.getState().createCustomer({ name: "New Person", phone: "5095550188", year: 2020, model: "Escape", make: "Ford" }).error ?? "", /advisor or service manager/);
    assert.equal(shop.getState().customers.some((row) => row.name === "New Person"), false);
    shop.getState().setWorkingAs("megan");
    const created = shop.getState().createCustomer({ name: "Ada Miles", phone: "5095550171", year: 2021, model: "Escape", make: "Ford" });
    const id = shop.getState().createOrder({
      customerId: created.customerId, vehicleId: created.vehicleId, advisorId: "megan",
      lines: [{ concern: "Oil" }], mileage: 1000, promiseTime: "",
    });
    assert.ok(id);
    assert.match(shop.getState().orders.find((row) => row.id === id)?.history?.[0]?.text ?? "", /opened by Megan Cho/);
  });

  it("does not open a second repair order for the same walk-in", () => {
    const shop = createShopStore({ demoMode: false, storage: memoryStorage() });
    shop.getState().addAdvisor({ number: "1", name: "Megan Cho", base: 4000, laborPercent: 5, partsPercent: 2 });
    const megan = shop.getState().advisors[0];
    shop.getState().setWorkingAs(megan.id);
    const input = {
      name: "Helen Cho", phone: "5095550199", year: 2019, model: "F-150", make: "Ford", vin: vinA,
      advisorId: megan.id, lines: [{ concern: "Brakes" }], mileage: 5000, promiseTime: "",
    };
    const first = shop.getState().openWalkIn(input);
    const second = shop.getState().openWalkIn(input);
    assert.equal(first.ok, true, first.error ?? "");
    assert.equal(second.orderId, first.orderId);
    assert.equal(shop.getState().orders.filter((row) => row.concern.includes("Brakes")).length, 1);
  });

  it("prints Not captured when a closed repair order has no snapshot", () => {
    const copy = customerCopyIdentity({ status: "closed", closeSnapshot: undefined }, { name: "Helen Cho", phone: "5095550199" });
    assert.equal(copy.name, "Not captured");
    assert.equal(copy.phone, "Not captured");
    const seeded = customerCopyIdentity({ status: "closed", closeSnapshot: { customerName: "Helen Cho", phone: "5095550199", address: "", plate: "", vin: vinA, year: 2019, make: "Ford", model: "F-150" } }, { name: "Pat", phone: "1" });
    assert.equal(seeded.name, "Helen Cho");
  });
});
