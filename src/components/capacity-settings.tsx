import { useMemo, useState } from "react";
import { changeLogLine, deskActor } from "@/lib/cancel";
import { capacityLogForActor, timeOffForActor, weekdayShopHours } from "@/lib/capacity";
import { addDays, todayIso } from "@/lib/clock";
import { WEEKDAY_LABELS, timeOffLabel } from "@/lib/scheduling";
import { useShop } from "@/lib/store";
import type { WeekdayIndex } from "@/lib/types";
import { Button, Field } from "./ui";

const REFUSED = "Only a service manager can change capacity.";

export function CapacitySettings() {
  const scheduling = useShop((state) => state.settings.scheduling);
  const techs = useShop((state) => state.techs);
  const updateTechCapacityHours = useShop((state) => state.updateTechCapacityHours);
  const addTechTimeOff = useShop((state) => state.addTechTimeOff);
  const removeTechTimeOff = useShop((state) => state.removeTechTimeOff);
  const updateCapacityLimits = useShop((state) => state.updateCapacityLimits);
  const actor = useShop((state) => deskActor(state));
  const timeOff = useShop((state) => state.settings.scheduling.capacity.timeOff);
  const settingsLog = useShop((state) => state.settingsLog);
  const listedOff = useMemo(() => timeOffForActor(actor, timeOff), [actor, timeOff]);
  const changes = useMemo(() => capacityLogForActor(actor, settingsLog ?? []).slice(0, 12), [actor, settingsLog]);
  const canEdit = actor === "service-manager";
  const [note, setNote] = useState("");
  const [offTech, setOffTech] = useState(techs[0]?.id ?? "");
  const [offDate, setOffDate] = useState(() => addDays(todayIso(), 1));
  const [partDay, setPartDay] = useState(false);
  const [offStart, setOffStart] = useState("12:00");
  const [offEnd, setOffEnd] = useState("15:00");
  const capacity = scheduling.capacity;
  const techId = techs.some((tech) => tech.id === offTech) ? offTech : (techs[0]?.id ?? "");

  function refuse() {
    setNote(actor === "customer" ? "Choose who is working. Only a service manager can change capacity." : REFUSED);
  }

  function addOff(date: string, start = "", end = "") {
    if (!canEdit) {
      refuse();
      return;
    }
    const result = addTechTimeOff({ techId, date, start, end });
    setNote(result.ok ? "" : (result.error ?? REFUSED));
  }

  return (
    <div className="tap-targets grid gap-6">
      <p className="max-w-2xl text-sm text-muted">
        These numbers are what the booking check, this store's day view, and online times all use.
        Until you change them, each technician gets the shop's open hours that weekday, each advisor
        can take one appointment per open hour across the day, and there is no hourly, waiter, or
        arrival cap. Online booking can use the whole day. A per-hour advisor limit, when you set
        one, is in addition to that daily total. A blank cap is no limit. An explicit 0 closes that channel.
      </p>
      {canEdit && capacity.loadNotice ? (
        <p role="status" className="text-sm text-[#8a3b2a]">
          {capacity.loadNotice}
        </p>
      ) : null}
      {canEdit ? null : (
        <p role="status" className="text-sm text-[#8a3b2a]">
          {actor === "customer"
            ? "Choose who is working. Only a service manager can change capacity."
            : "You can view capacity. Only a service manager can change it."}
        </p>
      )}
      {note ? (
        <p role="alert" className="text-sm text-[#8a3b2a]">
          {note}
        </p>
      ) : null}

      <section id="time-off" className="grid gap-3">
        <h2 className="font-display text-2xl leading-none">Time off</h2>
        <p className="text-sm text-muted">
          Mark a technician off tomorrow, or pick another open day. A part-day block removes those
          hours. The schedule shows the time as unavailable. No reason is stored.
        </p>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Field label="Technician">
            <select
              className="field min-h-11"
              aria-label="Technician for time off"
              value={techId}
              disabled={!canEdit || techs.length === 0}
              onChange={(event) => setOffTech(event.target.value)}
            >
              {techs.map((tech) => (
                <option key={tech.id} value={tech.id}>
                  #{tech.number} {tech.name}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Date">
            <input
              className="field min-h-11"
              type="date"
              aria-label="Time off date"
              value={offDate}
              disabled={!canEdit}
              onChange={(event) => setOffDate(event.target.value)}
            />
          </Field>
          <label className="flex min-h-11 items-center gap-2 text-sm sm:col-span-2">
            <input
              className="min-h-11 min-w-11"
              type="checkbox"
              checked={partDay}
              disabled={!canEdit}
              onChange={(event) => setPartDay(event.target.checked)}
            />
            Part of the day
          </label>
          {partDay ? (
            <>
              <Field label="From">
                <input className="field min-h-11" type="time" value={offStart} disabled={!canEdit} onChange={(event) => setOffStart(event.target.value)} />
              </Field>
              <Field label="Until">
                <input className="field min-h-11" type="time" value={offEnd} disabled={!canEdit} onChange={(event) => setOffEnd(event.target.value)} />
              </Field>
            </>
          ) : null}
        </div>
        <div className="flex flex-wrap gap-2">
          <Button
            tone="primary"
            disabled={!canEdit || !techId}
            onClick={() => addOff(addDays(todayIso(), 1))}
          >
            Off tomorrow
          </Button>
          <Button
            disabled={!canEdit || !techId}
            onClick={() => addOff(offDate, partDay ? offStart : "", partDay ? offEnd : "")}
          >
            Add time off
          </Button>
        </div>
        {canEdit ? (
          listedOff.length === 0 ? (
            <p className="text-sm text-muted">No time off on this store.</p>
          ) : (
            <ul className="grid gap-2">
              {listedOff.map((row) => {
                const tech = techs.find((item) => item.id === row.techId);
                return (
                  <li key={row.id} className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-line px-3 py-2 text-sm">
                    <span>
                      {tech ? tech.name : "Technician"} · {timeOffLabel(row)}
                    </span>
                    <Button
                      disabled={!canEdit}
                      onClick={() => {
                        if (!canEdit) {
                          refuse();
                          return;
                        }
                        const result = removeTechTimeOff(row.id);
                        setNote(result.ok ? "" : (result.error ?? REFUSED));
                      }}
                    >
                      Remove
                    </Button>
                  </li>
                );
              })}
            </ul>
          )
        ) : (
          <p className="text-sm text-muted">You see unavailable time on the schedule. The dates and the change log stay with the service manager.</p>
        )}
      </section>

      <section className="grid gap-3">
        <h2 className="font-display text-2xl leading-none">Technician hours</h2>
        <p className="text-sm text-muted">
          Blank uses the shop's open hours for that weekday. A zero means the technician has no
          hours that day of the week. Open a closed day before setting hours on it. Hours go in
          quarter-hour steps, and they cannot pass the shop's open hours.
        </p>
        {techs.length === 0 ? <p className="text-sm text-muted">No technicians on this store.</p> : null}
        {techs.map((tech) => {
          const week = capacity.techHours.find((row) => row.techId === tech.id)?.hours;
          return (
            <div key={tech.id} className="rounded-md border border-line p-3">
              <p className="text-sm font-semibold">
                #{tech.number} {tech.name}
              </p>
              <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-7">
                {WEEKDAY_LABELS.map((label, index) => {
                  const weekday = index as WeekdayIndex;
                  const shopHours = weekdayShopHours(scheduling, weekday);
                  const value = week?.[weekday] ?? null;
                  const closedDay = shopHours === 0;
                  return (
                    <HourField
                      key={label}
                      label={`${tech.name} ${label}`}
                      short={label.slice(0, 3)}
                      placeholder={closedDay ? "Closed" : String(shopHours)}
                      value={value}
                      disabled={!canEdit || closedDay}
                      closedNote={closedDay ? "Open that day before setting technician hours." : ""}
                      onCommit={(hours) => {
                        if (!canEdit) {
                          refuse();
                          return;
                        }
                        const result = updateTechCapacityHours(tech.id, weekday, hours);
                        setNote(result.ok ? "" : (result.error ?? REFUSED));
                      }}
                    />
                  );
                })}
              </div>
            </div>
          );
        })}
      </section>

      <section className="grid gap-3">
        <h2 className="font-display text-2xl leading-none">Advisor, waiter, and arrival limits</h2>
        <div className="grid gap-3 sm:grid-cols-2">
          <LimitField
            label="Max appointments per advisor per hour"
            hint="Leave blank for no hourly limit. The daily total stays one appointment per open hour."
            closedNote="Advisor appointments are closed for every hour."
            value={capacity.maxAdvisorAppointmentsPerHour}
            disabled={!canEdit}
            onCommit={(value) => commitLimit(canEdit, refuse, () => updateCapacityLimits({ maxAdvisorAppointmentsPerHour: value }), setNote)}
          />
          <LimitField
            label="Max waiter appointments per time slot"
            hint="A slot is 30 minutes. Waiter and Express count as a waiter. Drop-off does not. Blank means no cap."
            closedNote="Waiter appointments are closed for every time slot."
            value={capacity.maxWaiterPerSlot}
            disabled={!canEdit}
            onCommit={(value) => commitLimit(canEdit, refuse, () => updateCapacityLimits({ maxWaiterPerSlot: value }), setNote)}
          />
          <LimitField
            label="Max arrivals per time slot"
            hint="Every appointment that starts in that 30-minute slot, whatever the transport. Blank means no cap."
            closedNote="Arrivals are closed for every time slot."
            value={capacity.maxArrivalsPerSlot}
            disabled={!canEdit}
            onCommit={(value) => commitLimit(canEdit, refuse, () => updateCapacityLimits({ maxArrivalsPerSlot: value }), setNote)}
          />
          <ShareField
            value={capacity.onlineSharePercent}
            disabled={!canEdit}
            onCommit={(value) => commitLimit(canEdit, refuse, () => updateCapacityLimits({ onlineSharePercent: value }), setNote)}
          />
        </div>
      </section>

      {canEdit ? (
        <section className="grid gap-2" aria-label="Capacity change log">
          <h2 className="font-display text-2xl leading-none">Changes</h2>
          <p className="text-sm text-muted">Newest first. Times are Pacific.</p>
          {changes.length === 0 ? (
            <p className="text-sm text-muted">No capacity changes yet.</p>
          ) : (
            <ul className="grid gap-2">
              {changes.map((row) => (
                <li key={`${row.at}-${row.field}-${row.after}`} className="text-sm">
                  {changeLogLine(row)}
                </li>
              ))}
            </ul>
          )}
        </section>
      ) : null}
    </div>
  );
}

function commitLimit(
  canEdit: boolean,
  refuse: () => void,
  run: () => { ok: boolean; error: string | null },
  setNote: (value: string) => void,
) {
  if (!canEdit) {
    refuse();
    return;
  }
  const result = run();
  setNote(result.ok ? "" : (result.error ?? REFUSED));
}

function SourceMark({ custom, disabled, onReset }: { custom: boolean; disabled: boolean; onReset: () => void }) {
  return (
    <span className="mt-1 flex flex-wrap items-center gap-2 text-xs font-normal normal-case tracking-normal text-muted">
      <span>{custom ? "Custom" : "Default"}</span>
      {custom ? (
        <button type="button" className="min-h-11 min-w-11 underline" disabled={disabled} onClick={onReset}>
          Reset
        </button>
      ) : null}
    </span>
  );
}

function HourField({
  label,
  short,
  value,
  placeholder,
  disabled,
  closedNote,
  onCommit,
}: {
  label: string;
  short: string;
  value: number | null;
  placeholder: string;
  disabled: boolean;
  closedNote: string;
  onCommit: (hours: number | null | string) => void;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  const shown = value == null ? "" : String(value);
  return (
    <label className="grid gap-1 text-xs font-semibold uppercase tracking-wide text-muted">
      {short}
      <input
        className="field min-h-11 normal-case tracking-normal"
        inputMode="decimal"
        aria-label={`${label} hours`}
        placeholder={placeholder}
        disabled={disabled}
        aria-readonly={disabled}
        value={draft ?? shown}
        onChange={(event) => setDraft(event.target.value)}
        onBlur={() => {
          const trimmed = (draft ?? shown).trim();
          setDraft(null);
          if (trimmed === shown) return;
          if (trimmed === "") onCommit(null);
          else onCommit(trimmed);
        }}
      />
      <SourceMark custom={value != null} disabled={disabled} onReset={() => onCommit(null)} />
      {closedNote ? <span className="font-normal normal-case tracking-normal">{closedNote}</span> : null}
    </label>
  );
}

function LimitField({
  label,
  hint,
  closedNote,
  value,
  disabled,
  onCommit,
}: {
  label: string;
  hint: string;
  closedNote: string;
  value: number | null;
  disabled: boolean;
  onCommit: (value: number | null | string) => void;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  const shown = value == null ? "" : String(value);
  return (
    <Field label={label}>
      <input
        className="field min-h-11"
        inputMode="numeric"
        placeholder="No limit"
        disabled={disabled}
        aria-readonly={disabled}
        value={draft ?? shown}
        onChange={(event) => setDraft(event.target.value)}
        onBlur={() => {
          const trimmed = (draft ?? shown).trim();
          setDraft(null);
          if (trimmed === shown) return;
          if (trimmed === "") onCommit(null);
          else onCommit(trimmed);
        }}
      />
      <span className="mt-1 block text-xs font-normal normal-case tracking-normal text-muted">{hint}</span>
      <SourceMark custom={value != null} disabled={disabled} onReset={() => onCommit(null)} />
      {value === 0 ? (
        <span role="status" className="mt-1 block text-xs font-normal normal-case tracking-normal text-[#8a3b2a]">
          {closedNote}
        </span>
      ) : null}
    </Field>
  );
}

function ShareField({
  value,
  disabled,
  onCommit,
}: {
  value: number;
  disabled: boolean;
  onCommit: (value: number | string) => void;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  const shown = String(value);
  return (
    <Field label="Online booking share %">
      <input
        className="field min-h-11"
        inputMode="numeric"
        disabled={disabled}
        aria-readonly={disabled}
        value={draft ?? shown}
        onChange={(event) => setDraft(event.target.value)}
        onBlur={() => {
          const trimmed = (draft ?? shown).trim();
          setDraft(null);
          if (trimmed === "" || trimmed === shown) return;
          onCommit(trimmed);
        }}
      />
      <span className="mt-1 block text-xs font-normal normal-case tracking-normal text-muted">
        Online customers do not see times past this share of technician hours, advisor room, or a
        cap you set. The desk can still book until the day is actually full. 100 matches today.
      </span>
      <SourceMark custom={value !== 100} disabled={disabled} onReset={() => onCommit(100)} />
    </Field>
  );
}
