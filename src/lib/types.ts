import type { JobLine } from "./jobs";
import type { MultiPoint } from "./mpi";
import type { WaRecord } from "./wa";

export type StoreId = "grand-coulee" | "pullman";
export type WeekdayIndex = 0 | 1 | 2 | 3 | 4 | 5 | 6;

export type PayType = string;
export type PayKind = "customer" | "warranty" | "internal";
export type RoStatus = "open" | "working" | "parts" | "ready" | "booked" | "invoiced";
export type BayStatus = "lot" | "dispatch" | "bay" | "working" | "parts" | "qc" | "wash" | "ready";
export type PayStyle = "flat" | "hourly";
export type Skill = "master" | "a" | "b" | "diesel" | "express" | "quick";
export type TechBoard = "express" | "main" | "internal" | "none";
export type ApptStatus = "scheduled" | "arrived" | "no_show" | "in_shop";
/** Transport option id. Older appointments used express and loaner; those load as waiter and drop. */
export type Lane = string;
export type Department = "service" | "parts";

export interface FeeLine {
  id: string;
  name: string;
  amount: number;
  basis: "flat" | "percent";
  cap: number;
}

/** How far ahead an online customer may book, and how much notice the shop needs. */
export interface BookingWindow {
  daysAhead: number;
  /** Minimum hours between the request and the appointment start. 0 until a store sets one. */
  minLeadHours: number;
}

export interface DayHours {
  weekday: WeekdayIndex;
  /** Weekly closure. A specific date is listed separately in closedDates. */
  closed: boolean;
  open: string;
  close: string;
}

/** One row on the online service menu. Labor time only — no price. */
export interface OnlineService {
  id: string;
  name: string;
  laborHours: number;
}

/** How the customer spends the visit. Seeded with Waiter and Drop-off. */
export interface TransportOption {
  id: string;
  name: string;
}

export interface SchedulingSettings {
  hours: DayHours[];
  closedDates: string[];
  bookingWindow: BookingWindow;
  onlineMenu: OnlineService[];
  transportOptions: TransportOption[];
}

export interface Settings {
  storeName: string;
  city: string;
  phone: string;
  address: string;
  cpRate: number;
  warrantyRate: number;
  internalRate: number;
  targetAbsorption: number;
  targetElr: number;
  policyGuide: number;
  fees: FeeLine[];
  taxRate: number;
  scheduling: SchedulingSettings;
}

export interface Advisor {
  id: string;
  number: string;
  name: string;
  base: number;
  laborPercent: number;
  partsPercent: number;
}

export interface Tech {
  id: string;
  number: string;
  name: string;
  skill: Skill;
  board: TechBoard;
  payStyle: PayStyle;
  flagRate: number;
  hourlyRate: number;
  availableHoursMonth: number;
  clockedHoursMonth: number;
  clockedToday: number;
}

export interface Customer {
  id: string;
  name: string;
  /** Desk contact number. */
  phone: string;
  /**
   * Mobile used for a later one-time code. Empty means none on file, so that
   * visit would stay unverified until an advisor matches the record.
   */
  mobile: string;
  email: string;
  /** Appointments an advisor has marked No-show. Stays on the record for the next visit. */
  noShows: number;
}

export interface Vehicle {
  id: string;
  customerId: string;
  year: number;
  model: string;
  vin: string;
}

export interface PartSku {
  id: string;
  number: string;
  description: string;
  bin: string;
  onHand: number;
  onOrder: number;
  cost: number;
  list: number;
  lastSale: string;
  source: string;
}

export interface LaborLine {
  id: string;
  opcode: string;
  description: string;
  hours: number;
  rate: number;
  payType: PayType;
  techId: string;
}

export interface LaborOp {
  id: string;
  opcode: string;
  description: string;
  hours: number;
  payType: PayType;
}

export interface PayTypeDef {
  id: string;
  name: string;
  rate: number;
  kind: PayKind;
}

export interface PartLine {
  id: string;
  partId: string | null;
  number: string;
  description: string;
  qty: number;
  cost: number;
  price: number;
  payType: PayType;
  condition?: "new" | "rebuilt" | "used";
}

export interface RepairOrder {
  id: string;
  number: number;
  openedOn: string;
  promiseTime: string;
  status: RoStatus;
  bay: BayStatus;
  advisorId: string;
  customerId: string;
  vehicleId: string;
  concern: string;
  jobs: JobLine[];
  mileage: number;
  mileageOut: number | null;
  fees: FeeLine[];
  taxRate: number;
  labor: LaborLine[];
  parts: PartLine[];
  invoicedOn: string | null;
  stockApplied: boolean;
  inspection: MultiPoint | null;
  wa?: WaRecord;
}

