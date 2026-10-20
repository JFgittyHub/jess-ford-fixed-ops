import { closedRecord } from "./metrics";
import { addDays, bayFromStatus, daysBetween, dayOfMonth, DEFAULT_FEES, DEFAULT_TAX_RATE, money2, monthKey, padDay, snapHalfHour, today } from "./format";
import { concernFromJobs, concernFromLines, jobLine, lineLetter } from "./jobs";
import { demoSheet } from "./mpi";
import { defaultPayTypes } from "./pay";
import { defaultScheduling } from "./scheduling";
import { fullVin } from "./vin";
import type {
  Appointment,
  ExpenseTxn,
  LaborLine,
  TimeLog,
  PartLine,
  PartSku,
  PayType,
  RepairOrder,
  ShopData,
  StoreId,
  Tech,
  Advisor,
  LaborOp,
} from "./types";

function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const PULLMAN_NAMES = [
  "Marisol Vega",
  "Bennett Shaw",
  "Leela Nair",
  "Oscar Lind",
  "Camille Frost",
  "Hector Molina",
  "April Park",
  "Wesley Grant",
  "Fatima Diallo",
  "Colin Briggs",
  "Nadine Kruger",
  "Emilio Vargas",
  "Sasha Petrov",
  "Graham Ellison",
  "Lucia Ferrer",
  "Todd Kimball",
  "Aisha Rahman",
  "Blake Sutton",
  "Miriam Estes",
  "Joel Hart",
  "Keiko Mori",
  "Damon Crowe",
  "Paige Olsson",
  "Ruben Castillo",
  "Ellen Brooks",
  "Simon Adeyemi",
  "Nina Calder",
  "Hugh Dalton",
  "Rosa Melendez",
  "Ian Cho",
  "Beatrice Lang",
  "Omar Farouk",
  "Yara Haddad",
  "Felix Navarro",
  "Gwen Porter",
  "Louis Meyer",
  "Celeste Bowen",
  "Harvey Dunn",
  "Ingrid Solberg",
  "Wyatt Chen",
];

const NAMES = [
  "Helen Cho",
  "Robert Aguilar",
  "Denise Harper",
  "Malik Robinson",
  "Cynthia Walsh",
  "Peter Nguyen",
  "Sandra Delgado",
  "Owen Blake",
  "Patricia Gomez",
  "Frank Iverson",
  "Naomi Keller",
  "Glenn Ortiz",
  "Harriet Cole",
  "Victor Pena",
  "Stephanie Ruiz",
  "Carl Donovan",
  "Melissa Tran",
  "Arthur Singh",
  "Yvonne Parker",
  "Isaac Feldman",
  "Brenda Cowan",
  "Tonya Griffin",
  "Edward Moss",
  "Lila Santos",
  "Howard Peck",
  "Grace Lin",
  "Seth Warner",
  "Diane Okada",
  "Paul Herrera",
  "Ruth Campbell",
  "Kyle Brennan",
  "Anita Desai",
  "Warren Holt",
  "Chloe Martin",
  "Fred Alvarez",
  "June Bartlett",
  "Noah Ellis",
  "Teresa Quinn",
  "Gordon Pike",
  "Evelyn Marsh",
];

const MODELS: { year: number; model: string }[] = [
  { year: 2024, model: "F-150 XLT" },
  { year: 2022, model: "F-150 Lariat" },
  { year: 2025, model: "Explorer ST-Line" },
  { year: 2023, model: "Explorer Limited" },
  { year: 2024, model: "Bronco Big Bend" },
  { year: 2021, model: "Bronco Sport" },
  { year: 2025, model: "Mustang GT" },
  { year: 2020, model: "Mustang EcoBoost" },
  { year: 2023, model: "Escape ST-Line" },
  { year: 2022, model: "Edge SEL" },
  { year: 2024, model: "Maverick XLT" },
  { year: 2021, model: "Ranger Lariat" },
  { year: 2025, model: "Transit 250" },
  { year: 2023, model: "F-250 Lariat" },
  { year: 2022, model: "Expedition Max" },
  { year: 2019, model: "Fusion SE" },
];

interface Job {
  opcode: string;
  description: string;
  hours: number;
  payType: PayType;
  techs: string[];
  parts: { partId: string; qty: number }[];
  weight: number;
}

