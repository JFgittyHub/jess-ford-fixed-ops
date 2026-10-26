import type { StoreId } from "../types";

export type { StoreId };
export type Status = "good" | "watch" | "bad" | "empty";
export type Commitment = "Green" | "Yellow" | "Red";
export type CvpStanding = "Above Group" | "At Group" | "Below Group";

export type Tech = {
  id: string;
  name: string;
  techNumber: string;
  skill: string;
  soldHours: number;
  clockHours: number;
  workDays: number;
  elr: number;
};

export type ServiceFigures = {
  sales: number;
  gross: number;
  totalHours: number;
  hoursPerRo: number;
  hoursPerMaintRo: number;
  roOpenOver30: number;
  arOver90: number;
  servicePolicy: number;
  shopSupplies: number;
  fordCommitment: Commitment;
  uptimeAssist: number;
  grossProfitPct: number;
  elr: number;
  absorption: number;
  warrantyDashboard: number;
  cvp: CvpStanding;
};

export type PartsFigures = {
  sales: number;
  gross: number;
  openInvoicesOver14: number;
  inventory: number;
  agedOver3: number;
  agedOver6: number;
  agedOver9: number;
};

export type MonthBoard = {
  month: string;
  recorded: boolean;
  hoursGoal: number;
  service: ServiceFigures;
  parts: PartsFigures;
  period1: Tech[];
  period2: Tech[];
};

export type ViewId = StoreId | "group";

export type AppState = {
  activeStore: ViewId;
  activeMonth: string;
  stores: Record<StoreId, Record<string, MonthBoard>>;
};

export const HOURS_GOAL = 900;
export const ELR_STANDARD = 127.5;
export const SERVICE_GP_STANDARD = 0.75;
export const PARTS_GP_STANDARD = 0.4;
export const POLICY_CAP = 0.015;
export const MIN_MONTH = "2026-01";
export const COMMITMENTS: Commitment[] = ["Green", "Yellow", "Red"];
export const CVP_LEVELS: CvpStanding[] = ["Above Group", "At Group", "Below Group"];

export function monthKey(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
}

export function parseMonth(key: string): { year: number; monthIndex: number } {
  const [year, month] = key.split("-").map(Number);
  return { year, monthIndex: month - 1 };
}

export function shiftMonth(key: string, delta: number): string {
  const { year, monthIndex } = parseMonth(key);
  return monthKey(new Date(year, monthIndex + delta, 1));
}

export function monthLabel(key: string): string {
  const { year, monthIndex } = parseMonth(key);
  return new Date(year, monthIndex, 1).toLocaleDateString("en-US", { month: "long", year: "numeric" });
}

export function weekdayCount(year: number, monthIndex: number, throughDay?: number): number {
  const last = throughDay ?? new Date(year, monthIndex + 1, 0).getDate();
  let count = 0;
  for (let day = 1; day <= last; day += 1) {
    const dow = new Date(year, monthIndex, day).getDay();
    if (dow !== 0 && dow !== 6) count += 1;
  }
  return count;
}

export function roundTo(n: number, places: number): number {
  const p = 10 ** places;
  return Math.round((n + Number.EPSILON) * p) / p;
}

export function formatHours(n: number): string {
  return n.toLocaleString("en-US", { minimumFractionDigits: 1, maximumFractionDigits: 1 });
}

export function formatWhole(n: number): string {
  return Number.isInteger(n) ? n.toLocaleString("en-US") : formatHours(n);
}

export function formatMoney(n: number, digits = 0): string {
  return n.toLocaleString("en-US", { style: "currency", currency: "USD", minimumFractionDigits: digits, maximumFractionDigits: digits });
}

export function formatPct(ratio: number, digits = 1): string {
  return `${(ratio * 100).toLocaleString("en-US", { minimumFractionDigits: digits, maximumFractionDigits: digits })}%`;
}

export function signedNumber(n: number, digits = 1): string {
  const body = Math.abs(n).toLocaleString("en-US", { minimumFractionDigits: digits, maximumFractionDigits: digits });
  if (n > 0) return `+${body}`;
  if (n < 0) return `−${body}`;
  return body;
}

