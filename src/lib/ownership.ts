import { displayRecordedWhen } from "./cancel";
import { openedInstant } from "./mileage";
import type { Customer, OwnershipSpan, RepairOrder, Vehicle } from "./types";
import { normalizeVin } from "./vin";

/** A transfer reason is required, trimmed, and kept to 500 characters. */
export function transferReason(value: unknown): { text: string } | { error: string } {
  if (typeof value !== "string") return { error: "Add a reason for the transfer." };
  const text = value.trim().replace(/\s+/g, " ");
  if (text.length < 10) return { error: "Add a reason for the transfer." };
  if (text.length > 500) return { error: "Keep the reason to 500 characters." };
  return { text };
}

export function firstOwnership(customerId: string, at: string, who: { id: string; name: string } | null): OwnershipSpan {
  return { customerId, startedAt: at, endedAt: null, who: who?.name ?? "", whoId: who?.id ?? "", reason: "" };
}

/** Close the open span and append the new owner. Existing span text is copied, not rewritten. */
export function transferOwnership(
  vehicle: Vehicle,
  nextCustomerId: string,
  at: string,
  who: { id: string; name: string } | null,
  reason: string,
  originalStart: string,
): Vehicle {
  const spans = vehicle.ownership && vehicle.ownership.length > 0
    ? vehicle.ownership.map((span) => ({ ...span }))
    : [firstOwnership(vehicle.customerId, originalStart, null)];
  const openIndex = spans.findIndex((span) => !span.endedAt);
  if (openIndex >= 0 && spans[openIndex].customerId === nextCustomerId) {
    return { ...vehicle, customerId: nextCustomerId, ownership: spans };
  }
  if (openIndex >= 0) spans[openIndex] = { ...spans[openIndex], endedAt: at };
  spans.push({ customerId: nextCustomerId, startedAt: at, endedAt: null, who: who?.name ?? "", whoId: who?.id ?? "", reason });
  return { ...vehicle, customerId: nextCustomerId, ownership: spans };
}

export function earliestVisitStart(orders: { vehicleId: string; openedAt?: string | null; openedOn?: string }[], vehicleId: string, fallback: string): string {
  let best = "";
  for (const order of orders) {
    if (order.vehicleId !== vehicleId) continue;
    const stamp = order.openedAt?.trim() || (order.openedOn ? `${order.openedOn}T16:00:00.000Z` : "");
    if (!stamp || Number.isNaN(Date.parse(stamp))) continue;
    if (!best || Date.parse(stamp) < Date.parse(best)) best = stamp;
  }
  return best || fallback;
}

function ownerName(order: RepairOrder, customers: Pick<Customer, "id" | "name">[]): string {
  if (order.status === "closed" && order.closeSnapshot?.customerName?.trim()) return order.closeSnapshot.customerName.trim();
  return customers.find((row) => row.id === order.customerId)?.name ?? "Unknown owner";
}

export function ordersOnVin(orders: RepairOrder[], vehicles: Vehicle[], vin: string, vehicleId: string): RepairOrder[] {
  const key = normalizeVin(vin);
  const ids = new Set(vehicles.filter((row) => key && normalizeVin(row.vin) === key).map((row) => row.id));
  ids.add(vehicleId);
  const seen = new Set<string>();
  const rows: RepairOrder[] = [];
  for (const order of orders) {
    const snapVin = normalizeVin(order.closeSnapshot?.vin ?? "");
    if (!ids.has(order.vehicleId) && snapVin !== key) continue;
    if (seen.has(order.id)) continue;
    seen.add(order.id);
    rows.push(order);
  }
  return rows.sort((a, b) => {
    const delta = openedInstant(b) - openedInstant(a);
    if (delta !== 0) return delta;
    return b.number - a.number;
  });
}

export type VehicleHistoryEntry =
  | { kind: "divider"; text: string }
  | { kind: "order"; order: RepairOrder; ownerName: string };

/** Newest first. A transfer divider names the new owner. Each repair order names the owner at that visit. */
export function vehicleHistoryEntries(orders: RepairOrder[], vehicle: Vehicle, customers: Pick<Customer, "id" | "name">[], vehicles: Vehicle[]): VehicleHistoryEntry[] {
  const spans = [...(vehicle.ownership ?? [])].sort((a, b) => Date.parse(a.startedAt) - Date.parse(b.startedAt));
  const firstStart = spans[0]?.startedAt ?? "";
  const lines: VehicleHistoryEntry[] = [];
  let shown = "";
  for (const order of ordersOnVin(orders, vehicles, vehicle.vin, vehicle.id)) {
    const owner = ownerName(order, customers);
    const instant = openedInstant(order);
    const span = spans.find((row) => {
      const start = Date.parse(row.startedAt);
      const end = row.endedAt ? Date.parse(row.endedAt) : Number.POSITIVE_INFINITY;
      return Number.isFinite(start) && instant >= start && instant < end;
    });
    const key = span ? `${span.customerId}:${span.startedAt}` : owner;
    if (key !== shown) {
      if (span && span.startedAt !== firstStart) {
        const named = customers.find((row) => row.id === span.customerId)?.name ?? owner;
        lines.push({ kind: "divider", text: `New owner: ${named}, since ${displayRecordedWhen(span.startedAt)}` });
      }
      shown = key;
    }
    lines.push({ kind: "order", order, ownerName: owner });
  }
  return lines;
}

/** Customer copy of this repair order only. A closed ticket uses its snapshot. Previous owners are not included. */
export function customerCopyIdentity(
  order: Pick<RepairOrder, "status" | "closeSnapshot">,
  customer: Pick<Customer, "name" | "phone"> | undefined,
): { name: string; phone: string } {
  if (order.status === "closed") {
    return {
      name: order.closeSnapshot?.customerName?.trim() || "—",
      phone: order.closeSnapshot?.phone ?? "",
    };
  }
  return { name: customer?.name?.trim() || "—", phone: customer?.phone ?? "" };
}
