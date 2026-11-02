import assert from "node:assert/strict";
import { after, describe, it } from "node:test";
import { assessAppointment, dayCapacity, holdLoads, onlineSlots } from "./capacity.ts";
import { pinClock, resetClock } from "./clock.ts";
import { requestHolds } from "./online-request.ts";
import type { ShopStorage } from "./shop-storage.ts";
import { createShopStore } from "./store.ts";
import type { Appointment, OnlineRequest, SchedulingSettings, WeekdayIndex } from "./types.ts";

const tuesday = "2026-10-20";
const weekday = 2 as WeekdayIndex;
const when = "2026-10-20T15:00:00.000Z";
const morning = new Date("2026-10-20T14:00:00.000Z");

describe("capacity settings", () => {
  after(() => resetClock());

  it("starts from today's rule: open-day technician hours, one advisor appointment per open hour, no extra caps, full online share", () => {
    const state = shop().getState();
    const open = assessAppointment({
      scheduling: state.settings.scheduling,
      advisors: state.advisors,
      techs: state.techs,
      appointments: [],
      laborOps: [],
      proposal: {
        date: tuesday,
        time: "09:00",
        advisorId: "megan",
        techId: "marcus",
        laborOpIds: [],
        minutes: 60,
      },
    });
    assert.equal(open.open, true);
    assert.equal(open.tech.capacity, 10);
    assert.equal(open.advisor.capacity, 10);
    assert.equal(open.advisorHour.capacity, null);
    assert.equal(open.waiter.capacity, null);
    assert.equal(open.arrivals.capacity, null);
    const view = board(state.settings.scheduling, state.advisors, []);
    assert.equal(view.onlineSharePercent, 100);
    assert.equal(view.techs.find((row) => row.id === "marcus")?.availableHours, 10);
    assert.equal(view.advisorDayCap, 10);
    assert.equal(view.advisorHourCap, null);
    assert.equal(
      slots(state.settings.scheduling, []).some(
        (row) => row.time === "09:00" && row.techId === "marcus",
      ),
      true,
    );
  });

  it("uses each technician's weekday hours in the booking check, the day view, and online times", () => {
    const store = shop();
    assert.equal(store.getState().updateTechCapacityHours("marcus", weekday, 2).ok, true);
    const scheduling = store.getState().settings.scheduling;
    const tight = propose(scheduling, [], { minutes: 180 });
    assert.equal(tight.open, false);
    assert.match(tight.warning ?? "", /technician hours/);
    assert.equal(propose(scheduling, [], { minutes: 60, techId: "elena" }).open, true);
    const view = board(scheduling, store.getState().advisors, []);
    assert.equal(view.techs.find((row) => row.id === "marcus")?.availableHours, 2);
    assert.equal(view.techs.find((row) => row.id === "elena")?.availableHours, 10);
    assert.equal(view.availableHours, 12);
    assert.equal(
      slots(scheduling, []).some((row) => row.techId === "marcus"),
      true,
    );
    assert.equal(
      slots(scheduling, [load("full", { laborHours: 2 })]).some((row) => row.techId === "marcus"),
      false,
    );
    assert.equal(
      slots(scheduling, [load("full", { laborHours: 2 })]).some((row) => row.techId === "elena"),
      true,
    );
  });

  it("counts a whole day off, a part-day block, and a pending request against booking, the day view, and online times", () => {
    const store = shop();
    assert.equal(store.getState().addTechTimeOff({ techId: "marcus", date: tuesday }).ok, true);
    let scheduling = store.getState().settings.scheduling;
    const off = propose(scheduling, [], { minutes: 30 });
    assert.equal(off.open, false);
    assert.equal(off.off, "day");
    assert.match(off.warning ?? "", /off that day/);
    assert.equal(
      board(scheduling, store.getState().advisors, []).techs.find((row) => row.id === "marcus")
        ?.availableHours,
      0,
    );
    assert.equal(
      slots(scheduling, []).some((row) => row.techId === "marcus"),
      false,
    );
    assert.equal(
      slots(scheduling, []).some((row) => row.techId === "elena"),
      true,
    );

    const blockId = store.getState().settings.scheduling.capacity.timeOff[0]?.id ?? "";
    assert.equal(store.getState().removeTechTimeOff(blockId).ok, true);
    assert.equal(
      store
        .getState()
        .addTechTimeOff({ techId: "marcus", date: tuesday, start: "12:00", end: "15:00" }).ok,
      true,
    );
    scheduling = store.getState().settings.scheduling;
    const during = propose(scheduling, [], { time: "12:30", minutes: 30 });
    const before = propose(scheduling, [], { time: "09:00", minutes: 30 });
    const through = propose(scheduling, [], { time: "11:30", minutes: 60 });
    assert.equal(during.open, false);
    assert.equal(during.off, "part");
    assert.match(during.warning ?? "", /off then/);
    assert.equal(before.open, true);
    assert.equal(through.open, false);
    const partial = board(scheduling, store.getState().advisors, []);
    assert.equal(partial.techs.find((row) => row.id === "marcus")?.availableHours, 7);
    assert.equal(partial.techs.find((row) => row.id === "marcus")?.off, "part");
    const openTimes = slots(scheduling, []);
    assert.equal(
      openTimes.some((row) => row.techId === "marcus" && row.time === "09:00"),
      true,
    );
    assert.equal(
      openTimes.some((row) => row.techId === "marcus" && row.time === "12:00"),
      false,
    );
    assert.equal(
      openTimes.some((row) => row.techId === "marcus" && row.time === "15:00"),
      true,
    );

    const pending = hold("req-1", { laborHours: 7 });
    const held = propose(scheduling, [pending], { time: "09:00", minutes: 30 });
    assert.equal(held.open, false);
    assert.match(held.warning ?? "", /technician hours/);
    const heldView = board(scheduling, store.getState().advisors, [pending]);
    assert.equal(heldView.techs.find((row) => row.id === "marcus")?.usedHours, 7);
    assert.equal(heldView.usedHours, 7);
    assert.equal(
      slots(scheduling, [], [pending]).some((row) => row.techId === "marcus"),
      false,
    );
    assert.equal(
      slots(scheduling, [], [pending]).some((row) => row.techId === "elena"),
      true,
    );
  });

  it("caps advisor appointments per hour without dropping the daily total", () => {
    const store = shop();
    assert.equal(
      store.getState().updateCapacityLimits({ maxAdvisorAppointmentsPerHour: 1 }).ok,
      true,
    );
    const scheduling = store.getState().settings.scheduling;
    const first = load("one", { advisorId: "megan", time: "09:00" });
    const sameHour = propose(scheduling, [first], { time: "09:30", advisorId: "megan" });
    const nextHour = propose(scheduling, [first], { time: "10:00", advisorId: "megan" });
    assert.equal(sameHour.open, false);
    assert.equal(sameHour.advisorHour.overloaded, true);
    assert.match(sameHour.warning ?? "", /advisor capacity/);
    assert.equal(nextHour.open, true);
    assert.equal(sameHour.advisor.capacity, 10);
    const view = board(scheduling, store.getState().advisors, [first]);
    assert.equal(view.advisorHourCap, 1);
    const nine = view.hours.find((row) => row.time === "09:00");
    assert.equal(nine?.advisors.find((row) => row.id === "megan")?.used, 1);
    assert.equal(view.advisors.find((row) => row.id === "megan")?.dayUsed, 1);
    const hidden = slots(scheduling, [first], undefined, { advisorId: "megan", techId: "marcus" });
    assert.equal(
      hidden.some((row) => row.time === "09:00"),
      false,
    );
    assert.equal(
      hidden.some((row) => row.time === "09:30"),
      false,
    );
    assert.equal(
      hidden.some((row) => row.time === "10:00"),
      true,
    );
  });

  it("caps waiter appointments per slot and still allows a drop-off in that slot", () => {
    const store = shop();
    assert.equal(store.getState().updateCapacityLimits({ maxWaiterPerSlot: 1 }).ok, true);
    const scheduling = store.getState().settings.scheduling;
    const waiting = load("wait", { lane: "waiter", time: "09:00", advisorId: "jordan" });
    const another = propose(scheduling, [waiting], {
      time: "09:00",
      lane: "waiter",
      advisorId: "megan",
    });
    const drop = propose(scheduling, [waiting], {
      time: "09:00",
      lane: "drop",
      advisorId: "megan",
    });
    assert.equal(another.open, false);
    assert.equal(another.waiter.overloaded, true);
    assert.match(another.warning ?? "", /waiter/);
    assert.equal(drop.open, true);
    const view = board(scheduling, store.getState().advisors, [waiting]);
    assert.equal(view.waiterCap, 1);
    assert.equal(view.slots.find((row) => row.time === "09:00")?.waiters, 1);
    const waiterTimes = slots(scheduling, [waiting], undefined, {
      transportId: "waiter",
      advisorId: "megan",
      techId: "elena",
    });
    const dropTimes = slots(scheduling, [waiting], undefined, {
      transportId: "drop",
      advisorId: "megan",
      techId: "elena",
    });
    assert.equal(
      waiterTimes.some((row) => row.time === "09:00"),
      false,
    );
    assert.equal(
      dropTimes.some((row) => row.time === "09:00"),
      true,
    );
  });

  it("caps total arrivals per slot in the booking check, the day view, and online times", () => {
    const store = shop();
    assert.equal(store.getState().updateCapacityLimits({ maxArrivalsPerSlot: 1 }).ok, true);
    const scheduling = store.getState().settings.scheduling;
    const parked = load("parked", {
      time: "09:00",
      lane: "drop",
      advisorId: "jordan",
      techId: "elena",
    });
    const next = propose(scheduling, [parked], { time: "09:00", lane: "drop" });
    const later = propose(scheduling, [parked], { time: "09:30", lane: "drop" });
    assert.equal(next.open, false);
    assert.equal(next.arrivals.overloaded, true);
    assert.match(next.warning ?? "", /arrivals/);
    assert.equal(later.open, true);
    const view = board(scheduling, store.getState().advisors, [parked]);
    assert.equal(view.arrivalCap, 1);
    assert.equal(view.slots.find((row) => row.time === "09:00")?.arrivals, 1);
    assert.equal(view.slots.find((row) => row.time === "09:30")?.arrivals, 0);
    const hidden = slots(scheduling, [parked], undefined, { techId: "marcus" });
    assert.equal(
      hidden.some((row) => row.time === "09:00"),
      false,
    );
    assert.equal(
      hidden.some((row) => row.time === "09:30"),
      true,
    );
  });

  it("keeps online booking inside the share while the desk can still use the rest", () => {
    const store = shop();
    assert.equal(store.getState().updateCapacityLimits({ onlineSharePercent: 50 }).ok, true);
    const scheduling = store.getState().settings.scheduling;
    const desk = propose(scheduling, [], { minutes: 360 });
    assert.equal(desk.open, true);
    assert.equal(desk.warning, null);
    const used = load("half", { laborHours: 5 });
    assert.equal(propose(scheduling, [used], { minutes: 30 }).open, true);
    assert.equal(slots(scheduling, [used], undefined, { techId: "marcus" }).length, 0);
    assert.equal(
      slots(scheduling, [], undefined, { techId: "marcus" }).some((row) => row.time === "09:00"),
      true,
    );
    const view = board(scheduling, store.getState().advisors, [used]);
    assert.equal(view.onlineSharePercent, 50);
    assert.equal(view.techs.find((row) => row.id === "marcus")?.usedHours, 5);
    assert.equal(view.techs.find((row) => row.id === "marcus")?.availableHours, 10);
    const pending = hold("req-share", { laborHours: 5 });
    assert.equal(slots(scheduling, [], [pending], { techId: "marcus" }).length, 0);
  });

  it("refuses a capacity edit from an advisor, a technician, or nobody, and logs a service manager edit", () => {
    pinClock(when);
    const store = shop();
    const before = JSON.stringify(store.getState().settings.scheduling);
    const logBefore = store.getState().settingsLog?.length ?? 0;
    for (const who of ["megan", "marcus", ""]) {
      store.getState().setWorkingAs(who);
      const limits = store.getState().updateCapacityLimits({ onlineSharePercent: 40 });
      const hours = store.getState().updateTechCapacityHours("marcus", weekday, 4);
      const off = store.getState().addTechTimeOff({ techId: "marcus", date: tuesday });
      assert.equal(limits.ok, false, who || "nobody");
      assert.equal(hours.ok, false, who || "nobody");
      assert.equal(off.ok, false, who || "nobody");
      assert.match(
        `${limits.error} ${hours.error} ${off.error}`,
        /service manager|Choose who is working/,
      );
    }
    assert.equal(JSON.stringify(store.getState().settings.scheduling), before);
    assert.equal(store.getState().settingsLog?.length ?? 0, logBefore);

    store.getState().setWorkingAs("derek");
    const saved = store
      .getState()
      .updateCapacityLimits({ onlineSharePercent: 40, maxAdvisorAppointmentsPerHour: 2 });
    assert.equal(saved.ok, true);
    const rows = store.getState().settingsLog ?? [];
    const share = rows.find((row) => row.field === "Capacity online share");
    const hourly = rows.find((row) => row.field === "Capacity advisor per hour");
    assert.ok(share);
    assert.ok(hourly);
    assert.equal(share.who, "Derek Lang");
    assert.equal(share.whoId, "derek");
    assert.equal(share.at, when);
    assert.equal(share.before, "100%");
    assert.equal(share.after, "40%");
    assert.equal(hourly.before, "no limit");
    assert.equal(hourly.after, "2");
    assert.equal(store.getState().settings.scheduling.capacity.onlineSharePercent, 40);
    assert.equal(JSON.stringify(store.getState().settings.scheduling) === before, false);
  });

  it("counts a pending online request when an advisor saves, and does not count that request twice when it is approved", () => {
    const store = shop();
    store.setState({ appointments: [] });
    store.getState().setWorkingAs("derek");
    assert.equal(store.getState().updateTechCapacityHours("marcus", weekday, 1).ok, true);
    const pending = request();
    store.setState({ onlineRequests: [pending] });
    store.getState().setWorkingAs("megan");
    const saved = store.getState().saveAdvisorAppointment(draft(store.getState()));
    assert.equal(saved.ok, true, saved.error ?? "");
    assert.ok(saved.overrideId);
    assert.equal(
      store.getState().overrides.find((row) => row.id === saved.overrideId)?.reason,
      "tech-hours",
    );

    const open = assessAppointment({
      scheduling: store.getState().settings.scheduling,
      advisors: store.getState().advisors,
      techs: store.getState().techs,
      appointments: [],
      laborOps: [],
      holds: requestHolds([pending]).filter((row) => row.id !== pending.id),
      proposal: {
        date: tuesday,
        time: "09:00",
        advisorId: "megan",
        techId: "marcus",
        laborOpIds: [],
        minutes: 60,
        lane: "drop",
      },
    });
    assert.equal(open.open, true);
    const counted = holdLoads(requestHolds([pending]));
    const view = board(store.getState().settings.scheduling, store.getState().advisors, counted);
    assert.equal(view.techs.find((row) => row.id === "marcus")?.usedHours, 1);
  });

  it("keeps the exact cap open and the next unit closed, including a zero cap and a zero-hour day", () => {
    const store = shop();
    const scheduling = store.getState().settings.scheduling;
    const nine = Array.from({ length: 9 }, (_, index) => load(`full-${index}`, {
      advisorId: "megan",
      techId: index % 2 === 0 ? "marcus" : "elena",
      laborHours: 0.2,
      time: "09:00",
    }));
    assert.equal(propose(scheduling, nine, { advisorId: "megan", minutes: 30 }).open, true);
    assert.equal(propose(scheduling, [...nine, load("tenth", { advisorId: "megan", laborHours: 0.2 })], { advisorId: "megan", minutes: 30 }).open, false);

    assert.equal(store.getState().updateTechCapacityHours("marcus", weekday, 2).ok, true);
    assert.equal(store.getState().updateTechCapacityHours("elena", weekday, 0).ok, true);
    let next = store.getState().settings.scheduling;
    assert.equal(propose(next, [], { minutes: 120 }).open, true);
    assert.equal(propose(next, [], { minutes: 150 }).open, false);
    assert.equal(propose(next, [], { techId: "elena", minutes: 30 }).open, false);
    assert.equal(board(next, store.getState().advisors, []).techs.find((row) => row.id === "elena")?.availableHours, 0);

    assert.equal(store.getState().updateCapacityLimits({ maxWaiterPerSlot: 1, maxArrivalsPerSlot: 1 }).ok, true);
    next = store.getState().settings.scheduling;
    assert.equal(propose(next, [], { lane: "waiter", time: "11:00" }).open, true);
    assert.equal(propose(next, [], { lane: "drop", time: "11:30" }).open, true);
    assert.equal(store.getState().updateCapacityLimits({ maxWaiterPerSlot: 0, maxArrivalsPerSlot: 0 }).ok, true);
    next = store.getState().settings.scheduling;
    assert.equal(propose(next, [], { lane: "waiter", time: "11:00" }).open, false);
    assert.equal(propose(next, [], { lane: "drop", time: "11:30" }).open, false);

    const fresh = shop();
    assert.equal(fresh.getState().addTechTimeOff({ techId: "marcus", date: tuesday, start: "12:00", end: "15:00" }).ok, true);
    const blocked = fresh.getState().settings.scheduling;
    assert.equal(propose(blocked, [], { time: "11:30", minutes: 30 }).open, true);
    assert.equal(propose(blocked, [], { time: "15:00", minutes: 30 }).open, true);
    assert.equal(slots(blocked, [], undefined, { techId: "marcus" }).some((row) => row.time === "15:00"), true);
    assert.equal(slots(blocked, [], undefined, { techId: "marcus" }).some((row) => row.time === "11:30"), true);

    assert.equal(fresh.getState().updateCapacityLimits({ onlineSharePercent: 50 }).ok, true);
    let shared = fresh.getState().settings.scheduling;
    assert.equal(slots(shared, [load("edge", { laborHours: 4.5, techId: "elena" })], undefined, { techId: "elena" }).some((row) => row.time === "09:00"), true);
    assert.equal(slots(shared, [load("over", { laborHours: 5, techId: "elena" })], undefined, { techId: "elena" }).length, 0);

    assert.equal(fresh.getState().updateCapacityLimits({ maxAdvisorAppointmentsPerHour: 2 }).ok, true);
    shared = fresh.getState().settings.scheduling;
    const hourHold = load("hour", { advisorId: "megan", time: "09:00", techId: "elena", laborHours: 0.3 });
    assert.equal(propose(shared, [hourHold], { advisorId: "megan", time: "09:30", minutes: 30, techId: "elena" }).open, true);
    assert.equal(slots(shared, [hourHold], undefined, { advisorId: "megan", techId: "marcus" }).some((row) => row.time === "09:30"), false);

    assert.equal(fresh.getState().updateCapacityLimits({ maxAdvisorAppointmentsPerHour: null, maxWaiterPerSlot: 2 }).ok, true);
    shared = fresh.getState().settings.scheduling;
    const waiting = load("one-wait", { lane: "waiter", time: "10:00", advisorId: "jordan", techId: "elena" });
    assert.equal(propose(shared, [waiting], { lane: "waiter", time: "10:00", minutes: 30 }).open, true);
    assert.equal(slots(shared, [waiting], undefined, { transportId: "waiter", advisorId: "megan", techId: "marcus" }).some((row) => row.time === "10:00"), false);
    assert.equal(slots(shared, [waiting], undefined, { transportId: "drop", advisorId: "megan", techId: "marcus" }).some((row) => row.time === "10:00"), true);

    assert.equal(fresh.getState().updateCapacityLimits({ maxWaiterPerSlot: null, maxArrivalsPerSlot: 2 }).ok, true);
    shared = fresh.getState().settings.scheduling;
    const arrived = load("one-in", { lane: "drop", time: "10:30", advisorId: "jordan", techId: "elena" });
    assert.equal(propose(shared, [arrived], { lane: "drop", time: "10:30", minutes: 30 }).open, true);
    assert.equal(slots(shared, [arrived], undefined, { transportId: "drop", techId: "marcus" }).some((row) => row.time === "10:30"), false);

    const heldWaiter = holdLoads([{ ...load("req-wait", { lane: "waiter", time: "09:00" }), status: "pending" }]);
    assert.equal(board(scheduling, store.getState().advisors, heldWaiter).slots.find((row) => row.time === "09:00")?.waiters, 1);
  });
});

