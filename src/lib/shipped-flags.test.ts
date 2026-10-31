import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { isLockedPath } from "./section-lock.ts";
import type { ShopStorage } from "./shop-storage.ts";
import { createShopStore } from "./store.ts";
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

describe("shipped flags", () => {
  it("locks mixed-case, encoded, and trailing-slash paths", () => {
    const previous = flags.__SECTION_LOCK_ENABLED__;
    flags.__SECTION_LOCK_ENABLED__ = true;
    try {
      assert.equal(isLockedPath("/ADVISORS"), true);
      assert.equal(isLockedPath("/Pay-Types/"), true);
      assert.equal(isLockedPath("/FEES"), true);
      assert.equal(isLockedPath("/Customers"), true);
      assert.equal(isLockedPath("/%66ees"), true);
      assert.equal(isLockedPath("/fees/extra"), true);
      assert.equal(isLockedPath("/schedule"), false);
    } finally {
      flags.__SECTION_LOCK_ENABLED__ = previous;
    }
  });

  it("refuses locked-section edits and repair-order writes at the shipped defaults", () => {
    const previous = {
      create: flags.__RO_CREATION_ENABLED__,
      write: flags.__RO_WRITES_ENABLED__,
      lock: flags.__SECTION_LOCK_ENABLED__,
    };
    flags.__RO_CREATION_ENABLED__ = false;
    flags.__RO_WRITES_ENABLED__ = false;
    flags.__SECTION_LOCK_ENABLED__ = true;
    try {
      const shop = createShopStore({ demoMode: true, storage: memoryStorage() });
      shop.getState().setWorkingAs("megan");
      const before = JSON.stringify(shop.getState().orders);
      const expenses = shop.getState().expenses.length;
      const labor = shop.getState().laborOps.length;
      const parts = shop.getState().parts.map((row) => row.onHand);
      const budgets = shop.getState().budgets.map((row) => row.monthly);
      const overhead = shop.getState().overhead.map((row) => row.monthly);
      const fees = shop.getState().settings.fees.map((row) => row.amount);
      const rate = shop.getState().payTypes.find((row) => row.id === "cp")?.rate;
      const campaigns = shop.getState().campaigns.length;
      const order = shop.getState().orders.find((row) => row.status !== "closed");
      assert.ok(order);
      assert.equal(shop.getState().addLaborOp({ opcode: "ZZ", description: "Nope", hours: 1, payType: "cp" }), undefined);
      shop.getState().updateLaborOp(shop.getState().laborOps[0]?.id ?? "", { hours: 9 });
      shop.getState().removeLaborOp(shop.getState().laborOps[0]?.id ?? "");
      assert.equal(shop.getState().addPayType({ name: "Fleet", rate: 50, kind: "customer" }), false);
      shop.getState().updatePayType("cp", { rate: 1 });
      assert.equal(shop.getState().removePayType("cp"), "locked");
      assert.equal(shop.getState().addFee({ name: "Tow", amount: 4 }), false);
      shop.getState().updateFee(shop.getState().settings.fees[0]?.id ?? "", { amount: 99 });
      shop.getState().removeFee(shop.getState().settings.fees[0]?.id ?? "");
      shop.getState().setOnHand(shop.getState().parts[0]?.id ?? "", 0);
      shop.getState().addSku({ number: "ZZ", description: "Bolt", bin: "A", onHand: 1, onOrder: 0, cost: 1, list: 2, lastSale: "", source: "shop" });
      shop.getState().addExpense({ budgetId: "pol", date: "2026-10-30", vendor: "Shop", amount: 10, note: "Towels" });
      shop.getState().removeExpense(shop.getState().expenses[0]?.id ?? "");
      shop.getState().setBudget(shop.getState().budgets[0]?.id ?? "", 1);
      shop.getState().setOverhead(shop.getState().overhead[0]?.id ?? "", 1);
      shop.getState().sendCampaign({ name: "Due", message: "Come in", audience: "all", recipientIds: [shop.getState().customers[0]?.id ?? ""] });
      shop.getState().invoiceOrder(order.id);
      shop.getState().updateOrder(order.id, { mileage: order.mileage + 5 });
      shop.getState().updateOpenVin(order.id, fullVin({ prefix: "1FTAB12C", year: 2020, plant: "G", serial: 3 }));
      assert.equal(shop.getState().laborOps.length, labor);
      assert.equal(shop.getState().laborOps[0]?.hours === 9, false);
      assert.deepEqual(shop.getState().parts.map((row) => row.onHand), parts);
      assert.equal(shop.getState().expenses.length, expenses);
      assert.deepEqual(shop.getState().budgets.map((row) => row.monthly), budgets);
      assert.deepEqual(shop.getState().overhead.map((row) => row.monthly), overhead);
      assert.deepEqual(shop.getState().settings.fees.map((row) => row.amount), fees);
      assert.equal(shop.getState().payTypes.find((row) => row.id === "cp")?.rate, rate);
      assert.equal(shop.getState().campaigns.length, campaigns);
      assert.equal(JSON.stringify(shop.getState().orders), before);
    } finally {
      flags.__RO_CREATION_ENABLED__ = previous.create;
      flags.__RO_WRITES_ENABLED__ = previous.write;
      flags.__SECTION_LOCK_ENABLED__ = previous.lock;
    }
  });

  it("does not write a transfer note onto an open repair order when writes are off", () => {
    const previous = flags.__RO_WRITES_ENABLED__;
    flags.__RO_WRITES_ENABLED__ = false;
    try {
      const shop = createShopStore({ demoMode: true, storage: memoryStorage() });
      shop.getState().setWorkingAs("megan");
      const order = shop.getState().orders.find((row) => row.status !== "closed");
      assert.ok(order);
      const vehicle = shop.getState().vehicles.find((row) => row.id === order.vehicleId);
      const other = shop.getState().customers.find((row) => row.id !== order.customerId);
      const otherVehicle = shop.getState().vehicles.find((row) => row.customerId === other?.id);
      assert.ok(vehicle && other && otherVehicle);
      const before = JSON.stringify(order);
      const saved = shop.getState().saveAdvisorAppointment({
        date: "2026-10-30",
        time: "09:00",
        minutes: 60,
        customerId: other.id,
        vehicleId: otherVehicle.id,
        advisorId: "megan",
        techId: "marcus",
        concern: "Oil",
        lines: [{ id: "a", code: "A", concern: "Oil" }],
        vin: vehicle.vin,
        laborOpIds: [],
        lane: "drop",
        status: "scheduled",
      }, undefined, true, "Sold the truck to the new owner");
      assert.equal(saved.ok, true, saved.error ?? "");
      assert.equal(JSON.stringify(shop.getState().orders.find((row) => row.id === order.id)), before);
    } finally {
      flags.__RO_WRITES_ENABLED__ = previous;
    }
  });

  it("lets only an advisor or service manager approve or decline an online request", () => {
    const shop = createShopStore({ demoMode: true, storage: memoryStorage() });
    const request = {
      id: "rq-role",
      storeId: "grand-coulee" as const,
      status: "pending" as const,
      createdAt: "2026-10-30T16:00:00.000Z",
      serviceId: "oil",
      serviceName: "Oil",
      laborHours: 1,
      date: "2026-10-31",
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
      customerName: "New Owner",
      phone: "5095550199",
      email: "",
      vehicleId: null,
      year: 2020,
      make: "Ford",
      model: "Escape",
      vin: fullVin({ prefix: "1FTAB12C", year: 2020, plant: "G", serial: 9 }),
      plate: "NEW123",
      appointmentId: null,
    };
    shop.setState({ onlineRequests: [request], workingAsId: "" });
    assert.equal(shop.getState().approveOnlineRequest(request.id, "").ok, false);
    shop.getState().setWorkingAs("marcus");
    assert.equal(shop.getState().declineOnlineRequest(request.id).ok, false);
    shop.setState({ workingAsId: "nobody" });
    assert.equal(shop.getState().approveOnlineRequest(request.id, "").ok, false);
    assert.equal(shop.getState().onlineRequests[0]?.status, "pending");
    assert.equal(shop.getState().customers.some((row) => row.name === "New Owner"), false);
    shop.getState().setWorkingAs("megan");
    const vehicles = shop.getState().vehicles.length;
    const approved = shop.getState().approveOnlineRequest(request.id, "");
    assert.equal(approved.ok, true);
    assert.equal(shop.getState().vehicles.length, vehicles + 1);
    assert.equal(shop.getState().roleLog?.some((row) => row.who === "Megan Cho" && row.after === "approved" && row.advisorName === "New Owner"), true);
    const declined = { ...request, id: "rq-no", customerName: "Decline Me" };
    shop.setState({ onlineRequests: [declined, ...shop.getState().onlineRequests] });
    assert.equal(shop.getState().declineOnlineRequest(declined.id).ok, true);
    assert.equal(shop.getState().roleLog?.some((row) => row.who === "Megan Cho" && row.after === "declined" && row.advisorName === "Decline Me"), true);
  });

  it("does not throw on a non-string VIN and does not save a bad check digit", () => {
    const shop = createShopStore({ demoMode: true, storage: memoryStorage() });
    shop.getState().setWorkingAs("megan");
    const before = shop.getState().appointments.length;
    assert.doesNotThrow(() => shop.getState().addAppointment({
      date: "2026-10-30", time: "09:00", minutes: 60,
      customerId: shop.getState().customers[0].id,
      vehicleId: shop.getState().vehicles[0].id,
      advisorId: "megan", techId: "marcus", concern: "Oil",
      lines: [{ id: "a", code: "A", concern: "Oil" }],
      vin: 17 as unknown as string,
      laborOpIds: [], lane: "drop",
    }));
    assert.equal(shop.getState().appointments.length, before);
    const good = fullVin({ prefix: "1FTAB12C", year: 2019, plant: "G", serial: 4 });
    const bad = `${good.slice(0, 8)}${good[8] === "0" ? "1" : "0"}${good.slice(9)}`;
    const created = shop.getState().createCustomer({ name: "Bad Digit", phone: "5095550101", year: 2019, model: "F-150", make: "Ford", vin: bad });
    assert.match(created.error ?? "", /check digit/);
    assert.equal(shop.getState().customers.some((row) => row.name === "Bad Digit"), false);
    const row = shop.getState().appointments[0];
    assert.ok(row);
    const updated = shop.getState().updateAppointment(row.id, { vin: bad });
    assert.equal(updated.ok, false);
    assert.equal(shop.getState().appointments.find((item) => item.id === row.id)?.vin, row.vin);
  });

  it("ignores global flag overrides when the process is production", () => {
    const previous = process.env.NODE_ENV;
    process.env.NODE_ENV = "production";
    flags.__RO_WRITES_ENABLED__ = true;
    flags.__SECTION_LOCK_ENABLED__ = false;
    try {
      assert.equal(isLockedPath("/fees"), true);
    } finally {
      process.env.NODE_ENV = previous;
      flags.__RO_WRITES_ENABLED__ = true;
      flags.__SECTION_LOCK_ENABLED__ = false;
    }
  });
});