const JOBS: Job[] = [
  { opcode: "LOF", description: "Engine oil and filter", hours: 0.5, payType: "cp", techs: ["luis", "sam", "priya"], parts: [{ partId: "oil", qty: 1 }, { partId: "filter", qty: 1 }], weight: 26 },
  { opcode: "ROT", description: "Tire rotation", hours: 0.3, payType: "cp", techs: ["luis", "sam"], parts: [], weight: 10 },
  { opcode: "CABIN", description: "Cabin and engine air filters", hours: 0.4, payType: "cp", techs: ["luis", "priya", "sam"], parts: [{ partId: "cabin", qty: 1 }, { partId: "air", qty: 1 }], weight: 8 },
  { opcode: "BRKF", description: "Front brake pads and rotors", hours: 2.3, payType: "cp", techs: ["chris", "elena", "dana", "marcus"], parts: [{ partId: "pads", qty: 1 }, { partId: "rotors", qty: 2 }], weight: 8 },
  { opcode: "BRKR", description: "Rear brake pads", hours: 1.6, payType: "cp", techs: ["chris", "dana", "elena"], parts: [{ partId: "pads-r", qty: 1 }], weight: 4 },
  { opcode: "ALIGN", description: "Four-wheel alignment", hours: 1.2, payType: "cp", techs: ["marcus", "elena"], parts: [], weight: 7 },
  { opcode: "60K", description: "60,000-mile service", hours: 3.2, payType: "cp", techs: ["marcus", "elena", "chris"], parts: [{ partId: "oil", qty: 1 }, { partId: "filter", qty: 1 }, { partId: "plugs", qty: 6 }, { partId: "cabin", qty: 1 }], weight: 3 },
  { opcode: "DSL", description: "Diesel fuel filters and oil", hours: 2.4, payType: "cp", techs: ["andre"], parts: [{ partId: "oil", qty: 2 }, { partId: "fuel", qty: 1 }, { partId: "def", qty: 1 }], weight: 3 },
  { opcode: "DIAG", description: "Drivability diagnosis", hours: 1.1, payType: "cp", techs: ["marcus", "elena", "andre", "chris"], parts: [], weight: 6 },
  { opcode: "BATT", description: "Battery test and replace", hours: 0.6, payType: "cp", techs: ["luis", "priya", "dana"], parts: [{ partId: "battery", qty: 1 }], weight: 3 },
  { opcode: "COOL", description: "Cooling system service", hours: 1.5, payType: "cp", techs: ["chris", "priya", "elena"], parts: [{ partId: "coolant", qty: 2 }], weight: 2 },
  { opcode: "CAMP", description: "Service campaign update", hours: 0.7, payType: "warranty", techs: ["luis", "priya", "sam"], parts: [], weight: 9 },
  { opcode: "WHVAC", description: "Warranty HVAC diagnosis and repair", hours: 2.6, payType: "warranty", techs: ["chris", "elena"], parts: [{ partId: "cabin", qty: 1 }], weight: 3 },
  { opcode: "WDRV", description: "Warranty driveline concern", hours: 4.8, payType: "warranty", techs: ["andre", "marcus"], parts: [{ partId: "fluid", qty: 2 }], weight: 2 },
  { opcode: "WNOI", description: "Warranty noise diagnosis", hours: 1.4, payType: "warranty", techs: ["elena", "chris", "dana"], parts: [], weight: 3 },
  { opcode: "RECON", description: "Internal used-car recon", hours: 2.5, payType: "internal", techs: ["priya", "dana", "chris"], parts: [{ partId: "pads", qty: 1 }, { partId: "wiper", qty: 1 }], weight: 4 },
  { opcode: "PDI", description: "Internal new-vehicle prep", hours: 1.2, payType: "internal", techs: ["sam", "luis", "priya"], parts: [], weight: 3 },
];

export const ADVISOR_NUMBERS: Record<string, string> = {
  jordan: "21",
  megan: "14",
  derek: "8",
  alicia: "30",
};

export const TECH_NUMBERS: Record<string, string> = {
  marcus: "41",
  elena: "18",
  andre: "7",
  chris: "23",
  dana: "15",
  priya: "33",
  luis: "4",
  sam: "11",
};

export function laborCatalog(): LaborOp[] {
  return JOBS.map((job) => ({
    id: `op-${job.opcode.toLowerCase()}`,
    opcode: job.opcode,
    description: job.description,
    hours: job.hours,
    payType: job.payType,
  }));
}

function rateFor(pay: PayType, cp: number, warranty: number, internal: number) {
  if (pay === "cp") return cp;
  if (pay === "warranty") return warranty;
  return internal;
}

function partPrice(cost: number, list: number, pay: PayType) {
  if (pay === "cp") return list;
  if (pay === "warranty") return money2(cost * 1.35);
  return money2(cost * 1.12);
}

function pickJob(rng: () => number) {
  const total = JOBS.reduce((s, j) => s + j.weight, 0);
  let roll = rng() * total;
  for (const job of JOBS) {
    roll -= job.weight;
    if (roll <= 0) return job;
  }
  return JOBS[0];
}

/** The original sample month was anchored on Monday, October 19, 2026. */
const SAMPLE_ANCHOR = "2026-10-19";

function shopDate(iso: string) {
  return addDays(today(), daysBetween(SAMPLE_ANCHOR, iso));
}

function shopStamp(iso: string) {
  const time = iso.split("T")[1] ?? "00:00:00";
  return `${shopDate(iso.slice(0, 10))}T${time}`;
}

/** Keep sample bills inside the current month, and never in the future. */
function expenseOn(iso: string) {
  const shifted = shopDate(iso);
  if (shifted.slice(0, 7) === monthKey() && shifted <= today()) return shifted;
  const day = Number(iso.slice(8, 10));
  if (!Number.isFinite(day) || day > dayOfMonth()) return null;
  return padDay(day);
}

function baseSettings(storeId?: StoreId) {
  const pullman = storeId === "pullman";
  const named = pullman
    ? { storeName: "Jess Ford Pullman", city: "Pullman, WA", phone: "(555) 332-2100", address: "Pullman service drive" }
    : storeId === "grand-coulee"
      ? { storeName: "Jess Ford Grand Coulee", city: "Grand Coulee, WA", phone: "(555) 633-1400", address: "Grand Coulee service drive" }
      : { storeName: "Jess Ford", city: "Washington", phone: "", address: "" };
  return {
    ...named,
    cpRate: pullman ? 175 : 189,
    warrantyRate: pullman ? 155 : 168,
    internalRate: pullman ? 130 : 140,
    targetAbsorption: 1,
    targetElr: pullman ? 165 : 176,
    policyGuide: 0.02,
    fees: DEFAULT_FEES.map((line) => ({ ...line })),
    taxRate: DEFAULT_TAX_RATE,
    scheduling: defaultScheduling(storeId ?? "grand-coulee"),
  };
}

function emailFor(name: string) {
  const slug = name.toLowerCase().replace(/[^a-z]+/g, ".").replace(/^\.|\.$/g, "");
  return `${slug}@example.com`;
}

