import { useEffect, useState } from "react";
import { BAY_LABEL, PROMISE_TIMES, STATUS_LABEL, clockTime, feeCharge, formatDuration, punchHours, reviewCap, roStatusLabel, usd } from "@/lib/format";
import { NO_WORK_NOTE_MAX, advisorCloseGaps, hasBookedWork } from "@/lib/ro";
import { deskActor, displayRecordedName, displayRecordedWhen, mayCloseRepairOrder } from "@/lib/cancel";
import { lastVisitHint, lastVisitMileage, mileageFloorMessage, mileageOutGapMessage } from "@/lib/mileage";
import { phoneDigitError } from "@/lib/range";
import { isFullVin, normalizeVin, vinEntryError } from "@/lib/vin";
import { mpiCounts } from "@/lib/mpi";
import { lookups, orderMoney } from "@/lib/metrics";
import { partSell, payKindOf, rateFor } from "@/lib/pay";
import { normalizeWa, waLimit } from "@/lib/wa";
import { RO_WRITE_REFUSAL, roWritesEnabled } from "@/lib/ro-flags";
import { useShop } from "@/lib/store";
import type { BayStatus, RepairOrder, RoStatus } from "@/lib/types";
import { RepairOrderPrint, printRepairOrder } from "./repair-order-print";
import { WaAuth } from "./wa-auth";
import { MultiPointSheet } from "./multi-point";
import { Button, Field, Modal, Pill } from "./ui";

function localDateTime(value: string) {
  const parsed = new Date(value);
  if (!Number.isFinite(parsed.getTime())) return value.slice(0, 16);
  const pad = (part: number) => String(part).padStart(2, "0");
  return `${parsed.getFullYear()}-${pad(parsed.getMonth() + 1)}-${pad(parsed.getDate())}T${pad(parsed.getHours())}:${pad(parsed.getMinutes())}`;
}

const STATUSES: RoStatus[] = ["open", "working", "parts", "ready"];
const BAYS = Object.keys(BAY_LABEL) as BayStatus[];

