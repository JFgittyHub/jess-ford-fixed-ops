import { advisorDayCapacity, appointmentLoads, onlineSlots } from "./capacity";
import type { ContactMethod, Customer, OnlineChallenge, OnlineRequest, SchedulingSettings, StoreId, Vehicle } from "./types";
import { normalizeVin, vinScheduleError } from "./vin";

const CODE_WINDOW_MS = 10 * 60 * 1000;
const CONTACT_CAP = 3;
const DEVICE_CAP = 5;

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
  note?: string;
  contactMethod?: ContactMethod;
  /** Demo device id from localStorage. Caps pending requests from one browser. */
  deviceId?: string;
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
): { ok: true; request: OnlineRequest } | { ok: false; reason: "service" | "advisor" | "transport" | "code" | "vehicle" | "contact" | "full" | "vin" | "limit" | "date"; limit?: number; scope?: "contact" | "device" | "day" } {
  const service = shop.settings.scheduling.onlineMenu.find((row) => row.id === input.serviceId);
  if (!service) return { ok: false, reason: "service" };
  const advisor = shop.advisors.find((row) => row.id === input.advisorId);
  if (!advisor) return { ok: false, reason: "advisor" };
  const transport = shop.settings.scheduling.transportOptions.find((row) => row.id === input.transportId);
  if (!transport) return { ok: false, reason: "transport" };

  let verified = false;
  let customerId: string | null = null;
  let vehicleId: string | null = null;
  let customerName = textField(cleanFreeText(input.customerName), 80);
  let phone = textField(cleanFreeText(input.phone), 20);
  let email = textField(cleanFreeText(input.email), 120).toLowerCase();
  let year = Math.trunc(Number(input.year) || 0);
  let make = textField(cleanFreeText(input.make), 40);
  let model = textField(cleanFreeText(input.model), 40);
  if (input.vin != null && typeof input.vin !== "string") return { ok: false, reason: "vin" };
  const rawVin = typeof input.vin === "string" ? normalizeVin(input.vin) : "";
  if (rawVin.length > 17) return { ok: false, reason: "vin" };
  let vin = rawVin;
  let plate = textField(cleanFreeText(input.plate), 10).toUpperCase();
  const note = textField(cleanFreeText(input.note), 500);
  const deviceId = textField(cleanFreeText(input.deviceId), 40);

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
  } else if (!customerName || !make || !model || year < 1980 || year > 2035 || !plate) {
    return { ok: false, reason: "contact" };
  } else if (!vin || vinScheduleError(vin)) {
    return { ok: false, reason: "vin" };
  }
  if (verified && (!vin || vinScheduleError(vin))) return { ok: false, reason: "vin" };
  const phoneDigits = phoneKey(phone);
  const phoneOk = phone.length === 0 || phoneDigits.length === 10 || (phone.trim().startsWith("+") && phoneDigits.length >= 8 && phoneDigits.length <= 15);
  const emailOk = email.length === 0 || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
  if (!phoneOk || !emailOk) return { ok: false, reason: "contact" };
  const phones = phoneKey(phone);
  const mail = email ? emailKey(email) : "";
  if (!phones && !mail) return { ok: false, reason: "contact" };
  const pending = (shop.onlineRequests ?? []).filter((row) => row.status === "pending");
  const sameContact = pending.filter((row) => (
    (phones && phoneKey(row.phone) === phones)
    || (mail && row.email && emailKey(row.email) === mail)
  ));
  if (sameContact.length >= CONTACT_CAP) return { ok: false, reason: "limit", limit: CONTACT_CAP, scope: "contact" };
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.date ?? "")) return { ok: false, reason: "date" };
  const dayCap = advisorDayCapacity(shop.settings.scheduling, input.date);
  if (dayCap <= 0) return { ok: false, reason: "full" };
  const advisorCap = Math.max(0, dayCap - 1);
  const sameAdvisorDay = pending.filter((row) => row.advisorId === advisor.id && row.date === input.date);
  if (sameAdvisorDay.length >= advisorCap) return { ok: false, reason: "limit", limit: advisorCap, scope: "day" };
  const storeCap = shop.advisors.length > 1 ? Math.max(0, shop.advisors.length * advisorCap - 1) : advisorCap;
  if (pending.filter((row) => row.date === input.date).length >= storeCap) return { ok: false, reason: "limit", limit: storeCap, scope: "day" };
  if (deviceId && pending.filter((row) => row.deviceId === deviceId).length >= DEVICE_CAP) return { ok: false, reason: "limit", limit: DEVICE_CAP, scope: "device" };

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
      note,
      deviceId: deviceId || undefined,
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

