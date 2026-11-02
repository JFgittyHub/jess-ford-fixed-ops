import { addDays, daysBetween, now } from "./clock";
import type { Appointment, OverrideReason, SchedulingSettings, WeekdayIndex } from "./types";

/**
 * A slot is open only when it fits this store's capacity settings.
 * Until a service manager changes them, each technician gets the open day
 * and each advisor gets one appointment per open hour across the day.
 * Pending holds count the same way as appointments. No-shows, cancelled
 * appointments, and declined holds do not. A technician or advisor who is
 * not on this store is refused. That is not a warning the advisor can override.
 */
export type CapacityLoad = {
  id: string;
  date: string;
  time: string;
  advisorId: string;
  techId: string;
  laborHours: number;
  counts: boolean;
  /** Transport id. Waiter and the older express lane count toward the waiter cap. */
  lane?: string;
};

export type CapacityProposal = {
  date: string;
  time: string;
  advisorId: string;
  techId: string;
  laborHours: number;
  /** Visit length in minutes. Used when a part-day block overlaps the visit. */
  minutes?: number;
  lane?: string;
  ignoreId?: string;
};

export type CapacitySide = {
  used: number;
  adding: number;
  capacity: number;
  overloaded: boolean;
};

export type LimitSide = {
  used: number;
  adding: number;
  /** Null when the shop has not set this limit. */
  capacity: number | null;
  overloaded: boolean;
};

export type CapacityResult = {
  /** False when online customers should not see the slot at full capacity. Online share is applied separately. */
  open: boolean;
  /** Set when an advisor may continue anyway. Null when the slot is open or blocked. */
  warning: string | null;
  /** Hard stop. The visit is not saved and no override is written. */
  blocked: string | null;
  tech: CapacitySide;
  /** Daily advisor total. The hourly cap, when set, also sets overloaded. */
  advisor: CapacitySide;
  advisorHour: LimitSide;
  waiter: LimitSide;
  arrivals: LimitSide;
  /** Set when the technician is off for the visit. */
  off: "day" | "part" | null;
};

export type OnlineSlot = {
  date: string;
  time: string;
  advisorId: string;
  techId: string;
  laborHours: number;
};

const EPSILON = 1e-9;

export function laborHoursFor(laborOpIds: string[], minutes: number, laborOps: { id: string; hours: number }[]): number {
  const ids = Array.isArray(laborOpIds) ? laborOpIds : [];
  const fromOps = ids.reduce((sum, id) => sum + (laborOps.find((op) => op.id === id)?.hours ?? 0), 0);
  const hours = fromOps > 0 ? fromOps : Math.max(0, minutes) / 60;
  return round2(hours);
}

export function appointmentLoads(appointments: Pick<Appointment, "id" | "date" | "time" | "minutes" | "advisorId" | "techId" | "laborOpIds" | "status" | "lane">[], laborOps: { id: string; hours: number }[]): CapacityLoad[] {
  return appointments.map((row) => ({
    id: row.id,
    date: row.date,
    time: row.time,
    advisorId: row.advisorId,
    techId: row.techId,
    laborHours: laborHoursFor(row.laborOpIds, row.minutes, laborOps),
    counts: row.status !== "no_show" && row.status !== "cancelled",
    lane: row.lane,
  }));
}

/** Pending online requests use this shape. Declined rows do not take capacity. */
export function holdLoads(
  holds: {
    id: string;
    date: string;
    time: string;
    advisorId: string;
    techId: string;
    laborHours: number;
    status?: string;
    lane?: string;
  }[],
): CapacityLoad[] {
  return holds.map((row) => ({
    id: row.id,
    date: row.date,
    time: row.time,
    advisorId: row.advisorId,
    techId: row.techId,
    laborHours: round2(Math.max(0, row.laborHours)),
    counts: row.status !== "declined" && row.status !== "no_show",
    lane: row.lane,
  }));
}

