import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import { advisorBookingNote, assessAppointment, overrideReason, staffBlockMessage, type CapacityResult } from "./capacity";
import { bookingConcernError, vehicleBookingError } from "./booking";
import { ARRIVED_CANCEL_CONFIRM, CANCEL_NOTE_MAX, CANCELLED_LOCKED, cancelInputError, deskActor, mayCancelAppointment, mayCloseRepairOrder, normalizeCancelHistory, repairOrderCancelBlock, repairOrderReinstateBlock } from "./cancel";
import { now } from "./clock";
import { makeOnlineCode, submitOnlineRequest, type OnlineRequestInput } from "./online-request";
import { decisionNotice, planApproval, reminderMethod, reminderNotice, tomorrowIso } from "./notices";
import { money2, snapHalfHour, bayFromStatus, DEFAULT_FEES, DEFAULT_TAX_RATE, localStamp, today } from "./format";
import { concernFromJobs, concernFromLines, jobLine, lineLetter, nextLineCode, type JobLine } from "./jobs";
import { blankWa, normalizeWa, type ExtraAuth, type WaRecord } from "./wa";
import { blankSheet, demoSheet, type MpiPoint } from "./mpi";
import { defaultPayTypes } from "./pay";
import { laborCatalog, createEmptyShop, createSeed, ADVISOR_NUMBERS, TECH_NUMBERS } from "./seed";
import { addClosedDate, addOnlineService, addTransportOption, laneLabel, normalizeLane, normalizeScheduling, patchBookingWindow, patchDayHours, removeClosedDate, removeOnlineService, removeTransportOption, renameTransportOption, updateOnlineService } from "./scheduling";
import { fullVin } from "./vin";
import { isDemoMode } from "./demo";
import { browserLocalStorage, SHOP_STORAGE_KEY, shopPersistStorage, type ShopStorage } from "./shop-storage";
import { bookRepairOrder, closeRepairOrder, closeRepairOrderWithNoWork, dropClosedHistory, noWorkCloseError, reopenRepairOrder, unbookRepairOrder } from "./ro";
import { closedRecord } from "./metrics";
import type { Advisor, Appointment, AppointmentCancel, BookingWindow, Campaign, CancelReason, ClosedRecord, DayHours, ExpenseTxn, FeeLine, LaborLine, LaborOp, OnlineService, OverrideRecord, PartLine, PartSku, PayKind, RepairOrder, RoCloseType, RoHistoryEntry, RoPayment, RoStatus, ShopData, StoreId, Tech, TechBoard, WeekdayIndex } from "./types";

export interface NewOrderInput {
  customerId: string;
  vehicleId: string;
  advisorId: string;
  lines: { concern: string }[];
  mileage: number;
  mileageOut?: number | null;
  promiseTime: string;
  labor?: Omit<LaborLine, "id">[];
}

export interface NewCustomerInput {
  name: string;
  phone: string;
  year: number;
  model: string;
  mobile?: string;
  email?: string;
}

interface ShopActions {
  focusOrderId: string | null;
  activeStoreId: StoreId;
  stores: Record<StoreId, ShopData>;
  setFocus: (id: string | null) => void;
  switchStore: (id: StoreId) => void;
  updateSettings: (patch: Partial<ShopData["settings"]>) => void;
  updateDayHours: (weekday: WeekdayIndex, patch: Partial<Pick<DayHours, "closed" | "open" | "close">>) => void;
  addClosedDate: (iso: string) => boolean;
  removeClosedDate: (iso: string) => void;
  updateBookingWindow: (patch: Partial<BookingWindow>) => void;
  addOnlineService: (input: { name: string; laborHours: number }) => boolean;
  updateOnlineService: (id: string, patch: Partial<Pick<OnlineService, "name" | "laborHours">>) => boolean;
  removeOnlineService: (id: string) => void;
  addTransportOption: (name: string) => boolean;
  renameTransportOption: (id: string, name: string) => boolean;
  removeTransportOption: (id: string) => boolean;
  clockTech: (techId: string, hours: number) => void;
  addTech: (input: Pick<Tech, "number" | "name" | "skill" | "payStyle" | "flagRate" | "hourlyRate" | "board">) => boolean;
  updateTech: (id: string, patch: Partial<Pick<Tech, "number" | "name" | "skill" | "payStyle" | "flagRate" | "hourlyRate" | "board">>) => boolean;
  removeTech: (id: string) => "ok" | "used" | "appointments";
  addAdvisor: (input: Pick<Advisor, "number" | "name" | "base" | "laborPercent" | "partsPercent">) => boolean;
  updateAdvisor: (id: string, patch: Partial<Pick<Advisor, "number" | "name" | "base" | "laborPercent" | "partsPercent">>) => boolean;
  removeAdvisor: (id: string) => "ok" | "used";
  updateOrder: (orderId: string, patch: Partial<Pick<RepairOrder, "concern" | "mileage" | "mileageOut" | "promiseTime" | "advisorId" | "status" | "bay">>) => void;
  updateJob: (orderId: string, jobId: string, patch: Partial<Pick<JobLine, "concern" | "cause" | "correction">>) => void;
  addJob: (orderId: string) => void;
  removeJob: (orderId: string, jobId: string) => void;
  updateWa: (orderId: string, patch: Partial<Omit<WaRecord, "extras">>) => void;
  addExtraAuth: (orderId: string, input: Omit<ExtraAuth, "id">) => void;
  /** Month close only counts Closed repair orders. It does not change a status. */
  invoiceOrder: (orderId: string) => void;
  bookOrder: (orderId: string) => void;
  unbookOrder: (orderId: string) => void;
  reopenOrder: (orderId: string) => void;
  /** Advisor close. Booked becomes Closed only when the required fields are complete. */
  closeOrder: (orderId: string) => { ok: boolean; error: string | null };
  /** $0 close for an open or booked repair order with no work. The RO number stays. */
  closeOrderWithNoWork: (orderId: string, note: string) => { ok: boolean; error: string | null };
  addLabor: (orderId: string, line: Omit<LaborLine, "id">) => void;
  updateLabor: (orderId: string, lineId: string, patch: Partial<LaborLine>) => void;
  removeLabor: (orderId: string, lineId: string) => void;
  clockIn: (techId: string, orderId: string) => void;
  clockOut: (techId: string) => void;
  addPartLine: (orderId: string, line: Omit<PartLine, "id">) => void;
  updatePartLine: (orderId: string, lineId: string, patch: Partial<PartLine>) => void;
  removePartLine: (orderId: string, lineId: string) => void;
  addLaborOp: (op: Omit<LaborOp, "id">) => void;
  updateLaborOp: (id: string, patch: Partial<Omit<LaborOp, "id">>) => void;
  removeLaborOp: (id: string) => void;
  addPayType: (input: { name: string; rate: number; kind: PayKind }) => boolean;
  addFee: (input: { name: string; amount: number }) => boolean;
  updateFee: (id: string, patch: Partial<Pick<FeeLine, "name" | "amount" | "cap">>) => void;
  removeFee: (id: string) => void;
  updatePayType: (id: string, patch: Partial<{ name: string; rate: number; kind: PayKind }>) => void;
  removePayType: (id: string) => "ok" | "used" | "last";
  attachInspection: (orderId: string) => void;
  setInspectionTech: (orderId: string, techId: string) => void;
  setInspectionPoint: (orderId: string, pointId: string, patch: Partial<Pick<MpiPoint, "status" | "reading" | "note">>) => void;
  createOrder: (input: NewOrderInput) => string;
  createCustomer: (input: NewCustomerInput) => { customerId: string; vehicleId: string };
  setAppointmentStatus: (id: string, status: ShopData["appointments"][number]["status"]) => void;
  moveAppointment: (id: string, patch: Partial<Pick<Appointment, "date" | "time" | "minutes" | "techId">>) => { ok: boolean; error: string | null };
  updateAppointment: (id: string, patch: Partial<Omit<Appointment, "id" | "orderId">>) => { ok: boolean; error: string | null };
  addAppointment: (input: Omit<ShopData["appointments"][number], "id" | "orderId" | "status">, id?: string) => string;
  /** Advisor book or edit. Off-store staff is refused. A capacity warning still saves and records an override. */
  saveAdvisorAppointment: (input: Omit<Appointment, "id" | "orderId">, existingId?: string) => { ok: boolean; appointmentId: string; overrideId: string | null; error: string | null };
  cancelAppointment: (id: string, input: { reason: CancelReason; note?: string }, confirmArrived?: boolean) => { ok: boolean; error: string | null; arrivedConfirm: string | null };
  reinstateAppointment: (id: string, confirmOverride?: boolean) => { ok: boolean; overrideId: string | null; error: string | null; warning: string | null };
  setWorkingAs: (id: string) => void;
  issueOnlineChallenge: (customerId: string) => { ok: true; code: string; mobileLast4: string } | { ok: false; reason: "unknown" | "no-mobile" };
  addOnlineRequest: (input: OnlineRequestInput) => { ok: true; id: string } | { ok: false; reason: string };
  approveOnlineRequest: (id: string, linkCustomerId?: string) => { ok: true; appointmentId: string; noticeId: string } | { ok: false; reason: string };
  declineOnlineRequest: (id: string) => { ok: true; noticeId: string } | { ok: false; reason: string };
  simulateDayBeforeReminders: () => { created: number };
  linkAppointment: (id: string, orderId: string) => void;
  setOnHand: (partId: string, onHand: number) => void;
  addSku: (sku: Omit<PartSku, "id">) => void;
  addExpense: (txn: Omit<ExpenseTxn, "id">) => void;
  removeExpense: (id: string) => void;
  setBudget: (id: string, monthly: number) => void;
  setOverhead: (id: string, monthly: number) => void;
  sendCampaign: (input: Omit<Campaign, "id" | "sentOn">) => void;
  resetDemo: (confirmReplace?: boolean) => void;
  clearShop: () => void;
}

export type ShopState = ShopData & ShopActions;

