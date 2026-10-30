import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { vehicleTitle } from "./metrics.ts";
import { advisorCloseGaps } from "./ro.ts";
import type { ShopStorage } from "./shop-storage.ts";
import { createShopStore, migrateSavedShop } from "./store.ts";
import type { RoHistoryEntry } from "./types.ts";
import { fullVin } from "./vin.ts";

describe("round 6", () => {
  it("keeps every history field when a shop is saved and loaded", () => {
    const shop = createShopStore({ demoMode: true, storage: memoryStorage() });
    const id = shop.getState().orders.find((row) => row.status !== "closed")?.id ?? "";
    const history: RoHistoryEntry[] = [
      { at: "2026-10-01T15:00:00.000Z", who: "Megan Cho", whoId: "megan", kind: "reopened", text: "Reopened", field: "status", before: "closed", after: "booked", reason: "Customer came back" },
      { at: "2026-10-01T16:00:00.000Z", who: "Derek Lang", whoId: "derek", kind: "amended", text: "Mileage", field: "mileage", before: "100", after: "200", reason: "Odometer was misread" },
      { at: "2026-10-01T17:00:00.000Z", who: "Megan Cho", whoId: "megan", kind: "diagnosis-cleared", text: "Cleared cause", field: "line A", before: "cause: Leak", after: "", blocksNoWork: true },
      { at: "2026-10-01T18:00:00.000Z", who: "Megan Cho", whoId: "megan", kind: "job-removed", text: "Removed line B", field: "line B", before: "Noise", after: "", blocksNoWork: true },
      { at: "2026-10-01T19:00:00.000Z", who: "Megan Cho", whoId: "megan", kind: "fee-changed", text: "Fee", field: "fees", before: "Shop 8", after: "Shop 8 cap 40" },
    ];
    shop.setState({
      orders: shop.getState().orders.map((row) => (row.id === id ? { ...row, history } : row)),
    });
    const loaded = migrateSavedShop(JSON.parse(JSON.stringify(shop.getState())));
    assert.deepEqual(loaded.orders?.find((row) => row.id === id)?.history, history);
  });

  it("still blocks a no-work close after a cleared cause is reloaded", () => {
    const shop = createShopStore({ demoMode: true, storage: memoryStorage() });
    shop.getState().setWorkingAs("megan");
    const id = openOrder(shop);
    const jobId = shop.getState().orders.find((row) => row.id === id)?.jobs[0]?.id ?? "";
    shop.getState().updateJob(id, jobId, { cause: "Found a leak" });
    shop.getState().updateJob(id, jobId, { cause: "" });
    const blob = JSON.parse(JSON.stringify(shop.getState()));
    const loaded = migrateSavedShop(blob);
    const order = loaded.orders?.find((row) => row.id === id);
    assert.equal(order?.history?.some((entry) => entry.kind === "diagnosis-cleared" && entry.blocksNoWork), true);
    const again = createShopStore({ demoMode: true, storage: memoryStorage() });
    again.setState({ orders: loaded.orders ?? [], customers: loaded.customers ?? [], vehicles: loaded.vehicles ?? [], timeLogs: [] });
    assert.match(again.getState().closeOrderWithNoWork(id, "Customer never arrived for work").error ?? "", /Inspection or diagnosis is recorded/);
    assert.equal(again.getState().closeOrderWithNoWork(id, "Customer never arrived for work").error?.includes(".."), false);
  });

  it("appends a closed-history version and prints from the repair order snapshot", () => {
    const shop = createShopStore({ demoMode: true, storage: memoryStorage() });
    shop.getState().setWorkingAs("megan");
    const id = openOrder(shop);
    const vehicleId = shop.getState().orders.find((row) => row.id === id)?.vehicleId ?? "";
    assert.equal(shop.getState().closeOrderWithNoWork(id, "Customer left before any work").ok, true);
    const first = shop.getState().closedHistory.find((row) => row.orderId === id);
    assert.equal(first?.version, 1);
    const snap = shop.getState().orders.find((row) => row.id === id)?.closeSnapshot;
    assert.ok(snap?.customerName);
    shop.setState({
      vehicles: shop.getState().vehicles.map((row) => (row.id === vehicleId ? { ...row, model: "Changed after close" } : row)),
    });
    assert.notEqual(shop.getState().orders.find((row) => row.id === id)?.closeSnapshot?.model, "Changed after close");
    assert.equal(shop.getState().closedHistory.filter((row) => row.orderId === id).length, 1);
  });

  it("loads a reopened repair order as closed and read-only", () => {
    const shop = createShopStore({ demoMode: true, storage: memoryStorage() });
    const order = shop.getState().orders.find((row) => row.status !== "closed");
    assert.ok(order);
    const saved = {
      ...shop.getState(),
      orders: shop.getState().orders.map((row) => row.id === order.id ? {
        ...row,
        status: "booked" as const,
        authorizationLocked: true,
        history: [{ at: "2026-10-02T15:00:00.000Z", who: "Derek Lang", whoId: "derek", kind: "reopened" as const, text: "Reopened", field: "status", before: "closed", after: "booked", reason: "Came back later" }],
      } : row),
    };
    const loaded = migrateSavedShop(JSON.parse(JSON.stringify(saved)));
    const next = loaded.orders?.find((row) => row.id === order.id);
    assert.equal(next?.status, "closed");
    assert.equal(next?.history?.[0]?.kind, "reopened");
    assert.equal(next?.history?.[0]?.reason, "Came back later");
    const live = createShopStore({ demoMode: true, storage: memoryStorage() });
    live.setState({ orders: loaded.orders ?? [] });
    live.getState().setWorkingAs("derek");
    live.getState().updateOrder(order.id, { concern: "Should not stick" });
    assert.equal(live.getState().orders.find((row) => row.id === order.id)?.concern, order.concern);
  });

  it("refuses every write on a closed repair order, including a service manager", () => {
    const shop = createShopStore({ demoMode: true, storage: memoryStorage() });
    shop.getState().setWorkingAs("megan");
    const id = openOrder(shop);
    assert.equal(shop.getState().closeOrderWithNoWork(id, "Customer left before any work").ok, true);
    shop.setState({
      orders: shop.getState().orders.map((row) => row.id === id ? {
        ...row,
        labor: [{ id: "lb", opcode: "LOF", description: "Oil", hours: 1, rate: 10, payType: "cp", techId: "marcus" }],
        parts: [{ id: "pt", partId: null, number: "BL", description: "Bolt", qty: 1, cost: 1, price: 2, payType: "cp", condition: "new" as const }],
        jobs: row.jobs,
        inspection: null,
      } : row),
    });
    const before = JSON.stringify(shop.getState().orders.find((row) => row.id === id));
    for (const who of ["megan", "marcus", "derek"]) {
      shop.getState().setWorkingAs(who);
      const order = shop.getState().orders.find((row) => row.id === id)!;
      shop.getState().updateOrder(id, { concern: "No", mileage: 1 });
      shop.getState().updateJob(id, order.jobs[0].id, { cause: "No" });
      shop.getState().addJob(id);
      shop.getState().updateLabor(id, "lb", { hours: 9 });
      shop.getState().removeLabor(id, "lb");
      shop.getState().updatePartLine(id, "pt", { price: 50, qty: 3 });
      shop.getState().removePartLine(id, "pt");
      shop.getState().attachInspection(id);
      shop.getState().addFee({ name: "Tow", amount: 10 });
      shop.getState().updateSettings({ taxRate: 9, fees: shop.getState().settings.fees });
      shop.getState().bookOrder(id);
      shop.getState().unbookOrder(id);
      assert.equal(shop.getState().closeOrder(id).ok, false);
    }
    assert.equal(JSON.stringify(shop.getState().orders.find((row) => row.id === id)), before);
    assert.equal("reopenOrder" in shop.getState(), false);
    assert.equal("clockTech" in shop.getState(), false);
  });

  it("blocks mileage in below the last visit at this store and at the other store", () => {
    const shop = createShopStore({ demoMode: true, storage: memoryStorage() });
    shop.getState().setWorkingAs("megan");
    const vin = fullVin({ prefix: "1FTEW1EP", year: 2019, plant: "A", serial: 424242 });
    const created = shop.getState().createCustomer({ name: "Helen Cho", phone: "5095550199", year: 2019, model: "F-150", make: "Ford" });
    shop.setState({
      vehicles: shop.getState().vehicles.map((row) => row.id === created.vehicleId ? { ...row, vin } : row),
      stores: {
        ...shop.getState().stores,
        pullman: {
          ...shop.getState().stores.pullman,
          customers: [{ id: "pc", name: "Pat Lee", phone: "5095550101", mobile: "", email: "", noShows: 0 }],
          vehicles: [{ id: "pv", customerId: "pc", year: 2019, make: "Ford", model: "F-150", vin }],
          orders: [{
            id: "pro",
            number: 88,
            openedOn: "2026-09-02",
            promiseTime: "",
            status: "closed" as const,
            bay: "ready" as const,
            advisorId: "x",
            customerId: "pc",
            vehicleId: "pv",
            concern: "Earlier",
            jobs: [],
            mileage: 80210,
            mileageOut: 80210,
            fees: [],
            taxRate: 6.5,
            labor: [],
            parts: [],
            invoicedOn: "2026-09-02",
            stockApplied: false,
            inspection: null,
          }],
        },
      },
    });
    const low = shop.getState().createOrder({
      customerId: created.customerId,
      vehicleId: created.vehicleId,
      advisorId: "megan",
      lines: [{ concern: "Return visit" }],
      mileage: 80209,
      mileageOut: 80209,
      promiseTime: "",
    });
    assert.equal(low, "");
    const id = shop.getState().createOrder({
      customerId: created.customerId,
      vehicleId: created.vehicleId,
      advisorId: "megan",
      lines: [{ concern: "Return visit" }],
      mileage: 90000,
      mileageOut: 90000,
      promiseTime: "",
    });
    assert.ok(id);
    shop.getState().updateWa(id, { address: "10 Main Street" });
    shop.setState({
      orders: shop.getState().orders.map((row) => row.id === id ? { ...row, mileage: 1000, mileageOut: 1000 } : row),
    });
    const error = shop.getState().closeOrderWithNoWork(id, "Customer left before any work").error ?? "";
    assert.match(error, /80,210/);
    assert.match(error, /Sep 2, 2026/);
  });

  it("blocks a close when a job line with work is missing its concern", () => {
    const shop = createShopStore({ demoMode: true, storage: memoryStorage() });
    shop.getState().setWorkingAs("megan");
    const id = openOrder(shop);
    const order = shop.getState().orders.find((row) => row.id === id)!;
    shop.getState().addLabor(id, { opcode: "LOF", description: "Oil", hours: 1, rate: 189, payType: "cp", techId: "marcus" });
    shop.getState().updateJob(id, order.jobs[0].id, { concern: "", cause: "Worn", correction: "Replaced" });
    shop.setState({
      orders: shop.getState().orders.map((row) => row.id === id ? { ...row, status: "booked" as const } : row),
      timeLogs: [{ id: "clk", techId: "marcus", orderId: id, startedAt: "2026-10-20T15:00:00", endedAt: "2026-10-20T16:00:00" }],
    });
    const gaps = advisorCloseGaps(shop.getState().orders.find((row) => row.id === id)!, {
      customer: shop.getState().customers.find((row) => row.id === order.customerId),
      vehicle: shop.getState().vehicles.find((row) => row.id === order.vehicleId),
      techs: shop.getState().techs,
      advisors: shop.getState().advisors,
      logs: shop.getState().timeLogs,
    });
    assert.ok(gaps.some((gap) => gap.startsWith("Concern on line")));
    assert.match(shop.getState().closeOrder(id).error ?? "", /Concern on line/);
  });

  it("requires mileage out on a no-work close and does not hint at clearing clock time", () => {
    const shop = createShopStore({ demoMode: true, storage: memoryStorage() });
    shop.getState().setWorkingAs("megan");
    const id = openOrder(shop);
    shop.setState({
      orders: shop.getState().orders.map((row) => row.id === id ? { ...row, mileageOut: 0 } : row),
    });
    assert.match(shop.getState().closeOrderWithNoWork(id, "Customer left before any work").error ?? "", /mileage out/i);
    shop.getState().addLabor(id, { opcode: "LOF", description: "Oil", hours: 1, rate: 10, payType: "cp", techId: "marcus" });
    shop.getState().clockIn("marcus", id);
    const lineId = shop.getState().orders.find((row) => row.id === id)?.labor[0]?.id ?? "";
    shop.getState().removeLabor(id, lineId);
    const clocked = shop.getState().closeOrderWithNoWork(id, "Customer left before any work").error ?? "";
    assert.match(clocked, /Clock time is on this repair order/);
    assert.equal(clocked.includes("Inspection or diagnosis"), false);
    assert.equal(clocked.includes("Clear"), false);
    assert.equal(clocked.includes(".."), false);
    const open = shop.getState().timeLogs.find((row) => row.techId === "marcus" && row.endedAt === null);
    shop.setState({
      orders: shop.getState().orders.map((row) => row.id === id ? { ...row, status: "closed" as const } : row),
    });
    const before = shop.getState().orders.find((row) => row.id === id);
    shop.getState().clockOut("marcus");
    const punch = shop.getState().timeLogs.find((row) => row.id === open?.id);
    const after = shop.getState().orders.find((row) => row.id === id);
    assert.equal(typeof punch?.endedAt, "string");
    assert.notEqual(punch?.endedAt, null);
    assert.equal(after?.status, "closed");
    assert.equal(after?.labor.length, before?.labor.length);
    assert.equal(after?.mileage, before?.mileage);
  });

  it("kills the close-role, first-advisor, last-name, and removed-line gaps", () => {
    const shop = createShopStore({ demoMode: true, storage: memoryStorage() });
    const id = openOrder(shop);
    const first = shop.getState().advisors[0];
    shop.setState({ workingAsId: "nobody" });
    assert.equal(shop.getState().closeOrder(id).ok, false);
    assert.notEqual(shop.getState().orders.find((row) => row.id === id)?.closedBy, first.name);
    shop.getState().setWorkingAs("marcus");
    assert.equal(shop.getState().closeOrder(id).ok, false);
    assert.equal(shop.getState().orders.find((row) => row.id === id)?.status, "open");
    shop.getState().setWorkingAs("megan");
    shop.setState({
      orders: shop.getState().orders.map((row) => row.id === id ? { ...row, status: "booked" as const } : row),
      customers: shop.getState().customers.map((row) => row.id === shop.getState().orders.find((item) => item.id === id)?.customerId ? { ...row, name: "Helen" } : row),
    });
    assert.match(shop.getState().closeOrder(id).error ?? "", /Customer first and last name/);
    const created = shop.getState().createCustomer({ name: "Helen Cho", phone: "5095550199", year: 2019, model: "F-150", make: "Ford" });
    const bare = shop.getState().createOrder({
      customerId: created.customerId,
      vehicleId: created.vehicleId,
      advisorId: "megan",
      lines: [{ concern: "No show" }],
      mileage: 4000,
      mileageOut: 4000,
      promiseTime: "",
    });
    shop.getState().updateWa(bare, { address: "10 Main Street" });
    shop.setState({
      orders: shop.getState().orders.map((row) => row.id === bare ? {
        ...row,
        inspection: null,
        history: [{ at: "2026-10-01T12:00:00.000Z", who: "Megan Cho", whoId: "megan", kind: "labor-removed" as const, text: "Removed labor", field: "LOF", before: "LOF 1h", after: "", blocksNoWork: true }],
      } : row),
    });
    const blocked = shop.getState().closeOrderWithNoWork(bare, "Customer left before any work");
    assert.equal(blocked.ok, false);
    assert.match(blocked.error ?? "", /Inspection or diagnosis is recorded/);
  });

  it("does not let an advisor update change the service manager role, and a cap-only fee reaches open repair orders", () => {
    const shop = createShopStore({ demoMode: true, storage: memoryStorage() });
    const derek = shop.getState().advisors.find((row) => row.role === "service-manager");
    assert.ok(derek);
    shop.getState().updateAdvisor(derek.id, { name: derek.name, role: "advisor" } as { name: string; role?: string });
    assert.equal(shop.getState().advisors.find((row) => row.id === derek.id)?.role, "service-manager");
    const id = openOrder(shop);
    const shopFee = shop.getState().settings.fees.find((row) => row.basis === "percent");
    assert.ok(shopFee);
    const before = shop.getState().orders.find((row) => row.id === id)?.history?.length ?? 0;
    shop.getState().updateFee(shopFee.id, { cap: shopFee.cap + 15 });
    const order = shop.getState().orders.find((row) => row.id === id);
    assert.equal(order?.fees.find((row) => row.id === shopFee.id)?.cap, shopFee.cap + 15);
    const notes = order?.history?.filter((row) => row.kind === "fee-changed") ?? [];
    assert.equal(notes.length, before + 1);
    shop.getState().addPartLine(id, { partId: null, number: "BL", description: "Bolt", qty: 1, cost: 1, price: 20, payType: "cp" });
    shop.getState().updateSettings({ taxRate: shop.getState().settings.taxRate + 1 });
    assert.equal(shop.getState().orders.find((row) => row.id === id)?.history?.some((row) => row.field === "taxRate"), true);
  });

  it("does not repeat the make in a vehicle name", () => {
    assert.equal(vehicleTitle(2019, "Chevrolet", "Chevrolet Silverado"), "2019 Chevrolet Silverado");
    assert.equal(vehicleTitle(2022, "Ford", "F-150"), "2022 Ford F-150");
  });
});

function openOrder(shop: ReturnType<typeof createShopStore>) {
  const state = shop.getState();
  const vehicle = state.vehicles[0];
  const id = state.createOrder({
    customerId: vehicle.customerId,
    vehicleId: vehicle.id,
    advisorId: state.advisors.find((row) => row.role !== "service-manager")?.id ?? state.advisors[0].id,
    lines: [{ concern: "Never showed" }],
    mileage: 250000,
    mileageOut: 250000,
    promiseTime: "",
  });
  shop.getState().updateWa(id, { address: "10 Main Street" });
  return id;
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