export function evaluateCapacity(input: { scheduling: SchedulingSettings; advisors: { id: string }[]; techs: { id: string }[]; loads: CapacityLoad[]; proposal: CapacityProposal }): CapacityResult {
  const proposal = input.proposal;
  const adding = round2(Math.max(0, proposal.laborHours));
  const day = shopDay(input.scheduling, proposal.date);
  const rules = limits(input.scheduling);
  const knownTech = proposal.techId !== "" && input.techs.some((tech) => tech.id === proposal.techId);
  const knownAdvisor = proposal.advisorId !== "" && input.advisors.some((advisor) => advisor.id === proposal.advisorId);
  const sameDay = input.loads.filter((row) => row.counts && row.date === proposal.date && row.id !== proposal.ignoreId);
  const techUsed = round2(sameDay.filter((row) => row.techId === proposal.techId).reduce((sum, row) => sum + row.laborHours, 0));
  const advisorUsed = sameDay.filter((row) => row.advisorId === proposal.advisorId).length;
  const span = visitSpan(proposal);
  const off = !day.closed && knownTech ? timeOffHit(input.scheduling, proposal.techId, proposal.date, proposal.time, span) : null;
  const techCapacity = !day.closed && knownTech ? techAvailableHours(input.scheduling, proposal.techId, proposal.date) : 0;
  const advisorCapacity = !day.closed && knownAdvisor ? day.advisorCap : 0;
  const hourCap = !day.closed && knownAdvisor ? rules.maxAdvisorAppointmentsPerHour : null;
  const hourUsed = sameDay.filter((row) => row.advisorId === proposal.advisorId && hourKey(row.time) === hourKey(proposal.time)).length;
  const waiterCap = !day.closed ? rules.maxWaiterPerSlot : null;
  const arrivalCap = !day.closed ? rules.maxArrivalsPerSlot : null;
  const slot = slotKey(proposal.time);
  const waiterUsed = sameDay.filter((row) => slotKey(row.time) === slot && isWaiter(row.lane)).length;
  const arrivalUsed = sameDay.filter((row) => slotKey(row.time) === slot).length;
  const waiterAdding = isWaiter(proposal.lane) ? 1 : 0;
  const techOverloaded = !knownTech || off !== null || techUsed + adding > techCapacity + EPSILON;
  const hourOverloaded = hourCap != null && hourUsed + 1 > hourCap;
  const advisorOverloaded = !knownAdvisor || advisorUsed + 1 > advisorCapacity || hourOverloaded;
  const waiterOverloaded = waiterCap != null && waiterAdding + waiterUsed > waiterCap;
  const arrivalsOverloaded = arrivalCap != null && arrivalUsed + 1 > arrivalCap;
  const blocked = day.closed ? "The shop is closed that day." : staffBlockMessage(knownTech, knownAdvisor);
  const warning = blocked
    ? null
    : capacityWarning({
        off,
        techOverloaded,
        advisorOverloaded,
        waiterOverloaded,
        arrivalsOverloaded,
      });
  return {
    open: blocked === null && warning === null,
    warning,
    blocked,
    off,
    tech: { used: techUsed, adding, capacity: techCapacity, overloaded: techOverloaded },
    advisor: {
      used: advisorUsed,
      adding: 1,
      capacity: advisorCapacity,
      overloaded: advisorOverloaded,
    },
    advisorHour: { used: hourUsed, adding: 1, capacity: hourCap, overloaded: hourOverloaded },
    waiter: {
      used: waiterUsed,
      adding: waiterAdding,
      capacity: waiterCap,
      overloaded: waiterOverloaded,
    },
    arrivals: {
      used: arrivalUsed,
      adding: 1,
      capacity: arrivalCap,
      overloaded: arrivalsOverloaded,
    },
  };
}

export function assessAppointment(input: {
  scheduling: SchedulingSettings;
  advisors: { id: string }[];
  techs: { id: string }[];
  appointments: Pick<Appointment, "id" | "date" | "time" | "minutes" | "advisorId" | "techId" | "laborOpIds" | "status" | "lane">[];
  laborOps: { id: string; hours: number }[];
  holds?: {
    id: string;
    date: string;
    time: string;
    advisorId: string;
    techId: string;
    laborHours: number;
    status?: string;
    lane?: string;
  }[];
  proposal: {
    date: string;
    time: string;
    advisorId: string;
    techId: string;
    laborOpIds: string[];
    minutes: number;
    lane?: string;
    ignoreId?: string;
  };
}): CapacityResult {
  return evaluateCapacity({
    scheduling: input.scheduling,
    advisors: input.advisors,
    techs: input.techs,
    loads: [...appointmentLoads(input.appointments, input.laborOps), ...holdLoads(input.holds ?? [])],
    proposal: {
      date: input.proposal.date,
      time: input.proposal.time,
      advisorId: input.proposal.advisorId,
      techId: input.proposal.techId,
      laborHours: laborHoursFor(input.proposal.laborOpIds, input.proposal.minutes, input.laborOps),
      minutes: input.proposal.minutes,
      lane: input.proposal.lane,
      ignoreId: input.proposal.ignoreId,
    },
  });
}

