import { money2 } from "./format";
import { cleanFreeText } from "./online-request";
import { HOURS_MAX, NAME_MAX, inRange } from "./range";
import type { BookingWindow, CapacitySettings, DayHours, OnlineService, SchedulingSettings, StoreId, TechTimeOff, TechWeekHours, TransportOption, WeekdayIndex } from "./types";

export const WEEKDAY_LABELS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"] as const;

const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

function day(weekday: WeekdayIndex, open: string, close: string, closed = false): DayHours {
  return { weekday, open, close, closed };
}

function menu(rows: Array<[string, string, number]>): OnlineService[] {
  return rows.map(([id, name, laborHours]) => ({ id, name, laborHours }));
}

const LEGACY_LANE: Record<string, string> = {
  express: "waiter",
  loaner: "drop",
};

/** Keep a lane on this store's transport list. Express becomes Waiter and loaner becomes Drop-off. */
export function normalizeLane(value: unknown, options: TransportOption[]): string {
  const ids = options.map((row) => row.id);
  const raw = typeof value === "string" ? value : "";
  if (ids.includes(raw)) return raw;
  const mapped = LEGACY_LANE[raw];
  if (mapped && ids.includes(mapped)) return mapped;
  return ids[0] ?? "waiter";
}

export function laneLabel(value: string, options: TransportOption[]): string {
  return options.find((row) => row.id === value)?.name ?? value;
}

function transports(): TransportOption[] {
  return [
    { id: "waiter", name: "Waiter", kind: "waiter" },
    { id: "drop", name: "Drop-off", kind: "drop" },
  ];
}

/** Waiter and Express share one cap. A new id with the Waiter name stays on that cap. */
export function transportKind(id: string, name: string): "waiter" | "drop" | "other" {
  const label = name.trim().toLowerCase();
  if (id === "waiter" || id === "express" || label === "waiter" || label === "express") return "waiter";
  if (id === "drop" || id === "loaner" || label === "drop-off" || label === "drop" || label === "loaner") return "drop";
  return "other";
}

/** Starting scheduling setup for one store. No prices. */
export function defaultScheduling(store: StoreId = "grand-coulee"): SchedulingSettings {
  if (store === "pullman") {
    return {
      hours: [day(0, "08:00", "17:00", true), day(1, "07:00", "18:00"), day(2, "07:00", "18:00"), day(3, "07:00", "18:00"), day(4, "07:00", "18:00"), day(5, "07:00", "18:00"), day(6, "08:00", "16:00")],
      closedDates: ["2026-11-27", "2026-12-24"],
      bookingWindow: { daysAhead: 14, minLeadHours: 0 },
      onlineMenu: menu([
        ["pl-oil", "Oil and filter", 0.6],
        ["pl-align", "Four-wheel alignment", 1.2],
        ["pl-cabin", "Cabin filter", 0.4],
      ]),
      transportOptions: transports(),
      capacity: defaultCapacity(),
    };
  }
  return {
    hours: [day(0, "08:00", "17:00", true), day(1, "07:30", "17:30"), day(2, "07:30", "17:30"), day(3, "07:30", "17:30"), day(4, "07:30", "17:30"), day(5, "07:30", "17:30"), day(6, "08:00", "13:00")],
    closedDates: ["2026-11-26", "2026-12-25"],
    bookingWindow: { daysAhead: 21, minLeadHours: 0 },
    onlineMenu: menu([
      ["gc-oil", "Oil and filter", 0.5],
      ["gc-rotate", "Tire rotation", 0.3],
      ["gc-brakes", "Brake inspection", 0.4],
    ]),
    transportOptions: transports(),
    capacity: defaultCapacity(),
  };
}

/** Limits that match the old fixed rule until a service manager sets something else. */
export function defaultCapacity(): CapacitySettings {
  return {
    techHours: [],
    timeOff: [],
    maxAdvisorAppointmentsPerHour: null,
    maxWaiterPerSlot: null,
    maxArrivalsPerSlot: null,
    onlineSharePercent: 100,
    loadNotice: "",
  };
}

