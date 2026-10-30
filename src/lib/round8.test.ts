import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { lastVisitMileage } from "./mileage.ts";
import { createShopStore, migrateSavedShop } from "./store.ts";
import type { ShopStorage } from "./shop-storage.ts";
import type { RepairOrder } from "./types.ts";

describe("round 8", () => {
  it("assigns labor and parts through addLabor and addPartLine, and checks each line", () => {
    const shop = createShopStore({ demoMode: true, storage: memoryStorage() });
    shop.getState().setWorkingAs("megan");
    const created = shop.getState().createCustomer({ name: "Helen Cho", phone: "5095550199", year: 2019, model: "F-150", make: "Ford" });
    const single = shop.getState().createOrder({
      customerId: created.customerId,
      vehicleId: created.vehicleId,
      advisorId: "megan",
      lines: [{ concern: "Oil" }],
      mileage: 4000,
      mileageOut: 4000,
      promiseTime: "",
    });
    shop.getState().addLabor(single, { opcode: "LOF", description: "Oil", hours: 0, rate: 0, payType: "cp", techId: "marcus" });
    const only = shop.getState().orders.find((row) => row.id === single);
    assert.equal(only?.labor[0]?.jobId, only?.jobs[0]?.id);

    const id = shop.getState().createOrder({
      customerId: created.customerId,
      vehicleId: created.vehicleId,
      advisorId: "megan",
      lines: [{ concern: "Brakes" }, { concern: "Rattle" }],
      mileage: 4000,
      mileageOut: 4000,
      promiseTime: "",
    });
    const jobs = shop.getState().orders.find((row) => row.id === id)?.jobs ?? [];
    const before = shop.getState().orders.find((row) => row.id === id)?.labor.length ?? 0;
    shop.getState().addLabor(id, { opcode: "CHK", description: "Check", hours: 0, rate: 0, payType: "cp", techId: "marcus" });
    assert.equal(shop.getState().orders.find((row) => row.id === id)?.labor.length, before);
    shop.getState().addLabor(id, { opcode: "CHK", description: "Check", hours: 0, rate: 0, payType: "cp", techId: "marcus", jobId: jobs[1].id });
    shop.getState().addPartLine(id, { partId: null, number: "BL", description: "Bolt", qty: 1, cost: 0, price: 0, payType: "cp", condition: "new", jobId: jobs[1].id });
    const placed = shop.getState().orders.find((row) => row.id === id);
    assert.equal(placed?.labor.at(-1)?.jobId, jobs[1].id);
    assert.equal(placed?.parts.at(-1)?.jobId, jobs[1].id);
    shop.getState().updateJob(id, jobs[0].id, { cause: "Worn", correction: "Replaced" });
    shop.getState().updateWa(id, { address: "10 Main Street" });
    shop.setState({
      orders: shop.getState().orders.map((row) => (row.id === id ? { ...row, status: "booked" as const } : row)),
      timeLogs: [{ id: "clk", techId: "marcus", orderId: id, startedAt: "2026-10-30T15:00:00", endedAt: "2026-10-30T16:00:00" }],
    });
    const error = shop.getState().closeOrder(id).error ?? "";
    assert.match(error, /Cause on line B/);
    assert.match(error, /Correction on line B/);
    assert.equal(/Cause on line A/.test(error), false);

    shop.setState({
      orders: shop.getState().orders.map((row) => (row.id === id ? { ...row, labor: row.labor.map((line) => ({ ...line, jobId: "" })) } : row)),
    });
    assert.match(shop.getState().closeOrder(id).error ?? "", /not on a job line/);
  });

  it("parks saved labor that has no line on a line the advisor must assign", () => {
    const loaded = migrateSavedShop({
      orders: [{
        id: "ro-loose",
        status: "working",
        openedOn: "2026-10-01",
        concern: "Two lines",
        jobs: [
          { id: "a", code: "A", concern: "One", cause: "Yes", correction: "Done" },
          { id: "b", code: "B", concern: "Two", cause: "Yes", correction: "Done" },
        ],
        labor: [{ id: "lb", opcode: "LOF", description: "Oil", hours: 1, rate: 10, payType: "cp", techId: "marcus" }],
        parts: [],
        mileage: 10,
      }],
    });
    const row = loaded.orders?.find((order) => order.id === "ro-loose");
    const holding = row?.jobs.find((job) => job.needsAssignment);
    assert.ok(holding);
    assert.equal(row?.labor[0]?.jobId, holding?.id);
    const one = migrateSavedShop({
      orders: [{
        id: "ro-one",
        status: "working",
        openedOn: "2026-10-01",
        jobs: [{ id: "only", code: "A", concern: "Oil", cause: "", correction: "" }],
        labor: [{ id: "lb", opcode: "LOF", description: "Oil", hours: 1, rate: 10, payType: "cp", techId: "marcus" }],
        parts: [],
        mileage: 10,
      }],
    });
    const single = one.orders?.find((order) => order.id === "ro-one");
    assert.equal(single?.labor[0]?.jobId, "only");
    assert.equal(single?.jobs.some((job) => job.needsAssignment), false);
  });

  it("refuses resetDemo outside demo mode", () => {
    const shop = createShopStore({ demoMode: false, storage: memoryStorage() });
    const created = shop.getState().createCustomer({ name: "Helen Cho", phone: "5095550199", year: 2019, model: "F-150", make: "Ford", vin: "1FTAB12C8NKA00001" });
    const id = shop.getState().createOrder({
      customerId: created.customerId,
      vehicleId: created.vehicleId,
      advisorId: "megan",
      lines: [{ concern: "Real work" }],
      mileage: 1000,
      promiseTime: "",
    });
    shop.getState().resetDemo(true);
    assert.equal(shop.getState().orders.some((row) => row.id === id), true);
    assert.notEqual(shop.getState().dataset, "sample");
  });

  it("compares mileage by opened timestamp and uses mileage out only", () => {
    const vehicle = { id: "v", vin: "1FTEW1EP0KFA00001" };
    const early = visit("early", "2026-10-30T08:00:00.000Z", 80210, 80300);
    const later = visit("later", "2026-10-30T09:00:00.000Z", 1000, 5000);
    const shops = [{ orders: [early, later], vehicles: [vehicle] }];
    assert.equal(lastVisitMileage(shops, vehicle, { excludeOrderId: "early", openedAt: early.openedAt })?.orderId, undefined);
    assert.equal(lastVisitMileage(shops, vehicle, { excludeOrderId: "later", openedAt: later.openedAt })?.mileage, 80300);
    const tied = visit("tied", "2026-10-30T08:00:00.000Z", 90000, 90000);
    const tiedShops = [{ orders: [early, tied], vehicles: [vehicle] }];
    assert.equal(lastVisitMileage(tiedShops, vehicle, { excludeOrderId: "early", openedAt: "2026-10-30T08:00:00.000Z" }), null);
    assert.equal(lastVisitMileage(tiedShops, vehicle, { excludeOrderId: "tied", openedAt: "2026-10-30T08:00:00.000Z" }), null);
    const openVisit = visit("open", "2026-10-29T08:00:00.000Z", 50000, null);
    assert.equal(lastVisitMileage([{ orders: [openVisit], vehicles: [vehicle] }], vehicle, { openedAt: "2026-10-30T08:00:00.000Z" })?.mileage, 50000);
    const outLower = visit("out-lower", "2026-10-29T08:00:00.000Z", 80300, 80210);
    assert.equal(lastVisitMileage([{ orders: [outLower], vehicles: [vehicle] }], vehicle, { openedAt: "2026-10-30T08:00:00.000Z" })?.mileage, 80210);
  });

  it("logs a service-manager mileage override with the old value, the new value, and the floor", () => {
    const shop = createShopStore({ demoMode: true, storage: memoryStorage() });
    shop.getState().setWorkingAs("derek");
    const created = shop.getState().createCustomer({ name: "Helen Cho", phone: "5095550199", year: 2019, model: "F-150", make: "Ford" });
    shop.setState({
      orders: [prior(created.customerId, created.vehicleId, 80696, 80696, "2026-10-29T08:00:00")],
    });
    assert.equal(shop.getState().recordMileageOverride("missing", 8069, "customer drove a loaner").ok, false);
    const id = shop.getState().createOrder({
      customerId: created.customerId,
      vehicleId: created.vehicleId,
      advisorId: "derek",
      lines: [{ concern: "Return" }],
      mileage: 80696,
      mileageOut: 80696,
      promiseTime: "",
    });
    assert.equal(shop.getState().recordMileageOverride(id, 0, "customer drove a loaner").ok, false);
    assert.equal(shop.getState().recordMileageOverride(id, 8069, "too short").ok, false);
    assert.equal(shop.getState().recordMileageOverride(id, 8069, ` ${"x".repeat(501)} `).ok, false);
    assert.equal(shop.getState().recordMileageOverride(id, 8069, 12 as unknown as string).ok, false);
    const collapsed = shop.getState().recordMileageOverride(id, 8069, "  customer    drove a loaner  ");
    assert.equal(collapsed.ok, true);
    const row = shop.getState().orders.find((order) => order.id === id)?.history?.find((entry) => entry.kind === "mileage-override");
    assert.equal(row?.text, "Mileage in set to 8,069, below last visit 80,696 (Oct 29, 2026), service manager override: customer drove a loaner");
    assert.equal(row?.before, "80696");
    assert.equal(row?.after, "8069");
    assert.equal(row?.reason, "customer drove a loaner");
    shop.setState({
      orders: shop.getState().orders.map((order) => (order.id === id ? { ...order, mileage: 80696 } : order)),
    });
    shop.getState().updateOrder(id, { mileage: 8069 });
    assert.equal(shop.getState().orders.find((order) => order.id === id)?.mileage, 8069);
    const legal = shop.getState().recordMileageOverride(id, 81000, "this is not below the floor");
    assert.equal(legal.ok, true);
    const note = shop.getState().orders.find((order) => order.id === id)?.history?.at(-1);
    assert.equal(note?.kind, "note");
    assert.match(note?.text ?? "", /Mileage in changed from/);
    shop.getState().setWorkingAs("megan");
    assert.equal(shop.getState().recordMileageOverride(id, 1000, "advisor cannot override this").ok, false);
    shop.getState().setWorkingAs("derek");
    shop.setState({
      orders: shop.getState().orders.map((order) => (order.id === id ? { ...order, status: "closed" as const, authorizationLocked: true } : order)),
    });
    const closedMileage = shop.getState().orders.find((order) => order.id === id)?.mileage;
    assert.equal(shop.getState().recordMileageOverride(id, 1000, "closed repair order stays").ok, false);
    assert.equal(shop.getState().orders.find((order) => order.id === id)?.mileage, closedMileage);
  });

  it("refuses mileage out more than 10,000 above mileage in unless a service manager logs a reason", () => {
    const shop = createShopStore({ demoMode: true, storage: memoryStorage() });
    shop.getState().setWorkingAs("megan");
    const created = shop.getState().createCustomer({ name: "Helen Cho", phone: "5095550199", year: 2019, model: "F-150", make: "Ford" });
    const id = shop.getState().createOrder({
      customerId: created.customerId,
      vehicleId: created.vehicleId,
      advisorId: "megan",
      lines: [{ concern: "Oil" }],
      mileage: 1000,
      mileageOut: 1000,
      promiseTime: "",
    });
    shop.getState().updateOrder(id, { mileageOut: 11001 });
    assert.equal(shop.getState().orders.find((row) => row.id === id)?.mileageOut, 1000);
    shop.getState().updateWa(id, { address: "10 Main Street" });
    shop.setState({
      orders: shop.getState().orders.map((row) => (row.id === id ? { ...row, mileageOut: 11001, status: "booked" as const, jobs: row.jobs.map((job) => ({ ...job, cause: "Low", correction: "Filled" })) } : row)),
    });
    assert.match(shop.getState().closeOrder(id).error ?? "", /10,000/);
    shop.getState().setWorkingAs("derek");
    assert.equal(shop.getState().recordMileageOutOverride(id, 11001, "odometer replaced on this visit").ok, true);
    const text = shop.getState().orders.find((row) => row.id === id)?.history?.find((entry) => entry.field === "mileageOut")?.text ?? "";
    assert.match(text, /Mileage out set to 11,001/);
    assert.match(text, /service manager override: odometer replaced on this visit/);
  });

  it("clocks out an open punch on a closed repair order without changing the ticket", () => {
    const shop = createShopStore({ demoMode: true, storage: memoryStorage() });
    shop.getState().setWorkingAs("megan");
    const created = shop.getState().createCustomer({ name: "Helen Cho", phone: "5095550199", year: 2019, model: "F-150", make: "Ford" });
    const id = shop.getState().createOrder({
      customerId: created.customerId,
      vehicleId: created.vehicleId,
      advisorId: "megan",
      lines: [{ concern: "Oil" }],
      mileage: 2000,
      mileageOut: 2000,
      promiseTime: "",
    });
    shop.getState().addLabor(id, { opcode: "LOF", description: "Oil", hours: 1, rate: 10, payType: "cp", techId: "marcus" });
    shop.getState().clockIn("marcus", id);
    shop.getState().updateWa(id, { address: "10 Main Street" });
    shop.setState({
      orders: shop.getState().orders.map((row) => (row.id === id ? { ...row, status: "closed" as const, authorizationLocked: true, closedAt: "2026-10-31T23:00:00.000Z" } : row)),
    });
    const before = shop.getState().orders.find((row) => row.id === id);
    shop.getState().clockOut("marcus");
    const after = shop.getState().orders.find((row) => row.id === id);
    const punch = shop.getState().timeLogs.find((row) => row.orderId === id);
    assert.equal(punch?.endedAt == null, false);
    assert.equal(punch?.needsReview, true);
    assert.match(punch?.note ?? "", /Megan Cho/);
    assert.equal(after?.status, before?.status);
    assert.equal(after?.mileage, before?.mileage);
    assert.equal(after?.labor.length, before?.labor.length);
    assert.equal(after?.history?.length, before?.history?.length);
    const reloaded = migrateSavedShop({
      orders: [after],
      timeLogs: shop.getState().timeLogs.map((row) => ({ ...row, endedAt: null })),
    });
    const reloadedPunch = reloaded.timeLogs?.find((row) => row.orderId === id);
    assert.equal(reloadedPunch?.needsReview, true);
    assert.notEqual(reloadedPunch?.endedAt, null);
    assert.equal(reloaded.orders?.find((row) => row.id === id)?.status, "closed");
    assert.equal(reloaded.orders?.find((row) => row.id === id)?.jobs.some((job) => job.needsAssignment), false);
  });

  it("logs phone and address edits in sentence case and refuses bad money", () => {
    const shop = createShopStore({ demoMode: true, storage: memoryStorage() });
    shop.getState().setWorkingAs("megan");
    const created = shop.getState().createCustomer({ name: "Helen Cho", phone: "", year: 2019, model: "F-150", make: "Ford" });
    const id = shop.getState().createOrder({
      customerId: created.customerId,
      vehicleId: created.vehicleId,
      advisorId: "megan",
      lines: [{ concern: "Oil" }],
      mileage: 3000,
      mileageOut: 3000,
      promiseTime: "",
    });
    shop.getState().updateOpenContact(id, { phone: "555", address: "10 Main Street" });
    assert.equal(shop.getState().customers.find((row) => row.id === created.customerId)?.phone, "");
    shop.getState().updateOpenContact(id, { phone: "5095550100", address: "10 Main Street" });
    const history = shop.getState().orders.find((row) => row.id === id)?.history ?? [];
    assert.match(history.find((row) => row.field === "phone")?.text ?? "", /Customer phone changed from blank to 5095550100 by Megan Cho/);
    assert.equal(history.find((row) => row.field === "phone")?.kind, "note");
    assert.match(history.find((row) => row.field === "address")?.text ?? "", /Customer address changed from blank to 10 Main Street by Megan Cho/);
    shop.getState().addLabor(id, { opcode: "LOF", description: "Oil", hours: Number.POSITIVE_INFINITY, rate: 10, payType: "cp", techId: "marcus" });
    shop.getState().addLabor(id, { opcode: "LOF", description: "Oil", hours: 1e308, rate: 10, payType: "cp", techId: "marcus" });
    shop.getState().addPartLine(id, { partId: null, number: "BL", description: "Bolt", qty: 1, cost: 1, price: Number.NaN, payType: "cp", condition: "new" });
    assert.equal(shop.getState().orders.find((row) => row.id === id)?.labor.length, 0);
    assert.equal(shop.getState().orders.find((row) => row.id === id)?.parts.length, 0);
    assert.equal(shop.getState().addFee({ name: "Shop", amount: Number.POSITIVE_INFINITY }), false);
    assert.equal(shop.getState().addFee({ name: "Shop", amount: 1e308 }), false);
    const live = createShopStore({ demoMode: false, storage: memoryStorage() });
    const bare = live.getState().createCustomer({ name: "Helen Cho", phone: "5095550199", year: 2019, model: "F-150", make: "Ford" });
    assert.equal(live.getState().vehicles.find((row) => row.id === bare.vehicleId)?.vin, "");
    const demo = createShopStore({ demoMode: true, storage: memoryStorage() });
    const generated = demo.getState().createCustomer({ name: "Helen Cho", phone: "5095550199", year: 2019, model: "F-150", make: "Ford" });
    assert.equal(demo.getState().vehicles.find((row) => row.id === generated.vehicleId)?.vin.length, 17);
  });

  it("leaves a closed repair order's jobs and inspection tech alone", () => {
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
    shop.getState().updateWa(id, { address: "10 Main Street" });
    assert.equal(shop.getState().closeOrderWithNoWork(id, "Customer left before any work").ok, true);
    const before = shop.getState().orders.find((row) => row.id === id);
    const extra = before?.jobs[1]?.id ?? "";
    shop.getState().removeJob(id, extra);
    shop.getState().setInspectionTech(id, "marcus");
    const after = shop.getState().orders.find((row) => row.id === id);
    assert.equal(after?.jobs.length, before?.jobs.length);
    assert.equal(after?.inspection?.techId, before?.inspection?.techId);
  });
});

function visit(id: string, openedAt: string, mileage: number, mileageOut: number | null): RepairOrder {
  return {
    id,
    number: 1,
    openedOn: openedAt.slice(0, 10),
    openedAt,
    promiseTime: "",
    status: mileageOut == null ? "open" : "closed",
    bay: "dispatch",
    advisorId: "megan",
    customerId: "c",
    vehicleId: "v",
    concern: "Visit",
    jobs: [],
    mileage,
    mileageOut,
    fees: [],
    taxRate: 0,
    labor: [],
    parts: [],
    invoicedOn: null,
    stockApplied: false,
    inspection: null,
  };
}

function prior(customerId: string, vehicleId: string, mileage: number, mileageOut: number, openedAt: string): RepairOrder {
  return visit("prior", openedAt, mileage, mileageOut) && {
    ...visit("prior", openedAt, mileage, mileageOut),
    customerId,
    vehicleId,
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
