import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { Meter } from "@/components/ui";
import { today } from "@/lib/format";
import type { Appointment, TechBoard } from "@/lib/types";

const START = 7 * 60;
const END = 18 * 60;
const SNAP = 30;
const SLOT = 32;
export const TECH_DAY_GOAL = 8;

type Draft = { id: string; time: string; minutes: number; techId: string };

function toMinutes(time: string) {
  const [h, m] = time.split(":").map(Number);
  return (h || 0) * 60 + (m || 0);
}

function fromMinutes(mins: number) {
  const clamped = Math.max(0, mins);
  const h = Math.floor(clamped / 60);
  const m = clamped % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

export function clockLabel(mins: number) {
  const h24 = Math.floor(mins / 60) % 24;
  const m = ((mins % 60) + 60) % 60;
  const suffix = h24 >= 12 ? "PM" : "AM";
  const h = h24 % 12 || 12;
  return `${h}:${String(m).padStart(2, "0")} ${suffix}`;
}

export function clockTime(time: string) {
  return clockLabel(toMinutes(time));
}

export function flagHours(n: number) {
  const rounded = Math.round(n * 10) / 10;
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1);
}

export function clockRange(time: string, minutes: number) {
  return `${clockTime(time)}–${clockLabel(toMinutes(time) + minutes)}`;
}

function parseIso(iso: string) {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y, (m || 1) - 1, d || 1);
}

function toIso(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

export function addDays(iso: string, days: number) {
  const date = parseIso(iso);
  date.setDate(date.getDate() + days);
  return toIso(date);
}

export function startOfWeek(iso: string) {
  const date = parseIso(iso);
  const day = date.getDay();
  const delta = day === 0 ? -6 : 1 - day;
  date.setDate(date.getDate() + delta);
  return toIso(date);
}

export function weekDays(monday: string) {
  return Array.from({ length: 6 }, (_, index) => addDays(monday, index));
}

export function dayLabel(iso: string) {
  return parseIso(iso).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
}

function pacificMinutes(date: Date) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Los_Angeles",
    hour: "numeric",
    minute: "numeric",
    second: "numeric",
    hourCycle: "h23",
  }).formatToParts(date);
  const pick = (type: string) => Number(parts.find((part) => part.type === type)?.value ?? 0);
  return pick("hour") * 60 + pick("minute") + pick("second") / 60;
}

function clamp(n: number, min: number, max: number) {
  return Math.max(min, Math.min(max, n));
}

function placed(appt: Appointment, draft: Draft | null) {
  if (!draft || draft.id !== appt.id) return appt;
  return { ...appt, time: draft.time, minutes: draft.minutes, techId: draft.techId };
}

function stack(rows: Appointment[]) {
  const sorted = rows
    .map((row) => ({ row, start: toMinutes(row.time), end: toMinutes(row.time) + row.minutes }))
    .sort((a, b) => a.start - b.start || a.end - b.end);
  return sorted.map((item, index) => {
    const offset = sorted.filter((other, otherIndex) => otherIndex < index && other.end > item.start).length;
    return { ...item, offset };
  });
}

const BOARD_LABEL: Record<Exclude<TechBoard, "none">, string> = {
  express: "Express",
  main: "Main shop",
  internal: "Internals",
};

const BOARD_SHADE: Record<TechBoard, { head: string; column: string; line: string }> = {
  express: { head: "#c5daf2", column: "#d7e7f8", line: "#b7d0ea" },
  main: { head: "#d5e6d8", column: "#e7f0e9", line: "#c9dccf" },
  internal: { head: "#f0e0c4", column: "#f8f1e4", line: "#e6d4b0" },
  none: { head: "#e6e8f0", column: "#f4f5f7", line: "#d9e0d8" },
};

function columnGroups(techs: { board: TechBoard }[]) {
  const groups: { key: string; label: string; count: number; board: TechBoard }[] = [];
  techs.forEach((tech, index) => {
    const label = tech.board === "none" ? "Other" : BOARD_LABEL[tech.board];
    const last = groups[groups.length - 1];
    if (last && last.board === tech.board) last.count += 1;
    else groups.push({ key: `${label}-${index}`, label, count: 1, board: tech.board });
  });
  return groups;
}

