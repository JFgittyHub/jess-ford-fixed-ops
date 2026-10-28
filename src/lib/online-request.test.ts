import assert from "node:assert/strict";
import { after, describe, it } from "node:test";
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { OnlineRequestList } from "../components/online-request-list.tsx";
import { assessAppointment, onlineSlots } from "./capacity.ts";
import { pinClock, resetClock } from "./clock.ts";
import { lookupOnlineCustomer, requestHolds, revealSavedVehicles, visitSlots } from "./online-request.ts";
import type { ShopStorage } from "./shop-storage.ts";
import { createShopStore, type ShopState } from "./store.ts";

const when = "2026-10-20T14:00:00.000Z";
const friday = "2026-10-23";

describe("online requests", () => {
  after(() => resetClock());

  it("unlocks saved vehicles only after the one-time code", () => {
    pinClock(when);
    const shop = createShopStore({ demoMode: true, storage: memoryStorage() });
    const state = shop.getState();
    const helen = state.customers.find((row) => row.name === "Helen Cho");
    assert.ok(helen);
    assert.ok(helen.mobile.trim());
    const byPhone = lookupOnlineCustomer(state.customers, state.vehicles, helen.phone);
    const byEmail = lookupOnlineCustomer(state.customers, state.vehicles, helen.email.toUpperCase());
    const vehicle = state.vehicles.find((row) => row.customerId === helen.id);
    assert.ok(vehicle);
    const byVin = lookupOnlineCustomer(state.customers, state.vehicles, vehicle.vin.slice(-8).toLowerCase());
    assert.deepEqual(byPhone, { kind: "code", customerId: helen.id });
    assert.deepEqual(byEmail, { kind: "code", customerId: helen.id });
    assert.deepEqual(byVin, { kind: "code", customerId: helen.id });

    const issued = state.issueOnlineChallenge(helen.id);
    assert.equal(issued.ok, true);
    if (!issued.ok) return;
    const wrongCode = issued.code === "000000" ? "000001" : "000000";
    const wrong = revealSavedVehicles({
      customer: helen,
      vehicles: state.vehicles,
      issuedCode: issued.code,
      enteredCode: wrongCode,
    });
    assert.equal(wrong.unlocked, false);
    assert.equal(wrong.vehicles.length, 0);
    const refused = shop.getState().addOnlineRequest({
      ...choice(shop.getState()),
      verified: true,
      code: wrongCode,
      customerId: helen.id,
      vehicleId: vehicle.id,
    });
    assert.equal(refused.ok, false);
    assert.equal(shop.getState().onlineRequests.length, 0);

    const right = revealSavedVehicles({
      customer: helen,
      vehicles: shop.getState().vehicles,
      issuedCode: issued.code,
      enteredCode: issued.code,
    });
    assert.equal(right.unlocked, true);
    assert.equal(right.vehicles.some((row) => row.id === vehicle.id), true);
    assert.equal(right.vehicles.every((row) => row.customerId === helen.id), true);

    const before = shop.getState().appointments.length;
    const saved = shop.getState().addOnlineRequest({
      ...choice(shop.getState()),
      verified: true,
      code: issued.code,
      customerId: helen.id,
      vehicleId: vehicle.id,
    });
    assert.equal(saved.ok, true);
    const request = shop.getState().onlineRequests[0];
    assert.equal(request.verified, true);
    assert.equal(request.status, "pending");
    assert.equal(request.customerId, helen.id);
    assert.equal(request.customerName, "Helen Cho");
    assert.equal(request.vehicleId, vehicle.id);
    assert.equal(request.vin, vehicle.vin);
    assert.equal(request.model, vehicle.model);
    assert.equal(request.storeId, "grand-coulee");
    assert.equal(shop.getState().appointments.length, before);
    assert.equal(shop.getState().overrides.length, 0);
  });

  it("books an unverified request when no mobile is on file, and a new vehicle when there is no record", () => {
    pinClock(when);
    const shop = createShopStore({ demoMode: true, storage: memoryStorage() });
    const state = shop.getState();
    const denise = state.customers.find((row) => row.name === "Denise Harper");
    assert.ok(denise);
    assert.equal(denise.mobile, "");
    assert.deepEqual(lookupOnlineCustomer(state.customers, state.vehicles, denise.email), { kind: "unverified" });
    assert.equal(state.issueOnlineChallenge(denise.id).ok, false);
    const hidden = revealSavedVehicles({
      customer: denise,
      vehicles: state.vehicles,
      issuedCode: "123456",
      enteredCode: "123456",
    });
    assert.equal(hidden.unlocked, false);
    assert.equal(hidden.vehicles.length, 0);
    const unverified = state.addOnlineRequest({
      ...choice(state, "10:00"),
      verified: false,
      customerName: "Denise Harper",
      phone: denise.phone,
      email: denise.email,
      year: 2019,
      make: "Sample",
      model: "Sedan",
      vin: "1HGCM82633A004352",
      plate: "UNVRFD",
    });
    assert.equal(unverified.ok, true);
    const pending = shop.getState().onlineRequests[0];
    assert.equal(pending.verified, false);
    assert.equal(pending.customerId, null);
    assert.equal(pending.vehicleId, null);
    assert.equal(pending.vin, "1HGCM82633A004352");
    assert.equal(pending.plate, "UNVRFD");
    assert.equal(pending.make, "Sample");

    const created = shop.getState().addOnlineRequest({
      ...choice(shop.getState(), "11:00"),
      verified: false,
      customerName: "New Customer",
      phone: "5552011999",
      email: "new.customer@example.com",
      year: 2021,
      make: "Sample",
      model: "Hatch",
      vin: "2T1BURHE0JC123456",
      plate: "NEW123",
    });
    assert.equal(created.ok, true);
    const fresh = shop.getState().onlineRequests.find((row) => row.customerName === "New Customer");
    assert.ok(fresh);
    assert.equal(fresh.verified, false);
    assert.equal(fresh.vehicleId, null);
    assert.equal(fresh.model, "Hatch");
    assert.equal(fresh.plate, "NEW123");
    assert.equal(lookupOnlineCustomer(state.customers, state.vehicles, "nobody@example.com").kind, "new");
  });

  it("holds the slot so a later online time disappears when the hours no longer fit", () => {
    pinClock(when);
    const shop = createShopStore({ demoMode: true, storage: memoryStorage() });
    const state = shop.getState();
    const pick = choice(state, "09:00");
    const before = visitSlots(state, { serviceId: pick.serviceId, advisorId: pick.advisorId, date: friday, now: new Date(when) });
    assert.equal(before.some((slot) => slot.time === "09:00"), true);
    const saved = state.addOnlineRequest({
      ...pick,
      verified: false,
      customerName: "Hold Customer",
      year: 2020,
      make: "Sample",
      model: "Truck",
      vin: "3FAHP0HA6AR123456",
      plate: "HOLD1",
    });
    assert.equal(saved.ok, true);
    const request = shop.getState().onlineRequests[0];
    assert.equal(shop.getState().appointments.some((row) => row.id === request.id), false);
    const counted = assessAppointment({
      scheduling: state.settings.scheduling,
      advisors: state.advisors,
      techs: state.techs,
      appointments: [],
      laborOps: state.laborOps,
      holds: requestHolds(shop.getState().onlineRequests),
      proposal: { date: friday, time: "12:00", advisorId: request.advisorId, techId: request.techId, laborOpIds: [], minutes: 30 },
    });
    assert.equal(counted.tech.used, request.laborHours);
    const slotInput = {
      scheduling: state.settings.scheduling,
      advisors: state.advisors,
      techs: state.techs,
      serviceId: pick.serviceId,
      advisorId: request.advisorId,
      techId: request.techId,
      from: friday,
      through: friday,
      now: new Date(when),
    };
    const busy = [{ id: "busy", date: friday, time: "08:00", advisorId: request.advisorId, techId: request.techId, laborHours: 9.4, counts: true }];
    const withoutHold = onlineSlots({ ...slotInput, loads: busy, holds: [] });
    const withHold = onlineSlots({ ...slotInput, loads: busy, holds: requestHolds([request]) });
    assert.equal(withoutHold.length > 0, true);
    assert.equal(withHold.length, 0);
  });

  it("keeps a Pullman request off the Grand Coulee list", () => {
    pinClock(when);
    const shop = createShopStore({ demoMode: true, storage: memoryStorage() });
    const couleePick = choice(shop.getState(), "09:30");
    shop.getState().addOnlineRequest({
      ...couleePick,
      verified: false,
      customerName: "Helen Cho",
      year: 2024,
      make: "Sample",
      model: "Truck",
      vin: "1FTAB12C0RG000001",
      plate: "COULEE",
    });
    shop.getState().switchStore("pullman");
    assert.equal(shop.getState().onlineRequests.length, 0);
    const pullmanPick = choice(shop.getState(), "09:30");
    const saved = shop.getState().addOnlineRequest({
      ...pullmanPick,
      verified: false,
      customerName: "Bennett Shaw",
      year: 2022,
      make: "Sample",
      model: "Wagon",
      vin: "1FTPULMN0RC000002",
      plate: "PULLMN",
    });
    assert.equal(saved.ok, true);
    const pullmanList = renderToString(createElement(OnlineRequestList, { rows: shop.getState().onlineRequests }));
    assert.match(pullmanList, /Bennett Shaw/);
    assert.match(pullmanList, /Unverified/);
    assert.equal(pullmanList.includes("Helen Cho"), false);
    shop.getState().switchStore("grand-coulee");
    const couleeList = renderToString(createElement(OnlineRequestList, { rows: shop.getState().onlineRequests }));
    assert.match(couleeList, /Helen Cho/);
    assert.equal(couleeList.includes("Bennett Shaw"), false);
    assert.equal(shop.getState().stores.pullman.onlineRequests[0].customerName, "Bennett Shaw");
    assert.equal(renderToString(createElement(OnlineRequestList, { rows: [] })).includes("No pending requests on this store."), true);
  });
});

function choice(state: ShopState, time = "09:00") {
  const serviceId = state.settings.scheduling.onlineMenu[0].id;
  const advisorId = state.advisors[1]?.id ?? state.advisors[0].id;
  const slots = visitSlots(state, { serviceId, advisorId, date: friday, now: new Date(when) });
  const slot = slots.find((row) => row.time === time) ?? slots[0];
  if (!slot) throw new Error(`No online slot at ${time}`);
  return {
    serviceId,
    advisorId,
    transportId: state.settings.scheduling.transportOptions[0].id,
    date: slot.date,
    time: slot.time,
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
