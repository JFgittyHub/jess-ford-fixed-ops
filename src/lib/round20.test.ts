import "./test-dom.ts";
import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import { createElement } from "react";
import { flushSync } from "react-dom";
import { createRoot } from "react-dom/client";
import { lengthLabel } from "../components/appointment-calendar.tsx";
import { SchedulingSettingsForm } from "../components/scheduling-settings.tsx";
import { ScorecardPulse } from "../components/scorecard/board.tsx";
import { bookableDay } from "./bookable-day.ts";
import { pinClock, resetClock, todayIso } from "./clock.ts";
import { cleanFreeText, dedupeKey, matchRequestCustomer, phoneKey, submitOnlineRequest } from "./online-request.ts";
import { createSeed } from "./seed.ts";
import type { ShopStorage } from "./shop-storage.ts";
import { createShopStore, useShop } from "./store.ts";
import type { Appointment } from "./types.ts";
import { fullVin } from "./vin.ts";

afterEach(() => resetClock());

function memoryStorage(): ShopStorage {
  const items = new Map<string, string>();
  return {
    getItem: (key) => items.get(key) ?? null,
    setItem: (key, value) => { items.set(key, value); },
    removeItem: (key) => { items.delete(key); },
  };
}

function mount(node: ReturnType<typeof createElement>) {
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  flushSync(() => { root.render(node); });
  const text = document.body.textContent ?? "";
  flushSync(() => { root.unmount(); });
  host.remove();
  return text;
}