export type ApptSummary = {
  name: string;
  vehicle: string;
  advisor: string;
  tech: string;
  when: string;
  lane: string;
  concern: string;
  vin: string;
  ops: string;
  status: string;
  canWrite: boolean;
  writeNote?: string;
};

export function AppointmentCalendar({
  appointments,
  day,
  techs,
  selectedId,
  onSelect,
  onSlot,
  onMove,
  onWrite,
  onEdit,
  onCancel,
  label,
  summary,
  hoursFor,
}: {
  appointments: Appointment[];
  day: string;
  techs: { id: string; number: string; name: string; board: TechBoard }[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  onSlot: (techId: string, time: string) => void;
  onMove: (id: string, patch: { time: string; minutes: number; techId: string }) => void;
  onWrite: (id: string) => void;
  onEdit: (id: string) => void;
  onCancel?: (id: string) => void;
  label: (appt: Appointment) => string;
  summary: (appt: Appointment) => ApptSummary;
  hoursFor: (appt: Appointment) => number;
}) {
  const techIds = techs.map((tech) => tech.id);
  const [draft, setDraft] = useState<Draft | null>(null);
  const draftRef = useRef<Draft | null>(null);
  const [hover, setHover] = useState<{ id: string; x: number; y: number; below: boolean } | null>(null);
  const hideTimer = useRef<number | null>(null);
  const hours = Array.from({ length: (END - START) / 60 }, (_, index) => START + index * 60);
  const height = ((END - START) / SNAP) * SLOT;
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    const id = window.setInterval(() => setNow(new Date()), 15000);
    return () => window.clearInterval(id);
  }, []);

  const nowMins = pacificMinutes(now);
  const nowTop = nowMins >= START && nowMins <= END ? ((nowMins - START) / SNAP) * SLOT : null;

  function showHover(id: string, rect: DOMRect) {
    if (hideTimer.current) window.clearTimeout(hideTimer.current);
    const below = rect.top < 180;
    setHover({ id, x: rect.left, y: below ? rect.bottom + 6 : rect.top - 6, below });
  }

  function scheduleHide() {
    if (hideTimer.current) window.clearTimeout(hideTimer.current);
    hideTimer.current = window.setTimeout(() => setHover(null), 160);
  }

  function commitDraft(next: Draft | null) {
    draftRef.current = next;
    setDraft(next);
  }

  function begin(event: ReactPointerEvent, appt: Appointment, mode: "move" | "resize") {
    event.preventDefault();
    event.stopPropagation();
    const origin = { x: event.clientX, y: event.clientY, time: appt.time, minutes: appt.minutes, techId: appt.techId };
    const column = (event.currentTarget as HTMLElement).closest("[data-tech]") as HTMLElement | null;
    const colWidth = column?.getBoundingClientRect().width ?? 140;
    (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
    setHover(null);
    let moved = false;

    function onMovePointer(ev: PointerEvent) {
      const dx = ev.clientX - origin.x;
      const dy = ev.clientY - origin.y;
      if (Math.abs(dx) + Math.abs(dy) > 4) moved = true;
      const slots = Math.round(dy / SLOT);
      if (mode === "resize") {
        const start = toMinutes(origin.time);
        const minutes = clamp(origin.minutes + slots * SNAP, 30, END - start);
        commitDraft({ id: appt.id, time: origin.time, minutes, techId: origin.techId });
        return;
      }
      const techShift = Math.round(dx / colWidth);
      const minutes = origin.minutes;
      const start = clamp(toMinutes(origin.time) + slots * SNAP, START, END - minutes);
      const index = Math.max(0, techIds.indexOf(origin.techId));
      const nextIndex = clamp(index + techShift, 0, Math.max(0, techIds.length - 1));
      const techId = techIds[nextIndex] ?? origin.techId;
      commitDraft({ id: appt.id, time: fromMinutes(start), minutes, techId });
    }

    function onUp() {
      window.removeEventListener("pointermove", onMovePointer);
      window.removeEventListener("pointerup", onUp);
      const next = draftRef.current;
      commitDraft(null);
      if (moved && next) onMove(appt.id, { time: next.time, minutes: next.minutes, techId: next.techId });
      else onSelect(appt.id);
    }

    window.addEventListener("pointermove", onMovePointer);
    window.addEventListener("pointerup", onUp);
  }

  const shown = appointments.map((row) => placed(row, draft));

  return (
    <div className="card mt-4 overflow-x-auto p-0">
      <div className="grid min-w-[52rem]" style={{ gridTemplateColumns: `5.5rem repeat(${Math.max(techs.length, 1)}, minmax(8.5rem, 1fr))` }}>
        <div className="border-b border-line" />
        {columnGroups(techs).map((group) => (
          <div key={group.key} className="border-b border-l border-line px-2 py-1 text-center text-xs font-semibold uppercase tracking-wide" style={{ gridColumn: `span ${group.count}`, background: BOARD_SHADE[group.board].head }}>
            {group.label}
          </div>
        ))}
        <div className="border-b border-line" />
        {techs.map((tech) => {
          const hours = shown
            .filter((row) => row.date === day && row.techId === tech.id)
            .reduce((sum, row) => sum + hoursFor(row), 0);
          return (
          <div key={tech.id} className="border-b border-l border-line px-2 py-2" style={{ background: BOARD_SHADE[tech.board].head }}>
            <p className="truncate text-sm font-semibold">{tech.name}</p>
            <p className="text-xs tabular-nums text-muted">#{tech.number}</p>
            <p className="mt-1 text-sm font-semibold tabular-nums">{flagHours(hours)} / {TECH_DAY_GOAL} hrs</p>
            <Meter value={hours} max={TECH_DAY_GOAL} />
          </div>
          );
        })}
        <div className="relative" style={{ height }}>
          {hours.map((mins) => (
            <p key={mins} className="absolute right-2 text-xs leading-none text-muted" style={{ top: ((mins - START) / SNAP) * SLOT + 6 }}>
              {clockLabel(mins).replace(":00", "")}
            </p>
          ))}
          {nowTop !== null ? (
            <p className="absolute right-2 z-40 -translate-y-1/2 rounded-sm bg-[#b42318] px-1 text-[10px] font-semibold text-white" style={{ top: nowTop }}>
              {clockLabel(Math.round(nowMins))}
            </p>
          ) : null}
        </div>
        {techs.map((tech) => {
          const rows = stack(shown.filter((row) => row.date === day && row.techId === tech.id));
          return (
            <div
              key={tech.id}
              data-tech={tech.id}
              className="relative border-l border-line"
              style={{
                height,
                backgroundColor: BOARD_SHADE[tech.board].column,
                backgroundImage: `repeating-linear-gradient(to bottom, transparent 0, transparent 31px, ${BOARD_SHADE[tech.board].line} 31px, ${BOARD_SHADE[tech.board].line} 32px)`,
              }}
              onClick={(event) => {
                if ((event.target as HTMLElement).closest("[data-appt]")) return;
                const top = event.currentTarget.getBoundingClientRect().top;
                const mins = clamp(START + Math.floor((event.clientY - top) / SLOT) * SNAP, START, END - 30);
                onSlot(tech.id, fromMinutes(mins));
              }}
            >
              {rows.map(({ row, offset }) => {
                const start = toMinutes(row.time);
                const top = ((start - START) / SNAP) * SLOT;
                const block = Math.max(SLOT - 2, (row.minutes / SNAP) * SLOT - 2);
                const selected = row.id === selectedId;
                return (
                  <article
                    key={row.id}
                    data-appt
                    className={`absolute overflow-hidden rounded-md border border-[#c5d7ee] bg-[#e7f1fb] px-1.5 py-1 pr-6 text-left shadow-card ${selected ? "border-primary ring-2 ring-primary/30" : ""} ${row.status === "no_show" ? "opacity-55" : ""}`}
                    style={{ top, height: block, left: 4 + offset * 12, right: 4, zIndex: hover?.id === row.id ? 30 : selected ? 5 : 1 + offset, cursor: "grab", touchAction: "none" }}
                    onPointerDown={(event) => begin(event, appointments.find((item) => item.id === row.id) ?? row, "move")}
                  >
                    <p className="truncate text-xs font-semibold">{clockTime(row.time)} {label(row)}</p>
                    <p className="truncate text-xs">{row.concern}</p>
                    <button
                      type="button"
                      aria-label="Change length"
                      className="absolute bottom-0 left-1 right-6 h-2 cursor-ns-resize border-0 bg-transparent"
                      onPointerDown={(event) => begin(event, appointments.find((item) => item.id === row.id) ?? row, "resize")}
                    />
                    <button
                      type="button"
                      aria-label="Appointment summary"
                      className="absolute right-1 bottom-1 z-10 flex size-4 items-center justify-center rounded-full border border-line bg-surface text-[10px] font-semibold leading-none text-muted"
                      onMouseEnter={(event) => { if (!draft) showHover(row.id, event.currentTarget.getBoundingClientRect()); }}
                      onMouseLeave={scheduleHide}
                      onPointerDown={(event) => event.stopPropagation()}
                    >
                      ?
                    </button>
                  </article>
                );
              })}
              {nowTop !== null && day === today() ? (
                <div className="pointer-events-none absolute inset-x-0 z-40" style={{ top: nowTop }}>
                  <div className="h-0.5 bg-[#b42318]" />
                </div>
              ) : null}
            </div>
          );
        })}
      </div>
      {hover && !draft ? <HoverCard hover={hover} appointments={appointments} summary={summary} onWrite={onWrite} onEdit={onEdit} onCancel={onCancel} onEnter={() => { if (hideTimer.current) window.clearTimeout(hideTimer.current); }} onLeave={scheduleHide} /> : null}
    </div>
  );
}

