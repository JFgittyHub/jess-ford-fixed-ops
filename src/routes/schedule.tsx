import { createFileRoute } from "@tanstack/react-router";
import { Calendar } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { AppointmentCalendar, TECH_DAY_GOAL, addDays, clockRange, clockTime, dayLabel, flagHours } from "@/components/appointment-calendar";
import { NewOrder } from "@/components/new-order";
import { Shell } from "@/components/shell";
import { Button, Field, Modal, Pill } from "@/components/ui";
import { LANE_LABEL, snapHalfHour, TODAY } from "@/lib/format";
import { lineLetter } from "@/lib/jobs";
import { lookups } from "@/lib/metrics";
import { useShop } from "@/lib/store";
import { useSession } from "@/lib/session";
import type { Appointment } from "@/lib/types";

export const Route = createFileRoute("/schedule")({ component: SchedulePage });

const LENGTHS = [30, 60, 90, 120, 180, 240];

function laborHours(row: Appointment, laborOps: { id: string; hours: number }[]) {
  return row.laborOpIds.reduce((sum, id) => sum + (laborOps.find((op) => op.id === id)?.hours ?? 0), 0);
}
const STARTS = Array.from({ length: 22 }, (_, index) => {
  const mins = 7 * 60 + index * 30;
  return `${String(Math.floor(mins / 60)).padStart(2, "0")}:${String(mins % 60).padStart(2, "0")}`;
});