describe("round 20 appointment writes", () => {
  it("refuses unknown fields and bad values for every worker", () => {
    pinClock("2026-11-01T20:00:00.000Z");
    const shop = createShopStore({ demoMode: true, storage: memoryStorage() });
    const row = shop.getState().appointments.find((item) => item.status === "scheduled");
    assert.ok(row);
    const before = JSON.stringify(row);
    for (const actor of ["", "ghost", "marcus"]) {
      if (actor === "ghost") shop.setState({ workingAsId: "ghost" });
      else shop.getState().setWorkingAs(actor);
      const bogus = shop.getState().updateAppointment(row.id, { bogus: 1 } as Partial<Appointment>);
      assert.equal(bogus.ok, false);
      assert.match(bogus.error ?? "", /not on an appointment/);
      const moved = shop.getState().moveAppointment(row.id, { storeId: "other-store" } as Partial<Appointment>);
      assert.equal(moved.ok, false);
      assert.match(moved.error ?? "", /not on an appointment/);
      assert.equal(shop.getState().addAppointment({ ...row, orderId: "x" } as unknown as Omit<Appointment, "id" | "orderId" | "status">), "");
    }
    shop.getState().setWorkingAs("megan");
    assert.equal(JSON.stringify(shop.getState().appointments.find((item) => item.id === row.id)), before);
    const cancelled = shop.getState().updateAppointment(row.id, { status: "cancelled" });
    assert.equal(cancelled.ok, false);
    assert.match(cancelled.error ?? "", /cancel button/);
    assert.notEqual(shop.getState().appointments.find((item) => item.id === row.id)?.status, "cancelled");
    const blank = shop.getState().updateAppointment(row.id, { customerId: "  " });
    assert.match(blank.error ?? "", /Choose a customer/);
    const missingCustomer = shop.getState().updateAppointment(row.id, { customerId: "missing-customer", vehicleId: "missing-vehicle" });
    assert.match(missingCustomer.error ?? "", /customer is not on this store/);
    const missingVehicle = shop.getState().updateAppointment(row.id, { vehicleId: "missing-vehicle" });
    assert.match(missingVehicle.error ?? "", /vehicle is not on this store/);
    assert.equal(shop.getState().addAppointment({ ...row, customerId: "missing-customer" }), "");
    assert.equal(shop.getState().addAppointment({ ...row, vehicleId: "missing-vehicle" }), "");
    const past = shop.getState().moveAppointment(row.id, { date: "2026-10-30" });
    assert.match(past.error ?? "", /already past/);
    const future = shop.getState().appointments.find((item) => item.status === "scheduled" && item.date > todayIso()) ?? row;
    const impossible = shop.getState().updateAppointment(future.id, { date: "2026-11-31" });
    assert.match(impossible.error ?? "", /not a real day/);
    const holiday = shop.getState().moveAppointment(future.id, { date: "2026-11-26" });
    assert.match(holiday.error ?? "", /closed that day/);
    const emptyLane = shop.getState().updateAppointment(row.id, { lane: "" });
    assert.match(emptyLane.error ?? "", /lane/);
    assert.equal(shop.getState().appointments.find((item) => item.id === row.id)?.lane, row.lane);
    const op = shop.getState().laborOps[0];
    assert.ok(op);
    const duplicate = shop.getState().updateAppointment(row.id, { laborOpIds: [op.id, op.id] });
    assert.match(duplicate.error ?? "", /listed twice/);
    const other = shop.getState().appointments.find((item) => item.customerId !== future.customerId);
    assert.ok(other);
    const otherVehicle = shop.getState().vehicles.find((item) => item.id === other.vehicleId);
    assert.ok(otherVehicle);
    shop.setState({
      appointments: shop.getState().appointments.map((item) => item.id === future.id ? { ...item, vin: fullVin({ prefix: "1FTAB12C", year: 2018, plant: "G", serial: 4242 }) } : item),
    });
    const swapped = shop.getState().updateAppointment(future.id, { customerId: other.customerId, vehicleId: other.vehicleId });
    assert.equal(swapped.ok, true, swapped.error ?? "");
    const saved = shop.getState().appointments.find((item) => item.id === future.id);
    assert.equal(saved?.vin, otherVehicle.vin);
    assert.notEqual(saved?.vin, fullVin({ prefix: "1FTAB12C", year: 2018, plant: "G", serial: 4242 }));
  });

  it("leaves an unchanged concern alone and skips an empty line edit", () => {
    const shop = createShopStore({ demoMode: true, storage: memoryStorage() });
    shop.getState().setWorkingAs("megan");
    const row = shop.getState().appointments.find((item) => item.lines.length === 1 && item.status === "scheduled" && item.date >= todayIso());
    assert.ok(row);
    const logs = () => shop.getState().settingsLog?.length ?? 0;
    const before = logs();
    const same = shop.getState().updateAppointment(row.id, { concern: row.concern });
    assert.equal(same.ok, true, same.error ?? "");
    const stored = shop.getState().appointments.find((item) => item.id === row.id);
    assert.equal(stored?.concern, row.concern);
    assert.equal(stored?.concern.includes("A. A."), false);
    assert.equal(logs(), before);
    const empty = shop.getState().updateAppointment(row.id, { lines: [{ id: "x", code: "A", concern: "  " }] });
    assert.equal(empty.ok, false);
    assert.match(empty.error ?? "", /concern/);
    assert.equal(shop.getState().appointments.find((item) => item.id === row.id)?.lines[0]?.concern, row.lines[0]?.concern);
    assert.equal(logs(), before);
  });

  it("puts a visit back to scheduled in words and dates a removed closed day", () => {
    const shop = createShopStore({ demoMode: true, storage: memoryStorage() });
    shop.getState().setWorkingAs("megan");
    const row = shop.getState().appointments.find((item) => item.status === "scheduled" && item.date >= todayIso());
    assert.ok(row);
    assert.equal(shop.getState().updateAppointment(row.id, { status: "arrived" }).ok, true);
    assert.equal(shop.getState().updateAppointment(row.id, { status: "scheduled" }).ok, true);
    const back = shop.getState().settingsLog?.find((item) => item.field === "Put back");
    assert.match(back?.after ?? "", /Put back to scheduled/);
    assert.equal((back?.after ?? "").includes("Status arrived"), false);
    const missed = shop.getState().appointments.find((item) => item.status === "no_show");
    assert.ok(missed);
    if (missed.date < todayIso()) {
      const day = bookableDay(1);
      shop.setState({
        appointments: shop.getState().appointments.map((item) => item.id === missed.id ? { ...item, date: day } : item),
      });
    }
    const other = shop.getState().customers.find((item) => item.id !== missed.customerId);
    const otherVehicle = shop.getState().vehicles.find((item) => item.customerId === other?.id);
    assert.ok(other && otherVehicle);
    const refused = shop.getState().updateAppointment(missed.id, { customerId: other.id, vehicleId: otherVehicle.id });
    assert.match(refused.error ?? "", /no-show stays/);
    shop.getState().setWorkingAs("derek");
    assert.equal(shop.getState().addClosedDate("2026-12-24"), true);
    assert.equal(shop.getState().removeClosedDate("2026-12-24"), undefined);
    shop.getState().setWorkingAs("megan");
    const removed = shop.getState().settingsLog?.find((item) => item.field === "Closed date" && item.after === "removed");
    assert.equal(removed?.before, "Thu, Dec 24");
  });
});

