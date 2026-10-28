import { appointmentLoads, onlineSlots } from "./capacity";
import type { ContactMethod, Customer, OnlineChallenge, OnlineRequest, SchedulingSettings, StoreId, Vehicle } from "./types";

const CODE_WINDOW_MS = 10 * 60 * 1000;

export interface OnlineRequestInput {
  serviceId: string;
  date: string;
  time: string;
  advisorId: string;
  transportId: string;
  verified: boolean;
  code?: string;
  customerId?: string;
  customerName?: string;
  phone?: string;
  email?: string;
  vehicleId?: string;
  year?: number;
  make?: string;
  model?: string;
  vin?: string;
  plate?: string;
  contactMethod?: ContactMethod;
}

export type OnlineLookup =
  | { kind: "code"; customerId: string }
  | { kind: "unverified" }
  | { kind: "new" }
  | { kind: "ambiguous" };

type SlotShop = {
  activeStoreId: StoreId;
  settings: { scheduling: SchedulingSettings };
  advisors: { id: string; name: string }[];
  techs: { id: string; name: string; board?: string }[];
  customers: Customer[];
  vehicles: Vehicle[];
  appointments: Parameters<typeof appointmentLoads>[0];
  laborOps: { id: string; hours: number }[];
  onlineRequests: OnlineRequest[];
  onlineChallenges: OnlineChallenge[];
};

export function makeOnlineCode(random: () => number = Math.random): string {
  return String(Math.floor(random() * 1_000_000)).padStart(6, "0");
}

export function codesMatch(issued: string, entered: string): boolean {
  const left = issued.trim();
  const right = entered.trim();
  if (!/^\d{6}$/.test(left) || !/^\d{6}$/.test(right)) return false;
  return left === right;
}

export function lookupOnlineCustomer(
  customers: Customer[],
  vehicles: Vehicle[],
  query: string,
): OnlineLookup {
  const trimmed = query.trim();
  if (!trimmed) return { kind: "new" };
  const matches = new Map<string, Customer>();
  if (trimmed.includes("@")) {
    const email = trimmed.toLowerCase();
    for (const customer of customers) {
      if (customer.email.trim().toLowerCase() === email) matches.set(customer.id, customer);
    }
  } else {
    const queryDigits = digits(trimmed);
    if (queryDigits.length >= 7) {
      for (const customer of customers) {
        if (phonesMatch(customer.phone, queryDigits) || phonesMatch(customer.mobile, queryDigits)) matches.set(customer.id, customer);
      }
    }
    const vinKey = trimmed.toUpperCase().replace(/[^A-HJ-NPR-Z0-9]/g, "");
    if (vinKey.length >= 8) {
      const last8 = vinKey.slice(-8);
      for (const vehicle of vehicles) {
        if (vehicle.vin.toUpperCase().slice(-8) !== last8) continue;
        const customer = customers.find((row) => row.id === vehicle.customerId);
        if (customer) matches.set(customer.id, customer);
      }
    }
  }
  if (matches.size === 0) return { kind: "new" };
  if (matches.size > 1) return { kind: "ambiguous" };
  const customer = [...matches.values()][0];
  if (!customer.mobile.trim()) return { kind: "unverified" };
  return { kind: "code", customerId: customer.id };
}

/** Saved vehicles stay hidden until the code matches and the record has a mobile. */
export function revealSavedVehicles(input: {
  customer: { id: string; mobile: string } | null;
  vehicles: Vehicle[];
  issuedCode: string | null;
  enteredCode: string;
}): { unlocked: boolean; vehicles: Vehicle[] } {
  if (!input.customer || !input.customer.mobile.trim()) return { unlocked: false, vehicles: [] };
  if (!codesMatch(input.issuedCode ?? "", input.enteredCode)) return { unlocked: false, vehicles: [] };
  return {
    unlocked: true,
    vehicles: input.vehicles.filter((vehicle) => vehicle.customerId === input.customer?.id),
  };
}

/** Only a pending request holds capacity. Approved time moves to the appointment. Declined time is free. */
export function requestHolds(requests: OnlineRequest[] | undefined) {
  return (requests ?? []).filter((row) => row.status === "pending").map((row) => ({
    id: row.id,
    date: row.date,
    time: row.time,
    advisorId: row.advisorId,
    techId: row.techId,
    laborHours: row.laborHours,
    status: row.status,
  }));
}

export function normalizeContactMethod(value: string | undefined, fallback: { phone?: string; email?: string }): ContactMethod {
  if (value === "text" || value === "email" || value === "call") return value;
  if ((fallback.phone ?? "").trim()) return "text";
  if ((fallback.email ?? "").trim()) return "email";
  return "call";
}

/** Unique customer for an unverified request, including records with no mobile. */
export function matchRequestCustomer(
  customers: Customer[],
  vehicles: Vehicle[],
  request: { phone?: string; email?: string; vin?: string },
): { customerId: string; vehicleId: string | null } | null {
  const found = matchedCustomers(customers, vehicles, request);
  if (found.length !== 1) return null;
  const customer = found[0];
  const vehicle = vehicleFor(customer.id, vehicles, request.vin ?? "");
  return { customerId: customer.id, vehicleId: vehicle?.id ?? null };
}

export function visitSlots(shop: SlotShop, input: { serviceId: string; advisorId?: string; date?: string; now?: Date }) {
  return onlineSlots({
    scheduling: shop.settings.scheduling,
    advisors: shop.advisors,
    techs: shop.techs,
    loads: appointmentLoads(shop.appointments, shop.laborOps),
    holds: requestHolds(shop.onlineRequests),
    serviceId: input.serviceId,
    advisorId: input.advisorId,
    from: input.date,
    through: input.date,
    now: input.now,
  });
}

