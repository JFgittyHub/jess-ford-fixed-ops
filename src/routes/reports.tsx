import { createFileRoute } from "@tanstack/react-router";
import { Shell } from "@/components/shell";
import { Button } from "@/components/ui";
import { monthLabel, num, ordinal, dayOfMonth, pct, usd } from "@/lib/format";
import { digest } from "@/lib/metrics";
import { useShop } from "@/lib/store";

export const Route = createFileRoute("/reports")({ component: ReportsPage });

function moneyCell(value: number) {
  return <td className="tabular-nums text-right">{usd(value)}</td>;
}

function ReportsPage() {
  const shop = useShop();
  const view = digest(shop);
  const serviceControllable = view.budgetRows.filter((row) => row.department === "service").reduce((sum, row) => sum + row.actual, 0);
  const partsControllable = view.budgetRows.filter((row) => row.department === "parts").reduce((sum, row) => sum + row.actual, 0);

  return (
    <Shell>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-sm font-semibold uppercase tracking-wide text-muted">Month close</p>
          <h1 className="mt-1 font-display text-5xl leading-none tracking-tight">{shop.settings.storeName}</h1>
          <p className="mt-2 text-muted">{monthLabel()} · through the {ordinal(dayOfMonth())} · fixed operations only</p>
        </div>
        <Button className="no-print" onClick={() => window.print()}>Print pack</Button>
      </div>

      <section className="card mt-5 overflow-x-auto">
        <h2 className="font-display text-2xl leading-none">Fixed absorption statement</h2>
        <table className="data-table mt-3 min-w-[32rem]">
          <thead>
            <tr>
              <th>Line</th>
              <th className="text-right">Service</th>
              <th className="text-right">Parts</th>
              <th className="text-right">Fixed ops</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>Sales, closed repair orders</td>
              {moneyCell(view.laborSales)}
              {moneyCell(view.partsSales)}
              {moneyCell(view.laborSales + view.partsSales)}
            </tr>
            <tr>
              <td>Cost of sale</td>
              {moneyCell(view.laborCost)}
              {moneyCell(view.partsCost)}
              {moneyCell(view.laborCost + view.partsCost)}
            </tr>
            <tr>
              <td className="font-semibold">Gross</td>
              {moneyCell(view.laborGross)}
              {moneyCell(view.partsGross)}
              <td className="text-right font-semibold tabular-nums">{usd(view.fixedGross)}</td>
            </tr>
            <tr>
              <td>Controllable expense</td>
              {moneyCell(serviceControllable)}
              {moneyCell(partsControllable)}
              {moneyCell(view.controllable)}
            </tr>
            <tr>
              <td>Overhead accrued ({pct(view.pace)})</td>
              <td />
              <td />
              {moneyCell(view.overheadAccrued)}
            </tr>
            <tr>
              <td className="font-semibold">Left after expense</td>
              <td />
              <td />
              <td className="text-right font-semibold tabular-nums">{usd(view.fixedGross - view.totalExpense)}</td>
            </tr>
            <tr>
              <td className="font-semibold">Absorption</td>
              <td />
              <td />
              <td className="text-right font-semibold tabular-nums">{pct(view.absorption)}</td>
            </tr>
          </tbody>
        </table>
        <p className="mt-3 text-sm text-muted">
          Forecast if sales and controllable bills keep this pace, with a full month of overhead: {pct(view.forecastAbsorption)} on {usd(view.forecastGross)} gross and {usd(view.forecastExpense)} expense.
          Flat-rate technician pay is matched to closed repair orders. Hourly pay follows the clock, including work still open.
          Policy sits in controllable expense, not as a contra to customer-pay labor.
        </p>
      </section>

      <section className="mt-4 grid gap-3 md:grid-cols-3">
        <article className="card">
          <p className="text-sm text-muted">Customer pay</p>
          <p className="font-display text-3xl tabular-nums">{usd(view.laborCp)}</p>
          <p className="text-sm text-muted">{num(view.hoursCp, 1)} hours · rate {usd(view.elrCp)}</p>
        </article>
        <article className="card">
          <p className="text-sm text-muted">Warranty</p>
          <p className="font-display text-3xl tabular-nums">{usd(view.laborW)}</p>
          <p className="text-sm text-muted">{num(view.hoursW, 1)} hours</p>
        </article>
        <article className="card">
          <p className="text-sm text-muted">Internal</p>
          <p className="font-display text-3xl tabular-nums">{usd(view.laborI)}</p>
          <p className="text-sm text-muted">{num(view.hoursI, 1)} hours · {num(view.hoursPerRo, 2)} hours per closed RO</p>
        </article>
      </section>

      <section className="card mt-4 overflow-x-auto">
        <h2 className="font-display text-2xl leading-none">Advisors</h2>
        <table className="data-table mt-3 min-w-[36rem]">
          <thead>
            <tr>
              <th>Advisor</th>
              <th className="text-right">ROs</th>
              <th className="text-right">Hours</th>
              <th className="text-right">Hrs / RO</th>
              <th className="text-right">ELR</th>
              <th className="text-right">CP mix</th>
              <th className="text-right">Parts</th>
            </tr>
          </thead>
          <tbody>
            {view.advisorRows.map((row) => (
              <tr key={row.id}>
                <td className="font-semibold">{row.name}</td>
                <td className="text-right tabular-nums">{row.ros}</td>
                <td className="text-right tabular-nums">{num(row.hours, 1)}</td>
                <td className="text-right tabular-nums">{num(row.hoursPerRo, 2)}</td>
                <td className="text-right tabular-nums">{usd(row.elr)}</td>
                <td className="text-right tabular-nums">{pct(row.cpShare)}</td>
                <td className="text-right tabular-nums">{usd(row.partsSales)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section className="card mt-4 overflow-x-auto">
        <h2 className="font-display text-2xl leading-none">Technicians</h2>
        <table className="data-table mt-3 min-w-[40rem]">
          <thead>
            <tr>
              <th>Tech</th>
              <th>Pay</th>
              <th className="text-right">Flagged</th>
              <th className="text-right">Clocked</th>
              <th className="text-right">Eff.</th>
              <th className="text-right">Sold labor</th>
              <th className="text-right">Cost</th>
              <th className="text-right">Contribution</th>
            </tr>
          </thead>
          <tbody>
            {view.techRows.map((row) => (
              <tr key={row.id}>
                <td><span className="font-semibold">{row.name}</span><span className="block text-sm text-muted">{row.skill}</span></td>
                <td>{row.payStyle === "flat" ? "Flat" : "Hourly"}</td>
                <td className="text-right tabular-nums">{num(row.flagged, 1)}</td>
                <td className="text-right tabular-nums">{num(row.clocked, 1)}</td>
                <td className="text-right tabular-nums">{pct(row.efficiency)}</td>
                <td className="text-right tabular-nums">{usd(row.laborSales)}</td>
                <td className="text-right tabular-nums">{usd(row.laborCost)}</td>
                <td className="text-right tabular-nums">{usd(row.contribution)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </Shell>
  );
}