describe("round 20 phones, text, and customers", () => {
  it("matches a phone only on the exact key", () => {
    const shop = createSeed();
    const helen = shop.customers.find((row) => row.name === "Helen Cho");
    assert.ok(helen);
    assert.equal(matchRequestCustomer(shop.customers, shop.vehicles, { phone: helen.phone })?.customerId, helen.id);
    assert.equal(matchRequestCustomer(shop.customers, shop.vehicles, { phone: "+52011400" }), null);
    assert.equal(matchRequestCustomer(shop.customers, shop.vehicles, { phone: "+44 5552011400" }), null);
  });

  it("uses one international key and counts the contact cap by that key", () => {
    const us = [
      "(509) 555-0101",
      "509-555-0101",
      "5095550101",
      "15095550101",
      "+1 509 555 0101",
      "1 (509) 555-0101",
      "509.555.0101",
      "95095550101",
      "５０９５５５０１０１",
      "509 555 0101",
      "+1 (509) 555-0101",
      "5095550101 x12",
    ];
    for (const spelling of us) assert.equal(phoneKey(spelling), "5095550101", spelling);
    assert.equal(phoneKey("+50 9555 0101"), "+5095550101");
    assert.notEqual(phoneKey("+50 9555 0101"), "5095550101");
    assert.equal(phoneKey("+44 (0) 20 7946 0958"), "+442079460958");
    assert.equal(phoneKey("+44 20 7946 0958"), phoneKey("+44 (0) 20 7946 0958"));
    assert.equal(phoneKey("+0 0000 0000"), "");
    assert.equal(phoneKey("+052011400"), "");
    assert.equal(phoneKey("+44 1234 5678 9012 3456"), "");
    assert.notEqual(phoneKey("+５０９５５５０３００"), "5095550300");
    const state = { ...createSeed(), activeStoreId: "grand-coulee" as const };
    const base = {
      serviceId: state.settings.scheduling.onlineMenu[0].id,
      date: "2026-11-12",
      time: "09:00",
      advisorId: state.advisors[0].id,
      transportId: state.settings.scheduling.transportOptions[0].id,
      verified: false,
      customerName: "Pat Example",
      email: "",
      year: 2020,
      make: "Ford",
      model: "Escape",
      plate: "PAT123",
    };
    const pending = [0, 1, 2].map((index) => ({
      id: `hold-${index}`, storeId: state.activeStoreId, status: "pending" as const, createdAt: "2026-11-01T18:00:00.000Z",
      serviceId: base.serviceId, serviceName: "Oil", laborHours: 0.3, date: "2026-11-12", time: "09:00",
      advisorId: base.advisorId, advisorName: "A", techId: "marcus", techName: "T",
      transportId: base.transportId, transportName: "Drop", contactMethod: "text" as const, verified: false,
      customerId: null, customerName: "Pat Example", phone: index === 1 ? "+44 (0) 20 7946 0958" : "+44 20 7946 0958", email: "",
      vehicleId: null, year: 2020, make: "Ford", model: "Escape",
      vin: fullVin({ prefix: "1FTAB12C", year: 2020, plant: "G", serial: 700 + index }),
      plate: "A", appointmentId: null,
    }));
    const blocked = submitOnlineRequest(
      { ...state, onlineRequests: pending },
      { ...base, phone: "+44 2079460958", vin: fullVin({ prefix: "1FTAB12C", year: 2020, plant: "G", serial: 799 }) },
      "rq-cap",
      "2026-11-01T18:00:00.000Z",
    );
    assert.equal(blocked.ok, false);
    if (!blocked.ok) assert.equal(blocked.scope, "contact");
  });

  it("keeps letters and emoji marks and strips the other invisibles", () => {
    assert.equal(cleanFreeText("ﬁ"), "ﬁ");
    assert.equal(cleanFreeText("²"), "²");
    assert.equal(cleanFreeText("Ⅳ"), "Ⅳ");
    assert.equal(cleanFreeText("josé"), "josé");
    assert.equal(cleanFreeText("a\u0001b"), "ab");
    assert.equal(cleanFreeText("a\u007Fb"), "ab");
    assert.equal(cleanFreeText("a\u0085b"), "ab");
    assert.equal(cleanFreeText("a\u2028b\u2029c"), "abc");
    assert.equal(cleanFreeText("a\u00ADb"), "ab");
    assert.equal(cleanFreeText("a\u034Fb"), "ab");
    assert.equal(cleanFreeText("a\u061Cb\u180Ec"), "abc");
    assert.equal(cleanFreeText("a\u0600b\u06DDc\u070Fd\u08E2e"), "abcde");
    assert.equal(cleanFreeText("a\u17B4b\u17B5c"), "abc");
    assert.equal(cleanFreeText("a\u180Bb\u180Fc"), "abc");
    assert.equal(cleanFreeText("a\u206Ab\u206Fc"), "abc");
    assert.equal(cleanFreeText("a\u200Bb"), "ab");
    assert.equal(cleanFreeText("a\u200Eb\u200Fc"), "abc");
    assert.equal(cleanFreeText("a\u202Ac"), "ac");
    assert.equal(cleanFreeText("a\u2060b\u2066c"), "abc");
    assert.equal(cleanFreeText("a\uFFF9b"), "ab");
    assert.equal(cleanFreeText("a\u3164b"), "ab");
    assert.equal(cleanFreeText("a\u{E0041}b"), "ab");
    assert.equal(cleanFreeText("a\uFE0Fb"), "ab");
    assert.equal(cleanFreeText("\u2764\uFE0F"), "\u2764\uFE0F");
    assert.equal(cleanFreeText("a\uFE00b"), "ab");
    assert.equal(cleanFreeText("a\u200Db"), "ab");
    assert.equal(cleanFreeText(" \u200D "), "  ");
    assert.equal(dedupeKey("a\u200Db"), "ab");
    assert.equal(cleanFreeText("\u{1F468}\u200D\u{1F469}"), "\u{1F468}\u200D\u{1F469}");
  });

  it("cleans a new customer's mobile, email, and make, and stores a folded phone", () => {
    const shop = createShopStore({ demoMode: true, storage: memoryStorage() });
    shop.getState().setWorkingAs("megan");
    const created = shop.getState().createCustomer({
      name: "José Alvarez",
      phone: "95095551234",
      mobile: "509\u200B555\u20660199",
      email: "Pat\u202E@Example.com",
      year: 2020,
      make: "Ford\u0007",
      model: "F-150",
    });
    assert.equal(created.error ?? null, null, created.error ?? "");
    const customer = shop.getState().customers.find((row) => row.id === created.customerId);
    const vehicle = shop.getState().vehicles.find((row) => row.id === created.vehicleId);
    assert.equal(customer?.phone, "5095551234");
    assert.equal(customer?.mobile, "5095550199");
    assert.equal(customer?.email, "pat@example.com");
    assert.equal(vehicle?.make, "Ford");
  });
});