const OPERATIONAL_KEYS = [
  "advisors",
  "techs",
  "customers",
  "vehicles",
  "parts",
  "laborOps",
  "orders",
  "closedHistory",
  "timeLogs",
  "appointments",
  "expenses",
  "campaigns",
] as const satisfies readonly (keyof ShopData)[];

/** Customers, roster, tickets, or other shop work. Empty budgets and pay types do not count. */
export function shopHasOperationalData(state: ShopData): boolean {
  return OPERATIONAL_KEYS.some((key) => state[key].length > 0);
}

/**
 * The sample month may replace an empty shop, or reload data that is already
 * the sample. A shop with real work stays put unless the caller confirms.
 */
export function sampleLoadAllowed(state: ShopData, confirmReplace = false): boolean {
  if (state.dataset === "sample") return true;
  if (!shopHasOperationalData(state)) return true;
  return confirmReplace === true;
}

function uid(prefix: string) {
  return `${prefix}-${Math.random().toString(36).slice(2, 8)}`;
}

function actingStaff(state: ShopData): { id: string; name: string } {
  const picked = state.advisors.find((advisor) => advisor.id === state.workingAsId)
    ?? state.techs.find((tech) => tech.id === state.workingAsId)
    ?? state.advisors[0]
    ?? state.techs[0];
  if (!picked) return { id: "", name: "Desk" };
  return { id: picked.id, name: picked.name };
}

function demoVin() {
  const serial = 100000 + Math.floor(Math.random() * 899999);
  return fullVin({ prefix: "1FTAB12C", year: 2022, plant: "A", serial });
}

function pickShop(state: ShopData): ShopData {
  const shop = {} as ShopData;
  for (const key of dataKeys) {
    (shop as Record<keyof ShopData, ShopData[keyof ShopData]>)[key] = state[key];
  }
  return shop;
}

function withCustomerFields<T extends { phone?: string; mobile?: string; email?: string; noShows?: number }>(customers: T[] | undefined) {
  if (!Array.isArray(customers)) return customers;
  return customers.filter((row) => row && typeof row === "object").map((row) => ({
    ...row,
    phone: row.phone ?? "",
    mobile: typeof row.mobile === "string" ? row.mobile : "",
    email: typeof row.email === "string" ? row.email : "",
    noShows: typeof row.noShows === "number" && row.noShows > 0 ? Math.trunc(row.noShows) : 0,
  }));
}

function noShowChanges(fromStatus: string, toStatus: string, fromCustomer: string, toCustomer: string) {
  const changes: { customerId: string; delta: number }[] = [];
  if (fromStatus === "no_show") changes.push({ customerId: fromCustomer, delta: -1 });
  if (toStatus === "no_show") changes.push({ customerId: toCustomer, delta: 1 });
  return changes;
}

function adjustNoShows<T extends { id: string; noShows?: number }>(customers: T[], changes: { customerId: string; delta: number }[]): T[] {
  if (changes.length === 0) return customers;
  const delta = new Map<string, number>();
  for (const change of changes) delta.set(change.customerId, (delta.get(change.customerId) ?? 0) + change.delta);
  return customers.map((customer) => {
    const next = delta.get(customer.id);
    if (!next) return customer;
    return { ...customer, noShows: Math.max(0, (customer.noShows ?? 0) + next) };
  });
}

function withScheduling(settings: ShopData["settings"] | undefined) {
  if (!settings) return settings;
  return {
    ...settings,
    phone: settings.phone ?? "",
    address: settings.address ?? "",
    fees: normalizeFees(settings.fees),
    taxRate: typeof settings.taxRate === "number" ? settings.taxRate : DEFAULT_TAX_RATE,
    scheduling: normalizeScheduling(settings.scheduling),
  };
}

function createDesk(demoMode: boolean): { activeStoreId: StoreId; stores: Record<StoreId, ShopData> } {
  if (!demoMode) {
    const coulee = createEmptyShop();
    const pullman = createEmptyShop();
    pullman.settings = {
      ...pullman.settings,
      storeName: "Jess Ford Pullman",
      city: "Pullman, WA",
      address: "Pullman service drive",
      phone: "(555) 332-2100",
      scheduling: normalizeScheduling(undefined, "pullman"),
    };
    return { activeStoreId: "grand-coulee", stores: { "grand-coulee": coulee, pullman } };
  }
  return {
    activeStoreId: "grand-coulee",
    stores: {
      "grand-coulee": createSeed("grand-coulee"),
      pullman: createSeed("pullman"),
    },
  };
}

const OPEN_STATUS_PATCH = new Set<RoStatus>(["open", "working", "parts", "ready"]);

function isHeld(status: RoStatus) {
  return status === "closed";
}

function isSealed(status: RoStatus) {
  return status === "closed";
}

function cleanRecordedName(value: unknown) {
  if (typeof value !== "string") return "";
  const name = value.trim();
  if (!name || name.toLowerCase() === "unknown") return "";
  return name;
}

function cleanRecordedWhen(value: unknown) {
  if (typeof value !== "string") return null;
  const when = value.trim();
  if (!when || when.toLowerCase() === "unknown") return null;
  return when;
}

/** Live `invoiced` rows become Booked. `no_work` cannot sit on a ticket that is not Closed. */
export function migrateOrderRecord(prior: { status?: string; closeType?: string | null; closeNote?: string; closedBy?: string; closedById?: string; closedAt?: string | null }): Pick<RepairOrder, "status" | "closeType" | "closeNote" | "closedBy" | "closedById" | "closedAt"> {
  const rawStatus = prior.status ?? "";
  const status: RoStatus = rawStatus === "invoiced"
    ? "booked"
    : rawStatus === "booked" || rawStatus === "closed" || OPEN_STATUS_PATCH.has(rawStatus as RoStatus)
      ? rawStatus as RoStatus
      : "open";
  const closeType: RoCloseType | null = prior.closeType === "no_work" && status === "closed" ? "no_work" : null;
  return {
    status,
    closeType,
    closeNote: typeof prior.closeNote === "string" ? prior.closeNote.trim().slice(0, 500) : "",
    closedBy: cleanRecordedName(prior.closedBy),
    closedById: typeof prior.closedById === "string" ? prior.closedById : "",
    closedAt: cleanRecordedWhen(prior.closedAt),
  };
}

function migrateHistoryRow(row: ClosedRecord): ClosedRecord {
  const closeType: RoCloseType | null = row.closeType === "no_work" ? "no_work" : null;
  return {
    ...row,
    closeType,
    closeNote: typeof row.closeNote === "string" ? row.closeNote : "",
    closedBy: cleanRecordedName(row.closedBy),
    closedAt: cleanRecordedWhen(row.closedAt),
    droppedFeesNote: typeof row.droppedFeesNote === "string" ? row.droppedFeesNote : "",
  };
}

function closingAdvisor(state: ShopData): { id: string; name: string } | null {
  if (!mayCloseRepairOrder(deskActor(state))) return null;
  const advisor = state.advisors.find((row) => row.id === state.workingAsId);
  if (!advisor) return null;
  return { id: advisor.id, name: advisor.name };
}

function matchedStaff(state: ShopData): { id: string; name: string } | null {
  const advisor = state.advisors.find((row) => row.id === state.workingAsId);
  if (advisor) return { id: advisor.id, name: advisor.name };
  const tech = state.techs.find((row) => row.id === state.workingAsId);
  if (tech) return { id: tech.id, name: tech.name };
  return null;
}

function normalizePayments(value: unknown): RoPayment[] {
  if (!Array.isArray(value)) return [];
  const rows: RoPayment[] = [];
  for (const item of value) {
    if (!item || typeof item !== "object") continue;
    const row = item as Partial<RoPayment>;
    const amount = typeof row.amount === "number" && Number.isFinite(row.amount) ? row.amount : 0;
    rows.push({
      id: typeof row.id === "string" && row.id ? row.id : `pay-${rows.length + 1}`,
      amount,
      takenAt: typeof row.takenAt === "string" ? row.takenAt : "",
    });
  }
  return rows;
}

function normalizeCloseFields(prior: RepairOrder) {
  return {
    ...migrateOrderRecord(prior),
    payments: normalizePayments(prior.payments),
    droppedFeesNote: typeof prior.droppedFeesNote === "string" ? prior.droppedFeesNote : "",
    history: Array.isArray(prior.history)
      ? prior.history.filter((entry) => entry && typeof entry === "object" && typeof entry.text === "string").map((entry) => ({
          at: cleanRecordedWhen(entry.at) ?? "",
          who: cleanRecordedName(entry.who),
          whoId: typeof entry.whoId === "string" ? entry.whoId : "",
          kind: entry.kind === "labor-removed" || entry.kind === "part-removed" || entry.kind === "fees-dropped" || entry.kind === "closed" ? entry.kind : "closed",
          text: entry.text,
        }))
      : [],
  };
}

function nextOrderNumber(state: { orders: { number: number }[]; closedHistory?: { number: number }[] }) {
  const fromOrders = state.orders.reduce((max, order) => Math.max(max, order.number), 241000);
  const fromHistory = (state.closedHistory ?? []).reduce((max, row) => Math.max(max, row.number), 241000);
  return Math.max(fromOrders, fromHistory) + 1;
}

function mapOrder(orders: RepairOrder[], orderId: string, edit: (order: RepairOrder) => RepairOrder) {
  return orders.map((order) => (order.id === orderId ? edit(order) : order));
}