export function normalizeScheduling(value: unknown, store: StoreId = "grand-coulee"): SchedulingSettings {
  const fallback = defaultScheduling(store);
  if (!value || typeof value !== "object") return fallback;
  const raw = value as Partial<SchedulingSettings>;
  const hours = Array.isArray(raw.hours) ? raw.hours : [];
  const dayHours = ([0, 1, 2, 3, 4, 5, 6] as WeekdayIndex[]).map((weekday) => {
    const row = hours.find((item) => item && item.weekday === weekday);
    const base = fallback.hours[weekday];
    return {
      weekday,
      closed: row?.closed === true,
      open: typeof row?.open === "string" && TIME.test(row.open) ? row.open : base.open,
      close: typeof row?.close === "string" && TIME.test(row.close) ? row.close : base.close,
    };
  });
  return {
    hours: dayHours,
    closedDates: Array.isArray(raw.closedDates) ? [...new Set(raw.closedDates.filter((iso): iso is string => typeof iso === "string" && ISO_DATE.test(iso)))].sort() : [...fallback.closedDates],
    bookingWindow: normalizeWindow(raw.bookingWindow, fallback.bookingWindow),
    onlineMenu: Array.isArray(raw.onlineMenu)
      ? raw.onlineMenu.flatMap((item, index) => {
          const service = cleanService(item, `svc-${index + 1}`);
          return service ? [service] : [];
        })
      : fallback.onlineMenu.map((item) => ({ ...item })),
    transportOptions: transportList(raw.transportOptions, fallback.transportOptions),
    capacity: normalizeCapacity(raw.capacity, dayHours),
  };
}

const CLOSED_NOTICE = "Some capacity settings could not be read and were reset to the closed defaults.";

/** Closed numbers, not the open defaults. Used when the saved capacity object is corrupt. */
export function closedCapacity(): CapacitySettings {
  return {
    techHours: [],
    timeOff: [],
    maxAdvisorAppointmentsPerHour: 0,
    maxWaiterPerSlot: 0,
    maxArrivalsPerSlot: 0,
    onlineSharePercent: 0,
    loadNotice: CLOSED_NOTICE,
  };
}

export function normalizeCapacity(value: unknown, hours?: DayHours[]): CapacitySettings {
  const fallback = defaultCapacity();
  if (value == null) return fallback;
  if (typeof value !== "object" || Array.isArray(value)) return closedCapacity();
  const raw = value as Partial<CapacitySettings> & Record<string, unknown>;
  const notices: string[] = [];
  const present = (key: string) => Object.prototype.hasOwnProperty.call(raw, key);
  return {
    techHours: cleanTechHours(raw.techHours, hours, notices),
    timeOff: cleanTimeOff(raw.timeOff, notices),
    maxAdvisorAppointmentsPerHour: readCap(raw.maxAdvisorAppointmentsPerHour, present("maxAdvisorAppointmentsPerHour"), notices),
    maxWaiterPerSlot: readCap(raw.maxWaiterPerSlot, present("maxWaiterPerSlot"), notices),
    maxArrivalsPerSlot: readCap(raw.maxArrivalsPerSlot, present("maxArrivalsPerSlot"), notices),
    onlineSharePercent: readShare(raw.onlineSharePercent, present("onlineSharePercent"), notices),
    loadNotice: notices.length > 0 ? CLOSED_NOTICE : "",
  };
}

function transportList(value: unknown, fallback: TransportOption[]): TransportOption[] {
  if (!Array.isArray(value)) return fallback.map((item) => ({ ...item }));
  const cleaned = value.flatMap((item, index) => {
    const option = cleanTransport(item, `ride-${index + 1}`);
    return option ? [option] : [];
  });
  return cleaned.length > 0 ? cleaned : fallback.map((item) => ({ ...item }));
}

function normalizeWindow(value: Partial<BookingWindow> | undefined, fallback: BookingWindow): BookingWindow {
  return {
    daysAhead: clampInt(value?.daysAhead, 1, 365, fallback.daysAhead),
    minLeadHours: clampInt(value?.minLeadHours, 0, 168, fallback.minLeadHours),
  };
}

function clampInt(value: unknown, min: number, max: number, fallback: number) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, Math.round(parsed)));
}