export function signedPts(deltaRatio: number): string {
  return `${signedNumber(deltaRatio * 100, 1)} pts`;
}

export function countsTowardShopEff(skill: string): boolean {
  return !/foreman|dispatch|advisor|porter|writer/i.test(skill);
}

export function techEff(tech: Tech): number | null {
  if (tech.clockHours <= 0) return null;
  return tech.soldHours / tech.clockHours;
}

export function effStatus(eff: number | null): Status {
  if (eff === null) return "empty";
  if (eff >= 1) return "good";
  if (eff >= 0.8) return "watch";
  return "bad";
}

export function statusLabel(status: Status): string {
  if (status === "good") return "On standard";
  if (status === "watch") return "Watch";
  if (status === "bad") return "Off";
  return "Empty";
}

export function emptyService(): ServiceFigures {
  return {
    sales: 0, gross: 0, totalHours: 0, hoursPerRo: 0, hoursPerMaintRo: 0, roOpenOver30: 0, arOver90: 0,
    servicePolicy: 0, shopSupplies: 0, fordCommitment: "Green", uptimeAssist: 0, grossProfitPct: 0,
    elr: 0, absorption: 0, warrantyDashboard: 0, cvp: "Above Group",
  };
}

export type YearTotals = {
  hours: number;
  elr: number;
  serviceSales: number;
  serviceGross: number;
  partsSales: number;
  partsGross: number;
  recorded: boolean;
};

export function yearToDate(boards: MonthBoard[], through: string): YearTotals {
  const year = through.slice(0, 4);
  const live = boards.filter((board) => board.recorded && board.month.startsWith(`${year}-`) && board.month <= through);
  const blank: YearTotals = { hours: 0, elr: 0, serviceSales: 0, serviceGross: 0, partsSales: 0, partsGross: 0, recorded: false };
  if (!live.length) return blank;
  const hours = live.reduce((sum, board) => sum + board.service.totalHours, 0);
  const weighted = live.reduce((sum, board) => sum + board.service.elr * board.service.totalHours, 0);
  return {
    hours: roundTo(hours, 1),
    elr: hours > 0 ? roundTo(weighted / hours, 2) : 0,
    serviceSales: live.reduce((sum, board) => sum + board.service.sales, 0),
    serviceGross: live.reduce((sum, board) => sum + board.service.gross, 0),
    partsSales: live.reduce((sum, board) => sum + board.parts.sales, 0),
    partsGross: live.reduce((sum, board) => sum + board.parts.gross, 0),
    recorded: true,
  };
}

export function emptyBoard(month: string, hoursGoal = HOURS_GOAL): MonthBoard {
  return {
    month,
    recorded: false,
    hoursGoal,
    service: emptyService(),
    parts: { sales: 0, gross: 0, openInvoicesOver14: 0, inventory: 0, agedOver3: 0, agedOver6: 0, agedOver9: 0 },
    period1: [],
    period2: [],
  };
}

function meanOf(values: number[]): number {
  const present = values.filter((value) => value > 0);
  if (!present.length) return 0;
  return present.reduce((sum, value) => sum + value, 0) / present.length;
}

function weightedMean(pairs: { value: number; weight: number }[]): number {
  const weight = pairs.reduce((sum, pair) => sum + pair.weight, 0);
  if (weight <= 0) return meanOf(pairs.map((pair) => pair.value));
  return pairs.reduce((sum, pair) => sum + pair.value * pair.weight, 0) / weight;
}

function worstOf<T>(order: readonly T[], values: T[]): T {
  return values.reduce((worst, value) => (order.indexOf(value) > order.indexOf(worst) ? value : worst));
}

