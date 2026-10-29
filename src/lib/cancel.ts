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

export function cancelReasonLabel(reason: CancelReason): string {
  return CANCEL_REASONS.find((row) => row.id === reason)?.label ?? reason;
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

export function cancellationLine(row: AppointmentCancel) {
  const reason = cancelReasonLabel(row.reason);
  const note = row.note.trim() ? ` — ${row.note.trim()}` : "";
  return `${reason}${note} · ${row.who} · ${shopWhen(row.at)}`;
}

export function cancelInputError(reason: string, note: string): string | null {
  if (!CANCEL_REASONS.some((row) => row.id === reason)) return "Choose a reason.";
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
  return history[history.length - 1] ?? null;
}

export function appointmentsOnBoard<T extends { status: ApptStatus }>(rows: T[]): T[] {
  return rows.filter((row) => row.status !== "cancelled");
}

export function cancelledOnDay<T extends { status: ApptStatus; date: string }>(rows: T[], day: string): T[] {
  return rows.filter((row) => row.status === "cancelled" && row.date === day);
}

const REASONS = new Set<string>(CANCEL_REASONS.map((row) => row.id));

export function normalizeCancelHistory(value: unknown): AppointmentCancel[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const rows: AppointmentCancel[] = [];
  for (const item of value) {
    if (!item || typeof item !== "object") continue;
    const row = item as Partial<AppointmentCancel>;
    if (typeof row.reason !== "string" || !REASONS.has(row.reason)) continue;
    if (typeof row.who !== "string" || typeof row.at !== "string") continue;
    rows.push({
      reason: row.reason as CancelReason,
      note: typeof row.note === "string" ? row.note : "",
      who: row.who,
      whoId: typeof row.whoId === "string" ? row.whoId : "",
      at: row.at,
    });
  }
  return rows.length > 0 ? rows : undefined;
}
