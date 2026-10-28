import { money2 } from "./format";
import type { BookingWindow, DayHours, OnlineService, SchedulingSettings, StoreId, TransportOption, WeekdayIndex } from "./types";

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
    { id: "waiter", name: "Waiter" },
    { id: "drop", name: "Drop-off" },
  ];
}

/** Starting scheduling setup for one store. No prices. */
export function defaultScheduling(store: StoreId = "grand-coulee"): SchedulingSettings {
  if (store === "pullman") {
    return {
      hours: [
        day(0, "08:00", "17:00", true),
        day(1, "07:00", "18:00"),
        day(2, "07:00", "18:00"),
        day(3, "07:00", "18:00"),
        day(4, "07:00", "18:00"),
        day(5, "07:00", "18:00"),
        day(6, "08:00", "16:00"),
      ],
      closedDates: ["2026-11-27", "2026-12-24"],
      bookingWindow: { daysAhead: 14, minLeadHours: 0 },
      onlineMenu: menu([
        ["pl-oil", "Oil and filter", 0.6],
        ["pl-align", "Four-wheel alignment", 1.2],
        ["pl-cabin", "Cabin filter", 0.4],
      ]),
      transportOptions: transports(),
    };
  }
  return {
    hours: [
      day(0, "08:00", "17:00", true),
      day(1, "07:30", "17:30"),
      day(2, "07:30", "17:30"),
      day(3, "07:30", "17:30"),
      day(4, "07:30", "17:30"),
      day(5, "07:30", "17:30"),
      day(6, "08:00", "13:00"),
    ],
    closedDates: ["2026-11-26", "2026-12-25"],
    bookingWindow: { daysAhead: 21, minLeadHours: 0 },
    onlineMenu: menu([
      ["gc-oil", "Oil and filter", 0.5],
      ["gc-rotate", "Tire rotation", 0.3],
      ["gc-brakes", "Brake inspection", 0.4],
    ]),
    transportOptions: transports(),
  };
}

export function normalizeScheduling(value: unknown, store: StoreId = "grand-coulee"): SchedulingSettings {
  const fallback = defaultScheduling(store);
  if (!value || typeof value !== "object") return fallback;
  const raw = value as Partial<SchedulingSettings>;
  const hours = Array.isArray(raw.hours) ? raw.hours : [];
  return {
    hours: ([0, 1, 2, 3, 4, 5, 6] as WeekdayIndex[]).map((weekday) => {
      const row = hours.find((item) => item && item.weekday === weekday);
      const base = fallback.hours[weekday];
      return {
        weekday,
        closed: row?.closed === true,
        open: typeof row?.open === "string" && TIME.test(row.open) ? row.open : base.open,
        close: typeof row?.close === "string" && TIME.test(row.close) ? row.close : base.close,
      };
    }),
    closedDates: Array.isArray(raw.closedDates)
      ? [...new Set(raw.closedDates.filter((iso): iso is string => typeof iso === "string" && ISO_DATE.test(iso)))].sort()
      : [...fallback.closedDates],
    bookingWindow: normalizeWindow(raw.bookingWindow, fallback.bookingWindow),
    onlineMenu: Array.isArray(raw.onlineMenu)
      ? raw.onlineMenu.flatMap((item, index) => {
          const service = cleanService(item, `svc-${index + 1}`);
          return service ? [service] : [];
        })
      : fallback.onlineMenu.map((item) => ({ ...item })),
    transportOptions: transportList(raw.transportOptions, fallback.transportOptions),
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
  const name = typeof row.name === "string" ? row.name.trim() : "";
  const laborHours = money2(Number(row.laborHours));
  if (!name || !Number.isFinite(laborHours) || laborHours <= 0) return null;
  const id = typeof row.id === "string" && row.id.trim() ? row.id.trim() : fallbackId;
  return { id, name, laborHours };
}

function cleanTransport(value: unknown, fallbackId: string): TransportOption | null {
  if (!value || typeof value !== "object") return null;
  const row = value as Partial<TransportOption>;
  const name = typeof row.name === "string" ? row.name.trim() : "";
  if (!name) return null;
  const id = typeof row.id === "string" && row.id.trim() ? row.id.trim() : fallbackId;
  return { id, name };
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
  return { ...current, bookingWindow: normalizeWindow({ ...current.bookingWindow, ...patch }, current.bookingWindow) };
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