function cleanService(value: unknown, fallbackId: string): OnlineService | null {
  if (!value || typeof value !== "object") return null;
  const row = value as Partial<OnlineService> & { price?: unknown };
  const name = typeof row.name === "string" ? cleanFreeText(row.name).trim().slice(0, NAME_MAX) : "";
  if (typeof row.laborHours !== "number" || !inRange(row.laborHours, 0.01, HOURS_MAX)) return null;
  const laborHours = money2(row.laborHours);
  if (!name || laborHours <= 0) return null;
  const id = typeof row.id === "string" && row.id.trim() ? row.id.trim() : fallbackId;
  return { id, name, laborHours };
}

function cleanTransport(value: unknown, fallbackId: string): TransportOption | null {
  if (!value || typeof value !== "object") return null;
  const row = value as Partial<TransportOption>;
  const name = typeof row.name === "string" ? cleanFreeText(row.name).trim().slice(0, NAME_MAX) : "";
  if (!name) return null;
  const id = typeof row.id === "string" && row.id.trim() ? row.id.trim() : fallbackId;
  return { id, name, kind: transportKind(id, name) };
}

export function patchDayHours(current: SchedulingSettings, weekday: WeekdayIndex, patch: Partial<Pick<DayHours, "closed" | "open" | "close">>): SchedulingSettings {
  return {
    ...current,
    hours: current.hours.map((row) => {
      if (row.weekday !== weekday) return row;
      const open = patch.open === undefined ? row.open : patch.open;
      const close = patch.close === undefined ? row.close : patch.close;
      if (!TIME.test(open) || !TIME.test(close) || close <= open) return row;
      return {
        ...row,
        open,
        close,
        closed: patch.closed === undefined ? row.closed : patch.closed,
      };
    }),
  };
}

export function addClosedDate(current: SchedulingSettings, iso: string): SchedulingSettings {
  const date = iso.trim();
  if (!ISO_DATE.test(date) || current.closedDates.includes(date)) return current;
  return { ...current, closedDates: [...current.closedDates, date].sort() };
}

export function removeClosedDate(current: SchedulingSettings, iso: string): SchedulingSettings {
  return { ...current, closedDates: current.closedDates.filter((row) => row !== iso) };
}

export function patchBookingWindow(current: SchedulingSettings, patch: Partial<BookingWindow>): SchedulingSettings {
  return {
    ...current,
    bookingWindow: normalizeWindow({ ...current.bookingWindow, ...patch }, current.bookingWindow),
  };
}

export function addOnlineService(current: SchedulingSettings, input: { name: string; laborHours: number }, id: string): SchedulingSettings | null {
  const service = cleanService({ ...input, id }, id);
  if (!service) return null;
  if (current.onlineMenu.some((row) => row.name.toLowerCase() === service.name.toLowerCase())) return null;
  return { ...current, onlineMenu: [...current.onlineMenu, service] };
}

export function updateOnlineService(current: SchedulingSettings, id: string, patch: Partial<Pick<OnlineService, "name" | "laborHours">>): SchedulingSettings | null {
  let changed = false;
  const onlineMenu = current.onlineMenu.map((row) => {
    if (row.id !== id) return row;
    const next = cleanService({ ...row, ...patch, id: row.id }, row.id);
    if (!next) return row;
    changed = true;
    return next;
  });
  if (!changed) return null;
  return { ...current, onlineMenu };
}

export function removeOnlineService(current: SchedulingSettings, id: string): SchedulingSettings {
  return { ...current, onlineMenu: current.onlineMenu.filter((row) => row.id !== id) };
}

export function addTransportOption(current: SchedulingSettings, name: string, id: string): SchedulingSettings | null {
  const option = cleanTransport({ name, id }, id);
  if (!option) return null;
  if (current.transportOptions.some((row) => row.name.toLowerCase() === option.name.toLowerCase())) return null;
  return { ...current, transportOptions: [...current.transportOptions, option] };
}

export function renameTransportOption(current: SchedulingSettings, id: string, name: string): SchedulingSettings | null {
  const option = cleanTransport({ id, name }, id);
  if (!option) return null;
  if (current.transportOptions.some((row) => row.id !== id && row.name.toLowerCase() === option.name.toLowerCase())) return null;
  let changed = false;
  const transportOptions = current.transportOptions.map((row) => {
    if (row.id !== id) return row;
    changed = true;
    return { ...row, name: option.name };
  });
  if (!changed) return null;
  return { ...current, transportOptions };
}