function textField(value: unknown, max: number): string {
  if (typeof value !== "string") return "";
  return value.trim().slice(0, max);
}

function hiddenFormat(code: number) {
  if (code <= 0x1f || code === 0x7f || (code >= 0x80 && code <= 0x9f)) return true;
  if (code === 0x2028 || code === 0x2029 || code === 0xad || code === 0x34f || code === 0x61c || code === 0x180e || code === 0xfeff) return true;
  if (code === 0x3164 || code === 0x115f || code === 0x1160 || code === 0xffa0) return true;
  if (code >= 0x200b && code <= 0x200f) return true;
  if (code >= 0x202a && code <= 0x202e) return true;
  if (code >= 0x2060 && code <= 0x2069) return true;
  if (code >= 0xfff9 && code <= 0xfffb) return true;
  if (code >= 0xfe00 && code <= 0xfe0f) return true;
  if (code >= 0xe0100 && code <= 0xe01ef) return true;
  if (code >= 0xe0000 && code <= 0xe007f) return true;
  return false;
}

/** Strip controls, bidi, and soft hyphens. Accented letters stay. Fullwidth digits become ASCII. */
export function cleanFreeText(value: unknown): string {
  if (typeof value !== "string") return "";
  const normalized = value.normalize("NFKC");
  return [...normalized].filter((char) => !hiddenFormat(char.codePointAt(0) ?? 0)).join("");
}

/** Pick an advisor who still has room that day, instead of always the first name on the roster. */
export function advisorForWebRequest(
  advisors: { id: string; name: string }[],
  pending: { advisorId: string; date: string; status?: string }[],
  date: string,
  perAdvisorCap: number,
) {
  const counts = new Map<string, number>();
  for (const row of pending) {
    if (row.status && row.status !== "pending") continue;
    if (row.date !== date) continue;
    counts.set(row.advisorId, (counts.get(row.advisorId) ?? 0) + 1);
  }
  const ranked = [...advisors].sort((a, b) => (counts.get(a.id) ?? 0) - (counts.get(b.id) ?? 0) || a.name.localeCompare(b.name));
  const open = ranked.find((row) => (counts.get(row.id) ?? 0) < perAdvisorCap);
  return (open ?? ranked[0])?.id ?? "";
}

export function phoneKey(value: string): string {
  const cleaned = cleanFreeText(value).trim();
  const withoutMarks = cleaned.replace(/(?:[#/]\s*\d+|(?:ext\.?|extension|x)\s*\d+)\s*$/i, "");
  const digits = withoutMarks.replace(/\D/g, "");
  if (cleaned.startsWith("+") && !(digits.length === 11 && digits.startsWith("1"))) {
    return digits.length >= 8 && digits.length <= 15 ? digits : "";
  }
  if (digits.length === 11 && (digits.startsWith("1") || digits.startsWith("9"))) return digits.slice(1);
  if (digits.length === 10) return digits;
  return "";
}

function emailKey(value: string): string {
  const folded = value.trim().normalize("NFKD").replace(/\p{M}/gu, "");
  const lower = folded.toLowerCase().replace(/\.+$/, "");
  const at = lower.lastIndexOf("@");
  if (at < 1) return lower;
  let local = lower.slice(0, at);
  let domain = lower.slice(at + 1);
  const plus = local.indexOf("+");
  if (plus >= 0) local = local.slice(0, plus);
  if (domain === "googlemail.com") domain = "gmail.com";
  if (domain === "gmail.com") local = local.replace(/\./g, "");
  return `${local}@${domain}`;
}

function vehicleFor(customerId: string, vehicles: Vehicle[], vin: string): Vehicle | undefined {
  const key = vin.toUpperCase().replace(/[^A-HJ-NPR-Z0-9]/g, "");
  if (key.length < 8) return undefined;
  const last8 = key.slice(-8);
  return vehicles.find((vehicle) => vehicle.customerId === customerId && (vehicle.vin.toUpperCase() === key || vehicle.vin.toUpperCase().slice(-8) === last8));
}
