import { feeTotal } from "./format";
import { closeGaps } from "./metrics";
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
  if (order.status === "invoiced" || order.status === "booked") return null;
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
    order: { ...order, status: "invoiced", invoicedOn, stockApplied: true },
    parts: nextParts,
  };
}

export function reopenRepairOrder(order: RepairOrder, parts: PartSku[]): { order: RepairOrder; parts: PartSku[] } | null {
  if (order.status !== "invoiced") return null;
  const nextParts = order.stockApplied ? applyPartStock(parts, order, 1, order.invoicedOn ?? "") : parts;
  return {
    order: { ...order, status: "ready", invoicedOn: null, stockApplied: false },
    parts: nextParts,
  };
}

export function dropClosedHistory(history: ClosedRecord[], orderId: string) {
  return history.filter((row) => row.orderId !== orderId);
}