export function compileBoards(month: string, sources: { label: string; board: MonthBoard }[]): MonthBoard {
  const live = sources.filter((source) => source.board.recorded);
  if (!live.length) return { ...emptyBoard(month), hoursGoal: HOURS_GOAL * sources.length };
  const services = live.map((source) => source.board.service);
  const parts = live.map((source) => source.board.parts);
  const tag = (techs: Tech[], label: string) => techs.map((tech) => ({ ...tech, id: `${label}-${tech.id}`, name: `${tech.name} · ${label}` }));
  return {
    month,
    recorded: true,
    hoursGoal: live.reduce((sum, source) => sum + source.board.hoursGoal, 0),
    service: {
      sales: services.reduce((sum, row) => sum + row.sales, 0),
      gross: services.reduce((sum, row) => sum + row.gross, 0),
      totalHours: roundTo(services.reduce((sum, row) => sum + row.totalHours, 0), 1),
      hoursPerRo: roundTo(meanOf(services.map((row) => row.hoursPerRo)), 2),
      hoursPerMaintRo: roundTo(meanOf(services.map((row) => row.hoursPerMaintRo)), 2),
      roOpenOver30: services.reduce((sum, row) => sum + row.roOpenOver30, 0),
      arOver90: services.reduce((sum, row) => sum + row.arOver90, 0),
      servicePolicy: services.reduce((sum, row) => sum + row.servicePolicy, 0),
      shopSupplies: services.reduce((sum, row) => sum + row.shopSupplies, 0),
      fordCommitment: worstOf(COMMITMENTS, services.map((row) => row.fordCommitment)),
      uptimeAssist: meanOf(services.map((row) => row.uptimeAssist)),
      grossProfitPct: weightedMean(services.map((row) => ({ value: row.grossProfitPct, weight: row.sales }))),
      elr: roundTo(weightedMean(services.map((row) => ({ value: row.elr, weight: row.totalHours }))), 2),
      absorption: services.reduce((sum, row) => sum + row.absorption, 0) / services.length,
      warrantyDashboard: meanOf(services.map((row) => row.warrantyDashboard)),
      cvp: worstOf(CVP_LEVELS, services.map((row) => row.cvp)),
    },
    parts: {
      sales: parts.reduce((sum, row) => sum + row.sales, 0),
      gross: parts.reduce((sum, row) => sum + row.gross, 0),
      openInvoicesOver14: parts.reduce((sum, row) => sum + row.openInvoicesOver14, 0),
      inventory: parts.reduce((sum, row) => sum + row.inventory, 0),
      agedOver3: parts.reduce((sum, row) => sum + row.agedOver3, 0),
      agedOver6: parts.reduce((sum, row) => sum + row.agedOver6, 0),
      agedOver9: parts.reduce((sum, row) => sum + row.agedOver9, 0),
    },
    period1: live.flatMap((source) => tag(source.board.period1, source.label)),
    period2: live.flatMap((source) => tag(source.board.period2, source.label)),
  };
}

const OWNER_STORES: { id: StoreId; name: string; short: string }[] = [
  { id: "grand-coulee", name: "Grand Coulee", short: "Coulee" },
  { id: "pullman", name: "Pullman", short: "Pullman" },
];

export type OwnerStoreSlice = {
  id: StoreId;
  name: string;
  short: string;
  board: MonthBoard;
};

/** Read-only combined month for both stores, plus each store's own board. */
export function ownerMonth(stores: Record<StoreId, Record<string, MonthBoard>>, month: string): { combined: MonthBoard; stores: OwnerStoreSlice[] } {
  const slices = OWNER_STORES.map((store) => ({
    ...store,
    board: stores[store.id]?.[month] ?? emptyBoard(month, store.id === "pullman" ? 1800 : HOURS_GOAL),
  }));
  return {
    stores: slices,
    combined: compileBoards(
      month,
      slices.map((slice) => ({ label: slice.short, board: slice.board })),
    ),
  };
}

export function ownerYearBoards(stores: Record<StoreId, Record<string, MonthBoard>>, through: string): MonthBoard[] {
  const year = through.slice(0, 4);
  const keys = new Set<string>([...Object.keys(stores["grand-coulee"] ?? {}), ...Object.keys(stores.pullman ?? {})]);
  return [...keys]
    .filter((key) => key.startsWith(`${year}-`) && key <= through)
    .sort()
    .map((key) => ownerMonth(stores, key).combined);
}

export type Pace = {
  status: Status;
  elapsed: number;
  total: number;
  remaining: number;
  projected: number | null;
  dailyNeeded: number | null;
  runRate: number | null;
  closed: boolean;
  future: boolean;
};

