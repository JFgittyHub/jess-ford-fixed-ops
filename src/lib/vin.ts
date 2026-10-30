/** Public VIN check-digit weights (ISO 3779). I, O, and Q are not used. */
const VALUES: Record<string, number> = {
  A: 1, B: 2, C: 3, D: 4, E: 5, F: 6, G: 7, H: 8,
  J: 1, K: 2, L: 3, M: 4, N: 5, P: 7, R: 9,
  S: 2, T: 3, U: 4, V: 5, W: 6, X: 7, Y: 8, Z: 9,
};

const WEIGHTS = [8, 7, 6, 5, 4, 3, 2, 10, 0, 9, 8, 7, 6, 5, 4, 3, 2];

const YEAR_CODE: Record<number, string> = {
  2018: "J",
  2019: "K",
  2020: "L",
  2021: "M",
  2022: "N",
  2023: "P",
  2024: "R",
  2025: "S",
  2026: "T",
  2027: "V",
};

export function isFullVin(value: string): boolean {
  return /^[A-HJ-NPR-Z0-9]{17}$/.test(value);
}

/** Blank is allowed until close. I, O, and Q are refused, not stripped. */
export function vinEntryError(value: unknown): string | null {
  if (typeof value !== "string") return "Enter a 17-character VIN.";
  const vin = value.trim().toUpperCase();
  if (!vin) return null;
  if (vin === "UNKNOWN") return "Enter the VIN. Unknown is not a VIN.";
  if (/[IOQ]/.test(vin)) return "A VIN can't include the letters I, O, or Q.";
  if (vin.length !== 17 || !isFullVin(vin)) return "VIN has to be 17 characters.";
  return null;
}

/** A bad check digit warns. It does not block saving or closing. */
export function vinCheckWarning(value: string): string | null {
  if (vinEntryError(value) || !isFullVin(value.trim().toUpperCase())) return null;
  const vin = value.trim().toUpperCase();
  const digit = vinCheckDigit(vin);
  if (digit && vin[8] !== digit) return "The VIN check digit doesn't match. Check it before you close.";
  return null;
}

export function vinCheckDigit(vin: string): string | null {
  if (!isFullVin(vin)) return null;
  let sum = 0;
  for (let index = 0; index < 17; index += 1) {
    const char = vin[index];
    const value = /[0-9]/.test(char) ? Number(char) : VALUES[char];
    if (value === undefined) return null;
    sum += value * WEIGHTS[index];
  }
  const remainder = sum % 11;
  return remainder === 10 ? "X" : String(remainder);
}

/** 17-character VIN. `prefix` is the first 8 characters (WMI + vehicle descriptor). */
export function fullVin(input: { prefix: string; year: number; plant: string; serial: number }): string {
  const prefix = input.prefix.toUpperCase().replace(/[^A-HJ-NPR-Z0-9]/g, "").padEnd(8, "X").slice(0, 8);
  const year = YEAR_CODE[input.year] ?? "R";
  const plant = input.plant.toUpperCase().replace(/[^A-HJ-NPR-Z0-9]/g, "").slice(0, 1) || "A";
  const serial = String(Math.max(0, Math.floor(input.serial))).padStart(6, "0").slice(-6);
  const chars = `${prefix}0${year}${plant}${serial}`.split("");
  const check = vinCheckDigit(chars.join(""));
  chars[8] = check ?? "0";
  return chars.join("");
}
