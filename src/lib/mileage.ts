import type { RepairOrder, Vehicle } from "./types";

export interface MileageVisit {
  mileage: number;
  date: string;
}

export interface MileageShop {
  orders: Pick<RepairOrder, "id" | "vehicleId" | "mileage" | "openedOn" | "invoicedOn">[];
  vehicles: Pick<Vehicle, "id" | "vin">[];
}

function vinKey(vin: string) {
  return vin.toUpperCase().replace(/[^A-HJ-NPR-Z0-9]/g, "");
}

/** Highest mileage already on this vehicle, at any store. Ties keep the latest date. */
export function highestPriorMileage(shops: MileageShop[], vehicle: Pick<Vehicle, "id" | "vin"> | undefined, excludeOrderId?: string): MileageVisit | null {
  if (!vehicle) return null;
  const vin = vinKey(vehicle.vin ?? "");
  let best: MileageVisit | null = null;
  for (const shop of shops) {
    const vinById = new Map(shop.vehicles.map((row) => [row.id, vinKey(row.vin ?? "")]));
    for (const order of shop.orders) {
      if (excludeOrderId && order.id === excludeOrderId) continue;
      if (!Number.isFinite(order.mileage) || order.mileage <= 0) continue;
      const sameId = order.vehicleId === vehicle.id;
      const other = vinById.get(order.vehicleId) ?? "";
      const sameVin = vin.length >= 8 && other.length >= 8 && (vin === other || vin.slice(-8) === other.slice(-8));
      if (!sameId && !sameVin) continue;
      const date = order.openedOn || order.invoicedOn || "";
      if (!best || order.mileage > best.mileage || (order.mileage === best.mileage && date > best.date)) {
        best = { mileage: order.mileage, date };
      }
    }
  }
  return best;
}

/** Names the last visit's mileage and date. Equal to that mileage is allowed. */
export function mileageFloorMessage(mileage: number, last: MileageVisit | null) {
  if (!last || !Number.isFinite(mileage) || mileage >= last.mileage) return null;
  const miles = last.mileage.toLocaleString("en-US");
  const when = last.date || "an earlier visit";
  return `Mileage in can't be under ${miles} from the last visit on ${when}`;
}
