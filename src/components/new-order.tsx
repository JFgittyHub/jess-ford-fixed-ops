import { useEffect, useState } from "react";
import { PROMISE_TIMES, clockTime } from "@/lib/format";
import { lineLetter } from "@/lib/jobs";
import { lastVisitHint, lastVisitMileage, mileageFloorMessage, mileageOutGapMessage } from "@/lib/mileage";
import { phoneDigitError } from "@/lib/range";
import { mileageReasonError } from "@/lib/ro";
import { deskActor } from "@/lib/cancel";
import { rateFor } from "@/lib/pay";
import { noShowSuffix } from "@/lib/no-show-label";
import { useShop } from "@/lib/store";
import { Button, Field, Modal } from "./ui";

type DraftLine = { id: string; concern: string };

let draftSeq = 0;
function draftLine(concern = ""): DraftLine {
  draftSeq += 1;
  return { id: `d${draftSeq}`, concern };
}

type NewOrderPreset = {
  customerId?: string;
  vehicleId?: string;
  advisorId?: string;
  concern?: string;
  lines?: { concern: string }[];
  laborOpIds?: string[];
  appointmentId?: string;
  mileage?: string;
};

function presetIdentity(preset?: NewOrderPreset) {
  return [
    preset?.appointmentId ?? "",
    preset?.customerId ?? "",
    preset?.vehicleId ?? "",
    preset?.advisorId ?? "",
    preset?.concern ?? "",
    (preset?.lines ?? []).map((line) => line.concern).join("\n"),
    (preset?.laborOpIds ?? []).join(","),
  ].join("\u001f");
}

export function NewOrder(props: {
  open: boolean;
  onClose: () => void;
  preset?: NewOrderPreset;
}) {
  // The dialog stays mounted on the schedule and marketing pages. A fresh key
  // re-reads the appointment or customer that was just passed in.
  return <NewOrderForm key={props.open ? presetIdentity(props.preset) : "closed"} {...props} />;
}

