import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { CUSTOMER_MILEAGE_OVERRIDE, mileageInOverrideText } from "./mileage.ts";
import { vehicleHistoryEntries } from "./ownership.ts";
import { RO_CREATE_REFUSAL, RO_WRITE_REFUSAL } from "./ro-flags.ts";
import type { ShopStorage } from "./shop-storage.ts";
import { createShopStore } from "./store.ts";
import type { Appointment } from "./types.ts";
import { fullVin, vinCheckDigit } from "./vin.ts";

const flags = globalThis as { __RO_CREATION_ENABLED__?: boolean; __RO_WRITES_ENABLED__?: boolean };
const vinA = fullVin({ prefix: "1FTAB12C", year: 2019, plant: "G", serial: 88 });

function memoryStorage(): ShopStorage {
  const items = new Map<string, string>();
  return {
    getItem: (key) => items.get(key) ?? null,
    setItem: (key, value) => { items.set(key, value); },
    removeItem: (key) => { items.delete(key); },
  };
}

function visit(shop: ReturnType<typeof createShopStore>, vin: string): Omit<Appointment, "id" | "orderId" | "status"> {
  const state = shop.getState();
  const customer = state.customers[0];
  const vehicle = state.vehicles.find((row) => row.customerId === customer.id) ?? state.vehicles[0];
  return {
    date: "2026-10-30",
    time: "09:00",
    minutes: 60,
    customerId: customer.id,
    vehicleId: vehicle.id,
    advisorId: state.advisors[0].id,
    concern: "Oil",
    lines: [{ id: "a", code: "A", concern: "Oil" }],
    vin,
    laborOpIds: [],
    techId: state.techs[0].id,
    lane: "drop",
  };
}

