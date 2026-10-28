import { addDays, daysBetween, now } from "./clock";
import type { Appointment, OverrideReason, SchedulingSettings, WeekdayIndex } from "./types";

/**
 * A slot is open only when the job's labor hours fit the technician's
 * remaining shop day and the advisor still has a free appointment that day.
 * Hours follow that store's open hours. Pending holds count the same way as
 * appointments. No-shows and declined holds do not.
 */
export type CapacityLoad = {
  id: string;
  date: string;
  time: string;
  advisorId: string;
  techId: string;
  laborHours: number;
  counts: boolean;
};

export type CapacityProposal = {
  date: string;
  time: string;
  advisorId: string;
  techId: string;
  laborHours: number;
  ignoreId?: string;
};

export type CapacitySide = {
  used: number;
  adding: number;
  capacity: number;
  overloaded: boolean;
};

export type CapacityResult = {
  /** False when online customers should not see the slot. */
  open: boolean;
  /** Set when an advisor may continue anyway. Null when the slot is open. */
  warning: string | null;
  tech: CapacitySide;
  advisor: CapacitySide;
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
  const fromOps = laborOpIds.reduce((sum, id) => sum + (laborOps.find((op) => op.id === id)?.hours ?? 0), 0);
  const hours = fromOps > 0 ? fromOps : Math.max(0, minutes) / 60;
  return round2(hours);
}

export function appointmentLoads(
  appointments: Pick<Appointment, "id" | "date" | "time" | "minutes" | "advisorId" | "techId" | "laborOpIds" | "status">[],
  laborOps: { id: string; hours: number }[],
): CapacityLoad[] {
  return appointments.map((row) => ({
    id: row.id,
    date: row.date,
    time: row.time,
    advisorId: row.advisorId,
    techId: row.techId,
    laborHours: laborHoursFor(row.laborOpIds, row.minutes, laborOps),
    counts: row.status !== "no_show",
  }));
}

/** Pending online requests use this shape. Declined rows do not take capacity. */
export function holdLoads(
  holds: { id: string; date: string; time: string; advisorId: string; techId: string; laborHours: number; status?: string }[],
): CapacityLoad[] {
  return holds.map((row) => ({
    id: row.id,
    date: row.date,
    time: row.time,
    advisorId: row.advisorId,
    techId: row.techId,
    laborHours: round2(Math.max(0, row.laborHours)),
    counts: row.status !== "declined" && row.status !== "no_show",
  }));
}

export function evaluateCapacity(input: {
  scheduling: SchedulingSettings;
  advisors: { id: string }[];
  techs: { id: string }[];
  loads: CapacityLoad[];
  proposal: CapacityProposal;
}): CapacityResult {
  const proposal = input.proposal;
  const adding = round2(Math.max(0, proposal.laborHours));
  const day = shopDay(input.scheduling, proposal.date);
  const knownTech = proposal.techId !== "" && input.techs.some((tech) => tech.id === proposal.techId);
  const knownAdvisor = proposal.advisorId !== "" && input.advisors.some((advisor) => advisor.id === proposal.advisorId);
  const sameDay = input.loads.filter((row) => row.counts && row.date === proposal.date && row.id !== proposal.ignoreId);
  const techUsed = round2(
    sameDay.filter((row) => row.techId === proposal.techId).reduce((sum, row) => sum + row.laborHours, 0),
  );
  const advisorUsed = sameDay.filter((row) => row.advisorId === proposal.advisorId).length;
  const techCapacity = !day.closed && knownTech ? day.openHours : 0;
  const advisorCapacity = !day.closed && knownAdvisor ? day.advisorCap : 0;
  const techOverloaded = !knownTech || techUsed + adding > techCapacity + EPSILON;
  const advisorOverloaded = !knownAdvisor || advisorUsed + 1 > advisorCapacity;
  const warning = capacityWarning({
    closed: day.closed,
    knownTech,
    knownAdvisor,
    techOverloaded,
    advisorOverloaded,
  });
  return {
    open: warning === null,
    warning,
    tech: { used: techUsed, adding, capacity: techCapacity, overloaded: techOverloaded },
    advisor: { used: advisorUsed, adding: 1, capacity: advisorCapacity, overloaded: advisorOverloaded },
  };
}

export function assessAppointment(input: {
  scheduling: SchedulingSettings;
  advisors: { id: string }[];
  techs: { id: string }[];
  appointments: Pick<Appointment, "id" | "date" | "time" | "minutes" | "advisorId" | "techId" | "laborOpIds" | "status">[];
  laborOps: { id: string; hours: number }[];
  holds?: { id: string; date: string; time: string; advisorId: string; techId: string; laborHours: number; status?: string }[];
  proposal: {
    date: string;
    time: string;
    advisorId: string;
    techId: string;
    laborOpIds: string[];
    minutes: number;
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
      ignoreId: input.proposal.ignoreId,
    },
  });
}

/** Sentence for the advisor form. Saving stays allowed and records an override. */
export function advisorBookingNote(result: CapacityResult): string | null {
  if (!result.warning) return null;
  return `${result.warning} You can still book it. Online customers will not see this time.`;
}

export function overrideReason(result: CapacityResult): OverrideReason | null {
  if (result.open || !result.warning) return null;
  if (result.warning.startsWith("The store is closed")) return "closed";
  if (result.warning.includes("isn't on this store") || result.warning.includes("aren't on this store")) return "unknown-staff";
  if (result.tech.overloaded && result.advisor.overloaded) return "both";
  if (result.tech.overloaded) return "tech-hours";
  if (result.advisor.overloaded) return "advisor";
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
  }
}

export function onlineSlots(input: {
  scheduling: SchedulingSettings;
  advisors: { id: string }[];
  techs: { id: string; board?: string }[];
  loads: CapacityLoad[];
  holds?: { id: string; date: string; time: string; advisorId: string; techId: string; laborHours: number; status?: string }[];
  serviceId: string;
  now?: Date;
  from?: string;
  through?: string;
  advisorId?: string;
  techId?: string;
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
          const result = evaluateCapacity({
            scheduling: input.scheduling,
            advisors,
            techs,
            loads,
            proposal: { date, time, advisorId: advisor.id, techId: tech.id, laborHours: service.laborHours },
          });
          if (!result.open) continue;
          slots.push({ date, time, advisorId: advisor.id, techId: tech.id, laborHours: service.laborHours });
        }
      }
    }
  }
  return slots;
}

function capacityWarning(input: {
  closed: boolean;
  knownTech: boolean;
  knownAdvisor: boolean;
  techOverloaded: boolean;
  advisorOverloaded: boolean;
}): string | null {
  if (input.closed) return "The store is closed that day.";
  if (!input.knownTech && !input.knownAdvisor) return "That technician and advisor aren't on this store.";
  if (!input.knownTech) return "That technician isn't on this store.";
  if (!input.knownAdvisor) return "That advisor isn't on this store.";
  if (input.techOverloaded && input.advisorOverloaded) return "This would overload technician hours and advisor capacity.";
  if (input.techOverloaded) return "This would overload technician hours for that job.";
  if (input.advisorOverloaded) return "This would overload advisor capacity.";
  return null;
}

function shopDay(scheduling: SchedulingSettings, iso: string): {
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
    closed: closed || openHours <= 0,
    openMinutes,
    closeMinutes,
    openHours,
    advisorCap: openHours <= 0 ? 0 : Math.floor(openHours),
  };
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

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}