function SchedulePage() {
  const shop = useShop();
  const { session } = useSession();
  const look = lookups(shop);
  const [preset, setPreset] = useState<Appointment | null>(null);
  const [customerId, setCustomerId] = useState(shop.customers[0]?.id ?? "");
  const vehicles = shop.vehicles.filter((vehicle) => vehicle.customerId === customerId);
  const [vehicleId, setVehicleId] = useState(vehicles[0]?.id ?? "");
  const [advisorId, setAdvisorId] = useState(shop.advisors[0]?.id ?? "");
  const [techId, setTechId] = useState(shop.techs[0]?.id ?? "");
  const [date, setDate] = useState(TODAY);
  const [time, setTime] = useState("15:30");
  const [minutes, setMinutes] = useState(60);
  const [concern, setConcern] = useState("");
  const [lane, setLane] = useState<Appointment["lane"]>("drop");
  const [day, setDay] = useState(TODAY);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [booking, setBooking] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);

  const resolvedVehicle = vehicles.some((vehicle) => vehicle.id === vehicleId) ? vehicleId : vehicles[0]?.id ?? "";
  const selected = shop.appointments.find((row) => row.id === selectedId) ?? null;
  const editing = shop.appointments.find((row) => row.id === editingId) ?? null;

  function openAppointment(id: string) {
    setSelectedId(id);
    setEditingId(id);
  }
  const noShows = shop.appointments.filter((row) => row.date === TODAY && row.status === "no_show").length;
  const inShop = shop.appointments.filter((row) => row.date === TODAY && (row.status === "in_shop" || row.status === "arrived")).length;
  const lockedTech = session?.role === "tech" ? session.id : "";
  const rank = { express: 0, main: 1, internal: 2, none: 3 };
  const board = [...shop.techs]
    .filter((tech) => (lockedTech ? tech.id === lockedTech : tech.board !== "none"))
    .sort((a, b) => rank[a.board] - rank[b.board] || a.number.localeCompare(b.number, undefined, { numeric: true }));
  const dayHours = shop.appointments
    .filter((row) => row.date === day && (!lockedTech || row.techId === lockedTech))
    .reduce((sum, row) => sum + laborHours(row, shop.laborOps), 0);

  return (
    <Shell>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-sm font-semibold uppercase tracking-wide text-muted">Appointments</p>
          <h1 className="mt-1 flex flex-wrap items-baseline gap-3 font-display text-5xl leading-none tracking-tight">
            {day === TODAY ? "Today" : dayLabel(day)}
            <span className="text-2xl tabular-nums text-muted">{flagHours(dayHours)} / {board.length * TECH_DAY_GOAL} hrs</span>
          </h1>
          <p className="mt-2 max-w-xl text-muted">
            {inShop} in or through the drive today. {noShows} no-show. Each column is a technician. Drag a card across to move it.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {lockedTech ? null : <Button small tone="primary" onClick={() => { setDate(day); setTime("15:00"); setBooking(true); }}>Book appointment</Button>}
          <Button small onClick={() => setDay((value) => addDays(value, -1))}>Previous</Button>
          <p className="min-w-40 text-center text-sm font-semibold">{dayLabel(day)}</p>
          <DayJump value={day} onChange={setDay} />
          <Button small onClick={() => setDay((value) => addDays(value, 1))}>Next</Button>
        </div>
      </div>

      <AppointmentCalendar
        appointments={shop.appointments}
        day={day}
        techs={board.map((tech) => ({ id: tech.id, number: tech.number, name: tech.name, board: tech.board }))}
        selectedId={selectedId}
        onSelect={(id) => openAppointment(id)}
        onSlot={(nextTech, nextTime) => {
          setDate(day);
          setTechId(nextTech);
          setTime(nextTime);
          setConcern("");
          setBooking(true);
        }}
        onMove={(id, patch) => shop.moveAppointment(id, patch)}
        onWrite={(id) => {
          const row = shop.appointments.find((item) => item.id === id);
          if (row) setPreset(row);
        }}
        onEdit={(id) => openAppointment(id)}
        label={(row) => look.customer.get(row.customerId)?.name ?? "Customer"}
        hoursFor={(row) => laborHours(row, shop.laborOps)}
        summary={(row) => {
          const customer = look.customer.get(row.customerId);
          const vehicle = look.vehicle.get(row.vehicleId);
          const advisor = look.advisor.get(row.advisorId);
          return {
            name: customer?.name ?? "Customer",
            vehicle: vehicle ? `${vehicle.year} Ford ${vehicle.model}` : "No vehicle",
            advisor: advisor?.name ?? "Advisor",
            tech: look.tech.get(row.techId) ? `#${look.tech.get(row.techId)?.number} ${look.tech.get(row.techId)?.name}` : "No technician",
            when: `${dayLabel(row.date)} · ${clockRange(row.time, row.minutes)}`,
            lane: LANE_LABEL[row.lane],
            concern: row.concern,
            vin: row.vin || look.vehicle.get(row.vehicleId)?.vin || "No VIN",
            ops: row.laborOpIds.length
              ? row.laborOpIds.map((id) => shop.laborOps.find((op) => op.id === id)?.opcode).filter(Boolean).join(", ")
              : "No labor ops",
            status: row.status === "no_show" ? "No-show" : row.status === "in_shop" ? "In shop" : row.status === "arrived" ? "Arrived" : "Scheduled",
            canWrite: session?.role !== "tech" && !row.orderId && row.status !== "no_show",
          };
        }}
      />

      {selected ? (
        <Selected
          row={selected}
          name={look.customer.get(selected.customerId)?.name ?? "Customer"}
          vehicle={look.vehicle.get(selected.vehicleId)}
          onStatus={(status) => shop.setAppointmentStatus(selected.id, status)}
          onWrite={() => setPreset(selected)}
          onEdit={() => openAppointment(selected.id)}
        />
      ) : null}

      <Modal open={booking} onClose={() => setBooking(false)} title="Book an appointment" description={`${dayLabel(date)} at ${clockTime(time)}.`}>
        <AppointmentFields
          key={`${date}-${time}-${techId}`}
          customers={shop.customers}
          vehicles={shop.vehicles}
          advisors={shop.advisors}
          techs={board}
          laborOps={shop.laborOps}
          submitLabel="Book it"
          initial={{ date, time, minutes, customerId, vehicleId: resolvedVehicle, advisorId, techId, concern: "", lines: [{ id: "new-a", code: "A", concern: "" }], vin: shop.vehicles.find((vehicle) => vehicle.id === resolvedVehicle)?.vin ?? "", laborOpIds: [], lane, status: "scheduled" }}
          onSubmit={(value) => {
            shop.addAppointment(value);
            setConcern("");
            setBooking(false);
          }}
        />
      </Modal>

      <Modal open={editing !== null} onClose={() => setEditingId(null)} title="Appointment details" description={editing ? `${dayLabel(editing.date)} · ${editing.time}` : undefined}>
        {editing ? (
          <AppointmentFields
            key={editing.id}
            customers={shop.customers}
            vehicles={shop.vehicles}
            advisors={shop.advisors}
            techs={board}
            laborOps={shop.laborOps}
            submitLabel="Save changes"
            showStatus
            initial={editing}
            onSubmit={(value) => {
              shop.updateAppointment(editing.id, value);
              setEditingId(null);
            }}
          />
        ) : null}
      </Modal>

      <NewOrder
        open={preset !== null}
        onClose={() => setPreset(null)}
        preset={preset ? {
          customerId: preset.customerId,
          vehicleId: preset.vehicleId,
          advisorId: preset.advisorId,
          concern: preset.concern,
          lines: preset.lines,
          laborOpIds: preset.laborOpIds,
          appointmentId: preset.id,
        } : undefined}
      />
    </Shell>
  );
}

