import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { Shell } from "@/components/shell";
import { guardLocked } from "@/lib/locked-route";
import { Button, Field, Pill } from "@/components/ui";
import { daySpan, today, usd } from "@/lib/format";
import { digest } from "@/lib/metrics";
import { useShop } from "@/lib/store";

export const Route = createFileRoute("/parts")({ component: guardLocked(PartsPage) });

function PartsPage() {
  const shop = useShop();
  const view = digest(shop);
  const [query, setQuery] = useState("");
  const [agedOnly, setAgedOnly] = useState(false);
  const [adding, setAdding] = useState(false);
  const [number, setNumber] = useState("");
  const [description, setDescription] = useState("");
  const [bin, setBin] = useState("A-01");
  const [cost, setCost] = useState("10");
  const [list, setList] = useState("25");
  const [onHand, setOnHand] = useState("1");

  const rows = shop.parts.filter((part) => {
    if (agedOnly && !(part.onHand > 0 && daySpan(part.lastSale) >= 120)) return false;
    const hay = `${part.number} ${part.description} ${part.bin}`.toLowerCase();
    return hay.includes(query.trim().toLowerCase());
  }).sort((a, b) => (b.onHand * b.cost) - (a.onHand * a.cost));

  return (
    <Shell>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-sm font-semibold uppercase tracking-wide text-muted">Parts</p>
          <h1 className="mt-1 font-display text-5xl leading-none tracking-tight">Cash on the shelf</h1>
          <p className="mt-3 max-w-2xl text-muted">
            {usd(view.agedCash)} in {view.agedCount} part numbers with no sale in 120 days. Sample costs, not the Ford price book. On-hand drops when an advisor closes a repair order.
          </p>
        </div>
        <Button tone="primary" onClick={() => setAdding((value) => !value)}>{adding ? "Close" : "Add part"}</Button>
      </div>

      <div className="mt-4 grid gap-3 sm:grid-cols-3">
        <article className="card"><p className="text-sm text-muted">Parts gross, closed</p><p className="font-display text-4xl tabular-nums">{usd(view.partsGross)}</p></article>
        <article className="card"><p className="text-sm text-muted">Margin</p><p className="font-display text-4xl tabular-nums">{Math.round(view.partsMargin * 100)}%</p></article>
        <article className="card"><p className="text-sm text-muted">Dead stock at cost</p><p className="font-display text-4xl tabular-nums text-primary">{usd(view.agedCash)}</p></article>
      </div>

      {adding ? (
        <form
          className="card mt-4 grid gap-3 md:grid-cols-3"
          onSubmit={(event) => {
            event.preventDefault();
            if (!number.trim() || !description.trim()) return;
            shop.addSku({
              number: number.trim(),
              description: description.trim(),
              bin,
              onHand: Number(onHand) || 0,
              onOrder: 0,
              cost: Number(cost) || 0,
              list: Number(list) || 0,
              lastSale: today(),
              source: "Other",
            });
            setNumber("");
            setDescription("");
            setAdding(false);
          }}
        >
          <Field label="Number"><input className="field" value={number} onChange={(event) => setNumber(event.target.value)} required /></Field>
          <div className="md:col-span-2"><Field label="Description"><input className="field" value={description} onChange={(event) => setDescription(event.target.value)} required /></Field></div>
          <Field label="Bin"><input className="field" value={bin} onChange={(event) => setBin(event.target.value)} /></Field>
          <Field label="Cost"><input className="field tabular-nums" type="number" min={0} step={0.01} value={cost} onChange={(event) => setCost(event.target.value)} /></Field>
          <Field label="List"><input className="field tabular-nums" type="number" min={0} step={0.01} value={list} onChange={(event) => setList(event.target.value)} /></Field>
          <Field label="On hand"><input className="field tabular-nums" type="number" min={0} step={1} value={onHand} onChange={(event) => setOnHand(event.target.value)} /></Field>
          <div className="md:col-span-3"><Button tone="primary" type="submit">Save to inventory</Button></div>
        </form>
      ) : null}

      <div className="mt-4 flex flex-wrap gap-2">
        <input className="field max-w-xs" placeholder="Search number or bin" value={query} onChange={(event) => setQuery(event.target.value)} aria-label="Search parts" />
        <Button small tone={agedOnly ? "primary" : "ghost"} onClick={() => setAgedOnly((value) => !value)}>120 days or older</Button>
      </div>

      <div className="mt-3 overflow-x-auto card p-0">
        <table className="data-table min-w-[46rem]">
          <thead>
            <tr>
              <th>Part</th>
              <th>Bin</th>
              <th>On hand</th>
              <th>Cost ext.</th>
              <th>Last sale</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((part) => {
              const aged = part.onHand > 0 && daySpan(part.lastSale) >= 120;
              return (
                <tr key={part.id}>
                  <td>
                    <span className="block font-semibold">{part.number}</span>
                    <span className="block text-sm text-muted">{part.description}</span>
                    {aged ? <Pill tone="bad">No sale in {daySpan(part.lastSale)} days</Pill> : null}
                  </td>
                  <td>{part.bin}</td>
                  <td>
                    <input
                      className="field w-24 tabular-nums"
                      type="number"
                      min={0}
                      aria-label={`On hand ${part.number}`}
                      value={part.onHand}
                      onChange={(event) => shop.setOnHand(part.id, Number(event.target.value) || 0)}
                    />
                    {part.onHand < 0 ? <Pill tone="bad">Oversold</Pill> : null}
                    {part.onOrder > 0 ? <span className="mt-1 block text-xs text-muted">{part.onOrder} on order</span> : null}
                  </td>
                  <td className="tabular-nums">{usd(part.onHand * part.cost)}</td>
                  <td className="tabular-nums">{part.lastSale}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </Shell>
  );
}
