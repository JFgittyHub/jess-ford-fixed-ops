export const VEHICLE_MISSING = "This customer has no vehicle on this store. Add the vehicle, then book it.";
export const CONCERN_MISSING = "Add a concern before booking.";

export type DeskSeed = {
  storeId: string;
  customerId: string;
  vehicleId: string;
  advisorId: string;
  techId: string;
  serviceId: string;
  onlineTechId: string;
};

type DeskShop = {
  activeStoreId: string;
  customers: { id: string }[];
  vehicles: { id: string; customerId: string }[];
  advisors: { id: string }[];
  techs: { id: string; board?: string }[];
  settings: { scheduling: { onlineMenu: { id: string }[] } };
};

/** Ids the booking form should open with for the store that is on screen. */
export function deskSeedFor(shop: DeskShop): DeskSeed {
  const customerId = shop.customers[0]?.id ?? "";
  const vehicleId = shop.vehicles.find((row) => row.customerId === customerId)?.id ?? "";
  const advisorId = shop.advisors[0]?.id ?? "";
  const techId = shop.techs[0]?.id ?? "";
  const onlineTechId = shop.techs.find((row) => row.board !== "none")?.id ?? techId;
  return {
    storeId: shop.activeStoreId,
    customerId,
    vehicleId,
    advisorId,
    techId,
    serviceId: shop.settings.scheduling.onlineMenu[0]?.id ?? "",
    onlineTechId,
  };
}

/** Keep the advisor's picks while the store stays. A store switch starts over. */
export function deskSeedOnStore(current: DeskSeed, shop: DeskShop): DeskSeed {
  if (current.storeId === shop.activeStoreId) return current;
  return deskSeedFor(shop);
}

export function bookingConcernError(lines: { concern: string }[] | undefined, concern: string | undefined): string | null {
  const fromLines = lines?.some((line) => line.concern.trim()) ?? false;
  if (fromLines || concern?.trim()) return null;
  return CONCERN_MISSING;
}

export function vehicleBookingError(
  shop: { customers: { id: string }[]; vehicles: { id: string; customerId: string }[] },
  customerId: string,
  vehicleId: string,
): string | null {
  if (!customerId || !shop.customers.some((row) => row.id === customerId)) {
    return "That customer isn't on this store.";
  }
  const owned = shop.vehicles.filter((row) => row.customerId === customerId);
  if (!vehicleId || owned.length === 0) return VEHICLE_MISSING;
  if (!owned.some((row) => row.id === vehicleId)) return "That vehicle isn't on this store.";
  return null;
}

/** Why Book it should stay on the form instead of returning quietly. */
export function bookingFormBlock(input: { vehicleId: string; lines: { concern: string }[] }): string | null {
  if (!input.vehicleId) return VEHICLE_MISSING;
  return bookingConcernError(input.lines, "");
}
