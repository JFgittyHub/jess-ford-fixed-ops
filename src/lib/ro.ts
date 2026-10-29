import { feeTotal } from "./format";
import { closeGaps, orderMoney } from "./metrics";
import type { Advisor, ClosedRecord, PartSku, RepairOrder, Tech, TimeLog } from "./types";
import { normalizeWa, waLimit } from "./wa";

/** Cent tolerance so a ticket that rounds onto the cap still books. */
export const AUTH_TOLERANCE = 0.009;

export function laborAmount(order: Pick<RepairOrder, "labor">) {
  return order.labor.reduce((sum, line) => sum + line.hours * line.rate, 0);
}

export function partsAmount(order: Pick<RepairOrder, "parts">) {
  return order.parts.reduce((sum, line) => sum + line.qty * line.price, 0);
}

export function partsCostAmount(order: Pick<RepairOrder, "parts">) {
  return order.parts.reduce((sum, line) => sum + line.qty * line.cost, 0);
}

export function repairAmount(order: Pick<RepairOrder, "labor" | "parts">) {
  return laborAmount(order) + partsAmount(order);
}

/** Labor, parts, and fees. Sales tax is outside the RCW 46.71 authorization. */
export function ticketBeforeTax(order: Pick<RepairOrder, "labor" | "parts" | "fees">) {
  const repair = repairAmount(order);
  return repair + feeTotal(order.fees, repair);
}

export function withinAuthorization(order: RepairOrder, next = ticketBeforeTax(order)) {
  const limit = waLimit(normalizeWa(order.wa));
  return limit !== null && next <= limit + AUTH_TOLERANCE;
}

/**
 * Move on-hand by the lines tied to each SKU.
 * Direction -1 is an invoice (also stamps last sale). Direction +1 puts the
 * same quantity back on reopen. On-hand may go negative when the ticket sells
 * more than the bin had; flooring at zero made reopen put parts back that
 * were never taken.
 */
export function applyPartStock(parts: PartSku[], order: RepairOrder, direction: 1 | -1, soldOn: string): PartSku[] {
  return parts.map((part) => {
    const qty = order.parts.filter((line) => line.partId === part.id).reduce((sum, line) => sum + line.qty, 0);
    if (!qty) return part;
    return {
      ...part,
      onHand: part.onHand + direction * qty,
      lastSale: direction === -1 ? soldOn : part.lastSale,
    };
  });
}

export function bookRepairOrder(order: RepairOrder): RepairOrder | null {
  if (order.status === "invoiced" || order.status === "booked" || order.status === "closed") return null;
  if (!withinAuthorization(order)) return null;
  return { ...order, status: "booked" };
}

export function unbookRepairOrder(order: RepairOrder): RepairOrder | null {
  if (order.status !== "booked") return null;
  return { ...order, status: "ready" };
}

export function invoiceRepairOrder(
  order: RepairOrder,
  parts: PartSku[],
  techs: Tech[],
  advisors: Advisor[],
  logs: TimeLog[],
  invoicedOn: string,
): { order: RepairOrder; parts: PartSku[] } | null {
  if (order.status !== "booked") return null;
  if (!withinAuthorization(order)) return null;
  if (closeGaps(order, techs, advisors, logs).length > 0) return null;
  const nextParts = order.stockApplied ? parts : applyPartStock(parts, order, -1, invoicedOn);
  return {
    order: { ...order, status: "invoiced", closeType: "invoiced", invoicedOn, stockApplied: true },
    parts: nextParts,
  };
}

export function reopenRepairOrder(order: RepairOrder, parts: PartSku[]): { order: RepairOrder; parts: PartSku[] } | null {
  if (order.status !== "invoiced") return null;
  const nextParts = order.stockApplied ? applyPartStock(parts, order, 1, order.invoicedOn ?? "") : parts;
  return {
    order: {
      ...order,
      status: "ready",
      closeType: null,
      closeNote: "",
      closedBy: "",
      closedById: "",
      closedAt: null,
      invoicedOn: null,
      stockApplied: false,
    },
    parts: nextParts,
  };
}

/** Cent tolerance for a $0 ticket. */
const CENT = 0.009;

export const NO_WORK_BLOCKED = "Work or charges are on this RO — close it with an accurate invoice.";
export const NO_WORK_NOTE_MAX = 500;
export const NO_WORK_NOTE_REQUIRED = "Add a note explaining why no work was done.";
export const NO_WORK_NOTE_LONG = "Keep the note to 500 characters.";
export const NO_WORK_NOT_OPEN = "Only an open or booked repair order can close with no work.";

/**
 * Fees copied onto every open ticket from shop settings. A no-work close drops
 * them so an abandoned RO is stored at $0. Any other fee is a charge.
 */
const STANDARD_FEE_IDS = new Set(["shop", "hazmat", "disposal"]);

const NO_WORK_STATUSES = new Set(["open", "working", "parts", "ready", "booked"]);

function nonzero(value: number) {
  return Math.abs(value) > CENT;
}

/** Parts, labor dollars, flagged hours, clock punches, payments, or a non-standard fee. */
export function orderHasNoWorkCharges(order: RepairOrder, logs: TimeLog[]): boolean {
  if (order.parts.length > 0) return true;
  if (order.labor.some((line) => nonzero(line.hours * line.rate))) return true;
  if (order.labor.some((line) => line.hours > CENT)) return true;
  if (logs.some((log) => log.orderId === order.id)) return true;
  if ((order.payments ?? []).some((pay) => nonzero(pay.amount))) return true;
  const extraFees = (order.fees ?? []).filter((fee) => !STANDARD_FEE_IDS.has(fee.id));
  return nonzero(orderMoney({ ...order, fees: extraFees }).total);
}

export function noWorkCloseError(order: RepairOrder, logs: TimeLog[], note: string): string | null {
  if (!NO_WORK_STATUSES.has(order.status)) return NO_WORK_NOT_OPEN;
  if (orderHasNoWorkCharges(order, logs)) return NO_WORK_BLOCKED;
  const trimmed = note.trim();
  if (!trimmed) return NO_WORK_NOTE_REQUIRED;
  if (trimmed.length > NO_WORK_NOTE_MAX) return NO_WORK_NOTE_LONG;
  return null;
}

/** Status becomes Closed. Fees are cleared so the stored total is $0. The RO number stays. */
export function closeRepairOrderWithNoWork(
  order: RepairOrder,
  note: string,
  who: { id: string; name: string },
  closedAt: string,
  closedOn: string,
): RepairOrder {
  return {
    ...order,
    status: "closed",
    closeType: "no_work",
    closeNote: note.trim().slice(0, NO_WORK_NOTE_MAX),
    closedBy: who.name,
    closedById: who.id,
    closedAt,
    invoicedOn: closedOn,
    fees: [],
    stockApplied: false,
  };
}

export function dropClosedHistory(history: ClosedRecord[], orderId: string) {
  return history.filter((row) => row.orderId !== orderId);
}
