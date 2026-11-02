import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { Meter } from "@/components/ui";
import { lengthLabel, today } from "@/lib/format";
import type { Appointment, TechBoard } from "@/lib/types";

const START = 7 * 60;
const END = 18 * 60;
const SNAP = 30;
const SLOT = 32;
const HANDLE = 10;
/** Prior help box was 44px. 34px is about 23% smaller and still a usable touch target. */
const SUMMARY_MARK = 34;

function summaryMarkBox(block: number) {
  const width = SUMMARY_MARK;
  const height = Math.min(SUMMARY_MARK, block);
  return { width, height, top: Math.max(0, block - height), right: 0, bottom: 0 };
}

export { lengthLabel };

export function cardBlockHeight(minutes: number) {
  return Math.max(SLOT - 2, (minutes / SNAP) * SLOT - 2);
}

/** The grip is the bottom 10px of the card. It does not hang into the next slot. */
export function lengthHandleRange(minutes: number) {
  const height = cardBlockHeight(minutes);
  const top = Math.max(0, height - HANDLE);
  return { top, bottom: height, center: height / 2 };
}

export function planCalendarDrag(input: {
  mode: "move" | "resize";
  time: string;
  minutes: number;
  techId: string;
  dx: number;
  dy: number;
  techIds: string[];
  colWidth: number;
}) {
  const slots = Math.round(input.dy / SLOT);
  if (input.mode === "resize") {
    const start = toMinutes(input.time);
    return {
      time: input.time,
      minutes: clamp(input.minutes + slots * SNAP, 30, END - start),
      techId: input.techId,
    };
  }
  const techShift = Math.round(input.dx / Math.max(1, input.colWidth));
  const minutes = input.minutes;
  const start = clamp(toMinutes(input.time) + slots * SNAP, START, END - minutes);
  const index = Math.max(0, input.techIds.indexOf(input.techId));
  const nextIndex = clamp(index + techShift, 0, Math.max(0, input.techIds.length - 1));
  return { time: fromMinutes(start), minutes, techId: input.techIds[nextIndex] ?? input.techId };
}
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
      const next = planCalendarDrag({
        mode,
        time: origin.time,
        minutes: origin.minutes,
        techId: origin.techId,
        dx,
        dy,
        techIds,
        colWidth,
      });
      commitDraft({ id: appt.id, ...next });
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
      <div className="grid min-w-[52rem]" style={{ display: "grid", minWidth: "52rem", gridTemplateColumns: `5.5rem repeat(${Math.max(techs.length, 1)}, minmax(8.5rem, 1fr))` }}>
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
                position: "relative",
                height,
                overflow: "visible",
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
                const titleBand = 11;
                const mark = summaryMarkBox(block);
                const gutter = mark.width + 2;
                const concernHeight = Math.max(8, block - HANDLE - titleBand - 1);
                const concernLines = Math.max(1, Math.floor(concernHeight / 14));
                const titleRight = mark.top < titleBand ? gutter : 6;
                const concernRight = titleBand + concernHeight > mark.top ? gutter : 6;
                return (
                  <article
                    key={row.id}
                    data-appt
                    data-appt-id={row.id}
                    data-drag="move"
                    className={`group absolute rounded-md border border-[#c5d7ee] bg-[#e7f1fb] text-left shadow-card ${selected ? "border-primary ring-2 ring-primary/30" : ""} ${row.status === "no_show" ? "opacity-55" : ""}`}
                    style={{ position: "absolute", overflow: "hidden", top, height: block, left: 4 + offset * 12, right: 4, zIndex: 1 + offset, cursor: "grab", touchAction: "none" }}
                    onPointerDown={(event) => begin(event, appointments.find((item) => item.id === row.id) ?? row, "move")}
                  >
                    <div data-card-clip className="absolute inset-0 overflow-hidden rounded-md" style={{ overflow: "hidden" }}>
                      <p className="pointer-events-none absolute truncate text-[11px] font-semibold" style={{ left: 6, right: titleRight, top: 0, height: titleBand, margin: 0, lineHeight: "14px", fontSize: 11, overflow: "hidden" }}>{clockTime(row.time)} {label(row)}</p>
                      <p
                        className="pointer-events-none absolute text-[11px]"
                        data-concern
                        data-concern-lines={concernLines}
                        style={{
                          left: 6,
                          right: concernRight,
                          top: titleBand,
                          height: concernHeight,
                          margin: 0,
                          lineHeight: "14px",
                          overflow: "hidden",
                          display: "-webkit-box",
                          WebkitBoxOrient: "vertical",
                          WebkitLineClamp: concernLines,
                        }}
                      >{row.concern}</p>
                      <button
                        type="button"
                        aria-label="Change length"
                        data-drag="resize"
                        className="absolute cursor-ns-resize border-0 p-0"
                        style={{ position: "absolute", left: 4, right: gutter, bottom: 0, height: HANDLE, zIndex: 0, background: selected ? "rgba(1,27,101,0.16)" : "transparent" }}
                        onPointerDown={(event) => begin(event, appointments.find((item) => item.id === row.id) ?? row, "resize")}
                      >
                        <span className={`pointer-events-none mx-auto mt-1 block h-1 w-10 rounded-full ${selected ? "bg-primary" : "bg-[#5d87b0]"} group-hover:h-1.5`} />
                      </button>
                      <button
                        type="button"
                        aria-label="Appointment summary"
                        data-drag="move"
                        data-summary-mark
                        className="absolute z-20 flex items-center justify-center border border-line bg-surface font-semibold leading-none text-muted"
                        style={{ position: "absolute", right: 0, bottom: 0, width: mark.width, height: mark.height, margin: 0, zIndex: 2 }}
                        onMouseEnter={(event) => { if (!draft) showHover(row.id, event.currentTarget.getBoundingClientRect()); }}
                        onMouseLeave={scheduleHide}
                        onPointerDown={(event) => { event.stopPropagation(); begin(event, appointments.find((item) => item.id === row.id) ?? row, "move"); }}
                      >
                        <span className="pointer-events-none text-[8px] leading-none">?</span>
                      </button>
                    </div>
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
        <button type="button" className="btn btn-ghost btn-small min-h-11 min-w-11" onClick={() => onEdit(row.id)}>Edit details</button>
        {onCancel && row.status !== "cancelled" ? <button type="button" className="btn btn-ghost btn-small min-h-11 min-w-11" onClick={() => onCancel(row.id)}>Cancel appointment</button> : null}
        {detail.canWrite ? (
          <button type="button" className="btn btn-primary btn-small" onClick={() => onWrite(row.id)}>Write repair order</button>
        ) : null}
      </div>
      {!detail.canWrite && detail.writeNote ? <p className="mt-2 text-sm text-muted">{detail.writeNote}</p> : null}
      {!detail.canWrite && row.orderId ? <p className="mt-2 text-sm text-muted">Already on a repair order.</p> : null}
    </div>
  );
}
