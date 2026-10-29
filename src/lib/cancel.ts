import type { AppointmentCancel, ApptStatus, CancelReason } from "./types";

export const CANCEL_REASONS: { id: CancelReason; label: string }[] = [
  { id: "customer-request", label: "Customer request" },
  { id: "rescheduled", label: "Rescheduled" },
  { id: "vehicle-gone", label: "Vehicle sold or gone" },
  { id: "duplicate", label: "Duplicate or entered in error" },
  { id: "other", label: "Other" },
];

export type DeskActor = "advisor" | "service-manager" | "technician" | "customer";

/**
 * The schedule desk is where an advisor or the service manager cancels.
 * Technicians and online customers cannot. The roster stores advisors and
 * technicians. Working as an advisor is how the service manager acts today.
 */
export function mayCancelAppointment(actor: DeskActor): boolean {
  return actor === "advisor" || actor === "service-manager";
}

export function deskActor(state: {
  workingAsId: string;
  advisors: { id: string }[];
  techs: { id: string }[];
}): DeskActor {
  if (state.advisors.some((row) => row.id === state.workingAsId)) return "advisor";
  if (state.techs.some((row) => row.id === state.workingAsId)) return "technician";
  return "customer";
}

export const CANCEL_NOTE_MAX = 500;
export const CANCELLED_LOCKED = "This appointment is cancelled. Reinstate it to change the date, customer, vehicle, or concern.";
export const RO_CANCEL_BLOCKED = "This visit already has a repair order. Close or void the RO first.";
export const MISSING_RO_CANCEL_BLOCKED = "This visit is linked to a repair order that isn't on this store. The visit stays until that link is checked.";
export const ARRIVED_CANCEL_CONFIRM = "The customer is here — cancel anyway?";

/** An invoiced repair order is closed. A missing order is handled separately. Anything still on the open desk blocks. */
export function openRepairOrderBlocksCancel(order: { status: string } | undefined): boolean {
  if (!order) return false;
  return order.status !== "invoiced";
}

/** No repair-order link, or an invoiced one, does not block. A missing id blocks. An open order uses the existing close-or-void message. */
export function repairOrderCancelBlock(orderId: string | null | undefined, order: { status: string } | undefined): string | null {
  if (!orderId) return null;
  if (!order) return MISSING_RO_CANCEL_BLOCKED;
  if (openRepairOrderBlocksCancel(order)) return RO_CANCEL_BLOCKED;
  return null;
}

export function cancelReasonLabel(reason: string): string {
  return CANCEL_REASONS.find((row) => row.id === reason)?.label ?? "Other";
}

const SHOP_TZ = "America/Los_Angeles";

export function shopWhen(iso: string) {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return new Intl.DateTimeFormat("en-US", {
    timeZone: SHOP_TZ,
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(date);
}

function historyWho(who: string | undefined) {
  const name = who?.trim();
  return name || "Unknown";
}

function historyWhen(at: string | undefined) {
  if (!at?.trim()) return "Unknown";
  return shopWhen(at);
}

export function cancellationLine(row: AppointmentCancel) {
  const who = historyWho(row.who);
  const when = historyWhen(row.at);
  if (row.action === "reinstate") return `Reinstated · ${who} · ${when}`;
  const reason = cancelReasonLabel(row.reason);
  const note = row.note.trim() ? ` — ${row.note.trim()}` : "";
  const cleared = row.priorStatus === "no_show" ? " No-show flag cleared." : "";
  return `${reason}${note} · ${who} · ${when}${cleared}`;
}

export function cancelInputError(reason: string, note: string): string | null {
  if (!CANCEL_REASONS.some((row) => row.id === reason)) return "Choose a reason.";
  if (note.trim().length > CANCEL_NOTE_MAX) return "Keep the note to 500 characters.";
  if (reason === "other" && !note.trim()) return "Add a note for Other.";
  return null;
}

export function appointmentStatusLabel(status: ApptStatus): string {
  switch (status) {
    case "no_show":
      return "No-show";
    case "in_shop":
      return "In shop";
    case "arrived":
      return "Arrived";
    case "cancelled":
      return "Cancelled";
    case "scheduled":
      return "Scheduled";
  }
}

export function activeCancellation(row: { status: ApptStatus; cancelHistory?: AppointmentCancel[] }): AppointmentCancel | null {
  if (row.status !== "cancelled") return null;
  const history = row.cancelHistory ?? [];
  for (let index = history.length - 1; index >= 0; index -= 1) {
    if (history[index]?.action !== "reinstate") return history[index] ?? null;
  }
  return null;
}

export function appointmentsOnBoard<T extends { status: ApptStatus }>(rows: T[]): T[] {
  return rows.filter((row) => row.status !== "cancelled");
}

export function cancelledOnDay<T extends { status: ApptStatus; date: string }>(rows: T[], day: string): T[] {
  return rows.filter((row) => row.status === "cancelled" && row.date === day);
}

const PRIOR_STATUSES = new Set<string>(["scheduled", "arrived", "no_show", "in_shop", "cancelled"]);

export function normalizeCancelHistory(value: unknown): AppointmentCancel[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const rows: AppointmentCancel[] = [];
  for (const item of value) {
    if (!item || typeof item !== "object") continue;
    const row = item as Partial<AppointmentCancel>;
    const action = row.action === "reinstate" || row.action === "cancel" ? row.action : undefined;
    if (action !== "reinstate" && typeof row.reason !== "string") continue;
    const priorStatus = typeof row.priorStatus === "string" && PRIOR_STATUSES.has(row.priorStatus) ? row.priorStatus as ApptStatus : undefined;
    rows.push({
      action,
      reason: typeof row.reason === "string" ? row.reason : "",
      note: typeof row.note === "string" ? row.note.trim().slice(0, CANCEL_NOTE_MAX) : "",
      who: typeof row.who === "string" && row.who.trim() ? row.who : "Unknown",
      whoId: typeof row.whoId === "string" ? row.whoId : "",
      at: typeof row.at === "string" ? row.at : "",
      priorStatus,
    });
  }
  return rows.length > 0 ? rows : undefined;
}
