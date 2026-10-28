import { overrideReasonLabel } from "@/lib/capacity";
import type { OverrideRecord } from "@/lib/types";

const SHOP_TZ = "America/Los_Angeles";

export function OverrideLog({ rows }: { rows: OverrideRecord[] }) {
  const listed = [...rows].sort((a, b) => b.at.localeCompare(a.at) || b.id.localeCompare(a.id));
  if (listed.length === 0) {
    return <p className="card mt-4 text-muted">No overrides on this store.</p>;
  }
  return (
    <div className="mt-4 overflow-x-auto card p-0">
      <table className="data-table min-w-[56rem]">
        <caption className="sr-only">Capacity overrides for this store</caption>
        <thead>
          <tr>
            <th>When</th>
            <th>Who</th>
            <th>Customer</th>
            <th>Appointment</th>
            <th>Technician</th>
            <th>Advisor</th>
            <th>Why</th>
          </tr>
        </thead>
        <tbody>
          {listed.map((row) => (
            <tr key={row.id}>
              <td className="whitespace-nowrap">{shopWhen(row.at)}</td>
              <td>{row.who}</td>
              <td>{row.customerName}</td>
              <td className="whitespace-nowrap tabular-nums">{row.date} · {row.time}</td>
              <td>{row.techName}</td>
              <td>{row.advisorName}</td>
              <td>{overrideReasonLabel(row.reason)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function shopWhen(iso: string) {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return new Intl.DateTimeFormat("en-US", {
    timeZone: SHOP_TZ,
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(date);
}
