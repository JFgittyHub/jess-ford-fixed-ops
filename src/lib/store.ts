import { create } from "zustand";
import { persist } from "zustand/middleware";
import { money2, snapHalfHour, bayFromStatus, DEFAULT_FEES, DEFAULT_TAX_RATE, feeTotal, localStamp, TODAY } from "./format";
import { concernFromJobs, concernFromLines, jobLine, lineLetter, nextLineCode, type JobLine } from "./jobs";
import { blankWa, normalizeWa, waLimit, type ExtraAuth, type WaRecord } from "./wa";
import { blankSheet, demoSheet, type MpiPoint } from "./mpi";
import { defaultPayTypes } from "./pay";
import { laborCatalog, createSeed, ADVISOR_NUMBERS, TECH_NUMBERS } from "./seed";
import { closedRecord, closeGaps } from "./metrics";
import type { Advisor, Appointment, Campaign, ExpenseTxn, FeeLine, LaborLine, LaborOp, PartLine, PartSku, PayKind, RepairOrder, RoStatus, ShopData, Tech, TechBoard } from "./types";

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
}

interface ShopActions {
  focusOrderId: string | null;
  setFocus: (id: string | null) => void;
  updateSettings: (patch: Partial<ShopData["settings"]>) => void;
  clockTech: (techId: string, hours: number) => void;
  addTech: (input: Pick<Tech, "number" | "name" | "skill" | "payStyle" | "flagRate" | "hourlyRate" | "board" | "password">) => boolean;
  updateTech: (id: string, patch: Partial<Pick<Tech, "number" | "name" | "skill" | "payStyle" | "flagRate" | "hourlyRate" | "board" | "password">>) => boolean;
  removeTech: (id: string) => "ok" | "used";
  addAdvisor: (input: Pick<Advisor, "number" | "name" | "base" | "laborPercent" | "partsPercent" | "password">) => boolean;
  updateAdvisor: (id: string, patch: Partial<Pick<Advisor, "number" | "name" | "base" | "laborPercent" | "partsPercent" | "password">>) => boolean;
  removeAdvisor: (id: string) => "ok" | "used";
  updateOrder: (orderId: string, patch: Partial<Pick<RepairOrder, "concern" | "mileage" | "mileageOut" | "promiseTime" | "advisorId" | "status" | "bay">>) => void;
  updateJob: (orderId: string, jobId: string, patch: Partial<Pick<JobLine, "concern" | "cause" | "correction">>) => void;
  addJob: (orderId: string) => void;
  removeJob: (orderId: string, jobId: string) => void;
  updateWa: (orderId: string, patch: Partial<Omit<WaRecord, "extras">>) => void;
  addExtraAuth: (orderId: string, input: Omit<ExtraAuth, "id">) => void;
  invoiceOrder: (orderId: string) => void;
  bookOrder: (orderId: string) => void;
  unbookOrder: (orderId: string) => void;
  reopenOrder: (orderId: string) => void;
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
  moveAppointment: (id: string, patch: Partial<Pick<Appointment, "date" | "time" | "minutes" | "techId">>) => void;
  updateAppointment: (id: string, patch: Partial<Omit<Appointment, "id" | "orderId">>) => void;
  addAppointment: (input: Omit<ShopData["appointments"][number], "id" | "orderId" | "status">) => void;
  linkAppointment: (id: string, orderId: string) => void;
  setOnHand: (partId: string, onHand: number) => void;
  addSku: (sku: Omit<PartSku, "id">) => void;
  addExpense: (txn: Omit<ExpenseTxn, "id">) => void;
  removeExpense: (id: string) => void;
  setBudget: (id: string, monthly: number) => void;
  setOverhead: (id: string, monthly: number) => void;
  sendCampaign: (input: Omit<Campaign, "id" | "sentOn">) => void;
  resetDemo: () => void;
}

export type ShopState = ShopData & ShopActions;

function uid(prefix: string) {
  return `${prefix}-${Math.random().toString(36).slice(2, 8)}`;
}

