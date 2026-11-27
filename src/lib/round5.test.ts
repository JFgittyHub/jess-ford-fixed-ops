import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import { pinClock, resetClock } from "./clock.ts";
import { deskSeedFor } from "./booking.ts";
import { isAdvisorClosed, isSold, orderMoney } from "./metrics.ts";
import type { ShopStorage } from "./shop-storage.ts";
import { createShopStore, migrateSavedShop, type ShopState } from "./store.ts";
import type { Appointment, RepairOrder } from "./types.ts";
import { fullVin } from "./vin.ts";

const day = "2026-10-21";

describe("round 5", () => {
  afterEach(() => resetClock());

  for (const version of ["v28", "v29", "v30"] as const) {
    it(`keeps month sales when a ${version} invoiced sale already has closed history`, () => {
      pinClock("2026-10-20T19:00:00.000Z");
      const saved = saleSnapshot(version);
      const before = saved.orders.filter((order) => order.status === "invoiced" && order.id !== "ro-stock");
      const labor = before.reduce((sum, order) => sum + orderMoney(order as unknown as RepairOrder).labor, 0);
      const parts = before.reduce((sum, order) => sum + orderMoney(order as unknown as RepairOrder).parts, 0);
      const migrated = migrateSavedShop(saved);
      const sale = migrated.orders?.find((order) => order.id === "ro-sale");
      const also = migrated.orders?.find((order) => order.id === "ro-open-invoice");
      const stock = migrated.orders?.find((order) => order.id === "ro-stock");
      assert.equal(sale?.status, "closed");
      assert.equal(also?.status, "closed");
      assert.equal(sale?.closedBy ?? "", "");
      assert.equal(sale?.closedAt ?? null, null);
      assert.equal(isAdvisorClosed(sale!), true);
      assert.equal(stock?.status, "booked");
      assert.equal(stock?.stockApplied, false);
      assert.equal(stock?.closedBy ?? "", "");
      assert.equal(migrated.parts?.find((part) => part.id === "pads")?.onHand, 5);
      const view = digestShopSales(digestShop(migrated));
      assert.equal(view.soldCount, before.length);
      assert.equal(view.laborSales, labor);
      assert.equal(view.partsSales, parts);
      assert.equal(JSON.stringify(migrated).includes("\"Unknown\""), false);
    });
  }

  it("lets a copied labor op come off and close at $0 when work never started", () => {
    pinClock("2026-10-20T19:00:00.000Z");
    const shop = createShopStore({ demoMode: true, storage: memoryStorage() });
    shop.getState().setWorkingAs("megan");
    const state = shop.getState();
    const seed = deskSeedFor(state);
    const saved = state.saveAdvisorAppointment({
      ...draft(state, "Oil and leave"),
      customerId: seed.customerId,
      vehicleId: seed.vehicleId,
      advisorId: "megan",
      techId: seed.techId,
      laborOpIds: ["op-lof"],
    });
    assert.equal(saved.ok, true, saved.error ?? "");
    const op = state.laborOps.find((row) => row.id === "op-lof");
    assert.ok(op);
    const orderId = state.createOrder({
      customerId: seed.customerId,
      vehicleId: seed.vehicleId,
      advisorId: "megan",
      lines: [{ concern: "Oil and leave" }],
      mileage: 250000,
      mileageOut: 250000,
      promiseTime: "",
      labor: [{ opcode: op.opcode, description: op.description, hours: op.hours, rate: 189, payType: op.payType, techId: seed.techId }],
    });
    shop.getState().updateWa(orderId, { address: "10 Main Street" });
    shop.getState().linkAppointment(saved.appointmentId, orderId);
    const lineId = shop.getState().orders.find((row) => row.id === orderId)?.labor[0]?.id ?? "";
    shop.getState().removeLabor(orderId, lineId);
    const logged = shop.getState().orders.find((row) => row.id === orderId)?.history?.find((row) => row.kind === "labor-removed");
    assert.equal(logged?.who, "Megan Cho");
    assert.ok(logged?.at);
    assert.equal(logged?.blocksNoWork, false);
    const closed = shop.getState().closeOrderWithNoWork(orderId, "Customer left before any work");
    assert.equal(closed.ok, true, closed.error ?? "");
    const cancelled = shop.getState().cancelAppointment(saved.appointmentId, { reason: "vehicle-gone" });
    assert.equal(cancelled.ok, true, cancelled.error ?? "");
  });

  it("leaves a closed repair order closed for an advisor, a technician, and a service manager", () => {
    pinClock("2026-10-20T19:00:00.000Z");
    const shop = createShopStore({ demoMode: true, storage: memoryStorage() });
    shop.getState().setWorkingAs("megan");
    const id = readyBlank(shop);
    assert.equal(shop.getState().closeOrderWithNoWork(id, "Customer left before any work").ok, true);
    const historyId = shop.getState().closedHistory.find((row) => row.orderId === id)?.id;
    const before = JSON.stringify(shop.getState().orders.find((row) => row.id === id));
    for (const who of ["megan", "marcus", "derek"]) {
      shop.getState().setWorkingAs(who);
      shop.getState().updateOrder(id, { mileage: 1, concern: "Changed" });
      shop.getState().updateWa(id, { address: "Changed after close" });
    }
    const order = shop.getState().orders.find((row) => row.id === id);
    assert.equal(order?.status, "closed");
    assert.equal(JSON.stringify(order), before);
    assert.equal("reopenOrder" in shop.getState(), false);
    assert.equal("amendClosedOrder" in shop.getState(), false);
    assert.equal(shop.getState().closedHistory.find((row) => row.orderId === id)?.id, historyId);
  });

  it("blocks a close when mileage out is below mileage in, mileage in is zero, or make is blank", () => {
    const shop = createShopStore({ demoMode: true, storage: memoryStorage() });
    shop.getState().setWorkingAs("megan");
    const id = readyBlank(shop);
    shop.setState({
      orders: shop.getState().orders.map((row) => (row.id === id ? { ...row, mileage: 0 } : row)),
    });
    assert.match(shop.getState().closeOrderWithNoWork(id, "Customer left before any work").error ?? "", /mileage in/i);
    shop.setState({
      orders: shop.getState().orders.map((row) => row.id === id ? { ...row, mileage: 250000, mileageOut: 40, status: "booked" as const } : row),
    });
    assert.match(shop.getState().closeOrder(id).error ?? "", /Mileage out/);
    shop.setState({
      orders: shop.getState().orders.map((row) => row.id === id ? { ...row, mileageOut: 250000 } : row),
    });
    const vehicleId = shop.getState().orders.find((row) => row.id === id)?.vehicleId ?? "";
    shop.setState({
      vehicles: shop.getState().vehicles.map((row) => row.id === vehicleId ? { ...row, make: "" } : row),
    });
    assert.match(shop.getState().closeOrder(id).error ?? "", /Make/);
  });

  it("writes a history entry when a fee setting changes an open repair order", () => {
    const shop = createShopStore({ demoMode: true, storage: memoryStorage() });
    shop.getState().setWorkingAs("megan");
    const id = readyBlank(shop);
    assert.equal(shop.getState().addFee({ name: "Tow", amount: 25 }), true);
    const note = shop.getState().orders.find((row) => row.id === id)?.history?.find((row) => row.kind === "fee-changed");
    assert.ok(note);
    assert.equal(note?.field, "fees");
    assert.match(note?.after ?? "", /Tow/);
    assert.equal(note?.who, "Megan Cho");
  });

  it("covers the round-4 mutation gaps", () => {
    const shop = createShopStore({ demoMode: true, storage: memoryStorage() });
    shop.getState().setWorkingAs("megan");
    const id = readyBlank(shop);
    shop.getState().addLabor(id, { opcode: "LOF", description: "Oil", hours: -1, rate: 10, payType: "cp", techId: "marcus" });
    assert.equal(shop.getState().orders.find((row) => row.id === id)?.labor.length, 0);
    const op = shop.getState().laborOps[0];
    shop.getState().updateLaborOp(op.id, { hours: -1 });
    assert.ok((shop.getState().laborOps.find((row) => row.id === op.id)?.hours ?? 0) >= 0);
    shop.getState().addPartLine(id, { partId: null, number: "BL", description: "Bolt", qty: 1, cost: 0, price: 0, payType: "cp" });
    const partLine = shop.getState().orders.find((row) => row.id === id)?.parts[0];
    shop.getState().removePartLine(id, partLine?.id ?? "");
    assert.equal(shop.getState().orders.find((row) => row.id === id)?.history?.some((row) => row.kind === "part-removed"), true);
    shop.getState().updateWa(id, { choice: "waive", initials: "MC", date: "2026-10-20", time: "09:00" });
    shop.getState().bookOrder(id);
    assert.notEqual(shop.getState().orders.find((row) => row.id === id)?.status, "booked");
    const sample = shop.getState().orders.find((row) => row.id === id)!;
    assert.equal(isSold({ ...sample, status: "booked", invoicedOn: "2026-10-20" }), false);
    assert.equal(isAdvisorClosed({ status: "booked" }), false);
    assert.equal(isAdvisorClosed({ status: "closed" }), true);
    shop.setState({ customers: shop.getState().customers.map((row) => row.id === sample.customerId ? { ...row, phone: "" } : row) });
    assert.match(shop.getState().closeOrderWithNoWork(id, "Customer left before any work").error ?? "", /phone/i);
    shop.setState({
      customers: shop.getState().customers.map((row) => row.id === sample.customerId ? { ...row, phone: "555", name: "Helen" } : row),
      vehicles: shop.getState().vehicles.map((row) => row.id === sample.vehicleId ? { ...row, model: "" } : row),
    });
    const gaps = shop.getState().closeOrderWithNoWork(id, "Customer left before any work").error ?? "";
    assert.match(gaps, /year, make, and model/i);
    shop.setState({
      orders: shop.getState().orders.map((row) => row.id === id ? {
        ...row,
        status: "booked" as const,
        parts: [{ id: "p", partId: null, number: "BL", description: "Bolt", qty: 1, cost: 1, price: 2, payType: "cp" }],
      } : row),
      vehicles: shop.getState().vehicles.map((row) => row.id === sample.vehicleId ? { ...row, model: "F-150", vin: "NOT-A-VIN" } : row),
      customers: shop.getState().customers.map((row) => row.id === sample.customerId ? { ...row, name: "Helen Cho" } : row),
    });
    const closeError = shop.getState().closeOrder(id).error ?? "";
    assert.match(closeError, /VIN/);
    assert.match(closeError, /New, used, or rebuilt/);
  });
});

