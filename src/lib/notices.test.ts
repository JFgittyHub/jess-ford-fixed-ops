import assert from "node:assert/strict";
import { after, describe, it } from "node:test";
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { NoticeLog } from "../components/notice-log.tsx";
import { textingAdapter } from "./adapters/texting.ts";
import { laborHoursFor } from "./capacity.ts";
import { pinClock, resetClock } from "./clock.ts";
import { requestHolds, visitSlots } from "./online-request.ts";
import { onlineSlots } from "./capacity.ts";
import type { ShopStorage } from "./shop-storage.ts";
import { createShopStore, type ShopState } from "./store.ts";

const when = "2026-10-20T14:00:00.000Z";
const friday = "2026-10-23";

describe("approval, decline, and simulated notices", () => {
  after(() => resetClock());

  it("approves a pending request into an appointment and keeps the same hours", () => {
    pinClock(when);
    const shop = createShopStore({ demoMode: true, storage: memoryStorage() });
    const state = shop.getState();
    const pick = choice(state, "09:00");
    const before = state.appointments.length;
    const saved = state.addOnlineRequest({
      ...pick,
      contactMethod: "email",
      verified: false,
      customerName: "New Customer",
      phone: "5552011888",
      email: "new.customer@example.com",
      year: 2021,
      make: "Sample",
      model: "Hatch",
      vin: "2T1BURHE0JC123456",
      plate: "NEW123",
    });
    assert.equal(saved.ok, true);
    if (!saved.ok) return;
    const pending = shop.getState().onlineRequests[0];
    const held = requestHolds(shop.getState().onlineRequests);
    assert.equal(held.length, 1);
    assert.equal(held[0].laborHours, pending.laborHours);

    const approved = shop.getState().approveOnlineRequest(saved.id, "");
    assert.equal(approved.ok, true);
    const next = shop.getState();
    assert.equal(next.appointments.length, before + 1);
    assert.equal(requestHolds(next.onlineRequests).length, 0);
    const request = next.onlineRequests[0];
    assert.equal(request.status, "approved");
    const appointment = next.appointments.find((row) => row.id === request.appointmentId);
    assert.ok(appointment);
    assert.equal(appointment.date, request.date);
    assert.equal(appointment.time, request.time);
    assert.equal(appointment.techId, request.techId);
    assert.equal(appointment.advisorId, request.advisorId);
    assert.equal(appointment.lane, request.transportId);
    assert.equal(laborHoursFor(appointment.laborOpIds, appointment.minutes, next.laborOps), request.laborHours);
    assert.equal(next.customers.some((row) => row.name === "New Customer"), true);
    const notice = next.notices.find((row) => row.id === (approved.ok ? approved.noticeId : ""));
    assert.ok(notice);
    assert.equal(notice.kind, "approval");
    assert.equal(notice.method, "email");
    assert.equal(notice.recipient, "new.customer@example.com");
    assert.match(notice.body, /confirmed/i);
    assert.equal(textingAdapter.enabled, false);
    assert.deepEqual(textingAdapter.send({ to: notice.recipient, body: notice.body, purpose: "notice" }), { delivered: false, reason: "adapter-off" });
    assert.equal(next.overrides.length, 0);
  });

  it("links an unverified request to the matching customer", () => {
    pinClock(when);
    const shop = createShopStore({ demoMode: true, storage: memoryStorage() });
    const state = shop.getState();
    const denise = state.customers.find((row) => row.name === "Denise Harper");
    assert.ok(denise);
    const beforeVehicles = state.vehicles.filter((row) => row.customerId === denise.id).length;
    const saved = state.addOnlineRequest({
      ...choice(state, "10:00"),
      contactMethod: "call",
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
    assert.equal(saved.ok, true);
    if (!saved.ok) return;
    const approved = shop.getState().approveOnlineRequest(saved.id);
    assert.equal(approved.ok, true);
    const request = shop.getState().onlineRequests[0];
    assert.equal(request.customerId, denise.id);
    assert.equal(request.verified, false);
    assert.equal(shop.getState().vehicles.filter((row) => row.customerId === denise.id).length, beforeVehicles + 1);
    assert.equal(shop.getState().notices[0].method, "call");
    assert.equal(shop.getState().notices[0].recipient, denise.phone);
  });

  it("frees the slot when an advisor declines", () => {
    pinClock(when);
    const shop = createShopStore({ demoMode: true, storage: memoryStorage() });
    const state = shop.getState();
    const pick = choice(state, "11:00");
    const saved = state.addOnlineRequest({
      ...pick,
      contactMethod: "text",
      verified: false,
      customerName: "Hold Customer",
      phone: "5552011777",
      email: "hold@example.com",
      year: 2020,
      make: "Sample",
      model: "Truck",
      vin: "3FAHP0HA6AR123456",
      plate: "HOLD1",
    });
    assert.equal(saved.ok, true);
    if (!saved.ok) return;
    const request = shop.getState().onlineRequests[0];
    const appointments = shop.getState().appointments.length;
    const declined = shop.getState().declineOnlineRequest(saved.id);
    assert.equal(declined.ok, true);
    assert.equal(shop.getState().onlineRequests[0].status, "declined");
    assert.equal(requestHolds(shop.getState().onlineRequests).length, 0);
    assert.equal(shop.getState().appointments.length, appointments);
    const notice = shop.getState().notices[0];
    assert.equal(notice.kind, "decline");
    assert.equal(notice.method, "text");
    assert.equal(notice.recipient, "5552011777");
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
    const whileHeld = onlineSlots({ ...slotInput, loads: busy, holds: requestHolds([request]) });
    const afterDecline = onlineSlots({ ...slotInput, loads: busy, holds: requestHolds(shop.getState().onlineRequests) });
    assert.equal(whileHeld.length, 0);
    assert.equal(afterDecline.length > 0, true);
    assert.equal(textingAdapter.enabled, false);
  });

  it("simulates one day-before reminder per confirmed appointment", () => {
    pinClock(when);
    const shop = createShopStore({ demoMode: true, storage: memoryStorage() });
    const state = shop.getState();
    const tomorrow = "2026-10-21";
    const saved = state.addOnlineRequest({
      ...choice(state, "09:30", tomorrow),
      contactMethod: "email",
      verified: false,
      customerName: "Reminder Customer",
      phone: "5552011666",
      email: "remind@example.com",
      year: 2018,
      make: "Sample",
      model: "Coupe",
      vin: "JH4KA4650MC000001",
      plate: "REMIND",
    });
    assert.equal(saved.ok, true);
    if (!saved.ok) return;
    assert.equal(shop.getState().approveOnlineRequest(saved.id, "").ok, true);
    const appointmentId = shop.getState().onlineRequests[0].appointmentId;
    const first = shop.getState().simulateDayBeforeReminders();
    const reminders = shop.getState().notices.filter((row) => row.kind === "reminder");
    assert.equal(reminders.filter((row) => row.appointmentId === appointmentId).length, 1);
    assert.equal(reminders.find((row) => row.appointmentId === appointmentId)?.method, "email");
    assert.match(reminders.find((row) => row.appointmentId === appointmentId)?.body ?? "", /tomorrow/i);
    const again = shop.getState().simulateDayBeforeReminders();
    assert.equal(again.created, 0);
    assert.equal(shop.getState().notices.filter((row) => row.kind === "reminder" && row.appointmentId === appointmentId).length, 1);
    assert.equal(first.created >= 1, true);
    const html = renderToString(createElement(NoticeLog, { rows: shop.getState().notices.filter((row) => row.appointmentId === appointmentId || row.requestId === saved.id) }));
    assert.match(html, /Day-before reminder/);
    assert.match(html, /Email/);
    assert.match(html, /remind@example.com/);
    assert.equal(textingAdapter.enabled, false);
  });

  it("keeps Pullman notices off the Grand Coulee desk", () => {
    pinClock(when);
    const shop = createShopStore({ demoMode: true, storage: memoryStorage() });
    const coulee = shop.getState().addOnlineRequest({
      ...choice(shop.getState(), "13:00"),
      verified: false,
      customerName: "Helen Cho",
      phone: "5552011400",
      email: "helen.cho@example.com",
      year: 2024,
      make: "Sample",
      model: "Truck",
      vin: "1FTAB12C0RG000099",
      plate: "COULEE",
    });
    assert.equal(coulee.ok, true);
    if (!coulee.ok) return;
    shop.getState().declineOnlineRequest(coulee.id);
    shop.getState().switchStore("pullman");
    assert.equal(shop.getState().notices.length, 0);
    assert.equal(shop.getState().onlineRequests.length, 0);
    const pullman = shop.getState().addOnlineRequest({
      ...choice(shop.getState(), "13:00"),
      contactMethod: "text",
      verified: false,
      customerName: "Bennett Shaw",
      phone: "5553322201",
      email: "bennett.shaw@example.com",
      year: 2022,
      make: "Sample",
      model: "Wagon",
      vin: "1FTPULMN0RC000099",
      plate: "PULLMN",
    });
    assert.equal(pullman.ok, true);
    if (!pullman.ok) return;
    shop.getState().approveOnlineRequest(pullman.id, "");
    const pullmanHtml = renderToString(createElement(NoticeLog, { rows: shop.getState().notices }));
    assert.match(pullmanHtml, /Bennett Shaw/);
    assert.equal(pullmanHtml.includes("Helen Cho"), false);
    shop.getState().switchStore("grand-coulee");
    const couleeHtml = renderToString(createElement(NoticeLog, { rows: shop.getState().notices }));
    assert.match(couleeHtml, /Helen Cho/);
    assert.match(couleeHtml, /Decline/);
    assert.equal(couleeHtml.includes("Bennett Shaw"), false);
    assert.equal(shop.getState().stores.pullman.notices[0].customerName, "Bennett Shaw");
  });
});

function choice(state: ShopState, time: string, date = friday) {
  const serviceId = state.settings.scheduling.onlineMenu[0].id;
  const advisorId = state.advisors[1]?.id ?? state.advisors[0].id;
  const slots = visitSlots(state, { serviceId, advisorId, date, now: new Date(when) });
  const slot = slots.find((row) => row.time === time) ?? slots.find((row) => row.date === date);
  if (!slot) throw new Error(`No online slot on ${date} at ${time}`);
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
