import assert from "node:assert/strict";
import { after, describe, it } from "node:test";
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { OverrideLog } from "../components/override-log.tsx";
import { pinClock, resetClock } from "./clock.ts";
import type { ShopStorage } from "./shop-storage.ts";
import { createShopStore } from "./store.ts";
import type { Appointment } from "./types.ts";

const friday = "2026-10-23";
const when = "2026-10-20T15:30:00.000Z";

describe("capacity overrides", () => {
  after(() => resetClock());

  it("records who and when when an advisor saves through a technician-hours warning", () => {
    pinClock(when);
    const shop = createShopStore({ demoMode: true, storage: memoryStorage() });
    shop.getState().setWorkingAs("megan");
    const saved = shop.getState().saveAdvisorAppointment(draft(shop.getState(), { minutes: 690, concern: "Long job" }));
    const log = shop.getState().overrides;
    assert.equal(log.length, 1);
    assert.equal(saved.overrideId, log[0].id);
    assert.equal(log[0].appointmentId, saved.appointmentId);
    assert.equal(log[0].who, "Megan Cho");
    assert.equal(log[0].whoId, "megan");
    assert.equal(log[0].at, when);
    assert.equal(log[0].storeId, "grand-coulee");
    assert.equal(log[0].customerName, "Helen Cho");
    assert.equal(log[0].date, friday);
    assert.equal(log[0].techName, "Marcus Hale");
    assert.equal(log[0].advisorName, "Megan Cho");
    assert.equal(log[0].reason, "tech-hours");
    assert.equal(shop.getState().appointments.some((row) => row.id === saved.appointmentId), true);
  });

  it("records an override when an edit is saved through the warning", () => {
    pinClock(when);
    const shop = createShopStore({ demoMode: true, storage: memoryStorage() });
    shop.getState().setWorkingAs("jordan");
    const saved = shop.getState().saveAdvisorAppointment(draft(shop.getState(), { minutes: 30, concern: "Oil change" }));
    assert.equal(shop.getState().overrides.length, 0);
    const edited = shop.getState().saveAdvisorAppointment(
      draft(shop.getState(), { minutes: 690, concern: "Oil change grew" }),
      saved.appointmentId,
    );
    assert.equal(edited.appointmentId, saved.appointmentId);
    assert.equal(shop.getState().overrides.length, 1);
    assert.equal(shop.getState().overrides[0].who, "Jordan Hale");
    assert.equal(shop.getState().overrides[0].at, when);
    assert.equal(shop.getState().overrides[0].reason, "tech-hours");
    assert.equal(shop.getState().appointments.find((row) => row.id === saved.appointmentId)?.minutes, 690);
  });

  it("writes nothing when the booking fits, including a later edit that still fits", () => {
    const shop = createShopStore({ demoMode: true, storage: memoryStorage() });
    const before = shop.getState().appointments.length;
    const saved = shop.getState().saveAdvisorAppointment(draft(shop.getState(), { minutes: 30, concern: "Oil change" }));
    assert.equal(saved.overrideId, null);
    assert.equal(shop.getState().appointments.length, before + 1);
    assert.equal(shop.getState().overrides.length, 0);
    shop.getState().saveAdvisorAppointment(
      draft(shop.getState(), { minutes: 30, concern: "Oil change and a tire check" }),
      saved.appointmentId,
    );
    assert.equal(shop.getState().overrides.length, 0);
  });

  it("does not record an override for a raw appointment save", () => {
    const shop = createShopStore({ demoMode: true, storage: memoryStorage() });
    shop.getState().addAppointment(draft(shop.getState(), { minutes: 690, concern: "Long job" }));
    assert.equal(shop.getState().overrides.length, 0);
  });

  it("records advisor capacity, and both sides when hours and the advisor are full", () => {
    const shop = createShopStore({ demoMode: true, storage: memoryStorage() });
    const state = shop.getState();
    for (let index = 0; index < 10; index += 1) {
      const result = state.saveAdvisorAppointment(draft(state, { time: slot(index), minutes: 30, concern: `Visit ${index}` }));
      assert.equal(result.overrideId, null);
    }
    const advisorOnly = state.saveAdvisorAppointment(draft(state, { time: "15:00", minutes: 30, concern: "One more" }));
    assert.equal(shop.getState().overrides.find((row) => row.id === advisorOnly.overrideId)?.reason, "advisor");
    const both = state.saveAdvisorAppointment(draft(state, { time: "15:30", minutes: 630, concern: "Does not fit" }));
    assert.equal(shop.getState().overrides.find((row) => row.id === both.overrideId)?.reason, "both");
  });

  it("lists the open store only, so a Pullman override stays off Grand Coulee", () => {
    pinClock(when);
    const shop = createShopStore({ demoMode: true, storage: memoryStorage() });
    shop.getState().setWorkingAs("jordan");
    shop.getState().saveAdvisorAppointment(draft(shop.getState(), { minutes: 690, concern: "Coulee overload" }));
    const coulee = shop.getState().overrides;
    assert.equal(coulee.length, 1);
    assert.equal(coulee[0].who, "Jordan Hale");
    assert.equal(coulee[0].customerName, "Helen Cho");

    shop.getState().switchStore("pullman");
    assert.equal(shop.getState().overrides.length, 0);
    const pullman = shop.getState();
    pullman.setWorkingAs(pullman.advisors[0].id);
    pullman.saveAdvisorAppointment(draft(pullman, { minutes: 690, concern: "Pullman overload" }));
    const pullmanLog = shop.getState().overrides;
    assert.equal(pullmanLog.length, 1);
    assert.equal(pullmanLog[0].storeId, "pullman");
    assert.equal(pullmanLog[0].who, "Riley Chen");
    assert.equal(pullmanLog[0].customerName, "Marisol Vega");
    assert.equal(pullmanLog[0].techName, "Holly Grant");
    assert.equal(pullmanLog[0].at, when);

    const couleeList = renderToString(createElement(OverrideLog, { rows: coulee }));
    assert.match(couleeList, /Jordan Hale/);
    assert.match(couleeList, /Helen Cho/);
    assert.match(couleeList, /Marcus Hale/);
    assert.match(couleeList, /Technician hours/);
    assert.match(couleeList, /Oct 20, 2026/);
    assert.equal(couleeList.includes("Marisol Vega"), false);
    assert.equal(couleeList.includes("Riley Chen"), false);
    assert.equal(couleeList.includes("Holly Grant"), false);

    const pullmanList = renderToString(createElement(OverrideLog, { rows: shop.getState().overrides }));
    assert.match(pullmanList, /Riley Chen/);
    assert.match(pullmanList, /Marisol Vega/);
    assert.match(pullmanList, /Holly Grant/);
    assert.equal(pullmanList.includes("Helen Cho"), false);
    assert.equal(pullmanList.includes("Jordan Hale"), false);

    shop.getState().switchStore("grand-coulee");
    assert.equal(shop.getState().overrides.length, 1);
    assert.equal(shop.getState().overrides[0].customerName, "Helen Cho");
    assert.equal(shop.getState().stores.pullman.overrides[0].customerName, "Marisol Vega");
    assert.equal(renderToString(createElement(OverrideLog, { rows: [] })).includes("No overrides on this store."), true);
  });
});

function draft(
  state: { customers: { id: string }[]; vehicles: { id: string }[]; advisors: { id: string }[]; techs: { id: string }[] },
  patch: { minutes: number; concern: string; time?: string },
): Omit<Appointment, "id" | "orderId"> {
  return {
    date: friday,
    time: patch.time ?? "09:00",
    minutes: patch.minutes,
    customerId: state.customers[0].id,
    vehicleId: state.vehicles[0].id,
    advisorId: state.advisors.find((row) => row.id === "megan" || row.id.endsWith("megan"))?.id ?? state.advisors[0].id,
    concern: patch.concern,
    lines: [{ id: "", code: "A", concern: patch.concern }],
    vin: "",
    laborOpIds: [],
    techId: state.techs[0].id,
    lane: "drop",
    status: "scheduled",
  };
}

function slot(index: number) {
  const mins = 7 * 60 + index * 30;
  return `${String(Math.floor(mins / 60)).padStart(2, "0")}:${String(mins % 60).padStart(2, "0")}`;
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
