import { feeTotal } from "./format";
import { jobLine, nextLineCode } from "./jobs";
import { mileageFloorMessage, mileageOutGapMessage, mileageTooHigh, preparedReason, type MileageVisit } from "./mileage";
import { closeGaps, orderMoney } from "./metrics";
import type { Advisor, ClosedRecord, Customer, FeeLine, PartSku, RepairOrder, Tech, TimeLog, Vehicle } from "./types";
import { isFullVin } from "./vin";
import { normalizeWa, waLimit } from "./wa";

/** Cent tolerance so a ticket that rounds onto the cap still books. */
export const AUTH_TOLERANCE = 0.009;

export function laborAmount(order: Pick<RepairOrder, "labor">) {
  return order.labor.reduce((sum, line) => sum + line.hours * line.rate, 0);
}

export function partsAmount(order: Pick<RepairOrder, "parts">) {
  return order.parts.reduce((sum, line) => sum + line.qty * line.price, 0);
}

export function partsCostAmount(order: Pick<RepairOrder, "parts">) {
  return order.parts.reduce((sum, line) => sum + line.qty * line.cost, 0);
}

export function repairAmount(order: Pick<RepairOrder, "labor" | "parts">) {
  return laborAmount(order) + partsAmount(order);
}

/** Labor, parts, and fees. Sales tax is outside the RCW 46.71 authorization. */
export function ticketBeforeTax(order: Pick<RepairOrder, "labor" | "parts" | "fees">) {
  const repair = repairAmount(order);
  return repair + feeTotal(order.fees, repair);
}

export function withinAuthorization(order: RepairOrder, next = ticketBeforeTax(order)) {
  const limit = waLimit(normalizeWa(order.wa));
  return limit !== null && next <= limit + AUTH_TOLERANCE;
}

/**
 * Move on-hand by the lines tied to each SKU.
 * Direction -1 is an invoice (also stamps last sale). Direction +1 puts the
 * same quantity back on reopen. On-hand may go negative when the ticket sells
 * more than the bin had; flooring at zero made reopen put parts back that
 * were never taken.
 */
export function applyPartStock(parts: PartSku[], order: RepairOrder, direction: 1 | -1, soldOn: string): PartSku[] {
  return parts.map((part) => {
    const qty = order.parts.filter((line) => line.partId === part.id).reduce((sum, line) => sum + line.qty, 0);
    if (!qty) return part;
    return {
      ...part,
      onHand: part.onHand + direction * qty,
      lastSale: direction === -1 ? soldOn : part.lastSale,
    };
  });
}

/** Booked means hours, a technician, and a dollar cost are on the ticket. The car is still open. */
export function hasBookedWork(order: Pick<RepairOrder, "labor" | "parts">) {
  const hours = order.labor.some((line) => line.hours > 0);
  const tech = order.labor.some((line) => line.techId.trim());
  const cost = laborAmount(order) + partsAmount(order) > 0;
  return hours && tech && cost;
}

export function bookRepairOrder(order: RepairOrder): RepairOrder | null {
  if (order.status === "booked" || order.status === "closed") return null;
  if (!withinAuthorization(order)) return null;
  if (!hasBookedWork(order)) return null;
  return { ...order, status: "booked" };
}

export function unbookRepairOrder(order: RepairOrder): RepairOrder | null {
  if (order.status !== "booked") return null;
  return { ...order, status: "ready" };
}

/**
 * Month close only counts repair orders an advisor already closed.
 * It does not set, change, or relabel a status.
 */
export function invoiceRepairOrder(
  order: RepairOrder,
  parts: PartSku[],
  _techs?: Tech[],
  _advisors?: Advisor[],
  _logs?: TimeLog[],
  _closedOn?: string,
): { order: RepairOrder; parts: PartSku[] } {
  return { order, parts };
}

/** Cent tolerance for a $0 ticket. */
const CENT = 0.009;

export const NO_WORK_NOTE_MAX = 500;
export const NO_WORK_NOTE_MIN = 10;
export const NO_WORK_NOTE_REQUIRED = "Add a note explaining why no work was done.";
export const NO_WORK_NOTE_SHORT = "Explain why no work was done in at least 10 characters.";
export const NO_WORK_NOTE_LONG = "Keep the note to 500 characters.";
export const NO_WORK_NOT_OPEN = "Only an open or booked repair order can close with no work.";
export const CLOSE_ROLE_REQUIRED = "Only an advisor or service manager can close a repair order.";
export const ADVISOR_CLOSE_NOTE = "Closed by the advisor.";

