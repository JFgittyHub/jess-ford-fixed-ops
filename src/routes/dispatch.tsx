import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Shell } from "@/components/shell";
import { guardLocked } from "@/lib/locked-route";
import { Button, Field, Meter, Pill } from "@/components/ui";
import { pct, usd } from "@/lib/format";
import { digest } from "@/lib/metrics";
import { useShop } from "@/lib/store";
import type { PayStyle, Skill, TechBoard } from "@/lib/types";

export const Route = createFileRoute("/dispatch")({ component: guardLocked(DispatchPage) });

const SKILLS: { id: Skill; label: string }[] = [
  { id: "master", label: "Master" },
  { id: "a", label: "A" },
  { id: "b", label: "B" },
  { id: "diesel", label: "Diesel" },
  { id: "express", label: "Express" },
  { id: "quick", label: "Quick" },
];

const BOARDS: { id: TechBoard; label: string }[] = [
  { id: "express", label: "Express" },
  { id: "main", label: "Main shop" },
  { id: "internal", label: "Internals" },
  { id: "none", label: "Off the board" },
];

function skillLabel(skill: Skill) {
  return SKILLS.find((row) => row.id === skill)?.label ?? skill;
}

function DispatchPage() {
  const shop = useShop();
  const view = digest(shop);
  const addTech = useShop((state) => state.addTech);
  const updateTech = useShop((state) => state.updateTech);
  const removeTech = useShop((state) => state.removeTech);
  const [number, setNumber] = useState("");
  const [name, setName] = useState("");
  const [skill, setSkill] = useState<Skill>("b");
  const [payStyle, setPayStyle] = useState<PayStyle>("flat");
  const [rate, setRate] = useState("28");
  const [error, setError] = useState("");

  return (
    <Shell>
      <p className="text-sm font-semibold uppercase tracking-wide text-muted">Technicians</p>
      <h1 className="mt-1 font-display text-5xl leading-none tracking-tight">The roster</h1>
      <p className="mt-3 max-w-2xl text-muted">
        Add a technician, or change the name, tech number, and skill. The tech board asks who is working. There is no tech password.
      </p>

      <form
        className="card mt-5 grid gap-2 md:grid-cols-6"
        onSubmit={(event) => {
          event.preventDefault();
          const parsed = Number(rate);
          if (!number.trim() || !name.trim() || !Number.isFinite(parsed)) {
            setError("Need a tech number, a name, and a rate.");
            return;
          }
          const ok = addTech({
            number: number.trim(),
            name: name.trim(),
            skill,
            payStyle,
            flagRate: parsed,
            hourlyRate: parsed,
            board: "none",
          });
          if (!ok) {
            setError("That tech number is already on the roster.");
            return;
          }
          setNumber("");
          setName("");
          setSkill("b");
          setPayStyle("flat");
          setRate("28");
          setError("");
        }}
      >
        <Field label="Tech #">
          <input className="field tabular-nums" value={number} onChange={(event) => setNumber(event.target.value)} placeholder="12" />
        </Field>
        <div className="md:col-span-2">
          <Field label="Name">
            <input className="field" value={name} onChange={(event) => setName(event.target.value)} placeholder="Alex Rivera" />
          </Field>
        </div>
        <Field label="Skill">
          <select className="field" value={skill} onChange={(event) => setSkill(event.target.value as Skill)}>
            {SKILLS.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}
          </select>
        </Field>
        <Field label="Pay">
          <select className="field" value={payStyle} onChange={(event) => setPayStyle(event.target.value as PayStyle)}>
            <option value="flat">Flat rate</option>
            <option value="hourly">Hourly</option>
          </select>
        </Field>
        <Field label="Rate">
          <input className="field tabular-nums" type="number" min={0} step={1} value={rate} onChange={(event) => setRate(event.target.value)} />
        </Field>
        <div className="flex items-end">
          <Button tone="primary" type="submit">Add technician</Button>
        </div>
        {error ? <p className="text-sm text-primary md:col-span-6">{error}</p> : null}
      </form>

      <div className="mt-4 overflow-x-auto card p-0">
        <table className="data-table min-w-[48rem]">
          <thead>
            <tr>
              <th>Tech #</th>
              <th>Name</th>
              <th>Skill</th>
              <th>Schedule</th>
              <th>Pay</th>
              <th>Rate</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {shop.techs.map((tech) => (
              <tr key={tech.id}>
                <td>
                  <CommitField label={`${tech.name} number`} value={tech.number} className="field w-20 tabular-nums" onCommit={(value) => updateTech(tech.id, { number: value })} onReject={() => setError("Tech numbers have to stay unique.")} />
                </td>
                <td>
                  <CommitField label={`${tech.name} name`} value={tech.name} className="field" onCommit={(value) => updateTech(tech.id, { name: value })} onReject={() => setError("A technician needs a name.")} />
                </td>
                <td>
                  <select className="field" aria-label={`${tech.name} skill`} value={tech.skill} onChange={(event) => updateTech(tech.id, { skill: event.target.value as Skill })}>
                    {SKILLS.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}
                  </select>
                </td>
                <td>
                  <select className="field" aria-label={`${tech.name} schedule`} value={tech.board ?? "main"} onChange={(event) => updateTech(tech.id, { board: event.target.value as TechBoard })}>
                    {BOARDS.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}
                  </select>
                </td>
                <td>
                  <select className="field" aria-label={`${tech.name} pay`} value={tech.payStyle} onChange={(event) => updateTech(tech.id, { payStyle: event.target.value as PayStyle })}>
                    <option value="flat">Flat rate</option>
                    <option value="hourly">Hourly</option>
                  </select>
                </td>
                <td>
                  <input
                    className="field w-24 tabular-nums"
                    aria-label={`${tech.name} rate`}
                    type="number"
                    min={0}
                    step={1}
                    value={tech.payStyle === "flat" ? tech.flagRate : tech.hourlyRate}
                    onChange={(event) => {
                      const next = Number(event.target.value) || 0;
                      updateTech(tech.id, tech.payStyle === "flat" ? { flagRate: next } : { hourlyRate: next });
                    }}
                  />
                </td>
                <td>
                  <Button small onClick={() => {
                    const result = removeTech(tech.id);
                    setError(result === "ok" ? "" : result === "appointments" ? `${tech.name} still has appointments. Reassign them before removing.` : `${tech.name} is still on a repair order.`);
                  }}>Remove</Button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="mt-8 grid gap-3 sm:grid-cols-2">
        <article className="card"><p className="text-sm text-muted">Shop efficiency</p><p className="font-display text-4xl tabular-nums">{pct(view.shopEfficiency)}</p></article>
        <article className="card"><p className="text-sm text-muted">Shop productivity</p><p className="font-display text-4xl tabular-nums">{pct(view.shopProductivity)}</p></article>
      </div>
      <div className="mt-4 grid gap-3 lg:grid-cols-2">
        {view.techRows.map((row) => {
          const weak = row.payStyle === "hourly" ? row.efficiency < 0.9 : row.efficiency < 1;
          const tech = shop.techs.find((item) => item.id === row.id);
          return (
            <article key={row.id} className="card">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div>
                  <h2 className="font-display text-3xl leading-none">{row.name}</h2>
                  <p className="mt-1 text-sm text-muted">#{tech?.number} · {skillLabel(row.skill as Skill)}</p>
                </div>
                <Pill tone={weak ? "bad" : "good"}>{pct(row.efficiency)} efficient</Pill>
              </div>
              <div className="mt-3">
                <Meter value={row.efficiency} max={1.35} bad={weak} />
              </div>
              <dl className="mt-4 grid grid-cols-3 gap-x-4 gap-y-2 text-sm">
                <div><dt className="text-muted">Flagged</dt><dd className="tabular-nums font-semibold">{row.flagged.toFixed(1)}</dd></div>
                <div><dt className="text-muted">Clocked</dt><dd className="tabular-nums font-semibold">{row.clocked.toFixed(1)}</dd></div>
                <div><dt className="text-muted">Sold labor</dt><dd className="tabular-nums font-semibold">{usd(row.laborSales)}</dd></div>
              </dl>
              {row.flaggedOpen > 0 ? <p className="mt-3 text-sm text-muted">{row.flaggedOpen.toFixed(1)} hours are on open repair orders.</p> : null}
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