export function removeTransportOption(current: SchedulingSettings, id: string): SchedulingSettings | null {
  if (current.transportOptions.length <= 1) return null;
  if (!current.transportOptions.some((row) => row.id === id)) return null;
  return { ...current, transportOptions: current.transportOptions.filter((row) => row.id !== id) };
}

const CAP_MAX = 500;

export type CapacityLimitPatch = {
  maxAdvisorAppointmentsPerHour?: number | null | string;
  maxWaiterPerSlot?: number | null | string;
  maxArrivalsPerSlot?: number | null | string;
  onlineSharePercent?: number | string;
};

export type NumericCapacityPatch = {
  maxAdvisorAppointmentsPerHour?: number | null;
  maxWaiterPerSlot?: number | null;
  maxArrivalsPerSlot?: number | null;
  onlineSharePercent?: number;
};

const WHOLE_CAP = "Enter a whole number from 0 up, or leave the cap blank for no limit.";
const WHOLE_SHARE = "Enter a whole percent from 0 to 100.";

export function coerceCapacityPatch(patch: CapacityLimitPatch): { ok: true; patch: NumericCapacityPatch } | { ok: false; error: string } {
  const next: NumericCapacityPatch = {};
  for (const key of ["maxAdvisorAppointmentsPerHour", "maxWaiterPerSlot", "maxArrivalsPerSlot"] as const) {
    if (patch[key] === undefined) continue;
    const read = readLimitValue(patch[key]);
    if (!read.ok) return read;
    next[key] = read.value;
  }
  if (patch.onlineSharePercent !== undefined) {
    const share = typeof patch.onlineSharePercent === "string" ? parsePlainNumber(patch.onlineSharePercent) : { ok: true as const, value: patch.onlineSharePercent };
    if (!share.ok) return share;
    if (share.value == null || !Number.isInteger(share.value) || share.value < 0 || share.value > 100) return { ok: false, error: WHOLE_SHARE };
    next.onlineSharePercent = share.value;
  }
  return { ok: true, patch: next };
}

function readLimitValue(value: number | null | string): { ok: true; value: number | null } | { ok: false; error: string } {
  let parsed: number | null = value as number | null;
  if (typeof value === "string") {
    const read = parsePlainNumber(value);
    if (!read.ok) return read;
    parsed = read.value;
  }
  if (parsed == null) return { ok: true, value: null };
  if (typeof parsed !== "number" || !Number.isInteger(parsed) || parsed < 0 || parsed > CAP_MAX) return { ok: false, error: WHOLE_CAP };
  return { ok: true, value: parsed };
}

export function capacityLimitLabel(value: number | null) {
  return value == null ? "no limit" : String(value);
}

export function applyCapacityLimits(
  current: SchedulingSettings,
  patch: NumericCapacityPatch,
): {
  next: SchedulingSettings;
  changes: { field: string; before: string; after: string }[];
} | null {
  const capacity = current.capacity ?? defaultCapacity();
  let maxAdvisorAppointmentsPerHour = capacity.maxAdvisorAppointmentsPerHour;
  let maxWaiterPerSlot = capacity.maxWaiterPerSlot;
  let maxArrivalsPerSlot = capacity.maxArrivalsPerSlot;
  let onlineSharePercent = capacity.onlineSharePercent;
  const changes: { field: string; before: string; after: string }[] = [];
  if (patch.maxAdvisorAppointmentsPerHour !== undefined) {
    const next = strictCap(patch.maxAdvisorAppointmentsPerHour);
    if (next === undefined) return null;
    if (next !== maxAdvisorAppointmentsPerHour) {
      changes.push({
        field: "Capacity advisor per hour",
        before: capacityLimitLabel(maxAdvisorAppointmentsPerHour),
        after: capacityLimitLabel(next),
      });
    }
    maxAdvisorAppointmentsPerHour = next;
  }
  if (patch.maxWaiterPerSlot !== undefined) {
    const next = strictCap(patch.maxWaiterPerSlot);
    if (next === undefined) return null;
    if (next !== maxWaiterPerSlot) {
      changes.push({
        field: "Capacity waiters per slot",
        before: capacityLimitLabel(maxWaiterPerSlot),
        after: capacityLimitLabel(next),
      });
    }
    maxWaiterPerSlot = next;
  }
  if (patch.maxArrivalsPerSlot !== undefined) {
    const next = strictCap(patch.maxArrivalsPerSlot);
    if (next === undefined) return null;
    if (next !== maxArrivalsPerSlot) {
      changes.push({
        field: "Capacity arrivals per slot",
        before: capacityLimitLabel(maxArrivalsPerSlot),
        after: capacityLimitLabel(next),
      });
    }
    maxArrivalsPerSlot = next;
  }
  if (patch.onlineSharePercent !== undefined) {
    if (!Number.isInteger(patch.onlineSharePercent) || patch.onlineSharePercent < 0 || patch.onlineSharePercent > 100) return null;
    if (patch.onlineSharePercent !== onlineSharePercent) {
      changes.push({
        field: "Capacity online share",
        before: `${onlineSharePercent}%`,
        after: `${patch.onlineSharePercent}%`,
      });
    }
    onlineSharePercent = patch.onlineSharePercent;
  }
  return {
    next: {
      ...current,
      capacity: {
        ...capacity,
        maxAdvisorAppointmentsPerHour,
        maxWaiterPerSlot,
        maxArrivalsPerSlot,
        onlineSharePercent,
      },
    },
    changes,
  };
}