function scopeShop(shop: ShopData, prefix: string): ShopData {
  if (!prefix) return shop;
  const p = (id: string) => (id ? `${prefix}${id}` : id);
  return {
    ...shop,
    advisors: shop.advisors.map((row) => ({ ...row, id: p(row.id) })),
    techs: shop.techs.map((row) => ({ ...row, id: p(row.id) })),
    customers: shop.customers.map((row) => ({ ...row, id: p(row.id) })),
    vehicles: shop.vehicles.map((row) => ({ ...row, id: p(row.id), customerId: p(row.customerId) })),
    parts: shop.parts.map((row) => ({ ...row, id: p(row.id) })),
    laborOps: shop.laborOps.map((row) => ({ ...row, id: p(row.id) })),
    orders: shop.orders.map((order) => ({
      ...order,
      id: p(order.id),
      advisorId: p(order.advisorId),
      customerId: p(order.customerId),
      vehicleId: p(order.vehicleId),
      jobs: order.jobs.map((job) => ({ ...job, id: p(job.id) })),
      labor: order.labor.map((line) => ({ ...line, id: p(line.id), techId: p(line.techId) })),
      parts: order.parts.map((line) => ({ ...line, id: p(line.id), partId: line.partId ? p(line.partId) : null })),
      inspection: order.inspection ? { ...order.inspection, techId: p(order.inspection.techId) } : null,
    })),
    closedHistory: shop.closedHistory.map((row) => ({ ...row, id: p(row.id), orderId: p(row.orderId) })),
    timeLogs: shop.timeLogs.map((row) => ({ ...row, id: p(row.id), techId: p(row.techId), orderId: p(row.orderId) })),
    appointments: shop.appointments.map((row) => ({
      ...row,
      id: p(row.id),
      customerId: p(row.customerId),
      vehicleId: p(row.vehicleId),
      advisorId: p(row.advisorId),
      techId: p(row.techId),
      orderId: row.orderId ? p(row.orderId) : null,
      laborOpIds: row.laborOpIds.map((id) => p(id)),
      lines: row.lines.map((line) => ({ ...line, id: p(line.id) })),
    })),
  };
}

function workingDaysBeforeToday() {
  const [year, month, day] = today().split("-").map(Number);
  const days: number[] = [];
  for (let cursor = 1; cursor < day; cursor += 1) {
    const weekday = new Date(Date.UTC(year, month - 1, cursor)).getUTCDay();
    if (weekday !== 0) days.push(cursor);
  }
  return days;
}

function buildParts(): PartSku[] {
  return [
    { id: "oil", number: "BL-5W30-5", description: "Synthetic blend 5W-30, 5 qt", bin: "A-12", onHand: 84, onOrder: 24, cost: 22.4, list: 41.95, lastSale: shopDate("2026-10-17"), source: "Motorcraft-type" },
    { id: "filter", number: "BL-FIL-500", description: "Spin-on oil filter", bin: "A-14", onHand: 110, onOrder: 36, cost: 4.15, list: 11.49, lastSale: shopDate("2026-10-17"), source: "Motorcraft-type" },
    { id: "air", number: "BL-AIR-216", description: "Engine air filter, truck", bin: "A-18", onHand: 28, onOrder: 12, cost: 11.2, list: 28.95, lastSale: shopDate("2026-10-16"), source: "Motorcraft-type" },
    { id: "cabin", number: "BL-CAB-79", description: "Cabin air filter", bin: "A-19", onHand: 34, onOrder: 12, cost: 8.4, list: 24.5, lastSale: shopDate("2026-10-17"), source: "Motorcraft-type" },
    { id: "pads", number: "BL-BRK-F15", description: "Front brake pad set, F-150", bin: "B-04", onHand: 11, onOrder: 4, cost: 46, list: 118, lastSale: shopDate("2026-10-15"), source: "Factory" },
    { id: "pads-r", number: "BL-BRK-R15", description: "Rear brake pad set, F-150", bin: "B-05", onHand: 9, onOrder: 4, cost: 38, list: 96, lastSale: shopDate("2026-10-14"), source: "Factory" },
    { id: "rotors", number: "BL-ROT-340", description: "Front brake rotor", bin: "B-08", onHand: 14, onOrder: 8, cost: 58, list: 142, lastSale: shopDate("2026-10-15"), source: "Factory" },
    { id: "plugs", number: "BL-SP-515", description: "Spark plug, each", bin: "C-02", onHand: 72, onOrder: 24, cost: 6.8, list: 16.25, lastSale: shopDate("2026-10-11"), source: "Motorcraft-type" },
    { id: "def", number: "BL-DEF-2", description: "Diesel exhaust fluid, 2.5 gal", bin: "BULK", onHand: 16, onOrder: 8, cost: 11, list: 24.95, lastSale: shopDate("2026-10-17"), source: "Motorcraft-type" },
    { id: "fuel", number: "BL-FUEL-67", description: "Diesel fuel filter kit", bin: "C-11", onHand: 6, onOrder: 2, cost: 42, list: 98, lastSale: shopDate("2026-10-09"), source: "Factory" },
    { id: "coolant", number: "BL-CLN-Y", description: "Yellow predilute coolant, gal", bin: "BULK", onHand: 22, onOrder: 12, cost: 14, list: 29.5, lastSale: shopDate("2026-10-12"), source: "Motorcraft-type" },
    { id: "battery", number: "BL-BAT-H7", description: "H7 battery, truck", bin: "D-01", onHand: 7, onOrder: 4, cost: 112, list: 229, lastSale: shopDate("2026-10-10"), source: "Motorcraft-type" },
    { id: "wiper", number: "BL-WIP-22", description: "Beam wiper blade", bin: "A-03", onHand: 30, onOrder: 12, cost: 7.5, list: 19.95, lastSale: shopDate("2026-10-16"), source: "Other" },
    { id: "fluid", number: "BL-ATF-LV", description: "LV transmission fluid, qt", bin: "BULK", onHand: 40, onOrder: 12, cost: 8.9, list: 18.5, lastSale: shopDate("2026-10-08"), source: "Motorcraft-type" },
    { id: "purge", number: "BL-PUR-88", description: "Purge valve", bin: "SPORD", onHand: 0, onOrder: 1, cost: 64, list: 148, lastSale: shopDate("2026-09-02"), source: "Factory" },
    { id: "trans", number: "BL-10R80", description: "10-speed transmission assembly", bin: "CAGE-1", onHand: 1, onOrder: 0, cost: 3180, list: 4680, lastSale: shopDate("2026-04-12"), source: "Factory" },
    { id: "hose", number: "BL-HSE-TR", description: "Transmission cooler hose kit", bin: "C-22", onHand: 6, onOrder: 0, cost: 74, list: 168, lastSale: shopDate("2025-12-02"), source: "Factory" },
    { id: "cooler", number: "BL-CLR-41", description: "Transmission cooler", bin: "CAGE-2", onHand: 2, onOrder: 0, cost: 410, list: 720, lastSale: shopDate("2026-02-01"), source: "Factory" },
    { id: "clips", number: "BL-CLP-19", description: "Fender liner clip, pack of 10", bin: "Z-04", onHand: 40, onOrder: 0, cost: 9, list: 22, lastSale: shopDate("2025-09-18"), source: "Other" },
  ];
}