export function paceFor(board: MonthBoard, today = new Date()): Pace {
  const { year, monthIndex } = parseMonth(board.month);
  const goal = board.hoursGoal;
  const hours = board.service.totalHours;
  const total = weekdayCount(year, monthIndex);
  const todayKey = monthKey(today);
  const future = board.month > todayKey;
  const blank: Pace = { status: "empty", elapsed: 0, total, remaining: total, projected: null, dailyNeeded: null, runRate: null, closed: false, future };
  if (!board.recorded || future) return blank;
  if (board.month < todayKey) {
    const ratio = goal > 0 ? hours / goal : 0;
    return { status: ratio >= 1 ? "good" : ratio >= 0.95 ? "watch" : "bad", elapsed: total, total, remaining: 0, projected: hours, dailyNeeded: null, runRate: null, closed: true, future: false };
  }
  const elapsed = Math.max(1, weekdayCount(year, monthIndex, today.getDate()));
  const remaining = Math.max(0, total - elapsed);
  const runRate = hours / elapsed;
  const projected = runRate * total;
  const dailyNeeded = remaining > 0 ? Math.max(0, goal - hours) / remaining : 0;
  const ratio = goal > 0 ? projected / goal : 0;
  let status: Status = "good";
  if (remaining === 0) status = hours >= goal ? "good" : hours >= goal * 0.95 ? "watch" : "bad";
  else if (ratio < 0.9) status = "bad";
  else if (ratio < 1) status = "watch";
  return { status, elapsed, total, remaining, projected, dailyNeeded, runRate, closed: remaining === 0, future: false };
}

export function availableHours(board: MonthBoard, pace: Pace): number | null {
  const clock = [...board.period1, ...board.period2].reduce((sum, tech) => sum + tech.clockHours, 0);
  if (clock <= 0 || pace.total <= 0) return null;
  if (pace.closed || pace.elapsed <= 0) return roundTo(clock, 1);
  return roundTo((clock / pace.elapsed) * pace.total, 1);
}

function higherStatus(value: number, standard: number, watchFloor: number, present: boolean): Status {
  if (!present || value <= 0) return "empty";
  if (value >= standard) return "good";
  if (value >= watchFloor) return "watch";
  return "bad";
}

export type MetricRow = {
  id: string;
  label: string;
  hint: string;
  actual: string;
  standard: string;
  variance: string;
  status: Status;
};

export type AttentionItem = { id: string; status: Exclude<Status, "empty" | "good">; text: string };

function policyStatus(amount: number, gross: number): { ratio: number | null; status: Status } {
  if (gross <= 0) return { ratio: null, status: "empty" };
  if (amount / gross < POLICY_CAP) return { ratio: amount / gross, status: "good" };
  if (amount / gross < 0.0225) return { ratio: amount / gross, status: "watch" };
  return { ratio: amount / gross, status: "bad" };
}