function demoVin() {
  const serial = Math.floor(Math.random() * 1e8).toString().padStart(8, "0");
  return `1FTDEMO${serial}AA`;
}

function isHeld(status: RoStatus) {
  return status === "invoiced" || status === "booked";
}

function mapOrder(orders: RepairOrder[], orderId: string, edit: (order: RepairOrder) => RepairOrder) {
  return orders.map((order) => (order.id === orderId ? edit(order) : order));
}

function ticketOf(order: Pick<RepairOrder, "labor" | "parts" | "fees">) {
  const labor = order.labor.reduce((sum, line) => sum + line.hours * line.rate, 0);
  const parts = order.parts.reduce((sum, line) => sum + line.qty * line.price, 0);
  const repair = labor + parts;
  return repair + feeTotal(order.fees, repair);
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

function fitsWa(order: RepairOrder, next: number) {
  const limit = waLimit(normalizeWa(order.wa));
  return limit !== null && next <= limit + 0.009;
}

function applyStock(parts: PartSku[], order: RepairOrder, direction: 1 | -1) {
  return parts.map((part) => {
    const qty = order.parts.filter((line) => line.partId === part.id).reduce((sum, line) => sum + line.qty, 0);
    if (!qty) return part;
    return {
      ...part,
      onHand: Math.max(0, part.onHand + direction * qty),
      lastSale: direction === -1 ? TODAY : part.lastSale,
    };
  });
}

const dataKeys: (keyof ShopData)[] = [
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
];

export const useShop = create<ShopState>()(
  persist(
    (set) => ({
      ...createSeed(),
      focusOrderId: null,
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
        const password = input.password.trim();
        if (!name || !number || !password) return false;
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
            password,
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
          const password = patch.password === undefined ? current.password : patch.password.trim();
          if (!number || !name || !password) return state;
          if (state.techs.some((tech) => tech.id !== id && tech.number === number)) return state;
          updated = true;
          return {
            techs: state.techs.map((tech) =>
              tech.id === id
                ? {
                    ...tech,
                    ...patch,
                    number,
                    name,
                    password,
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
        let result: "ok" | "used" = "ok";
        set((state) => {
          if (state.orders.some((order) => order.labor.some((line) => line.techId === id) || order.inspection?.techId === id)) {
            result = "used";
            return state;
          }
          return { techs: state.techs.filter((tech) => tech.id !== id) };
        });
        return result;
      },
      addAdvisor: (input) => {
        const name = input.name.trim();
        const number = input.number.trim();
        const password = input.password.trim();
        if (!name || !number || !password) return false;
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
            password,
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
          const password = patch.password === undefined ? current.password : patch.password.trim();
          if (!number || !name || !password) return state;
          if (state.advisors.some((advisor) => advisor.id !== id && advisor.number === number)) return state;
          updated = true;
          return {
            advisors: state.advisors.map((advisor) =>
              advisor.id === id
                ? {
                    ...advisor,
                    ...patch,
                    number,
                    name,
                    password,
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
            if (order.status === "invoiced") return order;
            if (order.status === "booked") return patch.bay ? { ...order, bay: patch.bay } : order;
            return { ...order, ...patch, status: (patch.status ?? order.status) as RoStatus };
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
      invoiceOrder: (orderId) =>
        set((state) => {
          const order = state.orders.find((row) => row.id === orderId);
          if (!order || order.status !== "booked" || !fitsWa(order, ticketOf(order)) || closeGaps(order, state.techs, state.advisors, state.timeLogs).length > 0) return state;
          const parts = order.stockApplied ? state.parts : applyStock(state.parts, order, -1);
          const copy = closedRecord(
            { ...order, status: "invoiced", invoicedOn: TODAY },
            state.customers.find((row) => row.id === order.customerId),
            state.vehicles.find((row) => row.id === order.vehicleId),
          );
          copy.id = uid("hist");
          return {
            parts,
            closedHistory: [copy, ...state.closedHistory],
            orders: mapOrder(state.orders, orderId, (row) => ({
              ...row,
              status: "invoiced",
              invoicedOn: TODAY,
              stockApplied: true,
            })),
          };
        }),
      bookOrder: (orderId) =>
        set((state) => {
          const order = state.orders.find((row) => row.id === orderId);
          if (!order || isHeld(order.status) || !fitsWa(order, ticketOf(order))) return state;
          return { orders: mapOrder(state.orders, orderId, (row) => ({ ...row, status: "booked" })) };
        }),
      unbookOrder: (orderId) =>
        set((state) => {
          const order = state.orders.find((row) => row.id === orderId);
          if (!order || order.status !== "booked") return state;
          return { orders: mapOrder(state.orders, orderId, (row) => ({ ...row, status: "ready" })) };
        }),
      reopenOrder: (orderId) =>
        set((state) => {
          const order = state.orders.find((row) => row.id === orderId);
          if (!order || order.status !== "invoiced") return state;
          const parts = order.stockApplied ? applyStock(state.parts, order, 1) : state.parts;
          return {
            parts,
            orders: mapOrder(state.orders, orderId, (row) => ({
              ...row,
              status: "ready",
              invoicedOn: null,
              stockApplied: false,
            })),
          };
        }),
      addLabor: (orderId, line) =>
        set((state) => ({
          orders: mapOrder(state.orders, orderId, (order) => {
            if (isHeld(order.status)) return order;
            return { ...order, labor: [...order.labor, { ...line, id: uid("lb") }] };
          }),
        })),
      updateLabor: (orderId, lineId, patch) =>
        set((state) => ({
          orders: mapOrder(state.orders, orderId, (order) => {
            if (isHeld(order.status)) return order;
            return { ...order, labor: order.labor.map((line) => (line.id === lineId ? { ...line, ...patch } : line)) };
          }),
        })),
      removeLabor: (orderId, lineId) =>
        set((state) => ({
          orders: mapOrder(state.orders, orderId, (order) =>
            isHeld(order.status) ? order : { ...order, labor: order.labor.filter((line) => line.id !== lineId) },
          ),
        })),
      clockIn: (techId, orderId) =>
        set((state) => {
          const order = state.orders.find((row) => row.id === orderId);
          if (!order || order.status === "invoiced") return state;
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
        set((state) => ({
          orders: mapOrder(state.orders, orderId, (order) =>
            isHeld(order.status) ? order : { ...order, parts: order.parts.filter((line) => line.id !== lineId) },
          ),
        })),
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
            if (patch.hours !== undefined) next.hours = money2(Math.max(0, patch.hours));
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
          const number = state.orders.reduce((max, order) => Math.max(max, order.number), 241000) + 1;
          const written = input.lines.map((line) => line.concern.trim()).filter(Boolean);
          const jobs = (written.length > 0 ? written : [""]).map((concern, index) => jobLine(uid("jb"), lineLetter(index), concern));
          const order: RepairOrder = {
            id,
            number,
            openedOn: TODAY,
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
          };
          return { orders: [order, ...state.orders], focusOrderId: id };
        });
        return id;
      },
      createCustomer: (input) => {
        const customerId = uid("c");
        const vehicleId = uid("v");
        set((state) => ({
          customers: [{ id: customerId, name: input.name.trim(), phone: input.phone.trim() }, ...state.customers],
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
        set((state) => ({
          appointments: state.appointments.map((row) => (row.id === id ? { ...row, status } : row)),
        })),
      moveAppointment: (id, patch) =>
        set((state) => ({
          appointments: state.appointments.map((row) => {
            if (row.id !== id) return row;
            const minutes = patch.minutes === undefined ? row.minutes : Math.max(30, Math.round(patch.minutes / 30) * 30);
            const time = snapHalfHour(patch.time && /^\d{2}:\d{2}$/.test(patch.time) ? patch.time : row.time);
            const date = patch.date && /^\d{4}-\d{2}-\d{2}$/.test(patch.date) ? patch.date : row.date;
            const techId = patch.techId || row.techId;
            return { ...row, minutes, time, date, techId };
          }),
        })),
      updateAppointment: (id, patch) =>
        set((state) => ({
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
              return { ...row, ...patch, minutes, time, date, lines: kept, concern: concernFromLines(kept) || row.concern, vin, laborOpIds, vehicleId, id: row.id, orderId: row.orderId };
            })
            .sort((a, b) => a.date.localeCompare(b.date) || a.time.localeCompare(b.time)),
          vehicles: state.vehicles.map((vehicle) => {
            const row = state.appointments.find((item) => item.id === id);
            if (!row) return vehicle;
            const vehicleId = patch.vehicleId || row.vehicleId;
            const vin = (patch.vin === undefined ? row.vin : patch.vin).trim().toUpperCase();
            return vehicle.id === vehicleId && vin ? { ...vehicle, vin } : vehicle;
          }),
        })),
      addAppointment: (input) =>
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
            date: input.date || TODAY,
            time: snapHalfHour(input.time || "07:00"),
            minutes: Math.max(30, Math.round((input.minutes || 60) / 30) * 30),
            lines: kept,
            concern: concernFromLines(kept),
            vin,
            laborOpIds: input.laborOpIds ?? [],
            id: uid("ap"),
            status: "scheduled",
            orderId: null,
          };
          return {
            vehicles: state.vehicles.map((vehicle) => (vehicle.id === row.vehicleId && vin ? { ...vehicle, vin } : vehicle)),
            appointments: [...state.appointments, row].sort((a, b) => a.date.localeCompare(b.date) || a.time.localeCompare(b.time)),
          };
        }),
      linkAppointment: (id, orderId) =>
        set((state) => ({
          appointments: state.appointments.map((row) =>
            row.id === id ? { ...row, status: "in_shop", orderId } : row,
          ),
        })),
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
            sentOn: TODAY,
            recipientIds: input.recipientIds,
          };
          return { campaigns: [row, ...state.campaigns] };
        }),
      resetDemo: () => set({ ...createSeed(), focusOrderId: null }),
    }),
    {
      name: "jess-ford-fixed-ops-v1",
      version: 26,
      skipHydration: true,
      migrate: (persisted) => {
        if (!persisted || typeof persisted !== "object") return persisted as ShopState;
        const saved = persisted as Partial<ShopData>;
        if (!Array.isArray(saved.orders)) return persisted as ShopState;
        return {
          ...saved,
          orders: saved.orders.map((order) => {
            const prior = order as RepairOrder & { cause?: string; correction?: string; jobs?: JobLine[] };
            const jobs = Array.isArray(prior.jobs) && prior.jobs.length > 0
              ? prior.jobs
              : [jobLine(`${prior.id}-a`, "A", prior.concern ?? "", prior.cause ?? "", prior.correction ?? "")];
            const total = prior.labor.reduce((sum, line) => sum + line.hours * line.rate, 0)
              + prior.parts.reduce((sum, line) => sum + line.qty * line.price, 0);
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
              fees: normalizeFees(Array.isArray(prior.fees) ? prior.fees : saved.settings?.fees, prior.status === "invoiced"),
              taxRate: typeof prior.taxRate === "number" ? prior.taxRate : (typeof saved.settings?.taxRate === "number" ? saved.settings.taxRate : DEFAULT_TAX_RATE),
              inspection: prior.inspection ?? demoSheet(prior.id),
              parts: prior.parts.map((line) => ({ ...line, condition: line.condition ?? "new" })),
              wa: stamped,
            };
          }),
          laborOps: Array.isArray(saved.laborOps) && saved.laborOps.length > 0 ? saved.laborOps : laborCatalog(),
          payTypes: Array.isArray(saved.payTypes) && saved.payTypes.length > 0 ? saved.payTypes : defaultPayTypes(saved.settings),
          campaigns: Array.isArray(saved.campaigns) ? saved.campaigns : [],
          appointments: Array.isArray(saved.appointments)
            ? saved.appointments.map((row) => {
                const vehicle = saved.vehicles?.find((item) => item.id === row.vehicleId);
                const lines = Array.isArray(row.lines) && row.lines.length > 0
                  ? row.lines.map((line, index) => ({ id: line.id || `${row.id}-l${index}`, code: lineLetter(index), concern: line.concern ?? "" }))
                  : [{ id: `${row.id}-a`, code: "A", concern: row.concern ?? "" }];
                const fallback: Record<string, string> = { a1: "luis", a2: "chris", a3: "priya", a4: "sam", a5: "elena", a6: "marcus", a7: "andre", a8: "marcus", a9: "luis", a10: "chris" };
                const known = saved.techs?.some((tech) => tech.id === row.techId) ? row.techId : "";
                return {
                  ...row,
                  date: row.date ?? "2026-10-19",
                  time: snapHalfHour(row.time ?? "07:00"),
                  minutes: typeof row.minutes === "number" && row.minutes >= 30 ? row.minutes : row.lane === "loaner" ? 180 : row.lane === "drop" ? 120 : row.lane === "waiter" ? 90 : 60,
                  lines,
                  concern: concernFromLines(lines) || row.concern,
                  vin: row.vin || vehicle?.vin || "",
                  laborOpIds: Array.isArray(row.laborOpIds) ? row.laborOpIds : [],
                  techId: known || fallback[row.id] || saved.techs?.[0]?.id || "",
                };
              })
            : saved.appointments,
          settings: saved.settings
            ? { ...saved.settings, phone: saved.settings.phone ?? "", address: saved.settings.address ?? "", fees: normalizeFees(saved.settings.fees), taxRate: typeof saved.settings.taxRate === "number" ? saved.settings.taxRate : DEFAULT_TAX_RATE, adminPassword: saved.settings.adminPassword || "admin" }
            : saved.settings,
          timeLogs: Array.isArray(saved.timeLogs) ? saved.timeLogs : [],
          closedHistory: Array.isArray(saved.closedHistory)
            ? saved.closedHistory
            : (saved.orders ?? []).filter((order) => order.status === "invoiced").map((order) => closedRecord(
                order,
                saved.customers?.find((row) => row.id === order.customerId),
                saved.vehicles?.find((row) => row.id === order.vehicleId),
              )),
          advisors: Array.isArray(saved.advisors)
            ? saved.advisors.map((advisor, index) => ({
                ...advisor,
                number: advisor.number || ADVISOR_NUMBERS[advisor.id] || String(index + 1),
                password: advisor.password || advisor.number || ADVISOR_NUMBERS[advisor.id] || String(index + 1),
                base: typeof advisor.base === "number" ? advisor.base : 4200,
                laborPercent: typeof advisor.laborPercent === "number" ? advisor.laborPercent : 5,
                partsPercent: typeof advisor.partsPercent === "number" ? advisor.partsPercent : 2,
              }))
            : saved.advisors,
          techs: Array.isArray(saved.techs)
            ? saved.techs.map((tech, index) => ({
                ...tech,
                number: tech.number || TECH_NUMBERS[tech.id] || String(index + 1),
                password: tech.password || tech.number || TECH_NUMBERS[tech.id] || String(index + 1),
                board: tech.board || ({ luis: "express", sam: "express", marcus: "main", elena: "main", andre: "main", chris: "main", priya: "internal", dana: "none" } satisfies Record<string, TechBoard>)[tech.id] || "main",
              }))
            : saved.techs,
        } as ShopState;
      },
      partialize: (state) => {
        const saved: Partial<ShopData> = {};
        for (const key of dataKeys) saved[key] = state[key] as never;
        return saved as ShopState;
      },
    },
  ),
);

export function useShopHydrated() {
  return useShop.persist.hasHydrated();
}

export function readShop() {
  return useShop.getState();
}
