import { useEffect, useState } from "react";
import { BAY_LABEL, PROMISE_TIMES, STATUS_LABEL, clockTime, feeCharge, formatDuration, punchHours, roStatusLabel, usd } from "@/lib/format";
import { NO_WORK_NOTE_MAX, advisorCloseGaps, hasBookedWork } from "@/lib/ro";
import { deskActor, displayRecordedName, displayRecordedWhen, mayCloseRepairOrder } from "@/lib/cancel";
import { mpiCounts } from "@/lib/mpi";
import { lookups, orderMoney } from "@/lib/metrics";
import { partSell, payKindOf, rateFor } from "@/lib/pay";
import { normalizeWa, waLimit } from "@/lib/wa";
import { useShop } from "@/lib/store";
import type { BayStatus, RepairOrder, RoStatus } from "@/lib/types";
import { RepairOrderPrint, printRepairOrder } from "./repair-order-print";
import { WaAuth } from "./wa-auth";
import { MultiPointSheet } from "./multi-point";
import { Button, Field, Modal, Pill } from "./ui";

const STATUSES: RoStatus[] = ["open", "working", "parts", "ready"];
const BAYS = Object.keys(BAY_LABEL) as BayStatus[];

function TechTime({ order }: { order: RepairOrder }) {
  const shop = useShop();
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 15000);
    return () => window.clearInterval(id);
  }, []);
  const techIds = [...new Set(order.labor.map((line) => line.techId).filter(Boolean))];
  const closed = order.status === "closed";
  return (
    <section className="mt-6">
      <h3 className="font-display text-2xl leading-none">Tech time</h3>
      <p className="mt-2 text-sm text-muted">Clock time is the time the technician is actually on this repair order. It is separate from the flat-rate hours on the labor lines.</p>
      {techIds.length === 0 ? <p className="mt-3 text-sm text-muted">Assign a technician on a labor line before they can clock onto this repair order.</p> : null}
      <div className="mt-3 grid gap-2">
        {techIds.map((techId) => {
          const tech = shop.techs.find((row) => row.id === techId);
          const punches = shop.timeLogs.filter((row) => row.techId === techId && row.orderId === order.id);
          const open = shop.timeLogs.find((row) => row.techId === techId && row.endedAt === null);
          const onThis = open?.orderId === order.id;
          const hours = punches.reduce((sum, row) => sum + punchHours(row.startedAt, row.endedAt, now), 0);
          return (
            <article key={techId} className="card flex flex-wrap items-center justify-between gap-3">
              <div>
                <p className="font-semibold">{tech ? `${tech.number} · ${tech.name}` : "Technician"}</p>
                <p className="text-sm text-muted">{onThis ? `On this repair order · ${formatDuration(hours)} logged` : `${formatDuration(hours)} logged on this repair order`}</p>
              </div>
              {closed ? null : onThis ? (
                <Button onClick={() => shop.clockOut(techId)}>Clock out</Button>
              ) : (
                <Button tone="primary" onClick={() => shop.clockIn(techId, order.id)}>{open ? "Move clock here" : "Clock in"}</Button>
              )}
            </article>
          );
        })}
      </div>
    </section>
  );
}

function readyToInvoice(order: RepairOrder) {
  const limit = waLimit(normalizeWa(order.wa));
  if (limit === null) return false;
  return orderMoney(order).ticket <= limit + 0.009;
}

export function NoWorkCloseForm({
  note,
  error,
  onNote,
  onSubmit,
}: {
  note: string;
  error: string | null;
  onNote: (value: string) => void;
  onSubmit: () => void;
}) {
  return (
    <form
      className="mt-4 grid max-w-xl gap-2"
      onSubmit={(event) => {
        event.preventDefault();
        onSubmit();
      }}
    >
      <Field label="Why no work was done">
        <textarea className="field min-h-20" rows={3} maxLength={NO_WORK_NOTE_MAX} value={note} onChange={(event) => onNote(event.target.value)} />
      </Field>
      <p className="text-sm text-muted">Don't enter card or SSN numbers.</p>
      {error ? <p role="alert" className="text-sm text-[#8a3b2a]">{error}</p> : null}
      <div>
        <Button type="submit">Close with no work ($0)</Button>
      </div>
    </form>
  );
}

