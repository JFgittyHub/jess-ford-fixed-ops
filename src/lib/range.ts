/** Shared finite-and-range check for money, hours, and quantities. */
export const MONEY_MAX = 1_000_000;
export const HOURS_MAX = 1_000;
export const QTY_MAX = 10_000;
export const TEXT_MAX = 200;
export const NAME_MAX = 80;
export const REASON_MAX = 500;

export function inRange(value: unknown, min: number, max: number): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= min && value <= max;
}

export function asText(value: unknown, max: number): string | null {
  if (typeof value !== "string") return null;
  const text = value.trim();
  if (text.length > max) return null;
  return text;
}

export function phoneDigits(value: string) {
  return value.replace(/\D/g, "");
}

export function phoneDigitError(value: string) {
  if (phoneDigits(value).length !== 10) return "Enter a 10-digit phone number.";
  return null;
}
