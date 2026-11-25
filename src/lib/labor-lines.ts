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

/** Exact minutes for the lines that have hours. A concern-only line does not wipe the total. 4.1 hr is 246 min before the block is rounded. */
export function minutesFromLineHours(lines: { hours?: number }[]): number | null {
  const numbered = lines.filter((line) => typeof line.hours === "number" && Number.isFinite(line.hours));
  if (!numbered.length) return null;
  return Math.round(numbered.reduce((sum, line) => sum + (line.hours ?? 0), 0) * 60);
}

/** Calendar blocks sit on the 30-minute grid. A 246-minute line total becomes a 270-minute block. */
export function snapBlockMinutes(minutes: number): number {
  if (!Number.isFinite(minutes)) return minutes;
  return Math.ceil((minutes - 1e-9) / 30) * 30;
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

/** Block length the calendar and the booking rules use. A drag override wins. A line total rounds up to 30 minutes. */
export function blockMinutes(input: { minutes?: number; lengthOverrideMinutes?: number | null; lines?: { hours?: number; laborOpId?: string }[] }): number | null {
  if (typeof input.lengthOverrideMinutes === "number" && Number.isFinite(input.lengthOverrideMinutes)) return input.lengthOverrideMinutes;
  const fromLines = minutesFromLineHours(input.lines ?? []);
  if (fromLines !== null) return snapBlockMinutes(fromLines);
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
        const { hours: _illegal, ...rest } = line;
        return { ...rest, laborOpId };
      }
      return { ...line, laborOpId, hours: roundLaborHours(line.hours) };
    }
    const hours = source.length === 1
      ? clampLaborHours(opcode, Math.round((minutes / 60) * 10) / 10)
      : clampLaborHours(opcode, op?.hours ?? MISC_MIN_HOURS);
    return { ...line, laborOpId, hours };
  });
}

/** Lines as the desk form opens them. A line with no stored op stays blank so the desk can ask for one. */
export function linesForDesk(
  lines: AppointmentLine[],
  laborOpIds: string[],
  minutes: number,
  laborOps: { id: string; opcode: string; hours: number }[],
  lengthOverrideMinutes?: number | null,
): AppointmentLine[] {
  if (!lines.length) return prepareConcernLines(lines, laborOpIds, minutes, laborOps);
  void lengthOverrideMinutes;
  const prepared = lines.map((line, index) => {
    const laborOpId = line.laborOpId || laborOpIds[index] || "";
    if (!laborOpId) return { ...line };
    const op = laborOps.find((row) => row.id === laborOpId);
    if (typeof line.hours === "number" && Number.isFinite(line.hours)) {
      return { ...line, laborOpId, hours: roundLaborHours(line.hours) };
    }
    const catalog = op?.hours ?? (lines.length === 1 ? Math.round((minutes / 60) * 10) / 10 : MISC_MIN_HOURS);
    return { ...line, laborOpId, hours: clampLaborHours(op?.opcode ?? "", catalog) };
  });
  return prepared;
}

/**
 * The block after a line edit. A higher line total, rounded up to 30 minutes,
 * lengthens the visit. An equal or lower total leaves the length alone.
 * A drag override is the current length until the lines grow past it.
 * Line hours are not rewritten.
 */
export function deskBlockMinutes(input: {
  openedMinutes: number;
  openedLineMinutes: number;
  lineMinutes: number | null;
  override: number | null;
}): number {
  const current = typeof input.override === "number" ? input.override : input.openedMinutes;
  if (input.lineMinutes == null || !Number.isFinite(input.lineMinutes)) return current;
  const snapped = snapBlockMinutes(input.lineMinutes);
  if (typeof input.override === "number") {
    const opened = snapBlockMinutes(Math.max(0, input.openedLineMinutes));
    if (snapped > opened && snapped > current) return snapped;
    return current;
  }
  return snapped > current ? snapped : current;
}

/**
 * Store rule for a save or update. A numeric drag override is the length.
 * Otherwise a higher snapped line total grows the visit, and a lower one
 * keeps the current length so the calendar cannot shrink from the lines.
 */
export function blockAfterLineEdit(currentMinutes: number, lineMinutes: number | null, explicitOverride: number | null): { minutes: number; override: number | null } {
  if (typeof explicitOverride === "number") return { minutes: explicitOverride, override: explicitOverride };
  if (lineMinutes == null || !Number.isFinite(lineMinutes)) return { minutes: currentMinutes, override: null };
  const snapped = snapBlockMinutes(lineMinutes);
  if (snapped > currentMinutes) return { minutes: snapped, override: null };
  if (snapped < currentMinutes) return { minutes: currentMinutes, override: currentMinutes };
  return { minutes: currentMinutes, override: null };
}
