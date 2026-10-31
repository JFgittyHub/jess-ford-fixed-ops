import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import { advisorBookingNote, assessAppointment, overrideReason, staffBlockMessage, type CapacityResult } from "./capacity";
import { bookingConcernError, vehicleBookingError } from "./booking";
import { ARRIVED_CANCEL_CONFIRM, CANCEL_NOTE_MAX, CANCELLED_LOCKED, cancelInputError, deskActor, displayRecordedWhen, mayCancelAppointment, mayCloseRepairOrder, normalizeCancelHistory, repairOrderCancelBlock, repairOrderReinstateBlock } from "./cancel";
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
import { fullVin, isFullVin, normalizeVin, vinCheckWarning, vinEntryError, vinScheduleError } from "./vin";
import { isDemoMode } from "./demo";
import { browserLocalStorage, SHOP_STORAGE_KEY, shopPersistStorage, type ShopStorage } from "./shop-storage";
import { formatVisitDate, lastVisitMileage, mileageFloorMessage, mileageInOverrideText, mileageOutGapMessage, mileageOutOverrideText, openedInstant, preparedReason } from "./mileage";
import { earliestVisitStart, firstOwnership, mergeVinDuplicates, transferOwnership, transferReason } from "./ownership";
import { RO_CREATE_REFUSAL, RO_WRITE_REFUSAL, roCreationEnabled, roWritesEnabled } from "./ro-flags";
import { sectionLockEnabled } from "./section-lock";
import { inRange, MONEY_MAX, HOURS_MAX, QTY_MAX, asText, phoneDigits, NAME_MAX, TEXT_MAX, REASON_MAX } from "./range";
import { applyPartStock, bookRepairOrder, closeRepairOrder, closeRepairOrderWithNoWork, diagnosisOnRecord, linkLaborAndParts, mileageOverrideAllows, noWorkCloseError, unbookRepairOrder } from "./ro";
import { closedRecord, orderMoney, vehicleTitle } from "./metrics";
import type { Advisor, Appointment, AppointmentCancel, BookingWindow, Campaign, CancelReason, ClosedRecord, CloseSnapshot, Customer, DatedAuthorization, DayHours, ExpenseTxn, FeeLine, LaborLine, LaborOp, OnlineService, OverrideRecord, OwnershipChange, PartLine, PartSku, PayKind, RepairOrder, RoCloseType, RoHistoryEntry, RoPayment, RoStatus, RoleChange, ServiceManager, ShopData, StoreId, Tech, TechBoard, Vehicle, WeekdayIndex } from "./types";

export interface NewOrderInput {
  customerId: string;
  vehicleId: string;
  advisorId: string;
  lines: { concern: string }[];
  mileage: number;
  mileageOut?: number | null;
  /** Service manager only. Lets mileage in sit below the last visit. */
  mileageReason?: string;
  promiseTime: string;
  labor?: Omit<LaborLine, "id">[];
}

