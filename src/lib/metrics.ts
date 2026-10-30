import { daySpan, feeTotal, monthKey, paceRatio, punchHours, reviewCap, salesTax, SKILL_LABEL, usd } from "./format";
import { doorRate, payKindOf } from "./pay";
import type { Advisor, ClosedRecord, Customer, PayKind, RepairOrder, ShopData, Tech, TimeLog, Vehicle } from "./types";
import { normalizeWa } from "./wa";

export interface TechRow {
  id: string;
  name: string;
  skill: string;
  payStyle: Tech["payStyle"];
  flagged: number;
  flaggedSold: number;
  clocked: number;
  available: number;
  efficiency: number;
  productivity: number;
  laborSales: number;
  laborCost: number;
  contribution: number;
  clockedToday: number;
  flaggedOpen: number;
}

export interface AdvisorRow {
  id: string;
  name: string;
  ros: number;
  hours: number;
  laborSales: number;
  partsSales: number;
  elr: number;
  hoursPerRo: number;
  cpShare: number;
}

export interface BudgetRow {
  id: string;
  department: "service" | "parts";
  category: string;
  monthly: number;
  pace: number;
  actual: number;
  variance: number;
}

export type ShopPath = "/" | "/orders" | "/dispatch" | "/schedule" | "/parts" | "/expenses" | "/customers" | "/reports";

export interface Insight {
  id: string;
  tone: "bad" | "good" | "info";
  title: string;
  detail: string;
  to: ShopPath;
}

export interface Digest {
  pace: number;
  sold: RepairOrder[];
  open: RepairOrder[];
  soldCount: number;
  hoursSold: number;
  hoursCp: number;
  hoursW: number;
  hoursI: number;
  laborSales: number;
  laborCp: number;
  laborW: number;
  laborI: number;
  elr: number;
  elrCp: number;
  partsSales: number;
  partsCost: number;
  partsGross: number;
  partsMargin: number;
  laborMargin: number;
  partsToLabor: number;
  laborCost: number;
  laborGross: number;
  fixedGross: number;
  controllable: number;
  budgetFull: number;
  budgetPace: number;
  overheadFull: number;
  overheadAccrued: number;
  totalExpense: number;
  absorption: number;
  absorptionGap: number;
  forecastGross: number;
  forecastExpense: number;
  forecastAbsorption: number;
  techRows: TechRow[];
  shopEfficiency: number;
  shopProductivity: number;
  advisorRows: AdvisorRow[];
  budgetRows: BudgetRow[];
  daily: { date: string; labor: number; parts: number }[];
  agedCash: number;
  agedCount: number;
  wipTickets: number;
  wipHours: number;
  policySpend: number;
  policyRatio: number;
  oldWip: RepairOrder[];
  insights: Insight[];
  hoursPerRo: number;
  /** $0 closes this month. Left out of sales, hours, and hours-per-RO. */
  noWorkCloses: number;
}

/** Shop date used for month totals. `invoicedOn` is that date; the status is Closed. */
export function closeDay(order: Pick<RepairOrder, "invoicedOn" | "closedAt">) {
  if (order.invoicedOn) return order.invoicedOn;
  if (order.closedAt && order.closedAt.length >= 10) return order.closedAt.slice(0, 10);
  return "";
}

/** Closed, including a migrated sale whose closer was not recorded. Who and when are display-only. */
export function isAdvisorClosed(order: Pick<RepairOrder, "status">) {
  return order.status === "closed";
}

/** Open, including in bay, parts, and ready. Booked and Closed are separate. */
export function isWorkOpen(order: Pick<RepairOrder, "status">) {
  return order.status === "open" || order.status === "working" || order.status === "parts" || order.status === "ready";
}

/** Sales, sold hours, and flat-rate pay. No-work closes stay out. */
export function isSold(order: RepairOrder) {
  return order.status === "closed" && order.closeType !== "no_work" && closeDay(order).startsWith(monthKey());
}

/** Still in the shop: open work and booked tickets. Closed is out. */
export function isOpen(order: RepairOrder) {
  return order.status !== "closed";
}

export function isNoWorkClose(order: RepairOrder) {
  return order.status === "closed" && order.closeType === "no_work";
}

function lineLabor(hours: number, rate: number) {
  return hours * rate;
}