export function serviceRows(board: MonthBoard): MetricRow[] {
  const recorded = board.recorded;
  const s = board.service;
  const policy = policyStatus(s.servicePolicy, s.gross);
  const supplies = policyStatus(s.shopSupplies, s.gross);
  return [
    { id: "hpro", label: "Hours per RO", hint: "All repair orders.", actual: recorded && s.hoursPerRo > 0 ? formatHours(s.hoursPerRo) : "—", standard: "2.0", variance: recorded && s.hoursPerRo > 0 ? signedNumber(s.hoursPerRo - 2, 2) : "—", status: higherStatus(s.hoursPerRo, 2, 1.7, recorded) },
    { id: "hpmro", label: "Hours per maintenance RO", hint: "Maintenance only.", actual: recorded && s.hoursPerMaintRo > 0 ? formatHours(s.hoursPerMaintRo) : "—", standard: "1.0", variance: recorded && s.hoursPerMaintRo > 0 ? signedNumber(s.hoursPerMaintRo - 1, 2) : "—", status: higherStatus(s.hoursPerMaintRo, 1, 0.85, recorded) },
    { id: "ro30", label: "ROs over 30 days", hint: "Open repair orders.", actual: recorded ? String(s.roOpenOver30) : "—", standard: "0", variance: recorded ? signedNumber(s.roOpenOver30, 0) : "—", status: !recorded ? "empty" : s.roOpenOver30 <= 0 ? "good" : s.roOpenOver30 <= 2 ? "watch" : "bad" },
    { id: "ar90", label: "Receivables over 90 days", hint: "Accounts receivable.", actual: recorded ? formatMoney(s.arOver90) : "—", standard: formatMoney(0), variance: recorded ? signedNumber(s.arOver90, 0) : "—", status: !recorded ? "empty" : s.arOver90 <= 0 ? "good" : s.arOver90 <= 2500 ? "watch" : "bad" },
    { id: "policy", label: "Service policy 7750", hint: "Percent of service gross. Cap is 1.5%.", actual: policy.ratio === null || !recorded ? "—" : formatPct(policy.ratio), standard: "< 1.5%", variance: policy.ratio === null || !recorded ? "—" : signedPts(policy.ratio - POLICY_CAP), status: recorded ? policy.status : "empty" },
    { id: "supplies", label: "Shop supplies", hint: "Cap is 1.5% of gross.", actual: supplies.ratio === null || !recorded ? "—" : formatPct(supplies.ratio), standard: "< 1.5%", variance: supplies.ratio === null || !recorded ? "—" : signedPts(supplies.ratio - POLICY_CAP), status: recorded ? supplies.status : "empty" },
    { id: "gp", label: "Gross profit", hint: "Standard is 75%.", actual: recorded && s.grossProfitPct > 0 ? formatPct(s.grossProfitPct) : "—", standard: "75%", variance: recorded && s.grossProfitPct > 0 ? signedPts(s.grossProfitPct - SERVICE_GP_STANDARD) : "—", status: higherStatus(s.grossProfitPct, SERVICE_GP_STANDARD, 0.7, recorded) },
    { id: "elr", label: "Effective labor rate", hint: "Financial ELR.", actual: recorded && s.elr > 0 ? formatMoney(s.elr, 2) : "—", standard: formatMoney(ELR_STANDARD, 2), variance: recorded && s.elr > 0 ? signedNumber(s.elr - ELR_STANDARD, 2) : "—", status: higherStatus(s.elr, ELR_STANDARD, 115, recorded) },
    { id: "absorption", label: "Service absorption", hint: "Prior month. 100% covers fixed expenses.", actual: recorded && s.absorption > 0 ? formatPct(s.absorption, 0) : "—", standard: "100%", variance: recorded && s.absorption > 0 ? signedPts(s.absorption - 1) : "—", status: higherStatus(s.absorption, 1, 0.9, recorded) },
    { id: "warranty", label: "Warranty dashboard", hint: "Standard is 0.60.", actual: recorded && s.warrantyDashboard > 0 ? s.warrantyDashboard.toFixed(2) : "—", standard: "0.60", variance: recorded && s.warrantyDashboard > 0 ? signedNumber(s.warrantyDashboard - 0.6, 2) : "—", status: higherStatus(s.warrantyDashboard, 0.6, 0.5, recorded) },
    { id: "cvp", label: "CVP score", hint: "Customer viewpoint versus the group.", actual: recorded ? s.cvp : "—", standard: "Above Group", variance: recorded && s.cvp !== "Above Group" ? s.cvp : recorded ? "Even" : "—", status: !recorded ? "empty" : s.cvp === "Above Group" ? "good" : s.cvp === "At Group" ? "watch" : "bad" },
    { id: "uptime", label: "Uptime Assist", hint: "Share of repair orders closed inside the Uptime Assist window.", actual: recorded && s.uptimeAssist > 0 ? formatPct(s.uptimeAssist) : "—", standard: "—", variance: "—", status: "empty" },
    { id: "ford", label: "Ford Commitment", hint: "Program color from the dashboard.", actual: recorded ? s.fordCommitment : "—", standard: "Green", variance: recorded && s.fordCommitment !== "Green" ? s.fordCommitment : recorded ? "Even" : "—", status: !recorded ? "empty" : s.fordCommitment === "Green" ? "good" : s.fordCommitment === "Yellow" ? "watch" : "bad" },
  ];
}

