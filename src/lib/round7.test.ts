import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { lastVisitMileage } from "./mileage.ts";
import { createSeed } from "./seed.ts";
import type { ShopStorage } from "./shop-storage.ts";
import { createShopStore, migrateSavedShop } from "./store.ts";
import type { RepairOrder } from "./types.ts";
import { fullVin } from "./vin.ts";

describe("round 7", () => {
  it("keeps an open repair order open when a history row says closed", () => {
    const order = {
      id: "open-1",
      number: 1,
      openedOn: "2026-10-01",
      promiseTime: "",
      status: "open",
      bay: "dispatch",
      advisorId: "megan",
      customerId: "c",
      vehicleId: "v",
      concern: "Noise",
      jobs: [{ id: "j", code: "A", concern: "Noise", cause: "", correction: "" }],
      mileage: 1000,
      mileageOut: null,
      fees: [],
      taxRate: 6.5,
      labor: [],
      parts: [],
      invoicedOn: null,
      stockApplied: false,
      inspection: null,
      history: [{ at: "2026-10-01T12:00:00.000Z", who: "Megan Cho", whoId: "megan", kind: "closed", text: "Stray" }],
    };
    const blob = { orders: [order], closedHistory: [], customers: [], vehicles: [], parts: [], techs: [], advisors: [] };
    const once = migrateSavedShop(JSON.parse(JSON.stringify(blob)));
    const twice = migrateSavedShop(JSON.parse(JSON.stringify(once)));
    assert.equal(once.orders?.find((row) => row.id === "open-1")?.status, "open");
    assert.equal(twice.orders?.find((row) => row.id === "open-1")?.status, "open");
    assert.equal(twice.orders?.find((row) => row.id === "open-1")?.authorizationLocked, false);
  });

  it("does not turn a missing history kind into a close", () => {
    const loaded = migrateSavedShop({
      orders: [{
        id: "open-2",
        status: "working",
        openedOn: "2026-10-02",
        concern: "Oil",
        jobs: [{ id: "j", code: "A", concern: "Oil", cause: "", correction: "" }],
        mileage: 10,
        labor: [],
        parts: [],
        history: [{ at: "2026-10-02T12:00:00.000Z", who: "Megan Cho", whoId: "megan", text: "No kind" }],
      }],
      closedHistory: [],
    });
    const row = loaded.orders?.find((item) => item.id === "open-2");
    assert.equal(row?.status, "working");
    assert.notEqual(row?.history?.[0]?.kind, "closed");
  });

  it("uses the higher of mileage in and mileage out on the most recent earlier visit", () => {
    const shop = createShopStore({ demoMode: true, storage: memoryStorage() });
    shop.getState().setWorkingAs("megan");
    const created = shop.getState().createCustomer({ name: "Helen Cho", phone: "5095550199", year: 2019, model: "F-150", make: "Ford" });
    const vin = fullVin({ prefix: "1FTEW1EP", year: 2019, plant: "A", serial: 808080 });
    shop.setState({
      vehicles: shop.getState().vehicles.map((row) => row.id === created.vehicleId ? { ...row, vin } : row),
      orders: [{
        id: "prior",
        number: 1,
        openedOn: "2026-09-02",
        promiseTime: "",
        status: "closed",
        bay: "ready",
        advisorId: "megan",
        customerId: created.customerId,
        vehicleId: created.vehicleId,
        concern: "Earlier",
        jobs: [],
        mileage: 80210,
        mileageOut: 80300,
        fees: [],
        taxRate: 6.5,
        labor: [],
        parts: [],
        invoicedOn: "2026-09-02",
        stockApplied: false,
        inspection: null,
      } as RepairOrder],
    });
    assert.equal(shop.getState().createOrder({
      customerId: created.customerId,
      vehicleId: created.vehicleId,
      advisorId: "megan",
      lines: [{ concern: "Return" }],
      mileage: 80250,
      mileageOut: 80250,
      promiseTime: "",
    }), "");
    const id = shop.getState().createOrder({
      customerId: created.customerId,
      vehicleId: created.vehicleId,
      advisorId: "megan",
      lines: [{ concern: "Return" }],
      mileage: 80300,
      mileageOut: 80300,
      promiseTime: "",
    });
    assert.ok(id);
    shop.getState().updateWa(id, { address: "10 Main Street" });
    shop.setState({ orders: shop.getState().orders.map((row) => row.id === id ? { ...row, mileage: 80250, mileageOut: 80300, status: "booked" as const } : row) });
    assert.match(shop.getState().closeOrder(id).error ?? "", /80,300/);
    shop.getState().updateOrder(id, { mileage: 80250 });
    assert.equal(shop.getState().orders.find((row) => row.id === id)?.mileage, 80250);
    shop.getState().updateOrder(id, { mileage: 0 });
    assert.notEqual(shop.getState().orders.find((row) => row.id === id)?.mileage, 0);
    assert.equal(shop.getState().createOrder({
      customerId: created.customerId,
      vehicleId: created.vehicleId,
      advisorId: "megan",
      lines: [{ concern: "Zero" }],
      mileage: 0,
      promiseTime: "",
    }), "");
    assert.equal(shop.getState().createOrder({
      customerId: created.customerId,
      vehicleId: created.vehicleId,
      advisorId: "megan",
      lines: [{ concern: "Huge" }],
      mileage: 1000000,
      promiseTime: "",
    }), "");
  });

  it("lets a service manager log a mileage below the last visit and refuses everyone else", () => {
    const shop = createShopStore({ demoMode: true, storage: memoryStorage() });
    const created = shop.getState().createCustomer({ name: "Helen Cho", phone: "5095550199", year: 2019, model: "F-150", make: "Ford" });
    shop.setState({
      orders: [{
        id: "prior",
        number: 1,
        openedOn: "2026-09-02",
        promiseTime: "",
        status: "closed",
        bay: "ready",
        advisorId: "megan",
        customerId: created.customerId,
        vehicleId: created.vehicleId,
        concern: "Earlier",
        jobs: [],
        mileage: 50000,
        mileageOut: 50010,
        fees: [],
        taxRate: 6.5,
        labor: [],
        parts: [],
        invoicedOn: "2026-09-02",
        stockApplied: false,
        inspection: null,
      } as RepairOrder],
    });
    shop.getState().setWorkingAs("megan");
    assert.equal(shop.getState().createOrder({
      customerId: created.customerId,
      vehicleId: created.vehicleId,
      advisorId: "megan",
      lines: [{ concern: "Cluster" }],
      mileage: 12000,
      mileageReason: "Cluster replaced",
      promiseTime: "",
    }), "");
    shop.getState().setWorkingAs("derek");
    const id = shop.getState().createOrder({
      customerId: created.customerId,
      vehicleId: created.vehicleId,
      advisorId: "derek",
      lines: [{ concern: "Cluster" }],
      mileage: 12000,
      mileageReason: "Cluster replaced",
      promiseTime: "",
    });
    assert.ok(id);
    const note = shop.getState().orders.find((row) => row.id === id)?.history?.find((row) => row.kind === "mileage-override");
    assert.equal(note?.who, "Derek Lang");
    assert.equal(note?.before, "50010");
    assert.equal(note?.after, "12000");
    assert.match(note?.reason ?? "", /Cluster replaced/);
    shop.getState().updateWa(id, { address: "10 Main Street" });
    const blocked = shop.getState().closeOrderWithNoWork(id, "Customer left before any work").error ?? "";
    assert.equal(/can't be lower than the last visit/.test(blocked), false);
  });

  it("blocks a close while a technician is clocked in and does not end that punch from another repair order", () => {
    const shop = createShopStore({ demoMode: true, storage: memoryStorage() });
    shop.getState().setWorkingAs("megan");
    const created = shop.getState().createCustomer({ name: "Helen Cho", phone: "5095550199", year: 2018, model: "F-150", make: "Ford" });
    const closedId = shop.getState().createOrder({
      customerId: created.customerId,
      vehicleId: created.vehicleId,
      advisorId: "megan",
      lines: [{ concern: "First" }],
      mileage: 4000,
      mileageOut: 4000,
      promiseTime: "",
      labor: [{ opcode: "LOF", description: "Oil", hours: 1, rate: 10, payType: "cp", techId: "marcus" }],
    });
    shop.getState().clockIn("marcus", closedId);
    shop.setState({
      orders: shop.getState().orders.map((row) => row.id === closedId ? { ...row, status: "closed" as const, authorizationLocked: true } : row),
    });
    const openPunch = shop.getState().timeLogs.find((row) => row.orderId === closedId && row.endedAt === null);
    assert.ok(openPunch);
    const other = shop.getState().createOrder({
      customerId: created.customerId,
      vehicleId: created.vehicleId,
      advisorId: "megan",
      lines: [{ concern: "Second" }],
      mileage: 4100,
      mileageOut: 4100,
      promiseTime: "",
      labor: [{ opcode: "LOF", description: "Oil", hours: 1, rate: 10, payType: "cp", techId: "marcus" }],
    });
    shop.getState().clockIn("marcus", other);
    assert.equal(shop.getState().timeLogs.find((row) => row.id === openPunch.id)?.endedAt, null);
    shop.getState().updateWa(other, { address: "10 Main Street" });
    shop.setState({
      orders: shop.getState().orders.map((row) => row.id === other ? {
        ...row,
        status: "booked" as const,
        jobs: [{ id: "jb", code: "A", concern: "Second", cause: "Worn", correction: "Replaced" }],
        mileageOut: 4100,
      } : row),
      timeLogs: [{ id: "still", techId: "marcus", orderId: other, startedAt: "2026-10-30T15:00:00", endedAt: null }],
    });
    assert.match(shop.getState().closeOrder(other).error ?? "", /Marcus Hale is still clocked in/);
  });

  it("requires cause and correction on each line that has labor or parts, including a zero-hour line", () => {
    const shop = createShopStore({ demoMode: true, storage: memoryStorage() });
    shop.getState().setWorkingAs("megan");
    const created = shop.getState().createCustomer({ name: "Helen Cho", phone: "5095550199", year: 2019, model: "F-150", make: "Ford" });
    const id = shop.getState().createOrder({
      customerId: created.customerId,
      vehicleId: created.vehicleId,
      advisorId: "megan",
      lines: [{ concern: "Brakes" }, { concern: "Rattle" }],
      mileage: 5000,
      mileageOut: 5000,
      promiseTime: "",
    });
    const jobs = shop.getState().orders.find((row) => row.id === id)?.jobs ?? [];
    shop.setState({
      orders: shop.getState().orders.map((row) => row.id === id ? {
        ...row,
        status: "booked" as const,
        jobs: [
          { ...jobs[0], cause: "Worn", correction: "Replaced" },
          { ...jobs[1], cause: "", correction: "" },
        ],
        labor: [{ id: "lb", opcode: "CHK", description: "Check", hours: 0, rate: 0, payType: "cp", techId: "marcus", jobId: jobs[1].id }],
        parts: [{ id: "pt", partId: null, number: "BL", description: "Bolt", qty: 1, cost: 0, price: 0, payType: "cp", condition: "new" as const, jobId: jobs[1].id }],
      } : row),
      timeLogs: [{ id: "clk", techId: "marcus", orderId: id, startedAt: "2026-10-30T15:00:00", endedAt: "2026-10-30T16:00:00" }],
    });
    const error = shop.getState().closeOrder(id).error ?? "";
    assert.match(error, /Cause on line B/);
    assert.match(error, /Correction on line B/);
    assert.equal(/Cause on line A/.test(error), false);
  });

  it("logs a removed job line and leaves a closed repair order's lines and inspection alone", () => {
    const shop = createShopStore({ demoMode: true, storage: memoryStorage() });
    shop.getState().setWorkingAs("megan");
    const created = shop.getState().createCustomer({ name: "Helen Cho", phone: "5095550199", year: 2019, model: "F-150", make: "Ford" });
    const id = shop.getState().createOrder({
      customerId: created.customerId,
      vehicleId: created.vehicleId,
      advisorId: "megan",
      lines: [{ concern: "One" }, { concern: "Two" }],
      mileage: 5000,
      mileageOut: 5000,
      promiseTime: "",
    });
    const jobs = shop.getState().orders.find((row) => row.id === id)?.jobs ?? [];
    shop.getState().removeJob(id, jobs[1].id);
    assert.equal(shop.getState().orders.find((row) => row.id === id)?.history?.some((row) => row.kind === "job-removed"), true);
    shop.getState().updateWa(id, { address: "10 Main Street" });
    assert.equal(shop.getState().closeOrderWithNoWork(id, "Customer left before any work").ok, true);
    const before = shop.getState().orders.find((row) => row.id === id);
    shop.getState().addJob(id);
    const again = shop.getState().orders.find((row) => row.id === id)?.jobs ?? [];
    if (again.length > 1) shop.getState().removeJob(id, again[1].id);
    shop.getState().setInspectionTech(id, "marcus");
    const point = before?.inspection?.items[0]?.id ?? "";
    shop.getState().setInspectionPoint(id, point, { status: "green", note: "Changed" });
    const after = shop.getState().orders.find((row) => row.id === id);
    assert.equal(after?.jobs.length, before?.jobs.length);
    assert.equal(after?.inspection?.techId, before?.inspection?.techId);
    assert.equal(after?.inspection?.items[0]?.note, before?.inspection?.items[0]?.note);
  });

  it("refuses a no-work close when mileage out is missing, zero, or below mileage in", () => {
    const shop = createShopStore({ demoMode: true, storage: memoryStorage() });
    shop.getState().setWorkingAs("megan");
    const created = shop.getState().createCustomer({ name: "Helen Cho", phone: "5095550199", year: 2019, model: "F-150", make: "Ford" });
    const id = shop.getState().createOrder({
      customerId: created.customerId,
      vehicleId: created.vehicleId,
      advisorId: "megan",
      lines: [{ concern: "No show" }],
      mileage: 4000,
      mileageOut: 4000,
      promiseTime: "",
    });
    shop.getState().updateWa(id, { address: "10 Main Street" });
    for (const mileageOut of [null, 0, 100] as const) {
      shop.setState({ orders: shop.getState().orders.map((row) => row.id === id ? { ...row, mileageOut } : row) });
      assert.match(shop.getState().closeOrderWithNoWork(id, "Customer left before any work").error ?? "", /mileage out/i);
    }
  });

  it("does not let a new appointment rewrite an existing vehicle VIN", () => {
    const shop = createShopStore({ demoMode: true, storage: memoryStorage() });
    const vehicle = shop.getState().vehicles[0];
    const original = vehicle.vin;
    const typed = fullVin({ prefix: "1FTEW1EP", year: 2020, plant: "A", serial: 999111 });
    assert.notEqual(typed, original);
    const id = shop.getState().addAppointment({
      date: "2026-10-30",
      time: "09:00",
      minutes: 60,
      customerId: vehicle.customerId,
      vehicleId: vehicle.id,
      advisorId: shop.getState().advisors[0].id,
      concern: "Different car",
      lines: [{ id: "l", code: "A", concern: "Different car" }],
      vin: typed,
      laborOpIds: [],
      techId: "marcus",
      lane: "waiter",
    });
    const visit = shop.getState().appointments.find((row) => row.id === id);
    assert.equal(shop.getState().vehicles.find((row) => row.id === vehicle.id)?.vin, original);
    assert.notEqual(visit?.vehicleId, vehicle.id);
    assert.equal(shop.getState().vehicles.find((row) => row.id === visit?.vehicleId)?.vin, typed);
  });

  it("gives every seeded open repair order a legal mileage and every closed one a snapshot", () => {
    for (const storeId of ["grand-coulee", "pullman"] as const) {
      const shop = createSeed(storeId);
      const view = [{ orders: shop.orders, vehicles: shop.vehicles }];
      for (const order of shop.orders) {
        if (order.status === "closed") {
          assert.ok(order.closeSnapshot?.vin, order.id);
          continue;
        }
        const vehicle = shop.vehicles.find((row) => row.id === order.vehicleId);
        const last = lastVisitMileage(view, vehicle, { excludeOrderId: order.id, openedOn: order.openedOn });
        if (last) assert.ok(order.mileage >= last.mileage, `${order.number} ${order.mileage} < ${last.mileage}`);
      }
    }
  });

  it("logs a phone change on an open repair order and ignores it once closed", () => {
    const shop = createShopStore({ demoMode: true, storage: memoryStorage() });
    shop.getState().setWorkingAs("megan");
    const created = shop.getState().createCustomer({ name: "Helen Cho", phone: "", year: 2019, model: "F-150", make: "Ford" });
    const id = shop.getState().createOrder({
      customerId: created.customerId,
      vehicleId: created.vehicleId,
      advisorId: "megan",
      lines: [{ concern: "Walk in" }],
      mileage: 3000,
      mileageOut: 3000,
      promiseTime: "",
    });
    shop.getState().updateOpenContact(id, { phone: "5095550100", address: "10 Main Street" });
    assert.equal(shop.getState().customers.find((row) => row.id === created.customerId)?.phone, "5095550100");
    assert.equal(shop.getState().orders.find((row) => row.id === id)?.history?.some((row) => row.field === "phone"), true);
    assert.equal(shop.getState().closeOrderWithNoWork(id, "Customer left before any work").ok, true);
    shop.getState().updateOpenContact(id, { phone: "5095550199" });
    assert.equal(shop.getState().customers.find((row) => row.id === created.customerId)?.phone, "5095550100");
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
