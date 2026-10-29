import { useState } from "react";
import { clockTime } from "@/components/appointment-calendar";
import { Button, Field } from "@/components/ui";
import {
  CANCEL_NOTE_MAX,
  CANCEL_REASONS,
  activeCancellation,
  cancellationLine,
  mayCancelAppointment,
  type DeskActor,
} from "@/lib/cancel";
import type { Appointment, ApptStatus, CancelReason } from "@/lib/types";

export function DeskCancelActions({
  actor,
  status,
  surface,
  onCancel,
  onReinstate,
  blockedReason,
}: {
  actor: DeskActor;
  status: ApptStatus;
  surface: "card" | "edit";
  onCancel?: () => void;
  onReinstate?: () => void;
  /** Shown beside Cancel, including inside Edit details, when the visit cannot be cancelled. */
  blockedReason?: string | null;
}) {
  if (!mayCancelAppointment(actor)) return null;
  if (status === "cancelled") {
    return (
      <div data-desk-cancel={surface}>
        <Button type="button" className="min-h-11" onClick={onReinstate}>Reinstate</Button>
      </div>
    );
  }
  return (
    <div data-desk-cancel={surface}>
      <Button type="button" className="min-h-11" disabled={Boolean(blockedReason)} onClick={onCancel}>Cancel appointment</Button>
      {blockedReason ? <p role="alert" className="mt-2 max-w-sm text-sm normal-case tracking-normal text-[#8a3b2a]">{blockedReason}</p> : null}
    </div>
  );
}

export function CancelForm({
  onSubmit,
}: {
  onSubmit: (input: { reason: CancelReason; note: string }) => string | null;
}) {
  const [reason, setReason] = useState<CancelReason | "">("");
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  return (
    <form
      className="grid gap-3"
      onSubmit={(event) => {
        event.preventDefault();
        setError(onSubmit({ reason: reason as CancelReason, note }));
      }}
    >
      <Field label="Reason">
        <select className="field min-h-11" value={reason} onChange={(event) => setReason(event.target.value as CancelReason | "")}>
          <option value="">Choose a reason</option>
          {CANCEL_REASONS.map((row) => <option key={row.id} value={row.id}>{row.label}</option>)}
        </select>
      </Field>
      <Field label={reason === "other" ? "Note" : "Note, if you need one"}>
        <input className="field min-h-11" value={note} maxLength={CANCEL_NOTE_MAX} onChange={(event) => setNote(event.target.value)} />
      </Field>
      <p className="text-sm normal-case tracking-normal text-muted">Don't enter card or SSN numbers.</p>
      {error ? <p role="alert" className="text-sm text-[#8a3b2a]">{error}</p> : null}
      <div className="mt-4 flex justify-start">
        <Button type="submit" className="btn-danger min-h-11">Cancel appointment</Button>
      </div>
    </form>
  );
}

export function CancelledHistory({
  rows,
  show,
  nameFor,
  allowReinstate,
  onReinstate,
}: {
  rows: Appointment[];
  show: boolean;
  nameFor: (row: Appointment) => string;
  allowReinstate: boolean;
  onReinstate: (id: string) => void;
}) {
  if (!show) return null;
  if (rows.length === 0) return <p className="card mt-4 text-muted">No cancelled appointments this day.</p>;
  return (
    <section className="card mt-4" aria-label="Cancelled appointments">
      <h2 className="font-display text-3xl leading-none">Cancelled</h2>
      <ul className="mt-3 grid gap-3">
        {rows.map((row) => {
          const record = activeCancellation(row);
          return (
            <li key={row.id} className="flex flex-wrap items-center justify-between gap-3 border-t border-line pt-3 first:border-t-0 first:pt-0">
              <div>
                <p className="font-semibold">{nameFor(row)}</p>
                <p className="text-sm text-muted">{clockTime(row.time)} · {row.concern}</p>
                {record ? <p className="text-sm text-muted">{cancellationLine(record)}</p> : null}
              </div>
              {allowReinstate ? <Button type="button" className="min-h-11" onClick={() => onReinstate(row.id)}>Reinstate</Button> : null}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