function lineParts(job: Job, sku: Map<string, PartSku>, pay: PayType, roKey: string): PartLine[] {
  const lines: PartLine[] = [];
  job.parts.forEach((pick, index) => {
    const part = sku.get(pick.partId);
    if (!part) return;
    lines.push({
      id: `${roKey}-p${index}`,
      partId: part.id,
      number: part.number,
      description: part.description,
      qty: pick.qty,
      cost: part.cost,
      price: partPrice(part.cost, part.list, pay),
      payType: pay,
    });
  });
  return lines;
}

export function createEmptyShop(): ShopData {
  const settings = baseSettings();
  const budgets = [
    { id: "pol", department: "service" as const, category: "Policy adjustments" },
    { id: "sup", department: "service" as const, category: "Shop supplies unrecovered" },
    { id: "lau", department: "service" as const, category: "Laundry and uniforms" },
    { id: "tool", department: "service" as const, category: "Small tools" },
    { id: "train", department: "service" as const, category: "Training" },
    { id: "ads", department: "service" as const, category: "Clinics and advertising" },
    { id: "equip", department: "service" as const, category: "Equipment repair" },
    { id: "misc", department: "service" as const, category: "Miscellaneous service" },
    { id: "obs", department: "parts" as const, category: "Obsolescence write-down" },
    { id: "frt", department: "parts" as const, category: "Freight unrecovered" },
    { id: "psup", department: "parts" as const, category: "Parts counter supplies" },
    { id: "ppol", department: "parts" as const, category: "Parts policy" },
  ];
  const overhead = [
    { id: "oh-adv", name: "Advisors and service office" },
    { id: "oh-pts", name: "Parts salaries" },
    { id: "oh-occ", name: "Occupancy charged to fixed ops" },
    { id: "oh-ins", name: "Insurance and admin benefits" },
    { id: "oh-utl", name: "Utilities" },
  ];
  return {
    dataset: "shop",
    settings,
    advisors: [],
    techs: [],
    customers: [],
    vehicles: [],
    parts: [],
    laborOps: [],
    payTypes: defaultPayTypes(settings),
    orders: [],
    closedHistory: [],
    timeLogs: [],
    appointments: [],
    expenses: [],
    budgets: budgets.map((row) => ({ ...row, monthly: 0 })),
    overhead: overhead.map((row) => ({ ...row, monthly: 0 })),
    campaigns: [],
  };
}

