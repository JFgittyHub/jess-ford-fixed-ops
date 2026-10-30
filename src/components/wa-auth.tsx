import { useState } from "react";
import { usd } from "@/lib/format";
import { orderMoney } from "@/lib/metrics";
import { useShop } from "@/lib/store";
import { vehicleTitle } from "@/lib/metrics";
import { normalizeWa, vinTail, waLimit, type WaChoice } from "@/lib/wa";
import { Button, Field } from "./ui";

const CHOICES: { id: Exclude<WaChoice, "">; label: string }[] = [
  { id: "written", label: "1. Written estimate. Contact me if the price will exceed it by more than ten percent." },
  { id: "cap", label: "2. Proceed with repairs, but contact me if the price will exceed the amount I write here." },
  { id: "waive", label: "3. I do not want a written estimate." },
  { id: "dropoff", label: "No face-to-face drop-off. I still authorize a dollar amount before any parts or labor." },
];

export function WaAuth({ orderId }: { orderId: string }) {
  const order = useShop((state) => state.orders.find((row) => row.id === orderId));
  const settings = useShop((state) => state.settings);
  const customers = useShop((state) => state.customers);
  const vehicles = useShop((state) => state.vehicles);
  const advisors = useShop((state) => state.advisors);
  const updateWa = useShop((state) => state.updateWa);
  const addExtraAuth = useShop((state) => state.addExtraAuth);
  const [extra, setExtra] = useState({ date: "", time: "", employee: "", person: "", phone: "", work: "", amount: "" });

  if (!order) return null;
  const locked = order.status === "closed" || Boolean(order.authorizationLocked);
  const wa = normalizeWa(order.wa);
  const money = orderMoney(order);
  const limit = waLimit(wa);
  const ready = limit !== null;
  const over = ready && money.ticket > (limit as number) + 0.009;
  const customer = customers.find((row) => row.id === order.customerId);
  const vehicle = vehicles.find((row) => row.id === order.vehicleId);
  const snap = locked ? order.closeSnapshot : undefined;
  const copyName = snap?.customerName || customer?.name;
  const copyPhone = snap?.phone || customer?.phone;
  const copyVin = snap?.vin || vehicle?.vin || "";
  const copyYear = snap?.year || vehicle?.year || "";
  const copyMake = snap?.make || vehicle?.make || "Ford";
  const copyModel = snap?.model || vehicle?.model || "";
  const advisor = advisors.find((row) => row.id === order.advisorId);

  return (
    <section className="mt-4 card">
      <h3 className="font-display text-2xl leading-none">Washington authorization</h3>
      {wa.choice ? null : <p className="mt-2 text-sm">Not captured</p>}
      <p className="mt-2 text-sm">
        You are entitled to a written price estimate for the repairs you have authorized. You are also entitled to require the repair facility to obtain your oral or written authorization to exceed the written price estimate. Your initials indicate your selection.
      </p>
      <p className="mt-2 text-sm text-muted">
        RCW 46.71. The 110% cap is before sales tax. Records stay on this computer for you to print. This is not a legal opinion, and the shop still has to post the lobby sign.
      </p>
      <div className="mt-3 grid gap-2" role="radiogroup" aria-label="Estimate choice">
        {CHOICES.map((choice) => (
          <label key={choice.id} className="flex items-start gap-2 text-sm">
            <input
              type="radio"
              name={`wa-${order.id}`}
              className="mt-1"
              disabled={locked}
              checked={wa.choice === choice.id}
              onChange={() => updateWa(order.id, { choice: choice.id })}
            />
            <span>{choice.label}</span>
          </label>
        ))}
      </div>
      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        <Field label="Customer initials">
          <input className="field" disabled={locked} value={wa.initials} onChange={(event) => updateWa(order.id, { initials: event.target.value })} />
        </Field>
        <Field label="Customer address">
          <input className="field" readOnly aria-readonly="true" value={wa.address} />
          <p className="text-sm text-muted">Same as the address on this repair order.</p>
        </Field>
        <Field label="Date">
          <input className="field" disabled={locked} type="date" value={wa.date} onChange={(event) => updateWa(order.id, { date: event.target.value })} />
        </Field>
        <Field label="Time">
          <input className="field" disabled={locked} type="time" value={wa.time} onChange={(event) => updateWa(order.id, { time: event.target.value })} />
        </Field>
        <Field label="License plate">
          <input className="field" disabled={locked} value={wa.plate} onChange={(event) => updateWa(order.id, { plate: event.target.value.toUpperCase() })} />
        </Field>
        {wa.choice === "written" || wa.choice === "dropoff" ? (
          <Field label={wa.choice === "dropoff" ? "Amount authorized, before tax" : "Written estimate, before tax"}>
            <input className="field tabular-nums" disabled={locked} type="number" min={0} step={0.01} value={wa.estimate || ""} onChange={(event) => updateWa(order.id, { estimate: Number(event.target.value) || 0 })} />
          </Field>
        ) : null}
        {wa.choice === "cap" ? (
          <Field label="Contact me above">
            <input className="field tabular-nums" disabled={locked} type="number" min={0} step={0.01} value={wa.cap || ""} onChange={(event) => updateWa(order.id, { cap: Number(event.target.value) || 0 })} />
          </Field>
        ) : null}
      </div>
      <label className="mt-3 flex items-start gap-2 text-sm">
        <input type="checkbox" className="mt-1" disabled={locked} checked={wa.returnParts} onChange={(event) => updateWa(order.id, { returnParts: event.target.checked })} />
        <span>Customer asked to have replaced parts returned, or shown if they have to go back to the supplier.</span>
      </label>
      <p className={`mt-3 text-sm ${over || !ready ? "text-primary" : "text-muted"}`}>
        {!ready
          ? "Parts and labor stay off this ticket until the choice, initials, date, and time are filled in."
          : over
            ? `Ticket is ${usd(money.ticket)} before tax. Washington allows ${usd(limit as number)} until the customer authorizes more.`
            : wa.choice === "waive"
              ? "Written estimate waived. The invoice is still required."
              : `Authorized up to ${usd(limit as number)} before tax. Ticket is ${usd(money.ticket)}.`}
      </p>

      {ready && wa.choice !== "waive" && !locked ? (
        <form
          className="mt-3 grid gap-2 sm:grid-cols-2"
          onSubmit={(event) => {
            event.preventDefault();
            addExtraAuth(order.id, {
              date: extra.date,
              time: extra.time,
              employee: extra.employee,
              person: extra.person,
              phone: extra.phone,
              work: extra.work,
              amount: Number(extra.amount) || 0,
            });
            setExtra({ date: extra.date, time: "", employee: extra.employee, person: extra.person, phone: extra.phone, work: "", amount: "" });
          }}
        >
          <h4 className="font-semibold sm:col-span-2">Authorization to go over</h4>
          <Field label="Date"><input className="field" type="date" required value={extra.date} onChange={(event) => setExtra({ ...extra, date: event.target.value })} /></Field>
          <Field label="Time"><input className="field" type="time" required value={extra.time} onChange={(event) => setExtra({ ...extra, time: event.target.value })} /></Field>
          <Field label="Employee"><input className="field" required value={extra.employee} onChange={(event) => setExtra({ ...extra, employee: event.target.value })} /></Field>
          <Field label="Person who approved"><input className="field" required value={extra.person} onChange={(event) => setExtra({ ...extra, person: event.target.value })} /></Field>
          <Field label="Their phone"><input className="field" value={extra.phone} onChange={(event) => setExtra({ ...extra, phone: event.target.value })} /></Field>
          <Field label="Added amount, before tax"><input className="field tabular-nums" type="number" min={0} step={0.01} required value={extra.amount} onChange={(event) => setExtra({ ...extra, amount: event.target.value })} /></Field>
          <div className="sm:col-span-2">
            <Field label="Additional parts and labor"><input className="field" value={extra.work} onChange={(event) => setExtra({ ...extra, work: event.target.value })} /></Field>
          </div>
          <div>
            <Button small tone="primary" type="submit">Record authorization</Button>
          </div>
        </form>
      ) : null}
      {wa.extras.length > 0 ? (
        <ul className="mt-3 grid gap-1 text-sm">
          {wa.extras.map((row) => (
            <li key={row.id}>{row.date} {row.time} · {row.person} approved {usd(row.amount)} · {row.work || "Additional work"} · taken by {row.employee}</li>
          ))}
        </ul>
      ) : null}

      <div className="wa-copy mt-4 border-t border-line pt-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h4 className="font-semibold">Customer copy</h4>
          <Button className="no-print" small type="button" onClick={printCopy}>Print copy</Button>
        </div>
        <p className="mt-2 text-sm">{settings.storeName}</p>
        <p className="text-sm text-muted">{[settings.address, settings.city, settings.phone].filter(Boolean).join(" · ") || "Add the street and phone in Settings. The invoice has to show them."}</p>
        <p className="mt-2 text-sm">{copyName} · {copyPhone}{wa.address ? ` · ${wa.address}` : ""}</p>
        <p className="text-sm">{copyModel ? vehicleTitle(copyYear, copyMake, copyModel) : "Vehicle"} · {wa.plate ? `Plate ${wa.plate}` : copyVin ? `VIN ${vinTail(copyVin)}` : "No vehicle id"} · {order.mileage.toLocaleString("en-US")} mi</p>
        <p className="mt-2 text-sm">{order.jobs.map((job) => `${job.code}. ${job.concern}`).join(" · ")}</p>
        <p className="mt-2 text-sm">Labor {usd(money.labor)} · Parts {usd(money.parts)} · Total before tax {usd(money.ticket)}</p>
        <ul className="mt-1 text-sm text-muted">
          {order.parts.map((line) => (
            <li key={line.id}>{line.number} · {line.description} · {line.condition ?? "new"} · {line.qty} × {usd(line.price, true)}</li>
          ))}
        </ul>
        <p className="mt-2 text-sm text-muted">Sales tax is extra. Advisor {advisor?.name ?? "—"}. {wa.returnParts ? "Replaced parts requested." : "Replaced parts not requested."}</p>
      </div>
    </section>
  );
}

function printCopy() {
  document.body.classList.add("printing-wa");
  const done = () => {
    document.body.classList.remove("printing-wa");
    window.removeEventListener("afterprint", done);
  };
  window.addEventListener("afterprint", done);
  window.print();
}
