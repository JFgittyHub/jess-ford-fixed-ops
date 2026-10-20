/**
 * Shop calendar for Jess Ford (Grand Coulee and Pullman, Pacific Time).
 *
 * `pinClock` freezes the instant so tests and the demo seed can run on a
 * chosen day. The app reads `today()` at use time, not a baked-in date.
 */

const SHOP_TZ = "America/Los_Angeles";

let pinned: Date | null = null;

export function pinClock(value: Date | string | null) {
  if (value === null) {
    pinned = null;
    return;
  }
  const next = typeof value === "string" ? new Date(value) : new Date(value.getTime());
  if (Number.isNaN(next.getTime())) throw new Error(`Invalid clock pin: ${String(value)}`);
  pinned = next;
}

export function resetClock() {
  pinned = null;
}

export function now(): Date {
  return pinned ? new Date(pinned.getTime()) : new Date();
}

function shopParts(date: Date) {
  const map: Record<string, string> = {};
  for (const part of new Intl.DateTimeFormat("en-US", {
    timeZone: SHOP_TZ,
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
  }).formatToParts(date)) {
    if (part.type !== "literal") map[part.type] = part.value;
  }
  const numeric: Record<string, string> = {};
  for (const part of new Intl.DateTimeFormat("en-US", {
    timeZone: SHOP_TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date)) {
    if (part.type !== "literal") numeric[part.type] = part.value;
  }
  return {
    year: numeric.year ?? "",
    month: numeric.month ?? "",
    day: numeric.day ?? "",
    monthName: map.month ?? "",
    weekday: map.weekday ?? "",
  };
}

export function todayIso(date = now()): string {
  const parts = shopParts(date);
  return `${parts.year}-${parts.month}-${parts.day}`;
}

export function monthKey(date = now()): string {
  return todayIso(date).slice(0, 7);
}

export function dayOfMonth(date = now()): number {
  return Number(todayIso(date).slice(8, 10));
}

export function daysInMonth(date = now()): number {
  const [year, month] = todayIso(date).split("-").map(Number);
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

/** "Monday, October 19" in the shop's timezone. */
export function todayLabel(date = now()): string {
  const parts = shopParts(date);
  return `${parts.weekday}, ${parts.monthName} ${Number(parts.day)}`;
}

/** "October 2026" */
export function monthLabel(date = now()): string {
  const parts = shopParts(date);
  return `${parts.monthName} ${parts.year}`;
}

export function monthName(date = now()): string {
  return shopParts(date).monthName;
}

export function ordinal(day: number) {
  const mod100 = day % 100;
  if (mod100 >= 11 && mod100 <= 13) return `${day}th`;
  switch (day % 10) {
    case 1:
      return `${day}st`;
    case 2:
      return `${day}nd`;
    case 3:
      return `${day}rd`;
    default:
      return `${day}th`;
  }
}

export function paceRatio(date = now()) {
  return dayOfMonth(date) / daysInMonth(date);
}

export function daysBetween(fromIso: string, toIso: string) {
  const [y, m, d] = fromIso.split("-").map(Number);
  const [Y, M, D] = toIso.split("-").map(Number);
  return Math.round((Date.UTC(Y, M - 1, D) - Date.UTC(y, m - 1, d)) / 86400000);
}

export function addDays(iso: string, delta: number) {
  const [y, m, d] = iso.split("-").map(Number);
  const utc = new Date(Date.UTC(y, m - 1, d + delta));
  return utc.toISOString().slice(0, 10);
}

/**
 * A local Date on the shop's calendar day. Scorecard math uses local
 * `getDate()` / `getMonth()`, so this keeps that math on the dealership day.
 */
export function shopTodayDate(date = now()): Date {
  const [y, m, d] = todayIso(date).split("-").map(Number);
  return new Date(y, m - 1, d, 12, 0, 0, 0);
}
