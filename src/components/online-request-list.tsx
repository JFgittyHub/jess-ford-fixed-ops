import { Fragment, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui";
import { formatVisit } from "@/lib/format";
import type { ContactMethod, OnlineRequest } from "@/lib/types";

const METHOD: Record<ContactMethod, string> = { text: "Text", email: "Email", call: "Call" };

export function OnlineRequestList({
  rows,
  customers = [],
  suggested,
  onApprove,
  onDecline,
  canAct = true,
  refusal = "Only an advisor or service manager can approve or decline a request.",
  rowWarning = null,
  onCancelWarning,
  onConfirmWarning,
}: {
  rows: OnlineRequest[];
  customers?: { id: string; name: string }[];
  suggested?: (row: OnlineRequest) => string;
  onApprove?: (id: string, linkCustomerId?: string) => void;
  onDecline?: (id: string) => void;
  /** Techs and a blank working-as pick do not get Approve or Decline. */
  canAct?: boolean;
  refusal?: string;
  rowWarning?: { id: string; text: string } | null;
  onCancelWarning?: () => void;
  onConfirmWarning?: () => void;
}) {
  const listed = [...rows].sort((a, b) => a.date.localeCompare(b.date) || a.time.localeCompare(b.time) || a.id.localeCompare(b.id));
  if (listed.length === 0) {
    return <p className="card mt-4 text-muted">No pending requests on this store.</p>;
  }
  return (
    <div className="mt-4 overflow-x-auto card p-0">
      <table className="data-table min-w-[64rem]">
        <caption className="sr-only">Pending requests for this store</caption>
        <thead>
          <tr>
            <th>When</th>
            <th>Customer</th>
            <th>Vehicle</th>
            <th>Service</th>
            <th>Advisor</th>
            <th>Transport</th>
            <th>Contact</th>
            <th>Identity</th>
            {onApprove ? <th>Desk</th> : null}
          </tr>
        </thead>
        <tbody>
          {listed.map((row) => (
            <Fragment key={row.id}>
            <tr>
              <td className="whitespace-nowrap">{formatVisit(row.date, row.time)}</td>
              <td>{row.customerName}</td>
              <td>{vehicleLine(row)}</td>
              <td>{row.serviceName} · {row.laborHours} hr</td>
              <td>{row.advisorName}</td>
              <td>{row.transportName}</td>
              <td>{METHOD[row.contactMethod] ?? "Text"}</td>
              <td>{row.verified ? "Verified" : "Unverified"}</td>
              {onApprove ? (
                <td>
                  {canAct ? (
                    <RequestActions
                      row={row}
                      customers={customers}
                      suggestion={suggested?.(row) ?? ""}
                      onApprove={onApprove}
                      onDecline={onDecline}
                    />
                  ) : (
                    <p role="alert" className="max-w-xs text-sm text-[#8a3b2a]">{refusal}</p>
                  )}
                </td>
              ) : null}
            </tr>
            {rowWarning?.id === row.id ? <WarningRow text={rowWarning.text} onCancel={onCancelWarning} onConfirm={onConfirmWarning} /> : null}
            </Fragment>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function WarningRow({ text, onCancel, onConfirm }: { text: string; onCancel?: () => void; onConfirm?: () => void }) {
  const row = useRef<HTMLTableRowElement>(null);
  useEffect(() => { row.current?.scrollIntoView({ block: "nearest" }); }, [text]);
  return (
    <tr ref={row}>
      <td colSpan={9} className="w-full">
        <div className="grid w-full gap-2">
          <p role="status" className="w-full rounded-md border border-[#e7d7a8] bg-[#f8efd4] px-3 py-2 text-sm text-[#8a5a00]">{text}</p>
          <div className="flex flex-wrap gap-2">
            <Button type="button" onClick={onCancel}>Cancel</Button>
            <Button tone="primary" type="button" onClick={onConfirm}>Override</Button>
          </div>
        </div>
      </td>
    </tr>
  );
}

function RequestActions({
  row,
  customers,
  suggestion,
  onApprove,
  onDecline,
}: {
  row: OnlineRequest;
  customers: { id: string; name: string }[];
  suggestion: string;
  onApprove: (id: string, linkCustomerId?: string) => void;
  onDecline?: (id: string) => void;
}) {
  const [linkCustomerId, setLinkCustomerId] = useState(suggestion);
  return (
    <div className="grid min-w-48 gap-2">
      {row.verified ? null : (
        <label className="grid gap-1 text-xs text-muted">
          Match customer
          <select className="field" aria-label={`Match customer for ${row.customerName}`} value={linkCustomerId} onChange={(event) => setLinkCustomerId(event.target.value)}>
            <option value="">New record from this request</option>
            {customers.map((customer) => <option key={customer.id} value={customer.id}>{customer.name}</option>)}
          </select>
        </label>
      )}
      <div className="flex flex-wrap gap-2">
        <Button small tone="primary" onClick={() => onApprove(row.id, row.verified ? undefined : linkCustomerId)}>Approve</Button>
        {onDecline ? <Button small onClick={() => onDecline(row.id)}>Decline</Button> : null}
      </div>
    </div>
  );
}

function vehicleLine(row: OnlineRequest) {
  const name = [row.year || null, row.make, row.model].filter(Boolean).join(" ");
  const vin = row.vin ? `VIN ${row.vin}` : "";
  const plate = row.plate ? `Plate ${row.plate}` : "";
  return [name, vin, plate].filter(Boolean).join(" · ") || "Vehicle not listed";
}