export function applyTechWeekHours(
  current: SchedulingSettings,
  techId: string,
  weekday: number,
  hours: number | null,
): { ok: true; next: SchedulingSettings; before: string; after: string } | { ok: false; error: string } {
  if (typeof weekday !== "number" || !Number.isInteger(weekday) || weekday < 0 || weekday > 6) {
    return { ok: false, error: "That weekday is not a day of the week." };
  }
  const day = current.hours.find((row) => row.weekday === weekday);
  if (!day || day.closed) return { ok: false, error: "Open that day before setting technician hours." };
  const openMinutes = minutesOf(day.open);
  const closeMinutes = minutesOf(day.close);
  const openHours = closeMinutes > openMinutes ? Math.round(((closeMinutes - openMinutes) / 60) * 100) / 100 : 0;
  const capacity = current.capacity ?? defaultCapacity();
  const existing = capacity.techHours.find((row) => row.techId === techId);
  const previous = existing?.hours[weekday] ?? null;
  if (hours != null) {
    const problem = quarterHoursError(hours, openHours);
    if (problem) return { ok: false, error: problem };
  }
  const nextHours = hours;
  if (previous === nextHours) {
    return { ok: true, next: current, before: hourLabel(previous), after: hourLabel(nextHours) };
  }
  const week = existing ? [...existing.hours] : [null, null, null, null, null, null, null];
  week[weekday] = nextHours;
  const techHours = week.every((value) => value == null) ? capacity.techHours.filter((row) => row.techId !== techId) : [...capacity.techHours.filter((row) => row.techId !== techId), { techId, hours: week as TechWeekHours["hours"] }];
  return {
    ok: true,
    next: { ...current, capacity: { ...capacity, techHours } },
    before: hourLabel(previous),
    after: hourLabel(nextHours),
  };
}

export function quarterHoursError(hours: number, openHours: number): string | null {
  if (typeof hours !== "number" || !Number.isFinite(hours)) return "Enter a plain number. 0x10 and 1e2 are not accepted.";
  const steps = hours * 4;
  if (Math.abs(steps - Math.round(steps)) > 1e-6) return "Hours go in quarter-hour steps, such as 4 or 4.25.";
  if (hours < 0) return "Hours cannot be negative.";
  if (hours > openHours + 1e-6) return "Those hours are more than the shop is open that day.";
  return null;
}

export function parsePlainNumber(text: string): { ok: true; value: number | null } | { ok: false; error: string } {
  const trimmed = text.trim();
  if (trimmed === "") return { ok: true, value: null };
  if (!/^\d+(\.\d+)?$/.test(trimmed)) return { ok: false, error: "Enter a plain number. 0x10 and 1e2 are not accepted." };
  return { ok: true, value: Number(trimmed) };
}

