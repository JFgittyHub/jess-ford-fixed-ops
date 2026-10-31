import { addDays, dayOfMonth, daysBetween, daysInMonth, monthKey, monthLabel, monthName, ordinal, paceRatio, todayIso, todayLabel } from "./clock";
import type { FeeLine } from "./types";

export { addDays, dayOfMonth, daysBetween, daysInMonth, monthKey, monthLabel, monthName, ordinal, paceRatio, todayIso as today, todayLabel };

export const DEFAULT_FEES: FeeLine[] = [
  { id: "shop", name: "Misc Shop Fee", amount: 8, basis: "percent", cap: 35 },
  { id: "hazmat", name: "Hazmat Fee", amount: 3.5, basis: "flat", cap: 0 },
  { id: "disposal", name: "Disposal Fee", amount: 4.5, basis: "flat", cap: 0 },
];

export function feeCharge(line: FeeLine, repair: number) {
  if (line.basis === "percent") {
    const raw = Math.max(0, repair) * (Math.max(0, Number(line.amount) || 0) / 100);
    const cap = Number(line.cap);
    const capped = Number.isFinite(cap) && cap > 0 ? Math.min(raw, cap) : raw;
    return Math.round(capped * 100) / 100;
  }
  return Math.round((Number(line.amount) || 0) * 100) / 100;
}

export const DEFAULT_TAX_RATE = 6.5;

export function salesTax(beforeTax: number, rate: number) {
  return Math.round(Math.max(0, beforeTax) * (Math.max(0, Number(rate) || 0) / 100) * 100) / 100;
}

export function feeTotal(fees?: FeeLine[] | null, repair = 0) {
  if (!Array.isArray(fees)) return 0;
  return Math.round(fees.reduce((sum, line) => sum + feeCharge(line, repair), 0) * 100) / 100;
}

export function snapHalfHour(time: string) {
  const [h, m] = time.split(":").map(Number);
  const total = Math.round(((h || 0) * 60 + (m || 0)) / 30) * 30;
  const mins = Math.max(7 * 60, Math.min(17 * 60 + 30, total));
  return `${String(Math.floor(mins / 60)).padStart(2, "0")}:${String(mins % 60).padStart(2, "0")}`;
}

export function clockTime(time: string) {
  const match = /^(\d{1,2}):(\d{2})/.exec(time.trim());
  if (!match) return time;
  const h24 = Number(match[1]);
  const minutes = Number(match[2]);
  if (!Number.isFinite(h24) || !Number.isFinite(minutes)) return time;
  const suffix = h24 >= 12 ? "PM" : "AM";
  const hour = h24 % 12 || 12;
  return `${hour}:${String(minutes).padStart(2, "0")} ${suffix}`;
}

export const PROMISE_TIMES = Array.from({ length: 24 }, (_, index) => {
  const mins = 7 * 60 + index * 30;
  return `${String(Math.floor(mins / 60)).padStart(2, "0")}:${String(mins % 60).padStart(2, "0")}`;
});

export function usd(n: number, cents = false) {
  const sign = n < 0 ? "-" : "";
  const abs = Math.abs(n);
  const fixed = cents ? abs.toFixed(2) : Math.round(abs).toString();
  const [whole, frac] = fixed.split(".");
  const withCommas = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return `${sign}$${frac ? `${withCommas}.${frac}` : withCommas}`;
}

export function pct(n: number, digits = 0) {
  if (!Number.isFinite(n)) return "—";
  return `${(n * 100).toFixed(digits)}%`;
}

export function num(n: number, digits = 1) {
  if (!Number.isFinite(n)) return "—";
  return n.toFixed(digits);
}

export function money2(n: number) {
  return Math.round(n * 100) / 100;
}

export function daySpan(iso: string, from = todayIso()) {
  if (!iso) return 0;
  return daysBetween(iso, from);
}

export function shortDate(iso: string) {
  const [, m, d] = iso.split("-");
  return `${Number(m)}/${Number(d)}`;
}

/** A flagged punch stops at the repair order's close time, or at its start when there is no close time. */
export function reviewCap(row: { startedAt: string; endedAt: string | null; needsReview?: boolean }, closedAt?: string | null): string | null {
  if (row.endedAt || !row.needsReview) return null;
  if (closedAt && Number.isFinite(Date.parse(closedAt)) && Date.parse(closedAt) >= Date.parse(row.startedAt)) return closedAt;
  return row.startedAt;
}

export function punchHours(startedAt: string, endedAt: string | null, now = Date.now(), capAt?: string | null) {
  const start = new Date(startedAt).getTime();
  let end = endedAt ? new Date(endedAt).getTime() : now;
  if (capAt) {
    const cap = new Date(capAt).getTime();
    if (Number.isFinite(cap)) end = Math.min(end, cap);
  }
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return 0;
  return (end - start) / 3_600_000;
}

export function formatDuration(hours: number) {
  const total = Math.max(0, Math.round(hours * 60));
  const h = Math.floor(total / 60);
  const m = total % 60;
  if (h <= 0) return `${m}m`;
  return `${h}h ${m}m`;
}

export function localStamp(date = new Date()) {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${p(date.getMonth() + 1)}-${p(date.getDate())}T${p(date.getHours())}:${p(date.getMinutes())}:${p(date.getSeconds())}`;
}

export function padDay(day: number, month = monthKey()) {
  const [year, monthNum] = month.split("-").map(Number);
  const dim = new Date(Date.UTC(year, monthNum, 0)).getUTCDate();
  const clamped = Math.min(dim, Math.max(1, Math.trunc(day) || 1));
  return `${month}-${String(clamped).padStart(2, "0")}`;
}

export const PAY_LABEL = {
  cp: "Customer",
  warranty: "Warranty",
  internal: "Internal",
} as const;

export const STATUS_LABEL = {
  open: "Open",
  working: "In bay",
  parts: "Waiting parts",
  ready: "Ready",
  booked: "Booked",
  closed: "Closed",
} as const;

/** Badge label. Work steps stay Open. A no-work close is named on its own. */
export function roStatusLabel(order: { status: string; closeType?: string | null }) {
  if (order.status === "closed" && order.closeType === "no_work") return "Closed — no work ($0)";
  if (order.status === "closed") return "Closed";
  if (order.status === "booked") return "Booked";
  if (order.status === "open" || order.status === "working" || order.status === "parts" || order.status === "ready") return "Open";
  return "Open";
}

export const BAY_LABEL = {
  lot: "On the lot",
  dispatch: "Waiting dispatch",
  bay: "In bay",
  working: "Tech on it",
  parts: "Waiting parts",
  qc: "Quality check",
  wash: "Wash",
  ready: "Ready for pickup",
} as const;

export function bayFromStatus(status: string) {
  if (status === "working") return "working" as const;
  if (status === "parts") return "parts" as const;
  if (status === "ready" || status === "booked" || status === "closed") return "ready" as const;
  return "dispatch" as const;
}

export const SKILL_LABEL = {
  master: "Master",
  a: "A tech",
  b: "B tech",
  diesel: "Diesel",
  express: "Express",
  quick: "Express",
} as const;