function Selected({
  row,
  name,
  vehicle,
  onStatus,
  onWrite,
  onEdit,
}: {
  row: Appointment;
  name: string;
  vehicle?: { year: number; model: string };
  onStatus: (status: Appointment["status"]) => void;
  onWrite: () => void;
  onEdit: () => void;
}) {
  const { session } = useSession();
  return (
    <div className="card mt-3 flex flex-wrap items-center justify-between gap-3">
      <div>
        <p className="font-semibold">{name}</p>
        <p className="text-sm text-muted">{vehicle ? `${vehicle.year} Ford ${vehicle.model}` : ""} · {row.concern}</p>
        <p className="text-sm text-muted">{dayLabel(row.date)} · {clockRange(row.time, row.minutes)} · {LANE_LABEL[row.lane]}</p>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Pill tone={row.status === "no_show" ? "bad" : row.status === "in_shop" ? "good" : undefined}>
          {row.status === "no_show" ? "No-show" : row.status === "in_shop" ? "In shop" : row.status === "arrived" ? "Arrived" : "Scheduled"}
        </Pill>
        {row.status === "scheduled" ? <Button small onClick={() => onStatus("arrived")}>Arrived</Button> : null}
        {row.status === "scheduled" ? <Button small onClick={() => onStatus("no_show")}>No-show</Button> : null}
        {row.status === "no_show" ? <Button small onClick={() => onStatus("scheduled")}>Put back</Button> : null}
        <Button small onClick={onEdit}>Edit details</Button>
        {session?.role === "tech" || row.orderId || row.status === "no_show" ? null : <Button small tone="primary" onClick={onWrite}>Write RO</Button>}
      </div>
    </div>
  );
}

