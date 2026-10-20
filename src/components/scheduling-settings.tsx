import { useState } from "react";
import { WEEKDAY_LABELS } from "@/lib/scheduling";
import type { SchedulingSettings, WeekdayIndex } from "@/lib/types";
import { useShop } from "@/lib/store";
import { Button, Field } from "./ui";

export function SchedulingSettingsForm() {
  const scheduling = useShop((state) => state.settings.scheduling);
  const updateDayHours = useShop((state) => state.updateDayHours);
  const addClosedDate = useShop((state) => state.addClosedDate);
  const removeClosedDate = useShop((state) => state.removeClosedDate);
  const updateBookingWindow = useShop((state) => state.updateBookingWindow);
  const addOnlineService = useShop((state) => state.addOnlineService);
  const updateOnlineService = useShop((state) => state.updateOnlineService);
  const removeOnlineService = useShop((state) => state.removeOnlineService);
  const addTransportOption = useShop((state) => state.addTransportOption);
  const renameTransportOption = useShop((state) => state.renameTransportOption);
  const removeTransportOption = useShop((state) => state.removeTransportOption);
  const [closedDate, setClosedDate] = useState("");
  const [serviceName, setServiceName] = useState("");
  const [serviceHours, setServiceHours] = useState("0.5");
  const [transportName, setTransportName] = useState("");
  const [note, setNote] = useState("");

  return (
    <div className="grid gap-4 sm:col-span-2">
      <div>
        <h2 className="font-display text-2xl leading-none">Scheduling</h2>
        <p className="mt-1 text-sm normal-case tracking-normal text-muted">
          Hours, closed days, the online booking window, the service menu, and transport options belong to this store only. The menu has no prices and no free-text concern.
        </p>
      </div>

      <div className="grid gap-2">
        <p className="text-sm font-semibold normal-case tracking-normal">Business hours</p>
        {scheduling.hours.map((row) => (
          <div key={row.weekday} className="grid grid-cols-2 items-center gap-2 sm:grid-cols-[7rem_auto_1fr_1fr]">
            <span className="text-sm normal-case tracking-normal text-ink">{WEEKDAY_LABELS[row.weekday]}</span>
            <label className="flex items-center gap-2 text-sm normal-case tracking-normal text-ink">
              <input
                type="checkbox"
                checked={row.closed}
                onChange={(event) => updateDayHours(row.weekday as WeekdayIndex, { closed: event.target.checked })}
              />
              Closed
            </label>
            <input
              className="field"
              type="time"
              aria-label={`${WEEKDAY_LABELS[row.weekday]} opens`}
              value={row.open}
              disabled={row.closed}
              onChange={(event) => updateDayHours(row.weekday as WeekdayIndex, { open: event.target.value })}
            />
            <input
              className="field"
              type="time"
              aria-label={`${WEEKDAY_LABELS[row.weekday]} closes`}
              value={row.close}
              disabled={row.closed}
              onChange={(event) => updateDayHours(row.weekday as WeekdayIndex, { close: event.target.value })}
            />
          </div>
        ))}
      </div>

      <div className="grid gap-2">
        <p className="text-sm font-semibold normal-case tracking-normal">Closed dates</p>
        <div className="flex flex-wrap items-end gap-2">
          <Field label="Date">
            <input className="field" type="date" value={closedDate} onChange={(event) => setClosedDate(event.target.value)} />
          </Field>
          <Button
            type="button"
            onClick={() => {
              if (!closedDate) return;
              const added = addClosedDate(closedDate);
              setNote(added ? "" : "That date is already closed, or it is not a real date.");
              if (added) setClosedDate("");
            }}
          >
            Add closed date
          </Button>
        </div>
        {scheduling.closedDates.length === 0 ? <p className="text-sm normal-case tracking-normal text-muted">No extra closed dates.</p> : (
          <ul className="grid gap-1">
            {scheduling.closedDates.map((iso) => (
              <li key={iso} className="flex items-center justify-between gap-2 text-sm normal-case tracking-normal">
                <span className="tabular-nums">{iso}</span>
                <Button type="button" small onClick={() => removeClosedDate(iso)}>Remove</Button>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Booking window, days ahead">
          <input
            className="field tabular-nums"
            type="number"
            min={1}
            max={365}
            value={scheduling.bookingWindow.daysAhead}
            onChange={(event) => updateBookingWindow({ daysAhead: Number(event.target.value) })}
          />
        </Field>
        <Field label="Minimum lead time, hours">
          <input
            className="field tabular-nums"
            type="number"
            min={0}
            max={168}
            value={scheduling.bookingWindow.minLeadHours}
            onChange={(event) => updateBookingWindow({ minLeadHours: Number(event.target.value) })}
          />
        </Field>
      </div>

      <MenuEditor
        scheduling={scheduling}
        serviceName={serviceName}
        serviceHours={serviceHours}
        setServiceName={setServiceName}
        setServiceHours={setServiceHours}
        setNote={setNote}
        addOnlineService={addOnlineService}
        updateOnlineService={updateOnlineService}
        removeOnlineService={removeOnlineService}
      />

      <TransportEditor
        scheduling={scheduling}
        transportName={transportName}
        setTransportName={setTransportName}
        setNote={setNote}
        addTransportOption={addTransportOption}
        renameTransportOption={renameTransportOption}
        removeTransportOption={removeTransportOption}
      />

      {note ? <p className="text-sm normal-case tracking-normal text-primary">{note}</p> : null}
    </div>
  );
}

function MenuEditor({
  scheduling,
  serviceName,
  serviceHours,
  setServiceName,
  setServiceHours,
  setNote,
  addOnlineService,
  updateOnlineService,
  removeOnlineService,
}: {
  scheduling: SchedulingSettings;
  serviceName: string;
  serviceHours: string;
  setServiceName: (value: string) => void;
  setServiceHours: (value: string) => void;
  setNote: (value: string) => void;
  addOnlineService: (input: { name: string; laborHours: number }) => boolean;
  updateOnlineService: (id: string, patch: { name?: string; laborHours?: number }) => boolean;
  removeOnlineService: (id: string) => void;
}) {
  return (
    <div className="grid gap-2">
      <p className="text-sm font-semibold normal-case tracking-normal">Online service menu</p>
      <p className="text-sm normal-case tracking-normal text-muted">Customers will pick from this list. Each row is a name and a labor time. Nothing here has a price.</p>
      <ul className="grid gap-2">
        {scheduling.onlineMenu.map((service) => (
          <li key={service.id} className="grid gap-2 sm:grid-cols-[1fr_8rem_auto] sm:items-end">
            <Field label="Service">
              <input
                className="field"
                value={service.name}
                onChange={(event) => {
                  const ok = updateOnlineService(service.id, { name: event.target.value });
                  if (!ok) setNote("Give the service a name.");
                }}
              />
            </Field>
            <Field label="Labor hours">
              <input
                className="field tabular-nums"
                type="number"
                min={0.1}
                step={0.1}
                value={service.laborHours}
                onChange={(event) => updateOnlineService(service.id, { laborHours: Number(event.target.value) })}
              />
            </Field>
            <Button type="button" small onClick={() => removeOnlineService(service.id)}>Remove</Button>
          </li>
        ))}
      </ul>
      <div className="grid gap-2 sm:grid-cols-[1fr_8rem_auto] sm:items-end">
        <Field label="New service">
          <input className="field" value={serviceName} onChange={(event) => setServiceName(event.target.value)} />
        </Field>
        <Field label="Labor hours">
          <input className="field tabular-nums" type="number" min={0.1} step={0.1} value={serviceHours} onChange={(event) => setServiceHours(event.target.value)} />
        </Field>
        <Button
          type="button"
          onClick={() => {
            const added = addOnlineService({ name: serviceName, laborHours: Number(serviceHours) });
            setNote(added ? "" : "Need a new service name and a labor time greater than zero.");
            if (added) setServiceName("");
          }}
        >
          Add service
        </Button>
      </div>
    </div>
  );
}

function TransportEditor({
  scheduling,
  transportName,
  setTransportName,
  setNote,
  addTransportOption,
  renameTransportOption,
  removeTransportOption,
}: {
  scheduling: SchedulingSettings;
  transportName: string;
  setTransportName: (value: string) => void;
  setNote: (value: string) => void;
  addTransportOption: (name: string) => boolean;
  renameTransportOption: (id: string, name: string) => boolean;
  removeTransportOption: (id: string) => boolean;
}) {
  return (
    <div className="grid gap-2">
      <p className="text-sm font-semibold normal-case tracking-normal">Transport options</p>
      <p className="text-sm normal-case tracking-normal text-muted">Starts with Waiter and Drop-off. Add Shuttle or Loaner for this store when you offer them.</p>
      <ul className="grid gap-2">
        {scheduling.transportOptions.map((option) => (
          <li key={option.id} className="grid gap-2 sm:grid-cols-[1fr_auto] sm:items-end">
            <Field label="Option">
              <input className="field" value={option.name} onChange={(event) => renameTransportOption(option.id, event.target.value)} />
            </Field>
            <Button
              type="button"
              small
              disabled={scheduling.transportOptions.length <= 1}
              onClick={() => {
                const removed = removeTransportOption(option.id);
                if (!removed) setNote("Keep at least one transport option.");
              }}
            >
              Remove
            </Button>
          </li>
        ))}
      </ul>
      <div className="flex flex-wrap items-end gap-2">
        <Field label="New option">
          <input className="field" value={transportName} onChange={(event) => setTransportName(event.target.value)} placeholder="Shuttle" />
        </Field>
        <Button
          type="button"
          onClick={() => {
            const added = addTransportOption(transportName);
            setNote(added ? "" : "That transport option needs a new name.");
            if (added) setTransportName("");
          }}
        >
          Add option
        </Button>
      </div>
    </div>
  );
}
