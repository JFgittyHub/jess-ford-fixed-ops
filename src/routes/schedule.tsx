import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { Calendar } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { AppointmentCalendar, TECH_DAY_GOAL, addDays, clockRange, clockTime, dayLabel, flagHours } from "@/components/appointment-calendar";
import { CancelForm, CancelledHistory, DeskCancelActions } from "@/components/cancel-appointment";
import { NewOrder } from "@/components/new-order";
import { NoShowMark } from "@/components/no-show-mark";
import { Shell } from "@/components/shell";
import { Button, Field, Modal, Pill } from "@/components/ui";
import { VEHICLE_MISSING, bookingFormBlock, deskSeedFor, deskSeedOnStore, type DeskSeed } from "@/lib/booking";
import { advisorBookingNote, appointmentLoads, assessAppointment, onlineSlots } from "@/lib/capacity";
import { ARRIVED_CANCEL_CONFIRM, appointmentStatusLabel, appointmentsOnBoard, cancellationLine, cancelledOnDay, deskActor, mayCancelAppointment, repairOrderCancelBlock } from "@/lib/cancel";
import { snapHalfHour, today } from "@/lib/format";
import { lineLetter } from "@/lib/jobs";
import { lookups } from "@/lib/metrics";
import { requestHolds } from "@/lib/online-request";
import { noShowSuffix } from "@/lib/no-show-label";
import { laneLabel, normalizeLane } from "@/lib/scheduling";
import { useShop } from "@/lib/store";
import type { Appointment, CancelReason, TransportOption } from "@/lib/types";

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
  const storeId = useShop((state) => state.activeStoreId);
  return (
    <Shell>
      <ScheduleDesk key={storeId} />
    </Shell>
  );
}

