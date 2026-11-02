import { addDays, todayIso } from "./clock";

/** Holidays both stores close. A fixture must not land on one of these or a Sunday. */
const HOLIDAYS = new Set(["2026-11-26", "2026-11-27", "2026-12-24", "2026-12-25"]);

/** The next open shop day from today, then `skip` open days after that. */
export function bookableDay(skip = 0): string {
  let cursor = todayIso();
  let found = -1;
  for (let guard = 0; guard < 80; guard += 1) {
    const weekday = new Date(`${cursor}T12:00:00.000Z`).getUTCDay();
    if (weekday !== 0 && !HOLIDAYS.has(cursor)) {
      found += 1;
      if (found === skip) return cursor;
    }
    cursor = addDays(cursor, 1);
  }
  return cursor;
}
