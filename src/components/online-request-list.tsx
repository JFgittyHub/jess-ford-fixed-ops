import type { OnlineRequest } from "@/lib/types";

export function OnlineRequestList({ rows }: { rows: OnlineRequest[] }) {
  const listed = [...rows].sort((a, b) => a.date.localeCompare(b.date) || a.time.localeCompare(b.time) || a.id.localeCompare(b.id));
  if (listed.length === 0) {
    return <p className="card mt-4 text-muted">No online requests on this store.</p>;
  }
  return (
    <div className="mt-4 overflow-x-auto card p-0">
      <table className="data-table min-w-[56rem]">
        <caption className="sr-only">Pending online requests for this store</caption>
        <thead>
          <tr>
            <th>When</th>
            <th>Customer</th>
            <th>Vehicle</th>
            <th>Service</th>
            <th>Advisor</th>
            <th>Transport</th>
            <th>Identity</th>
          </tr>
        </thead>
        <tbody>
          {listed.map((row) => (
            <tr key={row.id}>
              <td className="whitespace-nowrap tabular-nums">{row.date} · {row.time}</td>
              <td>{row.customerName}</td>
              <td>{vehicleLine(row)}</td>
              <td>{row.serviceName} · {row.laborHours} hr</td>
              <td>{row.advisorName}</td>
              <td>{row.transportName}</td>
              <td>{row.verified ? "Verified" : "Unverified"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function vehicleLine(row: OnlineRequest) {
  const name = [row.year || null, row.make, row.model].filter(Boolean).join(" ");
  const vin = row.vin ? `VIN ${row.vin}` : "";
  const plate = row.plate ? `Plate ${row.plate}` : "";
  return [name, vin, plate].filter(Boolean).join(" · ") || "Vehicle not listed";
}
