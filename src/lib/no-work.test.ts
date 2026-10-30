import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { NoWorkCloseForm } from "../components/order-editor.tsx";
import { closedRoReinstateMessage } from "./cancel.ts";
import { deskSeedFor } from "./booking.ts";
import { digest, orderMoney } from "./metrics.ts";
import { NO_WORK_NOTE_LONG, NO_WORK_NOTE_MAX, NO_WORK_NOTE_REQUIRED, NO_WORK_NOTE_SHORT, NO_WORK_NOT_OPEN } from "./ro.ts";
import type { ShopStorage } from "./shop-storage.ts";
import { SHOP_PERSIST_VERSION, createShopStore, migrateSavedShop, type ShopState } from "./store.ts";
import type { Appointment, RepairOrder } from "./types.ts";

const day = "2027-01-06";

describe("no-work close", () => {
  it("closes an open or booked repair order at $0 and keeps the number", () => {
    const shop = createShopStore({ demoMode: true, storage: memoryStorage() });
    shop.getState().setWorkingAs("megan");
    const openId = blankOrder(shop);
    const openNumber = order(shop, openId).number;
    const openClose = shop.getState().closeOrderWithNoWork(openId, "  Customer never arrived  ");
    assert.equal(openClose.ok, true, openClose.error ?? "");
    const closed = order(shop, openId);
    assert.equal(closed.status, "closed");
    assert.equal(closed.closeType, "no_work");
    assert.equal(closed.closeNote, "Customer never arrived");
    assert.equal(closed.closedById, "megan");
    assert.ok(closed.closedBy);
    assert.ok(closed.closedAt);
    assert.equal(closed.number, openNumber);
    assert.equal(closed.fees.length, 0);
    assert.equal(orderMoney(closed).total, 0);
    const history = shop.getState().closedHistory.find((row) => row.orderId === openId);
    assert.equal(history?.closeType, "no_work");
    assert.equal(history?.closeNote, "Customer never arrived");
    assert.equal(history?.number, openNumber);

    const bookedId = blankOrder(shop);
    shop.setState({
      orders: shop.getState().orders.map((row) => (row.id === bookedId ? { ...row, status: "booked" as const } : row)),
    });
    assert.equal(shop.getState().closeOrderWithNoWork(bookedId, "No repair authorized").ok, true);
    assert.equal(order(shop, bookedId).status, "closed");

    const nextId = blankOrder(shop);
    assert.ok(order(shop, nextId).number > openNumber);
    assert.notEqual(order(shop, nextId).number, openNumber);
    shop.setState({ orders: shop.getState().orders.filter((row) => row.id !== openId) });
    const afterDrop = blankOrder(shop);
    assert.notEqual(order(shop, afterDrop).number, openNumber);
    assert.ok(order(shop, afterDrop).number > openNumber);
  });

  it("blocks parts, labor charges, tech time, a nonzero total, and a payment", () => {
    const shop = createShopStore({ demoMode: true, storage: memoryStorage() });
    const partsId = blankOrder(shop);
    shop.getState().addPartLine(partsId, { partId: "pads", number: "BL", description: "Pad", qty: 1, cost: 1, price: 10, payType: "cp" });
    assertBlocked(shop, partsId);

    const laborId = blankOrder(shop);
    shop.getState().addLabor(laborId, { opcode: "LOF", description: "Oil", hours: 0.5, rate: 100, payType: "cp", techId: shop.getState().techs[0].id });
    assertBlocked(shop, laborId);

    const timeId = blankOrder(shop);
    shop.getState().addLabor(timeId, { opcode: "CHK", description: "Look", hours: 0.3, rate: 0, payType: "cp", techId: "" });
    assertBlocked(shop, timeId);
    const punchId = blankOrder(shop);
    shop.setState({
      timeLogs: [...shop.getState().timeLogs, { id: "clk-nw", techId: shop.getState().techs[0].id, orderId: punchId, startedAt: "2026-10-29T15:00:00", endedAt: "2026-10-29T15:20:00" }],
    });
    assertBlocked(shop, punchId);

    const feeId = blankOrder(shop);
    shop.setState({
      orders: shop.getState().orders.map((row) => (row.id === feeId ? { ...row, fees: [...row.fees, { id: "fee-tow", name: "Tow", amount: 40, basis: "flat" as const, cap: 0 }] } : row)),
    });
    assert.ok(orderMoney(order(shop, feeId)).total > 0);
    assertBlocked(shop, feeId);

    const paidId = blankOrder(shop);
    shop.setState({
      orders: shop.getState().orders.map((row) => (row.id === paidId ? { ...row, payments: [{ id: "pay-1", amount: 20, takenAt: "2026-10-29T16:00:00.000Z" }] } : row)),
    });
    assertBlocked(shop, paidId);
  });

  it("requires a trimmed note and leaves a closed repair order read-only", () => {
    const shop = createShopStore({ demoMode: true, storage: memoryStorage() });
    shop.getState().setWorkingAs("megan");
    const id = blankOrder(shop);
    assert.equal(shop.getState().closeOrderWithNoWork(id, "   ").error, NO_WORK_NOTE_REQUIRED);
    assert.equal(order(shop, id).status, "open");
    assert.equal(shop.getState().closeOrderWithNoWork(id, "short").error, NO_WORK_NOTE_SHORT);
    assert.equal(shop.getState().closeOrderWithNoWork(id, "x".repeat(NO_WORK_NOTE_MAX + 1)).error, NO_WORK_NOTE_LONG);
    assert.equal(order(shop, id).status, "open");
    assert.equal(shop.getState().closeOrderWithNoWork(id, "x".repeat(NO_WORK_NOTE_MAX)).ok, true);
    assert.equal(order(shop, id).closeNote?.length, NO_WORK_NOTE_MAX);

    const concern = order(shop, id).concern;
    shop.getState().updateOrder(id, { concern: "Changed", status: "open", mileage: 99999 });
    shop.getState().addLabor(id, { opcode: "LOF", description: "Oil", hours: 1, rate: 10, payType: "cp", techId: shop.getState().techs[0].id });
    shop.getState().addPartLine(id, { partId: null, number: "X", description: "Bolt", qty: 1, cost: 1, price: 2, payType: "cp" });
    shop.getState().bookOrder(id);
    shop.getState().invoiceOrder(id);
    shop.getState().closeOrder(id);
    const locked = order(shop, id);
    assert.equal(locked.status, "closed");
    assert.equal(locked.concern, concern);
    assert.equal(locked.labor.length, 0);
    assert.equal(locked.parts.length, 0);
    assert.notEqual(locked.mileage, 99999);
    assert.equal(shop.getState().closeOrderWithNoWork(id, "Again").error, NO_WORK_NOT_OPEN);

    const sold = blankOrder(shop);
    shop.setState({
      orders: shop.getState().orders.map((row) => (row.id === sold ? { ...row, status: "closed" as const, closeType: "no_work" as const, closeNote: "Already closed up", closedBy: "Megan Cho", closedAt: "2026-10-29T12:00:00.000Z" } : row)),
    });
    assert.equal(shop.getState().closeOrderWithNoWork(sold, "Already closed once").error, NO_WORK_NOT_OPEN);
  });

  it("leaves month-close sales, hours, and hours per RO unchanged and counts the close", () => {
    const shop = createShopStore({ demoMode: true, storage: memoryStorage() });
    const id = blankOrder(shop);
    const advisorId = order(shop, id).advisorId;
    const before = digest(shop.getState());
    assert.equal(shop.getState().closeOrderWithNoWork(id, "No show, no work").ok, true);
    const after = digest(shop.getState());
    assert.equal(after.laborSales, before.laborSales);
    assert.equal(after.partsSales, before.partsSales);
    assert.equal(after.hoursSold, before.hoursSold);
    assert.equal(after.soldCount, before.soldCount);
    assert.equal(after.shopEfficiency, before.shopEfficiency);
    assert.equal(after.shopProductivity, before.shopProductivity);
    assert.equal(after.hoursPerRo, before.hoursPerRo);
    assert.equal(after.noWorkCloses, before.noWorkCloses + 1);
    const beforeAdvisor = before.advisorRows.find((row) => row.id === advisorId);
    const afterAdvisor = after.advisorRows.find((row) => row.id === advisorId);
    assert.equal(afterAdvisor?.ros, beforeAdvisor?.ros);
    assert.equal(afterAdvisor?.hours, beforeAdvisor?.hours);
    assert.equal(afterAdvisor?.hoursPerRo, beforeAdvisor?.hoursPerRo);
  });

  it("allows cancel after a no-work close and still blocks reinstate", () => {
    const shop = createShopStore({ demoMode: true, storage: memoryStorage() });
    shop.getState().setWorkingAs("megan");
    const id = blankOrder(shop);
    const number = order(shop, id).number;
    assert.equal(shop.getState().closeOrderWithNoWork(id, "Vehicle gone").ok, true);
    const saved = shop.getState().saveAdvisorAppointment(draft(shop.getState(), "Linked visit"));
    assert.equal(saved.ok, true, saved.error ?? "");
    shop.getState().linkAppointment(saved.appointmentId, id);
    const cancelled = shop.getState().cancelAppointment(saved.appointmentId, { reason: "vehicle-gone" });
    assert.equal(cancelled.ok, true, cancelled.error ?? "");
    const putBack = shop.getState().reinstateAppointment(saved.appointmentId);
    assert.equal(putBack.ok, false);
    assert.equal(putBack.error, closedRoReinstateMessage(number));
    assert.equal(shop.getState().appointments.find((row) => row.id === saved.appointmentId)?.status, "cancelled");
    assert.equal(order(shop, id).status, "closed");
  });

  it("migrates an invoiced repair order to booked and does not invent a no-work close", () => {
    assert.equal(SHOP_PERSIST_VERSION, 35);
    const migrated = migrateSavedShop({
      orders: [{ id: "ro-old", status: "invoiced", number: 12, labor: [], parts: [], concern: "Oil", closeType: "invoiced", closedBy: "Unknown" }],
      closedHistory: [{ id: "h-old", orderId: "kept", number: 9, openedOn: "2026-09-01", closedOn: "2026-09-02", customerName: "Helen Cho", phone: "", address: "", plate: "", vin: "", vehicle: "", mileage: 1, mileageOut: null, concern: "Oil", opcodes: "", partNumbers: "", total: 10, beforeTax: 9, closeType: "invoiced", closedBy: "Unknown", closedAt: "Unknown" }],
    });
    const row = migrated.orders?.[0];
    assert.equal(row?.closeType, null);
    assert.equal(row?.closedBy, "");
    assert.deepEqual(row?.payments, []);
    assert.equal(row?.status, "booked");
    const history = migrated.closedHistory?.[0];
    assert.equal(history?.closeType, null);
    assert.equal(history?.closedBy, "");
    assert.equal(history?.closedAt, null);
    assert.equal(JSON.stringify(migrated).includes("\"Unknown\""), false);
  });

  it("shows the no-work note field and the card hint", () => {
    const html = renderToString(createElement(NoWorkCloseForm, {
      note: "",
      error: null,
      onNote: () => undefined,
      onSubmit: () => undefined,
    }));
    assert.match(html, /Why no work was done/);
    assert.match(html, /Close with no work \(\$0\)/);
    assert.match(html, /card or SSN numbers/);
    assert.match(html, /maxLength="500"/);
  });
});

function assertBlocked(shop: ReturnType<typeof createShopStore>, id: string) {
  const before = order(shop, id).status;
  const result = shop.getState().closeOrderWithNoWork(id, "Customer left");
  assert.equal(result.ok, false);
  assert.ok(result.error);
  assert.equal(order(shop, id).status, before);
}

function blankOrder(shop: ReturnType<typeof createShopStore>) {
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
    labor: [],
  });
  shop.getState().updateWa(id, { address: "10 Main Street" });
  return id;
}

function order(shop: ReturnType<typeof createShopStore>, id: string): RepairOrder {
  const row = shop.getState().orders.find((item) => item.id === id);
  if (!row) throw new Error(`missing ${id}`);
  return row;
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
