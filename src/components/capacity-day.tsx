import { Link } from "@tanstack/react-router";
import { clockTime, flagHours } from "@/components/appointment-calendar";
import type { DayCapacity } from "@/lib/capacity";

export function CapacityDayStrip({
  view,
  advisors,
}: {
  view: DayCapacity;
  advisors: { id: string; name: string }[];
}) {
  const name = new Map(advisors.map((row) => [row.id, row.name.split(" ")[0] || row.name]));
  if (view.closed) {
    return (
      <section className="card mt-4" aria-label="Capacity for this day">
        <p className="text-sm font-semibold">Capacity</p>
        <p className="mt-1 text-sm text-muted">
          The shop is closed. No technician hours, advisor load, or arrivals.
        </p>
        <p className="mt-2 text-sm">
          <Link to="/capacity" className="underline">
            Capacity settings
          </Link>
        </p>
      </section>
    );
  }
  const hourCap = capPhrase(view.advisorHourCap, "per hour", "no hourly limit", "Advisor appointments are closed for every hour.");
  const arrivalCap = capPhrase(view.arrivalCap, "arrival", "no arrival cap", "Arrivals are closed for every time slot.");
  const waiterCap = capPhrase(view.waiterCap, "waiter", "no waiter cap", "Waiter appointments are closed for every time slot.");
  return (
    <section className="card mt-4 grid gap-3" aria-label="Capacity for this day">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <p className="text-sm font-semibold">Capacity this day</p>
        <p className="text-sm text-muted">
          Online share {view.onlineSharePercent}%. {hoursLabel(view.onlineShareLeft)} of online share left today. Pending requests count for 48 hours.{" "}
          <Link to="/capacity" className="underline">
            Settings
          </Link>
        </p>
      </div>
      {view.advisorHourCap === 0 || view.waiterCap === 0 || view.arrivalCap === 0 ? (
        <p role="status" className="text-sm text-[#8a3b2a]">
          {[view.advisorHourCap === 0 ? hourCap : "", view.waiterCap === 0 ? waiterCap : "", view.arrivalCap === 0 ? arrivalCap : ""].filter(Boolean).join(" ")}
        </p>
      ) : null}
      <p className="text-sm">
        Technicians {flagHours(view.usedHours)} / {flagHours(view.availableHours)} hrs
      </p>
      <div>
        <p className="text-sm font-semibold">
          Advisors · {view.advisorDayCap} per day · {hourCap}
        </p>
        <p className="mt-1 text-sm text-muted">
          {view.advisors
            .map((row) => `${name.get(row.id) ?? "Advisor"} ${row.dayUsed}/${view.advisorDayCap}`)
            .join(" · ") || "No advisors"}
        </p>
        <ul className="mt-2 flex flex-wrap gap-1">
          {view.hours.map((hour) => (
            <li
              key={hour.time}
              className="rounded-md border border-line px-2 py-1 text-xs tabular-nums"
            >
              {clockPt(hour.time)}{" "}
              {hour.advisors
                .map(
                  (row) =>
                    `${name.get(row.id) ?? "?"} ${row.used}${view.advisorHourCap == null ? "" : `/${view.advisorHourCap}`}`,
                )
                .join(" ")}
            </li>
          ))}
        </ul>
      </div>
      <div>
        <p className="text-sm font-semibold">
          Arrivals and waiters · {arrivalCap} · {waiterCap}
        </p>
        <SlotCounts view={view} />
      </div>
    </section>
  );
}

function clockPt(time: string) {
  return `${clockTime(time)} PT`;
}

function hoursLabel(n: number) {
  const shown = flagHours(n);
  return `${shown} ${shown === "1" ? "hr" : "hrs"}`;
}

function noun(n: number, one: string, many: string) {
  return `${n} ${n === 1 ? one : many}`;
}

function capPhrase(cap: number | null, unit: string, openLabel: string, closedLabel: string) {
  if (cap == null) return openLabel;
  if (cap === 0) return closedLabel;
  if (unit === "per hour") return `${cap} per hour`;
  return `${noun(cap, unit, `${unit}s`)} per slot`;
}

function SlotCounts({ view }: { view: DayCapacity }) {
  const busy = view.slots.filter((slot) => slot.arrivals > 0 || slot.waiters > 0);
  const quiet = view.slots.length - busy.length;
  if (busy.length === 0) {
    return <p className="mt-1 text-sm text-muted">No arrivals on this day yet. {quiet} open times.</p>;
  }
  return (
    <>
      <ul className="mt-2 flex flex-wrap gap-1">
        {busy.map((slot) => {
          const over =
            (view.arrivalCap != null && slot.arrivals > view.arrivalCap) ||
            (view.waiterCap != null && slot.waiters > view.waiterCap);
          return (
            <li
              key={slot.time}
              className={`rounded-md border px-2 py-1 text-xs tabular-nums ${over ? "border-[#e7d7a8] bg-[#f8efd4]" : "border-line"}`}
            >
              {clockPt(slot.time)} · {noun(slot.arrivals, "arrival", "arrivals")}
              {view.arrivalCap == null ? "" : `/${view.arrivalCap}`} · {noun(slot.waiters, "waiter", "waiters")}
              {view.waiterCap == null ? "" : `/${view.waiterCap}`}
            </li>
          );
        })}
      </ul>
      {quiet > 0 ? <p className="mt-1 text-xs text-muted">{quiet} other times are empty.</p> : null}
    </>
  );
}
