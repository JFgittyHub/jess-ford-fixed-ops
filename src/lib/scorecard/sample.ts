import type { MonthBoard, Tech } from "@/lib/scorecard/model";
import { roundTo } from "@/lib/scorecard/model";

function tech(id: string, name: string, techNumber: string, skill: string, soldHours: number, clockHours: number, workDays: number, elr: number): Tech {
  return { id, name, techNumber, skill, soldHours, clockHours, workDays, elr };
}

function sold(techs: Tech[]): number {
  return roundTo(techs.reduce((sum, item) => sum + item.soldHours, 0), 1);
}

const octoberTechs: Tech[] = [
  tech("oct-marcus", "Marcus Hale", "214", "A Tech", 42, 38, 5, 178),
  tech("oct-elena", "Elena Voss", "118", "A Tech", 38.4, 38, 5, 166),
  tech("oct-diego", "Diego Ruiz", "307", "B Tech", 33, 36, 5, 152),
  tech("oct-priya", "Priya Shah", "221", "B Tech", 28.2, 34, 5, 142),
  tech("oct-andre", "Andre Cole", "155", "C Tech", 20.4, 30, 4, 124),
  tech("oct-jordan", "Jordan Peck", "412", "Apprentice", 23.2, 28, 5, 101),
  tech("oct-sam", "Sam Ortega", "033", "Foreman", 5, 18, 5, 0),
];

const septemberFirst: Tech[] = [
  tech("sep-marcus-1", "Marcus Hale", "214", "A Tech", 104.2, 88, 11, 174),
  tech("sep-elena-1", "Elena Voss", "118", "A Tech", 98.6, 86, 11, 168),
  tech("sep-diego-1", "Diego Ruiz", "307", "B Tech", 88, 84, 11, 154),
  tech("sep-priya-1", "Priya Shah", "221", "B Tech", 82.4, 82, 11, 146),
  tech("sep-andre-1", "Andre Cole", "155", "C Tech", 70.5, 80, 11, 132),
  tech("sep-jordan-1", "Jordan Peck", "412", "Apprentice", 48, 68, 11, 102),
  tech("sep-sam-1", "Sam Ortega", "033", "Foreman", 14, 44, 11, 0),
];

const septemberSecond: Tech[] = [
  tech("sep-marcus-2", "Marcus Hale", "214", "A Tech", 96.4, 82, 10, 172),
  tech("sep-elena-2", "Elena Voss", "118", "A Tech", 90.2, 80, 10, 166),
  tech("sep-diego-2", "Diego Ruiz", "307", "B Tech", 80.8, 78, 10, 152),
  tech("sep-priya-2", "Priya Shah", "221", "B Tech", 74, 76, 10, 144),
  tech("sep-andre-2", "Andre Cole", "155", "C Tech", 62.2, 74, 10, 130),
  tech("sep-jordan-2", "Jordan Peck", "412", "Apprentice", 42.6, 62, 10, 100),
  tech("sep-sam-2", "Sam Ortega", "033", "Foreman", 12.4, 40, 10, 0),
];

export const SAMPLE_MONTHS: Record<string, MonthBoard> = {
  "2026-09": {
    month: "2026-09", recorded: true, hoursGoal: 900,
    service: { sales: 252600, gross: 192986, totalHours: sold([...septemberFirst, ...septemberSecond]), hoursPerRo: 2.18, hoursPerMaintRo: 1.14, roOpenOver30: 0, arOver90: 0, servicePolicy: 2026, shopSupplies: 2605, fordCommitment: "Green", uptimeAssist: 0.74, grossProfitPct: 0.764, elr: 152, absorption: 1.07, warrantyDashboard: 0.71, cvp: "Above Group" },
    parts: { sales: 162400, gross: 67396, openInvoicesOver14: 0, inventory: 174800, agedOver3: 38600, agedOver6: 20100, agedOver9: 8700 },
    period1: septemberFirst, period2: septemberSecond,
  },
  "2026-10": {
    month: "2026-10", recorded: true, hoursGoal: 900,
    service: { sales: 49820, gross: 35572, totalHours: sold(octoberTechs), hoursPerRo: 1.86, hoursPerMaintRo: 0.92, roOpenOver30: 2, arOver90: 0, servicePolicy: 420, shopSupplies: 861, fordCommitment: "Yellow", uptimeAssist: 0.68, grossProfitPct: 0.714, elr: 141.2, absorption: 1.02, warrantyDashboard: 0.63, cvp: "Above Group" },
    parts: { sales: 28640, gross: 10998, openInvoicesOver14: 1, inventory: 186400, agedOver3: 41200, agedOver6: 22800, agedOver9: 9400 },
    period1: octoberTechs, period2: [],
  },
};