export function OrderEditor({ orderId, onClose }: { orderId: string | null; onClose: () => void }) {
  const shop = useShop();
  const order = shop.orders.find((row) => row.id === orderId) ?? null;
  const look = lookups(shop);
  const [opcode, setOpcode] = useState("LOF");
  const [opId, setOpId] = useState("op-lof");
  const [laborDesc, setLaborDesc] = useState("Engine oil and filter");
  const [hours, setHours] = useState("0.5");
  const [pay, setPay] = useState("cp");
  const [techId, setTechId] = useState(shop.techs[0]?.id ?? "");
  const [skuId, setSkuId] = useState(shop.parts[0]?.id ?? "");
  const [qty, setQty] = useState("1");
  const [partPay, setPartPay] = useState("cp");
  const [tab, setTab] = useState<"ticket" | "sheet">("ticket");
  const [noWorkNote, setNoWorkNote] = useState("");
  const [noWorkError, setNoWorkError] = useState<string | null>(null);
  const [closeError, setCloseError] = useState<string | null>(null);

  useEffect(() => {
    setTab("ticket");
    setNoWorkNote("");
    setNoWorkError(null);
    setCloseError(null);
  }, [orderId]);

  if (!order) {
    return <Modal open={orderId !== null} onClose={onClose} title="Repair order">That repair order is not in this month.</Modal>;
  }

  const sealed = order.status === "closed";
  const locked = sealed;
  const booked = order.status === "booked";
  const canClose = mayCloseRepairOrder(deskActor(shop));
  const gaps = advisorCloseGaps(order, {
    customer: look.customer.get(order.customerId),
    vehicle: look.vehicle.get(order.vehicleId),
    techs: shop.techs,
    advisors: shop.advisors,
    logs: shop.timeLogs,
  });
  const money = orderMoney(order);
  const customer = look.customer.get(order.customerId);
  const vehicle = look.vehicle.get(order.vehicleId);
  const advisor = look.advisor.get(order.advisorId);
  const mpi = mpiCounts(order.inspection);

  return (
    <Modal
      open
      wide
      onClose={onClose}
      title={`RO ${order.number}`}
      description={customer ? `${customer.name} · ${vehicle ? `${vehicle.year} Ford ${vehicle.model}` : "Vehicle"}` : "Repair order"}
    >
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <Pill tone={order.status === "parts" ? "bad" : order.status === "ready" || order.status === "booked" || order.status === "closed" ? "good" : undefined}>{roStatusLabel(order)}</Pill>
        <span className="text-sm text-muted">{advisor?.name}</span>
        {order.promiseTime ? <span className="text-sm text-muted">Promise {clockTime(order.promiseTime)}</span> : null}
        <span className="text-sm tabular-nums text-muted">In {order.mileage.toLocaleString("en-US")}{order.mileageOut != null ? ` · Out ${order.mileageOut.toLocaleString("en-US")}` : ""}</span>
        {order.inspection && (mpi.red > 0 || mpi.yellow > 0) ? (
          <button type="button" className="inline-flex items-center gap-1 border-0 bg-transparent p-0" onClick={() => setTab("sheet")}>
            {mpi.red > 0 ? <span className="mpi-count mpi-red">{mpi.red} red</span> : null}
            {mpi.yellow > 0 ? <span className="mpi-count mpi-yellow">{mpi.yellow} yellow</span> : null}
          </button>
        ) : null}
      </div>

      <div className="mb-4 flex flex-wrap gap-2">
        <Button small tone={tab === "ticket" ? "primary" : "ghost"} onClick={() => setTab("ticket")}>Ticket</Button>
        <Button small tone={tab === "sheet" ? "primary" : "ghost"} onClick={() => setTab("sheet")}>Multi-point</Button>
        <Button small onClick={printRepairOrder}>Print repair order</Button>
      </div>
      <RepairOrderPrint orderId={order.id} />

      {tab === "sheet" ? <MultiPointSheet orderId={order.id} /> : (
      <>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Advisor">
          <select className="field" disabled={locked} value={order.advisorId} onChange={(event) => shop.updateOrder(order.id, { advisorId: event.target.value })}>
            {shop.advisors.map((row) => <option key={row.id} value={row.id}>#{row.number} {row.name}</option>)}
          </select>
        </Field>
        <Field label="Status">
          <select
            className="field"
            disabled={locked || booked}
            value={sealed ? "closed" : booked ? "booked" : order.status}
            onChange={(event) => shop.updateOrder(order.id, { status: event.target.value as RoStatus })}
          >
            {sealed ? <option value="closed">{order.closeType === "no_work" ? "Closed — no work ($0)" : "Closed"}</option> : null}
            {booked ? <option value="booked">Booked</option> : null}
            {STATUSES.map((status) => <option key={status} value={status}>{STATUS_LABEL[status]}</option>)}
          </select>
        </Field>
        <Field label="Bay status">
          <select className="field" disabled={sealed} value={order.bay ?? "dispatch"} onChange={(event) => shop.updateOrder(order.id, { bay: event.target.value as BayStatus })}>
            {BAYS.map((bay) => <option key={bay} value={bay}>{BAY_LABEL[bay]}</option>)}
          </select>
        </Field>
        <Field label="Mileage in">
          <input className="field tabular-nums" disabled={locked} type="number" min={0} value={order.mileage} onChange={(event) => shop.updateOrder(order.id, { mileage: Math.max(0, Number(event.target.value) || 0) })} />
        </Field>
        <Field label="Mileage out">
          <input className="field tabular-nums" disabled={sealed} type="number" min={0} value={order.mileageOut ?? ""} placeholder="When it leaves" onChange={(event) => shop.updateOrder(order.id, { mileageOut: event.target.value === "" ? null : Math.max(0, Number(event.target.value) || 0) })} />
        </Field>
        <Field label="Promise time">
          <select className="field" disabled={locked} value={order.promiseTime} onChange={(event) => shop.updateOrder(order.id, { promiseTime: event.target.value })}>
            <option value="">No promise</option>
            {PROMISE_TIMES.map((time) => <option key={time} value={time}>{clockTime(time)}</option>)}
            {order.promiseTime && !PROMISE_TIMES.includes(order.promiseTime) ? <option value={order.promiseTime}>{clockTime(order.promiseTime)}</option> : null}
          </select>
        </Field>
      </div>

      <section className="mt-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="font-display text-2xl leading-none">Lines</h3>
          {locked ? null : <Button small onClick={() => shop.addJob(order.id)}>Add line</Button>}
        </div>
        <div className="mt-3 grid gap-3">
          {(order.jobs ?? []).map((job) => (
            <article key={job.id} className="card grid gap-3">
              <div className="flex items-center justify-between gap-3">
                <h4 className="font-display text-2xl leading-none">Line {job.code}</h4>
                {locked || (order.jobs ?? []).length < 2 ? null : (
                  <Button small onClick={() => shop.removeJob(order.id, job.id)}>Remove</Button>
                )}
              </div>
              <Field label="Concern">
                <textarea className="field min-h-20" rows={2} disabled={locked} value={job.concern} onChange={(event) => shop.updateJob(order.id, job.id, { concern: event.target.value })} />
              </Field>
              <Field label="Cause">
                <textarea className="field min-h-20" rows={2} disabled={locked} placeholder="What you found" value={job.cause} onChange={(event) => shop.updateJob(order.id, job.id, { cause: event.target.value })} />
              </Field>
              <Field label="Correction">
                <textarea className="field min-h-20" rows={2} disabled={locked} placeholder="What you did" value={job.correction} onChange={(event) => shop.updateJob(order.id, job.id, { correction: event.target.value })} />
              </Field>
            </article>
          ))}
        </div>
      </section>

      <section className="mt-6">
        <h3 className="font-display text-2xl leading-none">Labor</h3>
        <div className="mt-3 grid gap-2">
          {order.labor.length === 0 ? <p className="text-sm text-muted">No labor yet. Write the operation before the tech flags it.</p> : null}
          {order.labor.map((line) => (
            <div key={line.id} className="card grid gap-2">
              <div className="flex items-start justify-between gap-3">
                <p className="font-semibold">{line.opcode} · {line.description}</p>
                <p className="tabular-nums font-semibold">{usd(line.hours * line.rate, true)}</p>
              </div>
              <div className="grid gap-2 sm:grid-cols-4">
                <Field label="Hours">
                  <input className="field tabular-nums" disabled={locked} type="number" min={0} step={0.1} value={line.hours} onChange={(event) => shop.updateLabor(order.id, line.id, { hours: Number(event.target.value) || 0 })} />
                </Field>
                <Field label="Rate">
                  <input className="field tabular-nums" disabled={locked} type="number" min={0} step={1} value={line.rate} onChange={(event) => shop.updateLabor(order.id, line.id, { rate: Number(event.target.value) || 0 })} />
                </Field>
                <Field label="Pay">
                  <select
                    className="field"
                    disabled={locked}
                    value={line.payType}
                    onChange={(event) => {
                      const payType = event.target.value;
                      shop.updateLabor(order.id, line.id, { payType, rate: rateFor(payType, shop.payTypes) });
                    }}
                  >
                    {shop.payTypes.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
                  </select>
                </Field>
                <Field label="Tech">
                  <select className="field" disabled={locked} value={line.techId} onChange={(event) => shop.updateLabor(order.id, line.id, { techId: event.target.value })}>
                    {shop.techs.map((tech) => <option key={tech.id} value={tech.id}>{tech.number} · {tech.name}</option>)}
                  </select>
                </Field>
              </div>
              {locked ? null : <Button small onClick={() => shop.removeLabor(order.id, line.id)}>Remove labor</Button>}
            </div>
          ))}
        </div>
        {locked ? null : (
          <form
            className="mt-3 grid gap-2 sm:grid-cols-6"
            onSubmit={(event) => {
              event.preventDefault();
              const parsed = Number(hours);
              if (!laborDesc.trim() || !parsed) return;
              shop.addLabor(order.id, {
                opcode: opcode.trim() || "MISC",
                description: laborDesc.trim(),
                hours: parsed,
                rate: rateFor(pay, shop.payTypes),
                payType: pay,
                techId,
              });
              if (!opId) setLaborDesc("");
            }}
          >
            <div className="sm:col-span-2">
              <Field label="Labor op">
                <select
                  className="field"
                  value={opId}
                  onChange={(event) => {
                    const nextId = event.target.value;
                    setOpId(nextId);
                    const chosen = shop.laborOps.find((op) => op.id === nextId);
                    if (!chosen) return;
                    setOpcode(chosen.opcode);
                    setLaborDesc(chosen.description);
                    setHours(String(chosen.hours));
                    setPay(chosen.payType);
                  }}
                >
                  <option value="">One-off line</option>
                  {shop.laborOps.map((op) => (
                    <option key={op.id} value={op.id}>{op.opcode} · {op.description}</option>
                  ))}
                </select>
              </Field>
            </div>
            {opId ? null : (
              <Field label="Op"><input className="field" value={opcode} onChange={(event) => setOpcode(event.target.value)} /></Field>
            )}
            <div className={opId ? "sm:col-span-4" : "sm:col-span-2"}>
              <Field label="Description"><input className="field" value={laborDesc} onChange={(event) => setLaborDesc(event.target.value)} placeholder="What the tech is doing" /></Field>
            </div>
            <Field label="Hours"><input className="field tabular-nums" type="number" min={0} step={0.1} value={hours} onChange={(event) => setHours(event.target.value)} /></Field>
            <Field label="Pay">
              <select className="field" value={pay} onChange={(event) => setPay(event.target.value)}>
                {shop.payTypes.map((item) => <option key={item.id} value={item.id}>{item.name} · {usd(item.rate)}</option>)}
              </select>
            </Field>
            <Field label="Tech">
              <select className="field" value={techId} onChange={(event) => setTechId(event.target.value)}>
                {shop.techs.map((tech) => <option key={tech.id} value={tech.id}>{tech.number} · {tech.name}</option>)}
              </select>
            </Field>
            <div className="sm:col-span-6">
              <Button tone="primary" type="submit">Add labor</Button>
            </div>
          </form>
        )}
      </section>

      <TechTime order={order} />

      <section className="mt-6">
        <h3 className="font-display text-2xl leading-none">Parts</h3>
        <div className="mt-3 grid gap-2">
          {order.parts.length === 0 ? <p className="text-sm text-muted">No parts on the ticket.</p> : null}
          {order.parts.map((line) => (
            <div key={line.id} className="card flex flex-wrap items-end justify-between gap-3">
              <div>
                <p className="font-semibold">{line.number}</p>
                <p className="text-sm text-muted">{line.description} · {line.condition ?? "new"}</p>
              </div>
              <div className="flex flex-wrap items-end gap-2">
                <Field label="Condition">
                  <select className="field" disabled={locked} value={line.condition ?? "new"} onChange={(event) => shop.updatePartLine(order.id, line.id, { condition: event.target.value as "new" | "rebuilt" | "used" })}>
                    <option value="new">New</option>
                    <option value="rebuilt">Rebuilt</option>
                    <option value="used">Used</option>
                  </select>
                </Field>
                <Field label="Qty">
                  <input className="field w-20 tabular-nums" disabled={locked} type="number" min={1} step={1} value={line.qty} onChange={(event) => shop.updatePartLine(order.id, line.id, { qty: Number(event.target.value) || 1 })} />
                </Field>
                <Field label="Sell">
                  <input className="field w-28 tabular-nums" disabled={locked} type="number" min={0} step={0.01} value={line.price} onChange={(event) => shop.updatePartLine(order.id, line.id, { price: Number(event.target.value) || 0 })} />
                </Field>
                <p className="pb-2 text-sm tabular-nums text-muted">Cost {usd(line.cost, true)}</p>
                {locked ? null : <Button small onClick={() => shop.removePartLine(order.id, line.id)}>Remove</Button>}
              </div>
            </div>
          ))}
        </div>
        {locked ? null : (
          <form
            className="mt-3 grid gap-2 sm:grid-cols-4"
            onSubmit={(event) => {
              event.preventDefault();
              const part = look.part.get(skuId);
              const parsed = Number(qty);
              if (!part || !parsed) return;
              const price = partSell(part.cost, part.list, payKindOf(shop.payTypes, partPay));
              shop.addPartLine(order.id, {
                partId: part.id,
                number: part.number,
                description: part.description,
                qty: parsed,
                cost: part.cost,
                price,
                payType: partPay,
                condition: "new",
              });
            }}
          >
            <div className="sm:col-span-2">
              <Field label="From the shelf">
                <select className="field" value={skuId} onChange={(event) => setSkuId(event.target.value)}>
                  {shop.parts.map((part) => <option key={part.id} value={part.id}>{part.number} · {part.description}</option>)}
                </select>
              </Field>
            </div>
            <Field label="Qty"><input className="field tabular-nums" type="number" min={1} step={1} value={qty} onChange={(event) => setQty(event.target.value)} /></Field>
            <Field label="Pay">
              <select className="field" value={partPay} onChange={(event) => setPartPay(event.target.value)}>
                {shop.payTypes.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
              </select>
            </Field>
            <div className="sm:col-span-4">
              <Button tone="primary" type="submit">Add part</Button>
            </div>
          </form>
        )}
      </section>
      </>
      )}

      <section className="mt-6">
        <h3 className="font-display text-2xl leading-none">Fees</h3>
        <div className="mt-3 grid gap-2">
          {(order.fees ?? []).length === 0 ? <p className="text-sm text-muted">No fees on this repair order.</p> : null}
          {(order.fees ?? []).map((line) => (
            <div key={line.id} className="card flex items-center justify-between gap-3">
              <div>
                <p className="font-semibold">{line.name}</p>
                {line.basis === "percent" ? <p className="text-sm text-muted">{line.amount}% of labor and parts{line.cap > 0 ? `, cap ${usd(line.cap, true)}` : ""}</p> : null}
              </div>
              <p className="tabular-nums font-semibold">{usd(feeCharge(line, money.labor + money.parts), true)}</p>
            </div>
          ))}
          <div className="card flex items-center justify-between gap-3">
            <div>
              <p className="font-semibold">Sales tax</p>
              <p className="text-sm text-muted">{order.taxRate}% of the repair and fees. Not part of the 110% cap.</p>
            </div>
            <p className="tabular-nums font-semibold">{usd(money.tax, true)}</p>
          </div>
        </div>
      </section>

      <div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <div><p className="text-xs uppercase tracking-wide text-muted">Labor</p><p className="font-display text-2xl tabular-nums">{usd(money.labor)}</p></div>
        <div><p className="text-xs uppercase tracking-wide text-muted">Parts</p><p className="font-display text-2xl tabular-nums">{usd(money.parts)}</p></div>
        <div><p className="text-xs uppercase tracking-wide text-muted">Parts gross</p><p className="font-display text-2xl tabular-nums">{usd(money.partsGross)}</p></div>
        <div><p className="text-xs uppercase tracking-wide text-muted">Totals</p><p className="font-display text-2xl tabular-nums">{usd(money.total)}</p><p className="text-xs text-muted">Before tax {usd(money.ticket)}</p></div>
      </div>
      <p className="mt-2 text-sm text-muted">Technician pay is counted on the month, not on this ticket. Flat-rate pay hits when the advisor closes the repair order. Hourly pay already hit when they were on the clock.</p>
      {(order.history ?? []).length > 0 ? (
        <ul className="mt-3 grid gap-1 text-sm text-muted">
          {(order.history ?? []).map((entry) => (
            <li key={`${entry.at}-${entry.kind}-${entry.text}`}>{entry.text} · {displayRecordedName(entry.who)} · {displayRecordedWhen(entry.at)}</li>
          ))}
        </ul>
      ) : null}
      {sealed ? (
        <div className="mt-4 grid gap-1">
          <p className="font-semibold">{order.closeType === "no_work" ? "Closed — no work ($0)" : "Closed"}</p>
          <p className="text-sm">{order.closeNote}</p>
          {order.droppedFeesNote ? <p className="text-sm text-muted">{order.droppedFeesNote}</p> : null}
          <p className="text-sm text-muted">{displayRecordedName(order.closedBy)} · {displayRecordedWhen(order.closedAt)}</p>
          {order.closeType === "no_work" ? null : <Button tone="ghost" onClick={() => shop.reopenOrder(order.id)}>Reopen</Button>}
        </div>
      ) : (
      <div className="mt-4 flex flex-wrap gap-2">
        {booked ? (
          <>
            <Button onClick={() => shop.unbookOrder(order.id)}>Unbook</Button>
            {canClose ? (
              <Button tone="primary" onClick={() => {
                const result = shop.closeOrder(order.id);
                setCloseError(result.error);
              }}>Close</Button>
            ) : null}
          </>
        ) : (
          <Button tone="primary" disabled={!readyToInvoice(order) || !hasBookedWork(order)} onClick={() => shop.bookOrder(order.id)}>Book — ready to close</Button>
        )}
      </div>
      )}
      {!sealed && canClose ? (
        <NoWorkCloseForm
          note={noWorkNote}
          error={noWorkError}
          onNote={setNoWorkNote}
          onSubmit={() => {
            const result = shop.closeOrderWithNoWork(order.id, noWorkNote);
            setNoWorkError(result.error);
          }}
        />
      ) : null}
      {!sealed && !canClose ? <p className="mt-2 text-sm text-muted">An advisor or service manager closes this repair order.</p> : null}
      {!booked && !sealed && (!readyToInvoice(order) || !hasBookedWork(order)) ? (
        <p className="mt-2 text-sm text-muted">You can add labor and parts now. Book stays off until the hours, technician, and cost are on the ticket and the Washington authorization covers it.</p>
      ) : null}
      {closeError ? <p role="alert" className="mt-2 whitespace-pre-line text-sm text-[#8a3b2a]">{closeError}</p> : null}
      {booked && gaps.length > 0 ? (
        <ul className="mt-2 grid gap-1 text-sm text-muted">
          {gaps.map((gap) => <li key={gap}>{gap}</li>)}
        </ul>
      ) : null}
      <WaAuth orderId={order.id} />
    </Modal>
  );
}
