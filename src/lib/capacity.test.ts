import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  advisorBookingNote,
  appointmentLoads,
  assessAppointment,
  evaluateCapacity,
  onlineSlots,
  type CapacityLoad,
} from "./capacity.ts";
import { defaultScheduling } from "./scheduling.ts";
import type { ShopStorage } from "./shop-storage.ts";
import { createShopStore } from "./store.ts";
import type { Appointment, SchedulingSettings } from "./types.ts";

const coulee = defaultScheduling("grand-coulee");
const pullman = defaultScheduling("pullman");
const staff = {
  advisors: [{ id: "megan" }, { id: "jordan" }],
  techs: [
    { id: "marcus", board: "main" },
    { id: "elena", board: "main" },
    { id: "dana", board: "none" },
  ],
};
const tuesday = "2026-10-20";
const saturday = "2026-10-24";

describe("capacity engine", () => {
  it("is open when technician hours and advisor capacity both allow the job", () => {
    const result = propose(coulee, [], { date: tuesday, laborHours: 1 });
    assert.equal(result.open, true);
    assert.equal(result.warning, null);
    assert.equal(result.tech.capacity, 10);
    assert.equal(result.tech.overloaded, false);
    assert.equal(result.advisor.capacity, 10);
    assert.equal(result.advisor.overloaded, false);
    assert.equal(advisorBookingNote(result), null);

    const slots = openings(coulee, [], { serviceId: "gc-oil", from: tuesday, through: tuesday });
    assert.equal(slots.some((slot) => slot.time === "09:00" && slot.techId === "marcus" && slot.advisorId === "megan" && slot.laborHours === 0.5), true);
  });

  it("hides a slot online when technician hours are full and warns the advisor", () => {
    const loads = [load("booked", { techId: "marcus", laborHours: 9.6 })];
    const result = propose(coulee, loads, { date: tuesday, techId: "marcus", laborHours: 0.5 });
    assert.equal(result.open, false);
    assert.equal(result.tech.overloaded, true);
    assert.equal(result.advisor.overloaded, false);
    assert.match(result.warning ?? "", /technician hours/);
    assert.match(advisorBookingNote(result) ?? "", /You can still book it/);
    assert.match(advisorBookingNote(result) ?? "", /Online customers will not see this time/);

    const hidden = openings(coulee, loads, { serviceId: "gc-oil", from: tuesday, through: tuesday, techId: "marcus" });
    const openTech = openings(coulee, loads, { serviceId: "gc-oil", from: tuesday, through: tuesday, techId: "elena" });
    assert.equal(hidden.length, 0);
    assert.equal(openTech.length > 0, true);
  });

  it("hides a slot online when the advisor is full and warns without blocking the save", () => {
    const loads = Array.from({ length: 10 }, (_, index) => load(`a-${index}`, { advisorId: "megan", techId: index % 2 === 0 ? "marcus" : "elena", laborHours: 0.2 }));
    const result = propose(coulee, loads, { date: tuesday, advisorId: "megan", techId: "marcus", laborHours: 0.5 });
    assert.equal(result.open, false);
    assert.equal(result.advisor.overloaded, true);
    assert.equal(result.tech.overloaded, false);
    assert.match(result.warning ?? "", /advisor capacity/);
    assert.equal(propose(coulee, loads, { date: tuesday, advisorId: "jordan", laborHours: 0.5 }).open, true);

    const hidden = openings(coulee, loads, { serviceId: "gc-oil", from: tuesday, through: tuesday, advisorId: "megan" });
    const other = openings(coulee, loads, { serviceId: "gc-oil", from: tuesday, through: tuesday, advisorId: "jordan" });
    assert.equal(hidden.length, 0);
    assert.equal(other.length > 0, true);

    const shop = createShopStore({ demoMode: true, storage: memoryStorage() });
    const before = shop.getState().appointments.length;
    shop.getState().addAppointment(draft("10:00", 600));
    shop.getState().addAppointment(draft("10:00", 60));
    assert.equal(shop.getState().appointments.length, before + 2);
    const saved = assessAppointment({
      scheduling: shop.getState().settings.scheduling,
      advisors: shop.getState().advisors,
      techs: shop.getState().techs,
      appointments: shop.getState().appointments,
      laborOps: shop.getState().laborOps,
      proposal: { date: tuesday, time: "10:30", advisorId: "megan", techId: "marcus", laborOpIds: [], minutes: 60 },
    });
    assert.equal(saved.open, false);
    assert.match(saved.warning ?? "", /technician hours/);
  });

  it("warns when both the technician and the advisor would be overloaded", () => {
    const loads = [
      load("tech", { techId: "marcus", advisorId: "jordan", laborHours: 10 }),
      ...Array.from({ length: 10 }, (_, index) => load(`adv-${index}`, { advisorId: "megan", techId: "elena", laborHours: 0.2 })),
    ];
    const result = propose(coulee, loads, { date: tuesday, advisorId: "megan", techId: "marcus", laborHours: 0.5 });
    assert.equal(result.open, false);
    assert.match(result.warning ?? "", /technician hours and advisor capacity/);
  });

  it("lets the same technician take two small jobs at one time, and stops a job that does not fit", () => {
    const first = propose(coulee, [], { date: tuesday, time: "09:00", laborHours: 1 });
    const second = propose(coulee, [load("first", { time: "09:00", laborHours: 1 })], { date: tuesday, time: "09:00", laborHours: 1 });
    assert.equal(first.open, true);
    assert.equal(second.open, true);
    const overflow = propose(coulee, [load("first", { time: "09:00", laborHours: 9.5 })], { date: tuesday, time: "09:00", laborHours: 1 });
    assert.equal(overflow.open, false);
    assert.equal(overflow.tech.overloaded, true);
  });

  it("keeps each store's hours, closures, and book apart", () => {
    const heavy = propose(coulee, [], { date: saturday, laborHours: 6 });
    const wider = propose(pullman, [], { date: saturday, laborHours: 6 });
    assert.equal(heavy.open, false);
    assert.equal(heavy.tech.capacity, 5);
    assert.equal(wider.open, true);
    assert.equal(wider.tech.capacity, 8);

    const couleeLoad = [load("coulee-only", { laborHours: 10 })];
    assert.equal(propose(coulee, couleeLoad, { laborHours: 0.5 }).open, false);
    assert.equal(propose(pullman, [], { laborHours: 0.5 }).open, true);

    const stranger = propose(coulee, [], { techId: "holly", laborHours: 0.5 });
    assert.equal(stranger.open, false);
    assert.match(stranger.warning ?? "", /isn't on this store/);

    const couleeMenu = menu(coulee, "gc-oil", 6);
    const pullmanMenu = menu(pullman, "pl-oil", 6);
    const now = new Date("2026-10-24T15:00:00Z");
    assert.equal(openings(couleeMenu, [], { serviceId: "gc-oil", from: saturday, through: saturday, now }).length, 0);
    assert.equal(openings(pullmanMenu, [], { serviceId: "pl-oil", from: saturday, through: saturday, now }).length > 0, true);

    const holiday = "2026-11-26";
    assert.equal(openings(coulee, [], { serviceId: "gc-oil", from: holiday, through: holiday, now: new Date("2026-11-26T16:00:00Z") }).length, 0);
    assert.equal(openings(pullman, [], { serviceId: "pl-oil", from: holiday, through: holiday, now: new Date("2026-11-26T16:00:00Z") }).length > 0, true);
    assert.match(propose(coulee, [], { date: "2026-10-25", laborHours: 1 }).warning ?? "", /closed/);
  });

  it("counts pending holds and live appointments, and ignores no-shows and declined holds", () => {
    const pending = [{ id: "req-1", date: tuesday, time: "09:00", advisorId: "jordan", techId: "marcus", laborHours: 10, status: "pending" }];
    const declined = [{ id: "req-2", date: tuesday, time: "09:00", advisorId: "jordan", techId: "marcus", laborHours: 10, status: "declined" }];
    const held = evaluateCapacity({
      scheduling: coulee,
      ...staff,
      loads: [],
      proposal: { date: tuesday, time: "11:00", advisorId: "megan", techId: "marcus", laborHours: 0.5 },
    });
    assert.equal(held.open, true);
    const withHold = openings(coulee, [], { serviceId: "gc-oil", from: tuesday, through: tuesday, techId: "marcus", holds: pending });
    const withDecline = openings(coulee, [], { serviceId: "gc-oil", from: tuesday, through: tuesday, techId: "marcus", holds: declined });
    assert.equal(withHold.length, 0);
    assert.equal(withDecline.length > 0, true);

    const noShow: Appointment = {
      id: "gone",
      date: tuesday,
      time: "09:00",
      minutes: 600,
      customerId: "c1",
      vehicleId: "v1",
      advisorId: "megan",
      concern: "Oil",
      lines: [],
      vin: "",
      laborOpIds: [],
      techId: "marcus",
      lane: "drop",
      status: "no_show",
      orderId: null,
    };
    const kept = { ...noShow, id: "kept", status: "scheduled" as const, laborOpIds: ["op-lof"], minutes: 30 };
    const ops = [{ id: "op-lof", hours: 0.5 }];
    const afterNoShow = assessAppointment({
      scheduling: coulee,
      ...staff,
      appointments: [noShow],
      laborOps: ops,
      proposal: { date: tuesday, time: "11:00", advisorId: "megan", techId: "marcus", laborOpIds: ["op-lof"], minutes: 600 },
    });
    const afterLive = assessAppointment({
      scheduling: coulee,
      ...staff,
      appointments: [kept, { ...kept, id: "fill", laborOpIds: [], minutes: 600 }],
      laborOps: ops,
      proposal: { date: tuesday, time: "12:00", advisorId: "jordan", techId: "marcus", laborOpIds: ["op-lof"], minutes: 30 },
    });
    assert.equal(afterNoShow.open, true);
    assert.equal(afterNoShow.tech.adding, 0.5);
    assert.equal(afterLive.open, false);
    const edited = assessAppointment({
      scheduling: coulee,
      ...staff,
      appointments: [{ ...kept, id: "fill", laborOpIds: [], minutes: 600 }],
      laborOps: ops,
      proposal: { date: tuesday, time: "09:00", advisorId: "megan", techId: "marcus", laborOpIds: [], minutes: 600, ignoreId: "fill" },
    });
    assert.equal(edited.open, true);
    assert.equal(appointmentLoads([noShow], ops)[0]?.counts, false);
  });

  it("leaves times outside the booking window and the lead time off the online list", () => {
    const narrow: SchedulingSettings = {
      ...coulee,
      bookingWindow: { daysAhead: 1, minLeadHours: 2 },
    };
    const now = new Date("2026-10-20T15:00:00Z");
    const slots = openings(narrow, [], { serviceId: "gc-oil", now });
    assert.equal(slots.some((slot) => slot.date === "2026-10-20" && slot.time === "09:30"), false);
    assert.equal(slots.some((slot) => slot.date === "2026-10-20" && slot.time === "10:00"), true);
    assert.equal(slots.some((slot) => slot.date === "2026-10-21"), true);
    assert.equal(slots.some((slot) => slot.date === "2026-10-22"), false);
    assert.equal(slots.some((slot) => slot.techId === "dana"), false);
    assert.equal(openings(coulee, [], { serviceId: "missing", from: tuesday, through: tuesday }).length, 0);
  });
});

function propose(
  scheduling: SchedulingSettings,
  loads: CapacityLoad[],
  patch: Partial<CapacityLoad & { ignoreId?: string }> = {},
) {
  return evaluateCapacity({
    scheduling,
    ...staff,
    loads,
    proposal: {
      date: patch.date ?? tuesday,
      time: patch.time ?? "09:00",
      advisorId: patch.advisorId ?? "megan",
      techId: patch.techId ?? "marcus",
      laborHours: patch.laborHours ?? 1,
      ignoreId: patch.ignoreId,
    },
  });
}

function openings(
  scheduling: SchedulingSettings,
  loads: CapacityLoad[],
  patch: {
    serviceId: string;
    from?: string;
    through?: string;
    now?: Date;
    advisorId?: string;
    techId?: string;
    holds?: { id: string; date: string; time: string; advisorId: string; techId: string; laborHours: number; status?: string }[];
  },
) {
  return onlineSlots({
    scheduling,
    ...staff,
    loads,
    serviceId: patch.serviceId,
    from: patch.from,
    through: patch.through,
    now: patch.now ?? new Date("2026-10-20T14:00:00Z"),
    advisorId: patch.advisorId,
    techId: patch.techId,
    holds: patch.holds,
  });
}

function load(id: string, patch: Partial<CapacityLoad> = {}): CapacityLoad {
  return {
    id,
    date: patch.date ?? tuesday,
    time: patch.time ?? "09:00",
    advisorId: patch.advisorId ?? "jordan",
    techId: patch.techId ?? "marcus",
    laborHours: patch.laborHours ?? 1,
    counts: patch.counts ?? true,
  };
}

function menu(scheduling: SchedulingSettings, id: string, laborHours: number): SchedulingSettings {
  return {
    ...scheduling,
    onlineMenu: scheduling.onlineMenu.map((row) => (row.id === id ? { ...row, laborHours } : row)),
  };
}

function draft(time: string, minutes: number) {
  return {
    date: tuesday,
    time,
    minutes,
    customerId: "c1",
    vehicleId: "v1",
    advisorId: "megan",
    concern: "Long job",
    lines: [{ id: "", code: "A", concern: "Long job" }],
    vin: "",
    laborOpIds: [] as string[],
    techId: "marcus",
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