/** Sentence for the advisor form. A block is a hard stop. A warning can still be saved. */
export function advisorBookingNote(result: CapacityResult): string | null {
  if (result.blocked) return result.blocked;
  if (!result.warning) return null;
  return `${result.warning} You can still book it. Online customers will not see this time.`;
}

export function staffBlockMessage(knownTech: boolean, knownAdvisor: boolean): string | null {
  if (!knownTech && !knownAdvisor) return "That technician and advisor aren't on this store.";
  if (!knownTech) return "That technician isn't on this store.";
  if (!knownAdvisor) return "That advisor isn't on this store.";
  return null;
}

export function overrideReason(result: CapacityResult): OverrideReason | null {
  if (result.blocked || result.open || !result.warning) return null;
  if (result.warning.startsWith("The shop is closed")) return "closed";
  if (result.warning.includes("isn't on this store") || result.warning.includes("aren't on this store")) return null;
  if (result.tech.overloaded && result.advisor.overloaded) return "both";
  if (result.tech.overloaded) return "tech-hours";
  if (result.advisor.overloaded) return "advisor";
  if (result.waiter.overloaded && result.arrivals.overloaded) return "slot";
  if (result.waiter.overloaded) return "waiter";
  if (result.arrivals.overloaded) return "arrivals";
  return null;
}

export function overrideReasonLabel(reason: OverrideReason): string {
  switch (reason) {
    case "tech-hours":
      return "Technician hours";
    case "advisor":
      return "Advisor capacity";
    case "both":
      return "Technician hours and advisor capacity";
    case "closed":
      return "Store closed";
    case "unknown-staff":
      return "Staff not on this store";
    case "waiter":
      return "Waiter appointments";
    case "arrivals":
      return "Arrivals";
    case "slot":
      return "Waiter appointments and arrivals";
  }
}

export function onlineSlots(input: {
  scheduling: SchedulingSettings;
  advisors: { id: string }[];
  techs: { id: string; board?: string }[];
  loads: CapacityLoad[];
  holds?: {
    id: string;
    date: string;
    time: string;
    advisorId: string;
    techId: string;
    laborHours: number;
    status?: string;
    lane?: string;
  }[];
  serviceId: string;
  now?: Date;
  from?: string;
  through?: string;
  advisorId?: string;
  techId?: string;
  /** When this is a waiter ride, the waiter cap and its online share apply. */
  transportId?: string;
}): OnlineSlot[] {
  const service = input.scheduling.onlineMenu.find((row) => row.id === input.serviceId);
  if (!service) return [];
  const clock = shopNow(input.now ?? now());
  const lead = input.scheduling.bookingWindow.minLeadHours;
  const lastDay = input.scheduling.bookingWindow.daysAhead;
  const loads = [...input.loads, ...holdLoads(input.holds ?? [])];
  const advisors = input.advisors.filter((row) => !input.advisorId || row.id === input.advisorId);
  const techs = input.techs.filter((row) => row.board !== "none" && (!input.techId || row.id === input.techId));
  const slots: OnlineSlot[] = [];
  for (let offset = 0; offset <= lastDay; offset += 1) {
    const date = addDays(clock.date, offset);
    if (input.from && date < input.from) continue;
    if (input.through && date > input.through) continue;
    if (daysBetween(clock.date, date) > lastDay) continue;
    const day = shopDay(input.scheduling, date);
    if (day.closed) continue;
    for (let minutes = firstSlot(day.openMinutes); minutes < day.closeMinutes; minutes += 30) {
      if (instant(date, minutes) < instant(clock.date, clock.minutes) + lead * 3_600_000) continue;
      const time = formatTime(minutes);
      for (const advisor of advisors) {
        for (const tech of techs) {
          const proposal = {
            date,
            time,
            advisorId: advisor.id,
            techId: tech.id,
            laborHours: service.laborHours,
            minutes: Math.round(service.laborHours * 60),
            lane: input.transportId,
          };
          const result = evaluateCapacity({
            scheduling: input.scheduling,
            advisors,
            techs,
            loads,
            proposal,
          });
          if (!result.open || !withinOnlineShare(input.scheduling, result)) continue;
          slots.push({
            date,
            time,
            advisorId: advisor.id,
            techId: tech.id,
            laborHours: service.laborHours,
          });
        }
      }
    }
  }
  return slots;
}

