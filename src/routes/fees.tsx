import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Shell } from "@/components/shell";
import { Button, Field } from "@/components/ui";
import { feeTotal, usd } from "@/lib/format";
import { useShop } from "@/lib/store";

export const Route = createFileRoute("/fees")({ component: FeesPage });

function FeesPage() {
  const fees = useShop((state) => state.settings.fees);
  const taxRate = useShop((state) => state.settings.taxRate);
  const updateSettings = useShop((state) => state.updateSettings);
  const addFee = useShop((state) => state.addFee);
  const updateFee = useShop((state) => state.updateFee);
  const removeFee = useShop((state) => state.removeFee);
  const [name, setName] = useState("");
  const [amount, setAmount] = useState("0");
  const [error, setError] = useState("");

  return (
    <Shell>
      <div>
        <p className="text-sm font-semibold uppercase tracking-wide text-muted">Fixed operations</p>
        <h1 className="mt-1 font-display text-5xl leading-none tracking-tight">Fees</h1>
        <p className="mt-3 max-w-2xl text-muted">
          Misc shop fee is a percent of labor and parts, with a cap. Sales tax is added on every repair order. Open tickets pick up changes. Booked tickets keep the rate they closed with.
        </p>
      </div>

      <form className="card mt-5 grid max-w-md gap-2" onSubmit={(event) => event.preventDefault()}>
        <Field label="Sales tax">
          <label className="flex items-center gap-2">
            <CommitField
              label="Sales tax percent"
              value={String(taxRate)}
              kind="number"
              max={20}
              step={0.1}
              onCommit={(next) => updateSettings({ taxRate: Number(next) })}
            />
            <span className="text-sm text-muted">% of labor, parts, and fees</span>
          </label>
        </Field>
        <p className="text-sm text-muted">Starts at the 6.5% Washington state rate. Set the combined rate for this store. It is not part of the 110% estimate cap.</p>
      </form>

      <form
        className="card mt-5 grid gap-2 sm:grid-cols-3"
        onSubmit={(event) => {
          event.preventDefault();
          const parsed = Number(amount);
          if (!name.trim() || !Number.isFinite(parsed)) {
            setError("Need a name and an amount.");
            return;
          }
          const ok = addFee({ name: name.trim(), amount: parsed });
          if (!ok) {
            setError("That fee was not added.");
            return;
          }
          setName("");
          setAmount("0");
          setError("");
        }}
      >
        <Field label="Fee">
          <input className="field" maxLength={80} value={name} onChange={(event) => setName(event.target.value)} placeholder="Tire disposal" />
        </Field>
        <Field label="Amount">
          <input className="field tabular-nums" type="number" min={0} step={0.01} value={amount} onChange={(event) => setAmount(event.target.value)} />
        </Field>
        <div className="flex items-end">
          <Button tone="primary" type="submit">Add fee</Button>
        </div>
        {error ? <p className="text-sm text-primary sm:col-span-3">{error}</p> : null}
      </form>

      <div className="mt-4 overflow-x-auto card p-0">
        <table className="data-table min-w-[36rem]">
          <thead>
            <tr>
              <th>Fee</th>
              <th>Amount</th>
              <th>Cap</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {fees.length === 0 ? <tr><td colSpan={4} className="text-muted">No fees yet.</td></tr> : null}
            {fees.map((line) => (
              <tr key={line.id}>
                <td>
                  <CommitField label={`${line.name} name`} value={line.name} onCommit={(next) => updateFee(line.id, { name: next })} />
                </td>
                <td>
                  {line.basis === "percent" ? (
                    <label className="flex items-center gap-2">
                      <CommitField label={`${line.name} percent`} value={String(line.amount)} kind="number" max={100} step={0.1} onCommit={(next) => updateFee(line.id, { amount: Number(next) })} />
                      <span className="text-sm text-muted">% of repair</span>
                    </label>
                  ) : (
                    <CommitField label={`${line.name} amount`} value={String(line.amount)} kind="number" step={0.01} onCommit={(next) => updateFee(line.id, { amount: Number(next) })} />
                  )}
                </td>
                <td>
                  {line.basis === "percent" ? (
                    <CommitField label={`${line.name} cap`} value={String(line.cap)} kind="number" step={0.01} onCommit={(next) => updateFee(line.id, { cap: Number(next) })} />
                  ) : (
                    <span className="text-muted">—</span>
                  )}
                </td>
                <td>
                  <Button small onClick={() => removeFee(line.id)}>Remove</Button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="mt-3 max-w-2xl text-sm text-muted">
        {fees.filter((line) => line.basis === "percent").map((line) => `${line.name} is ${line.amount}% of labor and parts${line.cap > 0 ? `, capped at ${usd(line.cap, true)}` : ""}. `)}
        Flat fees add {usd(feeTotal(fees.filter((line) => line.basis !== "percent")), true)} before tax.
      </p>
    </Shell>
  );
}

/** Writes one change when the field is left, not on every keystroke. A blank field is left as it was. */
function CommitField({
  label,
  value,
  onCommit,
  kind = "text",
  max,
  step,
}: {
  label: string;
  value: string;
  onCommit: (next: string) => void;
  kind?: "text" | "number";
  max?: number;
  step?: number;
}) {
  const [draft, setDraft] = useState(value);
  useEffect(() => setDraft(value), [value]);
  return (
    <input
      className={kind === "number" ? "field w-32 tabular-nums" : "field"}
      aria-label={label}
      type={kind === "number" ? "number" : "text"}
      min={kind === "number" ? 0 : undefined}
      max={max}
      step={step}
      value={draft}
      onChange={(event) => setDraft(event.target.value)}
      onBlur={() => {
        const next = draft.trim();
        if (!next || next === value) {
          setDraft(value);
          return;
        }
        if (kind === "number" && !Number.isFinite(Number(next))) {
          setDraft(value);
          return;
        }
        onCommit(next);
      }}
    />
  );
}
