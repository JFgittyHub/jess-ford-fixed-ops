import { displayRecordedWhen } from "./cancel";
import { openedInstant } from "./mileage";
import type { Customer, OwnershipChange, OwnershipSpan, RepairOrder, Vehicle } from "./types";
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
  const originalOwner = spans[0]?.customerId ?? "";
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
    const key = span?.customerId || ownerId || owner;
    if (key !== shown) {
      if (span && originalOwner && span.customerId !== originalOwner) {
        const named = customers.find((row) => row.id === span.customerId)?.name ?? owner;
        lines.push({ kind: "divider", text: `New owner: ${named}, since ${displayRecordedWhen(span.startedAt)}` });
      }
      shown = key;
    }
    lines.push({ kind: "order", order, ownerName: owner });
  }
  return lines;
}

const REAL_VISIT = Date.parse("1980-01-01T00:00:00.000Z");

function realMillis(value: unknown): number {
  const parsed = typeof value === "number" ? value : typeof value === "string" ? Date.parse(value) : Number.NaN;
  return Number.isFinite(parsed) && parsed >= REAL_VISIT ? parsed : 0;
}

function visitInstant(orders: RepairOrder[], vehicleId: string, pick: "min" | "max") {
  let best = pick === "min" ? Number.POSITIVE_INFINITY : 0;
  let found = false;
  for (const order of orders) {
    if (order.vehicleId !== vehicleId) continue;
    const instant = realMillis(openedInstant(order));
    if (!instant) continue;
    found = true;
    best = pick === "min" ? Math.min(best, instant) : Math.max(best, instant);
  }
  return found ? best : 0;
}

function iso(ms: number) {
  return new Date(ms).toISOString();
}

/** Keep recorded spans. Same owner stays one span. Start dates are real visits, never 1970. */
function ownershipSpansFor(group: { vehicle: Vehicle }[], orders: RepairOrder[], survivor: Vehicle): OwnershipSpan[] {
  const ranked = [...group].sort((a, b) => {
    const aStart = visitInstant(orders, a.vehicle.id, "min") || visitInstant(orders, a.vehicle.id, "max");
    const bStart = visitInstant(orders, b.vehicle.id, "min") || visitInstant(orders, b.vehicle.id, "max");
    return aStart - bStart;
  });
  const spans: OwnershipSpan[] = [];
  for (const row of ranked) {
    const recorded = (row.vehicle.ownership ?? []).filter((span) => realMillis(span.startedAt)).map((span) => ({ ...span }));
    const pieces = recorded.length > 0 ? recorded : [];
    if (pieces.length === 0) {
      const start = visitInstant(orders, row.vehicle.id, "min") || visitInstant(orders, row.vehicle.id, "max");
      if (!start) continue;
      pieces.push({ customerId: row.vehicle.customerId, startedAt: iso(start), endedAt: null, who: "", whoId: "", reason: "" });
    }
    for (const span of pieces.sort((a, b) => realMillis(a.startedAt) - realMillis(b.startedAt))) {
      const last = spans[spans.length - 1];
      if (last && last.customerId === span.customerId) {
        if (realMillis(span.startedAt) < realMillis(last.startedAt)) last.startedAt = span.startedAt;
        continue;
      }
      if (last && !last.endedAt) last.endedAt = span.startedAt;
      spans.push({ ...span, endedAt: realMillis(span.endedAt) ? span.endedAt : null });
    }
  }
  const open = spans[spans.length - 1];
  const survivorStart = visitInstant(orders, survivor.id, "max");
  if (open && open.customerId !== survivor.customerId && survivorStart > realMillis(open.startedAt)) {
    open.endedAt = iso(survivorStart);
    spans.push(firstOwnership(survivor.customerId, iso(survivorStart), null));
  } else if (open) {
    open.endedAt = null;
  } else if (survivorStart) {
    spans.push(firstOwnership(survivor.customerId, iso(survivorStart), null));
  }
  return spans;
}

/**
 * One current vehicle per full VIN. The latest owner stays current.
 * Every repair order, including Closed, points at the surviving vehicle.
 * A Closed repair order changes only that vehicle id. Its snapshot and totals stay.
 */
export function mergeVinDuplicates(vehicles: Vehicle[], orders: RepairOrder[]): { vehicles: Vehicle[]; orders: RepairOrder[]; ownershipLog: OwnershipChange[] } {
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
  const ownershipLog: OwnershipChange[] = [];
  for (const [vin, group] of groups) {
    if (group.length === 1) {
      kept.push(group[0]);
      continue;
    }
    const ranked = group
      .map((vehicle, index) => ({ vehicle, index, latest: visitInstant(orders, vehicle.id, "max") }))
      .sort((a, b) => a.latest - b.latest || a.index - b.index);
    const survivor = ranked[ranked.length - 1].vehicle;
    const described = [...ranked].reverse().find((row) => row.vehicle.year && row.vehicle.model)?.vehicle ?? survivor;
    const spans = ownershipSpansFor(ranked, orders, survivor);
    kept.push({
      ...survivor,
      year: survivor.year || described.year,
      make: survivor.make || described.make || "Ford",
      model: survivor.model || described.model,
      vin,
      customerId: survivor.customerId,
      transferredTo: undefined,
      ownership: spans,
    });
    const atMs = visitInstant(orders, survivor.id, "max")
      || ranked.map((row) => visitInstant(orders, row.vehicle.id, "min")).find((value) => value > 0)
      || 0;
    for (const row of group) {
      if (row.id === survivor.id) continue;
      redirect.set(row.id, survivor.id);
      if (!atMs) continue;
      ownershipLog.push({
        at: iso(atMs),
        who: "",
        whoId: "",
        beforeVehicleId: row.id,
        afterVehicleId: survivor.id,
        beforeCustomerId: row.customerId,
        afterCustomerId: survivor.customerId,
        vin,
        reason: "Merged duplicate VIN on load",
      });
    }
  }
  if (redirect.size === 0) return { vehicles, orders, ownershipLog };
  const nextOrders = orders.map((order) => {
    const nextId = redirect.get(order.vehicleId);
    if (!nextId || nextId === order.vehicleId) return order;
    return { ...order, vehicleId: nextId };
  });
  return { vehicles: kept, orders: nextOrders, ownershipLog };
}

/** Closed tickets use the snapshot year, make, and model even when the vehicle row is gone. */
export function repairOrderHeading(
  order: Pick<RepairOrder, "status" | "closeSnapshot">,
  customer: { name?: string } | undefined,
  vehicle: { year?: number; make?: string; model?: string } | undefined,
): string {
  const snap = order.status === "closed" ? order.closeSnapshot : undefined;
  const name = (snap?.customerName || customer?.name || "").trim();
  if (!name) return "Repair order";
  const year = snap?.year || vehicle?.year || "";
  const make = (snap?.make || vehicle?.make || (year ? "Ford" : "")).trim();
  const model = (snap?.model || vehicle?.model || "").trim();
  const vehicleLabel = [year, make, model].filter((part) => String(part).trim()).join(" ");
  return `${name} · ${vehicleLabel || "Vehicle"}`;
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