export interface AppointmentLine {
  id: string;
  code: string;
  concern: string;
}

export interface Appointment {
  id: string;
  date: string;
  time: string;
  minutes: number;
  customerId: string;
  vehicleId: string;
  advisorId: string;
  concern: string;
  lines: AppointmentLine[];
  vin: string;
  laborOpIds: string[];
  techId: string;
  lane: Lane;
  status: ApptStatus;
  orderId: string | null;
}

export interface BudgetLine {
  id: string;
  department: Department;
  category: string;
  monthly: number;
}

export interface ExpenseTxn {
  id: string;
  budgetId: string;
  date: string;
  vendor: string;
  amount: number;
  note: string;
}

export interface OverheadLine {
  id: string;
  name: string;
  monthly: number;
}

export interface TimeLog {
  id: string;
  techId: string;
  orderId: string;
  startedAt: string;
  endedAt: string | null;
}

export interface ClosedRecord {
  id: string;
  orderId: string;
  number: number;
  openedOn: string;
  closedOn: string;
  customerName: string;
  phone: string;
  address: string;
  plate: string;
  vin: string;
  vehicle: string;
  mileage: number;
  mileageOut: number | null;
  concern: string;
  opcodes: string;
  partNumbers: string;
  total: number;
  beforeTax: number;
}

export interface Campaign {
  id: string;
  name: string;
  message: string;
  audience: "due7" | "lapsed90" | "lapsed150" | "none" | "all";
  sentOn: string;
  recipientIds: string[];
}

/** A one-time code for a returning online customer. Demo only; nothing is texted. */
export interface OnlineChallenge {
  customerId: string;
  code: string;
  issuedAt: string;
}

export type ContactMethod = "text" | "email" | "call";

/** An online visit request. It is not a confirmed appointment until an advisor approves it. */
export interface OnlineRequest {
  id: string;
  storeId: StoreId;
  status: "pending" | "approved" | "declined";
  createdAt: string;
  serviceId: string;
  serviceName: string;
  laborHours: number;
  date: string;
  time: string;
  advisorId: string;
  advisorName: string;
  techId: string;
  techName: string;
  transportId: string;
  transportName: string;
  /** How the customer asked to hear back. */
  contactMethod: ContactMethod;
  verified: boolean;
  customerId: string | null;
  customerName: string;
  phone: string;
  email: string;
  vehicleId: string | null;
  year: number;
  make: string;
  model: string;
  vin: string;
  plate: string;
  appointmentId: string | null;
}

/** Simulated approval, decline, or day-before reminder. Nothing is sent. */
export interface ShopNotice {
  id: string;
  storeId: StoreId;
  at: string;
  kind: "approval" | "decline" | "reminder";
  method: ContactMethod;
  recipient: string;
  body: string;
  requestId: string | null;
  appointmentId: string | null;
  customerName: string;
}

/** Why an advisor kept a booking the capacity check would not offer online. */
export type OverrideReason = "tech-hours" | "advisor" | "both" | "closed" | "unknown-staff";

export interface OverrideRecord {
  id: string;
  /** Shop instant, ISO. */
  at: string;
  /** Staff name chosen in Working as. */
  who: string;
  whoId: string;
  storeId: StoreId;
  appointmentId: string;
  customerName: string;
  date: string;
  time: string;
  techName: string;
  advisorName: string;
  reason: OverrideReason;
}

/** `sample` is the demo month. Anything else is a real shop and must not open the staff picker. */
export type ShopDataset = "sample" | "shop";

export interface ShopData {
  dataset: ShopDataset;
  settings: Settings;
  advisors: Advisor[];
  techs: Tech[];
  customers: Customer[];
  vehicles: Vehicle[];
  parts: PartSku[];
  laborOps: LaborOp[];
  payTypes: PayTypeDef[];
  orders: RepairOrder[];
  closedHistory: ClosedRecord[];
  timeLogs: TimeLog[];
  appointments: Appointment[];
  expenses: ExpenseTxn[];
  budgets: BudgetLine[];
  overhead: OverheadLine[];
  campaigns: Campaign[];
  /** Demo staff name for this store. No password. */
  workingAsId: string;
  overrides: OverrideRecord[];
  onlineRequests: OnlineRequest[];
  onlineChallenges: OnlineChallenge[];
  notices: ShopNotice[];
}
