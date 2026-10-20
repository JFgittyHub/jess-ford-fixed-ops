export type WaChoice = "" | "written" | "cap" | "waive" | "dropoff";

export interface ExtraAuth {
  id: string;
  date: string;
  time: string;
  employee: string;
  person: string;
  phone: string;
  work: string;
  amount: number;
}

export interface WaRecord {
  choice: WaChoice;
  initials: string;
  date: string;
  time: string;
  estimate: number;
  cap: number;
  returnParts: boolean;
  plate: string;
  address: string;
  extras: ExtraAuth[];
}

export function blankWa(): WaRecord {
  return {
    choice: "",
    initials: "",
    date: "",
    time: "",
    estimate: 0,
    cap: 0,
    returnParts: false,
    plate: "",
    address: "",
    extras: [],
  };
}

export function normalizeWa(value: Partial<WaRecord> | null | undefined): WaRecord {
  const base = blankWa();
  if (!value) return base;
  return {
    ...base,
    ...value,
    estimate: Number(value.estimate) || 0,
    cap: Number(value.cap) || 0,
    extras: Array.isArray(value.extras) ? value.extras : [],
  };
}

/** Dollars the customer has authorized, before sales tax. Null until the choice is complete. */
export function waLimit(wa: WaRecord): number | null {
  if (!wa.choice || !wa.initials.trim() || !wa.date || !wa.time) return null;
  const extra = wa.extras.reduce((sum, row) => sum + (Number(row.amount) || 0), 0);
  if (wa.choice === "waive") return Number.POSITIVE_INFINITY;
  if (wa.choice === "written") return wa.estimate > 0 ? wa.estimate * 1.1 + extra : null;
  if (wa.choice === "cap" || wa.choice === "dropoff") {
    const amount = wa.choice === "cap" ? wa.cap : wa.estimate;
    return amount > 0 ? amount + extra : null;
  }
  return null;
}

export function vinTail(vin: string) {
  return vin.replace(/[^a-z0-9]/gi, "").slice(-8).toUpperCase();
}
