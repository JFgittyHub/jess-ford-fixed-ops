import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { printRepairOrder } from "@/components/repair-order-print";
import { Shell } from "@/components/shell";
import { Button, Field } from "@/components/ui";
import { feeCharge, feeTotal, salesTax, today, usd } from "@/lib/format";
import { lastVisitMileage, mileageFloorMessage } from "@/lib/mileage";
import { lineLetter } from "@/lib/jobs";
import { partSell, rateFor } from "@/lib/pay";
import { repairOrderWriterError, useShop } from "@/lib/store";

export const Route = createFileRoute("/estimates")({ component: EstimatesPage });

type LaborDraft = { id: string; opcode: string; description: string; hours: number; rate: number; payType: string };
type PartDraft = { id: string; partId: string; number: string; description: string; qty: number; cost: number; price: number };

let seq = 0;
function nextId(prefix: string) {
  seq += 1;
  return `${prefix}${seq}`;
}

function EstimatesPage() {
  const shop = useShop();
  const navigate = useNavigate();
  const [customerId, setCustomerId] = useState(shop.customers[0]?.id ?? "");
  const vehicles = shop.vehicles.filter((vehicle) => vehicle.customerId === customerId);
  const [vehicleId, setVehicleId] = useState(vehicles[0]?.id ?? "");
  const [advisorId, setAdvisorId] = useState(shop.advisors[0]?.id ?? "");
  const [mileage, setMileage] = useState("");
  const [concerns, setConcerns] = useState<string[]>([""]);
  const [opId, setOpId] = useState(shop.laborOps[0]?.id ?? "");
  const [skuId, setSkuId] = useState(shop.parts[0]?.id ?? "");
  const [qty, setQty] = useState("1");
  const [labor, setLabor] = useState<LaborDraft[]>([]);
  const [parts, setParts] = useState<PartDraft[]>([]);
  const [error, setError] = useState("");

  const vehicleOk = vehicles.some((vehicle) => vehicle.id === vehicleId) ? vehicleId : vehicles[0]?.id ?? "";
  const customer = shop.customers.find((row) => row.id === customerId);
  const vehicle = shop.vehicles.find((row) => row.id === vehicleOk);
  const advisor = shop.advisors.find((row) => row.id === advisorId);
  const laborSales = labor.reduce((sum, line) => sum + line.hours * line.rate, 0);
  const partsSales = parts.reduce((sum, line) => sum + line.qty * line.price, 0);
  const repair = laborSales + partsSales;
  const fees = feeTotal(shop.settings.fees, repair);
  const beforeTax = repair + fees;
  const tax = salesTax(beforeTax, shop.settings.taxRate);
  const total = beforeTax + tax;
  const written = concerns.map((line) => line.trim()).filter(Boolean);

  function addLabor() {
    const op = shop.laborOps.find((row) => row.id === opId);
    if (!op) return;
    setLabor((rows) => [
      ...rows,
      { id: nextId("el"), opcode: op.opcode, description: op.description, hours: op.hours, rate: rateFor(op.payType, shop.payTypes), payType: op.payType },
    ]);
  }

  function addPart() {
    const part = shop.parts.find((row) => row.id === skuId);
    const count = Math.max(1, Number(qty) || 1);
    if (!part) return;
    setParts((rows) => [
      ...rows,
      {
        id: nextId("ep"),
        partId: part.id,
        number: part.number,
        description: part.description,
        qty: count,
        cost: part.cost,
        price: partSell(part.cost, part.list, "customer"),
      },
    ]);
  }

  function openOrder() {
    if (!customerId || !vehicleOk) {
      setError("Pick a customer and a vehicle before opening the repair order.");
      return;
    }
    if (written.length === 0 && labor.length === 0 && parts.length === 0) {
      setError("Add a concern, a labor op, or a part.");
      return;
    }
    const miles = Number(mileage);
    const vehicle = shop.vehicles.find((row) => row.id === vehicleOk);
    const floor = mileageFloorMessage(miles, lastVisitMileage(Object.values(shop.stores ?? {}), vehicle, { openedAt: new Date().toISOString() }));
    if (!String(mileage).trim() || !Number.isFinite(miles) || miles <= 0) {
      setError("Mileage in has to be greater than zero.");
      return;
    }
    if (miles > 999999) {
      setError("Mileage in can't be over 999,999.");
      return;
    }
    if (floor) {
      setError(floor);
      return;
    }
    const id = shop.createOrder({
      customerId,
      vehicleId: vehicleOk,
      advisorId,
      lines: written.length > 0 ? written.map((concern) => ({ concern })) : [{ concern: "Estimate" }],
      mileage: miles,
      promiseTime: "",
    });
    if (!id) {
      setError(floor ?? "That repair order was not opened.");
      return;
    }
    const opened = shop.orders.find((row) => row.id === id);
    const jobId = opened?.jobs[0]?.id ?? "";
    for (const line of labor) {
      shop.addLabor(id, {
        opcode: line.opcode,
        description: line.description,
        hours: line.hours,
        rate: line.rate,
        payType: line.payType,
        techId: "",
        jobId,
      });
    }
    for (const line of parts) {
      shop.addPartLine(id, {
        partId: line.partId,
        number: line.number,
        description: line.description,
        qty: line.qty,
        cost: line.cost,
        price: line.price,
        payType: "cp",
        condition: "new",
        jobId,
      });
    }
    shop.updateWa(id, { choice: "written", estimate: beforeTax, date: today(), time: "08:00" });
    navigate({ to: "/orders" });
  }

  return (
    <Shell>
      <p className="text-sm font-semibold uppercase tracking-wide text-muted">Fixed operations</p>
      <h1 className="mt-1 font-display text-5xl leading-none tracking-tight">Repair estimate</h1>
      <p className="mt-3 max-w-2xl text-muted">
        Price the job from the labor book, the parts shelf, and the shop fees. The total includes sales tax. The Washington estimate is the amount before tax.
      </p>

      <div className="mt-5 grid gap-4 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <div className="grid gap-4">
          <section className="card grid gap-3 sm:grid-cols-2">
            <Field label="Customer">
              <select className="field" value={customerId} onChange={(event) => { setCustomerId(event.target.value); setVehicleId(""); }}>
                {shop.customers.map((row) => <option key={row.id} value={row.id}>{row.name}</option>)}
              </select>
            </Field>
            <Field label="Vehicle">
              <select className="field" value={vehicleOk} onChange={(event) => setVehicleId(event.target.value)}>
                {vehicles.map((row) => <option key={row.id} value={row.id}>{row.year} Ford {row.model}</option>)}
              </select>
            </Field>
            <Field label="Advisor">
              <select className="field" value={advisorId} onChange={(event) => setAdvisorId(event.target.value)}>
                {shop.advisors.map((row) => <option key={row.id} value={row.id}>#{row.number} {row.name}</option>)}
              </select>
            </Field>
            <Field label="Mileage">
              <input className="field tabular-nums" type="number" min={0} value={mileage} onChange={(event) => setMileage(event.target.value)} />
            </Field>
          </section>

          <section className="card">
            <h2 className="font-display text-2xl leading-none">Concerns</h2>
            <div className="mt-3 grid gap-2">
              {concerns.map((concern, index) => (
                <Field key={index} label={`Line ${lineLetter(index)}`}>
                  <input className="field" value={concern} onChange={(event) => setConcerns((rows) => rows.map((row, rowIndex) => rowIndex === index ? event.target.value : row))} />
                </Field>
              ))}
              <div><Button small onClick={() => setConcerns((rows) => [...rows, ""])}>Add line</Button></div>
            </div>
          </section>

          <section className="card">
            <h2 className="font-display text-2xl leading-none">Labor</h2>
            <div className="mt-3 flex flex-wrap items-end gap-2">
              <div className="min-w-64 flex-1">
                <Field label="Labor op">
                  <select className="field" value={opId} onChange={(event) => setOpId(event.target.value)}>
                    {shop.laborOps.map((op) => <option key={op.id} value={op.id}>{op.opcode} · {op.description}</option>)}
                  </select>
                </Field>
              </div>
              <Button onClick={addLabor}>Add labor</Button>
            </div>
            <div className="mt-3 grid gap-2">
              {labor.length === 0 ? <p className="text-sm text-muted">No labor yet.</p> : null}
              {labor.map((line) => (
                <div key={line.id} className="grid gap-2 rounded-md border border-line p-3 sm:grid-cols-[1fr_6rem_6rem_auto]">
                  <p className="font-semibold">{line.opcode} · {line.description}</p>
                  <Field label="Hours">
                    <input className="field tabular-nums" type="number" min={0} step={0.1} value={line.hours} onChange={(event) => setLabor((rows) => rows.map((row) => row.id === line.id ? { ...row, hours: Number(event.target.value) || 0 } : row))} />
                  </Field>
                  <Field label="Rate">
                    <input className="field tabular-nums" type="number" min={0} step={1} value={line.rate} onChange={(event) => setLabor((rows) => rows.map((row) => row.id === line.id ? { ...row, rate: Number(event.target.value) || 0 } : row))} />
                  </Field>
                  <div className="flex items-end"><Button small onClick={() => setLabor((rows) => rows.filter((row) => row.id !== line.id))}>Remove</Button></div>
                </div>
              ))}
            </div>
          </section>

          <section className="card">
            <h2 className="font-display text-2xl leading-none">Parts</h2>
            <div className="mt-3 flex flex-wrap items-end gap-2">
              <div className="min-w-64 flex-1">
                <Field label="Part">
                  <select className="field" value={skuId} onChange={(event) => setSkuId(event.target.value)}>
                    {shop.parts.map((part) => <option key={part.id} value={part.id}>{part.number} · {part.description}</option>)}
                  </select>
                </Field>
              </div>
              <Field label="Qty">
                <input className="field w-20 tabular-nums" type="number" min={1} step={1} value={qty} onChange={(event) => setQty(event.target.value)} />
              </Field>
              <Button onClick={addPart}>Add part</Button>
            </div>
            <div className="mt-3 grid gap-2">
              {parts.length === 0 ? <p className="text-sm text-muted">No parts yet.</p> : null}
              {parts.map((line) => (
                <div key={line.id} className="flex items-center justify-between gap-3 rounded-md border border-line p-3">
                  <p><span className="font-semibold">{line.number}</span> · {line.description} · qty {line.qty}</p>
                  <div className="flex items-center gap-3">
                    <p className="tabular-nums font-semibold">{usd(line.qty * line.price, true)}</p>
                    <Button small onClick={() => setParts((rows) => rows.filter((row) => row.id !== line.id))}>Remove</Button>
                  </div>
                </div>
              ))}
            </div>
          </section>
        </div>

        <aside className="card h-fit lg:sticky lg:top-4">
          <h2 className="font-display text-2xl leading-none">Estimate</h2>
          <dl className="mt-4 grid gap-2 text-sm">
            <div className="flex justify-between gap-3"><dt>Labor</dt><dd className="tabular-nums font-semibold">{usd(laborSales, true)}</dd></div>
            <div className="flex justify-between gap-3"><dt>Parts</dt><dd className="tabular-nums font-semibold">{usd(partsSales, true)}</dd></div>
            {shop.settings.fees.map((line) => (
              <div key={line.id} className="flex justify-between gap-3">
                <dt>{line.name}{line.basis === "percent" ? ` ${line.amount}%` : ""}</dt>
                <dd className="tabular-nums font-semibold">{usd(feeCharge(line, repair), true)}</dd>
              </div>
            ))}
            <div className="flex justify-between gap-3"><dt>Before tax</dt><dd className="tabular-nums font-semibold">{usd(beforeTax, true)}</dd></div>
            <div className="flex justify-between gap-3"><dt>Sales tax {shop.settings.taxRate}%</dt><dd className="tabular-nums font-semibold">{usd(tax, true)}</dd></div>
            <div className="flex justify-between gap-3 border-t border-line pt-2 text-base"><dt className="font-semibold">Total</dt><dd className="tabular-nums font-semibold">{usd(total, true)}</dd></div>
          </dl>
          <p className="mt-3 text-sm text-muted">The 110% cap uses {usd(beforeTax, true)} before tax.</p>
          {error ? <p className="mt-2 text-sm text-primary">{error}</p> : null}
          <div className="mt-4 flex flex-wrap gap-2">
            <Button onClick={printRepairOrder}>Print estimate</Button>
            {repairOrderWriterError(shop) ? <p className="text-sm text-muted">{repairOrderWriterError(shop)}</p> : <Button tone="primary" onClick={openOrder}>Open as repair order</Button>}
          </div>
        </aside>
      </div>

      <section className="mt-6 max-w-3xl text-sm text-muted">
        <p>
          You are entitled to a written price estimate for the repairs you have authorized. You are also entitled to require the repair facility to obtain your oral or written authorization to exceed the written price estimate. Your initials indicate your selection.
        </p>
        <p className="mt-2">
          RCW 46.71. The written estimate is {usd(beforeTax, true)} before sales tax. The shop must contact you before the price exceeds that estimate by more than ten percent. Sales tax is extra and is not part of the 110% cap. This is not a legal opinion, and the shop still has to post the lobby sign.
        </p>
      </section>

      <article className="ro-print">
        <p className="ro-kicker">{shop.settings.storeName}</p>
        <h1>Repair estimate</h1>
        <p>{customer?.name ?? "Customer"}{vehicle ? ` · ${vehicle.year} ${vehicle.make || "Ford"} ${vehicle.model}` : ""}{mileage ? ` · ${Number(mileage).toLocaleString("en-US")} miles` : ""}</p>
        <p>Advisor {advisor ? `#${advisor.number} ${advisor.name}` : "—"} · {today()}</p>
        <h2>Concerns</h2>
        {written.length === 0 ? <p>No concerns written.</p> : written.map((line, index) => <p key={index}>{lineLetter(index)}. {line}</p>)}
        <h2>Labor</h2>
        {labor.length === 0 ? <p>No labor.</p> : labor.map((line) => <p key={line.id}>{line.opcode} {line.description} · {line.hours.toFixed(1)} hrs · {usd(line.hours * line.rate, true)}</p>)}
        <h2>Parts</h2>
        {parts.length === 0 ? <p>No parts.</p> : parts.map((line) => <p key={line.id}>{line.number} {line.description} · qty {line.qty} · {usd(line.qty * line.price, true)}</p>)}
        <h2>Fees and tax</h2>
        {shop.settings.fees.map((line) => <p key={line.id}>{line.name} {usd(feeCharge(line, repair), true)}</p>)}
        <p>Before tax {usd(beforeTax, true)}</p>
        <p>Sales tax {shop.settings.taxRate}% {usd(tax, true)}</p>
        <p className="ro-totals">Total {usd(total, true)}. The written estimate for the 110% cap is {usd(beforeTax, true)} before tax.</p>
        <p>Customer _______________________________ Date __________ Initials __________</p>
        <p>You are entitled to a written price estimate for the repairs you have authorized. You are also entitled to require the repair facility to obtain your oral or written authorization to exceed the written price estimate.</p>
        <p>RCW 46.71. The shop must contact you before the price exceeds this written estimate by more than ten percent. Sales tax is extra and is not part of the 110% cap.</p>
      </article>
    </Shell>
  );
}