export function applyTimeOffAdd(
  current: SchedulingSettings,
  input: { techId: string; date: string; start?: string; end?: string },
  id: string,
  today: string,
): { ok: true; next: SchedulingSettings; label: string } | { ok: false; error: string } {
  const error = timeOffAddError(current, input, today);
  if (error) return { ok: false, error };
  const row = oneTimeOff({ ...input, id, start: input.start ?? "", end: input.end ?? "" });
  if (!row) return { ok: false, error: "That time off is not valid." };
  const capacity = current.capacity ?? defaultCapacity();
  return {
    ok: true,
    next: { ...current, capacity: { ...capacity, timeOff: [...capacity.timeOff, row] } },
    label: timeOffLabel(row),
  };
}

export function timeOffAddError(current: SchedulingSettings, input: { techId: string; date: string; start?: string; end?: string }, today: string): string | null {
  const date = (input.date ?? "").trim();
  if (realDayError(date)) return realDayError(date);
  if (date < today) return "That date is already past.";
  const weekday = new Date(`${date}T12:00:00.000Z`).getUTCDay() as WeekdayIndex;
  const day = current.hours.find((row) => row.weekday === weekday);
  if (!day || day.closed || current.closedDates.includes(date)) return "The shop is closed that day.";
  const start = input.start ?? "";
  const end = input.end ?? "";
  const whole = start === "" && end === "";
  const capacity = current.capacity ?? defaultCapacity();
  const sameDay = capacity.timeOff.filter((row) => row.techId === input.techId && row.date === date);
  if (sameDay.some((row) => row.start === "" && row.end === "")) return "That technician is already off the whole day.";
  if (!whole && sameDay.some((row) => row.start === "" && row.end === "")) return "That technician is already off the whole day.";
  if (whole && sameDay.length > 0) return "That time off overlaps time already off.";
  if (!whole && sameDay.some((row) => row.start === start && row.end === end)) return "That time off is already on the schedule.";
  if (!whole) {
    if (!onSlotGrid(start) || !onSlotGrid(end)) return "Time off starts and ends on the half hour.";
    const open = minutesOf(day.open);
    const close = minutesOf(day.close);
    const startMin = minutesOf(start);
    const endMin = minutesOf(end);
    if (!(endMin > startMin)) return "That block has to end after it starts.";
    if (startMin < open || endMin > close) return "That block is outside shop hours.";
    if (sameDay.some((row) => rangesOverlap(startMin, endMin, minutesOf(row.start), minutesOf(row.end)))) return "That time off overlaps time already off.";
  }
  const future = capacity.timeOff.filter((row) => row.techId === input.techId && row.date >= today);
  if (future.length >= 366) return "That technician already has 366 future days off.";
  return null;
}

export function realDayError(iso: string): string | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) return "That date is not a real day.";
  const [year, month, day] = iso.split("-").map(Number);
  if (month < 1 || month > 12) return "That date is not a real day.";
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return "That date is not a real day.";
  return null;
}

export function applyTimeOffRemove(current: SchedulingSettings, id: string): { next: SchedulingSettings; label: string } | null {
  const capacity = current.capacity ?? defaultCapacity();
  const row = capacity.timeOff.find((item) => item.id === id);
  if (!row) return null;
  return {
    next: {
      ...current,
      capacity: { ...capacity, timeOff: capacity.timeOff.filter((item) => item.id !== id) },
    },
    label: timeOffLabel(row),
  };
}

export function clockWithZone(time: string) {
  const match = /^(\d{2}):(\d{2})$/.exec(time);
  if (!match) return time;
  const hour24 = Number(match[1]);
  const suffix = hour24 >= 12 ? "PM" : "AM";
  const hour = hour24 % 12 || 12;
  return `${hour}:${match[2]} ${suffix} PT`;
}

export function timeOffLabel(row: Pick<TechTimeOff, "date" | "start" | "end">) {
  if (!row.start && !row.end) return `${row.date} off`;
  return `${row.date} ${clockWithZone(row.start).replace(" PT", "")}–${clockWithZone(row.end)}`;
}

function minutesOf(time: string) {
  const match = /^(\d{2}):(\d{2})$/.exec(time);
  if (!match) return 0;
  return Number(match[1]) * 60 + Number(match[2]);
}

function onSlotGrid(time: string) {
  return /^([01]\d|2[0-3]):(00|30)$/.test(time);
}