function capacityWarning(input: { off: "day" | "part" | null; techOverloaded: boolean; advisorOverloaded: boolean; waiterOverloaded: boolean; arrivalsOverloaded: boolean }): string | null {
  const hoursFull = input.techOverloaded && input.off === null;
  if (hoursFull && input.advisorOverloaded && !input.waiterOverloaded && !input.arrivalsOverloaded) {
    return "This would overload technician hours and advisor capacity.";
  }
  const parts: string[] = [];
  if (input.off === "day") parts.push("That technician is off that day.");
  else if (input.off === "part") parts.push("That technician is off then.");
  else if (input.techOverloaded) parts.push("This would overload technician hours for that job.");
  if (input.advisorOverloaded) parts.push("This would overload advisor capacity.");
  if (input.waiterOverloaded) parts.push("This would overload waiter appointments for that time.");
  if (input.arrivalsOverloaded) parts.push("This would overload arrivals for that time.");
  if (parts.length === 0) return null;
  return parts.join(" ");
}

/** How many appointments one advisor can take that day. Zero when the store is closed. */
export function advisorDayCapacity(scheduling: SchedulingSettings, iso: string): number {
  return shopDay(scheduling, iso).advisorCap;
}

export type TechDayTally = {
  id: string;
  usedHours: number;
  availableHours: number;
  off: "none" | "day" | "part";
  offLabel: string;
};

export type DayCapacity = {
  date: string;
  closed: boolean;
  openHours: number;
  onlineSharePercent: number;
  advisorDayCap: number;
  advisorHourCap: number | null;
  waiterCap: number | null;
  arrivalCap: number | null;
  techs: TechDayTally[];
  usedHours: number;
  availableHours: number;
  /** One row per clock hour the shop is open. */
  hours: { time: string; advisors: { id: string; used: number }[] }[];
  /** One row per 30-minute slot. */
  slots: { time: string; arrivals: number; waiters: number }[];
  advisors: { id: string; dayUsed: number }[];
};

/** Used versus available for one day, from the same settings the booking check uses. */
export function dayCapacity(input: { scheduling: SchedulingSettings; techs: { id: string }[]; advisors: { id: string }[]; loads: CapacityLoad[]; date: string }): DayCapacity {
  const day = shopDay(input.scheduling, input.date);
  const rules = limits(input.scheduling);
  const counted = input.loads.filter((row) => row.counts && row.date === input.date);
  const techs = input.techs.map((tech) => {
    const blocks = blocksFor(input.scheduling, tech.id, input.date);
    const whole = blocks.some((block) => block.whole);
    const parts = blocks.filter((block) => !block.whole);
    const usedHours = round2(counted.filter((row) => row.techId === tech.id).reduce((sum, row) => sum + row.laborHours, 0));
    return {
      id: tech.id,
      usedHours,
      availableHours: day.closed ? 0 : techAvailableHours(input.scheduling, tech.id, input.date),
      off: whole ? ("day" as const) : parts.length > 0 ? ("part" as const) : ("none" as const),
      offLabel: whole ? "Off" : parts.map((block) => `${block.start}–${block.end}`).join(", "),
    };
  });
  const hours: DayCapacity["hours"] = [];
  const slots: DayCapacity["slots"] = [];
  if (!day.closed) {
    const firstHour = Math.floor(day.openMinutes / 60);
    const lastHour = Math.floor((day.closeMinutes - 1) / 60);
    for (let hour = firstHour; hour <= lastHour; hour += 1) {
      const time = formatTime(hour * 60);
      hours.push({
        time,
        advisors: input.advisors.map((advisor) => ({
          id: advisor.id,
          used: counted.filter((row) => row.advisorId === advisor.id && hourKey(row.time) === hour).length,
        })),
      });
    }
    for (let minutes = firstSlot(day.openMinutes); minutes < day.closeMinutes; minutes += 30) {
      const time = formatTime(minutes);
      const rows = counted.filter((row) => slotKey(row.time) === time);
      slots.push({
        time,
        arrivals: rows.length,
        waiters: rows.filter((row) => isWaiter(row.lane)).length,
      });
    }
  }
  return {
    date: input.date,
    closed: day.closed,
    openHours: day.openHours,
    onlineSharePercent: rules.onlineSharePercent,
    advisorDayCap: day.advisorCap,
    advisorHourCap: rules.maxAdvisorAppointmentsPerHour,
    waiterCap: rules.maxWaiterPerSlot,
    arrivalCap: rules.maxArrivalsPerSlot,
    techs,
    usedHours: round2(techs.reduce((sum, tech) => sum + tech.usedHours, 0)),
    availableHours: round2(techs.reduce((sum, tech) => sum + tech.availableHours, 0)),
    hours,
    slots,
    advisors: input.advisors.map((advisor) => ({
      id: advisor.id,
      dayUsed: counted.filter((row) => row.advisorId === advisor.id).length,
    })),
  };
}

