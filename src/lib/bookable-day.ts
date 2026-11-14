import { addDays, todayIso } from "./clock";

/** Holidays either store closes. A fixture must not land on one of these. */
const CLOSED_DATES = ["2026-11-26", "2026-11-27", "2026-12-24", "2026-12-25"];

type DayRules = {
  hours?: { weekday: number; closed: boolean }[];
  closedDates?: string[];
};

/**
 * The next day the shop can take a visit, then `skip` open days after that.
 * Sunday is closed unless `rules.hours` says otherwise. Pass the store's hours
 * after a test changes them, so a closed Monday is not booked.
 */
export function bookableDay(skip = 0, rules?: DayRules): string {
  const closedDates = new Set(rules?.closedDates ?? CLOSED_DATES);
  let cursor = todayIso();
  let found = -1;
  for (let guard = 0; guard < 120; guard += 1) {
    const weekday = new Date(`${cursor}T12:00:00.000Z`).getUTCDay();
    const hours = rules?.hours?.find((row) => row.weekday === weekday);
    const closedWeekday = rules?.hours ? !hours || hours.closed : weekday === 0;
    if (!closedWeekday && !closedDates.has(cursor)) {
      found += 1;
      if (found === skip) return cursor;
    }
    cursor = addDays(cursor, 1);
  }
  return cursor;
}
