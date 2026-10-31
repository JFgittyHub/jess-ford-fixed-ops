import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Shell } from "@/components/shell";
import { guardLocked } from "@/lib/locked-route";
import { Button, Field } from "@/components/ui";
import { displayRecordedWhen } from "@/lib/cancel";
import { useShop } from "@/lib/store";
import type { RoleChange } from "@/lib/types";

export const Route = createFileRoute("/service-managers")({ component: guardLocked(ServiceManagersPage) });

function ServiceManagersPage() {
  const shop = useShop();
  const addServiceManager = useShop((state) => state.addServiceManager);
  const updateServiceManager = useShop((state) => state.updateServiceManager);
  const removeServiceManager = useShop((state) => state.removeServiceManager);
  const [number, setNumber] = useState("");
  const [name, setName] = useState("");
  const [base, setBase] = useState("4200");
  const [laborPercent, setLaborPercent] = useState("5");
  const [partsPercent, setPartsPercent] = useState("2");
  const [error, setError] = useState("");
  const [pendingAdd, setPendingAdd] = useState<{ number: string; name: string; base: number; labor: number; parts: number } | null>(null);
  const managers = shop.serviceManagers ?? [];
  const activeCount = managers.filter((row) => row.active !== false).length;
  const ids = new Set(managers.map((row) => row.id));
  const changes = (shop.roleLog ?? []).filter((row) => ids.has(row.advisorId) || row.after === "service-manager" || row.before.startsWith("service-manager") || row.before === "service-manager");

  return (
    <Shell>
      <p className="text-sm font-semibold uppercase tracking-wide text-muted">Service managers</p>
      <h1 className="mt-1 font-display text-5xl leading-none tracking-tight">The desk</h1>
      <p className="mt-3 max-w-2xl text-muted">
        {activeCount === 0
          ? `Add the first service manager for ${shop.settings.storeName}. An advisor does that. A technician cannot. `
          : "Add a service manager, or change the number, name, pay plan, and whether they are active. "}
        Working as isn't a real sign-in yet.
      </p>

      <form
        className="card mt-5 grid gap-2 md:grid-cols-6"
        onSubmit={(event) => {
          event.preventDefault();
          const basePay = Number(base);
          const labor = Number(laborPercent);
          const parts = Number(partsPercent);
          if (!number.trim() || !name.trim() || !Number.isFinite(basePay) || !Number.isFinite(labor) || !Number.isFinite(parts)) {
            setError("Need a number, a name, and a pay plan.");
            return;
          }
          if (activeCount >= 1) {
            setPendingAdd({ number: number.trim(), name: name.trim(), base: basePay, labor, parts });
            setError("");
            return;
          }
          const result = addServiceManager({ number: number.trim(), name: name.trim(), base: basePay, laborPercent: labor, partsPercent: parts });
          if (!result.ok) {
            setError(result.error ?? "That service manager was not saved.");
            return;
          }
          setNumber("");
          setName("");
          setBase("4200");
          setLaborPercent("5");
          setPartsPercent("2");
          setError("");
        }}
      >
        <Field label="Manager #">
          <input className="field tabular-nums" value={number} onChange={(event) => setNumber(event.target.value)} placeholder="8" />
        </Field>
        <Field label="Name">
          <input className="field" value={name} onChange={(event) => setName(event.target.value)} placeholder="Derek Lang" />
        </Field>
        <Field label="Monthly base">
          <input className="field tabular-nums" type="number" min={0} step={1} value={base} onChange={(event) => setBase(event.target.value)} />
        </Field>
        <Field label="Labor %">
          <input className="field tabular-nums" type="number" min={0} step={0.1} value={laborPercent} onChange={(event) => setLaborPercent(event.target.value)} />
        </Field>
        <Field label="Parts %">
          <input className="field tabular-nums" type="number" min={0} step={0.1} value={partsPercent} onChange={(event) => setPartsPercent(event.target.value)} />
        </Field>
        <div className="flex items-end">
          <Button tone="primary" type="submit">Add service manager</Button>
        </div>
        {error ? <p role="alert" className="text-sm text-primary md:col-span-6">{error}</p> : null}
      </form>
      {pendingAdd ? (
        <section className="card mt-4 grid gap-2">
          <p>{secondServiceManagerWarning(shop.settings.storeName, [...managers.filter((row) => row.active !== false).map((row) => row.name), pendingAdd.name])}</p>
          <div className="flex flex-wrap gap-2">
            <Button type="button" tone="primary" onClick={() => {
              const result = addServiceManager({ number: pendingAdd.number, name: pendingAdd.name, base: pendingAdd.base, laborPercent: pendingAdd.labor, partsPercent: pendingAdd.parts });
              setPendingAdd(null);
              if (!result.ok) {
                setError(result.error ?? "That service manager was not saved.");
                return;
              }
              setNumber("");
              setName("");
              setBase("4200");
              setLaborPercent("5");
              setPartsPercent("2");
              setError("");
            }}>Continue</Button>
            <Button type="button" onClick={() => setPendingAdd(null)}>Cancel</Button>
          </div>
        </section>
      ) : null}

      <div className="mt-4 overflow-x-auto card p-0">
        <table className="data-table min-w-[48rem]">
          <thead>
            <tr>
              <th>Manager #</th>
              <th>Name</th>
              <th>Monthly base</th>
              <th>Labor %</th>
              <th>Parts %</th>
              <th>Active</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {managers.length === 0 ? (
              <tr>
                <td colSpan={7} className="text-muted">No service manager on this store yet.</td>
              </tr>
            ) : managers.map((manager) => (
              <tr key={manager.id}>
                <td>
                  <CommitField label={`${manager.name} number`} value={manager.number} className="field w-20 tabular-nums" onCommit={(value) => updateServiceManager(manager.id, { number: value }).ok} onReject={(message) => setError(message)} />
                </td>
                <td>
                  <CommitField label={`${manager.name} name`} value={manager.name} className="field" onCommit={(value) => updateServiceManager(manager.id, { name: value }).ok} onReject={(message) => setError(message)} />
                </td>
                <td>
                  <NumberCommit label={`${manager.name} base`} value={manager.base} className="field w-28 tabular-nums" onCommit={(value) => {
                    const result = updateServiceManager(manager.id, { base: value });
                    setError(result.ok ? "" : result.error ?? "");
                  }} />
                </td>
                <td>
                  <NumberCommit label={`${manager.name} labor percent`} value={manager.laborPercent} className="field w-24 tabular-nums" step={0.1} onCommit={(value) => {
                    const result = updateServiceManager(manager.id, { laborPercent: value });
                    setError(result.ok ? "" : result.error ?? "");
                  }} />
                </td>
                <td>
                  <NumberCommit label={`${manager.name} parts percent`} value={manager.partsPercent} className="field w-24 tabular-nums" step={0.1} onCommit={(value) => {
                    const result = updateServiceManager(manager.id, { partsPercent: value });
                    setError(result.ok ? "" : result.error ?? "");
                  }} />
                </td>
                <td>
                  <input
                    type="checkbox"
                    aria-label={`${manager.name} active`}
                    checked={manager.active !== false}
                    onChange={(event) => {
                      const result = updateServiceManager(manager.id, { active: event.target.checked });
                      setError(result.ok ? "" : result.error ?? "");
                    }}
                  />
                </td>
                <td>
                  <Button small onClick={() => {
                    const result = removeServiceManager(manager.id);
                    setError(result.ok ? "" : result.error ?? "That service manager was not removed.");
                  }}>Remove</Button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <section className="mt-4">
        <h2 className="font-display text-2xl leading-none">Service manager changes</h2>
        {changes.length === 0 ? <p className="mt-2 text-sm text-muted">No service manager changes on this store.</p> : (
          <ul className="mt-2 grid gap-1 text-sm">
            {changes.map((row) => <li key={`${row.at}-${row.advisorId}-${row.before}-${row.after}`}>{managerChangeLine(row, managers.find((item) => item.id === row.advisorId)?.name || row.advisorName || row.advisorId)}</li>)}
          </ul>
        )}
      </section>
    </Shell>
  );
}

export function secondServiceManagerWarning(storeName: string, names: string[]) {
  return `${storeName} will have ${names.length} service managers (${names.join(", ")}). Continue?`;
}

function managerChangeLine(row: RoleChange, name: string) {
  const when = displayRecordedWhen(row.at);
  const who = row.who || "Unnamed";
  if (row.after === "removed") return `${who} removed ${name}. Was ${row.before}. ${when}`;
  if (row.after === "service-manager") return `${who} added ${name} as service manager. ${when}`;
  return `${who} changed ${name} from ${row.before} to ${row.after}. ${when}`;
}

function NumberCommit({
  label,
  value,
  className,
  step = 1,
  onCommit,
}: {
  label: string;
  value: number;
  className: string;
  step?: number;
  onCommit: (value: number) => void;
}) {
  const [draft, setDraft] = useState(String(value));
  useEffect(() => setDraft(String(value)), [value]);
  return (
    <input
      className={className}
      aria-label={label}
      type="number"
      min={0}
      step={step}
      value={draft}
      onChange={(event) => setDraft(event.target.value)}
      onBlur={() => onCommit(Number(draft) || 0)}
    />
  );
}

function CommitField({
  label,
  value,
  className,
  onCommit,
  onReject,
}: {
  label: string;
  value: string;
  className: string;
  onCommit: (value: string) => boolean;
  onReject: (message: string) => void;
}) {
  const [draft, setDraft] = useState(value);
  useEffect(() => setDraft(value), [value]);
  return (
    <input
      className={className}
      aria-label={label}
      value={draft}
      onChange={(event) => setDraft(event.target.value)}
      onBlur={() => {
        if (draft.trim() === value) return;
        const ok = onCommit(draft);
        if (!ok) {
          setDraft(value);
          onReject("That service manager change was not saved.");
        }
      }}
    />
  );
}