function shop() {
  const store = createShopStore({ demoMode: true, storage: memoryStorage() });
  store.getState().setWorkingAs("derek");
  return store;
}

function propose(
  scheduling: SchedulingSettings,
  loads: ReturnType<typeof load>[],
  patch: {
    time?: string;
    minutes?: number;
    techId?: string;
    advisorId?: string;
    lane?: string;
  } = {},
) {
  return assessAppointment({
    scheduling,
    advisors: [{ id: "megan" }, { id: "jordan" }],
    techs: [{ id: "marcus" }, { id: "elena" }],
    appointments: [],
    laborOps: [],
    holds: loads.map((row) => ({ ...row, laborHours: row.laborHours })),
    proposal: {
      date: tuesday,
      time: patch.time ?? "09:00",
      advisorId: patch.advisorId ?? "megan",
      techId: patch.techId ?? "marcus",
      laborOpIds: [],
      minutes: patch.minutes ?? 30,
      lane: patch.lane ?? "drop",
    },
  });
}

function board(
  scheduling: Parameters<typeof dayCapacity>[0]["scheduling"],
  advisors: { id: string }[],
  loads: Parameters<typeof dayCapacity>[0]["loads"],
) {
  return dayCapacity({
    scheduling,
    advisors,
    techs: [{ id: "marcus" }, { id: "elena" }],
    loads,
    date: tuesday,
  });
}