export function createSeed(storeId: StoreId = "grand-coulee"): ShopData {
  const pullman = storeId === "pullman";
  const settings = baseSettings(storeId);
  const names = pullman ? PULLMAN_NAMES : NAMES;
  const noMobile = new Set(pullman ? [0, 4, 15] : [2, 11, 29]);

  const advisors: Advisor[] = pullman
    ? [
        { id: "jordan", number: "12", name: "Riley Chen", base: 4600, laborPercent: 5.5, partsPercent: 2.5 },
        { id: "megan", number: "19", name: "Noah Briggs", base: 4400, laborPercent: 5, partsPercent: 2 },
        { id: "derek", number: "27", name: "Tara Singh", base: 4300, laborPercent: 5, partsPercent: 2 },
        { id: "alicia", number: "33", name: "Evan Cho", base: 4100, laborPercent: 4.5, partsPercent: 2 },
      ]
    : [
        { id: "jordan", number: "21", name: "Jordan Hale", base: 4800, laborPercent: 6, partsPercent: 3 },
        { id: "megan", number: "14", name: "Megan Cho", base: 4500, laborPercent: 5, partsPercent: 2 },
        { id: "derek", number: "8", name: "Derek Lang", base: 4200, laborPercent: 5, partsPercent: 2 },
        { id: "alicia", number: "30", name: "Alicia Nguyen", base: 4000, laborPercent: 4.5, partsPercent: 2 },
      ];

  const techs: Tech[] = pullman
    ? [
        { id: "marcus", number: "52", name: "Holly Grant", skill: "master", board: "main", payStyle: "flat", flagRate: 34, hourlyRate: 34, availableHoursMonth: 118, clockedHoursMonth: 0, clockedToday: 2.5 },
        { id: "elena", number: "16", name: "Mina Park", skill: "a", board: "main", payStyle: "flat", flagRate: 31, hourlyRate: 31, availableHoursMonth: 118, clockedHoursMonth: 0, clockedToday: 3 },
        { id: "andre", number: "9", name: "Cole Jensen", skill: "diesel", board: "main", payStyle: "flat", flagRate: 32, hourlyRate: 32, availableHoursMonth: 110, clockedHoursMonth: 0, clockedToday: 4 },
        { id: "chris", number: "28", name: "Wes Alvarez", skill: "b", board: "main", payStyle: "flat", flagRate: 26, hourlyRate: 26, availableHoursMonth: 118, clockedHoursMonth: 0, clockedToday: 3.5 },
        { id: "dana", number: "44", name: "Ivy Nguyen", skill: "b", board: "none", payStyle: "hourly", flagRate: 25, hourlyRate: 28, availableHoursMonth: 96, clockedHoursMonth: 0, clockedToday: 2 },
        { id: "priya", number: "21", name: "Omar Haddad", skill: "a", board: "internal", payStyle: "flat", flagRate: 29, hourlyRate: 29, availableHoursMonth: 112, clockedHoursMonth: 0, clockedToday: 3 },
        { id: "luis", number: "6", name: "Bea Collins", skill: "express", board: "express", payStyle: "hourly", flagRate: 22, hourlyRate: 24, availableHoursMonth: 122, clockedHoursMonth: 0, clockedToday: 4.5 },
        { id: "sam", number: "13", name: "Nate Fuller", skill: "quick", board: "express", payStyle: "hourly", flagRate: 20, hourlyRate: 22, availableHoursMonth: 118, clockedHoursMonth: 0, clockedToday: 3 },
      ]
    : [
        { id: "marcus", number: "41", name: "Marcus Hale", skill: "master", board: "main", payStyle: "flat", flagRate: 36, hourlyRate: 36, availableHoursMonth: 118, clockedHoursMonth: 0, clockedToday: 3.5 },
        { id: "elena", number: "18", name: "Elena Voss", skill: "a", board: "main", payStyle: "flat", flagRate: 32, hourlyRate: 32, availableHoursMonth: 118, clockedHoursMonth: 0, clockedToday: 4 },
        { id: "andre", number: "7", name: "Andre Brooks", skill: "diesel", board: "main", payStyle: "flat", flagRate: 33, hourlyRate: 33, availableHoursMonth: 110, clockedHoursMonth: 0, clockedToday: 3 },
        { id: "chris", number: "23", name: "Chris Dalton", skill: "b", board: "main", payStyle: "flat", flagRate: 27, hourlyRate: 27, availableHoursMonth: 118, clockedHoursMonth: 0, clockedToday: 4.5 },
        { id: "dana", number: "15", name: "Dana Whitfield", skill: "b", board: "none", payStyle: "hourly", flagRate: 26, hourlyRate: 29, availableHoursMonth: 96, clockedHoursMonth: 0, clockedToday: 4 },
        { id: "priya", number: "33", name: "Priya Shah", skill: "a", board: "internal", payStyle: "flat", flagRate: 28, hourlyRate: 28, availableHoursMonth: 112, clockedHoursMonth: 0, clockedToday: 2.5 },
        { id: "luis", number: "4", name: "Luis Ortega", skill: "express", board: "express", payStyle: "hourly", flagRate: 22, hourlyRate: 24, availableHoursMonth: 122, clockedHoursMonth: 0, clockedToday: 4 },
        { id: "sam", number: "11", name: "Sam Okonkwo", skill: "quick", board: "express", payStyle: "hourly", flagRate: 20, hourlyRate: 22, availableHoursMonth: 118, clockedHoursMonth: 0, clockedToday: 3.5 },
      ];

  const customers = names.map((name, i) => {
    const phone = `(555) ${pullman ? "332" : "201"}-${String((pullman ? 2200 : 1400) + i).slice(-4)}`;
    return {
      id: `c${i + 1}`,
      name,
      phone,
      mobile: noMobile.has(i) ? "" : phone,
      email: emailFor(name),
    };
  });

  const vehicles = names.map((_, i) => {
    const model = MODELS[(i + (pullman ? 3 : 0)) % MODELS.length];
    return {
      id: `v${i + 1}`,
      customerId: `c${i + 1}`,
      year: model.year,
      model: model.model,
      vin: fullVin({
        prefix: pullman ? "1FTPULMN" : "1FTAB12C",
        year: model.year,
        plant: pullman ? "P" : "G",
        serial: i + 1,
      }),
    };
  });

  const parts = buildParts();
  const sku = new Map(parts.map((part) => [part.id, part]));
  const rng = mulberry32(pullman ? 20261027 : 20261019);
  const advisorIds = advisors.map((a) => a.id);
  const orders: Array<Omit<RepairOrder, "bay" | "mileageOut" | "fees" | "taxRate">> = [];
  let seq = pullman ? 318000 : 241200;

  for (const day of workingDaysBeforeToday()) {
    const [year, month] = today().split("-").map(Number);
    const wd = new Date(Date.UTC(year, month - 1, day)).getUTCDay();
    const count = wd === 6 ? 16 + Math.floor(rng() * 5) : 26 + Math.floor(rng() * 8);
    for (let n = 0; n < count; n += 1) {
      seq += 1;
      const customerIndex = Math.floor(rng() * customers.length);
      const job = pickJob(rng);
      const extra = rng() < 0.22 ? pickJob(rng) : null;
      const jobs = extra && extra.opcode !== job.opcode ? [job, extra] : [job];
      const roKey = `h${seq}`;
      const labor: LaborLine[] = [];
      const partLines: PartLine[] = [];
      jobs.forEach((item, index) => {
        const techId = item.techs[Math.floor(rng() * item.techs.length)];
        const hours = money2(item.hours * (0.86 + rng() * 0.28));
        labor.push({
          id: `${roKey}-l${index}`,
          opcode: item.opcode,
          description: item.description,
          hours,
          rate: rateFor(item.payType, settings.cpRate, settings.warrantyRate, settings.internalRate),
          payType: item.payType,
          techId,
        });
        partLines.push(...lineParts(item, sku, item.payType, `${roKey}-${index}`));
      });
      const story = jobs.map((item, index) => jobLine(
        `${roKey}-j${index}`,
        lineLetter(index),
        item.description,
        `Confirmed ${item.description.toLowerCase()}.`,
        `Completed ${item.description.toLowerCase()}.`,
      ));
      orders.push({
        id: roKey,
        number: seq,
        openedOn: padDay(day),
        promiseTime: "",
        status: "invoiced",
        advisorId: advisorIds[Math.floor(rng() * advisorIds.length)],
        customerId: customers[customerIndex].id,
        vehicleId: vehicles[customerIndex].id,
        concern: concernFromJobs(story),
        jobs: story,
        mileage: 14000 + Math.floor(rng() * 86000),
        labor,
        parts: partLines,
        invoicedOn: padDay(day),
        stockApplied: true,
        inspection: null,
      });
    }
  }

  const flagged = new Map<string, number>();
  for (const order of orders) {
    for (const line of order.labor) {
      flagged.set(line.techId, (flagged.get(line.techId) ?? 0) + line.hours);
    }
  }
  const effTarget: Record<string, number> = {
    marcus: 1.26,
    elena: 1.14,
    andre: 1.08,
    chris: 0.98,
    dana: 0.76,
    priya: 0.91,
    luis: 1.22,
    sam: 0.6,
  };
  for (const tech of techs) {
    const flags = flagged.get(tech.id) ?? 0;
    const target = effTarget[tech.id];
    if (tech.payStyle === "flat") {
      tech.clockedHoursMonth = money2(flags / target);
    } else {
      const fromEff = flags / target;
      const floor = tech.availableHoursMonth * 0.82;
      tech.clockedHoursMonth = money2(Math.max(fromEff, floor));
    }
  }

  const openSeeds: Array<Omit<RepairOrder, "inspection" | "bay" | "mileageOut" | "fees" | "taxRate">> = [
    {
      id: "open-helen",
      number: seq + 1,
      openedOn: shopDate("2026-10-19"),
      promiseTime: "14:00",
      status: "working",
      advisorId: "megan",
      customerId: "c1",
      vehicleId: "v1",
      concern: "Brake pulsation at highway speed",
      jobs: [jobLine("oh-a", "A", "Brake pulsation at highway speed", "Left front pads are down to the rotor. Both front rotors have thickness variation.", "Replace the front pads and both front rotors, then road test for pulsation.")],
      mileage: 41220,
      labor: [
        { id: "oh-l1", opcode: "BRKF", description: "Front brake pads and rotors", hours: 1.4, rate: 189, payType: "cp", techId: "chris" },
      ],
      parts: [
        { id: "oh-p1", partId: "pads", number: "BL-BRK-F15", description: "Front brake pad set, F-150", qty: 1, cost: 46, price: 118, payType: "cp" },
        { id: "oh-p2", partId: "rotors", number: "BL-ROT-340", description: "Front brake rotor", qty: 2, cost: 58, price: 142, payType: "cp" },
      ],
      invoicedOn: null,
      stockApplied: false,
    },
    {
      id: "open-pat",
      number: seq + 2,
      openedOn: shopDate("2026-10-19"),
      promiseTime: "11:30",
      status: "ready",
      advisorId: "alicia",
      customerId: "c9",
      vehicleId: "v9",
      concern: "30,000-mile oil service · Cabin and engine air filters",
      jobs: [
        jobLine("op-a", "A", "30,000-mile oil service", "Due for the 30,000-mile service.", "Changed the oil and filter."),
        jobLine("op-b", "B", "Cabin and engine air filters", "Cabin filter is loaded.", "Replaced the cabin and engine air filters."),
      ],
      mileage: 30110,
      labor: [
        { id: "op-l1", opcode: "LOF", description: "Engine oil and filter", hours: 0.6, rate: 189, payType: "cp", techId: "luis" },
        { id: "op-l2", opcode: "CABIN", description: "Cabin and engine air filters", hours: 0.4, rate: 189, payType: "cp", techId: "luis" },
      ],
      parts: [
        { id: "op-p1", partId: "oil", number: "BL-5W30-5", description: "Synthetic blend 5W-30, 5 qt", qty: 1, cost: 22.4, price: 41.95, payType: "cp" },
        { id: "op-p2", partId: "filter", number: "BL-FIL-500", description: "Spin-on oil filter", qty: 1, cost: 4.15, price: 11.49, payType: "cp" },
        { id: "op-p3", partId: "cabin", number: "BL-CAB-79", description: "Cabin air filter", qty: 1, cost: 8.4, price: 24.5, payType: "cp" },
      ],
      invoicedOn: null,
      stockApplied: false,
    },
    {
      id: "open-carl",
      number: seq + 3,
      openedOn: shopDate("2026-10-19"),
      promiseTime: "10:00",
      status: "ready",
      advisorId: "derek",
      customerId: "c16",
      vehicleId: "v16",
      concern: "Service campaign update",
      jobs: [jobLine("oc-a", "A", "Service campaign update", "Open campaign. No drivability complaint.", "Campaign software update is complete.")],
      mileage: 18640,
      labor: [
        { id: "oc-l1", opcode: "CAMP", description: "Service campaign update", hours: 0.6, rate: 168, payType: "warranty", techId: "luis" },
      ],
      parts: [],
      invoicedOn: null,
      stockApplied: false,
    },
    {
      id: "open-sandra",
      number: seq + 4,
      openedOn: shopDate("2026-10-19"),
      promiseTime: "15:00",
      status: "open",
      advisorId: "jordan",
      customerId: "c7",
      vehicleId: "v7",
      concern: "Rattle over bumps, front end",
      jobs: [jobLine("os-a", "A", "Rattle over bumps, front end")],
      mileage: 55210,
      labor: [],
      parts: [],
      invoicedOn: null,
      stockApplied: false,
    },
    {
      id: "open-ruth",
      number: seq + 5,
      openedOn: shopDate("2026-10-17"),
      promiseTime: "16:30",
      status: "working",
      advisorId: "jordan",
      customerId: "c30",
      vehicleId: "v30",
      concern: "DEF warning · Incomplete regen",
      jobs: [
        jobLine("od-a", "A", "DEF warning", "DEF was low.", "Filled the DEF."),
        jobLine("od-b", "B", "Incomplete regen", "The fuel filter is restricted. The regen will not finish.", "Replaced the fuel filter. Regen completed on a road test."),
      ],
      mileage: 64002,
      labor: [
        { id: "od-l1", opcode: "DSL", description: "Diesel diagnosis and service", hours: 2.5, rate: 189, payType: "cp", techId: "andre" },
      ],
      parts: [
        { id: "od-p1", partId: "def", number: "BL-DEF-2", description: "Diesel exhaust fluid, 2.5 gal", qty: 1, cost: 11, price: 24.95, payType: "cp" },
        { id: "od-p2", partId: "fuel", number: "BL-FUEL-67", description: "Diesel fuel filter kit", qty: 1, cost: 42, price: 98, payType: "cp" },
      ],
      invoicedOn: null,
      stockApplied: false,
    },
    {
      id: "open-malik",
      number: seq + 6,
      openedOn: shopDate("2026-10-15"),
      promiseTime: "17:00",
      status: "parts",
      advisorId: "megan",
      customerId: "c4",
      vehicleId: "v4",
      concern: "Check engine light, runs rough — purge valve on order",
      jobs: [jobLine("om-a", "A", "Check engine light, runs rough — purge valve on order", "Purge valve sticks open. Codes show a rich condition.", "Diagnosis is on the ticket. The valve is on order.")],
      mileage: 28840,
      labor: [
        { id: "om-l1", opcode: "DIAG", description: "Drivability diagnosis", hours: 1.2, rate: 189, payType: "cp", techId: "elena" },
      ],
      parts: [
        { id: "om-p1", partId: "purge", number: "BL-PUR-88", description: "Purge valve", qty: 1, cost: 64, price: 148, payType: "cp" },
      ],
      invoicedOn: null,
      stockApplied: false,
    },
    {
      id: "open-owen",
      number: seq + 7,
      openedOn: shopDate("2026-10-16"),
      promiseTime: "",
      status: "working",
      advisorId: "jordan",
      customerId: "c8",
      vehicleId: "v8",
      concern: "Internal used-car recon for the front line",
      jobs: [jobLine("oo-a", "A", "Internal used-car recon for the front line", "Front-line recon. Both wiper blades are torn.", "Replaced both wiper blades. Detail is still open.")],
      mileage: 22190,
      labor: [
        { id: "oo-l1", opcode: "RECON", description: "Internal used-car recon", hours: 1.6, rate: 140, payType: "internal", techId: "priya" },
      ],
      parts: [
        { id: "oo-p1", partId: "wiper", number: "BL-WIP-22", description: "Beam wiper blade", qty: 2, cost: 7.5, price: money2(7.5 * 1.12), payType: "internal" },
      ],
      invoicedOn: null,
      stockApplied: false,
    },
    {
      id: "open-frank",
      number: seq + 8,
      openedOn: shopDate("2026-10-13"),
      promiseTime: "12:00",
      status: "parts",
      advisorId: "derek",
      customerId: "c10",
      vehicleId: "v10",
      concern: "AC blows warm. Warranty. Condenser backordered.",
      jobs: [jobLine("of-a", "A", "AC blows warm. Warranty. Condenser backordered.", "The condenser is leaking. The replacement is backordered.")],
      mileage: 73440,
      labor: [
        { id: "of-l1", opcode: "WHVAC", description: "Warranty HVAC diagnosis and repair", hours: 2.2, rate: 168, payType: "warranty", techId: "chris" },
      ],
      parts: [],
      invoicedOn: null,
      stockApplied: false,
    },
  ];

  const open = openSeeds.map((order) => ({ ...order, inspection: demoSheet(order.id) }));

  function appt(
    id: string,
    time: string,
    minutes: number,
    customerId: string,
    vehicleId: string,
    advisorId: string,
    concerns: string[],
    lane: Appointment["lane"],
    status: Appointment["status"],
    orderId: string | null,
    techId: string,
    opcodes: string[] = [],
    date = shopDate("2026-10-19"),
  ): Appointment {
    const lines = concerns.map((concern, index) => ({ id: `${id}-${lineLetter(index).toLowerCase()}`, code: lineLetter(index), concern }));
    return {
      id, date, time: snapHalfHour(time), minutes, customerId, vehicleId, advisorId, lane, status, orderId, lines,
      concern: concernFromLines(lines),
      vin: "",
      laborOpIds: opcodes.map((code) => `op-${code.toLowerCase()}`),
      techId,
    };
  }

  const appointments: Appointment[] = [
    appt("a1", "07:20", 30, "c20", "v20", "megan", ["Oil change"], "waiter", "no_show", null, "luis", ["LOF"]),
    appt("a2", "07:30", 150, "c1", "v1", "megan", ["Brake pulsation at highway speed"], "drop", "in_shop", "open-helen", "chris", ["BRKF"]),
    appt("a3", "07:45", 90, "c9", "v9", "alicia", ["30,000-mile service"], "waiter", "in_shop", "open-pat", "priya", ["LOF", "CABIN"]),
    appt("a4", "08:15", 60, "c16", "v16", "derek", ["Service campaign update"], "waiter", "in_shop", "open-carl", "sam", ["CAMP"]),
    appt("a5", "08:40", 120, "c7", "v7", "jordan", ["Rattle over bumps", "Check the front alignment"], "drop", "in_shop", "open-sandra", "elena", ["WNOI", "ALIGN"]),
    appt("a6", "09:10", 60, "c12", "v12", "megan", ["Oil and rotation"], "waiter", "scheduled", null, "marcus", ["LOF", "ROT"], shopDate("2026-10-19")),
    appt("a7", "09:40", 150, "c13", "v13", "jordan", ["Diesel service", "DEF light on"], "drop", "scheduled", null, "andre", ["DSL"], shopDate("2026-10-20")),
    appt("a8", "10:30", 120, "c6", "v6", "derek", ["Clunk from the front end"], "drop", "scheduled", null, "marcus", ["DIAG"], shopDate("2026-10-20")),
    appt("a9", "11:00", 90, "c15", "v15", "alicia", ["Oil change, waiter"], "waiter", "scheduled", null, "luis", ["LOF"], shopDate("2026-10-21")),
    appt("a10", "13:00", 180, "c23", "v23", "jordan", ["AC blows warm", "Check the cabin filter"], "drop", "scheduled", null, "chris", ["WHVAC", "CABIN"], shopDate("2026-10-22")),
  ];

  const budgets = [
    { id: "pol", department: "service" as const, category: "Policy adjustments", monthly: 2800 },
    { id: "sup", department: "service" as const, category: "Shop supplies unrecovered", monthly: 1900 },
    { id: "lau", department: "service" as const, category: "Laundry and uniforms", monthly: 950 },
    { id: "tool", department: "service" as const, category: "Small tools", monthly: 700 },
    { id: "train", department: "service" as const, category: "Training", monthly: 800 },
    { id: "ads", department: "service" as const, category: "Clinics and advertising", monthly: 2200 },
    { id: "equip", department: "service" as const, category: "Equipment repair", monthly: 1400 },
    { id: "misc", department: "service" as const, category: "Miscellaneous service", monthly: 500 },
    { id: "obs", department: "parts" as const, category: "Obsolescence write-down", monthly: 1600 },
    { id: "frt", department: "parts" as const, category: "Freight unrecovered", monthly: 900 },
    { id: "psup", department: "parts" as const, category: "Parts counter supplies", monthly: 450 },
    { id: "ppol", department: "parts" as const, category: "Parts policy", monthly: 400 },
  ];

  const expenses: ExpenseTxn[] = [
    { id: "e1", budgetId: "pol", date: expenseOn("2026-10-03") ?? "", vendor: "Customer goodwill", amount: 1850, note: "Repeat brake visit written off" },
    { id: "e2", budgetId: "pol", date: expenseOn("2026-10-08") ?? "", vendor: "Customer goodwill", amount: 960, note: "Comeback alignment, no charge" },
    { id: "e3", budgetId: "pol", date: expenseOn("2026-10-14") ?? "", vendor: "Enterprise", amount: 1420, note: "Rental while waiting on a part" },
    { id: "e4", budgetId: "pol", date: expenseOn("2026-10-16") ?? "", vendor: "Customer goodwill", amount: 780, note: "Deductible assistance" },
    { id: "e5", budgetId: "sup", date: expenseOn("2026-10-02") ?? "", vendor: "Shop supply house", amount: 640, note: "Brake clean, gloves, nuts" },
    { id: "e6", budgetId: "sup", date: expenseOn("2026-10-10") ?? "", vendor: "Cintas", amount: 410, note: "Shop towels" },
    { id: "e7", budgetId: "lau", date: expenseOn("2026-10-06") ?? "", vendor: "Cintas", amount: 480, note: "Uniform service" },
    { id: "e8", budgetId: "lau", date: expenseOn("2026-10-17") ?? "", vendor: "Cintas", amount: 420, note: "Uniform service" },
    { id: "e9", budgetId: "tool", date: expenseOn("2026-10-09") ?? "", vendor: "Snap-on", amount: 860, note: "Torque wrench set for the diesel bay" },
    { id: "e10", budgetId: "ads", date: expenseOn("2026-10-04") ?? "", vendor: "Local radio", amount: 600, note: "Service clinic deposit" },
    { id: "e11", budgetId: "equip", date: expenseOn("2026-10-11") ?? "", vendor: "Hunter Engineering", amount: 2450, note: "Alignment rack sensor" },
    { id: "e12", budgetId: "misc", date: expenseOn("2026-10-07") ?? "", vendor: "Petty cash", amount: 80, note: "Keys and a lock cylinder" },
    { id: "e13", budgetId: "obs", date: expenseOn("2026-10-15") ?? "", vendor: "Inventory", amount: 3900, note: "Write-down on the 10-speed and cooler stock" },
    { id: "e14", budgetId: "frt", date: expenseOn("2026-10-07") ?? "", vendor: "Dealer special order", amount: 540, note: "Freight not billed on the RO" },
    { id: "e15", budgetId: "psup", date: expenseOn("2026-10-05") ?? "", vendor: "Office supply", amount: 210, note: "Counter forms and labels" },
  ].filter((row) => row.date);

  const overhead = [
    { id: "oh-adv", name: "Advisors and service office", monthly: 62000 },
    { id: "oh-pts", name: "Parts salaries", monthly: 34000 },
    { id: "oh-occ", name: "Occupancy charged to fixed ops", monthly: 48000 },
    { id: "oh-ins", name: "Insurance and admin benefits", monthly: 22000 },
    { id: "oh-utl", name: "Utilities", monthly: 9000 },
  ];

  const finished = [...open, ...orders].map((order) => ({
    ...order,
    bay: bayFromStatus(order.status),
    mileageOut: order.status === "invoiced" || order.status === "ready" ? order.mileage + 4 : null,
    fees: settings.fees.map((line) => ({ ...line })),
    taxRate: settings.taxRate,
  }));

  return scopeShop({
    dataset: "sample",
    settings,
    advisors,
    techs,
    customers,
    vehicles,
    parts,
    laborOps: laborCatalog(),
    payTypes: defaultPayTypes(settings),
    orders: finished,
    closedHistory: finished.filter((order) => order.status === "invoiced").map((order) => closedRecord(
      order,
      customers.find((row) => row.id === order.customerId),
      vehicles.find((row) => row.id === order.vehicleId),
    )),
    timeLogs: [
      { id: "clk-luis-1", techId: "luis", orderId: "open-carl", startedAt: shopStamp("2026-10-19T07:12:00"), endedAt: shopStamp("2026-10-19T08:05:00") },
      { id: "clk-luis-2", techId: "luis", orderId: "open-pat", startedAt: shopStamp("2026-10-19T08:10:00"), endedAt: null },
      { id: "clk-andre", techId: "andre", orderId: "open-ruth", startedAt: shopStamp("2026-10-19T07:40:00"), endedAt: null },
      { id: "clk-chris", techId: "chris", orderId: "open-helen", startedAt: shopStamp("2026-10-19T09:05:00"), endedAt: shopStamp("2026-10-19T10:20:00") },
    ] satisfies TimeLog[],
    appointments: appointments.map((row) => ({
      ...row,
      vin: vehicles.find((vehicle) => vehicle.id === row.vehicleId)?.vin ?? "",
    })),
    expenses,
    budgets,
    overhead,
    campaigns: [],
  }, pullman ? "pl-" : "");
}