function rangesOverlap(start: number, end: number, otherStart: number, otherEnd: number) {
  return start < otherEnd && end > otherStart;
}

function hourLabel(value: number | null) {
  return value == null ? "shop open hours" : String(value);
}

function cleanTechHours(value: unknown, hours: DayHours[] | undefined, notices: string[]): TechWeekHours[] {
  if (value == null) return [];
  if (!Array.isArray(value)) {
    notices.push("tech hours");
    return [];
  }
  const byTech = new Map<string, (number | null)[]>();
  for (const item of value) {
    if (!item || typeof item !== "object") {
      notices.push("tech hours");
      continue;
    }
    const row = item as Partial<TechWeekHours>;
    const techId = typeof row.techId === "string" ? row.techId.trim() : "";
    if (!techId || !Array.isArray(row.hours)) {
      notices.push("tech hours");
      continue;
    }
    const week = ([0, 1, 2, 3, 4, 5, 6] as const).map((index) => cleanStoredHours(row.hours?.[index], hours?.[index], notices));
    byTech.set(techId, week);
  }
  return [...byTech.entries()].filter(([, week]) => week.some((item) => item != null)).map(([techId, week]) => ({ techId, hours: week as TechWeekHours["hours"] }));
}

function cleanTimeOff(value: unknown, notices: string[]): TechTimeOff[] {
  if (value == null) return [];
  if (!Array.isArray(value)) {
    notices.push("time off");
    return [];
  }
  const rows: TechTimeOff[] = [];
  const ids = new Set<string>();
  const keys = new Set<string>();
  for (const item of value) {
    const row = oneTimeOff(item);
    if (!row) {
      if (item && typeof item === "object") notices.push("time off");
      continue;
    }
    if ("reason" in (item as object)) notices.push("time off");
    if (ids.has(row.id)) continue;
    const key = `${row.techId}|${row.date}|${row.start}|${row.end}`;
    if (keys.has(key)) continue;
    ids.add(row.id);
    keys.add(key);
    rows.push(row);
  }
  return rows;
}

function oneTimeOff(value: unknown): TechTimeOff | null {
  if (!value || typeof value !== "object") return null;
  const row = value as Partial<TechTimeOff>;
  const techId = typeof row.techId === "string" ? row.techId.trim() : "";
  const date = typeof row.date === "string" ? row.date.trim() : "";
  const id = typeof row.id === "string" ? row.id.trim() : "";
  if (!techId || !id || !ISO_DATE.test(date)) return null;
  const start = typeof row.start === "string" ? row.start : "";
  const end = typeof row.end === "string" ? row.end : "";
  if (start === "" && end === "") return { id, techId, date, start: "", end: "" };
  if (!TIME.test(start) || !TIME.test(end) || end <= start) return null;
  return { id, techId, date, start, end };
}

function cleanStoredHours(value: unknown, day: DayHours | undefined, notices: string[]): number | null {
  if (value == null || value === "") return null;
  if (typeof value !== "number" || !Number.isFinite(value)) {
    notices.push("tech hours");
    return 0;
  }
  const steps = value * 4;
  const open = day && !day.closed ? Math.max(0, (minutesOf(day.close) - minutesOf(day.open)) / 60) : 0;
  if (Math.abs(steps - Math.round(steps)) > 1e-6 || value < 0 || (day && value > open + 1e-6)) {
    notices.push("tech hours");
    return 0;
  }
  return value;
}

function readCap(value: unknown, present: boolean, notices: string[]): number | null {
  if (!present || value == null || value === "") return null;
  if (typeof value !== "number" || !Number.isInteger(value) || value < 0 || value > CAP_MAX) {
    notices.push("cap");
    return 0;
  }
  return value;
}

/** Undefined means the value is not a valid cap. Null is a valid "no limit". */
function strictCap(value: number | null): number | null | undefined {
  if (value == null) return null;
  if (typeof value !== "number" || !Number.isInteger(value) || value < 0 || value > CAP_MAX) return undefined;
  return value;
}

function readShare(value: unknown, present: boolean, notices: string[]): number {
  if (!present || value == null || value === "") return 100;
  if (typeof value !== "number" || !Number.isInteger(value) || value < 0 || value > 100) {
    notices.push("share");
    return 0;
  }
  return value;
}
