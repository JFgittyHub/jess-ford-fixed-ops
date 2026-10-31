import { displayRecordedWhen } from "./cancel";
import { openedInstant } from "./mileage";
import type { Customer, OwnershipSpan, RepairOrder, Vehicle } from "./types";
import { isFullVin, normalizeVin } from "./vin";

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
    let span = spans.find((row) => {
      const start = Date.parse(row.startedAt);
      const end = row.endedAt ? Date.parse(row.endedAt) : Number.POSITIVE_INFINITY;
      return Number.isFinite(start) && instant >= start && instant < end;
    });
    const ownerId = order.customerId;
    if (ownerId && span && span.customerId !== ownerId) {
      const owned = [...spans].reverse().find((row) => row.customerId === ownerId);
      if (owned) span = owned;
    }
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

function visitInstant(orders: RepairOrder[], vehicleId: string, pick: "min" | "max") {
  let best = pick === "min" ? Number.POSITIVE_INFINITY : 0;
  let found = false;
  for (const order of orders) {
    if (order.vehicleId !== vehicleId) continue;
    const instant = openedInstant(order);
    if (!Number.isFinite(instant) || instant <= 0) continue;
    found = true;
    best = pick === "min" ? Math.min(best, instant) : Math.max(best, instant);
  }
  return found ? best : 0;
}

/**
 * One current vehicle per full VIN. The latest owner stays current.
 * Closed repair orders are returned as the same objects.
 */
export function mergeVinDuplicates(vehicles: Vehicle[], orders: RepairOrder[]): { vehicles: Vehicle[]; orders: RepairOrder[] } {
  const groups = new Map<string, Vehicle[]>();
  const kept: Vehicle[] = [];
  for (const vehicle of vehicles) {
    const key = normalizeVin(vehicle?.vin || "");
    if (!vehicle || !isFullVin(key)) {
      if (vehicle) kept.push(vehicle);
      continue;
    }
    const list = groups.get(key) ?? [];
    list.push(vehicle);
    groups.set(key, list);
  }
  const redirect = new Map<string, string>();
  for (const [vin, group] of groups) {
    if (group.length === 1) {
      kept.push(group[0]);
      continue;
    }
    const ranked = group
      .map((vehicle, index) => ({ vehicle, index, latest: visitInstant(orders, vehicle.id, "max") }))
      .sort((a, b) => a.latest - b.latest || a.index - b.index);
    const survivor = ranked[ranked.length - 1].vehicle;
    let cursor = 0;
    const spans: OwnershipSpan[] = ranked.map((row, index) => {
      const earliest = visitInstant(orders, row.vehicle.id, "min") || row.latest || cursor + 1;
      const startedAt = new Date(Math.max(earliest, cursor + 1)).toISOString();
      cursor = Date.parse(startedAt);
      const last = index === ranked.length - 1;
      return {
        customerId: row.vehicle.customerId,
        startedAt,
        endedAt: last ? null : new Date(cursor + 1).toISOString(),
        who: "",
        whoId: "",
        reason: last ? "" : "Merged duplicate VIN on load",
      };
    });
    for (let index = 0; index < spans.length - 1; index += 1) {
      spans[index] = { ...spans[index], endedAt: spans[index + 1].startedAt };
    }
    kept.push({
      ...survivor,
      vin,
      customerId: survivor.customerId,
      transferredTo: undefined,
      ownership: spans,
    });
    for (const row of group) {
      if (row.id !== survivor.id) redirect.set(row.id, survivor.id);
    }
  }
  if (redirect.size === 0) return { vehicles, orders };
  const nextOrders = orders.map((order) => {
    const nextId = redirect.get(order.vehicleId);
    if (!nextId || order.status === "closed" || order.authorizationLocked) return order;
    return { ...order, vehicleId: nextId };
  });
  return { vehicles: kept, orders: nextOrders };
}

/** Customer copy of this repair order only. A closed ticket uses its snapshot. Previous owners are not included. */
export function customerCopyIdentity(
  order: Pick<RepairOrder, "status" | "closeSnapshot">,
  customer: Pick<Customer, "name" | "phone"> | undefined,
): { name: string; phone: string } {
  if (order.status === "closed") {
    const name = order.closeSnapshot?.customerName?.trim() || "";
    const phone = order.closeSnapshot?.phone?.trim() || "";
    return { name: name || "Not captured", phone: phone || "Not captured" };
  }
  return { name: customer?.name?.trim() || "—", phone: customer?.phone ?? "" };
}