function normalizeFees(value: unknown, keepShopFlat = false): FeeLine[] {
  if (Array.isArray(value)) {
    return value
      .filter((row) => row && typeof row === "object")
      .map((row, index) => {
        const fee = row as Partial<FeeLine>;
        const id = typeof fee.id === "string" && fee.id ? fee.id : `fee-${index + 1}`;
        const name = typeof fee.name === "string" && fee.name.trim() ? fee.name : "Fee";
        const shop = id === "shop" || /^misc shop fee$/i.test(name);
        if (shop && fee.basis !== "percent" && !keepShopFlat) {
          return { id, name: name === "Fee" ? "Misc Shop Fee" : name, amount: 8, basis: "percent" as const, cap: 35 };
        }
        return {
          id,
          name,
          amount: Math.max(0, Number(fee.amount) || 0),
          basis: fee.basis === "percent" ? "percent" as const : "flat" as const,
          cap: Math.max(0, Number(fee.cap) || 0),
        };
      });
  }
  if (value && typeof value === "object") {
    const legacy = value as { shop?: number; hazmat?: number; disposal?: number };
    if ("shop" in legacy || "hazmat" in legacy || "disposal" in legacy) {
      return [
        { id: "shop", name: "Misc Shop Fee", amount: 8, basis: "percent", cap: 35 },
        { id: "hazmat", name: "Hazmat Fee", amount: Math.max(0, Number(legacy.hazmat) || 0), basis: "flat", cap: 0 },
        { id: "disposal", name: "Disposal Fee", amount: Math.max(0, Number(legacy.disposal) || 0), basis: "flat", cap: 0 },
      ];
    }
  }
  return DEFAULT_FEES.map((line) => ({ ...line }));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

/** Drop `password` and `adminPassword` anywhere in a saved blob. Nulls stay null. */
export function stripPasswordKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map((item) => stripPasswordKeys(item));
  if (!isRecord(value)) return value;
  const out: Record<string, unknown> = {};
  for (const [key, child] of Object.entries(value)) {
    if (key === "password" || key === "adminPassword") continue;
    out[key] = stripPasswordKeys(child);
  }
  return out;
}

function containsPasswordKey(value: unknown): boolean {
  if (Array.isArray(value)) return value.some((item) => containsPasswordKey(item));
  if (!isRecord(value)) return false;
  for (const [key, child] of Object.entries(value)) {
    if (key === "password" || key === "adminPassword" || containsPasswordKey(child)) return true;
  }
  return false;
}

function dropStaffPassword<T>(row: T): T {
  if (!isRecord(row)) return row;
  const { password: _password, ...rest } = row as T & { password?: string };
  return rest as T;
}

function withoutSavedPasswords(saved: Partial<ShopData>): Partial<ShopData> {
  return stripPasswordKeys(saved) as Partial<ShopData>;
}

function rewriteWithoutPasswords(raw: string): string {
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!containsPasswordKey(parsed)) return raw;
    return JSON.stringify(stripPasswordKeys(parsed));
  } catch {
    return raw;
  }
}

/** Every read and write drops leftover passwords. Persist version 29 re-runs migrate on older blobs. */
function passwordStrippingStorage(backing: ShopStorage): ShopStorage {
  return {
    getItem(key) {
      const raw = backing.getItem(key);
      if (key !== SHOP_STORAGE_KEY || raw == null) return raw;
      const cleaned = rewriteWithoutPasswords(raw);
      if (cleaned !== raw) {
        try {
          backing.setItem(key, cleaned);
        } catch {
          /* storage unavailable */
        }
      }
      return cleaned;
    },
    setItem(key, value) {
      backing.setItem(key, key === SHOP_STORAGE_KEY ? rewriteWithoutPasswords(value) : value);
    },
    removeItem(key) {
      backing.removeItem(key);
    },
  };
}

const dataKeys: (keyof ShopData)[] = [
  "dataset",
  "settings",
  "advisors",
  "techs",
  "customers",
  "vehicles",
  "parts",
  "laborOps",
  "payTypes",
  "orders",
  "closedHistory",
  "timeLogs",
  "appointments",
  "expenses",
  "budgets",
  "overhead",
  "campaigns",
  "workingAsId",
  "overrides",
  "onlineRequests",
  "onlineChallenges",
  "notices",
];

/** Persisted-shop load path. Staff passwords and the old admin password are removed on every branch, including a saved blob with no repair-order list. */
export function migrateSavedShop(persisted: unknown): ShopState {
  if (!persisted || typeof persisted !== "object") return persisted as ShopState;
  const saved = withoutSavedPasswords(persisted as Partial<ShopData>);
  if (!Array.isArray(saved.orders)) {
    return {
      ...saved,
      dataset: saved.dataset === "sample" ? "sample" : "shop",
      customers: withCustomerFields(saved.customers) ?? saved.customers,
      settings: withScheduling(saved.settings) ?? saved.settings,
    } as ShopState;
  }
  const techList = Array.isArray(saved.techs) ? saved.techs : [];
  const vehicleList = Array.isArray(saved.vehicles) ? saved.vehicles : [];
  const transports = (withScheduling(saved.settings) ?? saved.settings)?.scheduling?.transportOptions ?? normalizeScheduling(undefined).transportOptions;
  return {
    ...saved,
    orders: saved.orders.filter((order) => order && typeof order === "object").map((order) => {
      const prior = order as RepairOrder & { cause?: string; correction?: string; jobs?: JobLine[] };
      const labor = Array.isArray(prior.labor) ? prior.labor : [];
      const parts = Array.isArray(prior.parts) ? prior.parts.filter((line) => line && typeof line === "object") : [];
      const jobs = Array.isArray(prior.jobs) && prior.jobs.length > 0
        ? prior.jobs
        : [jobLine(`${prior.id}-a`, "A", prior.concern ?? "", prior.cause ?? "", prior.correction ?? "")];
      const total = labor.reduce((sum, line) => sum + line.hours * line.rate, 0)
        + parts.reduce((sum, line) => sum + line.qty * line.price, 0);
      const wa = normalizeWa(prior.wa);
      const stamped = wa.choice
        ? wa
        : total > 0
          ? { ...blankWa(), choice: "written" as const, initials: "on file", date: prior.openedOn, time: "08:00", estimate: money2(total) }
          : wa;
      return {
        ...prior,
        jobs,
        concern: concernFromJobs(jobs) || prior.concern,
        bay: prior.bay ?? bayFromStatus(prior.status),
        mileageOut: prior.mileageOut ?? null,
        fees: normalizeFees(Array.isArray(prior.fees) ? prior.fees : saved.settings?.fees, prior.status === "closed"),
        taxRate: typeof prior.taxRate === "number" ? prior.taxRate : (typeof saved.settings?.taxRate === "number" ? saved.settings.taxRate : DEFAULT_TAX_RATE),
        inspection: prior.inspection ?? demoSheet(prior.id),
        labor,
        parts: parts.map((line) => ({ ...line, condition: line.condition ?? "new" })),
        wa: stamped,
        ...normalizeCloseFields(prior),
      };
    }),
    laborOps: Array.isArray(saved.laborOps) && saved.laborOps.length > 0 ? saved.laborOps : laborCatalog(),
    payTypes: Array.isArray(saved.payTypes) && saved.payTypes.length > 0 ? saved.payTypes : defaultPayTypes(saved.settings),
    campaigns: Array.isArray(saved.campaigns) ? saved.campaigns : [],
    dataset: saved.dataset === "sample" ? "sample" : "shop",
    appointments: Array.isArray(saved.appointments)
      ? saved.appointments.filter((row) => row && typeof row === "object").map((row) => {
          const vehicle = vehicleList.find((item) => item.id === row.vehicleId);
          const lines = Array.isArray(row.lines) && row.lines.length > 0
            ? row.lines.map((line, index) => ({ id: line.id || `${row.id}-l${index}`, code: lineLetter(index), concern: line.concern ?? "" }))
            : [{ id: `${row.id}-a`, code: "A", concern: row.concern ?? "" }];
          const fallback: Record<string, string> = { a1: "luis", a2: "chris", a3: "priya", a4: "sam", a5: "elena", a6: "marcus", a7: "andre", a8: "marcus", a9: "luis", a10: "chris" };
          const known = techList.some((tech) => tech.id === row.techId) ? row.techId : "";
          const priorLane = row.lane;
          return {
            ...row,
            date: row.date ?? today(),
            time: snapHalfHour(row.time ?? "07:00"),
            minutes: typeof row.minutes === "number" && row.minutes >= 30 ? row.minutes : priorLane === "loaner" ? 180 : priorLane === "drop" ? 120 : priorLane === "waiter" ? 90 : 60,
            lane: normalizeLane(priorLane, transports),
            lines,
            concern: concernFromLines(lines) || row.concern,
            vin: row.vin || vehicle?.vin || "",
            laborOpIds: Array.isArray(row.laborOpIds) ? row.laborOpIds : [],
            techId: known || fallback[row.id] || techList[0]?.id || "",
            cancelHistory: normalizeCancelHistory(row.cancelHistory),
          };
        })
      : saved.appointments,
    customers: withCustomerFields(saved.customers) ?? saved.customers,
    settings: withScheduling(saved.settings) ?? saved.settings,
    timeLogs: Array.isArray(saved.timeLogs) ? saved.timeLogs : [],
    closedHistory: Array.isArray(saved.closedHistory) ? saved.closedHistory.map((row) => migrateHistoryRow(row)) : [],
    advisors: Array.isArray(saved.advisors)
      ? saved.advisors.filter((advisor) => advisor && typeof advisor === "object").map((advisor, index) => {
          const row = dropStaffPassword(advisor);
          return {
            ...row,
            number: row.number || ADVISOR_NUMBERS[row.id] || String(index + 1),
            base: typeof row.base === "number" ? row.base : 4200,
            laborPercent: typeof row.laborPercent === "number" ? row.laborPercent : 5,
            partsPercent: typeof row.partsPercent === "number" ? row.partsPercent : 2,
          };
        })
      : saved.advisors,
    techs: Array.isArray(saved.techs)
      ? saved.techs.filter((tech) => tech && typeof tech === "object").map((tech, index) => {
          const row = dropStaffPassword(tech);
          return {
            ...row,
            number: row.number || TECH_NUMBERS[row.id] || String(index + 1),
            board: row.board || ({ luis: "express", sam: "express", marcus: "main", elena: "main", andre: "main", chris: "main", priya: "internal", dana: "none" } satisfies Record<string, TechBoard>)[tech.id] || "main",
          };
        })
      : saved.techs,
  } as ShopState;
}