/**
 * Fees copied onto every open ticket from shop settings. A no-work close drops
 * shop, misc, hazmat, and disposal. Any other fee is a charge.
 */
const DEFAULT_FEE_IDS = new Set(["shop", "misc", "hazmat", "disposal"]);

const NO_WORK_STATUSES = new Set(["open", "working", "parts", "ready", "booked"]);

const DEFAULT_FEE_NAMES = new Set([
  "misc shop fee",
  "miscellaneous shop fee",
  "shop fee",
  "misc",
  "hazmat",
  "hazmat fee",
  "disposal",
  "disposal fee",
]);

export function isDefaultShopFee(fee: Pick<FeeLine, "id" | "name">) {
  if (DEFAULT_FEE_IDS.has(fee.id)) return true;
  return DEFAULT_FEE_NAMES.has(fee.name.trim().toLowerCase());
}

function lineCountLabel(count: number, noun: string) {
  return `${count} ${noun} ${count === 1 ? "line" : "lines"}`;
}

function inspectionHasResults(order: RepairOrder) {
  const items = order.inspection?.items ?? [];
  return items.some((item) => item.status !== null || item.reading.trim() !== "" || item.note.trim() !== "");
}

/** Cause, correction, a multi-point result, or a logged removal. Clock time is separate. */
export function diagnosisOnRecord(order: RepairOrder) {
  if ((order.jobs ?? []).some((job) => job.cause.trim() || job.correction.trim())) return true;
  if (inspectionHasResults(order)) return true;
  return (order.history ?? []).some((entry) => entry.kind === "diagnosis-cleared" || entry.blocksNoWork);
}

/** Clock time, cause, correction, or a multi-point result means work started. */
export function workHadStarted(order: RepairOrder, logs: TimeLog[]) {
  if (logs.some((log) => log.orderId === order.id)) return true;
  return diagnosisOnRecord(order);
}

function recordedAddress(order: RepairOrder) {
  const own = normalizeWa(order.wa).address.trim();
  if (own) return own;
  for (const row of order.laterAuthorizations ?? []) {
    if (row.address.trim()) return row.address.trim();
  }
  return "";
}

function estimateAuthorized(order: RepairOrder) {
  if (waLimit(normalizeWa(order.wa)) !== null) return true;
  return (order.laterAuthorizations ?? []).some((row) => row.initials.trim() && Number(row.estimate) > 0);
}

export const DIAGNOSIS_BLOCK = "Inspection or diagnosis is recorded — close it with an accurate invoice";
export const CLOCK_BLOCK = "Clock time is on this repair order — close it with an accurate invoice";
export const MILEAGE_REASON_SHORT = "Add a reason of at least 10 characters.";

export function mileageReasonError(reason: unknown) {
  const prepared = preparedReason(reason);
  return "error" in prepared ? prepared.error : null;
}

/** A logged service-manager exception for this exact mileage in or mileage out. */
export function mileageOverrideAllows(order: RepairOrder, mileage: number, field: "mileage" | "mileageOut" = "mileage") {
  return (order.history ?? []).some((entry) => entry.kind === "mileage-override" && (entry.field ?? "mileage") === field && Number(entry.after) === mileage);
}

function onThisJob<T extends { jobId?: string }>(lines: T[], jobId: string) {
  return lines.some((line) => line.jobId === jobId);
}

function jobHasWork(order: RepairOrder, jobId: string) {
  return onThisJob(order.labor, jobId) || onThisJob(order.parts, jobId);
}

function looseLine(line: { jobId?: string }, jobIds: Set<string>) {
  return !line.jobId || !jobIds.has(line.jobId);
}

/** Drop a flagged assignment line a previous load added to a Closed repair order. Labor and parts go back to having no line. */
export function undoFlaggedLines(order: RepairOrder): RepairOrder {
  const jobs = order.jobs ?? [];
  const flagged = jobs.filter((job) => job.needsAssignment);
  if (flagged.length === 0) return order;
  const ids = new Set(flagged.map((job) => job.id));
  const clear = <T extends { jobId?: string }>(line: T): T => (line.jobId && ids.has(line.jobId) ? { ...line, jobId: undefined } : line);
  return {
    ...order,
    jobs: jobs.filter((job) => !job.needsAssignment),
    labor: order.labor.map(clear),
    parts: order.parts.map(clear),
  };
}