export function orderMoney(order: RepairOrder) {
  const labor = order.labor.reduce((s, line) => s + lineLabor(line.hours, line.rate), 0);
  const hours = order.labor.reduce((s, line) => s + line.hours, 0);
  const parts = order.parts.reduce((s, line) => s + line.qty * line.price, 0);
  const partsCost = order.parts.reduce((s, line) => s + line.qty * line.cost, 0);
  const repair = labor + parts;
  const fees = feeTotal(order.fees, repair);
  const beforeTax = repair + fees;
  const tax = salesTax(beforeTax, order.taxRate);
  return { labor, hours, parts, partsCost, fees, tax, ticket: beforeTax, total: beforeTax + tax, partsGross: parts - partsCost };
}

export function closeGaps(order: RepairOrder, techs: Tech[], advisors: Advisor[], timeLogs: TimeLog[]) {
  const gaps: string[] = [];
  const advisor = advisors.find((row) => row.id === order.advisorId);
  if (!advisor) gaps.push("An advisor has to be on the repair order.");
  else if (!advisor.number.trim()) gaps.push("The advisor needs an advisor number.");
  const numbered = order.labor.filter((line) => techs.find((tech) => tech.id === line.techId)?.number.trim());
  if (numbered.length === 0 || numbered.length !== order.labor.length) gaps.push("Every labor line needs a technician number.");
  const time = timeLogs.filter((row) => row.orderId === order.id).reduce((sum, row) => sum + punchHours(row.startedAt, row.endedAt, Date.now(), reviewCap(row, order.closedAt)), 0);
  if (time <= 0) gaps.push("Clock time");
  return gaps;
}

/** Year, make, and model. A model that already starts with the make is not repeated. */
export function vehicleTitle(year: number | string, make: string, model: string) {
  const makeText = make.trim();
  let modelText = model.trim();
  if (makeText && modelText.toLowerCase().startsWith(`${makeText.toLowerCase()} `)) {
    modelText = modelText.slice(makeText.length).trim();
  }
  return [year || "", makeText, modelText].filter((part) => String(part).trim()).join(" ");
}

export function closedRecord(order: RepairOrder, customer?: Customer, vehicle?: Vehicle): ClosedRecord {
  const money = orderMoney(order);
  const wa = normalizeWa(order.wa);
  return {
    id: `hist-${order.id}-${order.invoicedOn ?? order.openedOn}`,
    orderId: order.id,
    number: order.number,
    openedOn: order.openedOn,
    closedOn: order.invoicedOn ?? order.openedOn,
    customerName: customer?.name ?? "",
    phone: customer?.phone ?? "",
    address: wa.address,
    plate: wa.plate,
    vin: vehicle?.vin ?? "",
    vehicle: vehicle ? vehicleTitle(vehicle.year, vehicle.make || "Ford", vehicle.model) : "",
    mileage: order.mileage,
    mileageOut: order.mileageOut ?? null,
    concern: order.concern,
    opcodes: order.labor.map((line) => line.opcode).join(" "),
    partNumbers: order.parts.map((line) => `${line.number} ${line.description}`).join(" "),
    total: money.total,
    beforeTax: money.ticket,
    closeType: order.closeType === "no_work" ? "no_work" : null,
    closeNote: order.closeNote?.trim() ?? "",
    closedBy: cleanRecorded(order.closedBy),
    closedAt: cleanRecorded(order.closedAt) || null,
    droppedFeesNote: order.droppedFeesNote ?? "",
  };
}

function cleanRecorded(value?: string | null) {
  const text = value?.trim() ?? "";
  if (!text || text.toLowerCase() === "unknown") return "";
  return text;
}

function hoursOf(order: RepairOrder, kind?: PayKind, payTypes?: ShopData["payTypes"]) {
  return order.labor.reduce((s, line) => s + (kind && payKindOf(payTypes, line.payType) !== kind ? 0 : line.hours), 0);
}

function laborOf(order: RepairOrder, kind?: PayKind, payTypes?: ShopData["payTypes"]) {
  return order.labor.reduce((s, line) => s + (kind && payKindOf(payTypes, line.payType) !== kind ? 0 : lineLabor(line.hours, line.rate)), 0);
}

function safeDiv(n: number, d: number) {
  return d === 0 ? 0 : n / d;
}