/** Shop open hours for a weekday, before a technician's own hours or time off. */
export function weekdayShopHours(scheduling: SchedulingSettings, weekday: WeekdayIndex): number {
  const row = scheduling.hours.find((item) => item.weekday === weekday);
  if (!row || row.closed) return 0;
  const open = minutesOf(row.open);
  const close = minutesOf(row.close);
  return close > open ? round2((close - open) / 60) : 0;
}

export function techAvailableHours(scheduling: SchedulingSettings, techId: string, iso: string): number {
  const day = shopDay(scheduling, iso);
  if (day.closed) return 0;
  const blocks = blocksFor(scheduling, techId, iso);
  if (blocks.some((block) => block.whole)) return 0;
  const custom = limits(scheduling).techHours.find((row) => row.techId === techId)?.hours[day.weekday];
  const base = custom == null ? day.openHours : custom;
  const blocked = mergedBlockHours(day.openMinutes, day.closeMinutes, blocks);
  return round2(Math.max(0, base - blocked));
}

function shopDay(
  scheduling: SchedulingSettings,
  iso: string,
): {
  weekday: WeekdayIndex;
  closed: boolean;
  openMinutes: number;
  closeMinutes: number;
  openHours: number;
  advisorCap: number;
} {
  const weekday = weekdayOf(iso);
  const row = scheduling.hours.find((item) => item.weekday === weekday);
  const closed = !row || row.closed || scheduling.closedDates.includes(iso);
  const openMinutes = row ? minutesOf(row.open) : 0;
  const closeMinutes = row ? minutesOf(row.close) : 0;
  const openHours = !closed && closeMinutes > openMinutes ? round2((closeMinutes - openMinutes) / 60) : 0;
  return {
    weekday,
    closed: closed || openHours <= 0,
    openMinutes,
    closeMinutes,
    openHours,
    advisorCap: openHours <= 0 ? 0 : Math.floor(openHours),
  };
}

type OffBlock = { whole: boolean; start: string; end: string; startMin: number; endMin: number };

function limits(scheduling: SchedulingSettings) {
  return (
    scheduling.capacity ?? {
      techHours: [],
      timeOff: [],
      maxAdvisorAppointmentsPerHour: null,
      maxWaiterPerSlot: null,
      maxArrivalsPerSlot: null,
      onlineSharePercent: 100,
    }
  );
}

function blocksFor(scheduling: SchedulingSettings, techId: string, iso: string): OffBlock[] {
  return limits(scheduling)
    .timeOff.filter((row) => row.techId === techId && row.date === iso)
    .map((row) => {
      const whole = !row.start && !row.end;
      return {
        whole,
        start: row.start,
        end: row.end,
        startMin: whole ? 0 : minutesOf(row.start),
        endMin: whole ? 24 * 60 : minutesOf(row.end),
      };
    });
}

function timeOffHit(scheduling: SchedulingSettings, techId: string, iso: string, time: string, span: number): "day" | "part" | null {
  const blocks = blocksFor(scheduling, techId, iso);
  if (blocks.some((block) => block.whole)) return "day";
  const start = minutesOf(time);
  const end = start + Math.max(span, 1);
  if (blocks.some((block) => !block.whole && start < block.endMin && end > block.startMin)) return "part";
  return null;
}

