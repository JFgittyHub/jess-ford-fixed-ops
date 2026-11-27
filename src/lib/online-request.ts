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
    const email = emailKey(trimmed);
    for (const customer of customers) {
      if (customer.email && emailKey(customer.email) === email) matches.set(customer.id, customer);
    }
  } else {
    if (phoneKey(trimmed)) {
      for (const customer of customers) {
        if (phonesMatch(customer.phone, trimmed) || phonesMatch(customer.mobile, trimmed)) matches.set(customer.id, customer);
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
  const phoneRaw = cleanFreeText(input.phone ?? "").trim();
  const emailRaw = cleanFreeText(input.email ?? "").trim();
  if (phoneRaw && !phoneKey(phoneRaw)) return { ok: false, reason: "contact" };
  if (emailRaw.length > 120) return { ok: false, reason: "contact" };
  let phone = phoneRaw ? phoneKey(phoneRaw) : "";
  let email = emailRaw.toLowerCase();
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
  const phoneOk = phone.length === 0 || phoneDigits.length === 10 || phoneDigits.startsWith("+");
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

function phonesMatch(record: string, query: string) {
  const stored = phoneKey(record);
  const asked = phoneKey(query);
  return stored.length > 0 && stored === asked;
}

function matchedCustomers(
  customers: Customer[],
  vehicles: Vehicle[],
  request: { phone?: string; email?: string; vin?: string },
): Customer[] {
  const found = new Map<string, Customer>();
  const email = emailKey(request.email ?? "");
  if (email.includes("@")) {
    for (const customer of customers) {
      if (customer.email && emailKey(customer.email) === email) found.set(customer.id, customer);
    }
  }
  const queryPhone = request.phone ?? "";
  if (phoneKey(queryPhone)) {
    for (const customer of customers) {
      if (phonesMatch(customer.phone, queryPhone) || phonesMatch(customer.mobile, queryPhone)) found.set(customer.id, customer);
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

const ZWJ = 0x200d;
const ZWNJ = 0x200c;
const VS15 = 0xfe0e;
const VS16 = 0xfe0f;

function charOf(code: number) {
  return code > 0 ? String.fromCodePoint(code) : "";
}

function joiningScript(code: number) {
  return /\p{Script=Arabic}|\p{Script=Syriac}|\p{Script=Thaana}|\p{Script=Devanagari}|\p{Script=Bengali}|\p{Script=Gurmukhi}|\p{Script=Gujarati}|\p{Script=Oriya}|\p{Script=Tamil}|\p{Script=Telugu}|\p{Script=Kannada}|\p{Script=Malayalam}|\p{Script=Sinhala}|\p{Script=Myanmar}|\p{Script=Khmer}|\p{Script=Tibetan}/u.test(charOf(code));
}

function isEmojiBase(code: number) {
  if (code >= 0x1f1e6 && code <= 0x1f1ff) return true;
  if (code >= 0x1f3fb && code <= 0x1f3ff) return true;
  if (code >= 0x1f300 && code <= 0x1faff) return true;
  if (code >= 0x2600 && code <= 0x27bf) return true;
  if (code >= 0x2300 && code <= 0x23ff) return true;
  if (code === 0x20e3 || code === 0x3030 || code === 0x303d || code === 0x3297 || code === 0x3299) return true;
  return false;
}

function hasPresentation(code: number) {
  if (isEmojiBase(code)) return true;
  if ((code >= 0x30 && code <= 0x39) || code === 0x23 || code === 0x2a) return true;
  if (code === 0xa9 || code === 0xae || code === 0x2122 || code === 0x2b50) return true;
  if (code >= 0x2194 && code <= 0x2199) return true;
  if (code >= 0x21a9 && code <= 0x21aa) return true;
  if (code >= 0x2b05 && code <= 0x2b55) return true;
  return false;
}

function isFormatOrIgnorable(code: number) {
  if (code <= 0x1f || code === 0x7f || (code >= 0x80 && code <= 0x9f) || code === 0x2028 || code === 0x2029) return true;
  const text = charOf(code);
  if (!text) return false;
  return /\p{Cf}|\p{Default_Ignorable_Code_Point}/u.test(text);
}

const UK_FLAGS = ["gbeng", "gbsct", "gbwls"];

function flagTagKeep(codes: number[]) {
  const keep = codes.map(() => false);
  for (let index = 0; index < codes.length; index += 1) {
    if (codes[index] !== 0x1f3f4) continue;
    for (const name of UK_FLAGS) {
      const tags = [...name].map((letter) => 0xe0000 + letter.charCodeAt(0));
      if (codes[index + tags.length + 1] !== 0xe007f) continue;
      if (tags.some((tag, offset) => codes[index + 1 + offset] !== tag)) continue;
      for (let mark = 1; mark <= tags.length + 1; mark += 1) keep[index + mark] = true;
    }
  }
  return keep;
}

function keepJoiner(codes: number[], index: number) {
  const prev = codes[index - 1] ?? 0;
  const next = codes[index + 1] ?? 0;
  const prevBase = prev === VS16 || prev === VS15 || (prev >= 0x1f3fb && prev <= 0x1f3ff) ? (codes[index - 2] ?? 0) : prev;
  if (joiningScript(prev) && joiningScript(next)) return true;
  return (isEmojiBase(prev) || isEmojiBase(prevBase)) && isEmojiBase(next);
}

function keepVariation(codes: number[], index: number) {
  const prev = codes[index - 1] ?? 0;
  const next = codes[index + 1] ?? 0;
  if ((prev >= 0x30 && prev <= 0x39) || prev === 0x23 || prev === 0x2a) return next === 0x20e3;
  if (prev === 0xa9 || prev === 0xae || prev === 0x2122) return false;
  return hasPresentation(prev) && !((prev >= 0x30 && prev <= 0x39) || prev === 0x23 || prev === 0x2a);
}

/** NFC, then drop format characters. Joiners stay for Arabic, Indic, and emoji. VS15 and VS16 stay after a presentation character. */
export function cleanFreeText(value: unknown): string {
  if (typeof value !== "string") return "";
  const chars = [...value.normalize("NFC")];
  const codes = chars.map((char) => char.codePointAt(0) ?? 0);
  const flags = flagTagKeep(codes);
  return chars.filter((_, index) => {
    const code = codes[index] ?? 0;
    if (code === ZWJ || code === ZWNJ) return keepJoiner(codes, index);
    if (code === VS15 || code === VS16) return keepVariation(codes, index);
    if ((code >= 0xfe00 && code <= 0xfe0d) || (code >= 0xe0100 && code <= 0xe01ef)) return false;
    if (code >= 0xe0020 && code <= 0xe007f) return flags[index] === true;
    return !isFormatOrIgnorable(code);
  }).join("");
}

/** Same cleaned text with joiners removed, for matching. The stored text keeps a meaningful joiner. */
export function dedupeKey(value: string): string {
  return [...cleanFreeText(value)].filter((char) => {
    const code = char.codePointAt(0) ?? 0;
    return code !== ZWJ && code !== ZWNJ;
  }).join("");
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

function foldDecimalDigits(value: string) {
  return [...value].map((char) => {
    const folded = char.normalize("NFKC");
    if (/^[0-9]$/.test(folded)) return folded;
    if (!/^\p{Nd}$/u.test(char)) return char;
    const code = char.codePointAt(0) ?? 0;
    let zero = code;
    while (zero > 0 && /^\p{Nd}$/u.test(String.fromCodePoint(zero - 1))) zero -= 1;
    const offset = code - zero;
    return offset <= 9 ? String(offset) : char;
  }).join("");
}

/** ITU-T E.164 country calling codes (1–3 digits). NANP stays "1"; area codes are not listed. */
const CALLING_CODES = new Set(
  "1 7 20 27 30 31 32 33 34 36 39 40 41 43 44 45 46 47 48 49 51 52 53 54 55 56 57 58 60 61 62 63 64 65 66 81 82 84 86 90 91 92 93 94 95 98 211 212 213 216 218 220 221 222 223 224 225 226 227 228 229 230 231 232 233 234 235 236 237 238 239 240 241 242 243 244 245 246 247 248 249 250 251 252 253 254 255 256 257 258 260 261 262 263 264 265 266 267 268 269 290 291 297 298 299 350 351 352 353 354 355 356 357 358 359 370 371 372 373 374 375 376 377 378 379 380 381 382 383 385 386 387 389 420 421 423 500 501 502 503 504 505 506 507 508 509 590 591 592 593 594 595 596 597 598 599 670 672 673 674 675 676 677 678 679 680 681 682 683 685 686 687 688 689 690 691 692 850 852 853 855 856 880 886 960 961 962 963 964 965 966 967 968 970 971 972 973 974 975 976 977 992 993 994 995 996 998".split(" "),
);

function nanpNational(ten: string) {
  return /^[2-9]\d{2}[2-9]\d{6}$/.test(ten);
}

function callingCode(digits: string) {
  for (const length of [3, 2, 1]) {
    const code = digits.slice(0, length);
    if (CALLING_CODES.has(code)) return code;
  }
  return "";
}

function internationalKey(digits: string) {
  if (!digits || /^0+$/.test(digits) || digits.length > 15) return "";
  const code = callingCode(digits);
  if (code === "1") {
    const national = digits.slice(1);
    if (digits.length !== 11 || !nanpNational(national)) return "";
    return national;
  }
  if (!code) return "";
  let national = digits.slice(code.length);
  if (code === "7" && national.startsWith("8")) national = national.slice(1);
  if (!["39", "378", "379"].includes(code) && national.startsWith("0")) national = national.replace(/^0+/, "");
  if (national.length < 4 || /^0+$/.test(national)) return "";
  const key = `${code}${national}`;
  if (key.length < 8 || key.length > 15) return "";
  return `+${key}`;
}

/** US numbers fold to 10 digits. A leading + keeps its own E.164 key, including the plus. */
export function phoneKey(value: string): string {
  const cleaned = foldDecimalDigits(dedupeKey(value)).trim();
  const withoutMarks = cleaned.replace(/(?:[#/]\s*\d+|(?:ext\.?|extension|x)\s*\d+)\s*$/i, "");
  const body = withoutMarks.trim();
  if (body.startsWith("+")) {
    if (/^\+\s*0/.test(body)) return "";
    const digits = body.replace(/\D/g, "");
    return internationalKey(digits);
  }
  const digits = body.replace(/\D/g, "");
  if (digits.length > 15) return "";
  if (digits.length === 11 && digits.startsWith("1")) return nanpNational(digits.slice(1)) ? digits.slice(1) : "";
  if (digits.length === 11 && digits.startsWith("9")) return nanpNational(digits.slice(1)) ? digits.slice(1) : "";
  if (digits.length === 10 && nanpNational(digits)) return digits;
  return "";
}

function emailKey(value: string): string {
  const folded = dedupeKey(value).normalize("NFKD").replace(/\p{M}/gu, "");
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