export interface NewCustomerInput {
  name: string;
  phone: string;
  year: number;
  model: string;
  make?: string;
  /** Full 17-character VIN. Outside demo mode nothing is generated when this is blank. */
  vin?: string;
  mobile?: string;
  email?: string;
  /** Required when the VIN is already on file for another customer. */
  confirmTransfer?: boolean;
  /** Why the vehicle is moving to this customer. Required with confirmTransfer. */
  transferReason?: string;
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
  addTech: (input: Pick<Tech, "number" | "name" | "skill" | "payStyle" | "flagRate" | "hourlyRate" | "board">) => boolean;
  updateTech: (id: string, patch: Partial<Pick<Tech, "number" | "name" | "skill" | "payStyle" | "flagRate" | "hourlyRate" | "board">>) => boolean;
  removeTech: (id: string) => "ok" | "used" | "appointments" | "role";
  addAdvisor: (input: Pick<Advisor, "number" | "name" | "base" | "laborPercent" | "partsPercent"> & { role?: Advisor["role"] }) => boolean;
  updateAdvisor: (id: string, patch: Partial<Pick<Advisor, "number" | "name" | "base" | "laborPercent" | "partsPercent" | "role">>) => boolean;
  removeAdvisor: (id: string) => "ok" | "used" | "role" | "last";
  /** Copies an advisor onto the service-manager roster. Does not change the advisor role. Working as is not a sign-in. */
  appointFirstServiceManager: (advisorId: string) => { ok: boolean; error: string | null };
  addServiceManager: (input: Pick<ServiceManager, "number" | "name" | "base" | "laborPercent" | "partsPercent">) => { ok: boolean; error: string | null };
  updateServiceManager: (id: string, patch: Partial<Pick<ServiceManager, "number" | "name" | "base" | "laborPercent" | "partsPercent" | "active">>) => { ok: boolean; error: string | null };
  removeServiceManager: (id: string) => { ok: boolean; error: string | null };
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
  /** Advisor close. Booked becomes Closed only when the required fields are complete. Closing is final. */
  closeOrder: (orderId: string) => { ok: boolean; error: string | null };
  /** $0 close for an open or booked repair order with no work. The RO number stays. */
  closeOrderWithNoWork: (orderId: string, note: string) => { ok: boolean; error: string | null };
  /** Service manager only. Saves a below-last-visit mileage in and logs the reason. */
  recordMileageOverride: (orderId: string, mileage: number, reason: string) => { ok: boolean; error: string | null };
  /** Service manager only. Allows mileage out more than 10,000 above mileage in, with a logged reason. */
  recordMileageOutOverride: (orderId: string, mileageOut: number, reason: string) => { ok: boolean; error: string | null };
  /** Phone and address on an open repair order. Locked once the repair order is closed. */
  updateOpenContact: (orderId: string, patch: { phone?: string; address?: string }) => void;
  /** VIN on the open repair order's vehicle. Locked once the repair order is closed. */
  updateOpenVin: (orderId: string, vin: string, confirmTransfer?: boolean, transferReason?: string) => { ok: boolean; error: string | null; warning: string | null; needsTransfer?: boolean };
  /** Move labor or a part off a flagged line onto a real job line. Logged. */
  moveWorkToJob: (orderId: string, kind: "labor" | "part", lineId: string, jobId: string) => void;
  addLabor: (orderId: string, line: Omit<LaborLine, "id">) => void;
  updateLabor: (orderId: string, lineId: string, patch: Partial<LaborLine>) => void;
  removeLabor: (orderId: string, lineId: string) => void;
  clockIn: (techId: string, orderId: string) => { ok: boolean; error: string | null };
  clockOut: (techId: string) => { ok: boolean; error: string | null };
  /** Service manager only. Ends a flagged punch on a Closed repair order and logs who did it. */
  resolveFlaggedPunch: (logId: string, endedAt: string) => { ok: boolean; error: string | null };
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
  removePayType: (id: string) => "ok" | "used" | "last" | "locked";
  attachInspection: (orderId: string) => void;
  setInspectionTech: (orderId: string, techId: string) => void;
  setInspectionPoint: (orderId: string, pointId: string, patch: Partial<Pick<MpiPoint, "status" | "reading" | "note">>) => void;
  createOrder: (input: NewOrderInput) => string;
  createCustomer: (input: NewCustomerInput) => { customerId: string; vehicleId: string; warning?: string | null; error?: string | null; needsTransfer?: boolean };
  /** New customer and repair order in one step. A VIN transfer is written only when the repair order is created. */
  openWalkIn: (input: NewCustomerInput & Omit<NewOrderInput, "customerId" | "vehicleId">) => { ok: boolean; orderId: string; error: string | null; warning: string | null; needsTransfer?: boolean };
  setAppointmentStatus: (id: string, status: ShopData["appointments"][number]["status"]) => void;
  moveAppointment: (id: string, patch: Partial<Pick<Appointment, "date" | "time" | "minutes" | "techId">>) => { ok: boolean; error: string | null };
  updateAppointment: (id: string, patch: Partial<Omit<Appointment, "id" | "orderId">>) => { ok: boolean; error: string | null };
  addAppointment: (input: Omit<ShopData["appointments"][number], "id" | "orderId" | "status">, id?: string) => string;
  /** Advisor book or edit. Off-store staff is refused. A capacity warning still saves and records an override. */
  saveAdvisorAppointment: (input: Omit<Appointment, "id" | "orderId">, existingId?: string, confirmTransfer?: boolean, transferReason?: string) => { ok: boolean; appointmentId: string; overrideId: string | null; error: string | null; warning?: string | null; needsTransfer?: boolean };
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
  "serviceManagers",
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
  return OPERATIONAL_KEYS.some((key) => Array.isArray(state[key]) && state[key].length > 0);
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
    ?? state.techs.find((tech) => tech.id === state.workingAsId);
  if (!picked) return { id: "", name: "" };
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

/** Closed, or a saved reopen from an older visit. Nothing may change it. */
function lockedOrder(order: RepairOrder) {
  return order.status === "closed" || Boolean(order.authorizationLocked);
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

/**
 * An invoiced repair order that already has a closed-history row was a closed sale.
 * It becomes Closed with who and when left empty. An invoiced repair order with no
 * history row becomes Booked.
 */
export function migrateOrderRecord(
  prior: { status?: string; closeType?: string | null; closeNote?: string; closedBy?: string; closedById?: string; closedAt?: string | null },
  inClosedHistory = false,
): Pick<RepairOrder, "status" | "closeType" | "closeNote" | "closedBy" | "closedById" | "closedAt"> {
  const rawStatus = prior.status ?? "";
  const status: RoStatus = rawStatus === "invoiced"
    ? (inClosedHistory ? "closed" : "booked")
    : rawStatus === "booked" || rawStatus === "closed" || OPEN_STATUS_PATCH.has(rawStatus as RoStatus)
      ? rawStatus as RoStatus
      : "open";
  const closeType: RoCloseType | null = prior.closeType === "no_work" && status === "closed" ? "no_work" : null;
  const closed = status === "closed";
  return {
    status,
    closeType,
    closeNote: typeof prior.closeNote === "string" ? prior.closeNote.trim().slice(0, 500) : "",
    closedBy: closed ? cleanRecordedName(prior.closedBy) : "",
    closedById: closed && typeof prior.closedById === "string" ? prior.closedById : "",
    closedAt: closed ? cleanRecordedWhen(prior.closedAt) : null,
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
  const manager = activeServiceManagers(state).find((row) => row.id === state.workingAsId);
  if (manager) return { id: manager.id, name: manager.name };
  const advisor = state.advisors.find((row) => row.id === state.workingAsId);
  const tech = state.techs.find((row) => row.id === state.workingAsId);
  if (tech && !advisor) {
    if (!mayCloseRepairOrder("technician")) return null;
    return { id: tech.id, name: tech.name };
  }
  if (!advisor) return null;
  if (!mayCloseRepairOrder("advisor")) return null;
  return { id: advisor.id, name: advisor.name };
}

function matchedStaff(state: ShopData): { id: string; name: string } | null {
  const manager = state.serviceManagers?.find((row) => row.id === state.workingAsId);
  if (manager) return { id: manager.id, name: manager.name };
  const advisor = state.advisors.find((row) => row.id === state.workingAsId);
  if (advisor) return { id: advisor.id, name: advisor.name };
  const tech = state.techs.find((row) => row.id === state.workingAsId);
  if (tech) return { id: tech.id, name: tech.name };
  return null;
}

function entry(who: { id: string; name: string } | null, fields: Omit<RoHistoryEntry, "at" | "who" | "whoId">): RoHistoryEntry {
  return { at: now().toISOString(), who: who?.name ?? "", whoId: who?.id ?? "", ...fields };
}

function appendHistory(order: RepairOrder, row: RoHistoryEntry): RepairOrder {
  return { ...order, history: [...(order.history ?? []), row] };
}

function identitySnapshot(order: RepairOrder, customer?: Customer, vehicle?: Vehicle): CloseSnapshot {
  const wa = normalizeWa(order.wa);
  return {
    customerName: customer?.name ?? "",
    phone: customer?.phone ?? "",
    address: wa.address,
    plate: wa.plate,
    vin: vehicle?.vin ?? "",
    year: vehicle?.year ?? 0,
    make: vehicle?.make ?? "",
    model: vehicle?.model ?? "",
  };
}

function withSnapshot(order: RepairOrder, customer?: Customer, vehicle?: Vehicle) {
  if (order.closeSnapshot) return order;
  return { ...order, closeSnapshot: identitySnapshot(order, customer, vehicle) };
}

function applySnapshot(copy: ClosedRecord, order: RepairOrder) {
  const snap = order.closeSnapshot;
  if (!snap) return copy;
  return {
    ...copy,
    customerName: snap.customerName,
    phone: snap.phone,
    address: snap.address,
    plate: snap.plate,
    vin: snap.vin,
    vehicle: vehicleTitle(snap.year, snap.make, snap.model),
  };
}

function appendClosedVersion(history: ClosedRecord[], order: RepairOrder, customer?: Customer, vehicle?: Vehicle) {
  if (order.closeType === "no_work" && history.some((row) => row.orderId === order.id && row.closeType === "no_work")) return history;
  const copy = applySnapshot(closedRecord(order, customer, vehicle), order);
  const versions = history.filter((row) => row.orderId === order.id).map((row) => row.version ?? 0);
  copy.version = (versions.length ? Math.max(...versions) : 0) + 1;
  copy.id = uid("hist");
  return [copy, ...history];
}

function feeList(fees: FeeLine[]) {
  return fees.map((fee) => `${fee.name} ${fee.amount}${fee.basis === "percent" ? "%" : ""} cap ${fee.cap ?? 0}`).join(", ");
}

function applyFeeChange(order: RepairOrder, fees: FeeLine[], who: { id: string; name: string } | null, text: string): RepairOrder {
  if (lockedOrder(order)) return order;
  const before = feeList(order.fees ?? []);
  const after = feeList(fees);
  if (before === after) return order;
  return appendHistory({ ...order, fees }, entry(who, { kind: "fee-changed", field: "fees", before, after, text: `${text}. ${before} → ${after}` }));
}

function shopsFrom(state: { orders: RepairOrder[]; vehicles: Vehicle[]; activeStoreId?: string; stores?: Partial<Record<string, { orders?: RepairOrder[]; vehicles?: Vehicle[] }>> }) {
  const activeId = state.activeStoreId === "pullman" ? "pullman" : "grand-coulee";
  const stores = { ...(state.stores ?? {}) };
  stores[activeId] = { ...(stores[activeId] ?? {}), orders: state.orders, vehicles: state.vehicles };
  const shops = Object.entries(stores).flatMap(([id, shop]) => {
    if (!shop || !Array.isArray(shop.orders) || !Array.isArray(shop.vehicles)) return [];
    return [{ orders: shop.orders.map((order) => ({ ...order, storeId: id })), vehicles: shop.vehicles }];
  });
  return shops.length > 0 ? shops : [{ orders: state.orders, vehicles: state.vehicles }];
}

function lastVisitFor(state: { orders: RepairOrder[]; vehicles: Vehicle[]; activeStoreId?: string; stores?: Record<string, { orders?: RepairOrder[]; vehicles?: Vehicle[] }> }, order: Pick<RepairOrder, "id" | "number" | "vehicleId" | "openedOn" | "openedAt">) {
  const vehicle = state.vehicles.find((row) => row.id === order.vehicleId);
  return lastVisitMileage(shopsFrom(state), vehicle, { excludeOrderId: order.id, openedAt: order.openedAt, openedOn: order.openedOn, number: order.number, storeId: state.activeStoreId });
}

function jobForLine(order: RepairOrder, requested?: string): string | null {
  const jobs = order.jobs ?? [];
  if (typeof requested === "string" && requested && jobs.some((job) => job.id === requested)) return requested;
  if (requested) return null;
  const real = jobs.filter((job) => !job.needsAssignment);
  if (real.length === 1) return real[0].id;
  if (jobs.length === 1) return jobs[0].id;
  return null;
}

function settleAssignment(order: RepairOrder): RepairOrder {
  const still = (id: string) => order.labor.some((line) => line.jobId === id) || order.parts.some((line) => line.jobId === id);
  const jobs = order.jobs.filter((job) => !job.needsAssignment || still(job.id));
  return jobs.length === order.jobs.length ? order : { ...order, jobs };
}

/** A Closed repair order is returned as it was saved. A valid job link is kept. */
function freezeClosedOrder(order: RepairOrder): RepairOrder {
  return order;
}

function closedRecordUses(orders: RepairOrder[], key: "vehicleId" | "customerId", id: string) {
  return orders.some((order) => order[key] === id && (order.status === "closed" || order.authorizationLocked));
}

function rosterEditor(state: ShopData) {
  const actor = deskActor(state);
  return actor === "advisor" || actor === "service-manager";
}

function rosterEditorError(state: ShopData): string | null {
  if (!namedActor(state)) return "Choose who is working.";
  if (!rosterEditor(state)) return "Only an advisor or service manager can change this.";
  return null;
}

function ownershipRow(
  who: { id: string; name: string } | null,
  vehicleId: string,
  beforeCustomerId: string,
  afterCustomerId: string,
  vin: string,
  reason: string,
): OwnershipChange {
  return {
    at: now().toISOString(),
    who: who?.name ?? "",
    whoId: who?.id ?? "",
    beforeVehicleId: vehicleId,
    afterVehicleId: vehicleId,
    beforeCustomerId,
    afterCustomerId,
    vin,
    reason,
  };
}

function sameVin(stored: string, next: string) {
  const left = normalizeVin(stored);
  const right = normalizeVin(next);
  return isFullVin(left) && left === right;
}

function appointmentMinutes(value: number | undefined, fallback: number) {
  if (value === undefined) return fallback;
  if (!Number.isFinite(value)) return fallback;
  const snapped = Math.round(value / 30) * 30;
  if (snapped < 30 || snapped > 1440) return fallback;
  return snapped;
}

function currentVehicle(vehicle: Vehicle) {
  return !vehicle.transferredTo;
}

function vehicleInUse(state: ShopData, vehicleId: string, exceptOrderId = "") {
  return state.orders.some((order) => order.vehicleId === vehicleId && order.id !== exceptOrderId)
    || state.appointments.some((row) => row.vehicleId === vehicleId);
}

type VinClaimResult =
  | { ok: false; error: string; warning: string | null; needsTransfer?: boolean; state?: undefined; vehicleId?: undefined; customerId?: undefined }
  | { ok: false; error: null; warning: string; needsTransfer: true; state?: undefined; vehicleId?: undefined; customerId?: undefined }
  | { ok: true; error: null; warning: string | null; needsTransfer?: false; state: ShopData; vehicleId: string; customerId: string };

/** One VIN rule for the editor, a new customer, and an appointment. Writes nothing when the caller does not confirm a transfer. */
function applyVinClaim(state: ShopData, input: {
  vin: string;
  customerId: string;
  confirm?: boolean;
  reason?: string;
  orderId?: string;
  year?: number;
  make?: string;
  model?: string;
}): VinClaimResult {
  const who = namedActor(state);
  if (!who) return { ok: false, error: "Choose who is working.", warning: null };
  if (!rosterEditor(state)) return { ok: false, error: "Only an advisor or service manager can change the VIN.", warning: null };
  const vinError = vinEntryError(input.vin);
  const nextVin = normalizeVin(input.vin);
  if (vinError || !isFullVin(nextVin)) return { ok: false, error: vinError ?? "VIN has to be 17 characters.", warning: null };
  const typed = state.customers.find((row) => row.id === input.customerId);
  if (!typed) return { ok: false, error: "That customer is not on this store.", warning: null };
  const ownerVehicle = state.vehicles.find((row) => currentVehicle(row) && sameVin(row.vin, nextVin));
  const warning = vinCheckWarning(nextVin);
  if (ownerVehicle && ownerVehicle.customerId !== typed.id) {
    const owner = state.customers.find((row) => row.id === ownerVehicle.customerId);
    const question = `This VIN is on file for ${owner?.name || "another customer"}. Transfer the vehicle to ${typed.name}?`;
    if (!input.confirm) return { ok: false, error: null, warning: question, needsTransfer: true };
    const reason = transferReason(input.reason);
    if ("error" in reason) return { ok: false, error: reason.error, warning: question, needsTransfer: true };
    const at = now().toISOString();
    const vehicleId = ownerVehicle.id;
    const previousCustomerId = ownerVehicle.customerId;
    const moved = transferOwnership(ownerVehicle, typed.id, at, who, reason.text, earliestVisitStart(state.orders, vehicleId, at));
    let vehicles = state.vehicles.map((row) => (row.id === vehicleId ? moved : row));
    const source = state.orders.find((row) => row.id === input.orderId);
    const fromVehicle = state.vehicles.find((row) => row.id === source?.vehicleId);
    if (fromVehicle && fromVehicle.id !== vehicleId && !normalizeVin(fromVehicle.vin) && !vehicleInUse(state, fromVehicle.id, input.orderId ?? "")) {
      vehicles = vehicles.filter((row) => row.id !== fromVehicle.id);
    }
    let orders = state.orders;
    if (roWritesEnabled()) {
      orders = state.orders.map((order) => {
        if (order.id === input.orderId) return order;
        if (order.vehicleId !== vehicleId || order.customerId !== previousCustomerId) return order;
        if (order.status === "closed" || order.authorizationLocked) return order;
        return appendHistory(order, entry(who, {
          kind: "note",
          field: "vin",
          before: previousCustomerId,
          after: typed.id,
          text: `This vehicle was transferred to ${typed.name} on ${formatVisitDate(today())}.`,
        }));
      });
    }
    if (roWritesEnabled() && input.orderId) {
      orders = mapOrder(orders, input.orderId, (live) => {
        if (lockedOrder(live)) return live;
        return appendHistory({ ...live, vehicleId, customerId: typed.id }, entry(who, {
          kind: "note",
          field: "vin",
          before: `${vehicleId} ${previousCustomerId}`,
          after: `${vehicleId} ${typed.id}`,
          text: `Transferred VIN ${nextVin} from ${owner?.name || "the previous owner"} to ${typed.name} by ${who.name}. Vehicle ${vehicleId} to ${vehicleId}. Customer ${previousCustomerId} to ${typed.id}.`,
        }));
      });
    }
    return {
      ok: true,
      error: null,
      warning,
      state: {
        ...state,
        vehicles,
        orders,
        ownershipLog: [...(state.ownershipLog ?? []), ownershipRow(who, vehicleId, previousCustomerId, typed.id, nextVin, reason.text)],
      },
      vehicleId,
      customerId: typed.id,
    };
  }
  let vehicles = state.vehicles;
  let vehicleId = ownerVehicle?.id ?? "";
  let orders = state.orders;
  if (!ownerVehicle) {
    const source = state.orders.find((row) => row.id === input.orderId);
    const held = source ? state.vehicles.find((row) => row.id === source.vehicleId) : undefined;
    if (held && closedRecordUses(state.orders, "vehicleId", held.id)) {
      vehicleId = uid("v");
      vehicles = [{ ...held, id: vehicleId, customerId: typed.id, vin: nextVin, transferredTo: undefined, ownership: [firstOwnership(typed.id, now().toISOString(), who)] }, ...vehicles];
    } else if (held && currentVehicle(held)) {
      vehicleId = held.id;
      vehicles = vehicles.map((row) => (row.id === held.id ? { ...row, vin: nextVin } : row));
    } else {
      vehicleId = uid("v");
      vehicles = [{ id: vehicleId, customerId: typed.id, year: input.year || 0, make: input.make || "Ford", model: input.model || "", vin: nextVin, ownership: [firstOwnership(typed.id, now().toISOString(), who)] }, ...vehicles];
    }
  }
  if (roWritesEnabled() && input.orderId) {
    const source = orders.find((row) => row.id === input.orderId);
    const previousId = source?.vehicleId ?? "";
    orders = mapOrder(orders, input.orderId, (live) => {
      if (lockedOrder(live)) return live;
      if (live.vehicleId === vehicleId && sameVin(state.vehicles.find((row) => row.id === vehicleId)?.vin ?? nextVin, nextVin)) return live;
      const beforeVin = state.vehicles.find((row) => row.id === live.vehicleId)?.vin ?? "";
      return appendHistory({ ...live, vehicleId }, entry(who, {
        kind: "note",
        field: "vin",
        before: beforeVin,
        after: nextVin,
        text: `VIN changed from ${beforeVin || "blank"} to ${nextVin} by ${who.name}`,
      }));
    });
    if (previousId && previousId !== vehicleId && !normalizeVin(state.vehicles.find((row) => row.id === previousId)?.vin ?? "") && !vehicleInUse({ ...state, orders }, previousId, input.orderId)) {
      vehicles = vehicles.filter((row) => row.id !== previousId);
    }
  }
  return { ok: true, error: null, warning, state: { ...state, vehicles, orders }, vehicleId, customerId: typed.id };
}

function namedActor(state: ShopData): { id: string; name: string } | null {
  const who = matchedStaff(state);
  if (!who?.id || !who.name.trim()) return null;
  return who;
}

function advisorRows(saved: Partial<ShopData>): Advisor[] {
  if (!Array.isArray(saved.advisors)) return [];
  return saved.advisors.filter((advisor) => advisor && typeof advisor === "object").map((advisor, index) => {
    const row = dropStaffPassword(advisor);
    return {
      ...row,
      number: row.number || ADVISOR_NUMBERS[row.id] || String(index + 1),
      role: row.role === "service-manager" ? "service-manager" as const : "advisor" as const,
      base: typeof row.base === "number" ? row.base : 4200,
      laborPercent: typeof row.laborPercent === "number" ? row.laborPercent : 5,
      partsPercent: typeof row.partsPercent === "number" ? row.partsPercent : 2,
    };
  });
}

function liftServiceManagers(advisors: Advisor[], existing: ServiceManager[] | undefined): { advisors: Advisor[]; serviceManagers: ServiceManager[] } {
  const managers = Array.isArray(existing) ? existing.filter((row) => row && row.id).map((row) => ({
    id: row.id,
    number: row.number || "",
    name: row.name || "",
    base: typeof row.base === "number" ? row.base : 0,
    laborPercent: typeof row.laborPercent === "number" ? row.laborPercent : 0,
    partsPercent: typeof row.partsPercent === "number" ? row.partsPercent : 0,
    active: row.active !== false,
  })) : [];
  const nextAdvisors = advisors.map((advisor) => {
    if (advisor.role === "service-manager" && !managers.some((row) => row.id === advisor.id)) {
      managers.push({
        id: advisor.id,
        number: advisor.number,
        name: advisor.name,
        base: advisor.base,
        laborPercent: advisor.laborPercent,
        partsPercent: advisor.partsPercent,
        active: true,
      });
    }
    return { ...advisor, role: "advisor" as const };
  });
  return { advisors: nextAdvisors, serviceManagers: managers };
}

function managerSummary(row: Pick<ServiceManager, "number" | "name" | "base" | "laborPercent" | "partsPercent" | "active">) {
  return `${row.number} ${row.name} base ${row.base} labor ${row.laborPercent} parts ${row.partsPercent} ${row.active === false ? "inactive" : "active"}`;
}

function activeServiceManagers(state: ShopData) {
  return (state.serviceManagers ?? []).filter((row) => row.active !== false);
}

function roleChangeAllowed(state: ShopData, from: string, to: string): boolean {
  if (from === to) return true;
  if (to === "service-manager") return false;
  if (!namedActor(state)) return false;
  if (activeServiceManagers(state).length === 0) return false;
  return deskActor(state) === "service-manager";
}

function roleChangeRow(who: { id: string; name: string } | null, advisorId: string, before: string, after: string, advisorName = ""): RoleChange {
  return { at: now().toISOString(), who: who?.name ?? "", whoId: who?.id ?? "", advisorId, before, after, ...(advisorName ? { advisorName } : {}) };
}

function serviceManager(state: ShopData): { id: string; name: string } | null {
  if (deskActor(state) !== "service-manager") return null;
  const manager = activeServiceManagers(state).find((row) => row.id === state.workingAsId);
  if (!manager) return null;
  return { id: manager.id, name: manager.name };
}

function serviceManagerEditError(state: ShopData, creating: boolean): string | null {
  if (!namedActor(state)) return "Choose who is working.";
  const actor = deskActor(state);
  if (actor === "technician" || actor === "customer") return "Only an advisor can add the first service manager.";
  if (activeServiceManagers(state).length === 0) {
    if (!creating) return "Add a service manager on this screen first.";
    if (actor !== "advisor") return "Only an advisor can add the first service manager.";
    return null;
  }
  if (actor !== "service-manager") return "Only a service manager can change service manager settings.";
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

function normalizeHistory(value: unknown): RoHistoryEntry[] {
  if (!Array.isArray(value)) return [];
  const rows: RoHistoryEntry[] = [];
  for (const item of value) {
    if (!item || typeof item !== "object") continue;
    const entry = item as RoHistoryEntry;
    if (typeof entry.text !== "string") continue;
    const rawKind = typeof entry.kind === "string" ? entry.kind.trim() : "";
    const kind = (rawKind || "note") as RoHistoryEntry["kind"];
    const row: RoHistoryEntry = {
      at: cleanRecordedWhen(entry.at) ?? "",
      who: cleanRecordedName(entry.who),
      whoId: typeof entry.whoId === "string" ? entry.whoId : "",
      kind,
      text: entry.text,
    };
    if (typeof entry.field === "string") row.field = entry.field;
    if (typeof entry.before === "string") row.before = entry.before;
    if (typeof entry.after === "string") row.after = entry.after;
    if (typeof entry.reason === "string") row.reason = entry.reason;
    if (entry.blocksNoWork === true) row.blocksNoWork = true;
    rows.push(row);
  }
  return rows;
}

function normalizeLaterAuth(value: unknown): DatedAuthorization[] {
  if (!Array.isArray(value)) return [];
  const rows: DatedAuthorization[] = [];
  for (const item of value) {
    if (!item || typeof item !== "object") continue;
    const row = item as Partial<DatedAuthorization>;
    rows.push({
      id: typeof row.id === "string" && row.id ? row.id : `auth-${rows.length + 1}`,
      at: typeof row.at === "string" ? row.at : "",
      who: cleanRecordedName(row.who),
      whoId: typeof row.whoId === "string" ? row.whoId : "",
      reason: typeof row.reason === "string" ? row.reason : "",
      address: typeof row.address === "string" ? row.address : "",
      initials: typeof row.initials === "string" ? row.initials : "",
      estimate: typeof row.estimate === "number" && Number.isFinite(row.estimate) ? row.estimate : 0,
      plate: typeof row.plate === "string" ? row.plate : "",
    });
  }
  return rows;
}

function normalizeSnapshot(value: unknown): CloseSnapshot | undefined {
  if (!value || typeof value !== "object") return undefined;
  const row = value as Partial<CloseSnapshot>;
  return {
    customerName: typeof row.customerName === "string" ? row.customerName : "",
    phone: typeof row.phone === "string" ? row.phone : "",
    address: typeof row.address === "string" ? row.address : "",
    plate: typeof row.plate === "string" ? row.plate : "",
    vin: typeof row.vin === "string" ? row.vin : "",
    year: typeof row.year === "number" && Number.isFinite(row.year) ? row.year : 0,
    make: typeof row.make === "string" ? row.make : "",
    model: typeof row.model === "string" ? row.model : "",
  };
}

function normalizeCloseFields(prior: RepairOrder, inClosedHistory = false) {
  const closeSnapshot = normalizeSnapshot(prior.closeSnapshot);
  return {
    ...migrateOrderRecord(prior, inClosedHistory),
    payments: normalizePayments(prior.payments),
    droppedFeesNote: typeof prior.droppedFeesNote === "string" ? prior.droppedFeesNote : "",
    history: normalizeHistory(prior.history),
    laterAuthorizations: normalizeLaterAuth(prior.laterAuthorizations),
    ...(closeSnapshot ? { closeSnapshot } : {}),
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
        const percent = fee.basis === "percent";
        return {
          id,
          name: asText(name, NAME_MAX) ?? "Fee",
          amount: inRange(fee.amount, 0, percent ? 100 : MONEY_MAX) ? fee.amount : 0,
          basis: percent ? "percent" as const : "flat" as const,
          cap: inRange(fee.cap, 0, MONEY_MAX) ? fee.cap : 0,
        };
      });
  }
  if (value && typeof value === "object") {
    const legacy = value as { shop?: number; hazmat?: number; disposal?: number };
    if ("shop" in legacy || "hazmat" in legacy || "disposal" in legacy) {
      return [
        { id: "shop", name: "Misc Shop Fee", amount: 8, basis: "percent", cap: 35 },
        { id: "hazmat", name: "Hazmat Fee", amount: inRange(legacy.hazmat, 0, MONEY_MAX) ? legacy.hazmat : 0, basis: "flat", cap: 0 },
        { id: "disposal", name: "Disposal Fee", amount: inRange(legacy.disposal, 0, MONEY_MAX) ? legacy.disposal : 0, basis: "flat", cap: 0 },
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
  "serviceManagers",
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
  "roleLog",
  "ownershipLog",
];

/** Persisted-shop load path. Staff passwords and the old admin password are removed on every branch, including a saved blob with no repair-order list. */
export function migrateSavedShop(persisted: unknown): ShopState {
  if (!persisted || typeof persisted !== "object") return persisted as ShopState;
  const saved = withoutSavedPasswords(persisted as Partial<ShopData>);
  if (!Array.isArray(saved.orders)) {
    const lifted = Array.isArray(saved.advisors)
      ? liftServiceManagers(advisorRows(saved), Array.isArray(saved.serviceManagers) ? saved.serviceManagers : undefined)
      : { serviceManagers: Array.isArray(saved.serviceManagers) ? saved.serviceManagers : [] };
    return finishMigrate({
      ...saved,
      ...lifted,
      dataset: saved.dataset === "sample" ? "sample" : "shop",
      customers: withCustomerFields(saved.customers) ?? saved.customers,
      settings: withScheduling(saved.settings) ?? saved.settings,
    } as ShopState);
  }
  const techList = Array.isArray(saved.techs) ? saved.techs.filter((tech) => tech && typeof tech === "object") : [];
  const vehicleList = Array.isArray(saved.vehicles) ? saved.vehicles.filter((vehicle) => vehicle && typeof vehicle === "object") : [];
  const historyIds = new Set(
    (Array.isArray(saved.closedHistory) ? saved.closedHistory : [])
      .filter((row) => row && typeof row === "object")
      .map((row) => (row as ClosedRecord).orderId)
      .filter((id) => typeof id === "string" && id),
  );
  const shelf: PartSku[] = Array.isArray(saved.parts) ? saved.parts.map((part) => ({ ...part })) : [];
  const transports = (withScheduling(saved.settings) ?? saved.settings)?.scheduling?.transportOptions ?? normalizeScheduling(undefined).transportOptions;
  return finishMigrate({
    ...saved,
    parts: shelf,
    vehicles: vehicleList.map((vehicle) => {
      const make = typeof vehicle.make === "string" && vehicle.make.trim() ? vehicle.make.trim() : "Ford";
      const raw = typeof vehicle.vin === "string" ? vehicle.vin : "";
      const held = (saved.orders ?? []).some((order) => order && order.vehicleId === vehicle.id && (order.status === "closed" || (order.status as string) === "invoiced" || order.authorizationLocked));
      return { ...vehicle, make, vin: held ? raw : normalizeVin(raw) };
    }),
    orders: saved.orders.filter((order) => order && typeof order === "object").map((order) => {
      const prior = order as RepairOrder & { cause?: string; correction?: string; jobs?: JobLine[] };
      const labor = Array.isArray(prior.labor) ? prior.labor : [];
      const parts = Array.isArray(prior.parts) ? prior.parts.filter((line) => line && typeof line === "object") : [];
      const jobs = Array.isArray(prior.jobs) && prior.jobs.length > 0
        ? prior.jobs
        : [jobLine(`${prior.id}-a`, "A", prior.concern ?? "", prior.cause ?? "", prior.correction ?? "")];
      if (prior.status === "closed") return freezeClosedOrder(prior);
      const wa = normalizeWa(prior.wa);
      const stamped = wa;
      const keepFees = (prior.status as string) === "invoiced" || Boolean(prior.authorizationLocked) || historyIds.has(prior.id);
      const built: RepairOrder = {
        ...prior,
        jobs,
        concern: concernFromJobs(jobs) || prior.concern,
        bay: prior.bay ?? bayFromStatus(prior.status),
        mileageOut: prior.mileageOut ?? null,
        ...(keepFees ? (Array.isArray(prior.fees) ? { fees: prior.fees } : {}) : { fees: normalizeFees(Array.isArray(prior.fees) ? prior.fees : saved.settings?.fees) }),
        taxRate: typeof prior.taxRate === "number" ? prior.taxRate : (typeof saved.settings?.taxRate === "number" ? saved.settings.taxRate : DEFAULT_TAX_RATE),
        inspection: prior.inspection ?? demoSheet(prior.id),
        labor,
        parts: parts.map((line) => ({ ...line, condition: line.condition ?? "new" })),
        wa: stamped,
        ...(() => {
          if ((prior.status as string) === "invoiced" && !historyIds.has(prior.id) && prior.stockApplied) {
            const restored = applyPartStock(shelf, { ...prior, parts } as RepairOrder, 1, typeof prior.invoicedOn === "string" ? prior.invoicedOn : "");
            shelf.splice(0, shelf.length, ...restored);
          }
          return normalizeCloseFields(prior, historyIds.has(prior.id));
        })(),
        stockApplied: (prior.status as string) === "invoiced" && !historyIds.has(prior.id) ? false : Boolean(prior.stockApplied),
        authorizationLocked: (prior.status as string) === "invoiced" && historyIds.has(prior.id) ? true : Boolean(prior.authorizationLocked),
      };
      const previouslyClosed = Boolean(prior.authorizationLocked) || historyIds.has(prior.id);
      if (previouslyClosed) {
        if (built.status !== "closed" && !built.stockApplied && built.parts.some((line) => line.partId && line.qty)) {
          const nextShelf = applyPartStock(shelf, built, -1, typeof prior.invoicedOn === "string" ? prior.invoicedOn : "");
          shelf.splice(0, shelf.length, ...nextShelf);
          built.stockApplied = true;
        }
        built.status = "closed";
        built.authorizationLocked = true;
      }
      if (built.status === "closed" && !built.closeSnapshot) {
        const customer = (Array.isArray(saved.customers) ? saved.customers : []).find((row) => row.id === prior.customerId);
        const vehicle = vehicleList.find((row) => row.id === prior.vehicleId);
        built.closeSnapshot = identitySnapshot(built, customer, vehicle);
      }
      if (built.status !== "closed" && !built.authorizationLocked && !(typeof prior.openedAt === "string" && prior.openedAt.trim())) {
        built.openedAt = new Date(openedInstant(prior)).toISOString();
      }
      return linkLaborAndParts(built);
    }),
    laborOps: Array.isArray(saved.laborOps) && saved.laborOps.length > 0 ? saved.laborOps : laborCatalog(),
    payTypes: Array.isArray(saved.payTypes) && saved.payTypes.length > 0 ? saved.payTypes : defaultPayTypes(saved.settings),
    campaigns: Array.isArray(saved.campaigns) ? saved.campaigns : [],
    dataset: saved.dataset === "sample" ? "sample" : "shop",
    appointments: Array.isArray(saved.appointments)
      ? saved.appointments.filter((row) => row && typeof row === "object").map((row) => {
          const vehicle = vehicleList.find((item) => item.id === row.vehicleId);
          const rawLines = Array.isArray(row.lines) ? row.lines.filter((line) => line && typeof line === "object") : [];
          const lines = rawLines.length > 0
            ? rawLines.map((line, index) => ({ id: line.id || `${row.id}-l${index}`, code: lineLetter(index), concern: line.concern ?? "" }))
            : [{ id: `${row.id}-a`, code: "A", concern: row.concern ?? "" }];
          const fallback: Record<string, string> = { a1: "luis", a2: "chris", a3: "priya", a4: "sam", a5: "elena", a6: "marcus", a7: "andre", a8: "marcus", a9: "luis", a10: "chris" };
          const known = techList.some((tech) => tech && tech.id === row.techId) ? row.techId : "";
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
    timeLogs: Array.isArray(saved.timeLogs)
      ? saved.timeLogs.map((row) => {
          if (!row || row.endedAt) return row;
          const order = (Array.isArray(saved.orders) ? saved.orders : []).find((item) => item && item.id === row.orderId);
          const closed = order && order.status === "closed";
          if (!closed) return row;
          const closeAt = typeof order.closedAt === "string" && order.closedAt.trim() ? order.closedAt : "";
          if (!closeAt || Date.parse(closeAt) < Date.parse(row.startedAt)) {
            return { ...row, needsReview: true, note: row.note || "No usable close time, so the punch stays open for service manager review." };
          }
          return { ...row, endedAt: closeAt, needsReview: true, note: row.note || "Ended at the repair order's close time for service manager review." };
        })
      : [],
    closedHistory: Array.isArray(saved.closedHistory) ? saved.closedHistory.map((row) => migrateHistoryRow(row)) : [],
    roleLog: Array.isArray(saved.roleLog) ? saved.roleLog : [],
    ownershipLog: Array.isArray(saved.ownershipLog) ? saved.ownershipLog : [],
    ...liftServiceManagers(advisorRows(saved), Array.isArray(saved.serviceManagers) ? saved.serviceManagers : undefined),
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
  } as ShopState);
}

function finishMigrate(shop: ShopState): ShopState {
  if (!Array.isArray(shop.vehicles) || !Array.isArray(shop.orders)) return shop;
  const merged = mergeVinDuplicates(shop.vehicles, shop.orders);
  if (merged.vehicles === shop.vehicles && merged.orders === shop.orders) return shop;
  return { ...shop, vehicles: merged.vehicles, orders: merged.orders };
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

/** Bumped so advisor service-manager roles become service manager records. Role log rows stay. */
export const SHOP_PERSIST_VERSION = 38;

function sliceHasActiveManager(row: Partial<ShopData> | undefined): boolean {
  if (!row) return false;
  if ((row.serviceManagers ?? []).some((manager) => manager && manager.id && manager.active !== false)) return true;
  return (row.advisors ?? []).some((advisor) => advisor.role === "service-manager");
}

function adoptPersistedManagers(
  backing: ShopStorage,
  get: () => ShopState,
  set: (partial: Partial<ShopState>) => void,
): boolean {
  const saved = persistedManagers(backing.getItem(SHOP_STORAGE_KEY), get().activeStoreId);
  if (!saved || !sliceHasActiveManager(saved)) return false;
  const lifted = liftServiceManagers(saved.advisors ?? get().advisors, saved.serviceManagers);
  const roleLog = [...(saved.roleLog ?? [])];
  for (const row of get().roleLog ?? []) {
    if (!roleLog.some((item) => item.at === row.at && item.advisorId === row.advisorId && item.before === row.before && item.after === row.after)) roleLog.push(row);
  }
  set({ serviceManagers: lifted.serviceManagers, roleLog });
  return true;
}

function persistedManagers(raw: string | null, storeId: StoreId) {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as { state?: ShopData & { activeStoreId?: StoreId; stores?: Partial<Record<StoreId, ShopData>> } };
    const saved = parsed.state;
    if (!saved) return null;
    const own = saved.stores?.[storeId];
    if (own) return sliceHasActiveManager(own) ? own : null;
    if (saved.stores && saved.activeStoreId && saved.activeStoreId !== storeId) return null;
    return sliceHasActiveManager(saved) ? saved : null;
  } catch {
    return null;
  }
}

export function repairOrderWriterError(state: ShopData): string | null {
  if (!namedActor(state)) return "Choose who is working.";
  if (deskActor(state) !== "advisor" && deskActor(state) !== "service-manager") {
    return "Only an advisor or service manager can write a repair order.";
  }
  return null;
}

export function vehicleWriterError(state: ShopData): string | null {
  if (!namedActor(state)) return "Choose who is working.";
  if (deskActor(state) !== "advisor" && deskActor(state) !== "service-manager") {
    return "Only an advisor or service manager can add a vehicle.";
  }
  return null;
}

export function createShopStore(options: ShopStoreOptions = {}) {
  const demoMode = options.demoMode ?? isDemoMode();
  const backing = options.storage ?? browserLocalStorage();
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
          return { ...next, roleLog: next.roleLog ?? [], ownershipLog: next.ownershipLog ?? [], activeStoreId: id, stores: state.stores, focusOrderId: null };
        });
      },
      setFocus: (id) => set({ focusOrderId: id }),
      updateSettings: (patch) =>
        set((state) => {
          const settings = { ...state.settings };
          if (typeof patch.storeName === "string") {
            const storeName = asText(patch.storeName, NAME_MAX);
            if (storeName) settings.storeName = storeName;
          }
          if (typeof patch.city === "string") {
            const city = asText(patch.city, TEXT_MAX);
            if (city !== null) settings.city = city;
          }
          if (typeof patch.phone === "string") settings.phone = patch.phone;
          if (typeof patch.address === "string") {
            const address = asText(patch.address, TEXT_MAX);
            if (address !== null) settings.address = address;
          }
          const rateEditor = namedActor(state);
          const mayEditRates = Boolean(rateEditor) && rosterEditor(state);
          if (mayEditRates && inRange(patch.cpRate, 0, MONEY_MAX)) settings.cpRate = patch.cpRate;
          if (mayEditRates && inRange(patch.warrantyRate, 0, MONEY_MAX)) settings.warrantyRate = patch.warrantyRate;
          if (mayEditRates && inRange(patch.internalRate, 0, MONEY_MAX)) settings.internalRate = patch.internalRate;
          if (inRange(patch.targetAbsorption, 0, 100)) settings.targetAbsorption = patch.targetAbsorption;
          if (inRange(patch.targetElr, 0, MONEY_MAX)) settings.targetElr = patch.targetElr;
          if (inRange(patch.policyGuide, 0, MONEY_MAX)) settings.policyGuide = patch.policyGuide;
          const fees = Array.isArray(patch.fees) ? normalizeFees(patch.fees) : settings.fees;
          const taxRate = inRange(patch.taxRate, 0, 20) ? patch.taxRate : settings.taxRate;
          settings.fees = fees;
          settings.taxRate = taxRate;
          const who = matchedStaff(state);
          const roleLog = [...(state.roleLog ?? [])];
          if (mayEditRates && rateEditor && settings.cpRate !== state.settings.cpRate) {
            roleLog.push(roleChangeRow(rateEditor, "cp", String(state.settings.cpRate), String(settings.cpRate), "Customer"));
          }
          return {
            settings,
            roleLog,
            orders: !roWritesEnabled() ? state.orders : state.orders.map((order) => {
              if (lockedOrder(order)) return order;
              let next = order;
              if (patch.taxRate !== undefined && taxRate !== order.taxRate) {
                const beforeTax = orderMoney(order).tax;
                next = { ...next, taxRate };
                const afterTax = orderMoney(next).tax;
                if (beforeTax !== afterTax) {
                  next = appendHistory(next, entry(who, {
                    kind: "fee-changed",
                    field: "taxRate",
                    before: String(order.taxRate),
                    after: String(taxRate),
                    text: `Sales tax ${order.taxRate}% → ${taxRate}%`,
                  }));
                }
              }
              if (Array.isArray(patch.fees)) return applyFeeChange(next, fees, who, "Updated shop fees");
              return next;
            }),
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
        if (!inRange(input.laborHours, 0.01, HOURS_MAX)) return false;
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
      addTech: (input) => {
        const name = input.name.trim();
        const number = input.number.trim();
        if (!name || !number || !inRange(input.flagRate, 0, MONEY_MAX) || !inRange(input.hourlyRate, 0, MONEY_MAX)) return false;
        let added = false;
        set((state) => {
          if (rosterEditorError(state)) return state;
          if (state.techs.some((tech) => tech.number === number)) return state;
          added = true;
          const tech: Tech = {
            id: uid("tech"),
            number,
            name,
            skill: input.skill,
            board: input.board,
            payStyle: input.payStyle,
            flagRate: money2(input.flagRate),
            hourlyRate: money2(input.hourlyRate),
            availableHoursMonth: 118,
            clockedHoursMonth: 0,
            clockedToday: 0,
          };
          const who = namedActor(state);
          return {
            roleLog: [...(state.roleLog ?? []), roleChangeRow(who, tech.id, "none", `${number} ${name}`, name)],
            techs: [...state.techs, tech].sort((a, b) => a.number.localeCompare(b.number, undefined, { numeric: true })),
          };
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
          if (!rosterEditor(state) || !namedActor(state)) return state;
          if (state.techs.some((tech) => tech.id !== id && tech.number === number)) return state;
          updated = true;
          const who = namedActor(state);
          const nextFlag = patch.flagRate === undefined || !inRange(patch.flagRate, 0, MONEY_MAX) ? current.flagRate : money2(patch.flagRate);
          const nextHourly = patch.hourlyRate === undefined || !inRange(patch.hourlyRate, 0, MONEY_MAX) ? current.hourlyRate : money2(patch.hourlyRate);
          const changed = number !== current.number || name !== current.name || nextFlag !== current.flagRate || nextHourly !== current.hourlyRate || (patch.payStyle !== undefined && patch.payStyle !== current.payStyle) || (patch.skill !== undefined && patch.skill !== current.skill) || (patch.board !== undefined && patch.board !== current.board);
          const before = name !== current.name && nextFlag === current.flagRate && nextHourly === current.hourlyRate && number === current.number ? current.name : `${current.number} ${current.name} flag ${current.flagRate} hourly ${current.hourlyRate}`;
          const after = name !== current.name && nextFlag === current.flagRate && nextHourly === current.hourlyRate && number === current.number ? name : `${number} ${name} flag ${nextFlag} hourly ${nextHourly}`;
          return {
            roleLog: changed ? [...(state.roleLog ?? []), roleChangeRow(who, id, before, after, current.name)] : state.roleLog,
            techs: state.techs.map((tech) =>
              tech.id === id
                ? {
                    ...dropStaffPassword(tech),
                    number,
                    name,
                    skill: patch.skill === undefined ? tech.skill : patch.skill,
                    payStyle: patch.payStyle === undefined ? tech.payStyle : patch.payStyle,
                    board: patch.board === undefined ? tech.board : patch.board,
                    flagRate: patch.flagRate === undefined || !inRange(patch.flagRate, 0, MONEY_MAX) ? tech.flagRate : money2(patch.flagRate),
                    hourlyRate: patch.hourlyRate === undefined || !inRange(patch.hourlyRate, 0, MONEY_MAX) ? tech.hourlyRate : money2(patch.hourlyRate),
                  }
                : tech,
            ),
          };
        });
        return updated;
      },
      removeTech: (id) => {
        let result: "ok" | "used" | "appointments" | "role" = "ok";
        set((state) => {
          if (rosterEditorError(state)) {
            result = "role";
            return state;
          }
          if (state.orders.some((order) => order.labor.some((line) => line.techId === id) || order.inspection?.techId === id)) {
            result = "used";
            return state;
          }
          if (state.appointments.some((row) => row.techId === id && row.status !== "cancelled")) {
            result = "appointments";
            return state;
          }
          const tech = state.techs.find((row) => row.id === id);
          const who = namedActor(state);
          return {
            roleLog: tech ? [...(state.roleLog ?? []), roleChangeRow(who, id, `${tech.number} ${tech.name}`, "removed", tech.name)] : state.roleLog,
            techs: state.techs.filter((row) => row.id !== id),
          };
        });
        return result;
      },
      addAdvisor: (input) => {
        const name = input.name.trim();
        const number = input.number.trim();
        if (!name || !number || !inRange(input.base, 0, MONEY_MAX) || !inRange(input.laborPercent, 0, 100) || !inRange(input.partsPercent, 0, 100)) return false;
        let added = false;
        if (input.role === "service-manager") return false;
        set((state) => {
          if (state.advisors.some((advisor) => advisor.number === number)) return state;
          const bootstrap = state.advisors.length === 0 && activeServiceManagers(state).length === 0;
          if (!bootstrap && rosterEditorError(state)) return state;
          if (!bootstrap && !roleChangeAllowed(state, "advisor", "advisor")) return state;
          added = true;
          const advisor: Advisor = {
            id: uid("adv"),
            number,
            name,
            base: money2(input.base),
            laborPercent: input.laborPercent,
            partsPercent: input.partsPercent,
            role: "advisor",
          };
          const who = namedActor(state) ?? { id: advisor.id, name: advisor.name };
          return {
            roleLog: [...(state.roleLog ?? []), roleChangeRow(who, advisor.id, "none", `${number} ${name}`, name)],
            advisors: [...state.advisors, advisor].sort((a, b) => a.number.localeCompare(b.number, undefined, { numeric: true })),
          };
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
          const nextRole = patch.role === "service-manager" || patch.role === "advisor" ? patch.role : (current.role ?? "advisor");
          const managers = state.advisors.filter((advisor) => advisor.role === "service-manager");
          if (!rosterEditor(state) || !namedActor(state)) return state;
          if (current.role === "service-manager" && nextRole !== "service-manager" && managers.length <= 1) return state;
          if (!roleChangeAllowed(state, current.role ?? "advisor", nextRole)) return state;
          updated = true;
          const who = namedActor(state);
          const before = `${current.number} ${current.name} base ${current.base} labor ${current.laborPercent} parts ${current.partsPercent} ${current.role ?? "advisor"}`;
          const nextBase = patch.base === undefined || !inRange(patch.base, 0, MONEY_MAX) ? current.base : money2(patch.base);
          const nextLabor = patch.laborPercent === undefined || !inRange(patch.laborPercent, 0, 100) ? current.laborPercent : patch.laborPercent;
          const nextParts = patch.partsPercent === undefined || !inRange(patch.partsPercent, 0, 100) ? current.partsPercent : patch.partsPercent;
          const after = `${number} ${name} base ${nextBase} labor ${nextLabor} parts ${nextParts} ${nextRole}`;
          const roleRows = [...(state.roleLog ?? [])];
          if ((current.role ?? "advisor") !== nextRole) roleRows.push(roleChangeRow(who, id, current.role ?? "advisor", nextRole, current.name));
          if (number !== current.number || name !== current.name || nextBase !== current.base || nextLabor !== current.laborPercent || nextParts !== current.partsPercent) {
            roleRows.push(roleChangeRow(who, id, before, after, current.name));
          }
          const roleLog = roleRows;
          return {
            roleLog,
            advisors: state.advisors.map((advisor) =>
              advisor.id === id
                ? {
                    ...dropStaffPassword(advisor),
                    number,
                    name,
                    role: nextRole,
                    base: patch.base === undefined || !inRange(patch.base, 0, MONEY_MAX) ? advisor.base : money2(patch.base),
                    laborPercent: patch.laborPercent === undefined || !inRange(patch.laborPercent, 0, 100) ? advisor.laborPercent : patch.laborPercent,
                    partsPercent: patch.partsPercent === undefined || !inRange(patch.partsPercent, 0, 100) ? advisor.partsPercent : patch.partsPercent,
                  }
                : advisor,
            ),
          };
        });
        return updated;
      },
      appointFirstServiceManager: (advisorId) => {
        const adopted = adoptPersistedManagers(backing, get, set);
        if (adopted) return { ok: false, error: "This store already has a service manager." };
        let error: string | null = null;
        set((shop) => {
          const who = namedActor(shop);
          if (!who) {
            error = "Choose who is working before setting a service manager.";
            return shop;
          }
          if (activeServiceManagers(shop).length > 0 || shop.advisors.some((advisor) => advisor.role === "service-manager")) {
            error = "This store already has a service manager.";
            return shop;
          }
          if (deskActor(shop) !== "advisor") {
            error = "Only an advisor can choose the first service manager.";
            return shop;
          }
          const advisor = shop.advisors.find((row) => row.id === advisorId);
          if (!advisor) {
            error = "That advisor is not on this store.";
            return shop;
          }
          error = null;
          const manager: ServiceManager = {
            id: advisor.id,
            number: advisor.number,
            name: advisor.name,
            base: advisor.base,
            laborPercent: advisor.laborPercent,
            partsPercent: advisor.partsPercent,
            active: true,
          };
          return {
            serviceManagers: [...(shop.serviceManagers ?? []).filter((row) => row.id !== advisor.id), manager],
            roleLog: [...(shop.roleLog ?? []), roleChangeRow(who, advisorId, advisor.role ?? "advisor", "service-manager", advisor.name)],
          };
        });
        return error ? { ok: false, error } : { ok: true, error: null };
      },
      addServiceManager: (input) => {
        const name = input.name.trim();
        const number = input.number.trim();
        if (!name || !number || !inRange(input.base, 0, MONEY_MAX) || !inRange(input.laborPercent, 0, 100) || !inRange(input.partsPercent, 0, 100)) {
          return { ok: false, error: "Need a number, a name, and a pay plan." };
        }
        if (activeServiceManagers(get()).length === 0 && adoptPersistedManagers(backing, get, set)) {
          return { ok: false, error: "This store already has a service manager." };
        }
        let error: string | null = null;
        set((shop) => {
          const gate = serviceManagerEditError(shop, true);
          if (gate) {
            error = gate;
            return shop;
          }
          if ((shop.serviceManagers ?? []).some((row) => row.number === number)) {
            error = "That service manager number is already on the drive.";
            return shop;
          }
          const who = namedActor(shop);
          error = null;
          const manager: ServiceManager = {
            id: uid("sm"),
            number,
            name,
            base: money2(input.base),
            laborPercent: input.laborPercent,
            partsPercent: input.partsPercent,
            active: true,
          };
          return {
            serviceManagers: [...(shop.serviceManagers ?? []), manager].sort((a, b) => a.number.localeCompare(b.number, undefined, { numeric: true })),
            roleLog: [
              ...(shop.roleLog ?? []),
              roleChangeRow(who, manager.id, "none", "service-manager", manager.name),
              roleChangeRow(who, manager.id, "none", managerSummary(manager), manager.name),
            ],
          };
        });
        return error ? { ok: false, error } : { ok: true, error: null };
      },
      updateServiceManager: (id, patch) => {
        let error: string | null = null;
        set((shop) => {
          const current = (shop.serviceManagers ?? []).find((row) => row.id === id);
          if (!current) {
            error = "That service manager is not on this store.";
            return shop;
          }
          const gate = serviceManagerEditError(shop, false);
          if (gate) {
            error = gate;
            return shop;
          }
          const number = patch.number === undefined ? current.number : patch.number.trim();
          const name = patch.name === undefined ? current.name : patch.name.trim();
          if (!number || !name) {
            error = "A service manager needs a number and a name.";
            return shop;
          }
          if ((shop.serviceManagers ?? []).some((row) => row.id !== id && row.number === number)) {
            error = "That service manager number is already on the drive.";
            return shop;
          }
          const nextActive = patch.active === undefined ? current.active !== false : patch.active !== false;
          const activeCount = activeServiceManagers(shop).length;
          if (current.active !== false && !nextActive && activeCount <= 1) {
            error = `${shop.settings.storeName} needs at least one service manager.`;
            return shop;
          }
          const next: ServiceManager = {
            ...current,
            number,
            name,
            base: patch.base === undefined || !inRange(patch.base, 0, MONEY_MAX) ? current.base : money2(patch.base),
            laborPercent: patch.laborPercent === undefined || !inRange(patch.laborPercent, 0, 100) ? current.laborPercent : patch.laborPercent,
            partsPercent: patch.partsPercent === undefined || !inRange(patch.partsPercent, 0, 100) ? current.partsPercent : patch.partsPercent,
            active: nextActive,
          };
          const before = managerSummary(current);
          const after = managerSummary(next);
          error = null;
          if (before === after) return { serviceManagers: shop.serviceManagers };
          const who = namedActor(shop);
          return {
            serviceManagers: (shop.serviceManagers ?? []).map((row) => (row.id === id ? next : row)),
            roleLog: [...(shop.roleLog ?? []), roleChangeRow(who, id, before, after, current.name)],
          };
        });
        return error ? { ok: false, error } : { ok: true, error: null };
      },
      removeServiceManager: (id) => {
        let error: string | null = null;
        set((shop) => {
          const current = (shop.serviceManagers ?? []).find((row) => row.id === id);
          if (!current) {
            error = "That service manager is not on this store.";
            return shop;
          }
          const gate = serviceManagerEditError(shop, false);
          if (gate) {
            error = gate;
            return shop;
          }
          if (current.active !== false && activeServiceManagers(shop).length <= 1) {
            error = `${shop.settings.storeName} needs at least one service manager.`;
            return shop;
          }
          const who = namedActor(shop);
          error = null;
          return {
            serviceManagers: (shop.serviceManagers ?? []).filter((row) => row.id !== id),
            roleLog: [...(shop.roleLog ?? []), roleChangeRow(who, id, `service-manager ${managerSummary(current)}`, "removed", current.name)],
          };
        });
        return error ? { ok: false, error } : { ok: true, error: null };
      },
      removeAdvisor: (id) => {
        let result: "ok" | "used" | "role" | "last" = "ok";
        set((state) => {
          const who = namedActor(state);
          if (deskActor(state) !== "service-manager" || !who) {
            result = "role";
            return state;
          }
          const target = state.advisors.find((advisor) => advisor.id === id);
          const managers = state.advisors.filter((advisor) => advisor.role === "service-manager");
          if (target?.role === "service-manager" && managers.length <= 1) {
            result = "last";
            return state;
          }
          const used = state.orders.some((order) => order.advisorId === id) || state.appointments.some((row) => row.advisorId === id);
          if (used) {
            result = "used";
            return state;
          }
          return {
            advisors: state.advisors.filter((advisor) => advisor.id !== id),
            roleLog: [...(state.roleLog ?? []), roleChangeRow(who, id, target?.role ?? "advisor", "removed", target?.name ?? "")],
          };
        });
        return result;
      },
      updateOrder: (orderId, patch) =>
        !roWritesEnabled() ? undefined : set((state) => ({
          orders: mapOrder(state.orders, orderId, (order) => {
            if (lockedOrder(order)) return order;
            const status = patch.status && OPEN_STATUS_PATCH.has(patch.status) && order.status !== "booked" ? patch.status : order.status;
            let mileage = order.mileage;
            const outOverride = (order.history ?? []).some((row) => row.kind === "mileage-override" && row.field === "mileageOut");
            if (patch.mileage !== undefined && Number.isFinite(patch.mileage) && patch.mileage > 0 && patch.mileage <= 999999) {
              const aboveOut = order.mileageOut != null && patch.mileage > order.mileageOut;
              const blocked = mileageFloorMessage(patch.mileage, lastVisitFor(state, order));
              if (!aboveOut && !outOverride && (!blocked || mileageOverrideAllows(order, patch.mileage))) mileage = patch.mileage;
            }
            let mileageOut = order.mileageOut;
            if (patch.mileageOut !== undefined) {
              if (patch.mileageOut === null) mileageOut = null;
              else if (inRange(patch.mileageOut, 0, 999999) && patch.mileageOut >= mileage) {
                const tooFar = mileageOutGapMessage(mileage, patch.mileageOut);
                if (!tooFar || mileageOverrideAllows(order, patch.mileageOut, "mileageOut")) mileageOut = patch.mileageOut;
              }
            }
            const who = matchedStaff(state);
            let next: RepairOrder = {
              ...order,
              concern: typeof patch.concern === "string" ? (asText(patch.concern, REASON_MAX) ?? order.concern) : order.concern,
              mileage,
              mileageOut,
              promiseTime: patch.promiseTime !== undefined ? patch.promiseTime : order.promiseTime,
              advisorId: patch.advisorId !== undefined && state.advisors.some((row) => row.id === patch.advisorId) ? patch.advisorId : order.advisorId,
              bay: patch.bay !== undefined ? patch.bay : order.bay,
              status,
            };
            if (mileage !== order.mileage) {
              next = appendHistory(next, entry(who, {
                kind: "note",
                field: "mileage",
                before: String(order.mileage),
                after: String(mileage),
                text: `Mileage in changed from ${order.mileage.toLocaleString("en-US")} to ${mileage.toLocaleString("en-US")} by ${who?.name || "the desk"}`,
              }));
            }
            if (mileageOut !== order.mileageOut) {
              next = appendHistory(next, entry(who, {
                kind: "note",
                field: "mileageOut",
                before: order.mileageOut == null ? "" : String(order.mileageOut),
                after: mileageOut == null ? "" : String(mileageOut),
                text: `Mileage out changed from ${order.mileageOut ?? "blank"} to ${mileageOut ?? "blank"} by ${who?.name || "the desk"}`,
              }));
            }
            return next;
          }),
        })),
      updateJob: (orderId, jobId, patch) =>
        !roWritesEnabled() ? undefined : set((state) => {
          const who = matchedStaff(state);
          return {
            orders: mapOrder(state.orders, orderId, (order) => {
              if (lockedOrder(order)) return order;
              const current = order.jobs ?? [];
              const previous = current.find((job) => job.id === jobId);
              const jobs = current.map((job) => {
                if (job.id !== jobId) return job;
                return {
                  ...job,
                  concern: typeof patch.concern === "string" ? (asText(patch.concern, REASON_MAX) ?? job.concern) : job.concern,
                  cause: typeof patch.cause === "string" ? (asText(patch.cause, REASON_MAX) ?? job.cause) : job.cause,
                  correction: typeof patch.correction === "string" ? (asText(patch.correction, REASON_MAX) ?? job.correction) : job.correction,
                };
              });
              let next = { ...order, jobs, concern: concernFromJobs(jobs) };
              if (previous) {
                const cleared: string[] = [];
                if (previous.cause.trim() && patch.cause !== undefined && !patch.cause.trim()) cleared.push("cause");
                if (previous.correction.trim() && patch.correction !== undefined && !patch.correction.trim()) cleared.push("correction");
                if (cleared.length > 0) {
                  next = appendHistory(next, entry(who, {
                    kind: "diagnosis-cleared",
                    field: `line ${previous.code}`,
                    before: cleared.map((name) => `${name}: ${name === "cause" ? previous.cause : previous.correction}`).join("; "),
                    after: "",
                    blocksNoWork: true,
                    text: `Cleared ${cleared.join(" and ")} on line ${previous.code}`,
                  }));
                }
              }
              return next;
            }),
          };
        }),
      addJob: (orderId) =>
        !roWritesEnabled() ? undefined : set((state) => ({
          orders: mapOrder(state.orders, orderId, (order) => {
            if (lockedOrder(order)) return order;
            const current = order.jobs ?? [];
            const jobs = [...current, jobLine(uid("jb"), nextLineCode(current))];
            return { ...order, jobs, concern: concernFromJobs(jobs) };
          }),
        })),
      removeJob: (orderId, jobId) =>
        !roWritesEnabled() ? undefined : set((state) => {
          const who = matchedStaff(state);
          return {
            orders: mapOrder(state.orders, orderId, (order) => {
              const current = order.jobs ?? [];
              if (lockedOrder(order) || current.length < 2) return order;
              const removed = current.find((job) => job.id === jobId);
              if (!removed) return order;
              const jobs = current.filter((job) => job.id !== jobId);
              const started = diagnosisOnRecord(order) || Boolean(removed.cause.trim() || removed.correction.trim());
              return appendHistory(
                { ...order, jobs, concern: concernFromJobs(jobs) },
                entry(who, {
                  kind: "job-removed",
                  field: `line ${removed.code}`,
                  before: [removed.concern, removed.cause, removed.correction].filter((line) => line.trim()).join(" / "),
                  after: "",
                  blocksNoWork: started,
                  text: `Removed line ${removed.code}`,
                }),
              );
            }),
          };
        }),
      updateWa: (orderId, patch) =>
        !roWritesEnabled() ? undefined : set((state) => ({
          orders: mapOrder(state.orders, orderId, (order) => {
            if (lockedOrder(order) || order.authorizationLocked) return order;
            const wa = normalizeWa(order.wa);
            const next = { ...wa };
            if (patch.choice === "" || patch.choice === "written" || patch.choice === "cap" || patch.choice === "waive" || patch.choice === "dropoff") next.choice = patch.choice;
            if (typeof patch.initials === "string") next.initials = asText(patch.initials, NAME_MAX) ?? wa.initials;
            if (typeof patch.date === "string") next.date = asText(patch.date, 20) ?? wa.date;
            if (typeof patch.time === "string") next.time = asText(patch.time, 8) ?? wa.time;
            if (typeof patch.address === "string") next.address = asText(patch.address, TEXT_MAX) ?? wa.address;
            if (typeof patch.plate === "string") next.plate = asText(patch.plate, 16) ?? wa.plate;
            if (patch.estimate !== undefined && inRange(patch.estimate, 0, MONEY_MAX)) next.estimate = patch.estimate;
            if (patch.cap !== undefined && inRange(patch.cap, 0, MONEY_MAX)) next.cap = patch.cap;
            if (typeof patch.returnParts === "boolean") next.returnParts = patch.returnParts;
            return { ...order, wa: { ...next, extras: wa.extras } };
          }),
        })),
      addExtraAuth: (orderId, input) =>
        !roWritesEnabled() ? undefined : set((state) => ({
          orders: mapOrder(state.orders, orderId, (order) => {
            if (lockedOrder(order)) return order;
            if (typeof input.date !== "string" || typeof input.time !== "string" || typeof input.employee !== "string" || typeof input.person !== "string") return order;
            if (!input.date || !input.time || !input.employee.trim() || !input.person.trim() || !inRange(input.amount, 0.01, MONEY_MAX)) return order;
            const wa = normalizeWa(order.wa);
            const extra: ExtraAuth = {
              id: uid("wa"),
              date: input.date,
              time: input.time,
              employee: input.employee.trim().slice(0, NAME_MAX),
              person: input.person.trim().slice(0, NAME_MAX),
              phone: typeof input.phone === "string" ? input.phone.trim().slice(0, TEXT_MAX) : "",
              work: typeof input.work === "string" ? input.work.trim().slice(0, REASON_MAX) : "",
              amount: money2(input.amount),
            };
            return { ...order, wa: { ...wa, extras: [...wa.extras, extra] } };
          }),
        })),
      invoiceOrder: () => {
        if (sectionLockEnabled()) return;
        // Month close counts Closed repair orders in the reports. It never writes a status.
      },
      closeOrder: (orderId) => {
        if (!roWritesEnabled()) return { ok: false, error: RO_WRITE_REFUSAL };
        const state = get();
        const order = state.orders.find((row) => row.id === orderId);
        if (!order) return { ok: false, error: "That repair order is not on this store." };
        if (order.authorizationLocked && order.status !== "closed") return { ok: false, error: "This repair order is closed and can't be changed." };
        const who = closingAdvisor(state);
        if (!who) return { ok: false, error: "Only an advisor or service manager can close a repair order." };
        const customer = state.customers.find((row) => row.id === order.customerId);
        const vehicle = state.vehicles.find((row) => row.id === order.vehicleId);
        const result = closeRepairOrder(
          order,
          state.parts,
          {
            customer,
            vehicle,
            techs: state.techs,
            advisors: state.advisors,
            logs: state.timeLogs,
            lastVisit: lastVisitFor(state, order),
          },
          who,
          now().toISOString(),
          today(),
        );
        if ("error" in result) return { ok: false, error: result.error };
        const stamped = withSnapshot({ ...result.order, authorizationLocked: true }, customer, vehicle);
        set((current) => ({
          parts: result.parts,
          closedHistory: appendClosedVersion(current.closedHistory, stamped, customer, vehicle),
          orders: mapOrder(current.orders, orderId, () => stamped),
        }));
        return { ok: true, error: null };
      },
      bookOrder: (orderId) =>
        !roWritesEnabled() ? undefined : set((state) => {
          const order = state.orders.find((row) => row.id === orderId);
          if (!order || lockedOrder(order)) return state;
          const next = bookRepairOrder(order);
          if (!next) return state;
          return { orders: mapOrder(state.orders, orderId, () => next) };
        }),
      unbookOrder: (orderId) =>
        !roWritesEnabled() ? undefined : set((state) => {
          const order = state.orders.find((row) => row.id === orderId);
          if (!order || lockedOrder(order)) return state;
          const next = unbookRepairOrder(order);
          if (!next) return state;
          return { orders: mapOrder(state.orders, orderId, () => next) };
        }),
      closeOrderWithNoWork: (orderId, note) => {
        if (!roWritesEnabled()) return { ok: false, error: RO_WRITE_REFUSAL };
        const state = get();
        const order = state.orders.find((row) => row.id === orderId);
        if (!order) return { ok: false, error: "That repair order is not on this store." };
        if (order.authorizationLocked && order.status !== "closed") return { ok: false, error: "This repair order is closed and can't be changed." };
        const who = closingAdvisor(state);
        if (!who) return { ok: false, error: "Only an advisor or service manager can close a repair order." };
        const customer = state.customers.find((row) => row.id === order.customerId);
        const vehicle = state.vehicles.find((row) => row.id === order.vehicleId);
        const error = noWorkCloseError(order, state.timeLogs, note, {
          customer,
          vehicle,
          lastVisit: lastVisitFor(state, order),
          techs: state.techs,
        });
        if (error) return { ok: false, error };
        const next = withSnapshot({ ...closeRepairOrderWithNoWork(order, note, who, now().toISOString(), today()), authorizationLocked: true }, customer, vehicle);
        set((current) => ({
          closedHistory: appendClosedVersion(current.closedHistory, next, customer, vehicle),
          orders: mapOrder(current.orders, orderId, () => next),
        }));
        return { ok: true, error: null };
      },
      recordMileageOverride: (orderId, mileage, reason) => {
        if (!roWritesEnabled()) return { ok: false, error: RO_WRITE_REFUSAL };
        const state = get();
        const order = state.orders.find((row) => row.id === orderId);
        if (!order) return { ok: false, error: "That repair order is not on this store." };
        if (lockedOrder(order)) return { ok: false, error: "This repair order is closed and can't be changed." };
        const who = serviceManager(state);
        if (!who) return { ok: false, error: "Only a service manager can record a mileage exception." };
        if (!inRange(mileage, 1, 999999)) {
          return { ok: false, error: mileage > 999999 ? "Mileage in can't be over 999,999." : "Mileage in has to be greater than zero." };
        }
        if (order.mileageOut != null && mileage > order.mileageOut) {
          return { ok: false, error: "Mileage in can't be higher than mileage out." };
        }
        const last = lastVisitFor(state, order);
        const below = mileageFloorMessage(mileage, last);
        const prepared = preparedReason(reason);
        if (below && "error" in prepared) return { ok: false, error: prepared.error };
        const reasonText = "text" in prepared ? prepared.text : "";
        const row = below && last
          ? entry(who, {
              kind: "mileage-override",
              field: "mileage",
              before: String(order.mileage),
              after: String(mileage),
              reason: reasonText,
              text: mileageInOverrideText(mileage, last, reasonText),
            })
          : entry(who, {
              kind: "note",
              field: "mileage",
              before: String(order.mileage),
              after: String(mileage),
              text: `Mileage in changed from ${order.mileage.toLocaleString("en-US")} to ${mileage.toLocaleString("en-US")} by ${who.name}`,
            });
        set((shop) => ({
          orders: mapOrder(shop.orders, orderId, (live) => {
            if (lockedOrder(live)) return live;
            return appendHistory({ ...live, mileage }, row);
          }),
        }));
        return { ok: true, error: null };
      },
      recordMileageOutOverride: (orderId, mileageOut, reason) => {
        if (!roWritesEnabled()) return { ok: false, error: RO_WRITE_REFUSAL };
        const state = get();
        const order = state.orders.find((row) => row.id === orderId);
        if (!order) return { ok: false, error: "That repair order is not on this store." };
        if (lockedOrder(order)) return { ok: false, error: "This repair order is closed and can't be changed." };
        const who = serviceManager(state);
        if (!who) return { ok: false, error: "Only a service manager can record a mileage exception." };
        const prepared = preparedReason(reason);
        if ("error" in prepared) return { ok: false, error: prepared.error };
        if (!inRange(mileageOut, 0, 999999)) return { ok: false, error: "Mileage out can't be over 999,999." };
        if (mileageOut < order.mileage) return { ok: false, error: "Mileage out can't be lower than mileage in." };
        const gap = mileageOutGapMessage(order.mileage, mileageOut);
        const row = gap
          ? entry(who, {
              kind: "mileage-override",
              field: "mileageOut",
              before: String(order.mileageOut ?? ""),
              after: String(mileageOut),
              reason: prepared.text,
              text: mileageOutOverrideText(mileageOut, order.mileage, prepared.text),
            })
          : entry(who, {
              kind: "note",
              field: "mileageOut",
              before: String(order.mileageOut ?? ""),
              after: String(mileageOut),
              text: `Mileage out changed from ${order.mileageOut ?? "blank"} to ${mileageOut.toLocaleString("en-US")} by ${who.name}`,
            });
        set((shop) => ({
          orders: mapOrder(shop.orders, orderId, (live) => {
            if (lockedOrder(live)) return live;
            return appendHistory({ ...live, mileageOut }, row);
          }),
        }));
        return { ok: true, error: null };
      },
      updateOpenContact: (orderId, patch) =>
        !roWritesEnabled() ? undefined : set((state) => {
          const order = state.orders.find((row) => row.id === orderId);
          if (!order || lockedOrder(order)) return state;
          const who = namedActor(state);
          if (!rosterEditor(state) || !who) return state;
          let customers = state.customers;
          const vehicles = state.vehicles;
          let next = order;
          if (typeof patch.phone === "string") {
            const customer = customers.find((row) => row.id === order.customerId);
            const after = patch.phone.trim();
            if (after.length <= TEXT_MAX && phoneDigits(after).length === 10) {
              const before = customer?.phone ?? "";
              if (customer && before !== after) {
                customers = customers.map((row) => (row.id === customer.id ? { ...row, phone: after, formerRecord: undefined } : row));
                next = appendHistory(next, entry(who, {
                  kind: "note",
                  field: "phone",
                  before,
                  after,
                  text: `Customer phone changed from ${before || "blank"} to ${after} by ${who.name}.`,
                }));
              }
            }
          }
          if (typeof patch.address === "string") {
            const after = patch.address.trim();
            if (after.length <= TEXT_MAX) {
              const wa = normalizeWa(next.wa);
              const before = wa.address;
              if (before !== after) {
                next = appendHistory({ ...next, wa: { ...wa, address: after } }, entry(who, { kind: "note", field: "address", before, after, text: `Customer address changed from ${before || "blank"} to ${after || "blank"} by ${who?.name || "the desk"}` }));
              }
            }
          }
          return { customers, vehicles, orders: mapOrder(state.orders, orderId, () => next) };
        }),
      addLabor: (orderId, line) =>
        !roWritesEnabled() ? undefined : set((state) => ({
          orders: mapOrder(state.orders, orderId, (order) => {
            if (lockedOrder(order)) return order;
            const jobId = jobForLine(order, line.jobId);
            if (!jobId) return order;
            if (!inRange(line.hours, 0, HOURS_MAX)) return order;
            if (!inRange(line.rate, 0, MONEY_MAX)) return order;
            if (line.techId && !state.techs.some((tech) => tech.id === line.techId)) return order;
            const description = asText(line.description, REASON_MAX);
            if (description === null || typeof line.opcode !== "string") return order;
            return { ...order, labor: [...order.labor, { ...line, description, opcode: line.opcode.slice(0, 16), id: uid("lb"), jobId }] };
          }),
        })),
      updateLabor: (orderId, lineId, patch) =>
        !roWritesEnabled() ? undefined : set((state) => ({
          orders: mapOrder(state.orders, orderId, (order) => {
            if (lockedOrder(order)) return order;
            const nextOrder: RepairOrder = {
              ...order,
              labor: order.labor.map((line) => {
                if (line.id !== lineId) return line;
                const next = { ...line };
                if (typeof patch.opcode === "string") next.opcode = patch.opcode;
                if (typeof patch.description === "string") {
                  const description = asText(patch.description, REASON_MAX);
                  if (description === null) return line;
                  next.description = description;
                }
                if (typeof patch.payType === "string") next.payType = patch.payType;
                if (typeof patch.techId === "string" && (patch.techId === "" || state.techs.some((tech) => tech.id === patch.techId))) next.techId = patch.techId;
                if (typeof patch.jobId === "string" && order.jobs.some((job) => job.id === patch.jobId)) next.jobId = patch.jobId;
                if (patch.hours !== undefined) {
                  if (!inRange(patch.hours, 0, HOURS_MAX)) return line;
                  next.hours = patch.hours;
                }
                if (patch.rate !== undefined) {
                  if (!inRange(patch.rate, 0, MONEY_MAX)) return line;
                  next.rate = patch.rate;
                }
                return next;
              }),
            };
            return settleAssignment(nextOrder);
          }),
        })),
      removeLabor: (orderId, lineId) =>
        !roWritesEnabled() ? undefined : set((state) => {
          const who = matchedStaff(state);
          return {
            orders: mapOrder(state.orders, orderId, (order) => {
              if (lockedOrder(order)) return order;
              const line = order.labor.find((row) => row.id === lineId);
              if (!line) return order;
              const entry: RoHistoryEntry = {
                at: now().toISOString(),
                who: who?.name ?? "",
                whoId: who?.id ?? "",
                kind: "labor-removed",
                field: line.opcode || "labor",
                before: `${line.opcode} ${line.hours}h`,
                after: "",
                blocksNoWork: diagnosisOnRecord(order),
                text: `Removed labor line ${line.opcode || "labor"}${line.description ? ` — ${line.description}` : ""}`,
              };
              return { ...order, labor: order.labor.filter((row) => row.id !== lineId), history: [...(order.history ?? []), entry] };
            }),
          };
        }),
      clockIn: (techId, orderId) => {
        if (!roWritesEnabled()) return { ok: false, error: RO_WRITE_REFUSAL };
        const state = get();
        const order = state.orders.find((row) => row.id === orderId);
        if (!order || lockedOrder(order) || isSealed(order.status)) return { ok: false, error: null };
        if (!order.labor.some((line) => line.techId === techId)) return { ok: false, error: null };
        const held = state.timeLogs.find((row) => {
          if (row.techId !== techId || row.endedAt !== null || row.orderId === orderId) return false;
          const punched = state.orders.find((item) => item.id === row.orderId);
          return Boolean(row.needsReview || (punched && lockedOrder(punched)));
        });
        if (held) return { ok: false, error: "A punch is still open for service manager review. Resolve it before clocking in on another repair order." };
        const already = state.timeLogs.find((row) => row.techId === techId && row.endedAt === null && row.orderId === orderId);
        if (already) return { ok: true, error: null };
        const stamp = localStamp();
        set((shop) => ({
          timeLogs: [
            ...shop.timeLogs.map((row) => {
              if (row.techId !== techId || row.endedAt !== null) return row;
              const punched = shop.orders.find((item) => item.id === row.orderId);
              if (punched && lockedOrder(punched)) return row;
              return { ...row, endedAt: stamp };
            }),
            { id: uid("clk"), techId, orderId, startedAt: stamp, endedAt: null },
          ],
        }));
        return { ok: true, error: null };
      },
      clockOut: (techId) => {
        if (!roWritesEnabled()) return { ok: false, error: RO_WRITE_REFUSAL };
        const state = get();
        const open = state.timeLogs.filter((row) => row.techId === techId && row.endedAt === null);
        if (open.length === 0) return { ok: true, error: null };
        const actor = namedActor(state);
        const onClosed = open.some((row) => {
          const order = state.orders.find((item) => item.id === row.orderId);
          return Boolean(order && lockedOrder(order));
        });
        if (onClosed && !actor) return { ok: false, error: "Clock out needs a name. Choose who is working." };
        const stamp = localStamp();
        set((shop) => ({
          timeLogs: shop.timeLogs.map((row) => {
            if (row.techId !== techId || row.endedAt !== null) return row;
            const order = shop.orders.find((item) => item.id === row.orderId);
            if (order && lockedOrder(order)) {
              const closeAt = typeof order.closedAt === "string" && order.closedAt.trim() ? order.closedAt : "";
              if (!closeAt) {
                return { ...row, needsReview: true, clockedOutAt: stamp, note: "No close time is on this repair order, so the punch stays open for service manager review." };
              }
              if (Date.parse(closeAt) < Date.parse(row.startedAt)) {
                return { ...row, needsReview: true, clockedOutAt: stamp, note: "The close time is before this punch started, so it stays open for service manager review." };
              }
              return {
                ...row,
                endedAt: closeAt,
                clockedOutAt: closeAt,
                needsReview: true,
                note: `${actor?.name ?? "A technician"} closed the punch at the repair order's close time for service manager review.`,
              };
            }
            return { ...row, endedAt: stamp };
          }),
        }));
        return { ok: true, error: null };
      },
      resolveFlaggedPunch: (logId, endedAtInput) => {
        if (!roWritesEnabled()) return { ok: false, error: RO_WRITE_REFUSAL };
        const state = get();
        const who = serviceManager(state);
        if (!who) return { ok: false, error: "Only a service manager can resolve a punch." };
        const punch = state.timeLogs.find((row) => row.id === logId);
        if (!punch || !punch.needsReview) return { ok: false, error: "That punch is not waiting for review." };
        const endMs = Date.parse(endedAtInput);
        if (!Number.isFinite(endMs)) return { ok: false, error: "Enter the end time." };
        const startMs = Date.parse(punch.startedAt);
        const order = state.orders.find((row) => row.id === punch.orderId);
        const closeAt = typeof order?.closedAt === "string" && order.closedAt.trim() ? order.closedAt : "";
        const caps = [Date.parse(punch.clockedOutAt ?? ""), Date.parse(closeAt)].filter((value) => Number.isFinite(value) && value >= startMs);
        if (!Number.isFinite(startMs) || caps.length === 0) {
          return { ok: false, error: "This punch has no clock-out or close time to end it." };
        }
        const latest = Math.min(...caps);
        if (endMs < startMs || endMs > latest) {
          return { ok: false, error: "The end time has to be between when the punch started and the clock-out or close time." };
        }
        const endedAt = new Date(endMs).toISOString();
        const kept = punch.note?.trim() ? `${punch.note.trim()} ` : "";
        const resolved = `${who.name} resolved the punch. Ended ${displayRecordedWhen(endedAt)}.`;
        set((shop) => ({
          timeLogs: shop.timeLogs.map((row) => (
            row.id === logId && row.needsReview
              ? { ...row, endedAt, needsReview: false, note: `${kept}${resolved}`.trim(), resolvedBy: who.name, resolvedById: who.id, resolvedAt: now().toISOString() }
              : row
          )),
        }));
        return { ok: true, error: null };
      },
      addPartLine: (orderId, line) =>
        !roWritesEnabled() ? undefined : set((state) => ({
          orders: mapOrder(state.orders, orderId, (order) => {
            if (lockedOrder(order)) return order;
            const jobId = jobForLine(order, line.jobId);
            if (!jobId) return order;
            if (!inRange(line.qty, 0, QTY_MAX)) return order;
            if (!inRange(line.price, 0, MONEY_MAX)) return order;
            if (!inRange(line.cost, 0, MONEY_MAX)) return order;
            return { ...order, parts: [...order.parts, { ...line, condition: line.condition ?? "new", id: uid("pt"), jobId }] };
          }),
        })),
      updatePartLine: (orderId, lineId, patch) =>
        !roWritesEnabled() ? undefined : set((state) => ({
          orders: mapOrder(state.orders, orderId, (order) => {
            if (lockedOrder(order)) return order;
            const nextOrder: RepairOrder = {
              ...order,
              parts: order.parts.map((line) => {
                if (line.id !== lineId) return line;
                const next = { ...line };
                if (typeof patch.partId === "string" || patch.partId === null) next.partId = patch.partId;
                if (typeof patch.number === "string") next.number = patch.number;
                if (typeof patch.description === "string") {
                  const description = asText(patch.description, REASON_MAX);
                  if (description === null) return line;
                  next.description = description;
                }
                if (typeof patch.payType === "string") next.payType = patch.payType;
                if (patch.condition === "new" || patch.condition === "used" || patch.condition === "rebuilt") next.condition = patch.condition;
                if (typeof patch.jobId === "string" && order.jobs.some((job) => job.id === patch.jobId)) next.jobId = patch.jobId;
                if (patch.qty !== undefined) {
                  if (!inRange(patch.qty, 1, QTY_MAX)) return line;
                  next.qty = patch.qty;
                }
                if (patch.cost !== undefined) {
                  if (!inRange(patch.cost, 0, MONEY_MAX)) return line;
                  next.cost = patch.cost;
                }
                if (patch.price !== undefined) {
                  if (!inRange(patch.price, 0, MONEY_MAX)) return line;
                  next.price = patch.price;
                }
                return next;
              }),
            };
            return settleAssignment(nextOrder);
          }),
        })),
      removePartLine: (orderId, lineId) =>
        !roWritesEnabled() ? undefined : set((state) => {
          const who = matchedStaff(state);
          return {
            orders: mapOrder(state.orders, orderId, (order) => {
              if (lockedOrder(order)) return order;
              const line = order.parts.find((row) => row.id === lineId);
              if (!line) return order;
              const entry: RoHistoryEntry = {
                at: now().toISOString(),
                who: who?.name ?? "",
                whoId: who?.id ?? "",
                kind: "part-removed",
                field: line.number || "part",
                before: `${line.number} ${line.qty}`,
                after: "",
                blocksNoWork: diagnosisOnRecord(order),
                text: `Removed part line ${line.number || line.description || "part"}${line.description ? ` — ${line.description}` : ""}`,
              };
              return { ...order, parts: order.parts.filter((row) => row.id !== lineId), history: [...(order.history ?? []), entry] };
            }),
          };
        }),
      addLaborOp: (op) =>
        set((state) => {
          if (sectionLockEnabled()) return state;
          const opcode = op.opcode.trim().toUpperCase();
          const description = op.description.trim();
          if (!inRange(op.hours, 0.01, HOURS_MAX)) return state;
          const hours = money2(op.hours);
          if (!opcode || !description || hours <= 0) return state;
          if (state.laborOps.some((row) => row.opcode.toUpperCase() === opcode)) return state;
          const next: LaborOp = { id: uid("op"), opcode, description, hours, payType: op.payType };
          return { laborOps: [...state.laborOps, next].sort((a, b) => a.opcode.localeCompare(b.opcode)) };
        }),
      updateLaborOp: (id, patch) =>
        set((state) => {
          if (sectionLockEnabled()) return state;
          return {
          laborOps: state.laborOps.map((op) => {
            if (op.id !== id) return op;
            const next = { ...op };
            if (patch.opcode !== undefined) {
              const opcode = patch.opcode.toUpperCase();
              const trimmed = opcode.trim();
              if (trimmed && state.laborOps.some((row) => row.id !== id && row.opcode.toUpperCase() === trimmed)) return op;
              next.opcode = opcode;
            }
            if (typeof patch.description === "string") next.description = patch.description;
            if (patch.hours !== undefined && inRange(patch.hours, 0, HOURS_MAX)) next.hours = money2(patch.hours);
            if (typeof patch.payType === "string") next.payType = patch.payType;
            return next;
          }),
        };
        }),
      removeLaborOp: (id) => set((state) => (sectionLockEnabled() ? state : { laborOps: state.laborOps.filter((op) => op.id !== id) })),
      addPayType: (input) => {
        if (sectionLockEnabled()) return false;
        const name = typeof input.name === "string" ? input.name.trim() : "";
        if (!name || !inRange(input.rate, 0, MONEY_MAX)) return false;
        let added = false;
        set((state) => {
          if (rosterEditorError(state)) return state;
          const row = { id: uid("pt"), name, rate: money2(input.rate), kind: input.kind };
          added = true;
          const who = namedActor(state);
          return {
            roleLog: [...(state.roleLog ?? []), roleChangeRow(who, row.id, "none", `${row.name} ${row.rate}`, row.name)],
            payTypes: [...state.payTypes, row],
          };
        });
        return added;
      },
      updatePayType: (id, patch) =>
        set((state) => {
          if (sectionLockEnabled()) return state;
          if (rosterEditorError(state)) return state;
          const who = namedActor(state);
          if (!who) return state;
          const roleLog = [...(state.roleLog ?? [])];
          const payTypes = state.payTypes.map((row) => {
            if (row.id !== id) return row;
            const next = { ...row };
            if (typeof patch.name === "string") next.name = patch.name;
            if (patch.rate !== undefined && inRange(patch.rate, 0, MONEY_MAX)) next.rate = money2(patch.rate);
            if (patch.kind === "customer" || patch.kind === "warranty" || patch.kind === "internal") next.kind = patch.kind;
            if (next.name !== row.name || next.rate !== row.rate || next.kind !== row.kind) {
              roleLog.push(roleChangeRow(who, row.id, `${row.name} ${row.rate}`, `${next.name} ${next.rate}`, row.name));
            }
            return next;
          });
          const settings = { ...state.settings };
          for (const row of payTypes) {
            if (row.id === "cp") settings.cpRate = row.rate;
            if (row.id === "warranty") settings.warrantyRate = row.rate;
            if (row.id === "internal") settings.internalRate = row.rate;
          }
          return { payTypes, settings, roleLog };
        }),
      removePayType: (id) => {
        if (sectionLockEnabled()) return "locked";
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
        if (sectionLockEnabled()) return false;
        const name = asText(input.name, NAME_MAX);
        if (!name || !inRange(input.amount, 0, MONEY_MAX) || !rosterEditor(get()) || !namedActor(get())) return false;
        set((state) => {
          const fee = { id: uid("fee"), name, amount: money2(input.amount), basis: "flat" as const, cap: 0 };
          const fees = [...state.settings.fees, fee];
          const who = namedActor(state);
          return {
            roleLog: [...(state.roleLog ?? []), roleChangeRow(who, fee.id, "none", `${fee.name} ${fee.amount}`, fee.name)],
            settings: { ...state.settings, fees },
            orders: roWritesEnabled() ? state.orders.map((order) => applyFeeChange(order, fees, who, "Added a shop fee")) : state.orders,
          };
        });
        return true;
      },
      updateFee: (id, patch) =>
        set((state) => {
          if (sectionLockEnabled()) return state;
          if (!rosterEditor(state) || !namedActor(state)) return state;
          const current = state.settings.fees.find((line) => line.id === id);
          const fees = state.settings.fees.map((line) => {
            if (line.id !== id) return line;
            return {
              ...line,
              name: patch.name === undefined ? line.name : (typeof patch.name === "string" ? patch.name.slice(0, TEXT_MAX) : line.name),
              amount: patch.amount === undefined || !inRange(patch.amount, 0, line.basis === "percent" ? 100 : MONEY_MAX) ? line.amount : money2(patch.amount),
              cap: patch.cap === undefined || !inRange(patch.cap, 0, MONEY_MAX) ? line.cap : money2(patch.cap),
            };
          });
          const next = fees.find((line) => line.id === id);
          const who = namedActor(state);
          const roleLog = current && next && (current.name !== next.name || current.amount !== next.amount || current.cap !== next.cap)
            ? [...(state.roleLog ?? []), roleChangeRow(who, id, `${current.name} ${current.amount}`, `${next.name} ${next.amount}`, current.name)]
            : state.roleLog;
          return { roleLog, settings: { ...state.settings, fees }, orders: roWritesEnabled() ? state.orders.map((order) => applyFeeChange(order, fees, who, "Updated a shop fee")) : state.orders };
        }),
      removeFee: (id) =>
        set((state) => {
          if (sectionLockEnabled()) return state;
          if (!rosterEditor(state) || !namedActor(state)) return state;
          const current = state.settings.fees.find((line) => line.id === id);
          const fees = state.settings.fees.filter((line) => line.id !== id);
          const who = namedActor(state);
          return {
            roleLog: current ? [...(state.roleLog ?? []), roleChangeRow(who, id, `${current.name} ${current.amount}`, "removed", current.name)] : state.roleLog,
            settings: { ...state.settings, fees },
            orders: roWritesEnabled() ? state.orders.map((order) => applyFeeChange(order, fees, who, "Removed a shop fee")) : state.orders,
          };
        }),
      attachInspection: (orderId) =>
        !roWritesEnabled() ? undefined : set((state) => ({
          orders: mapOrder(state.orders, orderId, (order) =>
            order.inspection || lockedOrder(order)
              ? order
              : { ...order, inspection: blankSheet(order.labor[0]?.techId || state.techs[0]?.id || "") },
          ),
        })),
      setInspectionTech: (orderId, techId) =>
        !roWritesEnabled() ? undefined : set((state) => ({
          orders: mapOrder(state.orders, orderId, (order) =>
            !order.inspection || lockedOrder(order) ? order : { ...order, inspection: { ...order.inspection, techId } },
          ),
        })),
      setInspectionPoint: (orderId, pointId, patch) =>
        !roWritesEnabled() ? undefined : set((state) => {
          const who = matchedStaff(state);
          return {
            orders: mapOrder(state.orders, orderId, (order) => {
              if (!order.inspection || lockedOrder(order)) return order;
              const previous = order.inspection.items.find((item) => item.id === pointId);
              const items = order.inspection.items.map((item) => (item.id === pointId ? { ...item, ...patch } : item));
              let next: RepairOrder = { ...order, inspection: { ...order.inspection, items } };
              const had = previous && (previous.status !== null || previous.reading.trim() !== "" || previous.note.trim() !== "");
              const nowItem = items.find((item) => item.id === pointId);
              const has = nowItem && (nowItem.status !== null || nowItem.reading.trim() !== "" || nowItem.note.trim() !== "");
              if (had && !has && previous) {
                next = appendHistory(next, entry(who, {
                  kind: "diagnosis-cleared",
                  field: previous.label,
                  before: [previous.status, previous.reading, previous.note].filter(Boolean).join(" "),
                  after: "",
                  blocksNoWork: true,
                  text: `Cleared multi-point result ${previous.label}`,
                }));
              }
              return next;
            }),
          };
        }),
      createOrder: (input) => {
        if (!roCreationEnabled()) return "";
        const state = get();
        if (repairOrderWriterError(state)) return "";
        const vehicle = state.vehicles.find((row) => row.id === input.vehicleId);
        if (!vehicle || vehicle.customerId !== input.customerId || vehicle.transferredTo) return "";
        const openedAt = now().toISOString();
        const lastVisit = lastVisitMileage(shopsFrom(state), vehicle, { openedAt, storeId: state.activeStoreId });
        if (!inRange(input.mileage, 1, 999999)) return "";
        const below = mileageFloorMessage(input.mileage, lastVisit);
        const manager = serviceManager(state);
        const prepared = preparedReason(input.mileageReason ?? "");
        if (below && (!manager || "error" in prepared)) return "";
        let mileageOut: number | null = null;
        if (input.mileageOut != null) {
          if (!inRange(input.mileageOut, 0, 999999) || input.mileageOut < input.mileage || mileageOutGapMessage(input.mileage, input.mileageOut)) return "";
          mileageOut = input.mileageOut;
        }
        const id = uid("ro");
        const who = namedActor(state);
        const openedLine = entry(who, {
          kind: "note",
          field: "opened",
          before: "",
          after: who?.name ?? "",
          text: `Repair order opened by ${who?.name ?? "the desk"}.`,
        });
        const reasonText = "text" in prepared ? prepared.text : "";
        const override = below && manager && lastVisit
          ? entry(manager, {
              kind: "mileage-override",
              field: "mileage",
              before: "",
              after: String(input.mileage),
              reason: reasonText,
              text: mileageInOverrideText(input.mileage, lastVisit, reasonText),
            })
          : null;
        set((state) => {
          const number = nextOrderNumber(state);
          const written = input.lines.map((line) => line.concern.trim()).filter(Boolean);
          const jobs = (written.length > 0 ? written : [""]).map((concern, index) => jobLine(uid("jb"), lineLetter(index), concern));
          const labor = (input.labor ?? []).flatMap((line) => {
            const jobId = line.jobId && jobs.some((job) => job.id === line.jobId) ? line.jobId : (jobs[0]?.id ?? "");
            if (!jobId || !inRange(line.hours, 0, HOURS_MAX) || !inRange(line.rate, 0, MONEY_MAX)) return [];
            return [{ ...line, id: uid("lb"), jobId }];
          });
          const order: RepairOrder = {
            id,
            number,
            openedOn: today(),
            openedAt,
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
            mileageOut,
            fees: state.settings.fees.map((line) => ({ ...line })),
            taxRate: state.settings.taxRate,
            labor,
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
            history: override ? [openedLine, override] : [openedLine],
            payments: [],
          };
          return { orders: [order, ...state.orders], focusOrderId: id };
        });
        return id;
      },
      createCustomer: (input) => {
        const name = asText(input.name, NAME_MAX);
        const model = asText(input.model, NAME_MAX);
        if (!name || !model || typeof input.phone !== "string") return { customerId: "", vehicleId: "", error: "Add the customer name and model.", warning: null };
        const phone = input.phone.trim();
        if (phone && phoneDigits(phone).length !== 10) return { customerId: "", vehicleId: "", error: "Enter a 10-digit phone number.", warning: null };
        if (input.vin != null && typeof input.vin !== "string") return { customerId: "", vehicleId: "", error: "Enter a 17-character VIN.", warning: null };
        const vinText = typeof input.vin === "string" ? normalizeVin(input.vin) : "";
        const vinError = vinScheduleError(vinText);
        if (vinError) return { customerId: "", vehicleId: "", error: vinError, warning: null };
        const state = get();
        const existing = vinText ? state.vehicles.find((row) => currentVehicle(row) && sameVin(row.vin, vinText)) : undefined;
        if (existing) {
          const owner = state.customers.find((row) => row.id === existing.customerId);
          return {
            customerId: "",
            vehicleId: "",
            error: null,
            warning: `This VIN is on file for ${owner?.name || "another customer"}. Transfer the vehicle to ${name}?`,
            needsTransfer: true,
          };
        }
        const writer = vehicleWriterError(state);
        if (writer) return { customerId: "", vehicleId: "", error: writer, warning: null };
        const vin = demoMode ? (vinText || demoVin()) : vinText;
        const customerId = uid("c");
        const vehicleId = uid("v");
        set((shop) => ({
          customers: [{ id: customerId, name, phone, mobile: input.mobile?.trim() ?? "", email: input.email?.trim() ?? "", noShows: 0 }, ...shop.customers],
          vehicles: [
            {
              id: vehicleId,
              customerId,
              year: input.year,
              make: input.make === undefined ? "Ford" : input.make.trim(),
              model,
              vin,
              ownership: [firstOwnership(customerId, now().toISOString(), namedActor(shop))],
            },
            ...shop.vehicles,
          ],
        }));
        return { customerId, vehicleId, error: null, warning: vinText ? vinCheckWarning(vinText) : null };
      },
      openWalkIn: (input) => {
        if (!roCreationEnabled()) return { ok: false, orderId: "", error: RO_CREATE_REFUSAL, warning: null };
        const name = asText(input.name, NAME_MAX);
        const model = asText(input.model, NAME_MAX);
        if (!name || !model || typeof input.phone !== "string") return { ok: false, orderId: "", error: "Add the customer name and model.", warning: null };
        const phone = input.phone.trim();
        if (phone && phoneDigits(phone).length !== 10) return { ok: false, orderId: "", error: "Enter a 10-digit phone number.", warning: null };
        const concerns = input.lines.map((line) => line.concern.trim()).filter(Boolean);
        if (concerns.length === 0) return { ok: false, orderId: "", error: "Add a concern.", warning: null };
        if (!inRange(input.mileage, 1, 999999)) return { ok: false, orderId: "", error: input.mileage > 999999 ? "Mileage in can't be over 999,999." : "Mileage in has to be greater than zero.", warning: null };
        const vinText = typeof input.vin === "string" ? normalizeVin(input.vin) : "";
        if (vinText) {
          const vinError = vinEntryError(vinText);
          if (vinError) return { ok: false, orderId: "", error: vinError, warning: null };
        }
        const state = get();
        const writer = repairOrderWriterError(state);
        if (writer) return { ok: false, orderId: "", error: writer, warning: null };
        const ownerVehicle = vinText ? state.vehicles.find((row) => currentVehicle(row) && sameVin(row.vin, vinText)) : undefined;
        const same = ownerVehicle ? state.customers.find((row) => row.id === ownerVehicle.customerId && row.name === name && row.phone === phone) : undefined;
        if (ownerVehicle && !same) {
          if (!namedActor(state)) return { ok: false, orderId: "", error: "Choose who is working.", warning: null };
          if (!rosterEditor(state)) return { ok: false, orderId: "", error: "Only an advisor or service manager can change the VIN.", warning: null };
          const owner = state.customers.find((row) => row.id === ownerVehicle.customerId);
          if (!input.confirmTransfer) {
            return { ok: false, orderId: "", error: null, warning: `This VIN is on file for ${owner?.name || "another customer"}. Transfer the vehicle to ${name}?`, needsTransfer: true };
          }
        }
        const customerId = same?.id ?? uid("c");
        let draft: ShopData = same ? state : {
          ...state,
          customers: [{ id: customerId, name, phone, mobile: input.mobile?.trim() ?? "", email: input.email?.trim() ?? "", noShows: 0 }, ...state.customers],
        };
        let vehicleId = same && ownerVehicle ? ownerVehicle.id : "";
        let transferNote: RoHistoryEntry | null = null;
        if (ownerVehicle && !same) {
          const claim = applyVinClaim(draft, { vin: vinText, customerId, confirm: true, reason: input.transferReason, year: input.year, make: input.make, model });
          if (!claim.ok || !claim.state) return { ok: false, orderId: "", error: claim.error, warning: claim.warning, needsTransfer: claim.needsTransfer };
          draft = claim.state;
          vehicleId = claim.vehicleId;
          const owner = state.customers.find((row) => row.id === ownerVehicle.customerId);
          const who = namedActor(state);
          transferNote = entry(who, {
            kind: "note",
            field: "vin",
            before: `${ownerVehicle.id} ${ownerVehicle.customerId}`,
            after: `${vehicleId} ${customerId}`,
            text: `Transferred VIN ${vinText} from ${owner?.name || "the previous owner"} to ${name} by ${who?.name ?? ""}. Vehicle ${ownerVehicle.id} to ${vehicleId}. Customer ${ownerVehicle.customerId} to ${customerId}.`,
          });
        } else if (!vehicleId) {
          vehicleId = uid("v");
          const vin = demoMode ? (vinText || demoVin()) : vinText;
          draft = { ...draft, vehicles: [{ id: vehicleId, customerId, year: input.year, make: input.make === undefined ? "Ford" : input.make.trim(), model, vin, ownership: [firstOwnership(customerId, now().toISOString(), namedActor(draft))] }, ...draft.vehicles] };
        }
        const vehicle = draft.vehicles.find((row) => row.id === vehicleId);
        const openedAt = now().toISOString();
        const lastVisit = lastVisitMileage(shopsFrom(draft), vehicle, { openedAt, storeId: state.activeStoreId });
        const below = mileageFloorMessage(input.mileage, lastVisit);
        const manager = serviceManager(draft);
        const prepared = preparedReason(input.mileageReason ?? "");
        if (below && (!manager || "error" in prepared)) return { ok: false, orderId: "", error: below, warning: null };
        if (input.mileageOut != null && (!inRange(input.mileageOut, 0, 999999) || input.mileageOut < input.mileage || mileageOutGapMessage(input.mileage, input.mileageOut))) {
          return { ok: false, orderId: "", error: "Mileage out can't be lower than mileage in.", warning: null };
        }
        const jobs = concerns.map((concern, index) => jobLine(uid("jb"), lineLetter(index), concern));
        const plannedConcern = concernFromJobs(jobs);
        const duplicate = draft.orders.find((order) => order.status !== "closed" && !order.authorizationLocked && order.customerId === customerId && order.vehicleId === vehicleId && order.mileage === input.mileage && (order.concern || "") === plannedConcern);
        if (duplicate) return { ok: true, orderId: duplicate.id, error: null, warning: vinText ? vinCheckWarning(vinText) : null };
        const id = uid("ro");
        const who = namedActor(state);
        const openedLine = entry(who, { kind: "note", field: "opened", before: "", after: who?.name ?? "", text: `Repair order opened by ${who?.name ?? "the desk"}.` });
        const reasonText = "text" in prepared ? prepared.text : "";
        const override = below && manager && lastVisit
          ? entry(manager, { kind: "mileage-override", field: "mileage", before: "", after: String(input.mileage), reason: reasonText, text: mileageInOverrideText(input.mileage, lastVisit, reasonText) })
          : null;
        const order: RepairOrder = {
          id,
          number: nextOrderNumber(draft),
          openedOn: today(),
          openedAt,
          promiseTime: input.promiseTime,
          status: "open",
          bay: "dispatch",
          advisorId: input.advisorId,
          customerId,
          vehicleId,
          concern: concernFromJobs(jobs),
          jobs,
          wa: blankWa(),
          mileage: input.mileage,
          mileageOut: input.mileageOut ?? null,
          fees: draft.settings.fees.map((line) => ({ ...line })),
          taxRate: draft.settings.taxRate,
          labor: [],
          parts: [],
          invoicedOn: null,
          stockApplied: false,
          inspection: blankSheet(draft.techs[0]?.id ?? ""),
          closeType: null,
          closeNote: "",
          closedBy: "",
          closedById: "",
          closedAt: null,
          droppedFeesNote: "",
          history: [openedLine, transferNote, override].filter((row): row is RoHistoryEntry => Boolean(row)),
          payments: [],
        };
        set({ ...draft, orders: [order, ...draft.orders], focusOrderId: id });
        return { ok: true, orderId: id, error: null, warning: vinText ? vinCheckWarning(vinText) : null };
      },
      updateOpenVin: (orderId, vin, confirmTransfer, transferReasonText) => {
        if (!roWritesEnabled()) return { ok: false, error: RO_WRITE_REFUSAL, warning: null };
        const state = get();
        const order = state.orders.find((row) => row.id === orderId);
        if (!order) return { ok: false, error: "That repair order is not on this store.", warning: null };
        if (lockedOrder(order)) return { ok: false, error: "This repair order is closed and can't be changed.", warning: null };
        const claim = applyVinClaim(state, { vin, customerId: order.customerId, confirm: confirmTransfer, reason: transferReasonText, orderId });
        if (!claim.ok) return { ok: false, error: claim.error, warning: claim.warning, needsTransfer: claim.needsTransfer };
        set(claim.state);
        const visit = { excludeOrderId: order.id, openedAt: order.openedAt, openedOn: order.openedOn, number: order.number, storeId: state.activeStoreId };
        const linked = claim.state.vehicles.find((row) => row.id === claim.vehicleId);
        const floor = mileageFloorMessage(order.mileage, lastVisitMileage(shopsFrom(claim.state), linked, visit));
        return { ok: true, error: null, warning: [claim.warning, floor].filter(Boolean).join(" ") || null };
      },
      moveWorkToJob: (orderId, kind, lineId, jobId) =>
        !roWritesEnabled() ? undefined : set((state) => {
          const who = matchedStaff(state);
          return {
            orders: mapOrder(state.orders, orderId, (order) => {
              if (lockedOrder(order)) return order;
              const actor = deskActor(state);
              if (actor !== "advisor" && actor !== "service-manager") return order;
              const target = order.jobs.find((job) => job.id === jobId && !job.needsAssignment);
              if (!target) return order;
              if (kind === "labor") {
                const line = order.labor.find((row) => row.id === lineId);
                if (!line || line.jobId === jobId) return order;
                const from = order.jobs.find((job) => job.id === line.jobId);
                const next = {
                  ...order,
                  labor: order.labor.map((row) => (row.id === lineId ? { ...row, jobId } : row)),
                };
                return settleAssignment(appendHistory(next, entry(who, {
                  kind: "note",
                  field: "jobId",
                  before: line.jobId ?? "",
                  after: jobId,
                  text: `Moved labor ${line.opcode || "labor"} from line ${from?.code ?? "unassigned"} to line ${target.code} by ${who?.name || "the desk"}`,
                })));
              }
              const line = order.parts.find((row) => row.id === lineId);
              if (!line || line.jobId === jobId) return order;
              const from = order.jobs.find((job) => job.id === line.jobId);
              const next = {
                ...order,
                parts: order.parts.map((row) => (row.id === lineId ? { ...row, jobId } : row)),
              };
              return settleAssignment(appendHistory(next, entry(who, {
                kind: "note",
                field: "jobId",
                before: line.jobId ?? "",
                after: jobId,
                text: `Moved part ${line.number || "part"} from line ${from?.code ?? "unassigned"} to line ${target.code} by ${who?.name || "the desk"}`,
              })));
            }),
          };
        }),
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
            const minutes = appointmentMinutes(patch.minutes, row.minutes);
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
        if (patch.vin != null && typeof patch.vin !== "string") return { ok: false, error: "Enter a 17-character VIN." };
        const nextVin = patch.vin === undefined ? current.vin : patch.vin;
        const vinError = typeof nextVin === "string" && nextVin.trim() ? vinScheduleError(nextVin) : null;
        if (vinError) return { ok: false, error: vinError };
        set((state) => {
          const current = state.appointments.find((row) => row.id === id);
          const requested = patch.status ?? current?.status ?? "scheduled";
          const nextStatus = !current || current.status === "cancelled" || requested === "cancelled" ? (current?.status ?? "scheduled") : requested;
          const nextCustomer = patch.customerId || current?.customerId || "";
          return {
          appointments: state.appointments
            .map((row) => {
              if (row.id !== id) return row;
              const minutes = appointmentMinutes(patch.minutes, row.minutes);
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
              const vin = normalizeVin(patch.vin === undefined ? row.vin : patch.vin);
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
        if (input.vin != null && typeof input.vin !== "string") return "";
        const vin = normalizeVin(typeof input.vin === "string" ? input.vin : "");
        if (vin && vinScheduleError(vin)) return "";
        set((state) => {
          const raw = input.lines?.length ? input.lines : [{ id: "", code: "A", concern: input.concern }];
          const lines = raw
            .map((line, index) => ({ id: line.id || uid("al"), code: lineLetter(index), concern: line.concern.trim() }))
            .filter((line) => line.concern)
            .map((line, index) => ({ ...line, code: lineLetter(index) }));
          const kept = lines.length > 0 ? lines : [{ id: uid("al"), code: "A", concern: input.concern.trim() }];
          let vehicleId = input.vehicleId;
          let vehicles = state.vehicles;
          const selected = state.vehicles.find((row) => row.id === input.vehicleId);
          if (selected && isFullVin(vin) && !sameVin(selected.vin, vin) && !state.vehicles.some((row) => sameVin(row.vin, vin)) && !vehicleWriterError(state)) {
            vehicleId = uid("v");
            vehicles = [{
              id: vehicleId,
              customerId: selected.customerId,
              year: selected.year,
              make: selected.make,
              model: selected.model,
              vin,
              ownership: [firstOwnership(selected.customerId, now().toISOString(), namedActor(state))],
            }, ...state.vehicles];
          }
          const row: Appointment = {
            ...input,
            vehicleId,
            date: input.date || today(),
            time: snapHalfHour(input.time || "07:00"),
            minutes: appointmentMinutes(input.minutes, 60),
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
            vehicles,
            appointments: [...state.appointments, row].sort((a, b) => a.date.localeCompare(b.date) || a.time.localeCompare(b.time)),
          };
        });
        return appointmentId;
      },
      saveAdvisorAppointment: (input, existingId, confirmTransfer, transferReasonText) => {
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
        const vinText = normalizeVin(input.vin || "");
        let vehicleId = input.vehicleId;
        if (vinText) {
          const vinError = vinScheduleError(vinText);
          if (vinError) return { ok: false, appointmentId: "", overrideId: null, error: vinError };
          const selected = state.vehicles.find((row) => row.id === input.vehicleId);
          if (!selected || !sameVin(selected.vin, vinText) || !currentVehicle(selected)) {
            const claim = applyVinClaim(state, { vin: vinText, customerId: input.customerId, confirm: confirmTransfer, reason: transferReasonText, year: selected?.year, make: selected?.make, model: selected?.model });
            if (!claim.ok) return { ok: false, appointmentId: "", overrideId: null, error: claim.error, warning: claim.warning, needsTransfer: claim.needsTransfer };
            set(claim.state);
            vehicleId = claim.vehicleId;
          }
        }
        if (existingId) get().updateAppointment(existingId, { ...input, vin: vinText, vehicleId });
        else {
          get().addAppointment({
            date: input.date,
            time: input.time,
            minutes: input.minutes,
            customerId: input.customerId,
            vehicleId,
            advisorId: input.advisorId,
            concern: input.concern,
            lines: input.lines,
            vin: vinText || input.vin,
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
          const known = (state.serviceManagers ?? []).some((row) => row.id === id) || state.advisors.some((advisor) => advisor.id === id) || state.techs.some((tech) => tech.id === id);
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
        const who = namedActor(state);
        if (!who || !rosterEditor(state)) return { ok: false, reason: "role" };
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
          roleLog: [...(current.roleLog ?? []), roleChangeRow(who, id, "pending", "approved", request.customerName)],
        }));
        return { ok: true, appointmentId: plan.appointment.id, noticeId: plan.notice.id };
      },
      declineOnlineRequest: (id) => {
        const state = get();
        const who = namedActor(state);
        if (!who || !rosterEditor(state)) return { ok: false, reason: "role" };
        const request = state.onlineRequests.find((row) => row.id === id && row.status === "pending");
        if (!request) return { ok: false, reason: "missing" };
        const notice = decisionNotice({ id: uid("nt"), at: now().toISOString(), request, kind: "decline" });
        set((current) => ({
          onlineRequests: current.onlineRequests.map((row) => (row.id === id ? { ...row, status: "declined" as const } : row)),
          notices: [...(current.notices ?? []), notice],
          roleLog: [...(current.roleLog ?? []), roleChangeRow(who, id, "pending", "declined", request.customerName)],
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
          if (!order || lockedOrder(order)) return state;
          if (state.appointments.some((row) => row.orderId === orderId)) return state;
          return {
            appointments: state.appointments.map((row) => {
              if (row.id !== id || row.status === "cancelled" || row.orderId) return row;
              return { ...row, status: "in_shop" as const, orderId };
            }),
          };
        }),
      setOnHand: (partId, onHand) =>
        set((state) => {
          if (sectionLockEnabled()) return state;
          return {
          parts: state.parts.map((part) => (part.id === partId && inRange(onHand, 0, QTY_MAX) && Number.isInteger(onHand) ? { ...part, onHand } : part)),
        };
        }),
      addSku: (sku) =>
        set((state) => {
          if (sectionLockEnabled()) return state;
          if (typeof sku.number !== "string" || typeof sku.description !== "string") return state;
          if (!inRange(sku.cost, 0, MONEY_MAX) || !inRange(sku.list, 0, MONEY_MAX)) return state;
          if (!Number.isInteger(sku.onHand) || !inRange(sku.onHand, 0, QTY_MAX) || !Number.isInteger(sku.onOrder) || !inRange(sku.onOrder, 0, QTY_MAX)) return state;
          return { parts: [{ ...sku, number: sku.number.slice(0, 32), description: sku.description.slice(0, TEXT_MAX), id: uid("sku") }, ...state.parts] };
        }),
      addExpense: (txn) =>
        set((state) => {
          if (sectionLockEnabled()) return state;
          return {
          expenses: inRange(txn.amount, 0, MONEY_MAX) ? [{ ...txn, id: uid("ex"), amount: money2(txn.amount) }, ...state.expenses] : state.expenses,
        };
        }),
      removeExpense: (id) => set((state) => (sectionLockEnabled() ? state : { expenses: state.expenses.filter((txn) => txn.id !== id) })),
      setBudget: (id, monthly) =>
        set((state) => {
          if (sectionLockEnabled()) return state;
          return {
          budgets: state.budgets.map((row) => (row.id === id && inRange(monthly, 0, MONEY_MAX) ? { ...row, monthly: money2(monthly) } : row)),
        };
        }),
      setOverhead: (id, monthly) =>
        set((state) => {
          if (sectionLockEnabled()) return state;
          return {
          overhead: state.overhead.map((row) => (row.id === id && inRange(monthly, 0, MONEY_MAX) ? { ...row, monthly: money2(monthly) } : row)),
        };
        }),
      sendCampaign: (input) =>
        set((state) => {
          if (sectionLockEnabled()) return state;
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
          if (!demoMode) return state;
          if (!sampleLoadAllowed(state, confirmReplace)) return state;
          return {
            ...createSeed(state.activeStoreId),
            settings: state.settings,
            focusOrderId: null,
          };
        }),
      clearShop: () =>
        set((state) => {
          if (!demoMode) return state;
          return {
            ...createEmptyShop(),
            settings: state.settings,
            focusOrderId: null,
          };
        }),
      };
    },
    {
      name: SHOP_STORAGE_KEY,
        storage: createJSONStorage(() => {
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
