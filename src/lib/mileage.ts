import type { RepairOrder, Vehicle } from "./types";
import { isFullVin } from "./vin";

export interface MileageVisit {
  /** The reading the next visit has to meet: mileage in, or mileage out when that is higher. */
  mileage: number;
  date: string;
  orderId: string;
}

export interface MileageShop {
  orders: Array<Pick<RepairOrder, "id" | "vehicleId" | "mileage" | "mileageOut" | "openedOn"> & { openedAt?: string | null }>;
  vehicles: Pick<Vehicle, "id" | "vin">[];
}

function vinKey(vin: string) {
  return vin.toUpperCase().replace(/[^A-HJ-NPR-Z0-9]/g, "");
}

/**
 * The last visit's mileage out. When that visit has no mileage out yet, mileage in.
 * An open repair order usually has no mileage out.
 */
export function visitReading(order: { mileage: number; mileageOut?: number | null }) {
  if (order.mileageOut != null && Number.isFinite(order.mileageOut) && order.mileageOut > 0) return order.mileageOut;
  return Number.isFinite(order.mileage) && order.mileage > 0 ? order.mileage : 0;
}

function sameVin(left: string, right: string) {
  const a = vinKey(left);
  const b = vinKey(right);
  return isFullVin(a) && isFullVin(b) && a === b;
}

export function openedStamp(order: { openedOn?: string; openedAt?: string | null }) {
  if (typeof order.openedAt === "string" && order.openedAt.trim()) return order.openedAt.trim();
  if (order.openedOn) return `${order.openedOn}T00:00:00`;
  return "";
}

const REASON_SHORT = "Add a reason of at least 10 characters.";

/** Trim, collapse inner whitespace, then require 10 to 500 characters. */
export function preparedReason(value: unknown): { text: string } | { error: string } {
  if (typeof value !== "string") return { error: REASON_SHORT };
  const text = value.trim().replace(/\s+/g, " ");
  if (text.length < 10) return { error: REASON_SHORT };
  if (text.length > 500) return { error: "Keep the reason to 500 characters." };
  return { text };
}

export function formatVisitDate(iso: string) {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  if (!match) return iso || "an earlier visit";
  const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  return date.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

/**
 * The most recent other repair order for this vehicle, by opened timestamp.
 * A later repair order on the same day is not earlier. The same timestamp is
 * not earlier for either order. Open and closed both count. Vehicles match on
 * the full VIN, or on the same vehicle id when a VIN is missing.
 */
export function lastVisitMileage(
  shops: MileageShop[],
  vehicle: Pick<Vehicle, "id" | "vin"> | undefined,
  options: { excludeOrderId?: string; openedAt?: string; openedOn?: string } = {},
): MileageVisit | null {
  if (!vehicle) return null;
  const cutoff = options.openedAt
    || (options.openedOn ? `${options.openedOn}T23:59:59.999` : "9999-12-31T23:59:59.999");
  let bestStamp = "";
  let best: MileageVisit | null = null;
  for (const shop of shops) {
    const vinById = new Map(shop.vehicles.map((row) => [row.id, row.vin ?? ""]));
    for (const order of shop.orders) {
      if (options.excludeOrderId && order.id === options.excludeOrderId) continue;
      const stamp = openedStamp(order);
      if (!stamp || stamp >= cutoff) continue;
      const reading = visitReading(order);
      if (reading <= 0) continue;
      const sameId = order.vehicleId === vehicle.id;
      const otherVin = vinById.get(order.vehicleId) ?? "";
      if (!sameId && !sameVin(vehicle.vin ?? "", otherVin)) continue;
      if (!best || stamp > bestStamp || (stamp === bestStamp && reading > best.mileage)) {
        bestStamp = stamp;
        best = { mileage: reading, date: order.openedOn || stamp.slice(0, 10), orderId: order.id };
      }
    }
  }
  return best;
}

/** Default until Brandon says otherwise: mileage out may not jump more than this above mileage in. */
export const MILEAGE_OUT_GAP = 10_000;

export function mileageOutGapMessage(mileageIn: number, mileageOut: number | null) {
  if (mileageOut == null || !Number.isFinite(mileageOut) || !Number.isFinite(mileageIn)) return null;
  if (mileageOut > mileageIn + MILEAGE_OUT_GAP) return "Mileage out can't be more than 10,000 above mileage in.";
  return null;
}

export function mileageInOverrideText(entered: number, last: MileageVisit, reason: string) {
  const value = entered.toLocaleString("en-US");
  const floor = last.mileage.toLocaleString("en-US");
  return `Mileage in set to ${value}, below last visit ${floor} (${formatVisitDate(last.date)}), service manager override: ${reason}`;
}

export function mileageOutOverrideText(mileageOut: number, mileageIn: number, reason: string) {
  const left = mileageOut.toLocaleString("en-US");
  const arrived = mileageIn.toLocaleString("en-US");
  return `Mileage out set to ${left}, more than 10,000 above mileage in ${arrived}, service manager override: ${reason}`;
}

/** Equal to the last visit is allowed. */
export const MILEAGE_MAX = 999_999;

export function mileageTooHigh(mileage: number) {
  return Number.isFinite(mileage) && mileage > MILEAGE_MAX;
}

export function mileageFloorMessage(mileage: number, last: MileageVisit | null) {
  if (!last || !Number.isFinite(mileage) || mileage >= last.mileage) return null;
  const miles = last.mileage.toLocaleString("en-US");
  return `Mileage in can't be lower than the last visit (${miles} mi on ${formatVisitDate(last.date)}).`;
}

export function lastVisitHint(last: MileageVisit | null) {
  if (!last) return "";
  return `Last visit: ${last.mileage.toLocaleString("en-US")} mi on ${formatVisitDate(last.date)}.`;
}
