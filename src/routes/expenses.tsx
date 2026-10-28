import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { Shell } from "@/components/shell";
import { Button, Field, Meter } from "@/components/ui";
import { dayOfMonth, daysInMonth, monthName, ordinal, pct, today, usd } from "@/lib/format";
import { digest, lookups } from "@/lib/metrics";
import { useShop } from "@/lib/store";
import type { Department } from "@/lib/types";

export const Route = createFileRoute("/expenses")({ component: ExpensesPage });

function ExpensesPage() {
  const shop = useShop();
  const view = digest(shop);
  const look = lookups(shop);
  const [department, setDepartment] = useState<Department>("service");
  const [budgetId, setBudgetId] = useState("pol");
  const departmentBudgets = shop.budgets.filter((row) => row.department === department);
  const activeBudget = departmentBudgets.some((row) => row.id === budgetId) ? budgetId : (departmentBudgets[0]?.id ?? "");
  const [vendor, setVendor] = useState("");
  const [amount, setAmount] = useState("");
  const [note, setNote] = useState("");
  const rows = view.budgetRows.filter((row) => row.department === department);
  const txns = shop.expenses.filter((txn) => look.budget.get(txn.budgetId)?.department === department);

  return (
    <Shell>
      <p className="text-sm font-semibold uppercase tracking-wide text-muted">Fixed costs</p>
      <h1 className="mt-1 font-display text-5xl leading-none tracking-tight">What you can still change</h1>
      <p className="mt-3 max-w-2xl text-muted">
        Controllable expense against a pace budget — day {dayOfMonth()} of {daysInMonth()}, so {pct(view.pace)} of the month. Overhead underneath is mostly salaries and the building. It still decides absorption.
      </p>

      <section className="mt-5 grid gap-3 md:grid-cols-3">
        <article className="card">
          <p className="text-sm text-muted">Controllable, month to date</p>
          <p className="font-display text-4xl tabular-nums">{usd(view.controllable)}</p>
          <p className="text-sm text-muted">Pace budget {usd(view.budgetPace)} · full month {usd(view.budgetFull)}</p>
        </article>
        <article className="card">
          <p className="text-sm text-muted">Variance to pace</p>
          <p className={`font-display text-4xl tabular-nums ${view.controllable > view.budgetPace ? "text-primary" : "text-accent"}`}>
            {usd(view.controllable - view.budgetPace)}
          </p>
          <p className="text-sm text-muted">{view.controllable > view.budgetPace ? "Over the amount this date allows." : "Under the amount this date allows."}</p>
        </article>
        <article className="card">
          <p className="text-sm text-muted">Overhead accrued</p>
          <p className="font-display text-4xl tabular-nums">{usd(view.overheadAccrued)}</p>
          <p className="text-sm text-muted">Full month {usd(view.overheadFull)}</p>
        </article>
      </section>

      <div className="mt-5 flex gap-2">
        <Button small tone={department === "service" ? "primary" : "ghost"} onClick={() => setDepartment("service")}>Service</Button>
        <Button small tone={department === "parts" ? "primary" : "ghost"} onClick={() => setDepartment("parts")}>Parts</Button>
      </div>

      <div className="mt-3 grid gap-3">
        {rows.map((row) => {
          const over = row.variance > 50;
          return (
            <article key={row.id} className="card">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <h2 className="font-semibold">{row.category}</h2>
                <p className={`tabular-nums font-semibold ${over ? "text-primary" : "text-accent"}`}>
                  {usd(row.actual)} <span className="font-normal text-muted">/ {usd(row.pace)} pace</span>
                </p>
              </div>
              <div className="mt-2"><Meter value={Math.min(row.actual, Math.max(row.pace, 1))} max={Math.max(row.pace, 1)} bad={over} /></div>
              <div className="mt-3 flex flex-wrap items-end gap-3">
                <Field label="Full-month budget">
                  <input
                    className="field w-36 tabular-nums"
                    type="number"
                    min={0}
                    step={50}
                    value={row.monthly}
                    onChange={(event) => shop.setBudget(row.id, Number(event.target.value) || 0)}
                  />
                </Field>
                <p className="pb-2 text-sm text-muted">{over ? `${usd(row.variance)} over pace` : `${usd(Math.abs(row.variance))} under pace`}</p>
              </div>
            </article>
          );
        })}
      </div>

      <form
        className="card mt-4 grid gap-3 md:grid-cols-4"
        onSubmit={(event) => {
          event.preventDefault();
          const parsed = Number(amount);
          if (!vendor.trim() || !parsed || !activeBudget) return;
          shop.addExpense({ budgetId: activeBudget, date: today(), vendor: vendor.trim(), amount: parsed, note: note.trim() });
          setVendor("");
          setAmount("");
          setNote("");
        }}
      >
        <h2 className="font-display text-2xl leading-none md:col-span-4">Enter a bill</h2>
        <Field label="Category">
          <select className="field" value={activeBudget} onChange={(event) => setBudgetId(event.target.value)}>
            {departmentBudgets.length === 0 ? <option value="">No categories yet</option> : null}
            {departmentBudgets.map((row) => <option key={row.id} value={row.id}>{row.category}</option>)}
          </select>
        </Field>
        <Field label="Vendor"><input className="field" value={vendor} onChange={(event) => setVendor(event.target.value)} required /></Field>
        <Field label="Amount"><input className="field tabular-nums" type="number" min={0} step={0.01} value={amount} onChange={(event) => setAmount(event.target.value)} required /></Field>
        <Field label="Note"><input className="field" value={note} onChange={(event) => setNote(event.target.value)} /></Field>
        <div className="md:col-span-4"><Button tone="primary" type="submit" disabled={!activeBudget}>Post to {monthName()}</Button></div>
      </form>

      <div className="mt-4 overflow-x-auto card p-0">
        <table className="data-table min-w-[36rem]">
          <thead>
            <tr><th>Date</th><th>Category</th><th>Vendor</th><th>Amount</th><th></th></tr>
          </thead>
          <tbody>
            {txns.map((txn) => (
              <tr key={txn.id}>
                <td className="tabular-nums">{txn.date.slice(5)}</td>
                <td>{look.budget.get(txn.budgetId)?.category}</td>
                <td>{txn.vendor}<span className="block text-sm text-muted">{txn.note}</span></td>
                <td className="tabular-nums">{usd(txn.amount, true)}</td>
                <td><Button small onClick={() => shop.removeExpense(txn.id)}>Remove</Button></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <section className="mt-6">
        <h2 className="font-display text-3xl leading-none">Semi-fixed overhead</h2>
        <p className="mt-2 max-w-2xl text-sm text-muted">Counted at {pct(view.pace)} of the monthly amount so absorption is not punished for a full month of rent on the {ordinal(dayOfMonth())}. Edit the full-month figure.</p>
        <div className="mt-3 grid gap-3 md:grid-cols-2">
          {shop.overhead.map((line) => (
            <article key={line.id} className="card flex items-end justify-between gap-3">
              <Field label={line.name}>
                <input className="field tabular-nums" type="number" min={0} step={100} value={line.monthly} onChange={(event) => shop.setOverhead(line.id, Number(event.target.value) || 0)} />
              </Field>
              <p className="pb-3 text-sm tabular-nums text-muted">Accrued {usd(line.monthly * view.pace)}</p>
            </article>
          ))}
        </div>
      </section>
    </Shell>
  );
}