function ScheduleDesk() {
  const shop = useShop();
  const navigate = useNavigate();
  const look = lookups(shop);
  const [preset, setPreset] = useState<Appointment | null>(null);
  const [seed, setSeed] = useState<DeskSeed>(() => deskSeedFor(shop));
  const liveSeed = deskSeedOnStore(seed, shop);
  const [date, setDate] = useState(today());
  const [time, setTime] = useState("15:30");
  const [minutes] = useState(60);
  const transports = shop.settings.scheduling.transportOptions;
  const [lane] = useState(() => normalizeLane("drop", transports));
  const [day, setDay] = useState(today());
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [booking, setBooking] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [showCancelled, setShowCancelled] = useState(false);
  const [cancelId, setCancelId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [overridePrompt, setOverridePrompt] = useState<{ id: string; warning: string } | null>(null);
  const [arrivedGate, setArrivedGate] = useState<{ reason: CancelReason; note: string } | null>(null);
  if (liveSeed !== seed) {
    setSeed(liveSeed);
    setSelectedId(null);
    setEditingId(null);
    setBooking(false);
    setPreset(null);
    setCancelId(null);
    setActionError(null);
    setOverridePrompt(null);
    setArrivedGate(null);
  }
  const { customerId, vehicleId, advisorId, techId, serviceId: servicePick, onlineTechId } = liveSeed;
  const patchSeed = (patch: Partial<DeskSeed>) => setSeed((current) => ({ ...deskSeedOnStore(current, shop), ...patch }));
  const vehicles = shop.vehicles.filter((vehicle) => vehicle.customerId === customerId);
  const resolvedVehicle = vehicles.some((vehicle) => vehicle.id === vehicleId) ? vehicleId : vehicles[0]?.id ?? "";
  const selected = shop.appointments.find((row) => row.id === selectedId) ?? null;
  const editing = shop.appointments.find((row) => row.id === editingId) ?? null;

  function openAppointment(id: string) {
    setSelectedId(id);
    setEditingId(id);
  }
  const noShows = shop.appointments.filter((row) => row.date === today() && row.status === "no_show").length;
  const inShop = shop.appointments.filter((row) => row.date === today() && (row.status === "in_shop" || row.status === "arrived")).length;
  const rank = { express: 0, main: 1, internal: 2, none: 3 };
  const board = [...shop.techs]
    .filter((tech) => tech.board !== "none")
    .sort((a, b) => rank[a.board] - rank[b.board] || a.number.localeCompare(b.number, undefined, { numeric: true }));
  const onBoard = appointmentsOnBoard(shop.appointments);
  const dayHours = onBoard
    .filter((row) => row.date === day)
    .reduce((sum, row) => sum + laborHours(row, shop.laborOps), 0);
  const actor = deskActor(shop);
  const canCancel = mayCancelAppointment(actor);
  const cancelling = shop.appointments.find((row) => row.id === cancelId) ?? null;
  const services = shop.settings.scheduling.onlineMenu;
  const serviceId = services.some((row) => row.id === servicePick) ? servicePick : services[0]?.id ?? "";
  const techFilter = board.some((tech) => tech.id === onlineTechId) ? onlineTechId : board[0]?.id ?? "";
  const onlineTimes = serviceId && techFilter
    ? [...new Set(onlineSlots({
        scheduling: shop.settings.scheduling,
        advisors: shop.advisors,
        techs: shop.techs,
        loads: appointmentLoads(shop.appointments, shop.laborOps),
        holds: requestHolds(shop.onlineRequests),
        serviceId,
        from: day,
        through: day,
        techId: techFilter,
      }).map((slot) => slot.time))]
    : [];

  function capacityFor(draft: { date: string; time: string; minutes: number; advisorId: string; techId: string; laborOpIds: string[] }, ignoreId?: string) {
    const result = assessAppointment({
      scheduling: shop.settings.scheduling,
      advisors: shop.advisors,
      techs: shop.techs,
      appointments: shop.appointments,
      laborOps: shop.laborOps,
      holds: requestHolds(shop.onlineRequests),
      proposal: { ...draft, ignoreId },
    });
    return { blocked: result.blocked, warning: result.blocked ? null : advisorBookingNote(result) };
  }

  function blockFor(row: { orderId: string | null } | null | undefined) {
    if (!row?.orderId) return null;
    return repairOrderCancelBlock(row.orderId, shop.orders.find((order) => order.id === row.orderId));
  }

  function openRepairOrder(orderId: string) {
    shop.setFocus(orderId);
    void navigate({ to: "/orders" });
  }

  function askCancel(id: string) {
    const row = shop.appointments.find((item) => item.id === id);
    const block = blockFor(row);
    if (block) {
      setActionError(block);
      setCancelId(null);
      return;
    }
    setActionError(null);
    setArrivedGate(null);
    setCancelId(id);
  }

  function confirmCancel(input: { reason: CancelReason; note: string }, confirmArrived = false) {
    if (!cancelId) return "That appointment is not on this store.";
    const result = shop.cancelAppointment(cancelId, input, confirmArrived);
    if (result.arrivedConfirm) {
      setArrivedGate(input);
      return null;
    }
    if (!result.ok) return result.error;
    setCancelId(null);
    setEditingId(null);
    setArrivedGate(null);
    setActionError(null);
    return null;
  }

  function reinstate(id: string, confirmOverride = false) {
    const result = shop.reinstateAppointment(id, confirmOverride);
    if (result.warning && !result.ok) {
      setOverridePrompt({ id, warning: result.warning });
      setActionError(null);
      return;
    }
    if (!result.ok) {
      setActionError(result.error);
      setOverridePrompt(null);
      return;
    }
    setOverridePrompt(null);
    setActionError(null);
    setSelectedId(id);
  }

  return (
    <>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-sm font-semibold uppercase tracking-wide text-muted">Appointments</p>
          <h1 className="mt-1 flex flex-wrap items-baseline gap-3 font-display text-5xl leading-none tracking-tight">
            {day === today() ? "Today" : dayLabel(day)}
            <span className="text-2xl tabular-nums text-muted">{flagHours(dayHours)} / {board.length * TECH_DAY_GOAL} hrs</span>
          </h1>
          <p className="mt-2 max-w-xl text-muted">
            {inShop} in or through the drive today. {noShows} no-show. Each column is a technician. Drag a card across to move it. A booking kept past a capacity warning is listed under Overrides for this store. Pending online requests hold the same hours and are listed under Online requests.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button small tone="primary" onClick={() => { setDate(day); setTime("15:00"); setBooking(true); }}>Book appointment</Button>
          <Button className="min-h-11" tone={showCancelled ? "primary" : "ghost"} aria-pressed={showCancelled} onClick={() => setShowCancelled((value) => !value)}>Show cancelled</Button>
          <Button small onClick={() => setDay((value) => addDays(value, -1))}>Previous</Button>
          <p className="min-w-40 text-center text-sm font-semibold">{dayLabel(day)}</p>
          <DayJump value={day} onChange={setDay} />
          <Button small onClick={() => setDay((value) => addDays(value, 1))}>Next</Button>
        </div>
      </div>

      <section className="card mt-4" aria-label="Online times">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 className="font-display text-3xl leading-none">Online times</h2>
            <p className="mt-1 max-w-xl text-sm text-muted">Customers only see a time when the technician still has hours for this service and the advisor is not full. A full time is left off.</p>
          </div>
          <div className="flex flex-wrap gap-3">
            <Field label="Service">
              <select className="field" value={serviceId} onChange={(event) => patchSeed({ serviceId: event.target.value })}>
                {services.map((service) => <option key={service.id} value={service.id}>{service.name}</option>)}
              </select>
            </Field>
            <Field label="Technician">
              <select className="field" value={techFilter} onChange={(event) => patchSeed({ onlineTechId: event.target.value })}>
                {board.map((tech) => <option key={tech.id} value={tech.id}>#{tech.number} · {tech.name}</option>)}
              </select>
            </Field>
          </div>
        </div>
        {onlineTimes.length === 0 ? (
          <p className="mt-3 text-sm text-muted">No online openings for this technician on this day.</p>
        ) : (
          <ul className="mt-3 flex flex-wrap gap-2">
            {onlineTimes.map((time) => <li key={time} className="rounded-md border border-line px-2 py-1 text-sm tabular-nums">{clockTime(time)}</li>)}
          </ul>
        )}
      </section>

      {board.length === 0 ? (
        <p className="card mt-4 text-muted">No technicians are on a board yet. Add someone on the roster and put them on Express, Main shop, or Internals. The day columns show up after that.</p>
      ) : (
      <AppointmentCalendar
        appointments={onBoard}
        day={day}
        techs={board.map((tech) => ({ id: tech.id, number: tech.number, name: tech.name, board: tech.board }))}
        selectedId={selectedId}
        onSelect={(id) => openAppointment(id)}
        onSlot={(nextTech, nextTime) => {
          setDate(day);
          patchSeed({ techId: nextTech });
          setTime(nextTime);
          setBooking(true);
        }}
        onMove={(id, patch) => shop.moveAppointment(id, patch)}
        onWrite={(id) => {
          const row = shop.appointments.find((item) => item.id === id);
          if (row) setPreset(row);
        }}
        onEdit={(id) => openAppointment(id)}
        onCancel={canCancel ? (id) => askCancel(id) : undefined}
        label={(row) => look.customer.get(row.customerId)?.name ?? "Customer"}
        hoursFor={(row) => laborHours(row, shop.laborOps)}
        summary={(row) => {
          const customer = look.customer.get(row.customerId);
          const vehicle = look.vehicle.get(row.vehicleId);
          const advisor = look.advisor.get(row.advisorId);
          return {
            name: customer?.name ?? "Customer",
            vehicle: vehicle ? `${vehicle.year} ${vehicle.make || "Ford"} ${vehicle.model}` : "No vehicle",
            advisor: advisor?.name ?? "Advisor",
            tech: look.tech.get(row.techId) ? `#${look.tech.get(row.techId)?.number} ${look.tech.get(row.techId)?.name}` : "No technician",
            when: `${dayLabel(row.date)} · ${clockRange(row.time, row.minutes)}`,
            lane: laneLabel(row.lane, transports),
            concern: row.concern,
            vin: row.vin || look.vehicle.get(row.vehicleId)?.vin || "No VIN",
            ops: row.laborOpIds.length
              ? row.laborOpIds.map((id) => shop.laborOps.find((op) => op.id === id)?.opcode).filter(Boolean).join(", ")
              : "No labor ops",
            status: appointmentStatusLabel(row.status),
            canWrite: !row.orderId && row.status !== "no_show" && row.status !== "cancelled",
          };
        }}
      />
      )}

      {selected ? (
        <Selected
          row={selected}
          name={look.customer.get(selected.customerId)?.name ?? "Customer"}
          noShows={look.customer.get(selected.customerId)?.noShows ?? 0}
          vehicle={look.vehicle.get(selected.vehicleId)}
          laneName={laneLabel(selected.lane, transports)}
          actor={actor}
          actionError={actionError}
          onStatus={(status) => shop.setAppointmentStatus(selected.id, status)}
          onWrite={() => setPreset(selected)}
          onEdit={() => openAppointment(selected.id)}
          onCancel={() => askCancel(selected.id)}
          cancelBlock={blockFor(selected)}
          onOpenOrder={selected.orderId && shop.orders.some((order) => order.id === selected.orderId) ? () => openRepairOrder(selected.orderId as string) : undefined}
          onReinstate={() => reinstate(selected.id)}
        />
      ) : null}

      <CancelledHistory
        rows={cancelledOnDay(shop.appointments, day)}
        show={showCancelled}
        nameFor={(row) => look.customer.get(row.customerId)?.name ?? "Customer"}
        allowReinstate={canCancel}
        onReinstate={reinstate}
      />
      {actionError && !selected ? <p role="alert" className="mt-3 text-sm text-[#8a3b2a]">{actionError}</p> : null}

      <Modal open={booking} onClose={() => setBooking(false)} title="Book an appointment" description={`${dayLabel(date)} at ${clockTime(time)}.`}>
        <AppointmentFields
          key={`${shop.activeStoreId}-${date}-${time}-${techId}`}
          customers={shop.customers}
          vehicles={shop.vehicles}
          advisors={shop.advisors}
          techs={board}
          laborOps={shop.laborOps}
          transports={transports}
          submitLabel="Book it"
          capacityFor={(draft) => capacityFor(draft)}
          initial={{ date, time, minutes, customerId, vehicleId: resolvedVehicle, advisorId, techId, concern: "", lines: [{ id: "new-a", code: "A", concern: "" }], vin: shop.vehicles.find((vehicle) => vehicle.id === resolvedVehicle)?.vin ?? "", laborOpIds: [], lane, status: "scheduled" }}
          onSubmit={(value) => {
            const result = shop.saveAdvisorAppointment(value);
            if (!result.ok) return result.error;
            setBooking(false);
            return null;
          }}
        />
      </Modal>

      <Modal open={editing !== null} onClose={() => setEditingId(null)} title="Appointment details" description={editing ? `${dayLabel(editing.date)} · ${editing.time}` : undefined}>
        {editing ? (
          <>
            {editing.status === "cancelled" ? (
              <div className="grid gap-2 text-sm">
                <p><span className="text-muted">Day</span> {dayLabel(editing.date)} · {clockTime(editing.time)}</p>
                <p><span className="text-muted">Customer</span> {look.customer.get(editing.customerId)?.name ?? "Customer"}</p>
                <p><span className="text-muted">Vehicle</span> {look.vehicle.get(editing.vehicleId) ? `${look.vehicle.get(editing.vehicleId)?.year} ${look.vehicle.get(editing.vehicleId)?.make || "Ford"} ${look.vehicle.get(editing.vehicleId)?.model}` : "No vehicle"}</p>
                <p><span className="text-muted">Concern</span> {editing.concern}</p>
                <p className="text-muted">This appointment is cancelled. Reinstate it to change the date, customer, vehicle, or concern.</p>
              </div>
            ) : (
              <AppointmentFields
                key={`${editing.id}-${editing.status}`}
                customers={shop.customers}
                vehicles={shop.vehicles}
                advisors={shop.advisors}
                techs={board}
                laborOps={shop.laborOps}
                transports={transports}
                submitLabel="Save changes"
                showStatus
                capacityFor={(draft) => capacityFor(draft, editing.id)}
                initial={editing}
                onSubmit={(value) => {
                  const result = shop.saveAdvisorAppointment(value, editing.id);
                  if (!result.ok) return result.error;
                  setEditingId(null);
                  return null;
                }}
              />
            )}
            <div className="mt-3">
              <DeskCancelActions
                actor={actor}
                status={editing.status}
                surface="edit"
                blockedReason={blockFor(editing)}
                onOpenOrder={editing.orderId && shop.orders.some((order) => order.id === editing.orderId) ? () => openRepairOrder(editing.orderId as string) : undefined}
                onCancel={() => askCancel(editing.id)}
                onReinstate={() => reinstate(editing.id)}
              />
            </div>
          </>
        ) : null}
      </Modal>

      <Modal open={cancelling !== null} onClose={() => { setCancelId(null); setArrivedGate(null); }} title="Cancel appointment" description={cancelling ? `${look.customer.get(cancelling.customerId)?.name ?? "Customer"} · ${dayLabel(cancelling.date)} at ${clockTime(cancelling.time)}` : undefined}>
        {cancelling && arrivedGate ? (
          <div className="grid gap-3">
            <p className="text-sm">{ARRIVED_CANCEL_CONFIRM}</p>
            <div className="mt-4 flex justify-start">
              <Button type="button" className="btn-danger min-h-11" onClick={() => confirmCancel(arrivedGate, true)}>Cancel anyway</Button>
            </div>
          </div>
        ) : cancelling ? <CancelForm key={cancelling.id} onSubmit={(input) => confirmCancel(input)} /> : null}
      </Modal>

      <Modal open={overridePrompt !== null} onClose={() => setOverridePrompt(null)} title="Reinstate past capacity" description="The same warning as a booking. Nothing is saved until you confirm.">
        {overridePrompt ? (
          <div className="grid gap-3">
            <p role="status" className="rounded-md border border-[#e7d7a8] bg-[#f8efd4] px-3 py-2 text-sm text-[#8a5a00]">{overridePrompt.warning}</p>
            <div className="mt-4 flex justify-start">
              <Button className="min-h-11" tone="primary" onClick={() => reinstate(overridePrompt.id, true)}>Reinstate anyway</Button>
            </div>
          </div>
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
    </>
  );
}

function Selected({
  row,
  name,
  noShows = 0,
  vehicle,
  laneName,
  actor,
  actionError,
  onStatus,
  onWrite,
  onEdit,
  onCancel,
  onReinstate,
  cancelBlock,
  onOpenOrder,
}: {
  row: Appointment;
  name: string;
  noShows?: number;
  vehicle?: { year: number; make?: string; model: string };
  laneName: string;
  actor: ReturnType<typeof deskActor>;
  actionError: string | null;
  onStatus: (status: Appointment["status"]) => void;
  onWrite: () => void;
  onEdit: () => void;
  onCancel: () => void;
  onReinstate: () => void;
  cancelBlock: string | null;
  onOpenOrder?: () => void;
}) {
  return (
    <div className="card mt-3 flex flex-wrap items-center justify-between gap-3">
      <div>
        <p className="flex flex-wrap items-baseline gap-2 font-semibold">{name}<NoShowMark count={noShows} /></p>
        <p className="text-sm text-muted">{vehicle ? `${vehicle.year} ${vehicle.make || "Ford"} ${vehicle.model}` : ""} · {row.concern}</p>
        <p className="text-sm text-muted">{dayLabel(row.date)} · {clockRange(row.time, row.minutes)} · {laneName}</p>
        {(row.cancelHistory ?? []).map((event, index) => (
          <p key={`${event.at}-${event.action ?? "cancel"}-${index}`} className="text-sm text-muted">{cancellationLine(event)}</p>
        ))}
        {actionError ? <p role="alert" className="text-sm text-[#8a3b2a]">{actionError}</p> : null}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Pill tone={row.status === "no_show" ? "bad" : row.status === "in_shop" ? "good" : undefined}>
          {appointmentStatusLabel(row.status)}
        </Pill>
        {row.status === "scheduled" ? <Button small onClick={() => onStatus("arrived")}>Arrived</Button> : null}
        {row.status === "scheduled" ? <Button small onClick={() => onStatus("no_show")}>No-show</Button> : null}
        {row.status === "no_show" ? <Button small onClick={() => onStatus("scheduled")}>Put back</Button> : null}
        <DeskCancelActions actor={actor} status={row.status} surface="card" blockedReason={cancelBlock} onOpenOrder={onOpenOrder} onCancel={onCancel} onReinstate={onReinstate} />
        <Button small onClick={onEdit}>Edit details</Button>
        {row.orderId || row.status === "no_show" || row.status === "cancelled" ? null : <Button small tone="primary" onClick={onWrite}>Write RO</Button>}
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
  transports,
  submitLabel,
  showStatus,
  capacityFor,
  onSubmit,
}: {
  initial: Pick<Appointment, "date" | "time" | "minutes" | "customerId" | "vehicleId" | "advisorId" | "techId" | "concern" | "lines" | "vin" | "laborOpIds" | "lane" | "status">;
  customers: { id: string; name: string; noShows?: number }[];
  vehicles: { id: string; customerId: string; year: number; model: string; vin: string }[];
  advisors: { id: string; number: string; name: string }[];
  techs: { id: string; number: string; name: string }[];
  laborOps: { id: string; opcode: string; description: string; hours: number }[];
  transports: TransportOption[];
  submitLabel: string;
  showStatus?: boolean;
  capacityFor?: (draft: { date: string; time: string; minutes: number; advisorId: string; techId: string; laborOpIds: string[] }) => { blocked: string | null; warning: string | null };
  onSubmit: (value: Pick<Appointment, "date" | "time" | "minutes" | "customerId" | "vehicleId" | "advisorId" | "techId" | "concern" | "lines" | "vin" | "laborOpIds" | "lane" | "status">) => string | null;
}) {
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
  const [lane, setLane] = useState(() => normalizeLane(initial.lane, transports));
  const [status, setStatus] = useState(initial.status);
  const [formError, setFormError] = useState<string | null>(null);
  const owned = vehicles.filter((vehicle) => vehicle.customerId === customerId);
  const resolvedVehicle = owned.some((vehicle) => vehicle.id === vehicleId) ? vehicleId : owned[0]?.id ?? "";
  const lengths = [...new Set([...LENGTHS, initial.minutes])].sort((a, b) => a - b);
  const capacity = capacityFor?.({ date, time, minutes, advisorId, techId, laborOpIds }) ?? { blocked: null, warning: null };
  const alertText = formError || (owned.length === 0 ? VEHICLE_MISSING : null) || capacity.blocked;

  return (
    <form
      className="grid gap-3"
      onSubmit={(event) => {
        event.preventDefault();
        const block = bookingFormBlock({ vehicleId: resolvedVehicle, lines });
        if (block) {
          setFormError(block);
          return;
        }
        if (capacity.blocked) {
          setFormError(capacity.blocked);
          return;
        }
        const kept = lines.map((line, index) => ({ ...line, code: lineLetter(index), concern: line.concern.trim() })).filter((line) => line.concern);
        const error = onSubmit({ date, time, minutes, customerId, vehicleId: resolvedVehicle, advisorId, techId, lines: kept, concern: kept.map((line) => `${line.code}. ${line.concern}`).join(" · "), vin: vin.trim().toUpperCase(), laborOpIds, lane, status });
        setFormError(error);
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
          <select className="field" value={lane} onChange={(event) => setLane(event.target.value)}>
            {transports.map((option) => <option key={option.id} value={option.id}>{option.name}</option>)}
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
          setFormError(null);
        }}>
          {customers.map((customer) => <option key={customer.id} value={customer.id}>{customer.name}{noShowSuffix(customer.noShows ?? 0)}</option>)}
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
        <select className="field" value={advisorId} onChange={(event) => setAdvisorId(event.target.value)}>
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
      {alertText ? <p role="alert" className="text-sm text-[#8a3b2a]">{alertText}</p> : null}
      {capacity.warning ? (
        <p role="status" className="rounded-md border border-[#e7d7a8] bg-[#f8efd4] px-3 py-2 text-sm text-[#8a5a00]">{capacity.warning}</p>
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
                className={`h-8 rounded-md text-sm tabular-nums ${iso === value ? "bg-primary text-primary-fg" : iso === today() ? "bg-primary-soft" : "hover:bg-surface"}`}
                onClick={() => { onChange(iso); setOpen(false); }}
              >
                {Number(iso.slice(-2))}
              </button>
            ) : <span key={`pad-${index}`} />)}
          </div>
          <Button small className="mt-2 w-full" onClick={() => { onChange(today()); setOpen(false); }}>Today</Button>
        </div>
      ) : null}
    </div>
  );
}
