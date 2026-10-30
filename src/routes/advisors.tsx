import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Shell } from "@/components/shell";
import { Button, Field } from "@/components/ui";
import { displayRecordedWhen } from "@/lib/cancel";
import { dayOfMonth, daysInMonth, usd } from "@/lib/format";
import { isSold, orderMoney } from "@/lib/metrics";
import { useShop } from "@/lib/store";

export const Route = createFileRoute("/advisors")({ component: AdvisorsPage });

function AdvisorsPage() {
  const shop = useShop();
  const addAdvisor = useShop((state) => state.addAdvisor);
  const updateAdvisor = useShop((state) => state.updateAdvisor);
  const removeAdvisor = useShop((state) => state.removeAdvisor);
  const appointFirstServiceManager = useShop((state) => state.appointFirstServiceManager);
  const [number, setNumber] = useState("");
  const [name, setName] = useState("");
  const [base, setBase] = useState("4200");
  const [laborPercent, setLaborPercent] = useState("5");
  const [partsPercent, setPartsPercent] = useState("2");
  const [role, setRole] = useState<"advisor" | "service-manager">("advisor");
  const [error, setError] = useState("");
  const [setupId, setSetupId] = useState("");
  const [pendingSm, setPendingSm] = useState<{ id: string; names: string[] } | null>(null);
  const managers = shop.advisors.filter((advisor) => advisor.role === "service-manager");
  const managerCount = managers.length;
  const pace = dayOfMonth() / daysInMonth();
  const sold = shop.orders.filter(isSold);

  return (
    <Shell>
      <p className="text-sm font-semibold uppercase tracking-wide text-muted">Advisors</p>
      <h1 className="mt-1 font-display text-5xl leading-none tracking-tight">The drive</h1>
      <p className="mt-3 max-w-2xl text-muted">
        Add an advisor, or change the number, name, and pay plan. An advisor is chosen on the ticket. There is no advisor password.
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
          const ok = addAdvisor({ number: number.trim(), name: name.trim(), base: basePay, laborPercent: labor, partsPercent: parts, role });
          if (!ok) {
            setError("That advisor number is already on the drive.");
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
        <Field label="Advisor #">
          <input className="field tabular-nums" value={number} onChange={(event) => setNumber(event.target.value)} placeholder="12" />
        </Field>
        <Field label="Name">
          <input className="field" value={name} onChange={(event) => setName(event.target.value)} placeholder="Alex Rivera" />
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
        <Field label="Role">
          <select className="field" aria-label="New advisor role" value={role} onChange={(event) => setRole(event.target.value === "service-manager" ? "service-manager" : "advisor")}>
            <option value="advisor">Advisor</option>
            <option value="service-manager">Service manager</option>
          </select>
        </Field>
        <div className="flex items-end">
          <Button tone="primary" type="submit">Add advisor</Button>
        </div>
        {error ? <p className="text-sm text-primary md:col-span-6">{error}</p> : null}
      </form>

      {managerCount === 0 ? (
        <section className="card mt-4 grid gap-2">
          <h2 className="font-display text-2xl leading-none">Store setup</h2>
          <p className="text-sm text-muted">Choose the service manager for {shop.settings.storeName}. An advisor does this once. Working as isn't a real sign-in yet.</p>
          <label className="label">
            Advisor
            <select className="field max-w-sm" aria-label="First service manager" value={setupId || shop.advisors[0]?.id || ""} onChange={(event) => setSetupId(event.target.value)}>
              {shop.advisors.map((advisor) => <option key={advisor.id} value={advisor.id}>{advisor.name}</option>)}
            </select>
          </label>
          <div>
            <Button type="button" tone="primary" onClick={() => {
              const result = appointFirstServiceManager(setupId || shop.advisors[0]?.id || "");
              setError(result.ok ? "" : result.error ?? "That service manager was not saved.");
            }}>Set the service manager</Button>
          </div>
        </section>
      ) : null}
      {pendingSm ? (
        <section className="card mt-4 grid gap-2">
          <p>{shop.settings.storeName} will have {pendingSm.names.length} service managers ({pendingSm.names.join(", ")}). Continue?</p>
          <div className="flex flex-wrap gap-2">
            <Button type="button" tone="primary" onClick={() => {
              const ok = updateAdvisor(pendingSm.id, { role: "service-manager" });
              setPendingSm(null);
              setError(ok ? "" : "That role was not saved.");
            }}>Continue</Button>
            <Button type="button" onClick={() => setPendingSm(null)}>Cancel</Button>
          </div>
        </section>
      ) : null}

      <div className="mt-4 overflow-x-auto card p-0">
        <table className="data-table min-w-[48rem]">
          <thead>
            <tr>
              <th>Advisor #</th>
              <th>Name</th>
              <th>Monthly base</th>
              <th>Labor %</th>
              <th>Parts %</th>
              <th>Role</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {shop.advisors.map((advisor) => (
              <tr key={advisor.id}>
                <td>
                  <CommitField label={`${advisor.name} number`} value={advisor.number} className="field w-20 tabular-nums" onCommit={(value) => updateAdvisor(advisor.id, { number: value })} onReject={() => setError("Advisor numbers have to stay unique.")} />
                </td>
                <td>
                  <CommitField label={`${advisor.name} name`} value={advisor.name} className="field" onCommit={(value) => updateAdvisor(advisor.id, { name: value })} onReject={() => setError("An advisor needs a name.")} />
                </td>
                <td>
                  <input className="field w-28 tabular-nums" aria-label={`${advisor.name} base`} type="number" min={0} step={1} value={advisor.base} onChange={(event) => updateAdvisor(advisor.id, { base: Number(event.target.value) || 0 })} />
                </td>
                <td>
                  <input className="field w-24 tabular-nums" aria-label={`${advisor.name} labor percent`} type="number" min={0} step={0.1} value={advisor.laborPercent} onChange={(event) => updateAdvisor(advisor.id, { laborPercent: Number(event.target.value) || 0 })} />
                </td>
                <td>
                  <input className="field w-24 tabular-nums" aria-label={`${advisor.name} parts percent`} type="number" min={0} step={0.1} value={advisor.partsPercent} onChange={(event) => updateAdvisor(advisor.id, { partsPercent: Number(event.target.value) || 0 })} />
                </td>
                <td>
                  <select
                    className="field"
                    aria-label={`${advisor.name} role`}
                    value={advisor.role === "service-manager" ? "service-manager" : "advisor"}
                    onChange={(event) => {
                      const next = event.target.value === "service-manager" ? "service-manager" : "advisor";
                      if (next === "service-manager" && advisor.role !== "service-manager" && managerCount >= 1) {
                        setPendingSm({ id: advisor.id, names: [...managers.map((row) => row.name), advisor.name] });
                        return;
                      }
                      const ok = updateAdvisor(advisor.id, { role: next });
                      if (ok) {
                        setError("");
                        return;
                      }
                      if (advisor.role === "service-manager" && next === "advisor" && managerCount === 1) {
                        setError(`${shop.settings.storeName} needs at least one service manager.`);
                        return;
                      }
                      setError(managerCount === 0 ? "That role was not saved." : "Only a service manager can change a role.");
                    }}
                  >
                    <option value="advisor">Advisor</option>
                    <option value="service-manager">Service manager</option>
                  </select>
                </td>
                <td>
                  <Button small onClick={() => {
                    const result = removeAdvisor(advisor.id);
                    setError(result === "ok" ? "" : result === "last" ? "The last service manager stays on the drive." : result === "role" ? "Only a service manager can remove an advisor." : `${advisor.name} is still on a repair order or appointment.`);
                  }}>Remove</Button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <section className="mt-4">
        <h2 className="font-display text-2xl leading-none">Role changes</h2>
        {(shop.roleLog ?? []).length === 0 ? <p className="mt-2 text-sm text-muted">No role changes on this store.</p> : (
          <ul className="mt-2 grid gap-1 text-sm">
            {(shop.roleLog ?? []).map((row) => {
              const named = shop.advisors.find((advisor) => advisor.id === row.advisorId)?.name;
              const when = displayRecordedWhen(row.at);
              const subject = named ?? row.advisorId;
              const line = row.after === "removed"
                ? `${row.who || "Unnamed"} removed ${subject}.`
                : row.after === "service-manager"
                  ? `${row.who || "Unnamed"} made ${subject} service manager.`
                  : row.before === "service-manager"
                    ? `${row.who || "Unnamed"} changed ${subject} from service manager to advisor.`
                    : named
                      ? `${row.who || "Unnamed"} changed ${subject} from ${row.before} to ${row.after}.`
                      : `${row.who || "Unnamed"} renamed ${row.before} to ${row.after}.`;
              return <li key={`${row.at}-${row.advisorId}-${row.after}`}>{line} {when}</li>;
            })}
          </ul>
        )}
      </section>

      <div className="mt-4 grid gap-3 lg:grid-cols-2">
        {shop.advisors.map((advisor) => {
          const mine = sold.filter((order) => order.advisorId === advisor.id);
          const openCount = shop.orders.filter((order) => order.advisorId === advisor.id && order.status !== "closed").length;
          const laborSales = mine.reduce((sum, order) => sum + orderMoney(order).labor, 0);
          const partsSales = mine.reduce((sum, order) => sum + orderMoney(order).parts, 0);
          const basePay = advisor.base * pace;
          const laborPay = laborSales * (advisor.laborPercent / 100);
          const partsPay = partsSales * (advisor.partsPercent / 100);
          return (
            <article key={advisor.id} className="card">
              <h2 className="font-display text-3xl leading-none">#{advisor.number} {advisor.name}</h2>
              <p className="mt-1 text-sm text-muted">{mine.length} closed · {openCount} still open</p>
              <dl className="mt-4 grid grid-cols-2 gap-x-4 gap-y-2 text-sm sm:grid-cols-3">
                <div><dt className="text-muted">Labor sales</dt><dd className="tabular-nums font-semibold">{usd(laborSales)}</dd></div>
                <div><dt className="text-muted">Parts sales</dt><dd className="tabular-nums font-semibold">{usd(partsSales)}</dd></div>
                <div><dt className="text-muted">Total sales</dt><dd className="tabular-nums font-semibold">{usd(laborSales + partsSales)}</dd></div>
                <div><dt className="text-muted">Base to date</dt><dd className="tabular-nums font-semibold">{usd(basePay)}</dd></div>
                <div><dt className="text-muted">Labor commission</dt><dd className="tabular-nums font-semibold">{usd(laborPay)}</dd></div>
                <div><dt className="text-muted">Parts commission</dt><dd className="tabular-nums font-semibold">{usd(partsPay)}</dd></div>
              </dl>
              <p className="mt-3 text-sm">Pay plan through today <span className="tabular-nums font-semibold">{usd(basePay + laborPay + partsPay)}</span></p>
            </article>
          );
        })}
      </div>
    </Shell>
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
  onReject: () => void;
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
          onReject();
        }
      }}
    />
  );
}
