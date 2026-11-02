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
  const hourCap =
    view.advisorHourCap == null ? "no hourly limit" : `${view.advisorHourCap} per hour`;
  const arrivalCap =
    view.arrivalCap == null ? "no arrival cap" : `${view.arrivalCap} arrivals per slot`;
  const waiterCap = view.waiterCap == null ? "no waiter cap" : `${view.waiterCap} waiters per slot`;
  return (
    <section className="card mt-4 grid gap-3" aria-label="Capacity for this day">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <p className="text-sm font-semibold">Capacity this day</p>
        <p className="text-sm text-muted">
          Online share {view.onlineSharePercent}%. Pending requests count.{" "}
          <Link to="/capacity" className="underline">
            Settings
          </Link>
        </p>
      </div>
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
              {clockTime(hour.time).replace(":00", "")}{" "}
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
        <ul className="mt-2 flex flex-wrap gap-1">
          {view.slots.map((slot) => {
            const over =
              (view.arrivalCap != null && slot.arrivals > view.arrivalCap) ||
              (view.waiterCap != null && slot.waiters > view.waiterCap);
            return (
              <li
                key={slot.time}
                className={`rounded-md border px-2 py-1 text-xs tabular-nums ${over ? "border-[#e7d7a8] bg-[#f8efd4]" : "border-line"}`}
              >
                {clockTime(slot.time)} · {slot.arrivals}
                {view.arrivalCap == null ? "" : `/${view.arrivalCap}`} in · {slot.waiters}
                {view.waiterCap == null ? "" : `/${view.waiterCap}`} waiting
              </li>
            );
          })}
        </ul>
      </div>
    </section>
  );
}
