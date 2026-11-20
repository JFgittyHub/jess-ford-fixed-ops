import type { AppointmentLine } from "./types";

/** Demo opcode. A Dealertrack (Opentrack) labor-op feed can replace this id later. */
export const DEMO_MISC_OPCODE = "MISC";
export const MISC_MIN_HOURS = 1;

export function clampLaborHours(opcode: string, hours: number): number {
  const value = Number.isFinite(hours) ? Math.round(hours * 10) / 10 : MISC_MIN_HOURS;
  if (opcode === DEMO_MISC_OPCODE) return Math.max(MISC_MIN_HOURS, value);
  return Math.max(0.1, value);
}

/** Calendar minutes from line hours. Null when a line has no hours yet, so older visits keep their length. */
export function minutesFromLineHours(lines: { hours?: number }[]): number | null {
  if (!lines.length || lines.some((line) => typeof line.hours !== "number")) return null;
  const minutes = Math.round(lines.reduce((sum, line) => sum + (line.hours ?? 0), 0) * 60);
  const snapped = Math.round(minutes / 30) * 30;
  return Math.min(1410, Math.max(30, snapped));
}

export function laborLineError(
  lines: Pick<AppointmentLine, "laborOpId" | "hours">[],
  laborOps: { id: string; opcode: string }[],
): string | null {
  for (const line of lines) {
    if (!line.laborOpId && line.hours === undefined) continue;
    if (!line.laborOpId) return "Each concern line needs a labor op.";
    const op = laborOps.find((row) => row.id === line.laborOpId);
    if (!op) return "That labor op is not on the list.";
    if (op.opcode === DEMO_MISC_OPCODE && (line.hours ?? 0) < MISC_MIN_HOURS) return "Misc labor is at least 1.0 hr.";
  }
  return null;
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
    const hours = typeof line.hours === "number"
      ? clampLaborHours(opcode, line.hours)
      : source.length === 1
        ? clampLaborHours(opcode, Math.round((minutes / 60) * 10) / 10)
        : clampLaborHours(opcode, op?.hours ?? MISC_MIN_HOURS);
    return { ...line, laborOpId, hours };
  });
}
