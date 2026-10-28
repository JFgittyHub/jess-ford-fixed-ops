import type { ShopNotice } from "@/lib/types";

const METHOD = { text: "Text", email: "Email", call: "Call" } as const;
const KIND = { approval: "Approval", decline: "Decline", reminder: "Day-before reminder" } as const;

export function NoticeLog({ rows }: { rows: ShopNotice[] }) {
  const listed = [...rows].sort((a, b) => b.at.localeCompare(a.at) || b.id.localeCompare(a.id));
  if (listed.length === 0) {
    return <p className="card mt-4 text-muted">No simulated notices on this store.</p>;
  }
  return (
    <div className="mt-4 overflow-x-auto card p-0">
      <table className="data-table min-w-[56rem]">
        <caption className="sr-only">Simulated notices for this store</caption>
        <thead>
          <tr>
            <th>When</th>
            <th>Kind</th>
            <th>Customer</th>
            <th>Method</th>
            <th>Recipient</th>
            <th>Message</th>
          </tr>
        </thead>
        <tbody>
          {listed.map((row) => (
            <tr key={row.id}>
              <td className="whitespace-nowrap">{shopWhen(row.at)}</td>
              <td>{KIND[row.kind]}</td>
              <td>{row.customerName}</td>
              <td>{METHOD[row.method]}</td>
              <td>{row.recipient}</td>
              <td>{row.body}</td>
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
    timeZone: "America/Los_Angeles",
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(date);
}