function digestShop(saved: ReturnType<typeof migrateSavedShop>) {
  const shop = createShopStore({ demoMode: false, storage: memoryStorage() });
  shop.setState({
    orders: saved.orders ?? [],
    parts: saved.parts ?? [],
    customers: saved.customers ?? [],
    vehicles: saved.vehicles ?? [],
    advisors: saved.advisors ?? [],
    techs: saved.techs ?? [],
    timeLogs: [],
    closedHistory: saved.closedHistory ?? [],
    payTypes: shop.getState().payTypes,
  });
  return shop.getState();
}

function saleSnapshot(version: "v28" | "v29" | "v30") {
  const sale = {
    id: "ro-sale",
    status: "invoiced" as const,
    closeType: version === "v30" ? "invoiced" : undefined,
    number: 100,
    openedOn: "2026-10-10",
    invoicedOn: "2026-10-15",
    advisorId: "a",
    customerId: "c",
    vehicleId: "v",
    concern: "Oil",
    mileage: 1000,
    labor: [{ id: "l", opcode: "LOF", description: "Oil", hours: 2, rate: 100, payType: "cp", techId: "t" }],
    parts: [{ id: "p", partId: "pads", number: "BL", description: "Pad", qty: 1, cost: 10, price: 40, payType: "cp" }],
    fees: [],
    taxRate: 0,
    stockApplied: true,
  };
  const openInvoice = {
    id: "ro-open-invoice",
    status: "invoiced" as const,
    number: 101,
    openedOn: "2026-10-12",
    invoicedOn: "2026-10-16",
    advisorId: "a",
    customerId: "c",
    vehicleId: "v",
    concern: "Wait",
    mileage: 20,
    labor: [{ id: "l2", opcode: "CHK", description: "Look", hours: 1, rate: 50, payType: "cp", techId: "t" }],
    parts: [{ id: "p2", partId: "pads", number: "BL", description: "Pad", qty: 2, cost: 1, price: 5, payType: "cp" }],
    fees: [],
    taxRate: 0,
    stockApplied: true,
  };
  const stockOnly = {
    id: "ro-stock",
    status: "invoiced" as const,
    number: 102,
    openedOn: "2026-10-11",
    invoicedOn: "2026-10-11",
    advisorId: "a",
    customerId: "c",
    vehicleId: "v",
    concern: "Stock",
    mileage: 10,
    labor: [],
    parts: [{ id: "p3", partId: "pads", number: "BL", description: "Pad", qty: 2, cost: 1, price: 5, payType: "cp" }],
    fees: [],
    taxRate: 0,
    stockApplied: true,
  };
  return {
    orders: [sale, openInvoice, stockOnly],
    closedHistory: [sale, openInvoice].map((order) => ({
      id: `h-${order.id}`,
      orderId: order.id,
      number: order.number,
      openedOn: order.openedOn,
      closedOn: order.invoicedOn,
      customerName: "Helen Cho",
      phone: "555",
      address: "",
      plate: "",
      vin: "",
      vehicle: "",
      mileage: order.mileage,
      mileageOut: null,
      concern: order.concern,
      opcodes: "",
      partNumbers: "",
      total: 1,
      beforeTax: 1,
      ...(version === "v29" ? { closedBy: "Unknown" } : {}),
    })),
    parts: [{ id: "pads", number: "BL", description: "Pad", bin: "A", onHand: 3, onOrder: 0, cost: 10, list: 40, lastSale: "2026-10-15", source: "Factory" }],
    customers: [{ id: "c", name: "Helen Cho", phone: "555", mobile: "", email: "", noShows: 0 }],
    vehicles: [{ id: "v", customerId: "c", year: 2020, make: "Ford", model: "F-150", vin: fullVin({ prefix: "1FTEW1EP", year: 2020, plant: "A", serial: 100 }) }],
    advisors: [{ id: "a", number: "1", name: "Ada", base: 1, laborPercent: 1, partsPercent: 1 }],
    techs: [{ id: "t", number: "4", name: "Tech", skill: "a" as const, board: "main" as const, payStyle: "flat" as const, flagRate: 20, hourlyRate: 20, availableHoursMonth: 100, clockedHoursMonth: 0, clockedToday: 0 }],
    settings: { fees: [], taxRate: 0 },
  };
}

