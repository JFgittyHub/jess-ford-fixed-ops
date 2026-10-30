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

/** Same desk roles that cancel. Working as an advisor is how the service manager acts today. */
export function mayCloseRepairOrder(actor: DeskActor): boolean {
  return actor === "advisor" || actor === "service-manager";
}

export function deskActor(state: {
  workingAsId: string;
  advisors: { id: string; role?: string }[];
  techs: { id: string }[];
}): DeskActor {
  const advisor = state.advisors.find((row) => row.id === state.workingAsId);
  if (advisor?.role === "service-manager") return "service-manager";
  if (advisor) return "advisor";
  if (state.techs.some((row) => row.id === state.workingAsId)) return "technician";
  return "customer";
}

/** Closing is final. No role, including a service manager, may change a closed repair order. */
export function mayAmendClosedOrder(_actor: DeskActor): boolean {
  return false;
}

export const CANCEL_NOTE_MAX = 500;
export const CANCELLED_LOCKED = "This appointment is cancelled. Reinstate it to change the date, customer, vehicle, or concern.";
export const MISSING_RO_CANCEL_BLOCKED = "This visit is linked to a repair order that isn't on this store. The visit stays until that link is checked.";
export const ARRIVED_CANCEL_CONFIRM = "The customer is here — cancel anyway?";

export function openRoCancelMessage(number: number | string) {
  return `RO ${number} is still open. Close the RO first.`;
}

/** Booked is not closed. The block keeps the RO number, the close instruction, and does not call the ticket still open. */
export function bookedRoCancelMessage(number: number | string) {
  return `Finish the work on RO ${number} and close it with an accurate invoice. Close the RO first.`;
}

export function closedRoReinstateMessage(number: number | string) {
  return `This visit's RO #${number} is closed. Book a new appointment instead.`;
}

/** Only a Closed repair order allows cancel. Booked and every other status still block. */
export function openRepairOrderBlocksCancel(order: { status: string } | undefined): boolean {
  if (!order) return false;
  return order.status !== "closed";
}

/** No repair-order link does not block. A missing id blocks. Anything except Closed names the RO and says to close it first. */
export function repairOrderCancelBlock(orderId: string | null | undefined, order: { status: string; number?: number } | undefined): string | null {
  if (!orderId) return null;
  if (!order) return MISSING_RO_CANCEL_BLOCKED;
  if (!openRepairOrderBlocksCancel(order)) return null;
  if (order.status === "booked") {
    return order.number == null
      ? "Finish the work and close it with an accurate invoice. Close the RO first."
      : bookedRoCancelMessage(order.number);
  }
  return order.number == null ? "This repair order is still open. Close the RO first." : openRoCancelMessage(order.number);
}

/** A visit cannot return to the board while it still points at a Closed repair order. */
export function repairOrderReinstateBlock(order: { status: string; number?: number } | undefined): string | null {
  if (!order || order.status !== "closed") return null;
  return order.number == null
    ? "This visit's repair order is closed. Book a new appointment instead."
    : closedRoReinstateMessage(order.number);
}

export function cancelReasonLabel(reason: string): string {
  return CANCEL_REASONS.find((row) => row.id === reason)?.label ?? "Other";
}

const SHOP_TZ = "America/Los_Angeles";

/** Empty names are shown as Unknown. The word is not written back onto the repair order. */
export function displayRecordedName(value?: string | null) {
  const name = value?.trim() ?? "";
  return name ? name : "Unknown";
}

export function displayRecordedWhen(value?: string | null) {
  if (!value?.trim()) return "Unknown";
  return shopWhen(value);
}

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
      who: typeof row.who === "string" && row.who.trim() && row.who.trim().toLowerCase() !== "unknown" ? row.who.trim() : "",
      whoId: typeof row.whoId === "string" ? row.whoId : "",
      at: typeof row.at === "string" ? row.at : "",
      priorStatus,
    });
  }
  return rows.length > 0 ? rows : undefined;
}