export function digest(data: ShopData): Digest {
  const pace = paceRatio();
  const sold = data.orders.filter(isSold);
  const open = data.orders.filter(isOpen).sort((a, b) => a.openedOn.localeCompare(b.openedOn) || a.number - b.number);

  let hoursSold = 0;
  let hoursCp = 0;
  let hoursW = 0;
  let hoursI = 0;
  let laborSales = 0;
  let laborCp = 0;
  let laborW = 0;
  let laborI = 0;
  let partsSales = 0;
  let partsCost = 0;

  for (const order of sold) {
    hoursSold += hoursOf(order);
    hoursCp += hoursOf(order, "customer", data.payTypes);
    hoursW += hoursOf(order, "warranty", data.payTypes);
    hoursI += hoursOf(order, "internal", data.payTypes);
    laborSales += laborOf(order);
    laborCp += laborOf(order, "customer", data.payTypes);
    laborW += laborOf(order, "warranty", data.payTypes);
    laborI += laborOf(order, "internal", data.payTypes);
    for (const line of order.parts) {
      partsSales += line.qty * line.price;
      partsCost += line.qty * line.cost;
    }
  }

  const partsGross = partsSales - partsCost;
  const techRows: TechRow[] = data.techs.map((tech) => {
    let flagged = 0;
    let flaggedSold = 0;
    let flaggedOpen = 0;
    let laborForTech = 0;
    for (const order of data.orders) {
      for (const line of order.labor) {
        if (line.techId !== tech.id) continue;
        flagged += line.hours;
        if (isSold(order)) {
          flaggedSold += line.hours;
          laborForTech += lineLabor(line.hours, line.rate);
        } else flaggedOpen += line.hours;
      }
    }
    const laborCost = tech.payStyle === "flat" ? flaggedSold * tech.flagRate : tech.clockedHoursMonth * tech.hourlyRate;
    return {
      id: tech.id,
      name: tech.name,
      skill: SKILL_LABEL[tech.skill],
      payStyle: tech.payStyle,
      flagged,
      flaggedSold,
      clocked: tech.clockedHoursMonth,
      available: tech.availableHoursMonth,
      efficiency: safeDiv(flagged, tech.clockedHoursMonth),
      productivity: safeDiv(flagged, tech.availableHoursMonth),
      laborSales: laborForTech,
      laborCost,
      contribution: laborForTech - laborCost,
      clockedToday: tech.clockedToday,
      flaggedOpen,
    };
  });

  const laborCost = techRows.reduce((s, row) => s + row.laborCost, 0);
  const laborGross = laborSales - laborCost;
  const fixedGross = laborGross + partsGross;
  const clocked = techRows.reduce((s, row) => s + row.clocked, 0);
  const flagged = techRows.reduce((s, row) => s + row.flagged, 0);
  const available = techRows.reduce((s, row) => s + row.available, 0);

  const actualByBudget = new Map<string, number>();
  for (const txn of data.expenses) {
    if (!txn.date.startsWith(monthKey())) continue;
    actualByBudget.set(txn.budgetId, (actualByBudget.get(txn.budgetId) ?? 0) + txn.amount);
  }
  const budgetRows: BudgetRow[] = data.budgets.map((budget) => {
    const actual = actualByBudget.get(budget.id) ?? 0;
    const paceBudget = budget.monthly * pace;
    return {
      id: budget.id,
      department: budget.department,
      category: budget.category,
      monthly: budget.monthly,
      pace: paceBudget,
      actual,
      variance: actual - paceBudget,
    };
  });
  const controllable = budgetRows.reduce((s, row) => s + row.actual, 0);
  const budgetFull = budgetRows.reduce((s, row) => s + row.monthly, 0);
  const budgetPace = budgetRows.reduce((s, row) => s + row.pace, 0);
  const overheadFull = data.overhead.reduce((s, line) => s + line.monthly, 0);
  const overheadAccrued = overheadFull * pace;
  const totalExpense = controllable + overheadAccrued;
  const absorption = safeDiv(fixedGross, totalExpense);
  const absorptionGap = data.settings.targetAbsorption * totalExpense - fixedGross;
  const forecastGross = safeDiv(fixedGross, pace);
  const forecastExpense = safeDiv(controllable, pace) + overheadFull;
  const forecastAbsorption = safeDiv(forecastGross, forecastExpense);

  const advisorRows: AdvisorRow[] = data.advisors.map((advisor) => {
    const mine = sold.filter((order) => order.advisorId === advisor.id);
    const hours = mine.reduce((s, order) => s + hoursOf(order), 0);
    const labor = mine.reduce((s, order) => s + laborOf(order), 0);
    const cpHours = mine.reduce((s, order) => s + hoursOf(order, "customer", data.payTypes), 0);
    const parts = mine.reduce((s, order) => s + order.parts.reduce((p, line) => p + line.qty * line.price, 0), 0);
    return {
      id: advisor.id,
      name: advisor.name,
      ros: mine.length,
      hours,
      laborSales: labor,
      partsSales: parts,
      elr: safeDiv(labor, hours),
      hoursPerRo: safeDiv(hours, mine.length),
      cpShare: safeDiv(cpHours, hours),
    };
  }).sort((a, b) => b.laborSales - a.laborSales);

  const byDay = new Map<string, { labor: number; parts: number }>();
  for (const order of sold) {
    const key = closeDay(order) || order.openedOn;
    const bucket = byDay.get(key) ?? { labor: 0, parts: 0 };
    bucket.labor += laborOf(order);
    bucket.parts += order.parts.reduce((s, line) => s + line.qty * line.price, 0);
    byDay.set(key, bucket);
  }
  const daily = [...byDay.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([date, value]) => ({ date, ...value }));

  const aged = data.parts.filter((part) => part.onHand > 0 && daySpan(part.lastSale) >= 120);
  const agedCash = aged.reduce((s, part) => s + part.onHand * part.cost, 0);
  let wipTickets = 0;
  let wipHours = 0;
  for (const order of open) {
    wipTickets += orderMoney(order).ticket;
    wipHours += orderMoney(order).hours;
  }
  const oldWip = open.filter((order) => daySpan(order.openedOn) >= 5);
  const policySpend = actualByBudget.get("pol") ?? 0;
  const policyRatio = safeDiv(policySpend, laborCp);

  const insights: Insight[] = [];
  if (absorption + 0.005 < data.settings.targetAbsorption) {
    insights.push({
      id: "absorb",
      tone: "bad",
      title: `Absorption is short of ${Math.round(data.settings.targetAbsorption * 100)}%`,
      detail: `Closed fixed gross is covering ${Math.round(absorption * 100)}% of expenses accrued through today. The dollar gap is ${usd(absorptionGap)} — that is what the vehicle departments are still carrying.`,
      to: "/reports",
    });
  } else {
    insights.push({
      id: "absorb",
      tone: "good",
      title: "Fixed ops is carrying the building",
      detail: `Month-to-date absorption is ${Math.round(absorption * 100)}%, at or above the ${Math.round(data.settings.targetAbsorption * 100)}% target.`,
      to: "/reports",
    });
  }

  const leaks = [...budgetRows].filter((row) => row.variance > 400).sort((a, b) => b.variance - a.variance);
  if (leaks[0]) {
    insights.push({
      id: "leak",
      tone: "bad",
      title: `${leaks[0].category} is ahead of pace`,
      detail: `Spent ${usd(leaks[0].actual)} against ${usd(leaks[0].pace)} allowed by today.${leaks[0].id === "pol" && laborCp > 0 ? ` That is ${Math.round(safeDiv(policySpend, laborCp) * 1000) / 10}% of customer-pay labor. The guide is ${Math.round(data.settings.policyGuide * 100)}%.` : ""} ${leaks[1] ? `${leaks[1].category} is the next leak.` : "Nothing else is this far over pace."}`,
      to: "/expenses",
    });
  }

  const weakHourly = [...techRows]
    .filter((row) => row.payStyle === "hourly" && row.efficiency < 0.9 && row.clocked > 0)
    .sort((a, b) => a.efficiency - b.efficiency);
  if (weakHourly[0]) {
    const row = weakHourly[0];
    insights.push({
      id: "hourly",
      tone: "bad",
      title: `${row.name} is on the clock faster than the flags`,
      detail: `${row.skill}, hourly. Efficiency ${Math.round(row.efficiency * 100)}% on ${row.clocked.toFixed(0)} clock hours. That pay hits labor cost whether or not the repair order is closed.`,
      to: "/dispatch",
    });
  }

  if (policyRatio > data.settings.policyGuide && laborCp > 0 && leaks[0]?.id !== "pol") {
    insights.push({
      id: "policy",
      tone: "bad",
      title: "Policy is eating customer-pay labor",
      detail: `Giveaways are ${Math.round(policyRatio * 1000) / 10}% of customer-pay labor. The shop guide is ${Math.round(data.settings.policyGuide * 100)}%. Every point over that is gross you already produced and then handed back.`,
      to: "/expenses",
    });
  }

  const idleFlat = [...techRows]
    .filter((row) => row.payStyle === "flat" && row.productivity < 0.7 && row.available > 0)
    .sort((a, b) => a.productivity - b.productivity);
  if (idleFlat[0]) {
    const row = idleFlat[0];
    insights.push({
      id: "idle-bay",
      tone: "info",
      title: `${row.name.split(" ")[0]}'s bay is not full`,
      detail: `${row.skill}, flat rate, so the paycheck follows the flags. Productivity is only ${Math.round(row.productivity * 100)}% of available hours. The cost is the empty stall, not the tech's rate.`,
      to: "/dispatch",
    });
  }

  if (agedCash >= 1500) {
    insights.push({
      id: "aged",
      tone: "bad",
      title: "Cash is sitting in dead parts",
      detail: `${aged.length} part numbers have not sold in 120 days. Cost on the shelf is ${usd(agedCash)}. That is working capital, not a sales problem, until you return or write it down.`,
      to: "/parts",
    });
  }

  if (oldWip.length > 0) {
    insights.push({
      id: "wip",
      tone: "info",
      title: `${oldWip.length} repair ${oldWip.length === 1 ? "order is" : "orders are"} five days or older`,
      detail: "Unbilled work is not in absorption yet. Aged warranty and special-order jobs are where gross goes to wait.",
      to: "/orders",
    });
  }

  const elr = safeDiv(laborSales, hoursSold);
  const elrCp = safeDiv(laborCp, hoursCp);
  const door = doorRate(data.payTypes);
  if (elrCp + 1 < door) {
    insights.push({
      id: "discount",
      tone: "bad",
      title: "Customer-pay rate is under the door rate",
      detail: `Customer-pay effective rate is ${Math.round(elrCp)} against a door rate of ${Math.round(door)}. That gap is discounting, not warranty mix.`,
      to: "/orders",
    });
  } else if (elr + 8 < door) {
    insights.push({
      id: "mix",
      tone: "info",
      title: "Effective rate sits under the door rate because of mix",
      detail: `Blended effective labor rate is ${Math.round(elr)}. Customer-pay is holding the door rate. Warranty and internal hours are the rest of the blend.`,
      to: "/reports",
    });
  }

  return {
    pace,
    sold,
    open,
    soldCount: sold.length,
    hoursSold,
    hoursCp,
    hoursW,
    hoursI,
    laborSales,
    laborCp,
    laborW,
    laborI,
    elr,
    elrCp,
    partsSales,
    partsCost,
    partsGross,
    partsMargin: safeDiv(partsGross, partsSales),
    laborMargin: safeDiv(laborGross, laborSales),
    partsToLabor: safeDiv(partsSales, laborSales),
    laborCost,
    laborGross,
    fixedGross,
    controllable,
    budgetFull,
    budgetPace,
    overheadFull,
    overheadAccrued,
    totalExpense,
    absorption,
    absorptionGap,
    forecastGross,
    forecastExpense,
    forecastAbsorption,
    techRows,
    shopEfficiency: safeDiv(flagged, clocked),
    shopProductivity: safeDiv(flagged, available),
    advisorRows,
    budgetRows,
    daily,
    agedCash,
    agedCount: aged.length,
    wipTickets,
    wipHours,
    policySpend,
    policyRatio,
    oldWip,
    insights,
    hoursPerRo: safeDiv(hoursSold, sold.length),
    noWorkCloses: data.orders.filter((order) => isNoWorkClose(order) && closeDay(order).startsWith(monthKey())).length,
  };
}

export function lookups(data: ShopData) {
  return {
    customer: new Map(data.customers.map((row) => [row.id, row])),
    vehicle: new Map(data.vehicles.map((row) => [row.id, row])),
    advisor: new Map(data.advisors.map((row) => [row.id, row])),
    tech: new Map(data.techs.map((row) => [row.id, row])),
    part: new Map(data.parts.map((row) => [row.id, row])),
    budget: new Map(data.budgets.map((row) => [row.id, row])),
  };
}