function digestShopSales(state: ShopState) {
  const sold = state.orders.filter((order) => isSold(order));
  return {
    soldCount: sold.length,
    laborSales: sold.reduce((sum, order) => sum + orderMoney(order).labor, 0),
    partsSales: sold.reduce((sum, order) => sum + orderMoney(order).parts, 0),
  };
}

function readyBlank(shop: ReturnType<typeof createShopStore>) {
  const state = shop.getState();
  const vehicle = state.vehicles[0];
  const id = state.createOrder({
    customerId: vehicle.customerId,
    vehicleId: vehicle.id,
    advisorId: state.advisors[0].id,
    lines: [{ concern: "Never showed" }],
    mileage: 250000,
    mileageOut: 250000,
    promiseTime: "",
  });
  shop.getState().updateWa(id, { address: "10 Main Street" });
  return id;
}

function draft(state: ShopState, concern: string): Omit<Appointment, "id" | "orderId"> {
  const seed = deskSeedFor(state);
  return {
    date: day,
    time: "09:30",
    minutes: 60,
    customerId: seed.customerId,
    vehicleId: seed.vehicleId,
    advisorId: seed.advisorId,
    techId: seed.techId,
    vin: "",
    laborOpIds: [],
    lane: "drop",
    status: "scheduled",
    concern,
    lines: [{ id: "a", code: "A", concern }],
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