/** Open repair orders only. One real line gets the loose work. More than one gets a line the advisor assigns. A Closed repair order is returned as saved. */
export function linkLaborAndParts(order: RepairOrder): RepairOrder {
  if (order.status === "closed") return order;
  if (order.authorizationLocked) return undoFlaggedLines(order);
  const jobs = [...(order.jobs ?? [])];
  const known = new Set(jobs.map((job) => job.id));
  const looseLabor = order.labor.some((line) => looseLine(line, known));
  const looseParts = order.parts.some((line) => looseLine(line, known));
  if (!looseLabor && !looseParts) return order;
  let nextJobs = jobs;
  let target = jobs.length === 1 ? jobs[0].id : "";
  if (jobs.length !== 1) {
    target = `${order.id || "ro"}-assign`;
    if (known.has(target)) target = `${target}-2`;
    nextJobs = [...jobs, { ...jobLine(target, nextLineCode(jobs)), needsAssignment: true }];
  }
  const place = <T extends { jobId?: string }>(line: T): T => (looseLine(line, known) ? { ...line, jobId: target } : line);
  return {
    ...order,
    jobs: nextJobs,
    labor: order.labor.map(place),
    parts: order.parts.map(place),
  };
}

export function clockedInNames(orderId: string, logs: TimeLog[], techs: Tech[]) {
  const ids = [...new Set(logs.filter((row) => row.orderId === orderId && row.endedAt === null).map((row) => row.techId))];
  return ids.map((id) => techs.find((tech) => tech.id === id)?.name || "A technician");
}

export function clockedInMessage(names: string[]) {
  if (names.length === 0) return null;
  const who = names.length === 1 ? names[0] : `${names.slice(0, -1).join(", ")} and ${names.at(-1)}`;
  const verb = names.length === 1 ? "is" : "are";
  return `${who} ${verb} still clocked in on this repair order — clock them out before closing`;
}

/** What is in the way of a $0 close. Each line names the blocker. */
export function noWorkBlockers(
  order: RepairOrder,
  logs: TimeLog[],
  identity?: { customer?: Customer; vehicle?: Vehicle; lastVisit?: MileageVisit | null; techs?: Tech[] },
): string[] {
  const blocks: string[] = [];
  if (order.labor.length > 0) {
    const names = order.labor.map((line) => line.opcode || line.description || "labor").join(", ");
    blocks.push(`Remove ${lineCountLabel(order.labor.length, "labor")} (${names})`);
  }
  if (order.parts.length > 0) {
    const names = order.parts.map((line) => line.number || line.description || "part").join(", ");
    blocks.push(`Remove ${lineCountLabel(order.parts.length, "part")} (${names})`);
  }
  if (diagnosisOnRecord(order)) blocks.push(DIAGNOSIS_BLOCK);
  const extraFees = (order.fees ?? []).filter((fee) => !isDefaultShopFee(fee));
  if (extraFees.length === 1) blocks.push(`Remove the ${extraFees[0].name} fee`);
  else if (extraFees.length > 1) blocks.push(`Remove ${extraFees.length} fees (${extraFees.map((fee) => fee.name).join(", ")})`);
  if (logs.some((log) => log.orderId === order.id)) blocks.push(CLOCK_BLOCK);
  const stillIn = clockedInMessage(clockedInNames(order.id, logs, identity?.techs ?? []));
  if (stillIn) blocks.push(stillIn);
  if ((order.payments ?? []).some((pay) => Math.abs(pay.amount) > CENT)) blocks.push("A payment is on this repair order");
  if (!identity?.customer?.name.trim()) blocks.push("Add the customer name");
  if (!recordedAddress(order)) blocks.push("Add the address");
  if (!identity?.customer?.phone.trim()) blocks.push("Add the customer phone");
  if (!isFullVin(identity?.vehicle?.vin ?? "")) blocks.push("Add the full 17-character VIN");
  const vehicle = identity?.vehicle;
  if (!vehicle || !vehicle.year || !vehicle.model.trim() || !vehicle.make?.trim()) blocks.push("Add the year, make, and model");
  if (!Number.isFinite(order.mileage) || order.mileage <= 0) blocks.push("Add the mileage in");
  if (mileageTooHigh(order.mileage)) blocks.push("Mileage in can't be over 999,999.");
  const belowLast = mileageOverrideAllows(order, order.mileage) ? null : mileageFloorMessage(order.mileage, identity?.lastVisit ?? null);
  if (belowLast) blocks.push(belowLast);
  if (order.mileageOut == null || !Number.isFinite(order.mileageOut) || order.mileageOut <= 0 || order.mileageOut < order.mileage) {
    blocks.push("Add the mileage out");
  } else if (!mileageOverrideAllows(order, order.mileageOut, "mileageOut")) {
    const gap = mileageOutGapMessage(order.mileage, order.mileageOut);
    if (gap) blocks.push(gap);
  }
  return blocks;
}