function slots(
  scheduling: Parameters<typeof onlineSlots>[0]["scheduling"],
  loads: Parameters<typeof onlineSlots>[0]["loads"],
  holds?: Parameters<typeof onlineSlots>[0]["holds"],
  patch: { advisorId?: string; techId?: string; transportId?: string } = {},
) {
  return onlineSlots({
    scheduling,
    advisors: [{ id: "megan" }, { id: "jordan" }],
    techs: [
      { id: "marcus", board: "main" },
      { id: "elena", board: "main" },
    ],
    loads,
    holds,
    serviceId: "gc-oil",
    from: tuesday,
    through: tuesday,
    now: morning,
    advisorId: patch.advisorId,
    techId: patch.techId,
    transportId: patch.transportId,
  });
}

function load(
  id: string,
  patch: Partial<{
    time: string;
    advisorId: string;
    techId: string;
    laborHours: number;
    lane: string;
  }> = {},
) {
  return {
    id,
    date: tuesday,
    time: patch.time ?? "09:00",
    advisorId: patch.advisorId ?? "jordan",
    techId: patch.techId ?? "marcus",
    laborHours: patch.laborHours ?? 0.5,
    counts: true,
    lane: patch.lane ?? "drop",
  };
}

function hold(id: string, patch: { laborHours: number }) {
  return load(id, {
    laborHours: patch.laborHours,
    advisorId: "jordan",
    techId: "marcus",
    lane: "drop",
  });
}