export function submitOnlineRequest(
  shop: SlotShop,
  input: OnlineRequestInput,
  id: string,
  at: string,
): { ok: true; request: OnlineRequest } | { ok: false; reason: "service" | "advisor" | "transport" | "code" | "vehicle" | "contact" | "full" } {
  const service = shop.settings.scheduling.onlineMenu.find((row) => row.id === input.serviceId);
  if (!service) return { ok: false, reason: "service" };
  const advisor = shop.advisors.find((row) => row.id === input.advisorId);
  if (!advisor) return { ok: false, reason: "advisor" };
  const transport = shop.settings.scheduling.transportOptions.find((row) => row.id === input.transportId);
  if (!transport) return { ok: false, reason: "transport" };

  let verified = false;
  let customerId: string | null = null;
  let vehicleId: string | null = null;
  let customerName = (input.customerName ?? "").trim();
  let phone = (input.phone ?? "").trim();
  let email = (input.email ?? "").trim();
  let year = Math.trunc(Number(input.year) || 0);
  let make = (input.make ?? "").trim();
  let model = (input.model ?? "").trim();
  let vin = (input.vin ?? "").trim().toUpperCase();
  let plate = (input.plate ?? "").trim().toUpperCase();

  if (input.verified) {
    const customer = shop.customers.find((row) => row.id === input.customerId);
    const vehicle = shop.vehicles.find((row) => row.id === input.vehicleId && row.customerId === customer?.id);
    if (!customer || !customer.mobile.trim() || !codeStillGood(shop.onlineChallenges, customer.id, input.code ?? "", at)) {
      return { ok: false, reason: "code" };
    }
    if (!vehicle) return { ok: false, reason: "vehicle" };
    verified = true;
    customerId = customer.id;
    vehicleId = vehicle.id;
    customerName = customer.name;
    phone = customer.phone;
    email = customer.email;
    year = vehicle.year;
    make = "";
    model = vehicle.model;
    vin = vehicle.vin;
    plate = plate || "";
  } else if (!customerName || !make || !model || year < 1980 || year > 2035 || vin.length < 8 || !plate) {
    return { ok: false, reason: "contact" };
  }

  const slot = visitSlots(shop, { serviceId: service.id, advisorId: advisor.id, date: input.date, now: new Date(at) }).find((row) => row.time === input.time);
  if (!slot) return { ok: false, reason: "full" };
  const tech = shop.techs.find((row) => row.id === slot.techId);
  return {
    ok: true,
    request: {
      id,
      storeId: shop.activeStoreId,
      status: "pending",
      createdAt: at,
      serviceId: service.id,
      serviceName: service.name,
      laborHours: service.laborHours,
      date: slot.date,
      time: slot.time,
      advisorId: advisor.id,
      advisorName: advisor.name,
      techId: slot.techId,
      techName: tech?.name ?? "Technician",
      transportId: transport.id,
      transportName: transport.name,
      contactMethod: normalizeContactMethod(input.contactMethod, { phone, email }),
      verified,
      customerId,
      customerName,
      phone,
      email,
      vehicleId,
      year,
      make,
      model,
      vin,
      plate,
      appointmentId: null,
    },
  };
}

function codeStillGood(challenges: OnlineChallenge[], customerId: string, code: string, at: string): boolean {
  const row = challenges.find((item) => item.customerId === customerId && codesMatch(item.code, code));
  if (!row) return false;
  const issued = new Date(row.issuedAt).getTime();
  const now = new Date(at).getTime();
  if (!Number.isFinite(issued) || !Number.isFinite(now)) return false;
  return now >= issued && now - issued <= CODE_WINDOW_MS;
}

function digits(value: string) {
  return value.replace(/\D/g, "");
}

function phonesMatch(record: string, queryDigits: string) {
  const stored = digits(record);
  if (stored.length < 7) return false;
  return stored.endsWith(queryDigits) || queryDigits.endsWith(stored);
}

function matchedCustomers(
  customers: Customer[],
  vehicles: Vehicle[],
  request: { phone?: string; email?: string; vin?: string },
): Customer[] {
  const found = new Map<string, Customer>();
  const email = (request.email ?? "").trim().toLowerCase();
  if (email.includes("@")) {
    for (const customer of customers) {
      if (customer.email.trim().toLowerCase() === email) found.set(customer.id, customer);
    }
  }
  const queryDigits = digits(request.phone ?? "");
  if (queryDigits.length >= 7) {
    for (const customer of customers) {
      if (phonesMatch(customer.phone, queryDigits) || phonesMatch(customer.mobile, queryDigits)) found.set(customer.id, customer);
    }
  }
  const vinKey = (request.vin ?? "").toUpperCase().replace(/[^A-HJ-NPR-Z0-9]/g, "");
  if (vinKey.length >= 8) {
    const last8 = vinKey.slice(-8);
    for (const vehicle of vehicles) {
      if (vehicle.vin.toUpperCase().slice(-8) !== last8) continue;
      const customer = customers.find((row) => row.id === vehicle.customerId);
      if (customer) found.set(customer.id, customer);
    }
  }
  return [...found.values()];
}

function vehicleFor(customerId: string, vehicles: Vehicle[], vin: string): Vehicle | undefined {
  const key = vin.toUpperCase().replace(/[^A-HJ-NPR-Z0-9]/g, "");
  if (key.length < 8) return undefined;
  const last8 = key.slice(-8);
  return vehicles.find((vehicle) => vehicle.customerId === customerId && (vehicle.vin.toUpperCase() === key || vehicle.vin.toUpperCase().slice(-8) === last8));
}
