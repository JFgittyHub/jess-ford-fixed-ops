import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { DeskCancelActions } from "../components/cancel-appointment.tsx";
import { bookedRoCancelMessage } from "./cancel.ts";
import { deskSeedFor } from "./booking.ts";
import { roStatusLabel, STATUS_LABEL } from "./format.ts";
import { isAdvisorClosed, isNoWorkClose, isSold, isWorkOpen } from "./metrics.ts";
import { NO_WORK_NOTE_SHORT } from "./ro.ts";
import type { ShopStorage } from "./shop-storage.ts";
import { createShopStore, migrateSavedShop, type ShopState } from "./store.ts";
import type { Appointment, RepairOrder } from "./types.ts";

const day = "2027-01-06";

describe("round 4 close rules", () => {
  it("rejects a closed status from updateOrder and does not fall back to the first advisor", () => {
    const shop = createShopStore({ demoMode: true, storage: memoryStorage() });
    const id = blankOrder(shop);
    const before = order(shop, id).status;
    shop.getState().updateOrder(id, { status: "closed", concern: "Still here" });
    assert.equal(order(shop, id).status, before);
    assert.equal(order(shop, id).concern, "Still here");
    shop.getState().updateOrder(id, { status: "booked" });
    assert.notEqual(order(shop, id).status, "booked");

    shop.setState({ workingAsId: "" });
    const refused = shop.getState().closeOrderWithNoWork(id, "Customer never arrived");
    assert.equal(refused.ok, false);
    assert.match(refused.error ?? "", /advisor or service manager/);
    assert.equal(order(shop, id).status, "open");
    assert.equal(order(shop, id).closedBy ?? "", "");

    shop.getState().setWorkingAs("marcus");
    const tech = shop.getState().closeOrderWithNoWork(id, "Customer never arrived");
    assert.equal(tech.ok, false);
    assert.equal(order(shop, id).closedById ?? "", "");
  });

  it("links an appointment only to an unlinked repair order on this store", () => {
    const shop = createShopStore({ demoMode: true, storage: memoryStorage() });
    shop.getState().setWorkingAs("megan");
    const first = shop.getState().saveAdvisorAppointment(draft(shop.getState(), "First visit"));
    const second = shop.getState().saveAdvisorAppointment(draft(shop.getState(), "Second visit", "10:00"));
    const id = blankOrder(shop);
    shop.getState().linkAppointment(first.appointmentId, "");
    assert.equal(shop.getState().appointments.find((row) => row.id === first.appointmentId)?.orderId ?? null, null);
    shop.getState().linkAppointment(first.appointmentId, "missing-ro");
    assert.notEqual(shop.getState().appointments.find((row) => row.id === first.appointmentId)?.status, "in_shop");
    shop.getState().linkAppointment(first.appointmentId, id);
    assert.equal(shop.getState().appointments.find((row) => row.id === first.appointmentId)?.orderId, id);
    shop.getState().linkAppointment(first.appointmentId, blankOrder(shop));
    assert.equal(shop.getState().appointments.find((row) => row.id === first.appointmentId)?.orderId, id);
    shop.getState().linkAppointment(second.appointmentId, id);
    assert.equal(shop.getState().appointments.find((row) => row.id === second.appointmentId)?.orderId ?? null, null);
  });

  it("names each no-work blocker, including a zero-dollar part and a removed line", () => {
    const shop = createShopStore({ demoMode: true, storage: memoryStorage() });
    shop.getState().setWorkingAs("megan");
    const laborId = blankOrder(shop);
    shop.getState().addLabor(laborId, { opcode: "LOF", description: "Oil", hours: 0, rate: 0, payType: "cp", techId: shop.getState().techs[0].id });
    assert.match(shop.getState().closeOrderWithNoWork(laborId, "Customer never arrived").error ?? "", /Remove 1 labor line \(LOF\)/);

    const negative = blankOrder(shop);
    shop.getState().addLabor(negative, { opcode: "LOF", description: "Oil", hours: 1, rate: 10, payType: "cp", techId: shop.getState().techs[0].id });
    shop.getState().updateLabor(negative, order(shop, negative).labor[0].id, { hours: -2 });
    assert.equal(order(shop, negative).labor[0].hours, 1);

    const partId = blankOrder(shop);
    shop.getState().addPartLine(partId, { partId: null, number: "BL", description: "Bolt", qty: 1, cost: 0, price: 0, payType: "cp" });
    assert.match(shop.getState().closeOrderWithNoWork(partId, "Customer never arrived").error ?? "", /Remove 1 part line \(BL\)/);

    const causeId = blankOrder(shop);
    const jobId = order(shop, causeId).jobs[0].id;
    shop.getState().updateJob(causeId, jobId, { cause: "Found a leak" });
    assert.match(shop.getState().closeOrderWithNoWork(causeId, "Customer never arrived").error ?? "", /Inspection or diagnosis is recorded/);

    const sheetId = blankOrder(shop);
    shop.getState().setInspectionPoint(sheetId, "oil", { status: "green" });
    assert.match(shop.getState().closeOrderWithNoWork(sheetId, "Customer never arrived").error ?? "", /Inspection or diagnosis is recorded/);
    shop.getState().setInspectionPoint(sheetId, "oil", { status: null, reading: "", note: "" });
    assert.match(shop.getState().closeOrderWithNoWork(sheetId, "Customer never arrived").error ?? "", /Inspection or diagnosis is recorded/);

    const removedId = blankOrder(shop);
    shop.getState().addLabor(removedId, { opcode: "LOF", description: "Oil", hours: 0.3, rate: 0, payType: "cp", techId: shop.getState().techs[0].id });
    const lineId = order(shop, removedId).labor[0].id;
    shop.getState().removeLabor(removedId, lineId);
    const removed = shop.getState().closeOrderWithNoWork(removedId, "Customer never arrived");
    assert.equal(removed.ok, true, removed.error ?? "");
    const entry = order(shop, removedId).history?.find((row) => row.kind === "labor-removed");
    assert.equal(entry?.who, "Megan Cho");
    assert.ok(entry?.at);
    assert.equal(entry?.text.includes("Unknown") ?? false, false);

    const bare = blankOrder(shop);
    shop.getState().updateWa(bare, { address: "" });
    assert.match(shop.getState().closeOrderWithNoWork(bare, "Customer never arrived").error ?? "", /Add the address/);
  });

  it("records dropped default fees with who and when, and keeps a 10 character note", () => {
    const shop = createShopStore({ demoMode: true, storage: memoryStorage() });
    shop.getState().setWorkingAs("megan");
    const id = blankOrder(shop);
    const names = order(shop, id).fees.map((fee) => fee.name);
    assert.ok(names.length > 0);
    assert.equal(shop.getState().closeOrderWithNoWork(id, "too short").error, NO_WORK_NOTE_SHORT);
    const result = shop.getState().closeOrderWithNoWork(id, "Customer never arrived");
    assert.equal(result.ok, true, result.error ?? "");
    const closed = order(shop, id);
    assert.equal(closed.closeType, "no_work");
    assert.equal(isNoWorkClose(closed), true);
    assert.match(closed.droppedFeesNote ?? "", /Dropped default fees/);
    for (const name of names) assert.match(closed.droppedFeesNote ?? "", new RegExp(name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
    assert.equal(closed.closedBy, "Megan Cho");
    assert.ok(closed.closedAt);
    const history = shop.getState().closedHistory.find((row) => row.orderId === id);
    assert.match(history?.droppedFeesNote ?? "", /Dropped default fees/);
    assert.equal(history?.closedBy, "Megan Cho");
    assert.ok(history?.closedAt);
  });

  it("keeps the repair order number after close and never reuses it", () => {
    const shop = createShopStore({ demoMode: true, storage: memoryStorage() });
    shop.getState().setWorkingAs("megan");
    const id = blankOrder(shop);
    const number = order(shop, id).number;
    assert.equal(shop.getState().closeOrderWithNoWork(id, "Customer never arrived").ok, true);
    assert.equal(order(shop, id).number, number);
    const history = shop.getState().closedHistory.find((row) => row.orderId === id);
    assert.equal(history?.number, number);
    shop.setState({ orders: shop.getState().orders.filter((row) => row.id !== id) });
    const next = blankOrder(shop);
    assert.notEqual(order(shop, next).number, number);
    assert.equal(shop.getState().closedHistory.find((row) => row.number === number)?.orderId, id);
  });

  it("leaves open and booked repair orders alone on month close", () => {
    const shop = createShopStore({ demoMode: true, storage: memoryStorage() });
    shop.getState().setWorkingAs("megan");
    const openId = blankOrder(shop);
    const bookedId = blankOrder(shop);
    shop.setState({
      orders: shop.getState().orders.map((row) => (row.id === bookedId ? { ...row, status: "booked" as const } : row)),
    });
    const before = shop.getState().orders.map((row) => ({ id: row.id, status: row.status, closeType: row.closeType ?? null, closedBy: row.closedBy ?? "", closedAt: row.closedAt ?? null }));
    shop.getState().invoiceOrder(openId);
    shop.getState().invoiceOrder(bookedId);
    const after = shop.getState().orders.map((row) => ({ id: row.id, status: row.status, closeType: row.closeType ?? null, closedBy: row.closedBy ?? "", closedAt: row.closedAt ?? null }));
    assert.deepEqual(after, before);
    assert.equal(order(shop, openId).status === "closed", false);
    assert.equal(order(shop, bookedId).status, "booked");
  });

  it("closes a booked repair order only when the required fields are complete", () => {
    const shop = createShopStore({ demoMode: true, storage: memoryStorage() });
    shop.getState().setWorkingAs("megan");
    const id = blankOrder(shop);
    shop.setState({
      orders: shop.getState().orders.map((row) => (row.id === id ? { ...row, status: "booked" as const, mileageOut: null } : row)),
    });
    const blocked = shop.getState().closeOrder(id);
    assert.equal(blocked.ok, false);
    assert.match(blocked.error ?? "", /Mileage out/);
    assert.equal(order(shop, id).status, "booked");
    assert.equal(order(shop, id).closedBy ?? "", "");
  });

  it("puts a former no-show back as scheduled without the flag", () => {
    const shop = createShopStore({ demoMode: true, storage: memoryStorage() });
    shop.getState().setWorkingAs("megan");
    const helen = shop.getState().customers.find((row) => row.name === "Helen Cho");
    assert.ok(helen);
    const before = helen.noShows;
    const saved = shop.getState().saveAdvisorAppointment(draft(shop.getState(), "Came back later"));
    shop.getState().setAppointmentStatus(saved.appointmentId, "no_show");
    assert.equal(shop.getState().customers.find((row) => row.id === helen.id)?.noShows, before + 1);
    assert.equal(shop.getState().cancelAppointment(saved.appointmentId, { reason: "customer-request" }).ok, true);
    assert.equal(shop.getState().customers.find((row) => row.id === helen.id)?.noShows, before);
    assert.equal(shop.getState().reinstateAppointment(saved.appointmentId).ok, true);
    const row = shop.getState().appointments.find((item) => item.id === saved.appointmentId);
    assert.equal(row?.status, "scheduled");
    assert.notEqual(row?.status, "no_show");
    assert.equal(shop.getState().customers.find((item) => item.id === helen.id)?.noShows, before);
  });

  it("does not leave a no-work flag on an open repair order", () => {
    const migrated = migrateSavedShop({
      orders: [{ id: "open-flag", status: "open", number: 4, labor: [], parts: [], concern: "Wait", closeType: "no_work", closedBy: "Unknown", closedAt: "Unknown" }],
    });
    const row = migrated.orders?.[0];
    assert.equal(row?.status, "open");
    assert.equal(row?.closeType, null);
    assert.equal(row?.closedBy, "");
    assert.equal(row?.closedAt, null);
  });

  it("does not show the word Invoiced", () => {
    assert.equal(Object.values(STATUS_LABEL).join(" ").includes("Invoiced"), false);
    for (const status of ["open", "working", "parts", "ready", "booked", "closed"]) {
      assert.equal(roStatusLabel({ status, closeType: status === "closed" ? "no_work" : null }).includes("Invoiced"), false);
    }
    const root = new URL("..", import.meta.url);
    for (const file of walk(root.pathname)) {
      const text = readFileSync(file, "utf8");
      assert.equal(text.includes("Invoiced"), false, file);
    }
  });

  it("keeps the booked cancel block and the repair order link", () => {
    const html = renderToString(createElement(DeskCancelActions, {
      actor: "advisor",
      status: "in_shop",
      surface: "edit",
      blockedReason: bookedRoCancelMessage(1042),
      onOpenOrder: () => undefined,
    }));
    assert.match(html, /Close the RO first/);
    assert.match(html, /accurate invoice/);
    assert.match(html, /1042/);
    assert.match(html, /Open RO/);
    assert.equal(html.includes("still open"), false);
  });

  it("counts closed repair orders, not booked ones, as sold", () => {
    const shop = createShopStore({ demoMode: true, storage: memoryStorage() });
    const closed = shop.getState().orders.filter((row) => row.status === "closed");
    assert.ok(closed.length > 0);
    assert.ok(closed.every((row) => !row.closedBy && !row.closedAt && isAdvisorClosed(row)));
    assert.equal(shop.getState().orders.some((row) => isWorkOpen(row) && isSold(row)), false);
    assert.equal(shop.getState().orders.some((row) => row.status === "booked" && isSold(row)), false);
  });
});

function walk(dir: string): string[] {
  const files: string[] = [];
  for (const name of readdirSync(dir)) {
    if (name === "node_modules" || name === "routeTree.gen.ts") continue;
    const path = join(dir, name);
    if (statSync(path).isDirectory()) files.push(...walk(path));
    else if ((path.endsWith(".ts") || path.endsWith(".tsx") || path.endsWith(".md")) && !path.endsWith(".test.ts")) files.push(path);
  }
  return files;
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

function draft(state: ShopState, concern: string, time = "09:30"): Omit<Appointment, "id" | "orderId"> {
  const seed = deskSeedFor(state);
  return {
    date: day,
    time,
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
