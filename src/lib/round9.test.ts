import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { lastVisitMileage, mileageFloorMessage } from "./mileage.ts";
import { createSeed } from "./seed.ts";
import type { ShopStorage } from "./shop-storage.ts";
import { createShopStore, migrateSavedShop } from "./store.ts";
import { vinEntryError } from "./vin.ts";

describe("round 9", () => {
  it("does not add a job line to a closed repair order, and a second load stays the same", () => {
    const closed = {
      id: "cl",
      number: 241202,
      status: "closed",
      openedOn: "2026-10-01",
      concern: "Brakes",
      jobs: [
        { id: "a", code: "A", concern: "Brakes", cause: "Worn", correction: "Replaced" },
        { id: "b", code: "B", concern: "Oil", cause: "Due", correction: "Changed" },
        { id: "cl-assign", code: "C", concern: "", cause: "", correction: "", needsAssignment: true },
      ],
      labor: [{ id: "lb", opcode: "BRK", description: "Pads", hours: 1, rate: 10, payType: "cp", techId: "marcus", jobId: "cl-assign" }],
      parts: [{ id: "pt", partId: null, number: "BL", description: "Pad", qty: 1, cost: 1, price: 2, payType: "cp", condition: "new", jobId: "cl-assign" }],
      mileage: 1000,
      mileageOut: 1004,
      history: [{ at: "2026-10-01T12:00:00.000Z", who: "Megan Cho", whoId: "megan", kind: "closed", text: "Closed" }],
    };
    const once = migrateSavedShop({ orders: [closed], timeLogs: [] });
    const row = once.orders?.find((order) => order.id === "cl");
    assert.equal(JSON.stringify(row), JSON.stringify(closed));
    assert.equal(row?.labor[0]?.jobId, "cl-assign");
    assert.equal(row?.history?.length, 1);
    const twice = migrateSavedShop(once);
    const again = twice.orders?.find((order) => order.id === "cl");
    assert.equal(JSON.stringify(again), JSON.stringify(row));
  });

  it("lets an advisor move flagged work onto a real line and then close", () => {
    for (const storeId of ["grand-coulee", "pullman"] as const) {
      const seed = createSeed(storeId);
      const number = storeId === "grand-coulee" ? 241861 : 318674;
      const source = seed.orders.find((order) => order.number === number);
      assert.ok(source, String(number));
      const shop = createShopStore({ demoMode: true, storage: memoryStorage() });
      shop.getState().switchStore(storeId);
      const who = shop.getState().advisors.find((row) => row.role !== "service-manager") ?? shop.getState().advisors[0];
      shop.getState().setWorkingAs(who.id);
      const loose = {
        ...source,
        status: "open" as const,
        authorizationLocked: false,
        mileageOut: null,
        labor: source.labor.map((line) => ({ ...line, jobId: undefined })),
        parts: source.parts.map((line) => ({ ...line, jobId: undefined })),
        jobs: source.jobs.filter((job) => !job.needsAssignment).map((job) => ({ ...job, needsAssignment: undefined })),
      };
      const loaded = migrateSavedShop({ orders: [loose], vehicles: seed.vehicles, customers: seed.customers, closedHistory: [] });
      const migrated = loaded.orders?.find((order) => order.id === source.id);
      assert.ok(migrated);
      shop.setState({ orders: loaded.orders, vehicles: seed.vehicles, customers: seed.customers, timeLogs: [] });
      const flagged = migrated.jobs.find((job) => job.needsAssignment);
      const real = migrated.jobs.filter((job) => !job.needsAssignment);
      if (real.length > 1) assert.ok(flagged);
      for (const line of migrated.labor) {
        const target = line.jobId === flagged?.id ? real[0]?.id : line.jobId;
        if (flagged && line.jobId === flagged.id && target) shop.getState().moveWorkToJob(source.id, "labor", line.id, target);
      }
      for (const line of migrated.parts) {
        const target = line.jobId === flagged?.id ? real[Math.min(1, real.length - 1)]?.id : line.jobId;
        if (flagged && line.jobId === flagged.id && target) shop.getState().moveWorkToJob(source.id, "part", line.id, target);
      }
      const moved = shop.getState().orders.find((order) => order.id === source.id);
      assert.equal(moved?.jobs.some((job) => job.needsAssignment), false);
      if (flagged) assert.ok(moved?.history?.some((row) => /Moved labor|Moved part/.test(row.text)));
      for (const job of moved?.jobs ?? []) {
        shop.getState().updateJob(source.id, job.id, {
          concern: job.concern || "Concern",
          cause: job.cause || "Cause found",
          correction: job.correction || "Correction done",
        });
      }
      shop.getState().updateWa(source.id, { address: "10 Main Street", choice: "waive", initials: "HC", date: "2026-10-30", time: "09:00" });
      shop.getState().updateOrder(source.id, { mileageOut: (moved?.mileage ?? 0) + 4 });
      const techId = moved?.labor.find((line) => line.techId)?.techId || shop.getState().techs[0]?.id || "marcus";
      shop.setState({
        orders: shop.getState().orders.map((order) => (order.id === source.id ? { ...order, status: "booked" as const } : order)),
        timeLogs: [{ id: "clk-close", techId, orderId: source.id, startedAt: "2026-10-30T15:00:00.000Z", endedAt: "2026-10-30T16:00:00.000Z" }],
      });
      const closed = shop.getState().closeOrder(source.id);
      assert.equal(closed.ok, true, closed.error ?? "");
    }
  });

  it("refuses an invalid VIN and does not replace a saved one", () => {
    assert.match(vinEntryError("123BAD") ?? "", /17/);
    assert.match(vinEntryError("1FTFW1E5ONFA12345") ?? "", /I, O, or Q/);
    assert.equal(vinEntryError("UNKNOWN")?.includes("Unknown"), true);
    const shop = createShopStore({ demoMode: true, storage: memoryStorage() });
    shop.getState().setWorkingAs("megan");
    const created = shop.getState().createCustomer({ name: "Helen Cho", phone: "5095550199", year: 2019, model: "F-150", make: "Ford" });
    const before = shop.getState().vehicles.find((row) => row.id === created.vehicleId)?.vin ?? "";
    const id = shop.getState().createOrder({
      customerId: created.customerId,
      vehicleId: created.vehicleId,
      advisorId: "megan",
      lines: [{ concern: "Oil" }],
      mileage: 4000,
      mileageOut: 4000,
      promiseTime: "",
    });
    const bad = shop.getState().updateOpenVin(id, "123BAD");
    assert.equal(bad.ok, false);
    assert.equal(shop.getState().vehicles.find((row) => row.id === created.vehicleId)?.vin, before);
    const withO = shop.getState().createCustomer({ name: "Pat Lee", phone: "5095550188", year: 2020, model: "Escape", make: "Ford", vin: "1FTFW1E5ONFA12345" });
    assert.match(withO.error ?? "", /I, O, or Q/);
    assert.equal(withO.customerId, "");
    shop.getState().setWorkingAs("marcus");
    assert.equal(shop.getState().updateOpenVin(id, before).ok, false);
  });

  it("names the last visit's mileage out in the floor message", () => {
    const vehicle = { id: "v", vin: "" };
    const earlier = {
      id: "old",
      number: 1,
      openedOn: "2026-10-30",
      openedAt: "2026-10-30T15:00:00.000Z",
      vehicleId: "v",
      mileage: 45000,
      mileageOut: 45300,
    };
    const last = lastVisitMileage([{ orders: [earlier], vehicles: [vehicle] }], vehicle, { openedAt: "2026-10-30T20:00:00.000Z" });
    assert.equal(last?.readingFrom, "out");
    assert.equal(
      mileageFloorMessage(45150, last),
      "Mileage in can't be lower than the last visit's mileage out (45,300 mi on Oct 30, 2026).",
    );
  });

  it("requires a real override reason and a service manager for mileage out", () => {
    const shop = createShopStore({ demoMode: true, storage: memoryStorage() });
    shop.getState().setWorkingAs("derek");
    const created = shop.getState().createCustomer({ name: "Helen Cho", phone: "5095550199", year: 2019, model: "F-150", make: "Ford" });
    shop.setState({
      orders: [{
        id: "prior",
        number: 1,
        openedOn: "2026-09-02",
        openedAt: "2026-09-02T15:00:00.000Z",
        promiseTime: "",
        status: "closed" as const,
        bay: "ready" as const,
        advisorId: "megan",
        customerId: created.customerId,
        vehicleId: created.vehicleId,
        concern: "Earlier",
        jobs: [],
        mileage: 80000,
        mileageOut: 80696,
        fees: [],
        taxRate: 6.5,
        labor: [],
        parts: [],
        invoicedOn: "2026-09-02",
        stockApplied: false,
        inspection: null,
      }],
    });
    assert.equal(shop.getState().createOrder({
      customerId: created.customerId,
      vehicleId: created.vehicleId,
      advisorId: "derek",
      lines: [{ concern: "Return" }],
      mileage: 1000,
      mileageReason: 12 as unknown as string,
      promiseTime: "",
    }), "");
    assert.equal(shop.getState().createOrder({
      customerId: created.customerId,
      vehicleId: created.vehicleId,
      advisorId: "derek",
      lines: [{ concern: "Return" }],
      mileage: 1000,
      promiseTime: "",
    }), "");
    const id = shop.getState().createOrder({
      customerId: created.customerId,
      vehicleId: created.vehicleId,
      advisorId: "derek",
      lines: [{ concern: "Return" }],
      mileage: 80696,
      mileageOut: 80696,
      promiseTime: "",
    });
    shop.getState().setWorkingAs("megan");
    assert.equal(shop.getState().recordMileageOutOverride(id, 20000, "long tow from the other store").ok, false);
    shop.getState().setWorkingAs("derek");
    shop.getState().recordMileageOverride(id, 90000, "this reading is above the floor");
    const note = shop.getState().orders.find((row) => row.id === id)?.history?.at(-1);
    assert.equal(note?.kind, "note");
    shop.getState().updateOrder(id, { mileage: 1000 });
    assert.notEqual(shop.getState().orders.find((row) => row.id === id)?.mileage, 1000);
    shop.setState({
      orders: shop.getState().orders.map((row) => (row.id === id ? { ...row, status: "closed" as const, authorizationLocked: true } : row)),
    });
    const extras = shop.getState().orders.find((row) => row.id === id)?.wa?.extras?.length ?? 0;
    shop.getState().addExtraAuth(id, { date: "2026-10-30", time: "09:00", employee: "Derek", person: "Helen", phone: "", work: "More", amount: 10 });
    assert.equal(shop.getState().orders.find((row) => row.id === id)?.wa?.extras?.length ?? 0, extras);
  });

  it("lets the first advisor become a service manager, then only a service manager can change roles", () => {
    const shop = createShopStore({ demoMode: false, storage: memoryStorage() });
    assert.equal(shop.getState().addAdvisor({ number: "1", name: "Pat Reyes", base: 4000, laborPercent: 5, partsPercent: 2 }), true);
    const manager = shop.getState().advisors.find((row) => row.name === "Pat Reyes");
    shop.getState().setWorkingAs(manager?.id ?? "");
    assert.equal(shop.getState().appointFirstServiceManager(manager?.id ?? "").ok, true);
    assert.equal(shop.getState().advisors.find((row) => row.id === manager?.id)?.role, "service-manager");
    assert.equal(shop.getState().roleLog?.some((row) => row.after === "service-manager" && row.who === "Pat Reyes"), true);
    assert.equal(shop.getState().addAdvisor({ number: "2", name: "Alex Rivera", base: 4000, laborPercent: 5, partsPercent: 2 }), true);
    assert.equal(shop.getState().updateAdvisor(manager?.id ?? "", { role: "advisor" }), false);
    assert.equal(shop.getState().advisors.find((row) => row.id === manager?.id)?.role, "service-manager");
  });
});

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
