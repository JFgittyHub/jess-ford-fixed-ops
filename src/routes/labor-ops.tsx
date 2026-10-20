import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { Shell } from "@/components/shell";
import { Button, Field } from "@/components/ui";
import { usd } from "@/lib/format";
import { rateFor } from "@/lib/pay";
import { useShop } from "@/lib/store";

export const Route = createFileRoute("/labor-ops")({ component: LaborOpsPage });

function LaborOpsPage() {
  const laborOps = useShop((state) => state.laborOps);
  const payTypes = useShop((state) => state.payTypes);
  const updateLaborOp = useShop((state) => state.updateLaborOp);
  const addLaborOp = useShop((state) => state.addLaborOp);
  const removeLaborOp = useShop((state) => state.removeLaborOp);
  const [query, setQuery] = useState("");
  const [opcode, setOpcode] = useState("");
  const [description, setDescription] = useState("");
  const [hours, setHours] = useState("1.0");
  const [pay, setPay] = useState("cp");
  const [error, setError] = useState("");

  const q = query.trim().toLowerCase();
  const rows = laborOps
    .filter((op) => !q || `${op.opcode} ${op.description}`.toLowerCase().includes(q))
    .slice()
    .sort((a, b) => a.opcode.localeCompare(b.opcode));

  return (
    <Shell>
      <div>
        <p className="text-sm font-semibold uppercase tracking-wide text-muted">Fixed operations</p>
        <h1 className="mt-1 font-display text-5xl leading-none tracking-tight">Labor ops</h1>
        <p className="mt-3 max-w-2xl text-muted">
          The book every repair order sells from. Change an op here and the next ticket uses it. Lines already written stay as they were.
        </p>
      </div>

      <div className="mt-5 flex flex-wrap gap-2">
        <input
          className="field max-w-xs"
          placeholder="Search op or description"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          aria-label="Search labor ops"
        />
      </div>

      <form
        className="card mt-4 grid gap-2 sm:grid-cols-6"
        onSubmit={(event) => {
          event.preventDefault();
          const code = opcode.trim().toUpperCase();
          const parsed = Number(hours);
          if (!code || !description.trim() || !parsed) {
            setError("Need an op code, a description, and hours.");
            return;
          }
          if (laborOps.some((op) => op.opcode.toUpperCase() === code)) {
            setError(`${code} is already in the book.`);
            return;
          }
          addLaborOp({ opcode: code, description: description.trim(), hours: parsed, payType: pay });
          setOpcode("");
          setDescription("");
          setHours("1.0");
          setPay("cp");
          setError("");
        }}
      >
        <Field label="Op code">
          <input className="field" value={opcode} onChange={(event) => setOpcode(event.target.value.toUpperCase())} placeholder="LOF" />
        </Field>
        <div className="sm:col-span-2">
          <Field label="Description">
            <input className="field" value={description} onChange={(event) => setDescription(event.target.value)} placeholder="What the tech flags" />
          </Field>
        </div>
        <Field label="Hours">
          <input className="field tabular-nums" type="number" min={0.1} step={0.1} value={hours} onChange={(event) => setHours(event.target.value)} />
        </Field>
        <Field label="Pay">
          <select className="field" value={pay} onChange={(event) => setPay(event.target.value)}>
            {payTypes.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
          </select>
        </Field>
        <div className="flex items-end">
          <Button tone="primary" type="submit">Add op</Button>
        </div>
        {error ? <p className="sm:col-span-6 text-sm text-primary">{error}</p> : null}
      </form>

      <div className="mt-4 overflow-x-auto card p-0">
        <table className="data-table min-w-[40rem]">
          <thead>
            <tr>
              <th>Op</th>
              <th>Description</th>
              <th>Hours</th>
              <th>Pay</th>
              <th>Labor sale</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr><td colSpan={6} className="text-muted">No labor ops match.</td></tr>
            ) : null}
            {rows.map((op) => (
              <tr key={op.id}>
                <td>
                  <input
                    className="field w-24"
                    aria-label={`${op.opcode} code`}
                    value={op.opcode}
                    onChange={(event) => updateLaborOp(op.id, { opcode: event.target.value.toUpperCase() })}
                    onBlur={() => {
                      const trimmed = op.opcode.trim();
                      if (trimmed !== op.opcode) updateLaborOp(op.id, { opcode: trimmed });
                    }}
                  />
                </td>
                <td>
                  <input
                    className="field"
                    aria-label={`${op.opcode} description`}
                    value={op.description}
                    onChange={(event) => updateLaborOp(op.id, { description: event.target.value })}
                  />
                </td>
                <td>
                  <input
                    className="field w-24 tabular-nums"
                    aria-label={`${op.opcode} hours`}
                    type="number"
                    min={0}
                    step={0.1}
                    value={op.hours}
                    onChange={(event) => updateLaborOp(op.id, { hours: Number(event.target.value) || 0 })}
                  />
                </td>
                <td>
                  <select
                    className="field"
                    aria-label={`${op.opcode} pay`}
                    value={op.payType}
                    onChange={(event) => updateLaborOp(op.id, { payType: event.target.value })}
                  >
                    {payTypes.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
                  </select>
                </td>
                <td className="tabular-nums">{usd(op.hours * rateFor(op.payType, payTypes), true)}</td>
                <td>
                  <Button small onClick={() => removeLaborOp(op.id)}>Remove</Button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Shell>
  );
}
