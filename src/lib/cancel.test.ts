import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { after, describe, it } from "node:test";
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { AppointmentCalendar } from "../components/appointment-calendar.tsx";
import { CancelledHistory, DeskCancelActions } from "../components/cancel-appointment.tsx";
import { textingAdapter } from "./adapters/texting.ts";
import { deskSeedFor } from "./booking.ts";
import { appointmentLoads, assessAppointment, onlineSlots } from "./capacity.ts";
import { pinClock, resetClock } from "./clock.ts";
import {
  CANCEL_REASONS,
  activeCancellation,
  appointmentsOnBoard,
  cancelledOnDay,
  deskActor,
  mayCancelAppointment,
} from "./cancel.ts";
import { tomorrowIso } from "./notices.ts";
import type { ShopStorage } from "./shop-storage.ts";
import { createShopStore, type ShopState } from "./store.ts";
import type { Appointment, CancelReason } from "./types.ts";

const when = "2026-10-20T15:30:00.000Z";
const day = "2027-01-06";

describe("cancel an appointment", () => {
  after(() => resetClock());

  it("lets an advisor or service manager cancel from the desk, and nobody else", () => {
    assert.equal(mayCancelAppointment("advisor"), true);
    assert.equal(mayCancelAppointment("service-manager"), true);
    assert.equal(mayCancelAppointment("technician"), false);
    assert.equal(mayCancelAppointment("customer"), false);

    for (const surface of ["card", "edit"] as const) {
      const advisor = renderToString(createElement(DeskCancelActions, { actor: "advisor", status: "scheduled", surface }));
      const manager = renderToString(createElement(DeskCancelActions, { actor: "service-manager", status: "scheduled", surface }));
      const tech = renderToString(createElement(DeskCancelActions, { actor: "technician", status: "scheduled", surface }));
      const customer = renderToString(createElement(DeskCancelActions, { actor: "customer", status: "scheduled", surface }));
      assert.match(advisor, /Cancel appointment/);
      assert.match(advisor, new RegExp(`data-desk-cancel="${surface}"`));
      assert.match(manager, /Cancel appointment/);
      assert.equal(tech.includes("Cancel appointment"), false);
      assert.equal(customer.includes("Cancel appointment"), false);
      assert.equal(advisor.includes("Delete"), false);
    }

    const request = readFileSync(new URL("../routes/request.tsx", import.meta.url), "utf8");
    const online = readFileSync(new URL("./online-request.ts", import.meta.url), "utf8");
    assert.equal(request.includes("cancelAppointment"), false);
    assert.equal(request.includes("Cancel appointment"), false);
    assert.equal(online.includes("cancelAppointment"), false);

    const shop = createShopStore({ demoMode: true, storage: memoryStorage() });
    const helen = shop.getState().customers.find((row) => row.name === "Helen Cho");
    assert.ok(helen);
    const beforeShows = helen.noShows;
    shop.getState().setWorkingAs("megan");
    assert.equal(deskActor(shop.getState()), "advisor");
    const saved = book(shop.getState(), "Advisor cancel");
    assert.equal(shop.getState().cancelAppointment(saved.appointmentId, { reason: "customer-request" }).ok, true);

    shop.getState().setWorkingAs("marcus");
    assert.equal(deskActor(shop.getState()), "technician");
    const techVisit = book(shop.getState(), "Tech cannot cancel");
    const refused = shop.getState().cancelAppointment(techVisit.appointmentId, { reason: "customer-request" });
    assert.equal(refused.ok, false);
    assert.match(refused.error ?? "", /advisor or service manager/);
    assert.equal(shop.getState().appointments.find((row) => row.id === techVisit.appointmentId)?.status, "scheduled");

    shop.setState({ workingAsId: "" });
    assert.equal(deskActor(shop.getState()), "customer");
    const customerVisit = book(shop.getState(), "Customer cannot cancel");
    const customerRefused = shop.getState().cancelAppointment(customerVisit.appointmentId, { reason: "customer-request" });
    assert.equal(customerRefused.ok, false);
    assert.equal(shop.getState().appointments.find((row) => row.id === customerVisit.appointmentId)?.status, "scheduled");
    assert.equal(shop.getState().customers.find((row) => row.id === helen.id)?.noShows, beforeShows);
  });

  it("requires a reason, and a note for Other, and records who and when", () => {
    pinClock(when);
    const shop = createShopStore({ demoMode: true, storage: memoryStorage() });
    shop.getState().setWorkingAs("megan");
    const saved = book(shop.getState(), "Needs a reason");
    const bad = shop.getState().cancelAppointment(saved.appointmentId, { reason: "nope" as CancelReason });
    assert.equal(bad.ok, false);
    assert.equal(bad.error, "Choose a reason.");
    assert.equal(shop.getState().appointments.find((row) => row.id === saved.appointmentId)?.status, "scheduled");

    const other = shop.getState().cancelAppointment(saved.appointmentId, { reason: "other", note: "  " });
    assert.equal(other.ok, false);
    assert.equal(other.error, "Add a note for Other.");
    assert.equal(shop.getState().appointments.find((row) => row.id === saved.appointmentId)?.status, "scheduled");

    for (const reason of CANCEL_REASONS) {
      const visit = book(shop.getState(), reason.label);
      const note = reason.id === "other" ? "Booked on the wrong day" : "";
      const result = shop.getState().cancelAppointment(visit.appointmentId, { reason: reason.id, note });
      assert.equal(result.ok, true, reason.label);
      const row = shop.getState().appointments.find((item) => item.id === visit.appointmentId);
      assert.equal(row?.status, "cancelled");
      const record = activeCancellation(row!);
      assert.ok(record);
      assert.equal(record.reason, reason.id);
      assert.equal(record.note, note);
      assert.equal(record.who, "Megan Cho");
      assert.equal(record.whoId, "megan");
      assert.equal(record.at, when);
    }
  });

  it("leaves the board, stops counting hours, and stays in history behind Show cancelled", () => {
    const shop = createShopStore({ demoMode: true, storage: memoryStorage() });
    shop.getState().setWorkingAs("megan");
    const state = shop.getState();
    const seed = deskSeedFor(state);
    const heavy = state.saveAdvisorAppointment(draft(seed, { minutes: 690, concern: "Fills the day" }));
    assert.equal(heavy.ok, true, heavy.error ?? "");
    const full = assessAppointment({
      scheduling: state.settings.scheduling,
      advisors: state.advisors,
      techs: state.techs,
      appointments: shop.getState().appointments,
      laborOps: state.laborOps,
      proposal: { date: day, time: "15:00", minutes: 60, advisorId: seed.advisorId, techId: seed.techId, laborOpIds: [] },
    });
    assert.equal(full.open, false);
    const hidden = onlineSlots({
      scheduling: state.settings.scheduling,
      advisors: state.advisors,
      techs: state.techs,
      loads: appointmentLoads(shop.getState().appointments, state.laborOps),
      serviceId: state.settings.scheduling.onlineMenu[0].id,
      from: day,
      through: day,
      techId: seed.techId,
      now: new Date("2027-01-06T15:00:00Z"),
    });
    assert.equal(hidden.length, 0);

    assert.equal(shop.getState().cancelAppointment(heavy.appointmentId, { reason: "rescheduled" }).ok, true);
    const after = shop.getState();
    const cancelled = after.appointments.find((row) => row.id === heavy.appointmentId);
    assert.equal(cancelled?.status, "cancelled");
    assert.equal(appointmentsOnBoard(after.appointments).some((row) => row.id === heavy.appointmentId), false);
    assert.equal(cancelledOnDay(after.appointments, day).some((row) => row.id === heavy.appointmentId), true);
    assert.equal(appointmentLoads(after.appointments, after.laborOps).find((row) => row.id === heavy.appointmentId)?.counts, false);
    const openAgain = assessAppointment({
      scheduling: after.settings.scheduling,
      advisors: after.advisors,
      techs: after.techs,
      appointments: after.appointments,
      laborOps: after.laborOps,
      proposal: { date: day, time: "15:00", minutes: 60, advisorId: seed.advisorId, techId: seed.techId, laborOpIds: [] },
    });
    assert.equal(openAgain.open, true);
    const slots = onlineSlots({
      scheduling: after.settings.scheduling,
      advisors: after.advisors,
      techs: after.techs,
      loads: appointmentLoads(after.appointments, after.laborOps),
      serviceId: after.settings.scheduling.onlineMenu[0].id,
      from: day,
      through: day,
      techId: seed.techId,
      now: new Date("2027-01-06T15:00:00Z"),
    });
    assert.equal(slots.length > 0, true);

    const tech = after.techs.find((row) => row.id === seed.techId);
    assert.ok(tech);
    const board = renderToString(createElement(AppointmentCalendar, {
      appointments: appointmentsOnBoard(after.appointments.filter((row) => row.date === day)),
      day,
      techs: [{ id: tech.id, number: tech.number, name: tech.name, board: tech.board }],
      selectedId: null,
      onSelect: () => undefined,
      onSlot: () => undefined,
      onMove: () => undefined,
      onWrite: () => undefined,
      onEdit: () => undefined,
      label: (row) => row.concern,
      hoursFor: () => 11.5,
      summary: () => summary("Helen Cho"),
    }));
    assert.equal(board.includes("Fills the day"), false);
    const hiddenList = renderToString(createElement(CancelledHistory, {
      rows: cancelledOnDay(after.appointments, day),
      show: false,
      nameFor: () => "Helen Cho",
      allowReinstate: true,
      onReinstate: () => undefined,
    }));
    assert.equal(hiddenList.includes("Fills the day"), false);
    const shownList = renderToString(createElement(CancelledHistory, {
      rows: cancelledOnDay(after.appointments, day),
      show: true,
      nameFor: () => "Helen Cho",
      allowReinstate: true,
      onReinstate: () => undefined,
    }));
    assert.match(shownList, /Fills the day/);
    assert.match(shownList, /Rescheduled/);
    assert.match(shownList, /Megan Cho/);
    assert.match(shownList, /Reinstate/);
  });

  it("is never a no-show and does not set the customer no-show flag", () => {
    const shop = createShopStore({ demoMode: true, storage: memoryStorage() });
    shop.getState().setWorkingAs("megan");
    const helen = shop.getState().customers.find((row) => row.name === "Helen Cho");
    assert.ok(helen);
    const before = helen.noShows;
    const saved = book(shop.getState(), "Not a no-show");
    assert.equal(shop.getState().cancelAppointment(saved.appointmentId, { reason: "vehicle-gone" }).ok, true);
    const row = shop.getState().appointments.find((item) => item.id === saved.appointmentId);
    assert.equal(row?.status, "cancelled");
    assert.notEqual(row?.status, "no_show");
    assert.equal(shop.getState().customers.find((item) => item.id === helen.id)?.noShows, before);

    const marked = book(shop.getState(), "Already a no-show");
    shop.getState().setAppointmentStatus(marked.appointmentId, "no_show");
    const flagged = shop.getState().customers.find((item) => item.id === helen.id)?.noShows ?? 0;
    assert.equal(flagged, before + 1);
    assert.equal(shop.getState().cancelAppointment(marked.appointmentId, { reason: "customer-request" }).ok, true);
    assert.equal(shop.getState().appointments.find((item) => item.id === marked.appointmentId)?.status, "cancelled");
    assert.equal(shop.getState().customers.find((item) => item.id === helen.id)?.noShows, flagged);

    const bypass = book(shop.getState(), "Bypass");
    shop.getState().setAppointmentStatus(bypass.appointmentId, "cancelled");
    shop.getState().updateAppointment(bypass.appointmentId, { status: "cancelled" });
    assert.equal(shop.getState().appointments.find((item) => item.id === bypass.appointmentId)?.status, "scheduled");
    assert.equal(shop.getState().customers.find((item) => item.id === helen.id)?.noShows, flagged);
  });

  it("reinstates through the same capacity check as a booking", () => {
    const shop = createShopStore({ demoMode: true, storage: memoryStorage() });
    shop.getState().setWorkingAs("jordan");
    const seed = deskSeedFor(shop.getState());
    const quiet = book(shop.getState(), "Fits again");
    assert.equal(shop.getState().cancelAppointment(quiet.appointmentId, { reason: "duplicate" }).ok, true);
    const beforeOverrides = shop.getState().overrides.length;
    const back = shop.getState().reinstateAppointment(quiet.appointmentId);
    assert.equal(back.ok, true, back.error ?? "");
    assert.equal(back.overrideId, null);
    assert.equal(shop.getState().overrides.length, beforeOverrides);
    const restored = shop.getState().appointments.find((row) => row.id === quiet.appointmentId);
    assert.equal(restored?.status, "scheduled");
    assert.equal(restored?.cancelHistory?.length, 1);
    assert.equal(activeCancellation(restored!), null);
    assert.equal(appointmentsOnBoard(shop.getState().appointments).some((row) => row.id === quiet.appointmentId), true);

    const heavy = shop.getState().saveAdvisorAppointment(draft(seed, { minutes: 690, concern: "Too long to reinstate quietly" }));
    assert.equal(heavy.ok, true, heavy.error ?? "");
    assert.equal(shop.getState().cancelAppointment(heavy.appointmentId, { reason: "rescheduled" }).ok, true);
    const logged = shop.getState().overrides.length;
    const again = shop.getState().reinstateAppointment(heavy.appointmentId);
    assert.equal(again.ok, true, again.error ?? "");
    assert.ok(again.overrideId);
    const entry = shop.getState().overrides.find((row) => row.id === again.overrideId);
    assert.equal(entry?.appointmentId, heavy.appointmentId);
    assert.equal(entry?.reason, "tech-hours");
    assert.equal(entry?.who, "Jordan Hale");
    assert.equal(shop.getState().overrides.length, logged + 1);
    assert.equal(shop.getState().appointments.find((row) => row.id === heavy.appointmentId)?.status, "scheduled");

    shop.getState().setWorkingAs("marcus");
    const blockedActor = book(shop.getState(), "Tech reinstate");
    shop.setState({ workingAsId: "megan" });
    assert.equal(shop.getState().cancelAppointment(blockedActor.appointmentId, { reason: "customer-request" }).ok, true);
    shop.getState().updateAppointment(blockedActor.appointmentId, { techId: "not-on-this-store" });
    const refused = shop.getState().reinstateAppointment(blockedActor.appointmentId);
    assert.equal(refused.ok, false);
    assert.match(refused.error ?? "", /isn't on this store/);
    assert.equal(shop.getState().appointments.find((row) => row.id === blockedActor.appointmentId)?.status, "cancelled");

    const notCancelled = shop.getState().reinstateAppointment(quiet.appointmentId);
    assert.equal(notCancelled.ok, false);
    assert.match(notCancelled.error ?? "", /not cancelled/);
  });

  it("does not delete the appointment or text the customer", () => {
    pinClock(when);
    const shop = createShopStore({ demoMode: true, storage: memoryStorage() });
    shop.getState().setWorkingAs("megan");
    const saved = book(shop.getState(), "Keep the row");
    const before = shop.getState().appointments.length;
    const notices = JSON.stringify(shop.getState().notices);
    let texts = 0;
    const send = textingAdapter.send.bind(textingAdapter);
    textingAdapter.send = (message) => {
      texts += 1;
      return send(message);
    };
    try {
      assert.equal(shop.getState().cancelAppointment(saved.appointmentId, { reason: "customer-request" }).ok, true);
      assert.equal(texts, 0);
    } finally {
      textingAdapter.send = send;
    }
    assert.equal("removeAppointment" in shop.getState(), false);
    assert.equal(shop.getState().appointments.length, before);
    assert.equal(shop.getState().appointments.some((row) => row.id === saved.appointmentId), true);
    assert.equal(JSON.stringify(shop.getState().notices), notices);
    assert.equal(shop.getState().notices.some((row) => row.appointmentId === saved.appointmentId), false);

    const reminder = shop.getState().saveAdvisorAppointment(draft(deskSeedFor(shop.getState()), {
      date: tomorrowIso(new Date(when)),
      concern: "Would have been a reminder",
    }));
    assert.equal(reminder.ok, true, reminder.error ?? "");
    assert.equal(shop.getState().cancelAppointment(reminder.appointmentId, { reason: "customer-request" }).ok, true);
    shop.getState().simulateDayBeforeReminders();
    assert.equal(shop.getState().notices.some((row) => row.appointmentId === reminder.appointmentId), false);

    const reinstatedNotices = JSON.stringify(shop.getState().notices);
    assert.equal(shop.getState().reinstateAppointment(saved.appointmentId).ok, true);
    assert.equal(JSON.stringify(shop.getState().notices), reinstatedNotices);
  });
});

function book(state: ShopState, concern: string) {
  return state.saveAdvisorAppointment(draft(deskSeedFor(state), { concern, time: uniqueTime(concern) }));
}

function uniqueTime(label: string) {
  const slot = Math.abs(hash(label)) % 18;
  const mins = 7 * 60 + slot * 30;
  return `${String(Math.floor(mins / 60)).padStart(2, "0")}:${String(mins % 60).padStart(2, "0")}`;
}

function hash(value: string) {
  return [...value].reduce((sum, char) => sum + char.charCodeAt(0), 0);
}

function draft(
  seed: { customerId: string; vehicleId: string; advisorId: string; techId: string },
  patch: Partial<Omit<Appointment, "id" | "orderId">> & { concern: string },
): Omit<Appointment, "id" | "orderId"> {
  const { concern, ...rest } = patch;
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
    ...rest,
    concern,
    lines: [{ id: "a", code: "A", concern }],
  };
}

function summary(name: string) {
  return {
    name,
    vehicle: "Truck",
    advisor: "Advisor",
    tech: "Tech",
    when: day,
    lane: "Drop-off",
    concern: "Visit",
    vin: "VIN",
    ops: "None",
    status: "Cancelled",
    canWrite: false,
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