function TechTime({ order }: { order: RepairOrder }) {
  const shop = useShop();
  const [now, setNow] = useState(() => Date.now());
  const [clockError, setClockError] = useState("");
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 15000);
    return () => window.clearInterval(id);
  }, []);
  const techIds = [...new Set(order.labor.map((line) => line.techId).filter(Boolean))];
  const closed = order.status === "closed";
  const viewOnly = !roWritesEnabled();
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
          const hours = punches.reduce((sum, row) => sum + punchHours(row.startedAt, row.endedAt, now, reviewCap(row, order.closedAt)), 0);
          const waiting = punches.filter((row) => row.needsReview);
          const actor = deskActor(shop);
          return (
            <article key={techId} className="card flex flex-wrap items-center justify-between gap-3">
              <div>
                <p className="font-semibold">{tech ? `${tech.number} · ${tech.name}` : "Technician"}</p>
                <p className="text-sm text-muted">{onThis ? `On this repair order · ${formatDuration(hours)} logged` : `${formatDuration(hours)} logged on this repair order`}</p>
                {waiting.map((row) => (
                  <div key={row.id} className="mt-1">
                    <p className="text-sm text-[#8a3b2a]">Needs service manager review. {row.note}</p>
                    {actor === "service-manager" && !viewOnly ? (
                      <form className="mt-2 flex flex-wrap items-end gap-2" onSubmit={(event) => {
                        event.preventDefault();
                        const field = new FormData(event.currentTarget).get("ended");
                        const raw = typeof field === "string" ? field : "";
                        const ended = raw ? new Date(raw).toISOString() : "";
                        const result = shop.resolveFlaggedPunch(row.id, ended);
                        setClockError(result.error ?? "");
                      }}>
                        <label className="text-sm">End time
                          <input className="field" type="datetime-local" name="ended" required defaultValue={localDateTime(row.clockedOutAt || row.endedAt || order.closedAt || row.startedAt)} />
                        </label>
                        <Button small type="submit">Resolve punch</Button>
                      </form>
                    ) : <p className="text-sm text-muted">Sent for review</p>}
                  </div>
                ))}
              </div>
              {viewOnly ? null : onThis ? (
                <Button onClick={() => { const result = shop.clockOut(techId); setClockError(result.error ?? ""); }}>Clock out {tech?.name ?? "technician"}</Button>
              ) : closed ? null : (
                <Button tone="primary" onClick={() => { const result = shop.clockIn(techId, order.id); setClockError(result.error ?? ""); }}>{open ? "Move clock here" : "Clock in"}</Button>
              )}
            </article>
          );
        })}
      </div>
      {clockError ? <p role="alert" className="mt-2 text-sm text-[#8a3b2a]">{clockError}</p> : null}
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
  const [mileageDraft, setMileageDraft] = useState("");
  const [mileageError, setMileageError] = useState("");
  const [overrideReason, setOverrideReason] = useState("");
  const [phoneDraft, setPhoneDraft] = useState("");
  const [phoneError, setPhoneError] = useState("");
  const [addressDraft, setAddressDraft] = useState("");
  const [vinDraft, setVinDraft] = useState("");
  const [laborJobId, setLaborJobId] = useState("");
  const [partJobId, setPartJobId] = useState("");
  const [outDraft, setOutDraft] = useState("");
  const [outError, setOutError] = useState("");
  const [outReason, setOutReason] = useState("");
  const [vinWarning, setVinWarning] = useState("");
  const [vinReplace, setVinReplace] = useState(false);
  const [vinTransfer, setVinTransfer] = useState(false);
  const [vinReason, setVinReason] = useState("");

  useEffect(() => {
    setTab("ticket");
    setNoWorkNote("");
    setNoWorkError(null);
    setCloseError(null);
    setMileageError("");
    setOverrideReason("");
    setPhoneError("");
    setOutError("");
    setLaborJobId("");
    setPartJobId("");
    setVinWarning("");
    setVinReplace(false);
    setVinTransfer(false);
  }, [orderId]);

  const sealedView = order?.status === "closed" ? order.closeSnapshot : undefined;
  const customerPhone = order ? (sealedView?.phone || look.customer.get(order.customerId)?.phone || "") : "";
  const waAddress = order ? normalizeWa(order.wa).address : "";
  const vehicleVin = order ? (sealedView?.vin || look.vehicle.get(order.vehicleId)?.vin || "") : "";
  const mileageNow = order?.mileage ?? 0;
  const orderKey = order?.id ?? "";
  useEffect(() => {
    if (!orderKey) return;
    setMileageDraft(mileageNow ? String(mileageNow) : "");
    setOutDraft(order?.mileageOut != null ? String(order.mileageOut) : "");
  }, [orderKey, mileageNow, order?.mileageOut]);
  useEffect(() => {
    setPhoneDraft(customerPhone);
    setAddressDraft(waAddress);
    setVinDraft(vehicleVin);
  }, [order?.id, customerPhone, waAddress, vehicleVin]);

  if (!order) {
    return <Modal open={orderId !== null} onClose={onClose} title="Repair order">That repair order is not in this month.</Modal>;
  }

  const sealed = order.status === "closed";
  const viewOnly = !roWritesEnabled();
  const locked = sealed || viewOnly;
  const booked = order.status === "booked";
  const actor = deskActor(shop);
  const canClose = mayCloseRepairOrder(actor);
  const lastVisit = lastVisitMileage(Object.values(shop.stores ?? {}), look.vehicle.get(order.vehicleId), { excludeOrderId: order.id, openedAt: order.openedAt, openedOn: order.openedOn, number: order.number });
  const lineChoices = (order.jobs ?? []).filter((job) => !job.needsAssignment);
  const laborTarget = lineChoices.some((job) => job.id === laborJobId) ? laborJobId : (lineChoices[0]?.id ?? "");
  const partTarget = lineChoices.some((job) => job.id === partJobId) ? partJobId : (lineChoices[0]?.id ?? "");
  function requestClose() {
    const draft = mileageDraft.trim();
    if (!order || locked || !draft || draft === String(order.mileage)) {
      onClose();
      return;
    }
    if (draft) {
      const next = Number(draft);
      const problem = !Number.isFinite(next) || next <= 0
        ? "Mileage in has to be greater than zero."
        : next > 999999
          ? "Mileage in can't be over 999,999."
          : mileageFloorMessage(next, lastVisit);
      if (problem) {
        setMileageError(problem);
        return;
      }
    }
    onClose();
  }
  const gaps = advisorCloseGaps(order, {
    customer: look.customer.get(order.customerId),
    vehicle: look.vehicle.get(order.vehicleId),
    techs: shop.techs,
    advisors: shop.advisors,
    logs: shop.timeLogs,
    lastVisit,
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
      onClose={requestClose}
      title={`RO ${order.number}`}
      description={customer || sealedView?.customerName ? `${sealedView?.customerName || customer?.name} · ${vehicle ? `${sealedView?.year || vehicle.year} ${sealedView?.make || vehicle.make || "Ford"} ${sealedView?.model || vehicle.model}` : "Vehicle"}` : "Repair order"}
    >
      {viewOnly ? <p className="mb-4 text-sm font-semibold" role="status">{RO_WRITE_REFUSAL}</p> : null}
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <Pill tone={order.status === "parts" ? "bad" : order.status === "ready" || order.status === "booked" || order.status === "closed" ? "good" : undefined}>{roStatusLabel(order)}</Pill>
        <p className="text-sm text-muted">Advisor on this repair order: {advisor?.name ?? "Unassigned"}</p>
        {order.promiseTime ? <span className="text-sm text-muted">Promise {clockTime(order.promiseTime)}</span> : null}
        <span className="text-sm tabular-nums text-muted">In {order.mileage.toLocaleString("en-US")}{order.mileageOut != null ? ` · Out ${order.mileageOut.toLocaleString("en-US")}` : ""}</span>
        {order.inspection && (mpi.red > 0 || mpi.yellow > 0) ? (
          <button type="button" className="inline-flex items-center gap-1 border-0 bg-transparent p-0" disabled={viewOnly} onClick={() => setTab("sheet")}>
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
          <select className="field" disabled={locked} value={order.bay ?? "dispatch"} onChange={(event) => shop.updateOrder(order.id, { bay: event.target.value as BayStatus })}>
            {BAYS.map((bay) => <option key={bay} value={bay}>{BAY_LABEL[bay]}</option>)}
          </select>
        </Field>
        <Field label="Customer phone">
          <input
            className="field"
            disabled={locked}
            maxLength={20}
            value={phoneDraft}
            onChange={(event) => setPhoneDraft(event.target.value)}
            onBlur={() => {
              if (locked) return;
              const error = phoneDigitError(phoneDraft);
              setPhoneError(error ?? "");
              if (error) return;
              shop.updateOpenContact(order.id, { phone: phoneDraft });
            }}
          />
          {phoneError ? <p role="alert" className="mt-1 text-sm text-[#8a3b2a]">{phoneError}</p> : null}
        </Field>
        <Field label="VIN">
          <input
            className="field font-mono uppercase"
            disabled={locked}
            maxLength={17}
            value={vinDraft}
            aria-label="VIN"
            onChange={(event) => setVinDraft(event.target.value.toUpperCase())}
            onBlur={() => {
              if (locked) return;
              const error = vinEntryError(vinDraft);
              if (error || !vinDraft.trim()) {
                setVinReplace(false);
                setVinTransfer(false);
                setVinWarning(vinDraft.trim() ? (error ?? "") : (isFullVin(vehicleVin) ? "Enter a 17-character VIN." : ""));
                return;
              }
              const nextVin = normalizeVin(vinDraft);
              const currentVin = normalizeVin(vehicleVin);
              if (isFullVin(currentVin) && currentVin !== nextVin) {
                setVinTransfer(false);
                setVinReplace(true);
                setVinWarning(`Replace VIN ${currentVin} with ${nextVin}?`);
                return;
              }
              const result = shop.updateOpenVin(order.id, nextVin);
              setVinReplace(false);
              setVinTransfer(Boolean(result.needsTransfer));
              setVinWarning(result.error || result.warning || "");
            }}
          />
          {vinWarning ? <p role="alert" className="mt-1 text-sm text-[#8a3b2a]">{vinWarning}</p> : null}
          {!locked && vinReplace ? (
            <div className="mt-2 flex flex-wrap gap-2">
              <Button
                small
                type="button"
                onClick={() => {
                  const result = shop.updateOpenVin(order.id, normalizeVin(vinDraft));
                  setVinReplace(false);
                  setVinTransfer(Boolean(result.needsTransfer));
                  setVinWarning(result.error || result.warning || "");
                }}
              >
                Replace the VIN
              </Button>
              <Button small type="button" onClick={() => { setVinDraft(vehicleVin); setVinReplace(false); setVinTransfer(false); setVinWarning(""); }}>Keep the VIN</Button>
            </div>
          ) : null}
          {!locked && vinTransfer ? (
            <div className="mt-2 grid gap-2">
              <Field label="Reason for the transfer">
                <input className="field" aria-label="Reason for the transfer" value={vinReason} onChange={(event) => setVinReason(event.target.value)} />
              </Field>
              <div className="flex flex-wrap gap-2">
              <Button
                small
                type="button"
                onClick={() => {
                  const result = shop.updateOpenVin(order.id, normalizeVin(vinDraft), true, vinReason);
                  if (result.needsTransfer) {
                    setVinTransfer(true);
                    setVinWarning(result.error || result.warning || "");
                    return;
                  }
                  setVinTransfer(false);
                  setVinWarning(result.error || result.warning || "");
                }}
              >
                Transfer the vehicle
              </Button>
              <Button small type="button" onClick={() => { setVinDraft(vehicleVin); setVinTransfer(false); setVinReason(""); setVinWarning(""); }}>Fix the VIN</Button>
              </div>
            </div>
          ) : null}
        </Field>
        <Field label="Address">
          <input
            className="field"
            disabled={locked}
            maxLength={200}
            value={addressDraft}
            onChange={(event) => setAddressDraft(event.target.value)}
            onBlur={() => {
              if (!locked) shop.updateOpenContact(order.id, { address: addressDraft });
            }}
          />
        </Field>
        <Field label="Mileage in">
          <input
            className="field tabular-nums"
            disabled={locked}
            inputMode="numeric"
            value={mileageDraft}
            onChange={(event) => {
              setMileageDraft(event.target.value);
              setMileageError("");
            }}
            onBlur={() => {
              if (locked) return;
              const next = Number(mileageDraft);
              if (!mileageDraft.trim() || !Number.isFinite(next) || next <= 0) {
                setMileageError("Mileage in has to be greater than zero.");
                return;
              }
              if (next > 999999) {
                setMileageError("Mileage in can't be over 999,999.");
                return;
              }
              const floor = mileageFloorMessage(next, lastVisit);
              if (floor) {
                setMileageError(floor);
                return;
              }
              if (order.mileageOut != null && next > order.mileageOut) {
                setMileageError("Mileage in can't be higher than mileage out.");
                return;
              }
              const outOverride = (order.history ?? []).some((row) => row.kind === "mileage-override" && row.field === "mileageOut");
              if (outOverride && next !== order.mileage) {
                setMileageError("Mileage in changed after the mileage-out exception. Add a new reason.");
                return;
              }
              setMileageError("");
              if (next !== order.mileage) shop.updateOrder(order.id, { mileage: next });
            }}
          />
          {lastVisit ? <p className="mt-1 text-sm font-normal text-muted">{lastVisitHint(lastVisit)}</p> : null}
          {mileageError ? <p role="alert" className="mt-1 text-sm text-[#8a3b2a]">{mileageError}</p> : null}
          {!locked && mileageError && actor === "service-manager" ? (
            <div className="mt-2 grid gap-2">
              <textarea className="field min-h-16" maxLength={500} aria-label="Mileage in reason" placeholder="Reason, at least 10 characters" value={overrideReason} onChange={(event) => setOverrideReason(event.target.value)} />
              <Button type="button" onClick={() => {
                const next = Number(mileageDraft);
                const result = shop.recordMileageOverride(order.id, next, overrideReason);
                setMileageError(result.error ?? "");
                if (result.ok) setOverrideReason("");
              }}>Save mileage with a reason</Button>
            </div>
          ) : null}
        </Field>
        <Field label="Mileage out">
          <input
            className="field tabular-nums"
            disabled={locked}
            inputMode="numeric"
            value={outDraft}
            placeholder="When it leaves"
            onChange={(event) => {
              setOutDraft(event.target.value);
              setOutError("");
            }}
            onBlur={() => {
              if (locked) return;
              if (!outDraft.trim()) {
                setOutError("");
                shop.updateOrder(order.id, { mileageOut: null });
                return;
              }
              const next = Number(outDraft);
              if (!Number.isFinite(next) || next < 0) {
                setOutError("Mileage out has to be zero or more.");
                return;
              }
              const gap = mileageOutGapMessage(order.mileage, next);
              if (gap) {
                setOutError(gap);
                return;
              }
              if (next < order.mileage) {
                setOutError("Mileage out can't be lower than mileage in. This can't be overridden.");
                return;
              }
              setOutError("");
              shop.updateOrder(order.id, { mileageOut: next });
            }}
          />
          {outError ? <p role="alert" className="mt-1 text-sm text-[#8a3b2a]">{outError}</p> : null}
          {!locked && (outError.startsWith("Mileage out can't be more than 10,000") || outError.startsWith("Add a reason")) && actor === "service-manager" ? (
            <div className="mt-2 grid gap-2">
              <textarea className="field min-h-16" maxLength={500} aria-label="Mileage out reason" placeholder="Reason, at least 10 characters" value={outReason} onChange={(event) => setOutReason(event.target.value)} />
              <Button
                type="button"
                small
                onClick={() => {
                  const next = Number(outDraft);
                  const result = shop.recordMileageOutOverride(order.id, next, outReason);
                  setOutError(result.error ?? "");
                  if (result.ok) {
                    setOutDraft(String(next));
                    setOutReason("");
                  }
                }}
              >
                Save mileage out with a reason
              </Button>
            </div>
          ) : null}
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
                <textarea id={`job-${job.id}-concern`} className="field min-h-20" rows={2} maxLength={500} disabled={locked} value={job.concern} onChange={(event) => shop.updateJob(order.id, job.id, { concern: event.target.value })} />
              </Field>
              <Field label="Cause">
                <textarea id={`job-${job.id}-cause`} className="field min-h-20" rows={2} maxLength={500} disabled={locked} placeholder="What you found" value={job.cause} onChange={(event) => shop.updateJob(order.id, job.id, { cause: event.target.value })} />
              </Field>
              <Field label="Correction">
                <textarea id={`job-${job.id}-correction`} className="field min-h-20" rows={2} disabled={locked} placeholder="What you did" value={job.correction} onChange={(event) => shop.updateJob(order.id, job.id, { correction: event.target.value })} />
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
                <p className="font-semibold">{order.jobs.find((job) => job.id === line.jobId)?.code ? `Line ${order.jobs.find((job) => job.id === line.jobId)?.code} · ` : ""}{line.opcode} · {line.description}</p>
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
              {!locked && order.jobs.some((job) => job.needsAssignment) ? (
                <Field label="Assign to">
                  <select className="field" aria-label={`Assign ${line.opcode}`} value={line.jobId ?? ""} onChange={(event) => shop.moveWorkToJob(order.id, "labor", line.id, event.target.value)}>
                    {order.jobs.map((job) => (
                      <option key={job.id} value={job.id} disabled={Boolean(job.needsAssignment)}>{job.code}{job.needsAssignment ? " · needs assignment" : ""}</option>
                    ))}
                  </select>
                </Field>
              ) : null}
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
              if (!laborDesc.trim() || !parsed || !laborTarget) return;
              shop.addLabor(order.id, {
                opcode: opcode.trim() || "MISC",
                description: laborDesc.trim(),
                hours: parsed,
                rate: rateFor(pay, shop.payTypes),
                payType: pay,
                techId,
                jobId: laborTarget,
              });
              if (!opId) setLaborDesc("");
            }}
          >
            {lineChoices.length > 1 ? (
              <Field label="Line">
                <select className="field" aria-label="Labor line" value={laborTarget} onChange={(event) => setLaborJobId(event.target.value)}>
                  {lineChoices.map((job) => <option key={job.id} value={job.id}>Line {job.code}</option>)}
                </select>
              </Field>
            ) : null}
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
              <Field label="Description"><input className="field" maxLength={500} value={laborDesc} onChange={(event) => setLaborDesc(event.target.value)} placeholder="What the tech is doing" /></Field>
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
                <p className="font-semibold">{order.jobs.find((job) => job.id === line.jobId)?.code ? `Line ${order.jobs.find((job) => job.id === line.jobId)?.code} · ` : ""}{line.number}</p>
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
                {!locked && order.jobs.some((job) => job.needsAssignment) ? (
                  <Field label="Assign to">
                    <select className="field" aria-label={`Assign ${line.number}`} value={line.jobId ?? ""} onChange={(event) => shop.moveWorkToJob(order.id, "part", line.id, event.target.value)}>
                      {order.jobs.map((job) => (
                        <option key={job.id} value={job.id} disabled={Boolean(job.needsAssignment)}>{job.code}{job.needsAssignment ? " · needs assignment" : ""}</option>
                      ))}
                    </select>
                  </Field>
                ) : null}
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
              if (!part || !parsed || !partTarget) return;
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
                jobId: partTarget,
              });
            }}
          >
            {lineChoices.length > 1 ? (
              <Field label="Line">
                <select className="field" aria-label="Part line" value={partTarget} onChange={(event) => setPartJobId(event.target.value)}>
                  {lineChoices.map((job) => <option key={job.id} value={job.id}>Line {job.code}</option>)}
                </select>
              </Field>
            ) : null}
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
      {sealed ? (
        <div className="mt-4 grid gap-1">
          <p className="font-semibold">{order.closeType === "no_work" ? "Closed — no work ($0)" : "Closed"}</p>
          <p className="text-sm">{order.closeNote}</p>
          {order.droppedFeesNote ? <p className="text-sm text-muted">{order.droppedFeesNote}</p> : null}
          <p className="text-sm text-muted">{displayRecordedName(order.closedBy)} · {displayRecordedWhen(order.closedAt)}</p>
          <p className="text-sm text-muted">This repair order is closed. It can be viewed, and it can't be changed.</p>
        </div>
      ) : viewOnly ? null : (
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
      {!viewOnly && !sealed && canClose ? (
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
      {!viewOnly && !sealed && !canClose ? <p className="mt-2 text-sm text-muted">An advisor or service manager closes this repair order.</p> : null}
      {!viewOnly && !booked && !sealed && (!readyToInvoice(order) || !hasBookedWork(order)) ? (
        <ul className="mt-2 grid gap-1 text-sm text-muted">
          <li>Book stays off until this repair order is ready:</li>
          {!order.labor.some((line) => line.hours > 0) ? <li>Add labor hours.</li> : null}
          {!order.labor.some((line) => line.techId.trim()) ? <li>Assign a technician on a labor line.</li> : null}
          {orderMoney(order).ticket <= 0 ? <li>Add a labor or parts cost.</li> : null}
          {!readyToInvoice(order) ? <li>Fill the Washington authorization so it covers the ticket.</li> : null}
          {gaps.filter((gap) => /^(Concern|Cause|Correction) on line /.test(gap)).map((gap) => <li key={gap}>{gap}</li>)}
        </ul>
      ) : null}
      {!viewOnly && !sealed && !booked && readyToInvoice(order) && hasBookedWork(order) && gaps.some((gap) => /^(Concern|Cause|Correction) on line /.test(gap)) ? (
        <ul className="mt-2 grid gap-1 text-sm text-muted">
          <li>Book stays available. Close still needs:</li>
          {gaps.filter((gap) => /^(Concern|Cause|Correction) on line /.test(gap)).map((gap) => <li key={gap}>{gap}</li>)}
        </ul>
      ) : null}
      {!viewOnly && closeError ? (
        <div role="alert" className="mt-2 grid gap-1 text-sm text-[#8a3b2a]">
          {closeError.split("\n").map((gap) => {
            const match = /^(Concern|Cause|Correction) on line (\S+)/.exec(gap);
            const job = match ? (order.jobs ?? []).find((row) => row.code === match[2]) : undefined;
            if (!match || !job) return <p key={gap}>{gap}</p>;
            const field = match[1].toLowerCase();
            return (
              <button
                key={gap}
                type="button"
                className="text-left underline"
                onClick={() => {
                  const target = document.getElementById(`job-${job.id}-${field}`);
                  target?.scrollIntoView({ block: "center" });
                  target?.focus();
                }}
              >
                {gap}
              </button>
            );
          })}
        </div>
      ) : null}
      {!viewOnly && booked && gaps.length > 0 ? (
        <ul className="mt-2 grid gap-1 text-sm text-muted">
          {gaps.map((gap) => {
            const match = /^(Concern|Cause|Correction) on line (\S+)/.exec(gap);
            const job = match ? (order.jobs ?? []).find((row) => row.code === match[2]) : undefined;
            if (!match || !job) return <li key={gap}>{gap}</li>;
            const field = match[1].toLowerCase();
            return (
              <li key={gap}>
                <button
                  type="button"
                  className="text-left underline"
                  onClick={() => {
                    const target = document.getElementById(`job-${job.id}-${field}`);
                    target?.scrollIntoView({ block: "center" });
                    target?.focus();
                  }}
                >
                  {gap}
                </button>
              </li>
            );
          })}
        </ul>
      ) : null}
      <WaAuth orderId={order.id} />
      {(order.history ?? []).length > 0 ? (
        <ul className="mt-3 grid gap-1 text-sm text-muted">
          {(order.history ?? []).map((entry) => (
            <li key={`${entry.at}-${entry.kind}-${entry.text}`}>{entry.text} · {displayRecordedName(entry.who)} · {displayRecordedWhen(entry.at)}</li>
          ))}
        </ul>
      ) : null}
    </Modal>
  );
}
