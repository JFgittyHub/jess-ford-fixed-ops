import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { after, describe, it } from "node:test";
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { AppointmentCalendar, clockTime } from "../components/appointment-calendar.tsx";
import { CancelForm, CancelledHistory, DeskCancelActions } from "../components/cancel-appointment.tsx";
import { textingAdapter } from "./adapters/texting.ts";
import { deskSeedFor } from "./booking.ts";
import { appointmentLoads, assessAppointment, onlineSlots } from "./capacity.ts";
import { pinClock, resetClock } from "./clock.ts";
import {
  CANCEL_NOTE_MAX,
  CANCEL_REASONS,
  CANCELLED_LOCKED,
  MISSING_RO_CANCEL_BLOCKED,
  bookedRoCancelMessage,
  closedRoReinstateMessage,
  openRoCancelMessage,
  activeCancellation,
  appointmentsOnBoard,
  cancelReasonLabel,
  cancellationLine,
  cancelledOnDay,
  deskActor,
  mayCancelAppointment,
  normalizeCancelHistory,
} from "./cancel.ts";
import { tomorrowIso } from "./notices.ts";
import type { ShopStorage } from "./shop-storage.ts";
import { SHOP_PERSIST_VERSION, createShopStore, migrateSavedShop, type ShopState } from "./store.ts";
import type { Appointment, CancelReason, OnlineRequest } from "./types.ts";

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
    assert.match(shownList, new RegExp(clockTime("09:30").replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
    assert.equal(shownList.includes("09:30"), false);
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
    const cancelledNoShow = shop.getState().appointments.find((item) => item.id === marked.appointmentId);
    assert.equal(cancelledNoShow?.status, "cancelled");
    assert.equal(cancelledNoShow?.cancelHistory?.[0]?.priorStatus, "no_show");
    assert.match(cancellationLine(cancelledNoShow!.cancelHistory![0]!), /No-show flag cleared/);
    assert.equal(shop.getState().customers.find((item) => item.id === helen.id)?.noShows, before);
    assert.equal(shop.getState().reinstateAppointment(marked.appointmentId).ok, true);
    assert.equal(shop.getState().appointments.find((item) => item.id === marked.appointmentId)?.status, "scheduled");
    assert.equal(shop.getState().customers.find((item) => item.id === helen.id)?.noShows, before);

    const bypass = book(shop.getState(), "Bypass");
    shop.getState().setAppointmentStatus(bypass.appointmentId, "cancelled");
    shop.getState().updateAppointment(bypass.appointmentId, { status: "cancelled" });
    assert.equal(shop.getState().appointments.find((item) => item.id === bypass.appointmentId)?.status, "scheduled");
    assert.equal(shop.getState().customers.find((item) => item.id === helen.id)?.noShows, before);
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
    assert.equal(restored?.cancelHistory?.length, 2);
    assert.equal(restored?.cancelHistory?.[1]?.action, "reinstate");
    assert.equal(restored?.cancelHistory?.[1]?.who, "Jordan Hale");
    assert.equal(restored?.cancelHistory?.[1]?.whoId, "jordan");
    assert.equal(activeCancellation(restored!), null);
    assert.equal(appointmentsOnBoard(shop.getState().appointments).some((row) => row.id === quiet.appointmentId), true);

    const heavy = shop.getState().saveAdvisorAppointment(draft(seed, { minutes: 690, concern: "Too long to reinstate quietly" }));
    assert.equal(heavy.ok, true, heavy.error ?? "");
    assert.equal(shop.getState().cancelAppointment(heavy.appointmentId, { reason: "rescheduled" }).ok, true);
    const logged = shop.getState().overrides.length;
    const asked = shop.getState().reinstateAppointment(heavy.appointmentId);
    assert.equal(asked.ok, false);
    assert.match(asked.warning ?? "", /You can still book it/);
    assert.equal(asked.overrideId, null);
    assert.equal(shop.getState().overrides.length, logged);
    assert.equal(shop.getState().appointments.find((row) => row.id === heavy.appointmentId)?.status, "cancelled");
    const again = shop.getState().reinstateAppointment(heavy.appointmentId, true);
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
    shop.setState({
      appointments: shop.getState().appointments.map((row) => (row.id === blockedActor.appointmentId ? { ...row, techId: "not-on-this-store" } : row)),
    });
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

  it("records who reinstated the visit and will not edit or move it while cancelled", () => {
    pinClock(when);
    const shop = createShopStore({ demoMode: true, storage: memoryStorage() });
    shop.getState().setWorkingAs("megan");
    const saved = book(shop.getState(), "Locked visit");
    const before = shop.getState().appointments.find((row) => row.id === saved.appointmentId);
    assert.ok(before);
    assert.equal(shop.getState().cancelAppointment(saved.appointmentId, { reason: "customer-request" }).ok, true);
    const cancelled = shop.getState().appointments.find((row) => row.id === saved.appointmentId);
    assert.equal(cancelled?.cancelHistory?.[0]?.action, "cancel");
    assert.equal(cancelled?.cancelHistory?.[0]?.who, "Megan Cho");
    assert.equal(cancelled?.cancelHistory?.[0]?.at, when);

    const edited = shop.getState().saveAdvisorAppointment(draft(deskSeedFor(shop.getState()), {
      concern: "Changed after cancel",
      date: "2027-02-02",
      customerId: shop.getState().customers[1].id,
    }), saved.appointmentId);
    assert.equal(edited.ok, false);
    assert.equal(edited.error, CANCELLED_LOCKED);
    const moved = shop.getState().moveAppointment(saved.appointmentId, { date: "2027-02-02", time: "11:00" });
    assert.equal(moved.ok, false);
    assert.equal(moved.error, CANCELLED_LOCKED);
    const patched = shop.getState().updateAppointment(saved.appointmentId, { concern: "Changed after cancel", vehicleId: "someone-else" });
    assert.equal(patched.ok, false);
    assert.equal(patched.error, CANCELLED_LOCKED);
    const still = shop.getState().appointments.find((row) => row.id === saved.appointmentId);
    assert.equal(still?.date, before.date);
    assert.equal(still?.customerId, before.customerId);
    assert.equal(still?.vehicleId, before.vehicleId);
    assert.equal(still?.concern, before.concern);

    shop.getState().setWorkingAs("jordan");
    const back = shop.getState().reinstateAppointment(saved.appointmentId);
    assert.equal(back.ok, true, back.error ?? "");
    const history = shop.getState().appointments.find((row) => row.id === saved.appointmentId)?.cancelHistory ?? [];
    assert.equal(history.length, 2);
    assert.equal(history[1]?.action, "reinstate");
    assert.equal(history[1]?.who, "Jordan Hale");
    assert.equal(history[1]?.whoId, "jordan");
    assert.equal(history[1]?.at, when);
  });

  it("refuses a technician or advisor who is not on the store when moving or editing", () => {
    const shop = createShopStore({ demoMode: true, storage: memoryStorage() });
    const saved = book(shop.getState(), "Stay on this store");
    const row = shop.getState().appointments.find((item) => item.id === saved.appointmentId);
    assert.ok(row);
    const moved = shop.getState().moveAppointment(saved.appointmentId, { techId: "pl-marcus" });
    assert.equal(moved.ok, false);
    assert.match(moved.error ?? "", /technician isn't on this store/);
    const edited = shop.getState().updateAppointment(saved.appointmentId, { advisorId: "pl-jordan" });
    assert.equal(edited.ok, false);
    assert.match(edited.error ?? "", /advisor isn't on this store/);
    const kept = shop.getState().appointments.find((item) => item.id === saved.appointmentId);
    assert.equal(kept?.techId, row.techId);
    assert.equal(kept?.advisorId, row.advisorId);
    assert.equal(shop.getState().moveAppointment(saved.appointmentId, { techId: "elena", time: "10:00" }).ok, true);
    assert.equal(shop.getState().appointments.find((item) => item.id === saved.appointmentId)?.techId, "elena");
  });

  it("keeps a legacy cancel reason, caps the note, and marks the linked request cancelled", () => {
    const shop = createShopStore({ demoMode: true, storage: memoryStorage() });
    shop.getState().setWorkingAs("megan");
    const saved = book(shop.getState(), "Linked visit");
    const linked = requestFor(saved.appointmentId, "rq-linked");
    const other = requestFor("other-appointment", "rq-other");
    shop.setState({ onlineRequests: [linked, other] });
    const longNote = "x".repeat(CANCEL_NOTE_MAX + 1);
    const tooLong = shop.getState().cancelAppointment(saved.appointmentId, { reason: "other", note: longNote });
    assert.equal(tooLong.ok, false);
    assert.equal(tooLong.error, "Keep the note to 500 characters.");
    assert.equal(shop.getState().cancelAppointment(saved.appointmentId, { reason: "other", note: "x".repeat(CANCEL_NOTE_MAX) }).ok, true);
    assert.equal(shop.getState().onlineRequests.find((row) => row.id === "rq-linked")?.status, "cancelled");
    assert.equal(shop.getState().onlineRequests.find((row) => row.id === "rq-other")?.status, "approved");
    assert.equal(shop.getState().reinstateAppointment(saved.appointmentId).ok, true);
    assert.equal(shop.getState().onlineRequests.find((row) => row.id === "rq-linked")?.status, "approved");
    assert.equal(shop.getState().onlineRequests.find((row) => row.id === "rq-other")?.status, "approved");

    const unnamed = normalizeCancelHistory([{ reason: "customer-request", note: "kept" }]);
    assert.equal(unnamed?.[0]?.who, "Unknown");
    assert.equal(unnamed?.[0]?.at, "");
    assert.match(cancellationLine(unnamed![0]!), /Unknown/);
    const kept = normalizeCancelHistory([{ reason: "sold-the-truck", note: "old", who: "Megan", whoId: "megan", at: when }]);
    assert.equal(kept?.[0]?.reason, "sold-the-truck");
    assert.equal(cancelReasonLabel(kept?.[0]?.reason ?? ""), "Other");
    const migrated = migrateSavedShop({
      orders: [],
      techs: [{ id: "marcus", name: "Marcus Hale" }],
      appointments: [{
        id: "legacy",
        date: day,
        time: "09:00",
        minutes: 60,
        customerId: "c1",
        vehicleId: "v1",
        advisorId: "megan",
        techId: "marcus",
        concern: "Oil",
        lines: [{ id: "a", code: "A", concern: "Oil" }],
        vin: "",
        laborOpIds: [],
        lane: "drop",
        status: "cancelled",
        orderId: null,
        cancelHistory: [{ reason: "sold-the-truck", note: "old", who: "Megan", whoId: "megan", at: when }],
      }],
    });
    const legacy = migrated.appointments?.find((row) => row.id === "legacy");
    assert.equal(legacy?.cancelHistory?.[0]?.reason, "sold-the-truck");
    assert.equal(cancelReasonLabel(legacy?.cancelHistory?.[0]?.reason ?? ""), "Other");
    assert.equal(SHOP_PERSIST_VERSION > 28, true);
  });

  it("lets a technician be removed when only cancelled appointments remain", () => {
    const shop = createShopStore({ demoMode: true, storage: memoryStorage() });
    shop.getState().setWorkingAs("megan");
    assert.equal(shop.getState().addTech({
      number: "77",
      name: "Temp Lane",
      skill: "b",
      payStyle: "flat",
      flagRate: 20,
      hourlyRate: 20,
      board: "main",
    }), true);
    const tech = shop.getState().techs.find((row) => row.name === "Temp Lane");
    assert.ok(tech);
    const saved = shop.getState().saveAdvisorAppointment(draft(deskSeedFor(shop.getState()), { techId: tech.id, concern: "Temp visit" }));
    assert.equal(saved.ok, true, saved.error ?? "");
    assert.equal(shop.getState().removeTech(tech.id), "appointments");
    assert.equal(shop.getState().cancelAppointment(saved.appointmentId, { reason: "duplicate" }).ok, true);
    assert.equal(shop.getState().removeTech(tech.id), "ok");
    assert.equal(shop.getState().techs.some((row) => row.id === tech.id), false);
    assert.equal(shop.getState().appointments.some((row) => row.id === saved.appointmentId), true);
  });

  it("blocks cancel until the repair order is closed, and a booked ticket names the invoice", () => {
    const shop = createShopStore({ demoMode: true, storage: memoryStorage() });
    shop.getState().setWorkingAs("megan");
    const visit = book(shop.getState(), "On a repair order");
    const vehicle = shop.getState().vehicles[0];
    const orderId = shop.getState().createOrder({
      customerId: vehicle.customerId,
      vehicleId: vehicle.id,
      advisorId: shop.getState().advisors[0].id,
      lines: [{ concern: "Linked visit" }],
      mileage: 12,
      promiseTime: "",
    });
    const order = shop.getState().orders.find((row) => row.id === orderId);
    assert.ok(order);
    shop.getState().linkAppointment(visit.appointmentId, orderId);
    const blocked = shop.getState().cancelAppointment(visit.appointmentId, { reason: "rescheduled" });
    assert.equal(blocked.ok, false);
    assert.equal(blocked.error, openRoCancelMessage(order.number));
    assert.match(blocked.error ?? "", /Close the RO first/);
    assert.equal(shop.getState().appointments.find((row) => row.id === visit.appointmentId)?.status, "in_shop");
    shop.setState({
      orders: shop.getState().orders.map((row) => (row.id === orderId ? { ...row, status: "booked" as const } : row)),
    });
    const still = shop.getState().cancelAppointment(visit.appointmentId, { reason: "rescheduled" });
    assert.equal(still.ok, false);
    assert.equal(still.error, bookedRoCancelMessage(order.number));
    assert.match(still.error ?? "", /Close the RO first/);
    assert.match(still.error ?? "", /accurate invoice/);
    assert.equal((still.error ?? "").includes("still open"), false);
    assert.equal(shop.getState().appointments.find((row) => row.id === visit.appointmentId)?.status, "in_shop");
    shop.setState({
      orders: shop.getState().orders.map((row) => (row.id === orderId ? { ...row, status: "closed" as const, closeType: "no_work" as const } : row)),
    });
    const closed = shop.getState().cancelAppointment(visit.appointmentId, { reason: "rescheduled" });
    assert.equal(closed.ok, true, closed.error ?? "");
    assert.equal(shop.getState().appointments.find((row) => row.id === visit.appointmentId)?.status, "cancelled");
    assert.equal(shop.getState().orders.some((row) => row.id === orderId), true);
    const putBack = shop.getState().reinstateAppointment(visit.appointmentId);
    assert.equal(putBack.ok, false);
    assert.equal(putBack.error, closedRoReinstateMessage(order.number));
    assert.equal(shop.getState().appointments.find((row) => row.id === visit.appointmentId)?.status, "cancelled");
    assert.equal(shop.getState().orders.find((row) => row.id === orderId)?.status, "closed");

    const dangling = book(shop.getState(), "Missing repair order");
    shop.setState({
      appointments: shop.getState().appointments.map((row) => (
        row.id === dangling.appointmentId ? { ...row, status: "in_shop" as const, orderId: "ro-not-on-this-store" } : row
      )),
    });
    const missing = shop.getState().cancelAppointment(dangling.appointmentId, { reason: "customer-request" });
    assert.equal(missing.ok, false);
    assert.equal(missing.error, MISSING_RO_CANCEL_BLOCKED);
    assert.equal(shop.getState().appointments.find((row) => row.id === dangling.appointmentId)?.status, "in_shop");
  });

  it("cancels an in-shop visit with no open repair order, and confirms before cancelling an arrived visit", () => {
    const shop = createShopStore({ demoMode: true, storage: memoryStorage() });
    shop.getState().setWorkingAs("megan");
    const inShop = book(shop.getState(), "In the shop");
    shop.getState().setAppointmentStatus(inShop.appointmentId, "in_shop");
    assert.equal(shop.getState().cancelAppointment(inShop.appointmentId, { reason: "customer-request" }).ok, true);
    assert.equal(shop.getState().appointments.find((row) => row.id === inShop.appointmentId)?.status, "cancelled");

    const arrived = book(shop.getState(), "Already here");
    shop.getState().setAppointmentStatus(arrived.appointmentId, "arrived");
    const asked = shop.getState().cancelAppointment(arrived.appointmentId, { reason: "customer-request" });
    assert.equal(asked.ok, false);
    assert.equal(asked.arrivedConfirm, "The customer is here — cancel anyway?");
    assert.equal(shop.getState().appointments.find((row) => row.id === arrived.appointmentId)?.status, "arrived");
    const confirmed = shop.getState().cancelAppointment(arrived.appointmentId, { reason: "customer-request" }, true);
    assert.equal(confirmed.ok, true, confirmed.error ?? "");
    assert.equal(shop.getState().appointments.find((row) => row.id === arrived.appointmentId)?.status, "cancelled");
  });

  it("requires a chosen reason and keeps the confirm control away from a small close button", () => {
    const html = renderToString(createElement(CancelForm, { onSubmit: () => null }));
    assert.match(html, /Choose a reason/);
    assert.equal(html.includes("customer-request\" selected"), false);
    assert.match(html, /card or SSN numbers/);
    assert.match(html, /maxLength="500"/);
    assert.match(html, /btn-danger/);
    assert.match(html, /min-h-11/);
    const controls = renderToString(createElement(DeskCancelActions, { actor: "advisor", status: "scheduled", surface: "card" }));
    assert.match(controls, /min-h-11/);
    assert.equal(controls.includes("btn-small"), false);
    const editBlocked = renderToString(createElement(DeskCancelActions, {
      actor: "advisor",
      status: "in_shop",
      surface: "edit",
      blockedReason: openRoCancelMessage(1042),
    }));
    assert.match(editBlocked, /data-desk-cancel="edit"/);
    assert.match(editBlocked, /role="alert"/);
    assert.match(editBlocked, /Close the RO first/);
    assert.match(editBlocked, /1042/);
    assert.match(editBlocked, /disabled=""/);
    const schedule = readFileSync(new URL("../routes/schedule.tsx", import.meta.url), "utf8");
    assert.match(schedule, /min-h-11[\s\S]{0,240}Show cancelled/);
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

function requestFor(appointmentId: string, id: string): OnlineRequest {
  return {
    id,
    storeId: "grand-coulee",
    status: "approved",
    createdAt: when,
    serviceId: "gc-oil",
    serviceName: "Oil",
    laborHours: 0.5,
    date: day,
    time: "09:00",
    advisorId: "megan",
    advisorName: "Megan Cho",
    techId: "marcus",
    techName: "Marcus Hale",
    transportId: "drop",
    transportName: "Drop-off",
    contactMethod: "call",
    verified: false,
    customerId: null,
    customerName: "Helen Cho",
    phone: "",
    email: "",
    vehicleId: null,
    year: 2020,
    make: "Ford",
    model: "F-150",
    vin: "",
    plate: "",
    appointmentId,
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
