import type { AppointmentLine } from "./types";

/** Demo opcode. A Dealertrack (Opentrack) labor-op feed can replace this id later. */
export const DEMO_MISC_OPCODE = "MISC";
export const MISC_MIN_HOURS = 1;
export const MIN_LINE_HOURS = 0.1;
export const MAX_LINE_HOURS = 24;

export function roundLaborHours(hours: number): number {
  return Math.round(hours * 10) / 10;
}

/** UI helper. The store rejects an out-of-range hour instead of saving this clamp. */
export function clampLaborHours(opcode: string, hours: number): number {
  const value = Number.isFinite(hours) ? roundLaborHours(hours) : MISC_MIN_HOURS;
  if (opcode === DEMO_MISC_OPCODE) return Math.max(MISC_MIN_HOURS, value);
  return Math.max(MIN_LINE_HOURS, value);
}

/** Exact minutes for the line-hour total. 4.1 hr is 246 min, not a 30-minute snap. */
export function minutesFromLineHours(lines: { hours?: number }[]): number | null {
  if (!lines.length || lines.some((line) => typeof line.hours !== "number" || !Number.isFinite(line.hours))) return null;
  return Math.round(lines.reduce((sum, line) => sum + (line.hours ?? 0), 0) * 60);
}

export function laborLineError(
  lines: Pick<AppointmentLine, "laborOpId" | "hours">[],
  laborOps: { id: string; opcode: string }[],
): string | null {
  for (const line of lines) {
    if (!line.laborOpId && (line.hours === undefined || line.hours === null)) continue;
    if (!line.laborOpId) return "Each concern line needs a labor op.";
    const op = laborOps.find((row) => row.id === line.laborOpId);
    if (!op) return "That labor op is not on the list.";
    if (typeof line.hours !== "number" || !Number.isFinite(line.hours)) return "Enter a labor hour amount.";
    const hours = roundLaborHours(line.hours);
    if (op.opcode === DEMO_MISC_OPCODE) {
      if (hours < MISC_MIN_HOURS) return "Misc labor is at least 1.0 hr.";
    } else if (hours < MIN_LINE_HOURS) return "Labor hours are at least 0.1 hr.";
    if (hours > MAX_LINE_HOURS) return "Keep a labor line to 24 hours or less.";
  }
  return null;
}

/** Rounded lines, or the store error. Invalid hours are not rewritten into a legal value. */
export function storedLaborLines(
  lines: AppointmentLine[],
  laborOps: { id: string; opcode: string }[],
): { ok: true; lines: AppointmentLine[] } | { ok: false; error: string } {
  const error = laborLineError(lines, laborOps);
  if (error) return { ok: false, error };
  return {
    ok: true,
    lines: lines.map((line) => (
      typeof line.hours === "number" && Number.isFinite(line.hours)
        ? { ...line, hours: roundLaborHours(line.hours) }
        : line
    )),
  };
}

/** Block length the calendar and the booking rules use. A drag override wins over the line total. */
export function blockMinutes(input: { minutes?: number; lengthOverrideMinutes?: number | null; lines?: { hours?: number }[] }): number | null {
  if (typeof input.lengthOverrideMinutes === "number" && Number.isFinite(input.lengthOverrideMinutes)) return input.lengthOverrideMinutes;
  const fromLines = minutesFromLineHours(input.lines ?? []);
  if (fromLines !== null) return fromLines;
  return typeof input.minutes === "number" && Number.isFinite(input.minutes) ? input.minutes : null;
}

export function prepareConcernLines(
  lines: AppointmentLine[],
  laborOpIds: string[],
  minutes: number,
  laborOps: { id: string; opcode: string; hours: number }[],
): AppointmentLine[] {
  const misc = laborOps.find((op) => op.opcode === DEMO_MISC_OPCODE);
  const source = lines.length ? lines : [{ id: "a", code: "A", concern: "" }];
  return source.map((line, index) => {
    const laborOpId = line.laborOpId || laborOpIds[index] || laborOpIds[0] || misc?.id || "";
    const op = laborOps.find((row) => row.id === laborOpId);
    const opcode = op?.opcode ?? "";
    if (typeof line.hours === "number") {
      if (!Number.isFinite(line.hours) || laborLineError([{ laborOpId, hours: line.hours }], laborOps)) {
        return { ...line, laborOpId, hours: line.hours };
      }
      return { ...line, laborOpId, hours: roundLaborHours(line.hours) };
    }
    const hours = source.length === 1
      ? clampLaborHours(opcode, Math.round((minutes / 60) * 10) / 10)
      : clampLaborHours(opcode, op?.hours ?? MISC_MIN_HOURS);
    return { ...line, laborOpId, hours };
  });
}