function request(): OnlineRequest {
  return {
    id: "req-pending",
    storeId: "grand-coulee",
    status: "pending",
    createdAt: when,
    serviceId: "gc-oil",
    serviceName: "Oil and filter",
    laborHours: 1,
    date: tuesday,
    time: "09:00",
    advisorId: "jordan",
    advisorName: "Jordan Hale",
    techId: "marcus",
    techName: "Marcus Hale",
    transportId: "drop",
    transportName: "Drop-off",
    contactMethod: "text",
    verified: false,
    customerId: null,
    customerName: "Pat Example",
    phone: "5095550199",
    email: "pat@example.com",
    vehicleId: null,
    year: 2020,
    make: "Ford",
    model: "Escape",
    vin: "1FTAB12C0GGA00099",
    plate: "ABC123",
    appointmentId: null,
  };
}

function draft(state: {
  customers: { id: string }[];
  vehicles: { id: string; customerId: string }[];
  advisors: { id: string }[];
}): Omit<Appointment, "id" | "orderId"> {
  const customer = state.customers[0];
  const vehicle = state.vehicles.find((row) => row.customerId === customer.id) ?? state.vehicles[0];
  return {
    date: tuesday,
    time: "10:00",
    minutes: 60,
    customerId: customer.id,
    vehicleId: vehicle.id,
    advisorId: state.advisors.find((row) => row.id === "megan")?.id ?? state.advisors[0].id,
    concern: "A. Oil change",
    lines: [{ id: "a", code: "A", concern: "Oil change" }],
    vin: "",
    laborOpIds: [],
    techId: "marcus",
    lane: "drop",
    status: "scheduled",
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
