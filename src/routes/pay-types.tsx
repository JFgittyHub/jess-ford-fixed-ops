import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { Shell } from "@/components/shell";
import { Button, Field } from "@/components/ui";
import { KIND_LABEL } from "@/lib/pay";
import { useShop } from "@/lib/store";
import type { PayKind } from "@/lib/types";

export const Route = createFileRoute("/pay-types")({ component: PayTypesPage });

const KINDS: PayKind[] = ["customer", "warranty", "internal"];

function PayTypesPage() {
  const payTypes = useShop((state) => state.payTypes);
  const addPayType = useShop((state) => state.addPayType);
  const updatePayType = useShop((state) => state.updatePayType);
  const removePayType = useShop((state) => state.removePayType);
  const [name, setName] = useState("");
  const [rate, setRate] = useState("189");
  const [kind, setKind] = useState<PayKind>("customer");
  const [error, setError] = useState("");

  return (
    <Shell>
      <div>
        <p className="text-sm font-semibold uppercase tracking-wide text-muted">Fixed operations</p>
        <h1 className="mt-1 font-display text-5xl leading-none tracking-tight">Pay types</h1>
        <p className="mt-3 max-w-2xl text-muted">
          Each pay type has its own labor rate. A new labor line uses that rate. Lines already on a ticket keep the rate they were written at. Customer pay counts against the door rate. Warranty and internal roll into those columns on month close.
        </p>
      </div>

      <form
        className="card mt-5 grid gap-2 sm:grid-cols-4"
        onSubmit={(event) => {
          event.preventDefault();
          const parsed = Number(rate);
          if (!name.trim() || !Number.isFinite(parsed)) {
            setError("Need a name and a labor rate.");
            return;
          }
          const ok = addPayType({ name: name.trim(), rate: parsed, kind });
          if (!ok) {
            setError("That pay type was not added.");
            return;
          }
          setName("");
          setRate("189");
          setKind("customer");
          setError("");
        }}
      >
        <Field label="Name">
          <input className="field" value={name} onChange={(event) => setName(event.target.value)} placeholder="Service contract" />
        </Field>
        <Field label="Labor rate">
          <input className="field tabular-nums" type="number" min={0} step={1} value={rate} onChange={(event) => setRate(event.target.value)} />
        </Field>
        <Field label="Counts as">
          <select className="field" value={kind} onChange={(event) => setKind(event.target.value as PayKind)}>
            {KINDS.map((item) => <option key={item} value={item}>{KIND_LABEL[item]}</option>)}
          </select>
        </Field>
        <div className="flex items-end">
          <Button tone="primary" type="submit">Add pay type</Button>
        </div>
        {error ? <p className="text-sm text-primary sm:col-span-4">{error}</p> : null}
      </form>

      <div className="mt-4 overflow-x-auto card p-0">
        <table className="data-table min-w-[36rem]">
          <thead>
            <tr>
              <th>Pay type</th>
              <th>Labor rate</th>
              <th>Counts as</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {payTypes.map((row) => (
              <tr key={row.id}>
                <td>
                  <input
                    className="field"
                    aria-label={`${row.name} name`}
                    value={row.name}
                    onChange={(event) => updatePayType(row.id, { name: event.target.value })}
                  />
                </td>
                <td>
                    <input
                      className="field w-28 tabular-nums"
                      aria-label={`${row.name} labor rate`}
                      type="number"
                      min={0}
                      step={1}
                      value={row.rate}
                      onChange={(event) => updatePayType(row.id, { rate: Number(event.target.value) || 0 })}
                    />
                </td>
                <td>
                  <select
                    className="field"
                    aria-label={`${row.name} counts as`}
                    value={row.kind}
                    onChange={(event) => updatePayType(row.id, { kind: event.target.value as PayKind })}
                  >
                    {KINDS.map((item) => <option key={item} value={item}>{KIND_LABEL[item]}</option>)}
                  </select>
                </td>
                <td>
                  <Button
                    small
                    onClick={() => {
                      const result = removePayType(row.id);
                      setError(
                        result === "ok"
                          ? ""
                          : result === "last"
                            ? "Keep at least one pay type."
                            : `${row.name} is still on a labor op or a repair order.`,
                      );
                    }}
                  >
                    Remove
                  </Button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Shell>
  );
}