describe("round 12 hotfix", () => {
  it("refuses repair-order creation and every repair-order write when the flags are off", () => {
    const previousCreate = flags.__RO_CREATION_ENABLED__;
    const previousWrite = flags.__RO_WRITES_ENABLED__;
    flags.__RO_CREATION_ENABLED__ = false;
    flags.__RO_WRITES_ENABLED__ = false;
    try {
      const shop = createShopStore({ demoMode: true, storage: memoryStorage() });
      shop.getState().setWorkingAs("megan");
      const order = shop.getState().orders.find((row) => row.status !== "closed");
      assert.ok(order);
      const before = JSON.stringify(shop.getState().orders);
      const vehicles = shop.getState().vehicles.map((row) => row.id);
      const customer = shop.getState().customers[0];
      assert.equal(shop.getState().createOrder({
        customerId: customer.id,
        vehicleId: shop.getState().vehicles[0].id,
        advisorId: "megan",
        lines: [{ concern: "Oil" }],
        mileage: 1000,
        promiseTime: "",
      }), "");
      const walked = shop.getState().openWalkIn({
        name: "New Person",
        phone: "5095550188",
        year: 2020,
        model: "Escape",
        make: "Ford",
        vin: vinA,
        advisorId: "megan",
        lines: [{ concern: "Brakes" }],
        mileage: 2000,
        promiseTime: "",
      });
      assert.equal(walked.ok, false);
      assert.equal(walked.error, RO_CREATE_REFUSAL);
      shop.getState().updateOrder(order.id, { concern: "Changed", mileage: order.mileage + 1 });
      assert.equal(shop.getState().recordMileageOverride(order.id, 1, "the odometer was misread on arrival").error, RO_WRITE_REFUSAL);
      assert.equal(shop.getState().updateOpenVin(order.id, vinA).error, RO_WRITE_REFUSAL);
      shop.getState().updateOpenContact(order.id, { phone: "5095550101" });
      shop.getState().addLabor(order.id, { opcode: "LOF", description: "Oil", hours: 1, rate: 10, payType: "cp", techId: "marcus" });
      assert.equal(shop.getState().resolveFlaggedPunch("missing", new Date().toISOString()).error, RO_WRITE_REFUSAL);
      assert.equal(JSON.stringify(shop.getState().orders), before);
      assert.deepEqual(shop.getState().vehicles.map((row) => row.id), vehicles);
      assert.equal(shop.getState().customers.find((row) => row.id === order.customerId)?.phone === "5095550101", false);
    } finally {
      flags.__RO_CREATION_ENABLED__ = previousCreate;
      flags.__RO_WRITES_ENABLED__ = previousWrite;
    }
  });

  it("keeps a phone change on the same vehicle", () => {
    const shop = createShopStore({ demoMode: true, storage: memoryStorage() });
    shop.getState().setWorkingAs("megan");
    const order = shop.getState().orders.find((row) => row.status !== "closed");
    assert.ok(order);
    const vin = shop.getState().vehicles.find((row) => row.id === order.vehicleId)?.vin ?? "";
    const before = shop.getState().vehicles.filter((row) => row.vin === vin).map((row) => row.id);
    const count = shop.getState().vehicles.length;
    shop.getState().updateOpenContact(order.id, { phone: "5095550100" });
    assert.deepEqual(shop.getState().vehicles.filter((row) => row.vin === vin).map((row) => row.id), before);
    assert.equal(shop.getState().vehicles.length, count);
  });

  it("writes a punch resolve on the time log only and leaves every closed repair order byte-identical", () => {
    const shop = createShopStore({ demoMode: true, storage: memoryStorage() });
    shop.getState().setWorkingAs("megan");
    const created = shop.getState().createCustomer({ name: "Helen Cho", phone: "5095550199", year: 2019, model: "F-150", make: "Ford" });
    const orderId = shop.getState().createOrder({
      customerId: created.customerId,
      vehicleId: created.vehicleId,
      advisorId: "megan",
      lines: [{ concern: "Brakes" }],
      mileage: 4000,
      mileageOut: 4000,
      promiseTime: "",
    });
    shop.getState().addLabor(orderId, { opcode: "BRK", description: "Pads", hours: 1, rate: 10, payType: "cp", techId: "marcus" });
    shop.getState().clockIn("marcus", orderId);
    const punch = shop.getState().timeLogs.find((row) => row.orderId === orderId && !row.endedAt);
    assert.ok(punch);
    const start = Date.parse(punch.startedAt);
    const closedAt = new Date(start + 3_600_000).toISOString();
    const other = shop.getState().orders.find((row) => row.id !== orderId && row.status === "closed");
    assert.ok(other);
    shop.setState({
      orders: shop.getState().orders.map((row) => row.id === orderId ? { ...row, status: "closed" as const, authorizationLocked: true, closedAt } : row),
      timeLogs: shop.getState().timeLogs.map((row) => row.id === punch.id ? { ...row, needsReview: true, clockedOutAt: new Date(start + 1_800_000).toISOString(), note: "Still open" } : row),
    });
    const closedBefore = shop.getState().orders.filter((row) => row.status === "closed" || row.authorizationLocked).map((row) => [row.id, JSON.stringify(row)] as const);
    const historyBefore = shop.getState().orders.map((row) => [row.id, JSON.stringify(row.history ?? [])] as const);
    shop.getState().setWorkingAs("derek");
    assert.equal(shop.getState().resolveFlaggedPunch(punch.id, new Date(start + 1_200_000).toISOString()).ok, true);
    for (const [id, json] of closedBefore) {
      assert.equal(JSON.stringify(shop.getState().orders.find((row) => row.id === id)), json);
    }
    for (const [id, json] of historyBefore) {
      assert.equal(JSON.stringify(shop.getState().orders.find((row) => row.id === id)?.history ?? []), json);
    }
    assert.match(shop.getState().timeLogs.find((row) => row.id === punch.id)?.note ?? "", /resolved the punch/);
  });

  it("refuses a bad VIN on addAppointment and keeps spaces and dashes out of the 17 characters", () => {
    const shop = createShopStore({ demoMode: true, storage: memoryStorage() });
    const before = shop.getState().appointments.length;
    const badDigit = `${vinA.slice(0, 8)}${vinA[8] === "0" ? "1" : "0"}${vinA.slice(9)}`;
    assert.notEqual(vinCheckDigit(badDigit), badDigit[8]);
    assert.equal(shop.getState().addAppointment(visit(shop, badDigit)), "");
    assert.equal(shop.getState().addAppointment(visit(shop, "1FTEW1EPOKFA12345")), "");
    assert.equal(shop.getState().appointments.length, before);
    const spaced = ` ${vinA.slice(0, 4)}-${vinA.slice(4)} `;
    const id = shop.getState().addAppointment(visit(shop, spaced));
    assert.ok(id);
    assert.equal(shop.getState().appointments.find((row) => row.id === id)?.vin, vinA);
    const saved = shop.getState().saveAdvisorAppointment({ ...visit(shop, badDigit), status: "scheduled" });
    assert.match(saved.error ?? "", /check digit/);
  });

  it("logs pay-type rate changes for an advisor and refuses a blank actor or a technician", () => {
    const shop = createShopStore({ demoMode: true, storage: memoryStorage() });
    const rate = shop.getState().payTypes.find((row) => row.id === "cp")?.rate;
    assert.equal(rate, 189);
    shop.setState({ workingAsId: "" });
    shop.getState().updatePayType("cp", { rate: 1 });
    assert.equal(shop.getState().payTypes.find((row) => row.id === "cp")?.rate, 189);
    shop.getState().setWorkingAs("marcus");
    shop.getState().updatePayType("cp", { rate: 1 });
    assert.equal(shop.getState().addTech({ number: "77", name: "Temp", skill: "b", payStyle: "flat", flagRate: 20, hourlyRate: 20, board: "main" }), false);
    assert.equal(shop.getState().addPayType({ name: "Fleet", rate: 50, kind: "customer" }), false);
    assert.equal(shop.getState().payTypes.find((row) => row.id === "cp")?.rate, 189);
    shop.getState().setWorkingAs("megan");
    shop.getState().updatePayType("cp", { rate: 1 });
    assert.equal(shop.getState().payTypes.find((row) => row.id === "cp")?.rate, 1);
    assert.equal(shop.getState().settings.cpRate, 1);
    assert.equal(shop.getState().roleLog?.some((row) => row.who === "Megan Cho" && row.before.includes("189") && row.after.includes("1")), true);
  });

  it("shows the new owner divider on the repair order that triggered the transfer", () => {
    const shop = createShopStore({ demoMode: false, storage: memoryStorage() });
    shop.getState().addAdvisor({ number: "1", name: "Megan Cho", base: 4000, laborPercent: 5, partsPercent: 2 });
    const megan = shop.getState().advisors[0];
    shop.getState().setWorkingAs(megan.id);
    const helen = shop.getState().createCustomer({ name: "Helen Cho", phone: "5095550199", year: 2019, model: "F-150", make: "Ford", vin: vinA });
    const sandra = shop.getState().createCustomer({ name: "Sandra Delgado", phone: "5095550166", year: 2018, model: "Escape", make: "Ford" });
    const openId = shop.getState().createOrder({
      customerId: sandra.customerId,
      vehicleId: sandra.vehicleId,
      advisorId: megan.id,
      lines: [{ concern: "Noise" }],
      mileage: 3000,
      mileageOut: 3000,
      promiseTime: "",
    });
    shop.setState({
      vehicles: shop.getState().vehicles.map((row) => row.id === helen.vehicleId ? {
        ...row,
        ownership: [{ customerId: helen.customerId, startedAt: "2019-01-01T00:00:00.000Z", endedAt: null, who: "Megan Cho", whoId: megan.id, reason: "" }],
      } : row),
      orders: shop.getState().orders.map((row) => row.id === openId ? { ...row, openedAt: "2020-06-01T16:00:00.000Z", openedOn: "2020-06-01" } : row),
    });
    const moved = shop.getState().updateOpenVin(openId, vinA, true, "Sold the truck to the new owner");
    assert.equal(moved.ok, true, moved.error ?? "");
    const vehicle = shop.getState().vehicles.find((row) => row.vin === vinA);
    assert.ok(vehicle);
    const history = vehicleHistoryEntries(shop.getState().orders, vehicle, shop.getState().customers, shop.getState().vehicles);
    const dividerAt = history.findIndex((row) => row.kind === "divider" && row.text.startsWith("New owner: Sandra Delgado"));
    const triggerAt = history.findIndex((row) => row.kind === "order" && row.order.id === openId);
    assert.ok(dividerAt >= 0);
    assert.ok(triggerAt > dividerAt);
  });

  it("prints a neutral mileage line and keeps the staff note", () => {
    const staff = mileageInOverrideText(1200, { mileage: 4000, readingFrom: "out", date: "2026-09-01", orderId: "old" }, "odometer was replaced");
    assert.match(staff, /4,000/);
    assert.match(staff, /odometer was replaced/);
    assert.equal(CUSTOMER_MILEAGE_OVERRIDE, "Mileage verified by service manager");
    assert.equal(CUSTOMER_MILEAGE_OVERRIDE.includes("4,000"), false);
    assert.equal(CUSTOMER_MILEAGE_OVERRIDE.includes("odometer"), false);
  });
});
