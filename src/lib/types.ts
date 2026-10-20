import type { JobLine } from "./jobs";
import type { MultiPoint } from "./mpi";
import type { WaRecord } from "./wa";

export type PayType = string;
export type PayKind = "customer" | "warranty" | "internal";
export type RoStatus = "open" | "working" | "parts" | "ready" | "booked" | "invoiced";
export type BayStatus = "lot" | "dispatch" | "bay" | "working" | "parts" | "qc" | "wash" | "ready";
export type PayStyle = "flat" | "hourly";
export type Skill = "master" | "a" | "b" | "diesel" | "express" | "quick";
export type TechBoard = "express" | "main" | "internal" | "none";
export type ApptStatus = "scheduled" | "arrived" | "no_show" | "in_shop";
export type Lane = "waiter" | "drop" | "express" | "loaner";
export type Department = "service" | "parts";

export interface FeeLine {
  id: string;
  name: string;
  amount: number;
  basis: "flat" | "percent";
  cap: number;
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
  adminPassword: string;
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
  phone: string;
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

export interface ShopData {
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
}