export function noWorkCloseError(
  order: RepairOrder,
  logs: TimeLog[],
  note: string,
  identity?: { customer?: Customer; vehicle?: Vehicle; lastVisit?: MileageVisit | null; techs?: Tech[] },
): string | null {
  if (!NO_WORK_STATUSES.has(order.status)) return NO_WORK_NOT_OPEN;
  const blocks = noWorkBlockers(order, logs, identity);
  const trimmed = note.trim();
  const nonSpace = trimmed.replace(/\s/g, "");
  if (!trimmed) blocks.push(NO_WORK_NOTE_REQUIRED);
  else if (nonSpace.length < NO_WORK_NOTE_MIN) blocks.push(NO_WORK_NOTE_SHORT);
  else if (trimmed.length > NO_WORK_NOTE_MAX) blocks.push(NO_WORK_NOTE_LONG);
  if (blocks.length > 0) return blocks.join(". ");
  return null;
}

export function droppedFeeNote(fees: FeeLine[]) {
  const dropped = fees.filter((fee) => isDefaultShopFee(fee));
  if (dropped.length === 0) return "";
  return `Dropped default fees: ${dropped.map((fee) => fee.name).join(", ")}.`;
}

/** Status becomes Closed. Default fees are cleared so the stored total is $0. The RO number stays. */
export function closeRepairOrderWithNoWork(
  order: RepairOrder,
  note: string,
  who: { id: string; name: string },
  closedAt: string,
  closedOn: string,
): RepairOrder {
  const dropped = droppedFeeNote(order.fees ?? []);
  const history = [...(order.history ?? [])];
  if (dropped) {
    history.push({ at: closedAt, who: who.name, whoId: who.id, kind: "fees-dropped", text: dropped });
  }
  history.push({
    at: closedAt,
    who: who.name,
    whoId: who.id,
    kind: "closed",
    text: note.trim().slice(0, NO_WORK_NOTE_MAX),
  });
  return {
    ...order,
    status: "closed",
    closeType: "no_work",
    closeNote: note.trim().slice(0, NO_WORK_NOTE_MAX),
    closedBy: who.name,
    closedById: who.id,
    closedAt,
    invoicedOn: closedOn,
    fees: [],
    droppedFeesNote: dropped,
    history,
    stockApplied: false,
    authorizationLocked: true,
  };
}

export interface AdvisorCloseContext {
  customer?: Customer;
  vehicle?: Vehicle;
  techs: Tech[];
  advisors: Advisor[];
  logs: TimeLog[];
  lastVisit?: MileageVisit | null;
}