function AppointmentFields({
  initial,
  customers,
  vehicles,
  advisors,
  techs,
  laborOps,
  submitLabel,
  showStatus,
  onSubmit,
}: {
  initial: Pick<Appointment, "date" | "time" | "minutes" | "customerId" | "vehicleId" | "advisorId" | "techId" | "concern" | "lines" | "vin" | "laborOpIds" | "lane" | "status">;
  customers: { id: string; name: string }[];
  vehicles: { id: string; customerId: string; year: number; model: string; vin: string }[];
  advisors: { id: string; number: string; name: string }[];
  techs: { id: string; number: string; name: string }[];
  laborOps: { id: string; opcode: string; description: string; hours: number }[];
  submitLabel: string;
  showStatus?: boolean;
  onSubmit: (value: Pick<Appointment, "date" | "time" | "minutes" | "customerId" | "vehicleId" | "advisorId" | "techId" | "concern" | "lines" | "vin" | "laborOpIds" | "lane" | "status">) => void;
}) {
  const { session } = useSession();
  const lockedAdvisor = session?.role === "advisor" ? session.id : "";
  const [date, setDate] = useState(initial.date);
  const [time, setTime] = useState(snapHalfHour(initial.time));
  const [minutes, setMinutes] = useState(initial.minutes);
  const [customerId, setCustomerId] = useState(initial.customerId);
  const [vehicleId, setVehicleId] = useState(initial.vehicleId);
  const [advisorId, setAdvisorId] = useState(initial.advisorId);
  const [techId, setTechId] = useState(initial.techId);
  const [lines, setLines] = useState(initial.lines?.length ? initial.lines : [{ id: "a", code: "A", concern: initial.concern }]);
  const [vin, setVin] = useState(initial.vin);
  const [laborOpIds, setLaborOpIds] = useState(initial.laborOpIds ?? []);
  const [lane, setLane] = useState(initial.lane);
  const [status, setStatus] = useState(initial.status);
  const owned = vehicles.filter((vehicle) => vehicle.customerId === customerId);
  const resolvedVehicle = owned.some((vehicle) => vehicle.id === vehicleId) ? vehicleId : owned[0]?.id ?? "";
  const lengths = [...new Set([...LENGTHS, initial.minutes])].sort((a, b) => a - b);

  return (
    <form
      className="grid gap-3"
      onSubmit={(event) => {
        event.preventDefault();
        if (!lines.some((line) => line.concern.trim()) || !resolvedVehicle) return;
        const kept = lines.map((line, index) => ({ ...line, code: lineLetter(index), concern: line.concern.trim() })).filter((line) => line.concern);
        onSubmit({ date, time, minutes, customerId, vehicleId: resolvedVehicle, advisorId: lockedAdvisor || advisorId, techId, lines: kept, concern: kept.map((line) => `${line.code}. ${line.concern}`).join(" · "), vin: vin.trim().toUpperCase(), laborOpIds, lane, status });
      }}
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Day"><input className="field" type="date" value={date} onChange={(event) => setDate(event.target.value)} /></Field>
        <Field label="Starts">
          <select className="field" value={STARTS.includes(time) ? time : snapHalfHour(time)} onChange={(event) => setTime(event.target.value)}>
            {STARTS.map((item) => <option key={item} value={item}>{clockTime(item)}</option>)}
          </select>
        </Field>
        <Field label="Length">
          <select className="field" value={minutes} onChange={(event) => setMinutes(Number(event.target.value))}>
            {lengths.map((item) => <option key={item} value={item}>{item < 60 ? `${item} min` : `${item / 60} hr`}</option>)}
          </select>
        </Field>
        <Field label="Lane">
          <select className="field" value={lane} onChange={(event) => setLane(event.target.value as Appointment["lane"])}>
            {(Object.keys(LANE_LABEL) as Appointment["lane"][]).map((item) => <option key={item} value={item}>{LANE_LABEL[item]}</option>)}
          </select>
        </Field>
      </div>
      <Field label="Customer">
        <select className="field" value={customerId} onChange={(event) => {
          const next = event.target.value;
          setCustomerId(next);
          const first = vehicles.find((vehicle) => vehicle.customerId === next);
          setVehicleId(first?.id ?? "");
          setVin(first?.vin ?? "");
        }}>
          {customers.map((customer) => <option key={customer.id} value={customer.id}>{customer.name}</option>)}
        </select>
      </Field>
      <Field label="Vehicle">
        <select className="field" value={resolvedVehicle} onChange={(event) => {
          setVehicleId(event.target.value);
          setVin(vehicles.find((vehicle) => vehicle.id === event.target.value)?.vin ?? "");
        }}>
          {owned.map((vehicle) => <option key={vehicle.id} value={vehicle.id}>{vehicle.year} Ford {vehicle.model}</option>)}
        </select>
      </Field>
      <Field label="VIN">
        <input className="field font-mono uppercase" value={vin} maxLength={17} spellCheck={false} onChange={(event) => setVin(event.target.value.toUpperCase())} />
      </Field>
      <Field label="Labor op">
        <select
          className="field"
          value=""
          onChange={(event) => {
            const id = event.target.value;
            if (!id || laborOpIds.includes(id)) return;
            setLaborOpIds((rows) => [...rows, id]);
          }}
        >
          <option value="">Add a labor op</option>
          {laborOps.map((op) => <option key={op.id} value={op.id}>{op.opcode} · {op.description} · {op.hours} hr</option>)}
        </select>
      </Field>
      {laborOpIds.length > 0 ? (
        <ul className="grid gap-1">
          {laborOpIds.map((id) => {
            const op = laborOps.find((row) => row.id === id);
            return (
              <li key={id} className="flex items-center justify-between gap-2 text-sm">
                <span>{op ? `${op.opcode} · ${op.description}` : id}</span>
                <Button small type="button" onClick={() => setLaborOpIds((rows) => rows.filter((row) => row !== id))}>Remove</Button>
              </li>
            );
          })}
        </ul>
      ) : null}
      <Field label="Technician">
        <select className="field" value={techId} onChange={(event) => setTechId(event.target.value)}>
          {techs.map((tech) => <option key={tech.id} value={tech.id}>#{tech.number} · {tech.name}</option>)}
        </select>
      </Field>
      <Field label="Advisor">
        <select className="field" value={lockedAdvisor || advisorId} disabled={Boolean(lockedAdvisor)} onChange={(event) => setAdvisorId(event.target.value)}>
          {advisors.map((advisor) => <option key={advisor.id} value={advisor.id}>#{advisor.number} {advisor.name}</option>)}
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
              <input className="field" value={line.concern} onChange={(event) => setLines((rows) => rows.map((row) => row.id === line.id ? { ...row, concern: event.target.value } : row))} />
            </Field>
          </div>
        ))}
        <div>
          <Button small type="button" onClick={() => setLines((rows) => [...rows, { id: `new-${rows.length}-${lineLetter(rows.length)}`, code: lineLetter(rows.length), concern: "" }])}>Add line</Button>
        </div>
      </div>
      {showStatus ? (
        <Field label="Status">
          <select className="field" value={status} onChange={(event) => setStatus(event.target.value as Appointment["status"])}>
            <option value="scheduled">Scheduled</option>
            <option value="arrived">Arrived</option>
            <option value="in_shop">In shop</option>
            <option value="no_show">No-show</option>
          </select>
        </Field>
      ) : null}
      <Button tone="primary" type="submit">{submitLabel}</Button>
    </form>
  );
}

const WEEKDAYS = ["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"];

function DayJump({ value, onChange }: { value: string; onChange: (iso: string) => void }) {
  const [open, setOpen] = useState(false);
  const [cursor, setCursor] = useState(() => value.slice(0, 7));
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => setCursor(value.slice(0, 7)), [value]);

  useEffect(() => {
    if (!open) return;
    function onPointer(event: MouseEvent) {
      if (!box.current?.contains(event.target as Node)) setOpen(false);
    }
    window.addEventListener("mousedown", onPointer);
    return () => window.removeEventListener("mousedown", onPointer);
  }, [open]);

  const [year, month] = cursor.split("-").map(Number);
  const first = new Date(year, (month || 1) - 1, 1);
  const count = new Date(year, month || 1, 0).getDate();
  const cells: Array<string | null> = Array.from({ length: first.getDay() }, () => null);
  for (let day = 1; day <= count; day += 1) {
    cells.push(`${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`);
  }
  const title = first.toLocaleDateString("en-US", { month: "long", year: "numeric" });

  function shift(months: number) {
    const next = new Date(year, (month || 1) - 1 + months, 1);
    setCursor(`${next.getFullYear()}-${String(next.getMonth() + 1).padStart(2, "0")}`);
  }

  return (
    <div className="relative" ref={box}>
      <Button small aria-label="Jump to a date" aria-expanded={open} onClick={() => setOpen((shown) => !shown)}>
        <Calendar className="size-4" aria-hidden />
      </Button>
      {open ? (
        <div className="absolute right-0 z-40 mt-2 w-64 rounded-md border border-line bg-surface-2 p-3 shadow-card">
          <div className="flex items-center justify-between gap-2">
            <Button small aria-label="Previous month" onClick={() => shift(-1)}>‹</Button>
            <p className="text-sm font-semibold">{title}</p>
            <Button small aria-label="Next month" onClick={() => shift(1)}>›</Button>
          </div>
          <div className="mt-2 grid grid-cols-7 gap-1 text-center text-xs text-muted">
            {WEEKDAYS.map((name) => <span key={name}>{name}</span>)}
          </div>
          <div className="mt-1 grid grid-cols-7 gap-1">
            {cells.map((iso, index) => iso ? (
              <button
                key={iso}
                type="button"
                className={`h-8 rounded-md text-sm tabular-nums ${iso === value ? "bg-primary text-primary-fg" : iso === TODAY ? "bg-primary-soft" : "hover:bg-surface"}`}
                onClick={() => { onChange(iso); setOpen(false); }}
              >
                {Number(iso.slice(-2))}
              </button>
            ) : <span key={`pad-${index}`} />)}
          </div>
          <Button small className="mt-2 w-full" onClick={() => { onChange(TODAY); setOpen(false); }}>Today</Button>
        </div>
      ) : null}
    </div>
  );
}