function HoverCard({
  hover,
  appointments,
  summary,
  onWrite,
  onEdit,
  onCancel,
  onEnter,
  onLeave,
}: {
  hover: { id: string; x: number; y: number; below: boolean };
  appointments: Appointment[];
  summary: (appt: Appointment) => ApptSummary;
  onWrite: (id: string) => void;
  onEdit: (id: string) => void;
  onCancel?: (id: string) => void;
  onEnter: () => void;
  onLeave: () => void;
}) {
  const row = appointments.find((item) => item.id === hover.id);
  if (!row) return null;
  const detail = summary(row);
  return (
    <div
      className="fixed z-50 w-64 rounded-md border border-line bg-surface-2 p-3 shadow-card"
      style={{ left: hover.x, top: hover.y, transform: hover.below ? undefined : "translateY(-100%)" }}
      onMouseEnter={onEnter}
      onMouseLeave={onLeave}
      onPointerDown={(event) => event.stopPropagation()}
    >
      <p className="font-semibold">{detail.name}</p>
      <p className="text-sm text-muted">{detail.vehicle}</p>
      <p className="mt-1 text-sm">{detail.when}</p>
      <p className="text-sm text-muted">{detail.lane} · {detail.advisor}</p>
      <p className="text-sm">{detail.tech}</p>
      <p className="mt-1 font-mono text-sm">{detail.vin}</p>
      <p className="text-sm">{detail.ops}</p>
      <p className="mt-1 text-sm">{detail.concern}</p>
      <p className="mt-1 text-xs font-semibold uppercase tracking-wide text-muted">{detail.status}</p>
      <div className="mt-2 flex flex-wrap gap-2">
        <button type="button" className="btn btn-ghost btn-small" onClick={() => onEdit(row.id)}>Edit details</button>
        {onCancel && row.status !== "cancelled" ? <button type="button" className="btn btn-ghost btn-small" onClick={() => onCancel(row.id)}>Cancel appointment</button> : null}
        {detail.canWrite ? (
          <button type="button" className="btn btn-primary btn-small" onClick={() => onWrite(row.id)}>Write repair order</button>
        ) : null}
      </div>
      {!detail.canWrite && detail.writeNote ? <p className="mt-2 text-sm text-muted">{detail.writeNote}</p> : null}
      {!detail.canWrite && row.orderId ? <p className="mt-2 text-sm text-muted">Already on a repair order.</p> : null}
    </div>
  );
}