function NewOrderForm({
  open,
  onClose,
  preset,
}: {
  open: boolean;
  onClose: () => void;
  preset?: NewOrderPreset;
}) {
  const shop = useShop();
  const [mode, setMode] = useState<"existing" | "new">("existing");
  const [customerId, setCustomerId] = useState(preset?.customerId ?? shop.customers[0]?.id ?? "");
  const vehicles = shop.vehicles.filter((vehicle) => vehicle.customerId === customerId);
  const [vehicleId, setVehicleId] = useState(preset?.vehicleId ?? vehicles[0]?.id ?? "");
  const [advisorId, setAdvisorId] = useState(preset?.advisorId ?? shop.advisors[0]?.id ?? "");
  const [lines, setLines] = useState<DraftLine[]>([draftLine(preset?.concern ?? "")]);
  const [mileage, setMileage] = useState("");
  const [mileageOut, setMileageOut] = useState("");
  const [promiseTime, setPromiseTime] = useState("16:00");
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [year, setYear] = useState("");
  const [formError, setFormError] = useState("");
  const [model, setModel] = useState("");
  const [make, setMake] = useState("");
  const [vin, setVin] = useState("");
  const [vinWarning, setVinWarning] = useState("");
  const [vinConfirmed, setVinConfirmed] = useState(false);
  const [mileageReason, setMileageReason] = useState("");

  const seeded = preset?.lines?.map((line) => line.concern.trim()).filter(Boolean).join("\n") || preset?.concern || "";

  useEffect(() => {
    if (!open) return;
    const next = seeded ? seeded.split("\n") : [""];
    setLines(next.map((concern) => draftLine(concern)));
    if (preset?.mileage) setMileage(preset.mileage);
  }, [open, seeded, preset?.mileage]);

  const resolvedVehicle = vehicles.some((vehicle) => vehicle.id === vehicleId) ? vehicleId : vehicles[0]?.id ?? "";
  const pickedVehicle = shop.vehicles.find((row) => row.id === (mode === "new" ? "" : resolvedVehicle));
  const visitHint = lastVisitHint(lastVisitMileage(Object.values(shop.stores ?? {}), pickedVehicle, { openedAt: new Date().toISOString() }));
  const canOverrideMileage = deskActor(shop) === "service-manager";
  const written = lines.map((line) => line.concern.trim()).filter(Boolean);

  return (
    <Modal open={open} onClose={onClose} wide title="Write a repair order" description="Each concern is its own line. Labor and parts go on after the write-up.">
      <div className="mb-3 flex gap-2">
        <Button small tone={mode === "existing" ? "primary" : "ghost"} onClick={() => setMode("existing")}>On file</Button>
        <Button small tone={mode === "new" ? "primary" : "ghost"} onClick={() => setMode("new")}>New customer</Button>
      </div>
      <form
        className="grid gap-3"
        onSubmit={(event) => {
          event.preventDefault();
          let nextCustomer = customerId;
          let nextVehicle = resolvedVehicle;
          if (mode === "new") {
            const parsedYear = Number(year);
            const problems: string[] = [];
            if (!year.trim() || !Number.isFinite(parsedYear) || parsedYear <= 0) problems.push("Add the year.");
            if (!make.trim()) problems.push("Add the make.");
            if (!name.trim() || !model.trim()) problems.push("Add the customer name and model.");
            if (phone.trim() && phoneDigitError(phone)) problems.push(phoneDigitError(phone) ?? "");
            if (problems.length > 0) {
              setFormError(problems.join(" "));
              return;
            }
            const cleanedVin = vin.trim().toUpperCase();
            const created = shop.createCustomer({
              name,
              phone,
              year: parsedYear,
              make: make.trim(),
              model,
              vin: cleanedVin,
            });
            if (created.error || !created.customerId) {
              setFormError(created.error || "That customer was not added.");
              return;
            }
            if (created.warning && !vinConfirmed) {
              setVinWarning(created.warning);
              setVinConfirmed(true);
              setFormError(created.warning);
              return;
            }
            nextCustomer = created.customerId;
            nextVehicle = created.vehicleId;
          }
          const problems: string[] = [];
          if (!nextCustomer || !nextVehicle) problems.push("Add the customer and vehicle.");
          if (written.length === 0) problems.push("Add a concern.");
          const miles = Number(mileage);
          const vehicle = shop.vehicles.find((row) => row.id === nextVehicle);
          const lastVisit = lastVisitMileage(Object.values(shop.stores ?? {}), vehicle, { openedAt: new Date().toISOString() });
          const floor = mileageFloorMessage(miles, lastVisit);
          if (!mileage.trim() || !Number.isFinite(miles) || miles <= 0) problems.push("Mileage in has to be greater than zero.");
          else if (miles > 999999) problems.push("Mileage in can't be over 999,999.");
          else if (floor && (deskActor(shop) !== "service-manager" || mileageReasonError(mileageReason))) problems.push(floor);
          const outRaw = mileageOut.trim();
          const out = outRaw === "" ? null : Number(outRaw);
          if (out != null && (!Number.isFinite(out) || mileageOutGapMessage(miles, out) || out < miles)) {
            problems.push(mileageOutGapMessage(miles, Number.isFinite(out) ? out : null) ?? "Mileage out can't be lower than mileage in.");
          }
          if (problems.length > 0) {
            setFormError(problems.join(" "));
            return;
          }
          const booked = preset?.appointmentId
            ? shop.appointments.find((row) => row.id === preset.appointmentId)
            : undefined;
          const carriedTech = booked ? (booked.techId ?? "").trim() : (shop.techs[0]?.id ?? "");
          const id = shop.createOrder({
            customerId: nextCustomer,
            vehicleId: nextVehicle,
            advisorId,
            lines: written.map((concern) => ({ concern })),
            mileage: miles,
            mileageReason: floor ? mileageReason : undefined,
            mileageOut: out,
            promiseTime,
            labor: (preset?.laborOpIds ?? []).flatMap((opId) => {
              const op = shop.laborOps.find((row) => row.id === opId);
              if (!op) return [];
              return [{
                opcode: op.opcode,
                description: op.description,
                hours: op.hours,
                rate: rateFor(op.payType, shop.payTypes),
                payType: op.payType,
                techId: carriedTech,
              }];
            }),
          });
          if (!id) {
            setFormError(floor ?? "Mileage in has to be greater than zero.");
            return;
          }
          setFormError("");
          if (preset?.appointmentId) shop.linkAppointment(preset.appointmentId, id);
          onClose();
        }}
      >
        {mode === "existing" ? (
          <>
            <Field label="Customer">
              <select
                className="field"
                value={customerId}
                onChange={(event) => {
                  setCustomerId(event.target.value);
                  const first = shop.vehicles.find((vehicle) => vehicle.customerId === event.target.value);
                  setVehicleId(first?.id ?? "");
                }}
              >
                {shop.customers.map((customer) => <option key={customer.id} value={customer.id}>{customer.name}{noShowSuffix(customer.noShows)}</option>)}
              </select>
            </Field>
            <Field label="Vehicle">
              <select className="field" value={resolvedVehicle} onChange={(event) => setVehicleId(event.target.value)}>
                {vehicles.map((vehicle) => <option key={vehicle.id} value={vehicle.id}>{vehicle.year} {vehicle.make || "Ford"} {vehicle.model}</option>)}
              </select>
            </Field>
          </>
        ) : (
          <>
            <Field label="Name"><input className="field" value={name} onChange={(event) => setName(event.target.value)} required /></Field>
            <Field label="Phone"><input className="field" maxLength={20} value={phone} onChange={(event) => setPhone(event.target.value)} onBlur={() => { if (phone.trim()) setFormError(phoneDigitError(phone) ?? ""); }} placeholder="(555) 010-0142" /></Field>
            <div className="grid gap-3 sm:grid-cols-3">
              <Field label="Year"><input className="field tabular-nums" type="number" min={1990} max={2027} placeholder="Year" value={year} onChange={(event) => setYear(event.target.value)} /></Field>
              <Field label="Make"><input className="field" value={make} onChange={(event) => setMake(event.target.value)} placeholder="Ford" /></Field>
              <Field label="Model"><input className="field" value={model} onChange={(event) => setModel(event.target.value)} placeholder="F-150" /></Field>
            </div>
            <Field label="VIN"><input className="field font-mono uppercase" aria-label="VIN" maxLength={17} value={vin} onChange={(event) => { setVin(event.target.value.toUpperCase()); setVinConfirmed(false); setVinWarning(""); }} placeholder="17 characters" /></Field>
            {vinWarning ? <p role="alert" className="text-sm text-[#8a3b2a]">{vinWarning} Submit again to use that vehicle.</p> : null}
          </>
        )}
        <Field label="Advisor">
          <select className="field" value={advisorId} onChange={(event) => setAdvisorId(event.target.value)}>
            {shop.advisors.map((advisor) => <option key={advisor.id} value={advisor.id}>#{advisor.number} {advisor.name}</option>)}
          </select>
        </Field>
        <div className="grid gap-3">
          {lines.map((line, index) => (
            <div key={line.id} className="grid gap-2">
              <div className="flex items-center justify-between gap-2">
                <p className="text-sm font-semibold">Line {lineLetter(index)}</p>
                {lines.length > 1 ? (
                  <Button small type="button" onClick={() => setLines((rows) => rows.filter((row) => row.id !== line.id))}>Remove</Button>
                ) : null}
              </div>
              <Field label="Concern">
                <input
                  className="field"
                  value={line.concern}
                  onChange={(event) => setLines((rows) => rows.map((row) => row.id === line.id ? { ...row, concern: event.target.value } : row))}
                />
              </Field>
            </div>
          ))}
          <div>
            <Button small type="button" onClick={() => setLines((rows) => [...rows, draftLine()])}>Add line</Button>
          </div>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Mileage in">
            <input className="field tabular-nums" aria-label="Mileage in" inputMode="numeric" value={mileage} onChange={(event) => setMileage(event.target.value)} />
            {visitHint ? <p className="mt-1 text-sm font-normal text-muted">{visitHint}</p> : null}
            {canOverrideMileage ? <textarea className="field mt-2 min-h-16" placeholder="Service manager reason if mileage is below the last visit" value={mileageReason} onChange={(event) => setMileageReason(event.target.value)} /> : null}
          </Field>
          <Field label="Mileage out"><input className="field tabular-nums" type="number" min={0} value={mileageOut} placeholder="Optional" onChange={(event) => setMileageOut(event.target.value)} /></Field>
          <Field label="Promise">
            <select className="field" value={promiseTime} onChange={(event) => setPromiseTime(event.target.value)}>
              <option value="">No promise</option>
              {PROMISE_TIMES.map((time) => <option key={time} value={time}>{clockTime(time)}</option>)}
            </select>
          </Field>
        </div>
        {formError ? <p role="alert" className="text-sm text-[#8a3b2a]">{formError}</p> : null}
        <Button tone="primary" type="submit">Open the RO</Button>
      </form>
    </Modal>
  );
}