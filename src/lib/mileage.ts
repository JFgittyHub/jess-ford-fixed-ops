import type { RepairOrder, Vehicle } from "./types";
import { isFullVin } from "./vin";

export interface MileageVisit {
  /** The reading the next visit has to meet: mileage in, or mileage out when that is higher. */
  mileage: number;
  date: string;
  orderId: string;
}

export interface MileageShop {
  orders: Pick<RepairOrder, "id" | "vehicleId" | "mileage" | "mileageOut" | "openedOn">[];
  vehicles: Pick<Vehicle, "id" | "vin">[];
}

function vinKey(vin: string) {
  return vin.toUpperCase().replace(/[^A-HJ-NPR-Z0-9]/g, "");
}

/** Mileage in, or mileage out when the car left with a higher reading. */
export function visitReading(order: { mileage: number; mileageOut?: number | null }) {
  const arrived = Number.isFinite(order.mileage) && order.mileage > 0 ? order.mileage : 0;
  const left = order.mileageOut != null && Number.isFinite(order.mileageOut) && order.mileageOut > 0 ? order.mileageOut : 0;
  return Math.max(arrived, left);
}

function sameVin(left: string, right: string) {
  const a = vinKey(left);
  const b = vinKey(right);
  if (isFullVin(a) && isFullVin(b)) return a === b;
  if (a.length >= 8 && b.length >= 8) return a === b || a.slice(-8) === b.slice(-8);
  return false;
}

export function formatVisitDate(iso: string) {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  if (!match) return iso || "an earlier visit";
  const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  return date.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

/**
 * The most recent other repair order for this vehicle, by opened date, that is
 * not later than this one. Open and closed both count. A full VIN matches only
 * a full VIN. A missing VIN falls back to the vehicle id or the last 8 characters.
 */
export function lastVisitMileage(
  shops: MileageShop[],
  vehicle: Pick<Vehicle, "id" | "vin"> | undefined,
  options: { excludeOrderId?: string; openedOn?: string } = {},
): MileageVisit | null {
  if (!vehicle) return null;
  const cutoff = options.openedOn || "9999-12-31";
  let best: MileageVisit | null = null;
  for (const shop of shops) {
    const vinById = new Map(shop.vehicles.map((row) => [row.id, row.vin ?? ""]));
    for (const order of shop.orders) {
      if (options.excludeOrderId && order.id === options.excludeOrderId) continue;
      if (!order.openedOn || order.openedOn > cutoff) continue;
      const reading = visitReading(order);
      if (reading <= 0) continue;
      const sameId = order.vehicleId === vehicle.id;
      const otherVin = vinById.get(order.vehicleId) ?? "";
      if (!sameId && !sameVin(vehicle.vin ?? "", otherVin)) continue;
      if (!best || order.openedOn > best.date || (order.openedOn === best.date && reading > best.mileage)) {
        best = { mileage: reading, date: order.openedOn, orderId: order.id };
      }
    }
  }
  return best;
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