/** Rehydrate path. Strips passwords even when the blob is already version 28. */
export function mergeSavedShop(persisted: unknown, current: ShopState): ShopState {
  if (!persisted || typeof persisted !== "object") return current;
  const record = persisted as Partial<ShopData> & { activeStoreId?: StoreId; stores?: Partial<Record<StoreId, Partial<ShopData>>> };
  if (record.stores && typeof record.stores === "object") {
    const stores = {
      "grand-coulee": mergeShopSlice(record.stores["grand-coulee"], current.stores["grand-coulee"]),
      pullman: mergeShopSlice(record.stores.pullman, current.stores.pullman),
    } satisfies Record<StoreId, ShopData>;
    const activeStoreId: StoreId = record.activeStoreId === "pullman" ? "pullman" : "grand-coulee";
    return { ...current, ...stores[activeStoreId], activeStoreId, stores };
  }
  const saved = migrateSavedShop(persisted);
  if (!saved || typeof saved !== "object") return current;
  const data: Partial<ShopData> = {};
  for (const key of dataKeys) {
    if (key in saved) data[key] = saved[key] as never;
  }
  const merged = { ...current, ...data };
  const activeStoreId = current.activeStoreId ?? "grand-coulee";
  const stores = {
    ...(current.stores ?? {}),
    [activeStoreId]: pickShop(merged),
  } as Record<StoreId, ShopData>;
  return { ...merged, activeStoreId, stores };
}

function mergeShopSlice(saved: Partial<ShopData> | undefined, fallback: ShopData): ShopData {
  if (!saved || typeof saved !== "object") return fallback;
  const migrated = migrateSavedShop(saved);
  const data: Partial<ShopData> = {};
  for (const key of dataKeys) {
    if (key in migrated && migrated[key] !== undefined) data[key] = migrated[key] as never;
  }
  return { ...fallback, ...data };
}

export interface ShopStoreOptions {
  /** Explicit demo flag. Defaults to `VITE_DEMO_MODE`. A development server is not demo mode. */
  demoMode?: boolean;
  /** Backing store. Demo mode never writes through it. */
  storage?: ShopStorage;
}

/** Bumped so a saved shop maps stored invoiced rows to Booked and strips a no-work flag off anything not Closed. */
export const SHOP_PERSIST_VERSION = 31;

