import { useState } from "react";
import { deskActor, displayRecordedWhen } from "@/lib/cancel";
import { weekdayShopHours } from "@/lib/capacity";
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
  const log = useShop((state) => state.settingsLog ?? []);
  const actor = useShop((state) => deskActor(state));
  const canEdit = actor === "service-manager";
  const [note, setNote] = useState("");
  const [offTech, setOffTech] = useState(techs[0]?.id ?? "");
  const [offDate, setOffDate] = useState("");
  const [partDay, setPartDay] = useState(false);
  const [offStart, setOffStart] = useState("12:00");
  const [offEnd, setOffEnd] = useState("15:00");
  const capacity = scheduling.capacity;
  const techId = techs.some((tech) => tech.id === offTech) ? offTech : (techs[0]?.id ?? "");
  const changes = [...log]
    .reverse()
    .filter((row) => row.field.startsWith("Capacity"))
    .slice(0, 12);

  function refuse() {
    setNote(
      actor === "customer"
        ? "Choose who is working. Only a service manager can change capacity."
        : REFUSED,
    );
  }

  return (
    <div className="grid gap-6">
      <p className="max-w-2xl text-sm text-muted">
        These numbers are what the booking check, this store's day view, and online times all use.
        Until you change them, each technician gets the shop's open hours that weekday, each advisor
        can take one appointment per open hour across the day, and there is no hourly, waiter, or
        arrival cap. Online booking can use the whole day. A per-hour advisor limit, when you set
        one, is in addition to that daily total.
      </p>
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

      <section className="grid gap-3">
        <h2 className="font-display text-2xl leading-none">Technician hours</h2>
        <p className="text-sm text-muted">
          Blank uses the shop's open hours for that weekday. A zero means the technician has no
          hours that day of the week.
        </p>
        {techs.length === 0 ? (
          <p className="text-sm text-muted">No technicians on this store.</p>
        ) : null}
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
                  return (
                    <HourField
                      key={label}
                      label={`${tech.name} ${label}`}
                      short={label.slice(0, 3)}
                      placeholder={shopHours ? String(shopHours) : "Closed"}
                      value={value}
                      disabled={!canEdit}
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
        <h2 className="font-display text-2xl leading-none">Time off</h2>
        <p className="text-sm text-muted">
          A whole date takes the technician off that day. A part-day block removes those hours and
          hides the overlapping times from online booking.
        </p>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Field label="Technician">
            <select
              className="field"
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
              className="field"
              type="date"
              value={offDate}
              disabled={!canEdit}
              onChange={(event) => setOffDate(event.target.value)}
            />
          </Field>
          <label className="flex items-center gap-2 text-sm sm:col-span-2 lg:col-span-2">
            <input
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
                <input
                  className="field"
                  type="time"
                  value={offStart}
                  disabled={!canEdit}
                  onChange={(event) => setOffStart(event.target.value)}
                />
              </Field>
              <Field label="Until">
                <input
                  className="field"
                  type="time"
                  value={offEnd}
                  disabled={!canEdit}
                  onChange={(event) => setOffEnd(event.target.value)}
                />
              </Field>
            </>
          ) : null}
        </div>
        <div>
          <Button
            small
            tone="primary"
            disabled={!canEdit || !techId}
            onClick={() => {
              if (!canEdit) {
                refuse();
                return;
              }
              const result = addTechTimeOff({
                techId,
                date: offDate,
                start: partDay ? offStart : "",
                end: partDay ? offEnd : "",
              });
              setNote(result.ok ? "" : (result.error ?? REFUSED));
              if (result.ok) setOffDate("");
            }}
          >
            Add time off
          </Button>
        </div>
        {capacity.timeOff.length === 0 ? (
          <p className="text-sm text-muted">No time off on this store.</p>
        ) : (
          <ul className="grid gap-2">
            {capacity.timeOff.map((row) => {
              const tech = techs.find((item) => item.id === row.techId);
              return (
                <li
                  key={row.id}
                  className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-line px-3 py-2 text-sm"
                >
                  <span>
                    {tech ? tech.name : "Technician"} · {timeOffLabel(row)}
                  </span>
                  <Button
                    small
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
        )}
      </section>

      <section className="grid gap-3">
        <h2 className="font-display text-2xl leading-none">Advisor, waiter, and arrival limits</h2>
        <div className="grid gap-3 sm:grid-cols-2">
          <LimitField
            label="Max appointments per advisor per hour"
            hint="Leave blank for no hourly limit. The daily total stays one appointment per open hour."
            value={capacity.maxAdvisorAppointmentsPerHour}
            disabled={!canEdit}
            onCommit={(value) => {
              if (!canEdit) {
                refuse();
                return;
              }
              const result = updateCapacityLimits({ maxAdvisorAppointmentsPerHour: value });
              setNote(result.ok ? "" : (result.error ?? REFUSED));
            }}
          />
          <LimitField
            label="Max waiter appointments per time slot"
            hint="A slot is 30 minutes. Waiter is the Waiter transport. Blank means no cap."
            value={capacity.maxWaiterPerSlot}
            disabled={!canEdit}
            onCommit={(value) => {
              if (!canEdit) {
                refuse();
                return;
              }
              const result = updateCapacityLimits({ maxWaiterPerSlot: value });
              setNote(result.ok ? "" : (result.error ?? REFUSED));
            }}
          />
          <LimitField
            label="Max arrivals per time slot"
            hint="Every appointment that starts in that 30-minute slot, whatever the transport. Blank means no cap."
            value={capacity.maxArrivalsPerSlot}
            disabled={!canEdit}
            onCommit={(value) => {
              if (!canEdit) {
                refuse();
                return;
              }
              const result = updateCapacityLimits({ maxArrivalsPerSlot: value });
              setNote(result.ok ? "" : (result.error ?? REFUSED));
            }}
          />
          <ShareField
            value={capacity.onlineSharePercent}
            disabled={!canEdit}
            onCommit={(value) => {
              if (!canEdit) {
                refuse();
                return;
              }
              const result = updateCapacityLimits({ onlineSharePercent: value });
              setNote(result.ok ? "" : (result.error ?? REFUSED));
            }}
          />
        </div>
      </section>

      <section className="grid gap-2">
        <h2 className="font-display text-2xl leading-none">Changes</h2>
        {changes.length === 0 ? (
          <p className="text-sm text-muted">No capacity changes yet.</p>
        ) : (
          <ul className="grid gap-2">
            {changes.map((row) => (
              <li key={`${row.at}-${row.field}-${row.after}`} className="text-sm">
                <span className="font-semibold">{row.who}</span>
                <span className="text-muted">
                  {" "}
                  · {displayRecordedWhen(row.at)} · {row.field.replace(/^Capacity /, "")}
                </span>
                <span className="block text-muted">
                  {row.before || "none"} → {row.after}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

function HourField({
  label,
  short,
  value,
  placeholder,
  disabled,
  onCommit,
}: {
  label: string;
  short: string;
  value: number | null;
  placeholder: string;
  disabled: boolean;
  onCommit: (hours: number | null) => void;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  const shown = value == null ? "" : String(value);
  return (
    <label className="grid gap-1 text-xs font-semibold uppercase tracking-wide text-muted">
      {short}
      <input
        className="field normal-case tracking-normal"
        inputMode="decimal"
        aria-label={`${label} hours`}
        placeholder={placeholder}
        disabled={disabled}
        value={draft ?? shown}
        onChange={(event) => setDraft(event.target.value)}
        onBlur={() => {
          const trimmed = (draft ?? shown).trim();
          setDraft(null);
          if (trimmed === shown) return;
          if (trimmed === "") onCommit(null);
          else onCommit(Number(trimmed));
        }}
      />
    </label>
  );
}

function LimitField({
  label,
  hint,
  value,
  disabled,
  onCommit,
}: {
  label: string;
  hint: string;
  value: number | null;
  disabled: boolean;
  onCommit: (value: number | null) => void;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  const shown = value == null ? "" : String(value);
  return (
    <Field label={label}>
      <input
        className="field"
        inputMode="numeric"
        placeholder="No limit"
        disabled={disabled}
        value={draft ?? shown}
        onChange={(event) => setDraft(event.target.value)}
        onBlur={() => {
          const trimmed = (draft ?? shown).trim();
          setDraft(null);
          if (trimmed === shown) return;
          if (trimmed === "") onCommit(null);
          else onCommit(Number(trimmed));
        }}
      />
      <span className="mt-1 block text-xs font-normal normal-case tracking-normal text-muted">
        {hint}
      </span>
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
  onCommit: (value: number) => void;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  const shown = String(value);
  return (
    <Field label="Online booking share %">
      <input
        className="field"
        inputMode="numeric"
        min={0}
        max={100}
        disabled={disabled}
        value={draft ?? shown}
        onChange={(event) => setDraft(event.target.value)}
        onBlur={() => {
          const trimmed = (draft ?? shown).trim();
          setDraft(null);
          if (trimmed === "" || trimmed === shown) return;
          onCommit(Number(trimmed));
        }}
      />
      <span className="mt-1 block text-xs font-normal normal-case tracking-normal text-muted">
        Online customers do not see times past this share of technician hours, advisor room, or a
        cap you set. The desk can still book until the day is actually full. 100 matches today.
      </span>
    </Field>
  );
}
