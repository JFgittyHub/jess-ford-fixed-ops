import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { ShopStorage } from "./shop-storage.ts";
import { createShopStore } from "./store.ts";
import type { Appointment } from "./types.ts";

/**
 * Two bookings on the same tech and time both save.
 * Capacity warns and hides an overloaded time online; it does not block this save.
 */
describe("appointment actions", () => {
  it("books, moves, updates, and links an appointment", () => {
    const shop = createShopStore({ demoMode: true, storage: memoryStorage() });
    const before = shop.getState().appointments.map((row) => row.id);
    const customer = shop.getState().customers[0];
    const vehicle = shop.getState().vehicles.find((row) => row.customerId === customer.id);
    assert.ok(vehicle);

    shop.getState().addAppointment(draft(customer.id, vehicle.id, shop.getState().advisors[0].id, "marcus", "09:00"));
    shop.getState().addAppointment(draft(customer.id, vehicle.id, shop.getState().advisors[1].id, "marcus", "09:00"));
    const added = shop.getState().appointments.filter((row) => !before.includes(row.id));
    assert.equal(added.length, 2);
    assert.equal(added.every((row) => row.status === "scheduled" && row.orderId === null), true);
    assert.equal(added.every((row) => row.techId === "marcus" && row.time === "09:00"), true);
    assert.equal(added[0].concern.includes("Oil change"), true);

    const target = added[0];
    shop.getState().moveAppointment(target.id, { time: "11:30", minutes: 90, techId: "elena" });
    const moved = shop.getState().appointments.find((row) => row.id === target.id);
    assert.equal(moved?.time, "11:30");
    assert.equal(moved?.minutes, 90);
    assert.equal(moved?.techId, "elena");

    shop.getState().updateAppointment(target.id, {
      lines: [{ id: "line-a", code: "A", concern: "Rotate the tires" }],
      advisorId: shop.getState().advisors[2].id,
    });
    const edited = shop.getState().appointments.find((row) => row.id === target.id);
    assert.equal(edited?.id, target.id);
    assert.equal(edited?.orderId, null);
    assert.equal(edited?.advisorId, shop.getState().advisors[2].id);
    assert.equal(edited?.lines[0]?.concern, "Rotate the tires");
    assert.equal(edited?.concern.includes("Rotate the tires"), true);

    shop.getState().setAppointmentStatus(target.id, "arrived");
    assert.equal(shop.getState().appointments.find((row) => row.id === target.id)?.status, "arrived");

    shop.getState().linkAppointment(target.id, "open-helen");
    assert.equal(shop.getState().appointments.find((row) => row.id === target.id)?.orderId, null);
    shop.getState().linkAppointment(target.id, "open-ruth");
    const linked = shop.getState().appointments.find((row) => row.id === target.id);
    assert.equal(linked?.status, "in_shop");
    assert.equal(linked?.orderId, "open-ruth");
  });

  it("keeps a VIN edit on the appointment and leaves the vehicle record alone", () => {
    const shop = createShopStore({ demoMode: true, storage: memoryStorage() });
    const row = shop.getState().appointments.find((item) => item.id === "a6");
    assert.ok(row);
    const vehicle = shop.getState().vehicles.find((item) => item.id === row.vehicleId);
    assert.ok(vehicle);
    const original = vehicle.vin;
    const typed = "1FTEW1EP5NKD12345";
    assert.notEqual(typed, original);

    shop.getState().updateAppointment(row.id, { vin: `  ${typed.toLowerCase()}  ` });
    const next = shop.getState();
    assert.equal(next.appointments.find((item) => item.id === row.id)?.vin, typed);
    assert.equal(next.vehicles.find((item) => item.id === row.vehicleId)?.vin, original);
    assert.equal(next.vehicles.find((item) => item.id === row.vehicleId)?.model, vehicle.model);
  });

  it("refuses to remove a tech who still has appointments until those are reassigned", () => {
    const shop = createShopStore({ demoMode: true, storage: memoryStorage() });
    assert.equal(
      shop.getState().addTech({
        number: "99",
        name: "Temp Tech",
        skill: "b",
        payStyle: "flat",
        flagRate: 20,
        hourlyRate: 20,
        board: "main",
      }),
      true,
    );
    const tech = shop.getState().techs.find((row) => row.number === "99");
    assert.ok(tech);
    const customer = shop.getState().customers[0];
    const vehicle = shop.getState().vehicles.find((row) => row.customerId === customer.id);
    assert.ok(vehicle);
    shop.getState().addAppointment(draft(customer.id, vehicle.id, shop.getState().advisors[0].id, tech.id, "10:00"));

    assert.equal(shop.getState().removeTech(tech.id), "appointments");
    assert.equal(shop.getState().techs.some((row) => row.id === tech.id), true);
    const booked = shop.getState().appointments.find((row) => row.techId === tech.id);
    assert.ok(booked);

    shop.getState().moveAppointment(booked.id, { techId: "marcus" });
    assert.equal(shop.getState().appointments.some((row) => row.techId === tech.id), false);
    assert.equal(shop.getState().removeTech(tech.id), "ok");
    assert.equal(shop.getState().techs.some((row) => row.id === tech.id), false);
    assert.equal(shop.getState().appointments.some((row) => row.id === booked.id), true);
  });

  it("still blocks removal when the tech is on a repair order", () => {
    const shop = createShopStore({ demoMode: true, storage: memoryStorage() });
    const techId = "chris";
    assert.equal(shop.getState().appointments.some((row) => row.techId === techId), true);
    assert.equal(shop.getState().removeTech(techId), "used");
    assert.equal(shop.getState().techs.some((row) => row.id === techId), true);
  });
});

function draft(customerId: string, vehicleId: string, advisorId: string, techId: string, time: string): Omit<Appointment, "id" | "orderId" | "status"> {
  return {
    date: "2026-10-21",
    time,
    minutes: 60,
    customerId,
    vehicleId,
    advisorId,
    concern: "Oil change",
    lines: [{ id: "", code: "A", concern: "Oil change" }],
    vin: "1FTDEMO00000001AA",
    laborOpIds: [],
    techId,
    lane: "drop",
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