export function createShopStore(options: ShopStoreOptions = {}) {
  const demoMode = options.demoMode ?? isDemoMode();
  const desk = createDesk(demoMode);
  const active = desk.stores[desk.activeStoreId];
  return create<ShopState>()(
    persist(
      (rawSet, get) => {
        const set: typeof rawSet = (partial, replace) => {
          rawSet((state) => {
            const patch = typeof partial === "function" ? partial(state) : partial;
            if (patch === state) return state;
            const next = (replace ? { ...patch } : { ...state, ...patch }) as ShopState;
            const activeStoreId = next.activeStoreId === "pullman" || next.activeStoreId === "grand-coulee" ? next.activeStoreId : state.activeStoreId;
            return {
              ...next,
              activeStoreId,
              stores: { ...(next.stores ?? state.stores), [activeStoreId]: pickShop(next) },
            };
          });
        };
        const logOverride = (
          result: CapacityResult,
          appointmentId: string,
          fallback: { customerId: string; date: string; time: string; techId: string; advisorId: string },
        ): string | null => {
          const reason = overrideReason(result);
          if (!reason) return null;
          const saved = get();
          const row = saved.appointments.find((item) => item.id === appointmentId);
          const actor = actingStaff(saved);
          const overrideId = uid("ov");
          const record: OverrideRecord = {
            id: overrideId,
            at: now().toISOString(),
            who: actor.name,
            whoId: actor.id,
            storeId: saved.activeStoreId,
            appointmentId,
            customerName: saved.customers.find((customer) => customer.id === (row?.customerId ?? fallback.customerId))?.name ?? "Customer",
            date: row?.date ?? fallback.date,
            time: row?.time ?? fallback.time,
            techName: saved.techs.find((tech) => tech.id === (row?.techId ?? fallback.techId))?.name ?? "No technician",
            advisorName: saved.advisors.find((advisor) => advisor.id === (row?.advisorId ?? fallback.advisorId))?.name ?? "No advisor",
            reason,
          };
          set((current) => ({ overrides: [...(current.overrides ?? []), record] }));
          return overrideId;
        };
        return {
        ...active,
        activeStoreId: desk.activeStoreId,
        stores: desk.stores,
      focusOrderId: null,
      switchStore: (id) => {
        if (id !== "grand-coulee" && id !== "pullman") return;
        set((state) => {
          if (state.activeStoreId === id) return state;
          const next = state.stores[id];
          if (!next) return state;
          return { ...next, activeStoreId: id, stores: state.stores, focusOrderId: null };
        });
      },
      setFocus: (id) => set({ focusOrderId: id }),
      updateSettings: (patch) =>
        set((state) => {
          const fees = Array.isArray(patch.fees) ? patch.fees.map((line) => ({ ...line })) : state.settings.fees;
          const taxRate = patch.taxRate === undefined ? state.settings.taxRate : Math.max(0, Number(patch.taxRate) || 0);
          const settings = { ...state.settings, ...patch, fees, taxRate };
          const stamp = Array.isArray(patch.fees) || patch.taxRate !== undefined;
          return {
            settings,
            orders: stamp
              ? state.orders.map((order) => (isHeld(order.status) ? order : { ...order, fees, taxRate }))
              : state.orders,
          };
        }),
      updateDayHours: (weekday, patch) =>
        set((state) => ({
          settings: { ...state.settings, scheduling: patchDayHours(state.settings.scheduling, weekday, patch) },
        })),
      addClosedDate: (iso) => {
        let added = false;
        set((state) => {
          const next = addClosedDate(state.settings.scheduling, iso);
          if (next === state.settings.scheduling) return state;
          added = true;
          return { settings: { ...state.settings, scheduling: next } };
        });
        return added;
      },
      removeClosedDate: (iso) =>
        set((state) => ({
          settings: { ...state.settings, scheduling: removeClosedDate(state.settings.scheduling, iso) },
        })),
      updateBookingWindow: (patch) =>
        set((state) => ({
          settings: { ...state.settings, scheduling: patchBookingWindow(state.settings.scheduling, patch) },
        })),
      addOnlineService: (input) => {
        let added = false;
        set((state) => {
          const next = addOnlineService(state.settings.scheduling, input, uid("svc"));
          if (!next) return state;
          added = true;
          return { settings: { ...state.settings, scheduling: next } };
        });
        return added;
      },
      updateOnlineService: (id, patch) => {
        let updated = false;
        set((state) => {
          const next = updateOnlineService(state.settings.scheduling, id, patch);
          if (!next) return state;
          updated = true;
          return { settings: { ...state.settings, scheduling: next } };
        });
        return updated;
      },
      removeOnlineService: (id) =>
        set((state) => ({
          settings: { ...state.settings, scheduling: removeOnlineService(state.settings.scheduling, id) },
        })),
      addTransportOption: (name) => {
        let added = false;
        set((state) => {
          const next = addTransportOption(state.settings.scheduling, name, uid("ride"));
          if (!next) return state;
          added = true;
          return { settings: { ...state.settings, scheduling: next } };
        });
        return added;
      },
      renameTransportOption: (id, name) => {
        let renamed = false;
        set((state) => {
          const next = renameTransportOption(state.settings.scheduling, id, name);
          if (!next) return state;
          renamed = true;
          return { settings: { ...state.settings, scheduling: next } };
        });
        return renamed;
      },
      removeTransportOption: (id) => {
        let removed = false;
        set((state) => {
          const next = removeTransportOption(state.settings.scheduling, id);
          if (!next) return state;
          removed = true;
          return { settings: { ...state.settings, scheduling: next } };
        });
        return removed;
      },
      clockTech: (techId, hours) =>
        set((state) => ({
          techs: state.techs.map((tech) =>
            tech.id === techId
              ? {
                  ...tech,
                  clockedHoursMonth: money2(Math.max(0, tech.clockedHoursMonth + hours)),
                  clockedToday: money2(Math.max(0, tech.clockedToday + hours)),
                }
              : tech,
          ),
        })),
      addTech: (input) => {
        const name = input.name.trim();
        const number = input.number.trim();
        if (!name || !number) return false;
        let added = false;
        set((state) => {
          if (state.techs.some((tech) => tech.number === number)) return state;
          added = true;
          const tech: Tech = {
            id: uid("tech"),
            number,
            name,
            skill: input.skill,
            board: input.board,
            payStyle: input.payStyle,
            flagRate: money2(Math.max(0, input.flagRate)),
            hourlyRate: money2(Math.max(0, input.hourlyRate)),
            availableHoursMonth: 118,
            clockedHoursMonth: 0,
            clockedToday: 0,
          };
          return { techs: [...state.techs, tech].sort((a, b) => a.number.localeCompare(b.number, undefined, { numeric: true })) };
        });
        return added;
      },
      updateTech: (id, patch) => {
        let updated = false;
        set((state) => {
          const current = state.techs.find((tech) => tech.id === id);
          if (!current) return state;
          const number = patch.number === undefined ? current.number : patch.number.trim();
          const name = patch.name === undefined ? current.name : patch.name.trim();
          if (!number || !name) return state;
          if (state.techs.some((tech) => tech.id !== id && tech.number === number)) return state;
          updated = true;
          return {
            techs: state.techs.map((tech) =>
              tech.id === id
                ? {
                    ...dropStaffPassword(tech),
                    ...patch,
                    number,
                    name,
                    flagRate: patch.flagRate === undefined ? tech.flagRate : money2(Math.max(0, patch.flagRate)),
                    hourlyRate: patch.hourlyRate === undefined ? tech.hourlyRate : money2(Math.max(0, patch.hourlyRate)),
                  }
                : tech,
            ),
          };
        });
        return updated;
      },
      removeTech: (id) => {
        let result: "ok" | "used" | "appointments" = "ok";
        set((state) => {
          if (state.orders.some((order) => order.labor.some((line) => line.techId === id) || order.inspection?.techId === id)) {
            result = "used";
            return state;
          }
          if (state.appointments.some((row) => row.techId === id && row.status !== "cancelled")) {
            result = "appointments";
            return state;
          }
          return { techs: state.techs.filter((tech) => tech.id !== id) };
        });
        return result;
      },
      addAdvisor: (input) => {
        const name = input.name.trim();
        const number = input.number.trim();
        if (!name || !number) return false;
        let added = false;
        set((state) => {
          if (state.advisors.some((advisor) => advisor.number === number)) return state;
          added = true;
          const advisor: Advisor = {
            id: uid("adv"),
            number,
            name,
            base: money2(Math.max(0, input.base)),
            laborPercent: Math.max(0, input.laborPercent),
            partsPercent: Math.max(0, input.partsPercent),
          };
          return { advisors: [...state.advisors, advisor].sort((a, b) => a.number.localeCompare(b.number, undefined, { numeric: true })) };
        });
        return added;
      },
      updateAdvisor: (id, patch) => {
        let updated = false;
        set((state) => {
          const current = state.advisors.find((advisor) => advisor.id === id);
          if (!current) return state;
          const number = patch.number === undefined ? current.number : patch.number.trim();
          const name = patch.name === undefined ? current.name : patch.name.trim();
          if (!number || !name) return state;
          if (state.advisors.some((advisor) => advisor.id !== id && advisor.number === number)) return state;
          updated = true;
          return {
            advisors: state.advisors.map((advisor) =>
              advisor.id === id
                ? {
                    ...dropStaffPassword(advisor),
                    ...patch,
                    number,
                    name,
                    base: patch.base === undefined ? advisor.base : money2(Math.max(0, patch.base)),
                    laborPercent: patch.laborPercent === undefined ? advisor.laborPercent : Math.max(0, patch.laborPercent),
                    partsPercent: patch.partsPercent === undefined ? advisor.partsPercent : Math.max(0, patch.partsPercent),
                  }
                : advisor,
            ),
          };
        });
        return updated;
      },
      removeAdvisor: (id) => {
        let result: "ok" | "used" = "ok";
        set((state) => {
          const used = state.orders.some((order) => order.advisorId === id) || state.appointments.some((row) => row.advisorId === id);
          if (used) {
            result = "used";
            return state;
          }
          return { advisors: state.advisors.filter((advisor) => advisor.id !== id) };
        });
        return result;
      },
      updateOrder: (orderId, patch) =>
        set((state) => ({
          orders: mapOrder(state.orders, orderId, (order) => {
            if (order.status === "closed") return order;
            const status = patch.status && OPEN_STATUS_PATCH.has(patch.status) && order.status !== "booked" ? patch.status : order.status;
            const { status: _status, ...rest } = patch;
            return { ...order, ...rest, status };
          }),
        })),
      updateJob: (orderId, jobId, patch) =>
        set((state) => ({
          orders: mapOrder(state.orders, orderId, (order) => {
            if (isHeld(order.status)) return order;
            const current = order.jobs ?? [];
            const jobs = current.map((job) => (job.id === jobId ? { ...job, ...patch } : job));
            return { ...order, jobs, concern: concernFromJobs(jobs) };
          }),
        })),
      addJob: (orderId) =>
        set((state) => ({
          orders: mapOrder(state.orders, orderId, (order) => {
            if (isHeld(order.status)) return order;
            const current = order.jobs ?? [];
            const jobs = [...current, jobLine(uid("jb"), nextLineCode(current))];
            return { ...order, jobs, concern: concernFromJobs(jobs) };
          }),
        })),
      removeJob: (orderId, jobId) =>
        set((state) => ({
          orders: mapOrder(state.orders, orderId, (order) => {
            const current = order.jobs ?? [];
            if (isHeld(order.status) || current.length < 2) return order;
            const jobs = order.jobs.filter((job) => job.id !== jobId);
            return { ...order, jobs, concern: concernFromJobs(jobs) };
          }),
        })),
      updateWa: (orderId, patch) =>
        set((state) => ({
          orders: mapOrder(state.orders, orderId, (order) =>
            isHeld(order.status) ? order : { ...order, wa: { ...normalizeWa(order.wa), ...patch, extras: normalizeWa(order.wa).extras } },
          ),
        })),
      addExtraAuth: (orderId, input) =>
        set((state) => ({
          orders: mapOrder(state.orders, orderId, (order) => {
            if (isHeld(order.status)) return order;
            if (!input.date || !input.time || !input.employee.trim() || !input.person.trim() || input.amount <= 0) return order;
            const wa = normalizeWa(order.wa);
            const extra: ExtraAuth = {
              id: uid("wa"),
              date: input.date,
              time: input.time,
              employee: input.employee.trim(),
              person: input.person.trim(),
              phone: input.phone.trim(),
              work: input.work.trim(),
              amount: money2(input.amount),
            };
            return { ...order, wa: { ...wa, extras: [...wa.extras, extra] } };
          }),
        })),
      invoiceOrder: () => {
        // Month close counts Closed repair orders in the reports. It never writes a status.
      },
      closeOrder: (orderId) => {
        const state = get();
        const order = state.orders.find((row) => row.id === orderId);
        if (!order) return { ok: false, error: "That repair order is not on this store." };
        const who = closingAdvisor(state);
        if (!who) return { ok: false, error: "Only an advisor or service manager can close a repair order." };
        const result = closeRepairOrder(
          order,
          state.parts,
          {
            customer: state.customers.find((row) => row.id === order.customerId),
            vehicle: state.vehicles.find((row) => row.id === order.vehicleId),
            techs: state.techs,
            advisors: state.advisors,
            logs: state.timeLogs,
          },
          who,
          now().toISOString(),
          today(),
        );
        if ("error" in result) return { ok: false, error: result.error };
        const copy = closedRecord(
          result.order,
          state.customers.find((row) => row.id === order.customerId),
          state.vehicles.find((row) => row.id === order.vehicleId),
        );
        copy.id = uid("hist");
        set((current) => ({
          parts: result.parts,
          closedHistory: [copy, ...current.closedHistory.filter((row) => row.orderId !== orderId)],
          orders: mapOrder(current.orders, orderId, () => result.order),
        }));
        return { ok: true, error: null };
      },
      bookOrder: (orderId) =>
        set((state) => {
          const order = state.orders.find((row) => row.id === orderId);
          if (!order) return state;
          const next = bookRepairOrder(order);
          if (!next) return state;
          return { orders: mapOrder(state.orders, orderId, () => next) };
        }),
      unbookOrder: (orderId) =>
        set((state) => {
          const order = state.orders.find((row) => row.id === orderId);
          if (!order) return state;
          const next = unbookRepairOrder(order);
          if (!next) return state;
          return { orders: mapOrder(state.orders, orderId, () => next) };
        }),
      reopenOrder: (orderId) =>
        set((state) => {
          const order = state.orders.find((row) => row.id === orderId);
          if (!order) return state;
          const result = reopenRepairOrder(order, state.parts);
          if (!result) return state;
          return {
            parts: result.parts,
            closedHistory: dropClosedHistory(state.closedHistory, orderId),
            orders: mapOrder(state.orders, orderId, () => result.order),
          };
        }),
      closeOrderWithNoWork: (orderId, note) => {
        const state = get();
        const order = state.orders.find((row) => row.id === orderId);
        if (!order) return { ok: false, error: "That repair order is not on this store." };
        const who = closingAdvisor(state);
        if (!who) return { ok: false, error: "Only an advisor or service manager can close a repair order." };
        const error = noWorkCloseError(order, state.timeLogs, note, {
          customer: state.customers.find((row) => row.id === order.customerId),
          vehicle: state.vehicles.find((row) => row.id === order.vehicleId),
        });
        if (error) return { ok: false, error };
        const next = closeRepairOrderWithNoWork(order, note, who, now().toISOString(), today());
        const copy = closedRecord(
          next,
          state.customers.find((row) => row.id === order.customerId),
          state.vehicles.find((row) => row.id === order.vehicleId),
        );
        copy.id = uid("hist");
        set((current) => ({
          closedHistory: [copy, ...current.closedHistory],
          orders: mapOrder(current.orders, orderId, () => next),
        }));
        return { ok: true, error: null };
      },
      addLabor: (orderId, line) =>
        set((state) => ({
          orders: mapOrder(state.orders, orderId, (order) => {
            if (isHeld(order.status) || !(line.hours >= 0)) return order;
            return { ...order, labor: [...order.labor, { ...line, id: uid("lb") }] };
          }),
        })),
      updateLabor: (orderId, lineId, patch) =>
        set((state) => ({
          orders: mapOrder(state.orders, orderId, (order) => {
            if (isHeld(order.status)) return order;
            if (patch.hours !== undefined && !(patch.hours >= 0)) return order;
            return { ...order, labor: order.labor.map((line) => (line.id === lineId ? { ...line, ...patch } : line)) };
          }),
        })),
      removeLabor: (orderId, lineId) =>
        set((state) => {
          const who = matchedStaff(state);
          return {
            orders: mapOrder(state.orders, orderId, (order) => {
              if (isHeld(order.status)) return order;
              const line = order.labor.find((row) => row.id === lineId);
              if (!line) return order;
              const entry: RoHistoryEntry = {
                at: now().toISOString(),
                who: who?.name ?? "",
                whoId: who?.id ?? "",
                kind: "labor-removed",
                text: `Removed labor line ${line.opcode || "labor"}${line.description ? ` — ${line.description}` : ""}`,
              };
              return { ...order, labor: order.labor.filter((row) => row.id !== lineId), history: [...(order.history ?? []), entry] };
            }),
          };
        }),
      clockIn: (techId, orderId) =>
        set((state) => {
          const order = state.orders.find((row) => row.id === orderId);
          if (!order || isSealed(order.status)) return state;
          if (!order.labor.some((line) => line.techId === techId)) return state;
          const now = localStamp();
          const open = state.timeLogs.find((row) => row.techId === techId && row.endedAt === null && row.orderId === orderId);
          if (open) return state;
          return {
            timeLogs: [
              ...state.timeLogs.map((row) => (row.techId === techId && row.endedAt === null ? { ...row, endedAt: now } : row)),
              { id: uid("clk"), techId, orderId, startedAt: now, endedAt: null },
            ],
          };
        }),
      clockOut: (techId) =>
        set((state) => {
          const now = localStamp();
          if (!state.timeLogs.some((row) => row.techId === techId && row.endedAt === null)) return state;
          return { timeLogs: state.timeLogs.map((row) => (row.techId === techId && row.endedAt === null ? { ...row, endedAt: now } : row)) };
        }),
      addPartLine: (orderId, line) =>
        set((state) => ({
          orders: mapOrder(state.orders, orderId, (order) => {
            if (isHeld(order.status)) return order;
            return { ...order, parts: [...order.parts, { ...line, condition: line.condition ?? "new", id: uid("pt") }] };
          }),
        })),
      updatePartLine: (orderId, lineId, patch) =>
        set((state) => ({
          orders: mapOrder(state.orders, orderId, (order) => {
            if (isHeld(order.status)) return order;
            return { ...order, parts: order.parts.map((line) => (line.id === lineId ? { ...line, ...patch } : line)) };
          }),
        })),
      removePartLine: (orderId, lineId) =>
        set((state) => {
          const who = matchedStaff(state);
          return {
            orders: mapOrder(state.orders, orderId, (order) => {
              if (isHeld(order.status)) return order;
              const line = order.parts.find((row) => row.id === lineId);
              if (!line) return order;
              const entry: RoHistoryEntry = {
                at: now().toISOString(),
                who: who?.name ?? "",
                whoId: who?.id ?? "",
                kind: "part-removed",
                text: `Removed part line ${line.number || line.description || "part"}${line.description ? ` — ${line.description}` : ""}`,
              };
              return { ...order, parts: order.parts.filter((row) => row.id !== lineId), history: [...(order.history ?? []), entry] };
            }),
          };
        }),
      addLaborOp: (op) =>
        set((state) => {
          const opcode = op.opcode.trim().toUpperCase();
          const description = op.description.trim();
          const hours = money2(op.hours);
          if (!opcode || !description || hours <= 0) return state;
          if (state.laborOps.some((row) => row.opcode.toUpperCase() === opcode)) return state;
          const next: LaborOp = { id: uid("op"), opcode, description, hours, payType: op.payType };
          return { laborOps: [...state.laborOps, next].sort((a, b) => a.opcode.localeCompare(b.opcode)) };
        }),
      updateLaborOp: (id, patch) =>
        set((state) => ({
          laborOps: state.laborOps.map((op) => {
            if (op.id !== id) return op;
            const next = { ...op, ...patch };
            if (patch.opcode !== undefined) {
              const opcode = patch.opcode.toUpperCase();
              const trimmed = opcode.trim();
              if (trimmed && state.laborOps.some((row) => row.id !== id && row.opcode.toUpperCase() === trimmed)) return op;
              next.opcode = opcode;
            }
            if (patch.description !== undefined) next.description = patch.description;
            if (patch.hours !== undefined && patch.hours >= 0) next.hours = money2(patch.hours);
            return next;
          }),
        })),
      removeLaborOp: (id) => set((state) => ({ laborOps: state.laborOps.filter((op) => op.id !== id) })),
      addPayType: (input) => {
        const name = input.name.trim();
        if (!name) return false;
        let added = false;
        set((state) => {
          const row = { id: uid("pt"), name, rate: money2(Math.max(0, input.rate)), kind: input.kind };
          added = true;
          return { payTypes: [...state.payTypes, row] };
        });
        return added;
      },
      updatePayType: (id, patch) =>
        set((state) => {
          const payTypes = state.payTypes.map((row) => {
            if (row.id !== id) return row;
            const next = { ...row, ...patch };
            if (patch.name !== undefined) next.name = patch.name;
            if (patch.rate !== undefined) next.rate = money2(Math.max(0, patch.rate));
            return next;
          });
          const settings = { ...state.settings };
          for (const row of payTypes) {
            if (row.id === "cp") settings.cpRate = row.rate;
            if (row.id === "warranty") settings.warrantyRate = row.rate;
            if (row.id === "internal") settings.internalRate = row.rate;
          }
          return { payTypes, settings };
        }),
      removePayType: (id) => {
        const state = useShop.getState();
        if (state.payTypes.length <= 1) return "last";
        const used =
          state.laborOps.some((op) => op.payType === id) ||
          state.orders.some((order) => order.labor.some((line) => line.payType === id) || order.parts.some((line) => line.payType === id));
        if (used) return "used";
        set({ payTypes: state.payTypes.filter((row) => row.id !== id) });
        return "ok";
      },
      addFee: (input) => {
        const name = input.name.trim();
        if (!name) return false;
        set((state) => {
          const fees = [...state.settings.fees, { id: uid("fee"), name, amount: money2(Math.max(0, input.amount)), basis: "flat" as const, cap: 0 }];
          return { settings: { ...state.settings, fees }, orders: state.orders.map((order) => (isHeld(order.status) ? order : { ...order, fees })) };
        });
        return true;
      },
      updateFee: (id, patch) =>
        set((state) => {
          const fees = state.settings.fees.map((line) => {
            if (line.id !== id) return line;
            return {
              ...line,
              name: patch.name === undefined ? line.name : patch.name,
              amount: patch.amount === undefined ? line.amount : money2(Math.max(0, patch.amount)),
              cap: patch.cap === undefined ? line.cap : money2(Math.max(0, patch.cap)),
            };
          });
          return { settings: { ...state.settings, fees }, orders: state.orders.map((order) => (isHeld(order.status) ? order : { ...order, fees })) };
        }),
      removeFee: (id) =>
        set((state) => {
          const fees = state.settings.fees.filter((line) => line.id !== id);
          return { settings: { ...state.settings, fees }, orders: state.orders.map((order) => (isHeld(order.status) ? order : { ...order, fees })) };
        }),
      attachInspection: (orderId) =>
        set((state) => ({
          orders: mapOrder(state.orders, orderId, (order) =>
            order.inspection || isHeld(order.status)
              ? order
              : { ...order, inspection: blankSheet(order.labor[0]?.techId || state.techs[0]?.id || "") },
          ),
        })),
      setInspectionTech: (orderId, techId) =>
        set((state) => ({
          orders: mapOrder(state.orders, orderId, (order) =>
            !order.inspection || isHeld(order.status) ? order : { ...order, inspection: { ...order.inspection, techId } },
          ),
        })),
      setInspectionPoint: (orderId, pointId, patch) =>
        set((state) => ({
          orders: mapOrder(state.orders, orderId, (order) => {
            if (!order.inspection || isHeld(order.status)) return order;
            return {
              ...order,
              inspection: {
                ...order.inspection,
                items: order.inspection.items.map((item) => (item.id === pointId ? { ...item, ...patch } : item)),
              },
            };
          }),
        })),
      createOrder: (input) => {
        const id = uid("ro");
        set((state) => {
          const number = nextOrderNumber(state);
          const written = input.lines.map((line) => line.concern.trim()).filter(Boolean);
          const jobs = (written.length > 0 ? written : [""]).map((concern, index) => jobLine(uid("jb"), lineLetter(index), concern));
          const order: RepairOrder = {
            id,
            number,
            openedOn: today(),
            promiseTime: input.promiseTime,
            status: "open",
            bay: "dispatch",
            advisorId: input.advisorId,
            customerId: input.customerId,
            vehicleId: input.vehicleId,
            concern: concernFromJobs(jobs),
            jobs,
            wa: blankWa(),
            mileage: input.mileage,
            mileageOut: input.mileageOut ?? null,
            fees: state.settings.fees.map((line) => ({ ...line })),
            taxRate: state.settings.taxRate,
            labor: (input.labor ?? []).map((line) => ({ ...line, id: uid("lb") })),
            parts: [],
            invoicedOn: null,
            stockApplied: false,
            inspection: blankSheet(state.techs[0]?.id ?? ""),
            closeType: null,
            closeNote: "",
            closedBy: "",
            closedById: "",
            closedAt: null,
            droppedFeesNote: "",
            history: [],
            payments: [],
          };
          return { orders: [order, ...state.orders], focusOrderId: id };
        });
        return id;
      },
      createCustomer: (input) => {
        const customerId = uid("c");
        const vehicleId = uid("v");
        set((state) => ({
          customers: [{ id: customerId, name: input.name.trim(), phone: input.phone.trim(), mobile: input.mobile?.trim() ?? "", email: input.email?.trim() ?? "", noShows: 0 }, ...state.customers],
          vehicles: [
            {
              id: vehicleId,
              customerId,
              year: input.year,
              model: input.model.trim(),
              vin: demoVin(),
            },
            ...state.vehicles,
          ],
        }));
        return { customerId, vehicleId };
      },
      setAppointmentStatus: (id, status) =>
        set((state) => {
          const current = state.appointments.find((row) => row.id === id);
          if (!current || current.status === status) return state;
          if (current.status === "cancelled" || status === "cancelled") return state;
          return {
            appointments: state.appointments.map((row) => (row.id === id ? { ...row, status } : row)),
            customers: adjustNoShows(state.customers, noShowChanges(current.status, status, current.customerId, current.customerId)),
          };
        }),
      moveAppointment: (id, patch) => {
        const state = get();
        const current = state.appointments.find((row) => row.id === id);
        if (!current) return { ok: false, error: "That appointment is not on this store." };
        if (current.status === "cancelled") return { ok: false, error: CANCELLED_LOCKED };
        const techId = patch.techId || current.techId;
        const staffError = staffBlockMessage(
          state.techs.some((tech) => tech.id === techId),
          state.advisors.some((advisor) => advisor.id === current.advisorId),
        );
        if (staffError) return { ok: false, error: staffError };
        set((next) => ({
          appointments: next.appointments.map((row) => {
            if (row.id !== id || row.status === "cancelled") return row;
            const minutes = patch.minutes === undefined ? row.minutes : Math.max(30, Math.round(patch.minutes / 30) * 30);
            const time = snapHalfHour(patch.time && /^\d{2}:\d{2}$/.test(patch.time) ? patch.time : row.time);
            const date = patch.date && /^\d{4}-\d{2}-\d{2}$/.test(patch.date) ? patch.date : row.date;
            return { ...row, minutes, time, date, techId };
          }),
        }));
        return { ok: true, error: null };
      },
      updateAppointment: (id, patch) => {
        const state = get();
        const current = state.appointments.find((row) => row.id === id);
        if (!current) return { ok: false, error: "That appointment is not on this store." };
        if (current.status === "cancelled") return { ok: false, error: CANCELLED_LOCKED };
        const staffError = staffBlockMessage(
          state.techs.some((tech) => tech.id === (patch.techId || current.techId)),
          state.advisors.some((advisor) => advisor.id === (patch.advisorId || current.advisorId)),
        );
        if (staffError) return { ok: false, error: staffError };
        set((state) => {
          const current = state.appointments.find((row) => row.id === id);
          const requested = patch.status ?? current?.status ?? "scheduled";
          const nextStatus = !current || current.status === "cancelled" || requested === "cancelled" ? (current?.status ?? "scheduled") : requested;
          const nextCustomer = patch.customerId || current?.customerId || "";
          return {
          appointments: state.appointments
            .map((row) => {
              if (row.id !== id) return row;
              const minutes = patch.minutes === undefined ? row.minutes : Math.max(30, Math.round(patch.minutes / 30) * 30);
              const time = snapHalfHour(patch.time && /^\d{2}:\d{2}$/.test(patch.time) ? patch.time : row.time);
              const date = patch.date && /^\d{4}-\d{2}-\d{2}$/.test(patch.date) ? patch.date : row.date;
              const lines = Array.isArray(patch.lines) && patch.lines.length > 0
                ? patch.lines.map((line, index) => ({
                    id: line.id || uid("al"),
                    code: lineLetter(index),
                    concern: line.concern.trim(),
                  })).filter((line) => line.concern)
                : row.lines;
              const kept = lines.length > 0 ? lines.map((line, index) => ({ ...line, code: lineLetter(index) })) : row.lines;
              const vin = (patch.vin === undefined ? row.vin : patch.vin).trim().toUpperCase();
              const laborOpIds = Array.isArray(patch.laborOpIds) ? patch.laborOpIds : row.laborOpIds ?? [];
              const vehicleId = patch.vehicleId || row.vehicleId;
              const lane = normalizeLane(patch.lane === undefined ? row.lane : patch.lane, state.settings.scheduling.transportOptions);
              const status = row.status === "cancelled" || patch.status === "cancelled" ? row.status : (patch.status ?? row.status);
              return { ...row, ...patch, minutes, time, date, lines: kept, concern: concernFromLines(kept) || row.concern, vin, laborOpIds, vehicleId, lane, status, cancelHistory: row.cancelHistory, id: row.id, orderId: row.orderId };
            })
            .sort((a, b) => a.date.localeCompare(b.date) || a.time.localeCompare(b.time)),
          customers: current
            ? adjustNoShows(state.customers, noShowChanges(current.status, nextStatus, current.customerId, nextCustomer))
            : state.customers,
          };
        });
        return { ok: true, error: null };
      },
      addAppointment: (input, id) => {
        const appointmentId = id ?? uid("ap");
        set((state) => {
          const raw = input.lines?.length ? input.lines : [{ id: "", code: "A", concern: input.concern }];
          const lines = raw
            .map((line, index) => ({ id: line.id || uid("al"), code: lineLetter(index), concern: line.concern.trim() }))
            .filter((line) => line.concern)
            .map((line, index) => ({ ...line, code: lineLetter(index) }));
          const kept = lines.length > 0 ? lines : [{ id: uid("al"), code: "A", concern: input.concern.trim() }];
          const vin = (input.vin || "").trim().toUpperCase();
          const row: Appointment = {
            ...input,
            date: input.date || today(),
            time: snapHalfHour(input.time || "07:00"),
            minutes: Math.max(30, Math.round((input.minutes || 60) / 30) * 30),
            lines: kept,
            concern: concernFromLines(kept),
            vin,
            laborOpIds: input.laborOpIds ?? [],
            lane: normalizeLane(input.lane, state.settings.scheduling.transportOptions),
            id: appointmentId,
            status: "scheduled",
            orderId: null,
          };
          return {
            vehicles: state.vehicles.map((vehicle) => (vehicle.id === row.vehicleId && vin ? { ...vehicle, vin } : vehicle)),
            appointments: [...state.appointments, row].sort((a, b) => a.date.localeCompare(b.date) || a.time.localeCompare(b.time)),
          };
        });
        return appointmentId;
      },
      saveAdvisorAppointment: (input, existingId) => {
        const state = get();
        if (existingId && !state.appointments.some((row) => row.id === existingId)) {
          return { ok: false, appointmentId: existingId, overrideId: null, error: "That appointment is not on this store." };
        }
        const existing = existingId ? state.appointments.find((row) => row.id === existingId) : undefined;
        if (existing && existing.status === "cancelled") {
          return { ok: false, appointmentId: existing.id, overrideId: null, error: CANCELLED_LOCKED };
        }
        const staffError = staffBlockMessage(
          state.techs.some((tech) => tech.id === input.techId),
          state.advisors.some((advisor) => advisor.id === input.advisorId),
        );
        if (staffError) return { ok: false, appointmentId: "", overrideId: null, error: staffError };
        const vehicleError = vehicleBookingError(state, input.customerId, input.vehicleId);
        if (vehicleError) return { ok: false, appointmentId: "", overrideId: null, error: vehicleError };
        const concernError = bookingConcernError(input.lines, input.concern);
        if (concernError) return { ok: false, appointmentId: "", overrideId: null, error: concernError };
        const appointmentId = existingId ?? uid("ap");
        const result = assessAppointment({
          scheduling: state.settings.scheduling,
          advisors: state.advisors,
          techs: state.techs,
          appointments: state.appointments,
          laborOps: state.laborOps,
          proposal: {
            date: input.date,
            time: input.time,
            minutes: input.minutes,
            advisorId: input.advisorId,
            techId: input.techId,
            laborOpIds: input.laborOpIds ?? [],
            ignoreId: existingId,
          },
        });
        if (result.blocked) return { ok: false, appointmentId: "", overrideId: null, error: result.blocked };
        if (existingId) get().updateAppointment(existingId, input);
        else {
          get().addAppointment({
            date: input.date,
            time: input.time,
            minutes: input.minutes,
            customerId: input.customerId,
            vehicleId: input.vehicleId,
            advisorId: input.advisorId,
            concern: input.concern,
            lines: input.lines,
            vin: input.vin,
            laborOpIds: input.laborOpIds,
            techId: input.techId,
            lane: input.lane,
          }, appointmentId);
        }
        const overrideId = logOverride(result, appointmentId, input);
        return { ok: true, appointmentId, overrideId, error: null };
      },
      cancelAppointment: (id, input, confirmArrived = false) => {
        const state = get();
        if (!mayCancelAppointment(deskActor(state))) {
          return { ok: false, error: "Only an advisor or service manager can cancel an appointment.", arrivedConfirm: null };
        }
        const current = state.appointments.find((row) => row.id === id);
        if (!current) return { ok: false, error: "That appointment is not on this store.", arrivedConfirm: null };
        if (current.status === "cancelled") return { ok: false, error: "This appointment is already cancelled.", arrivedConfirm: null };
        const linked = current.orderId ? state.orders.find((order) => order.id === current.orderId) : undefined;
        const orderBlock = repairOrderCancelBlock(current.orderId, linked);
        if (orderBlock) return { ok: false, error: orderBlock, arrivedConfirm: null };
        if (current.status === "arrived" && !confirmArrived) {
          return { ok: false, error: null, arrivedConfirm: ARRIVED_CANCEL_CONFIRM };
        }
        const reasonError = cancelInputError(input.reason, input.note ?? "");
        if (reasonError) return { ok: false, error: reasonError, arrivedConfirm: null };
        const who = actingStaff(state);
        const record: AppointmentCancel = {
          action: "cancel",
          reason: input.reason,
          note: (input.note ?? "").trim().slice(0, CANCEL_NOTE_MAX),
          who: who.name,
          whoId: who.id,
          at: now().toISOString(),
          priorStatus: current.status,
        };
        set((currentState) => {
          const row = currentState.appointments.find((item) => item.id === id);
          if (!row || row.status === "cancelled") return currentState;
          return {
            appointments: currentState.appointments.map((item) => (item.id === id
              ? { ...item, status: "cancelled" as const, cancelHistory: [...(item.cancelHistory ?? []), { ...record, priorStatus: row.status }] }
              : item)),
            customers: adjustNoShows(currentState.customers, noShowChanges(row.status, "cancelled", row.customerId, row.customerId)),
            onlineRequests: (currentState.onlineRequests ?? []).map((request) => (
              request.appointmentId === id && request.status === "approved" ? { ...request, status: "cancelled" as const } : request
            )),
          };
        });
        return { ok: true, error: null, arrivedConfirm: null };
      },
      reinstateAppointment: (id, confirmOverride = false) => {
        const state = get();
        if (!mayCancelAppointment(deskActor(state))) {
          return { ok: false, overrideId: null, error: "Only an advisor or service manager can reinstate an appointment.", warning: null };
        }
        const current = state.appointments.find((row) => row.id === id);
        if (!current) return { ok: false, overrideId: null, error: "That appointment is not on this store.", warning: null };
        if (current.status !== "cancelled") return { ok: false, overrideId: null, error: "This appointment is not cancelled.", warning: null };
        const linked = current.orderId ? state.orders.find((order) => order.id === current.orderId) : undefined;
        const closedBlock = repairOrderReinstateBlock(linked);
        if (closedBlock) return { ok: false, overrideId: null, error: closedBlock, warning: null };
        const staffError = staffBlockMessage(
          state.techs.some((tech) => tech.id === current.techId),
          state.advisors.some((advisor) => advisor.id === current.advisorId),
        );
        if (staffError) return { ok: false, overrideId: null, error: staffError, warning: null };
        const result = assessAppointment({
          scheduling: state.settings.scheduling,
          advisors: state.advisors,
          techs: state.techs,
          appointments: state.appointments,
          laborOps: state.laborOps,
          proposal: {
            date: current.date,
            time: current.time,
            minutes: current.minutes,
            advisorId: current.advisorId,
            techId: current.techId,
            laborOpIds: current.laborOpIds ?? [],
            ignoreId: current.id,
          },
        });
        if (result.blocked) return { ok: false, overrideId: null, error: result.blocked, warning: null };
        const warning = advisorBookingNote(result);
        if (warning && !confirmOverride) {
          return { ok: false, overrideId: null, error: null, warning };
        }
        const who = actingStaff(state);
        const reinstated: AppointmentCancel = {
          action: "reinstate",
          reason: "",
          note: "",
          who: who.name,
          whoId: who.id,
          at: now().toISOString(),
        };
        set((currentState) => ({
          appointments: currentState.appointments.map((row) => (row.id === id && row.status === "cancelled"
            ? { ...row, status: "scheduled" as const, cancelHistory: [...(row.cancelHistory ?? []), reinstated] }
            : row)),
          onlineRequests: (currentState.onlineRequests ?? []).map((request) => (
            request.appointmentId === id && request.status === "cancelled" ? { ...request, status: "approved" as const } : request
          )),
        }));
        const overrideId = warning ? logOverride(result, id, current) : null;
        return { ok: true, overrideId, error: null, warning };
      },
      setWorkingAs: (id) =>
        set((state) => {
          const known = state.advisors.some((advisor) => advisor.id === id) || state.techs.some((tech) => tech.id === id);
          if (!known) return state;
          return { workingAsId: id };
        }),
      issueOnlineChallenge: (customerId) => {
        const customer = get().customers.find((row) => row.id === customerId);
        if (!customer) return { ok: false, reason: "unknown" };
        if (!customer.mobile.trim()) return { ok: false, reason: "no-mobile" };
        const code = makeOnlineCode();
        const issuedAt = now().toISOString();
        set((state) => ({
          onlineChallenges: [
            ...(state.onlineChallenges ?? []).filter((row) => row.customerId !== customerId),
            { customerId, code, issuedAt },
          ],
        }));
        return { ok: true, code, mobileLast4: customer.mobile.replace(/\D/g, "").slice(-4) };
      },
      addOnlineRequest: (input) => {
        const id = uid("rq");
        const at = now().toISOString();
        const result = submitOnlineRequest(get(), input, id, at);
        if (!result.ok) return result;
        set((state) => ({
          onlineRequests: [...(state.onlineRequests ?? []), result.request],
          onlineChallenges: result.request.verified
            ? (state.onlineChallenges ?? []).filter((row) => row.customerId !== result.request.customerId)
            : state.onlineChallenges,
        }));
        return { ok: true, id };
      },
      approveOnlineRequest: (id, linkCustomerId) => {
        const state = get();
        const request = state.onlineRequests.find((row) => row.id === id && row.status === "pending");
        if (!request) return { ok: false, reason: "missing" };
        const plan = planApproval({
          request,
          customers: state.customers,
          vehicles: state.vehicles,
          linkCustomerId,
          at: now().toISOString(),
          ids: { appointmentId: uid("ap"), noticeId: uid("nt"), customerId: uid("c"), vehicleId: uid("v") },
        });
        if ("ok" in plan) return plan;
        set((current) => ({
          customers: plan.newCustomer ? [plan.newCustomer, ...current.customers] : current.customers,
          vehicles: plan.newVehicle ? [plan.newVehicle, ...current.vehicles] : current.vehicles,
          appointments: [...current.appointments, plan.appointment].sort((a, b) => a.date.localeCompare(b.date) || a.time.localeCompare(b.time)),
          onlineRequests: current.onlineRequests.map((row) => (row.id === id ? plan.request : row)),
          notices: [...(current.notices ?? []), plan.notice],
        }));
        return { ok: true, appointmentId: plan.appointment.id, noticeId: plan.notice.id };
      },
      declineOnlineRequest: (id) => {
        const state = get();
        const request = state.onlineRequests.find((row) => row.id === id && row.status === "pending");
        if (!request) return { ok: false, reason: "missing" };
        const notice = decisionNotice({ id: uid("nt"), at: now().toISOString(), request, kind: "decline" });
        set((current) => ({
          onlineRequests: current.onlineRequests.map((row) => (row.id === id ? { ...row, status: "declined" as const } : row)),
          notices: [...(current.notices ?? []), notice],
        }));
        return { ok: true, noticeId: notice.id };
      },
      simulateDayBeforeReminders: () => {
        const state = get();
        const day = tomorrowIso(now());
        const already = new Set((state.notices ?? []).filter((row) => row.kind === "reminder" && row.appointmentId).map((row) => row.appointmentId));
        const due = state.appointments.filter((row) => row.date === day && row.status !== "no_show" && row.status !== "cancelled" && !already.has(row.id));
        const notices = due.map((appointment) => {
          const request = state.onlineRequests.find((row) => row.appointmentId === appointment.id && row.status === "approved");
          const customer = state.customers.find((row) => row.id === appointment.customerId);
          const advisor = state.advisors.find((row) => row.id === appointment.advisorId);
          return reminderNotice({
            id: uid("nt"),
            at: now().toISOString(),
            appointment,
            customer,
            advisorName: advisor?.name ?? "Advisor",
            transportName: laneLabel(appointment.lane, state.settings.scheduling.transportOptions),
            method: reminderMethod(request, customer),
            storeId: state.activeStoreId,
          });
        });
        if (notices.length > 0) set((current) => ({ notices: [...(current.notices ?? []), ...notices] }));
        return { created: notices.length };
      },
      linkAppointment: (id, orderId) =>
        set((state) => {
          if (!orderId.trim()) return state;
          const order = state.orders.find((row) => row.id === orderId);
          if (!order) return state;
          if (state.appointments.some((row) => row.orderId === orderId)) return state;
          return {
            appointments: state.appointments.map((row) => {
              if (row.id !== id || row.status === "cancelled" || row.orderId) return row;
              return { ...row, status: "in_shop" as const, orderId };
            }),
          };
        }),
      setOnHand: (partId, onHand) =>
        set((state) => ({
          parts: state.parts.map((part) => (part.id === partId ? { ...part, onHand: Math.max(0, Math.round(onHand)) } : part)),
        })),
      addSku: (sku) =>
        set((state) => ({
          parts: [{ ...sku, id: uid("sku") }, ...state.parts],
        })),
      addExpense: (txn) =>
        set((state) => ({
          expenses: [{ ...txn, id: uid("ex"), amount: money2(txn.amount) }, ...state.expenses],
        })),
      removeExpense: (id) => set((state) => ({ expenses: state.expenses.filter((txn) => txn.id !== id) })),
      setBudget: (id, monthly) =>
        set((state) => ({
          budgets: state.budgets.map((row) => (row.id === id ? { ...row, monthly: Math.max(0, money2(monthly)) } : row)),
        })),
      setOverhead: (id, monthly) =>
        set((state) => ({
          overhead: state.overhead.map((row) => (row.id === id ? { ...row, monthly: Math.max(0, money2(monthly)) } : row)),
        })),
      sendCampaign: (input) =>
        set((state) => {
          if (!input.name.trim() || !input.message.trim() || input.recipientIds.length === 0) return state;
          const row: Campaign = {
            id: uid("cp"),
            name: input.name.trim(),
            message: input.message.trim(),
            audience: input.audience,
            sentOn: today(),
            recipientIds: input.recipientIds,
          };
          return { campaigns: [row, ...state.campaigns] };
        }),
      resetDemo: (confirmReplace) =>
        set((state) => {
          if (!sampleLoadAllowed(state, confirmReplace)) return state;
          return {
            ...createSeed(state.activeStoreId),
            settings: state.settings,
            focusOrderId: null,
          };
        }),
      clearShop: () =>
        set((state) => ({
          ...createEmptyShop(),
          settings: state.settings,
          focusOrderId: null,
        })),
      };
    },
    {
      name: SHOP_STORAGE_KEY,
        storage: createJSONStorage(() => {
          const backing = options.storage ?? browserLocalStorage();
          return demoMode ? shopPersistStorage(true, backing) : passwordStrippingStorage(backing);
        }),
        version: SHOP_PERSIST_VERSION,
        skipHydration: true,
        migrate: (persisted) => migrateSavedShop(persisted),
        merge: (persisted, current) => mergeSavedShop(persisted, current as ShopState),
        partialize: (state) => {
          const saved: Partial<ShopData> & { activeStoreId: StoreId; stores: Record<StoreId, ShopData> } = {
            activeStoreId: state.activeStoreId,
            stores: state.stores,
          };
          for (const key of dataKeys) saved[key] = state[key] as never;
          return saved as ShopState;
        },
      },
    ),
  );
}

export const useShop = createShopStore();

export function useShopHydrated() {
  return useShop.persist.hasHydrated();
}

export function readShop() {
  return useShop.getState();
}