function mergedBlockHours(openMin: number, closeMin: number, blocks: OffBlock[]): number {
  const ranges = blocks
    .filter((block) => !block.whole)
    .map((block) => ({
      start: Math.max(openMin, block.startMin),
      end: Math.min(closeMin, block.endMin),
    }))
    .filter((range) => range.end > range.start)
    .sort((a, b) => a.start - b.start);
  let minutes = 0;
  let cursor = -1;
  for (const range of ranges) {
    const start = Math.max(range.start, cursor);
    if (range.end > start) minutes += range.end - start;
    cursor = Math.max(cursor, range.end);
  }
  return round2(minutes / 60);
}

function withinOnlineShare(scheduling: SchedulingSettings, result: CapacityResult): boolean {
  const share = limits(scheduling).onlineSharePercent;
  if (share >= 100) return true;
  if (!fitsShare(result.tech.used, result.tech.adding, result.tech.capacity, share)) return false;
  if (!fitsShare(result.advisor.used, result.advisor.adding, result.advisor.capacity, share)) return false;
  if (result.advisorHour.capacity != null && !fitsShare(result.advisorHour.used, result.advisorHour.adding, result.advisorHour.capacity, share)) return false;
  if (result.waiter.capacity != null && result.waiter.adding > 0 && !fitsShare(result.waiter.used, result.waiter.adding, result.waiter.capacity, share)) return false;
  if (result.arrivals.capacity != null && !fitsShare(result.arrivals.used, result.arrivals.adding, result.arrivals.capacity, share)) return false;
  return true;
}

function fitsShare(used: number, adding: number, capacity: number, percent: number) {
  return used + adding <= capacity * (percent / 100) + EPSILON;
}

function visitSpan(proposal: CapacityProposal) {
  if (typeof proposal.minutes === "number" && proposal.minutes > 0) return proposal.minutes;
  return Math.max(0, proposal.laborHours) * 60;
}

function isWaiter(lane: string | undefined) {
  return lane === "waiter" || lane === "express";
}

function hourKey(time: string) {
  return Math.floor(minutesOf(time) / 60);
}

function slotKey(time: string) {
  const minutes = minutesOf(time);
  return formatTime(Math.floor(minutes / 30) * 30);
}

function weekdayOf(iso: string): WeekdayIndex {
  const [year, month, day] = iso.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day)).getUTCDay() as WeekdayIndex;
}

function minutesOf(time: string): number {
  const match = /^(\d{2}):(\d{2})$/.exec(time);
  if (!match) return 0;
  return Number(match[1]) * 60 + Number(match[2]);
}

function formatTime(minutes: number): string {
  return `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;
}

function firstSlot(openMinutes: number): number {
  return Math.ceil(openMinutes / 30) * 30;
}

function instant(iso: string, minutes: number): number {
  const [year, month, day] = iso.split("-").map(Number);
  return Date.UTC(year, month - 1, day) + minutes * 60_000;
}

function shopNow(date: Date): { date: string; minutes: number } {
  const map: Record<string, string> = {};
  for (const part of new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Los_Angeles",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date)) {
    if (part.type !== "literal") map[part.type] = part.value;
  }
  let hour = Number(map.hour);
  let iso = `${map.year}-${map.month}-${map.day}`;
  if (hour === 24) {
    hour = 0;
    iso = addDays(iso, 1);
  }
  return { date: iso, minutes: hour * 60 + Number(map.minute) };
}

/** A bookable start is a half-hour on that day's open grid. Anything else is refused. */
export function visitTimeError(scheduling: SchedulingSettings, iso: string, time: string): string | null {
  if (!time || !/^([01]\d|2[0-3]):[0-5]\d$/.test(time) || !/^\d{2}:(00|30)$/.test(time)) {
    return "That time is not on the clock.";
  }
  const day = shopDay(scheduling, iso);
  if (day.closed) return "The shop is closed that day.";
  const [hour, minute] = time.split(":").map(Number);
  const mins = hour * 60 + minute;
  if (mins < day.openMinutes || mins >= day.closeMinutes) return "That time is outside shop hours.";
  return null;
}

/** Lengths are 30-minute steps. A bad length is refused, not replaced with 60. */
export function visitLengthError(minutes: unknown): string | null {
  if (typeof minutes !== "number" || !Number.isInteger(minutes) || minutes < 30 || minutes > 1440 || minutes % 30 !== 0) {
    return "That length is not on this desk.";
  }
  return null;
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}