const pullmanOctober: Tech[] = [
  tech("pl-oct-nate", "Nate Briggs", "508", "A Tech", 78, 70, 5, 162),
  tech("pl-oct-cole", "Cole Brennan", "441", "A Tech", 70, 68, 5, 158),
  tech("pl-oct-luis", "Luis Navarro", "226", "B Tech", 62, 64, 5, 148),
  tech("pl-oct-hannah", "Hannah Cho", "319", "B Tech", 54, 60, 5, 140),
  tech("pl-oct-reed", "Reed Dalton", "177", "C Tech", 40, 52, 4, 128),
  tech("pl-oct-owen", "Owen Blake", "064", "Apprentice", 36, 48, 5, 108),
  tech("pl-oct-pat", "Pat Nguyen", "012", "Foreman", 8, 30, 5, 0),
];

const pullmanFirst: Tech[] = [
  tech("pl-sep-nate-1", "Nate Briggs", "508", "A Tech", 180, 156, 11, 160),
  tech("pl-sep-cole-1", "Cole Brennan", "441", "A Tech", 168, 152, 11, 156),
  tech("pl-sep-luis-1", "Luis Navarro", "226", "B Tech", 150, 148, 11, 146),
  tech("pl-sep-hannah-1", "Hannah Cho", "319", "B Tech", 136, 144, 11, 138),
  tech("pl-sep-reed-1", "Reed Dalton", "177", "C Tech", 110, 140, 11, 126),
  tech("pl-sep-owen-1", "Owen Blake", "064", "Apprentice", 84, 128, 11, 106),
  tech("pl-sep-pat-1", "Pat Nguyen", "012", "Foreman", 18, 80, 11, 0),
];

const pullmanSecond: Tech[] = [
  tech("pl-sep-nate-2", "Nate Briggs", "508", "A Tech", 164, 148, 10, 158),
  tech("pl-sep-cole-2", "Cole Brennan", "441", "A Tech", 152, 144, 10, 154),
  tech("pl-sep-luis-2", "Luis Navarro", "226", "B Tech", 136, 140, 10, 144),
  tech("pl-sep-hannah-2", "Hannah Cho", "319", "B Tech", 122, 136, 10, 136),
  tech("pl-sep-reed-2", "Reed Dalton", "177", "C Tech", 96, 132, 10, 124),
  tech("pl-sep-owen-2", "Owen Blake", "064", "Apprentice", 72, 116, 10, 104),
  tech("pl-sep-pat-2", "Pat Nguyen", "012", "Foreman", 16, 72, 10, 0),
];

export const PULLMAN_SAMPLE_MONTHS: Record<string, MonthBoard> = {
  "2026-09": {
    month: "2026-09", recorded: true, hoursGoal: 1800,
    service: { sales: 418500, gross: 305505, totalHours: sold([...pullmanFirst, ...pullmanSecond]), hoursPerRo: 2.04, hoursPerMaintRo: 1.06, roOpenOver30: 3, arOver90: 840, servicePolicy: 4100, shopSupplies: 4820, fordCommitment: "Yellow", uptimeAssist: 0.71, grossProfitPct: 0.73, elr: 141.8, absorption: 0.94, warrantyDashboard: 0.66, cvp: "At Group" },
    parts: { sales: 248000, gross: 96720, openInvoicesOver14: 2, inventory: 312000, agedOver3: 74000, agedOver6: 41000, agedOver9: 18600 },
    period1: pullmanFirst, period2: pullmanSecond,
  },
  "2026-10": {
    month: "2026-10", recorded: true, hoursGoal: 1800,
    service: { sales: 86400, gross: 62208, totalHours: sold(pullmanOctober), hoursPerRo: 1.74, hoursPerMaintRo: 0.88, roOpenOver30: 4, arOver90: 1200, servicePolicy: 680, shopSupplies: 1410, fordCommitment: "Yellow", uptimeAssist: 0.61, grossProfitPct: 0.72, elr: 136.5, absorption: 0.91, warrantyDashboard: 0.58, cvp: "At Group" },
    parts: { sales: 41200, gross: 15656, openInvoicesOver14: 3, inventory: 328400, agedOver3: 78400, agedOver6: 43600, agedOver9: 19200 },
    period1: pullmanOctober, period2: [],
  },
};

export function sampleFor(month: string, store: "grand-coulee" | "pullman" = "grand-coulee"): MonthBoard | null {
  const sample = (store === "pullman" ? PULLMAN_SAMPLE_MONTHS : SAMPLE_MONTHS)[month];
  return sample ? structuredClone(sample) : null;
}
