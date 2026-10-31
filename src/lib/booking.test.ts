import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { AppointmentCalendar } from "../components/appointment-calendar.tsx";
import { advisorBookingNote, assessAppointment, overrideReason } from "./capacity.ts";
import { VEHICLE_MISSING, bookingFormBlock, deskSeedFor, deskSeedOnStore } from "./booking.ts";
import { appointmentsOnBoard } from "./cancel.ts";
import type { ShopStorage } from "./shop-storage.ts";
import { createShopStore } from "./store.ts";
import type { Appointment } from "./types.ts";

const day = "2027-01-06";

describe("booking after a store switch", () => {
  it("saves on the store you switched to and shows on that board, in demo mode", () => {
    const shop = createShopStore({ demoMode: true, storage: memoryStorage() });
    assert.equal(shop.getState().dataset, "sample");
    const couleeSeed = deskSeedFor(shop.getState());
    const couleeBefore = shop.getState().appointments.length;

    shop.getState().switchStore("pullman");
    const pullman = shop.getState();
    const next = deskSeedOnStore(couleeSeed, pullman);
    assert.equal(next.storeId, "pullman");
    assert.notEqual(next.customerId, couleeSeed.customerId);
    assert.equal(next.customerId, pullman.customers[0]?.id);
    assert.equal(next.advisorId, pullman.advisors[0]?.id);
    assert.equal(next.techId, pullman.techs[0]?.id);
    assert.equal(next.vehicleId, pullman.vehicles.find((row) => row.customerId === next.customerId)?.id);
    assert.equal(next.serviceId, pullman.settings.scheduling.onlineMenu[0]?.id);
    assert.equal(deskSeedOnStore(next, pullman), next);

    const pullmanBefore = pullman.appointments.length;
    const saved = pullman.saveAdvisorAppointment(draft(next, { concern: "Switch store brake inspection" }));
    assert.equal(saved.ok, true, saved.error ?? "");
    assert.equal(saved.error, null);
    const row = shop.getState().appointments.find((item) => item.id === saved.appointmentId);
    assert.ok(row);
    assert.equal(row.customerId, next.customerId);
    assert.equal(row.vehicleId, next.vehicleId);
    assert.equal(row.advisorId, next.advisorId);
    assert.equal(row.techId, next.techId);
    assert.equal(shop.getState().appointments.length, pullmanBefore + 1);
    assert.equal(shop.getState().stores["grand-coulee"].appointments.length, couleeBefore);
    assert.equal(shop.getState().stores.pullman.appointments.some((item) => item.id === saved.appointmentId), true);

    const tech = shop.getState().techs.find((item) => item.id === row.techId);
    assert.ok(tech);
    const name = shop.getState().customers.find((item) => item.id === row.customerId)?.name ?? "";
    assert.equal(name, "Marisol Vega");
    const board = renderToString(createElement(AppointmentCalendar, {
      appointments: appointmentsOnBoard(shop.getState().appointments),
      day,
      techs: [{ id: tech.id, number: tech.number, name: tech.name, board: tech.board }],
      selectedId: null,
      onSelect: () => undefined,
      onSlot: () => undefined,
      onMove: () => undefined,
      onWrite: () => undefined,
      onEdit: () => undefined,
      label: () => name,
      hoursFor: () => 1,
      summary: () => summary(name),
    }));
    assert.match(board, /Marisol Vega/);
    assert.match(board, /Switch store brake inspection/);

    shop.getState().switchStore("grand-coulee");
    assert.equal(shop.getState().appointments.some((item) => item.concern.includes("Switch store brake inspection")), false);
    const couleeBoard = renderToString(createElement(AppointmentCalendar, {
      appointments: appointmentsOnBoard(shop.getState().appointments.filter((item) => item.date === day)),
      day,
      techs: shop.getState().techs.filter((item) => item.board !== "none").map((item) => ({ id: item.id, number: item.number, name: item.name, board: item.board })),
      selectedId: null,
      onSelect: () => undefined,
      onSlot: () => undefined,
      onMove: () => undefined,
      onWrite: () => undefined,
      onEdit: () => undefined,
      label: (item) => item.concern,
      hoursFor: () => 1,
      summary: () => summary("Helen Cho"),
    }));
    assert.equal(couleeBoard.includes("Switch store brake inspection"), false);
    assert.equal(couleeBoard.includes("Marisol Vega"), false);
  });

  it("refuses a technician or advisor who is not on the active store", () => {
    const shop = createShopStore({ demoMode: true, storage: memoryStorage() });
    const couleeAdvisor = shop.getState().advisors[0].id;
    const couleeTech = shop.getState().techs[0].id;
    shop.getState().switchStore("pullman");
    const pullman = shop.getState();
    const seed = deskSeedFor(pullman);
    const before = pullman.appointments.length;
    const couleeBefore = pullman.stores["grand-coulee"].appointments.length;
    const overrides = pullman.overrides.length;

    const both = pullman.saveAdvisorAppointment(draft(seed, { advisorId: couleeAdvisor, techId: couleeTech, concern: "Ghost both" }));
    assert.equal(both.ok, false);
    assert.match(both.error ?? "", /aren't on this store/);
    assert.equal(both.overrideId, null);

    const techOnly = pullman.saveAdvisorAppointment(draft(seed, { techId: couleeTech, concern: "Ghost tech" }));
    assert.equal(techOnly.ok, false);
    assert.match(techOnly.error ?? "", /technician isn't on this store/);

    const advisorOnly = pullman.saveAdvisorAppointment(draft(seed, { advisorId: couleeAdvisor, concern: "Ghost advisor" }));
    assert.equal(advisorOnly.ok, false);
    assert.match(advisorOnly.error ?? "", /advisor isn't on this store/);

    const staleCustomer = pullman.saveAdvisorAppointment(draft(seed, { customerId: "c1", vehicleId: "v1", concern: "Ghost customer" }));
    assert.equal(staleCustomer.ok, false);
    assert.match(staleCustomer.error ?? "", /isn't on this store/);

    assert.equal(shop.getState().appointments.length, before);
    assert.equal(shop.getState().stores["grand-coulee"].appointments.length, couleeBefore);
    assert.equal(shop.getState().overrides.length, overrides);
    assert.equal(shop.getState().appointments.some((row) => row.concern.includes("Ghost")), false);

    const judged = assessAppointment({
      scheduling: pullman.settings.scheduling,
      advisors: pullman.advisors,
      techs: pullman.techs,
      appointments: pullman.appointments,
      laborOps: pullman.laborOps,
      proposal: { date: day, time: "09:00", minutes: 60, advisorId: couleeAdvisor, techId: couleeTech, laborOpIds: [] },
    });
    assert.equal(judged.open, false);
    assert.equal(judged.warning, null);
    assert.match(judged.blocked ?? "", /aren't on this store/);
    assert.equal(advisorBookingNote(judged)?.includes("You can still book it"), false);
    assert.equal(overrideReason(judged), null);
  });

  it("says why Book it cannot save when the vehicle or the concern is missing", () => {
    const shop = createShopStore({ demoMode: true, storage: memoryStorage() });
    const seed = deskSeedFor(shop.getState());
    const before = shop.getState().appointments.length;
    assert.equal(bookingFormBlock({ vehicleId: "", lines: [{ concern: "Oil" }] }), VEHICLE_MISSING);
    assert.equal(bookingFormBlock({ vehicleId: seed.vehicleId, lines: [{ concern: "  " }] }), "Add a concern before booking.");

    const missingVehicle = shop.getState().saveAdvisorAppointment(draft(seed, { vehicleId: "", concern: "Oil change" }));
    assert.equal(missingVehicle.ok, false);
    assert.equal(missingVehicle.error, VEHICLE_MISSING);
    const missingConcern = shop.getState().saveAdvisorAppointment(draft(seed, { concern: "   ", lines: [{ id: "a", code: "A", concern: " " }] }));
    assert.equal(missingConcern.ok, false);
    assert.equal(missingConcern.error, "Add a concern before booking.");
    assert.equal(shop.getState().appointments.length, before);
  });
});

function draft(
  seed: { customerId: string; vehicleId: string; advisorId: string; techId: string },
  patch: Partial<Omit<Appointment, "id" | "orderId">> & { concern: string },
): Omit<Appointment, "id" | "orderId"> {
  const { lines, concern, ...rest } = patch;
  return {
    date: day,
    time: "09:00",
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
    lines: lines ?? [{ id: "a", code: "A", concern: concern.trim() || "Visit" }],
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
    concern: "Switch store brake inspection",
    vin: "VIN",
    ops: "None",
    status: "Scheduled",
    canWrite: true,
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