export function partsRows(board: MonthBoard): MetricRow[] {
  const recorded = board.recorded;
  const p = board.parts;
  const gp = p.sales > 0 ? p.gross / p.sales : null;
  const gpStatus: Status = !recorded || gp === null ? "empty" : gp >= PARTS_GP_STANDARD ? "good" : gp >= 0.36 ? "watch" : "bad";
  const aged = (id: string, label: string, amount: number): MetricRow => ({
    id, label, hint: "Dollars older than this. Vs standard shows the share of total inventory.",
    actual: recorded ? formatMoney(amount) : "—", standard: "—",
    variance: recorded && p.inventory > 0 ? formatPct(amount / p.inventory) : "—", status: "empty",
  });
  return [
    { id: "psales", label: "Parts sales", hint: "No dollar standard on the card.", actual: recorded ? formatMoney(p.sales) : "—", standard: "—", variance: "—", status: "empty" },
    { id: "pgross", label: "Parts gross", hint: "Gross dollars.", actual: recorded ? formatMoney(p.gross) : "—", standard: "—", variance: "—", status: "empty" },
    { id: "pgp", label: "Parts gross profit", hint: "Standard is 40%.", actual: recorded && gp !== null ? formatPct(gp) : "—", standard: "40%", variance: recorded && gp !== null ? signedPts(gp - PARTS_GP_STANDARD) : "—", status: gpStatus },
    { id: "pinvoices", label: "Open parts invoices over 14 days", hint: "Count of open invoices.", actual: recorded ? String(p.openInvoicesOver14) : "—", standard: "0", variance: recorded ? signedNumber(p.openInvoicesOver14, 0) : "—", status: !recorded ? "empty" : p.openInvoicesOver14 <= 0 ? "good" : p.openInvoicesOver14 <= 2 ? "watch" : "bad" },
    { id: "inventory", label: "Total parts inventory", hint: "On-hand inventory dollars.", actual: recorded ? formatMoney(p.inventory) : "—", standard: "—", variance: "—", status: "empty" },
    aged("aged3", "Aged inventory over 3 months", p.agedOver3),
    aged("aged6", "Aged inventory over 6 months", p.agedOver6),
    aged("aged9", "Aged inventory over 9 months", p.agedOver9),
  ];
}

export type HealthTally = { good: number; watch: number; bad: number; scored: number; headline: string };

export function tally(rows: MetricRow[]): HealthTally {
  const scored = rows.filter((row) => row.status !== "empty");
  const good = scored.filter((row) => row.status === "good").length;
  const watch = scored.filter((row) => row.status === "watch").length;
  const bad = scored.filter((row) => row.status === "bad").length;
  const headline = bad > 0 ? "Off standard" : watch > 0 ? "Watch" : scored.length ? "On standard" : "No scores";
  return { good, watch, bad, scored: scored.length, headline };
}

export function attentionItems(board: MonthBoard, today = new Date()): AttentionItem[] {
  if (!board.recorded) return [];
  const items: AttentionItem[] = [];
  const pace = paceFor(board, today);
  const rows = [...serviceRows(board), ...partsRows(board)];
  if (pace.status === "bad" || pace.status === "watch") {
    items.push({
      id: "pace",
      status: pace.status,
      text: pace.closed
        ? `${formatHours(board.service.totalHours)} sold hours against a ${formatHours(board.hoursGoal)} goal.`
        : `Tracking about ${formatHours(pace.projected ?? 0)} hours. Need ${formatHours(pace.dailyNeeded ?? 0)} a weekday to hit ${formatWhole(board.hoursGoal)}.`,
    });
  }
  for (const id of ["ro30", "hpro", "hpmro", "supplies", "policy", "gp", "elr", "absorption", "warranty", "ford", "cvp", "ar90", "pgp", "pinvoices"]) {
    const row = rows.find((item) => item.id === id);
    if (!row || (row.status !== "bad" && row.status !== "watch")) continue;
    items.push({ id: row.id, status: row.status, text: `${row.label} is ${row.actual} against ${row.standard}.` });
  }
  return items;
}