describe("round 20 pulse, seed, and settings", () => {
  it("names a finished month in totals and a new month by its name", () => {
    for (const pin of ["2026-11-01T20:00:00.000Z", "2026-11-17T20:00:00.000Z", "2026-12-01T20:00:00.000Z"]) {
      pinClock(pin);
      const text = mount(createElement(ScorecardPulse, {}));
      assert.match(text, /October 2026 \(Oct 19–23\)/);
      assert.equal(text.replaceAll("Total parts inventory", "").includes("Total"), false);
      assert.match(text, /Sample data\./);
      assert.equal(text.includes("MTD"), false);
      assert.equal(text.includes("Projected"), false);
      assert.equal(text.includes("Last 30 working days"), false);
      assert.equal(text.includes("regenerates daily"), false);
    }
    assert.equal(lengthLabel(30), "30 min");
    assert.equal(lengthLabel(90), "1.5 hr");
    assert.equal(lengthLabel(60), "1 hr");
  });

  it("keeps open repair orders off Thanksgiving week holidays", () => {
    pinClock("2026-11-29T20:00:00.000Z");
    const coulee = createSeed("grand-coulee");
    const pullman = createSeed("pullman");
    assert.equal(coulee.orders.some((order) => order.openedOn === "2026-11-26" || order.invoicedOn === "2026-11-26"), false);
    assert.equal(pullman.orders.some((order) => order.openedOn === "2026-11-27" || order.invoicedOn === "2026-11-27"), false);
    assert.equal(coulee.appointments.some((row) => row.date === "2026-11-26"), false);
    assert.equal(pullman.appointments.some((row) => row.date === "2026-11-27"), false);
  });

  it("does not tell a blank worker that only an advisor can change scheduling", () => {
    const shop = createSeed();
    useShop.setState({ ...shop, workingAsId: "", dataset: "sample", activeStoreId: "grand-coulee", stores: { "grand-coulee": shop, pullman: shop } });
    const text = mount(createElement(SchedulingSettingsForm, {}));
    assert.equal(text.includes("Only an advisor or service manager can change scheduling."), false);
  });
});