/** Exact list of fields still missing before an advisor can close a booked repair order. */
export function advisorCloseGaps(order: RepairOrder, ctx: AdvisorCloseContext): string[] {
  const gaps: string[] = [];
  const jobs = order.jobs ?? [];
  const concern = (order.concern || jobs.map((job) => job.concern).join(" ")).trim();
  if (!concern) gaps.push("Concern");
  if (order.status === "closed") {
    // A Closed repair order is not checked or changed line by line.
  } else {
  const jobIds = new Set(jobs.map((job) => job.id));
  if (order.labor.some((line) => looseLine(line, jobIds)) || order.parts.some((line) => looseLine(line, jobIds))) {
    gaps.push("Labor or parts are not on a job line");
  }
  jobs.forEach((job) => {
    if (job.needsAssignment && jobHasWork(order, job.id)) {
      gaps.push(`Assign the labor and parts on line ${job.code}`);
      return;
    }
    if (!jobHasWork(order, job.id)) return;
    if (!job.concern.trim()) gaps.push(`Concern on line ${job.code}`);
    if (!job.cause.trim()) gaps.push(`Cause on line ${job.code}`);
    if (!job.correction.trim()) gaps.push(`Correction on line ${job.code}`);
  });
  }
  if (!Number.isFinite(order.mileage) || order.mileage <= 0) gaps.push("Mileage in");
  if (mileageTooHigh(order.mileage)) gaps.push("Mileage in can't be over 999,999.");
  const belowLast = mileageOverrideAllows(order, order.mileage) ? null : mileageFloorMessage(order.mileage, ctx.lastVisit ?? null);
  if (belowLast) gaps.push(belowLast);
  const stillIn = clockedInMessage(clockedInNames(order.id, ctx.logs, ctx.techs));
  if (stillIn) gaps.push(stillIn);
  if (order.mileageOut == null || !Number.isFinite(order.mileageOut) || order.mileageOut < order.mileage) gaps.push("Mileage out");
  else if (!mileageOverrideAllows(order, order.mileageOut, "mileageOut")) {
    const gap = mileageOutGapMessage(order.mileage, order.mileageOut);
    if (gap) gaps.push(gap);
  }
  if (!isFullVin(ctx.vehicle?.vin ?? "")) gaps.push("VIN");
  const nameParts = (ctx.customer?.name ?? "").trim().split(/\s+/).filter(Boolean);
  if (nameParts.length < 2) gaps.push("Customer first and last name");
  if (!recordedAddress(order)) gaps.push("Address");
  if (!ctx.customer?.phone.trim()) gaps.push("Customer phone");
  if (!ctx.vehicle?.year || !ctx.vehicle.model.trim()) gaps.push("Year, make, and model");
  if (!ctx.vehicle?.make?.trim()) gaps.push("Make");
  for (const line of order.parts) {
    const label = line.number || line.description || "a part";
    if (!line.number.trim()) gaps.push(`Part number on ${label}`);
    if (line.condition !== "new" && line.condition !== "used" && line.condition !== "rebuilt") {
      gaps.push(`New, used, or rebuilt on ${label}`);
    }
    if (!Number.isFinite(line.price) || line.price < 0) gaps.push(`Part price on ${label}`);
  }
  if (order.labor.some((line) => line.hours < 0)) gaps.push("Labor hours cannot be negative");
  const money = orderMoney(order);
  if (!Number.isFinite(money.labor)) gaps.push("Labor charge");
  if (!Number.isFinite(money.parts)) gaps.push("Parts charge");
  if (!Number.isFinite(money.total)) gaps.push("Total charge");
  if (!Number.isFinite(order.taxRate) || !Number.isFinite(money.tax)) gaps.push("Sales tax");
  if (!estimateAuthorized(order)) gaps.push("Estimate authorization");
  gaps.push(...closeGaps(order, ctx.techs, ctx.advisors, ctx.logs));
  return gaps;
}

/** Booked becomes Closed only when the required fields are complete. Records who, when, and a note. */
export function closeRepairOrder(
  order: RepairOrder,
  parts: PartSku[],
  ctx: AdvisorCloseContext,
  who: { id: string; name: string },
  closedAt: string,
  closedOn: string,
): { order: RepairOrder; parts: PartSku[] } | { error: string } {
  if (order.status !== "booked" || order.authorizationLocked) return { error: "Only a booked repair order can be closed." };
  if (!who.id || !who.name.trim()) return { error: CLOSE_ROLE_REQUIRED };
  const gaps = advisorCloseGaps(order, ctx);
  if (gaps.length > 0) return { error: gaps.join("\n") };
  const nextParts = order.stockApplied ? parts : applyPartStock(parts, order, -1, closedOn);
  const history = [
    ...(order.history ?? []),
    { at: closedAt, who: who.name, whoId: who.id, kind: "closed" as const, text: ADVISOR_CLOSE_NOTE },
  ];
  return {
    order: {
      ...order,
      status: "closed",
      closeType: null,
      closeNote: ADVISOR_CLOSE_NOTE,
      closedBy: who.name,
      closedById: who.id,
      closedAt,
      invoicedOn: closedOn,
      stockApplied: true,
      history,
      authorizationLocked: true,
    },
    parts: nextParts,
  };
}

export function dropClosedHistory(history: ClosedRecord[], orderId: string) {
  return history.filter((row) => row.orderId !== orderId);
}
