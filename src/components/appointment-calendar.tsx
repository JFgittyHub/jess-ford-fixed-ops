import { Fragment, useEffect, useLayoutEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { flushSync } from "react-dom";
import { Meter } from "@/components/ui";
import { lengthLabel, today } from "@/lib/format";
import type { Appointment, TechBoard } from "@/lib/types";

const START = 7 * 60;
const END = 18 * 60;
const SNAP = 30;
const SLOT = 32;

/** Row index under the pointer, frozen at pointerdown so a later scroll cannot retarget it. */
function slotRowIndex(column: HTMLElement, clientY: number) {
  const top = column.getBoundingClientRect().top;
  const rows = (END - START) / SNAP;
  return Math.min(rows - 1, Math.max(0, Math.floor((clientY - top) / SLOT)));
}

/** Vertical center of that row, in client coordinates, using the column's position right now. */
function slotRowCenter(column: HTMLElement, clientY: number) {
  return column.getBoundingClientRect().top + slotRowIndex(column, clientY) * SLOT + SLOT / 2;
}

/** Window scroll, unless the event target is itself a scrolling box. A cell under the finger is not one. */
function scrollOffset(target: EventTarget | null): { node: EventTarget; x: number; y: number } {
  if (target instanceof HTMLElement && target !== document.body && target !== document.documentElement) {
    const style = getComputedStyle(target);
    const scrolls = style.overflowY === "auto" || style.overflowY === "scroll"
      || style.overflowX === "auto" || style.overflowX === "scroll"
      || target.scrollHeight > target.clientHeight + 1
      || target.scrollWidth > target.clientWidth + 1
      || target.scrollTop !== 0
      || target.scrollLeft !== 0;
    if (scrolls) return { node: target, x: target.scrollLeft, y: target.scrollTop };
  }
  return { node: window, x: window.scrollX, y: window.scrollY };
}
const HANDLE = 10;
/** Prior help box was 44px. 34px is about 23% smaller and still a usable touch target. */
const SUMMARY_MARK = 34;

function summaryMarkBox(block: number) {
  const width = SUMMARY_MARK;
  const height = Math.min(SUMMARY_MARK, Math.max(1, block - 1));
  return { width, height, top: Math.max(0, block - height), right: 0, bottom: 0 };
}

function laneTag(lane: string) {
  if (lane === "waiter") return "Waiter";
  if (lane === "drop") return "Drop-off";
  return "";
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

function stretchStrip(rows: { row: Appointment; start: number }[], id: string, top: number, block: number) {
  const padTop = top + block;
  let height = 24;
  let raised = false;
  for (const other of rows) {
    if (other.row.id === id) continue;
    const otherTop = ((other.start - START) / SNAP) * SLOT;
    const otherBlock = Math.max(SLOT - 2, (other.row.minutes / SNAP) * SLOT - 2);
    if (otherTop >= padTop + 24 || otherTop + otherBlock <= padTop) continue;
    const center = otherTop + otherBlock / 2;
    height = Math.max(12, Math.min(24, Math.floor(center - padTop - 3)));
    raised = true;
    break;
  }
  return { height, raised };
}

function stack(rows: Appointment[]) {
  const sorted = rows
    .map((row) => ({ row, start: toMinutes(row.time), end: toMinutes(row.time) + row.minutes }))
    .sort((a, b) => a.start - b.start || a.end - b.end);
  const placed: { row: Appointment; start: number; end: number; offset: number }[] = [];
  for (const item of sorted) {
    const used = new Set(placed.filter((other) => other.end > item.start && item.end > other.start).map((other) => other.offset));
    let offset = 0;
    while (used.has(offset)) offset += 1;
    placed.push({ ...item, offset });
  }
  return placed.map((item) => {
    const seen = new Set<(typeof placed)[number]>();
    const queue = [item];
    while (queue.length) {
      const current = queue.pop();
      if (!current || seen.has(current)) continue;
      seen.add(current);
      for (const other of placed) {
        if (other !== current && other.end > current.start && current.end > other.start) queue.push(other);
      }
    }
    const lanes = Math.max(1, ...[...seen].map((other) => other.offset + 1));
    return { ...item, lanes };
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
  onCopy,
  onPasteSlot,
  canPaste = false,
  slotOpen = true,
  onSlotRefused,
  onSlotAccepted,
  slotError,
  longPressMs = 550,
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
  onCopy?: (id: string) => void;
  onPasteSlot?: (techId: string, time: string) => void;
  /** Paste stays hidden until a card has been copied. */
  canPaste?: boolean;
  /** Closed, past, and other-store days open neither Book nor Paste. */
  slotOpen?: boolean;
  onSlotRefused?: (message?: string) => void;
  /** A valid Book or Paste clears a refusal that is already in the bar. */
  onSlotAccepted?: () => void;
  /** Outside shop hours, and any other slot the day check still allows. */
  slotError?: (time: string) => string | null;
  /** Press-and-hold delay before the copy or paste menu opens. */
  longPressMs?: number;
  label: (appt: Appointment) => string;
  summary: (appt: Appointment) => ApptSummary;
  hoursFor: (appt: Appointment) => number;
}) {
  const techIds = techs.map((tech) => tech.id);
  const [draft, setDraft] = useState<Draft | null>(null);
  const draftRef = useRef<Draft | null>(null);
  const [hover, setHover] = useState<{ id: string; x: number; y: number; below: boolean } | null>(null);
  const hideTimer = useRef<number | null>(null);
  const touchSummaryAt = useRef(0);
  const gesture = useRef({ moved: false, summary: false, x: 0, y: 0 });
  const suppressSlotClick = useRef(false);
  const heldPointerId = useRef<number | null>(null);
  const heldPointerActive = useRef(false);
  const foreignPointers = useRef(new Set<number>());
  const ignoreMenuScroll = useRef(false);
  const menuScrollOrigin = useRef(new Map<EventTarget, { x: number; y: number }>());
  const windowCleanups = useRef(new Set<() => void>());
  const disarmHold = useRef<(() => void) | null>(null);
  type SlotMenu =
    | { kind: "copy"; id: string; x: number; y: number; rowCenter: number }
    | { kind: "paste"; techId: string; time: string; x: number; y: number; rowCenter: number; pointerType: string };
  const [menu, setMenu] = useState<SlotMenu | null>(null);
  const menuRef = useRef<SlotMenu | null>(null);
  const menuNode = useRef<HTMLDivElement>(null);
  const releaseNotice = useRef(false);
  const anchorPinned = useRef(false);
  const dismissingMenu = useRef(false);
  function syncAnchor() {
    const pin = heldPointerActive.current || menuRef.current !== null;
    if (pin === anchorPinned.current) return;
    anchorPinned.current = pin;
    const value = pin ? "none" : "";
    document.documentElement.style.overflowAnchor = value;
    document.body.style.overflowAnchor = value;
  }
  function openMenu(next: SlotMenu, acceptOnClose: boolean) {
    menuRef.current = next;
    if (acceptOnClose) releaseNotice.current = true;
    flushSync(() => setMenu(next));
    syncAnchor();
  }
  const dismissMenuRef = useRef<(commit?: () => void) => void>(() => undefined);
  function dismissMenu(commit?: () => void) {
    if (dismissingMenu.current) {
      commit?.();
      return;
    }
    dismissingMenu.current = true;
    try {
      const release = releaseNotice.current && menuRef.current?.kind === "paste";
      releaseNotice.current = false;
      menuRef.current = null;
      flushSync(() => {
        if (release) onSlotAccepted?.();
        commit?.();
        setMenu(null);
      });
      syncAnchor();
    } finally {
      dismissingMenu.current = false;
    }
  }
  dismissMenuRef.current = dismissMenu;
  const hours = Array.from({ length: (END - START) / 60 }, (_, index) => START + index * 60);
  const height = ((END - START) / SNAP) * SLOT;
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    const id = window.setInterval(() => setNow(new Date()), 15000);
    return () => window.clearInterval(id);
  }, []);

  useEffect(() => {
    const cleanups = windowCleanups.current;
    const pointers = foreignPointers.current;
    return () => {
      disarmHold.current?.();
      disarmHold.current = null;
      for (const cleanup of cleanups) cleanup();
      cleanups.clear();
      pointers.clear();
      suppressSlotClick.current = false;
      heldPointerId.current = null;
      heldPointerActive.current = false;
      menuRef.current = null;
      releaseNotice.current = false;
      anchorPinned.current = false;
      document.documentElement.style.overflowAnchor = "";
      document.body.style.overflowAnchor = "";
    };
  }, []);

  useLayoutEffect(() => {
    if (!menu) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") dismissMenuRef.current();
    };
    const onPointer = (event: PointerEvent) => {
      if ((event.target as HTMLElement | null)?.closest?.("[data-context-menu]")) return;
      if (heldPointerActive.current && event.pointerId !== heldPointerId.current) return;
      if (event.isPrimary === false) return;
      if (event.pointerType === "mouse" && event.button !== 0) return;
      dismissMenuRef.current();
    };
    const origin = menuScrollOrigin.current;
    origin.clear();
    const remember = (node: EventTarget, x: number, y: number) => origin.set(node, { x, y });
    remember(window, window.scrollX, window.scrollY);
    remember(document, window.scrollX, window.scrollY);
    remember(document.documentElement, document.documentElement.scrollLeft, document.documentElement.scrollTop);
    document.querySelectorAll("[data-tech]").forEach((column) => {
      let node = column.parentElement;
      while (node) {
        remember(node, node.scrollLeft, node.scrollTop);
        node = node.parentElement;
      }
    });
    let menuTop = document.querySelector("[data-tech]")?.getBoundingClientRect().top ?? 0;
    const onScroll = (event: Event) => {
      const now = scrollOffset(event.target);
      const viewport = now.node === window;
      const then = origin.get(now.node);
      if (viewport && ignoreMenuScroll.current) {
        const top = document.querySelector("[data-tech]")?.getBoundingClientRect().top ?? menuTop;
        const scrolledY = window.scrollY - (origin.get(window)?.y ?? window.scrollY);
        const shifted = top - menuTop;
        const follows = Math.abs(scrolledY) >= 1 && Math.abs(shifted + scrolledY) <= 8;
        if (!follows) {
          origin.set(now.node, { x: now.x, y: now.y });
          if (Math.abs(scrolledY) < 1) menuTop = top;
          return;
        }
      }
      if (!then || (Math.abs(now.x - then.x) < 1 && Math.abs(now.y - then.y) < 1)) return;
      dismissMenuRef.current();
    };
    const onWheel = (event: WheelEvent) => {
      if (Math.abs(event.deltaX) + Math.abs(event.deltaY) <= 8) return;
      dismissMenuRef.current();
    };
    const widthAtOpen = window.innerWidth;
    const onResize = () => {
      if (window.innerWidth === widthAtOpen) return;
      dismissMenuRef.current();
    };
    const onOrient = () => dismissMenuRef.current();
    window.addEventListener("keydown", onKey);
    window.addEventListener("pointerdown", onPointer);
    window.addEventListener("scroll", onScroll, true);
    window.addEventListener("wheel", onWheel, true);
    window.addEventListener("resize", onResize);
    window.addEventListener("orientationchange", onOrient);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("pointerdown", onPointer);
      window.removeEventListener("scroll", onScroll, true);
      window.removeEventListener("wheel", onWheel, true);
      window.removeEventListener("resize", onResize);
      window.removeEventListener("orientationchange", onOrient);
    };
  }, [menu]);

  useLayoutEffect(() => {
    const node = menuNode.current;
    if (!node || !menu) return;
    const button = node.querySelector("button");
    if (!button) return;
    const buttonRect = button.getBoundingClientRect();
    if (buttonRect.height < 1) return;
    const menuRect = node.getBoundingClientRect();
    const buttonCenter = buttonRect.top + buttonRect.height / 2;
    // Keep the button center inside the visible slice of the held row. A row tucked under the
    // sticky bar or past the window still saves that row; the center never jumps to the next one.
    const rowTop = menu.rowCenter - SLOT / 2;
    const rowBottom = menu.rowCenter + SLOT / 2;
    const chrome = Math.max(
      document.querySelector("[data-copy-bar]")?.getBoundingClientRect().bottom ?? 0,
      document.querySelector("header.app-header")?.getBoundingClientRect().bottom ?? 0,
    );
    const visibleTop = Math.max(rowTop, chrome);
    const visibleBottom = Math.min(rowBottom, window.innerHeight);
    let center = menu.rowCenter;
    if (visibleTop < visibleBottom) {
      const pad = Math.min(4, (visibleBottom - visibleTop) / 2);
      center = Math.min(Math.max(menu.rowCenter, visibleTop + pad), visibleBottom - pad);
    }
    const top = menuRect.top + (center - buttonCenter);
    const left = Math.min(Math.max(menuRect.left, 0), Math.max(0, window.innerWidth - menuRect.width));
    node.style.top = `${top}px`;
    node.style.left = `${left}px`;
  }, [menu]);

  const nowMins = pacificMinutes(now);
  const nowTop = nowMins >= START && nowMins <= END ? ((nowMins - START) / SNAP) * SLOT : null;

  function showHover(id: string, rect: DOMRect) {
    if (hideTimer.current) window.clearTimeout(hideTimer.current);
    const below = rect.top < 180;
    setHover({ id, x: rect.left, y: below ? rect.bottom + 6 : rect.top - 6, below });
  }

  function scheduleHide() {
    if (Date.now() - touchSummaryAt.current < 700) return;
    if (hideTimer.current) window.clearTimeout(hideTimer.current);
    hideTimer.current = window.setTimeout(() => setHover(null), 160);
  }

  function commitDraft(next: Draft | null) {
    draftRef.current = next;
    setDraft(next);
  }

  function pointOn(event: ReactPointerEvent) {
    const box = event.currentTarget.getBoundingClientRect();
    if (box.width < 1 && box.height < 1) return true;
    return event.clientX >= box.left && event.clientX <= box.right && event.clientY >= box.top && event.clientY <= box.bottom;
  }

  function begin(event: ReactPointerEvent, appt: Appointment, mode: "move" | "resize", quiet?: "summary") {
    if (heldPointerId.current !== null && event.pointerId !== heldPointerId.current) {
      event.preventDefault();
      event.stopPropagation();
      return;
    }
    if (event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    const mark = event.currentTarget as HTMLElement;
    const origin = { x: event.clientX, y: event.clientY, time: appt.time, minutes: appt.minutes, techId: appt.techId };
    const column = (event.currentTarget as HTMLElement).closest("[data-tech]") as HTMLElement | null;
    const colWidth = column?.getBoundingClientRect().width ?? 140;
    try { mark.setPointerCapture?.(event.pointerId); } catch { /* a synthetic pointer has no capture */ }
    setHover(null);
    gesture.current = { moved: false, summary: quiet === "summary", x: event.clientX, y: event.clientY };
    const slop = quiet === "summary" ? 16 : 4;
    let moved = false;
    let held = false;
    if (mode === "resize") suppressSlotClick.current = true;
    const pressTimer = mode === "move" && quiet !== "summary" && onCopy
      ? window.setTimeout(() => {
        if (moved) return;
        held = true;
        window.removeEventListener("pointermove", onMovePointer);
        window.removeEventListener("pointerup", onUp);
        commitDraft(null);
        setHover(null);
        openMenu({ kind: "copy", id: appt.id, x: origin.x, y: origin.y, rowCenter: column ? slotRowCenter(column, origin.y) : origin.y }, false);
      }, longPressMs)
      : 0;

    function onMovePointer(ev: PointerEvent) {
      const dx = ev.clientX - origin.x;
      const dy = ev.clientY - origin.y;
      if (Math.abs(dx) + Math.abs(dy) > slop) {
        moved = true;
        gesture.current.moved = true;
        if (pressTimer) window.clearTimeout(pressTimer);
      }
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
      if (pressTimer) window.clearTimeout(pressTimer);
      window.removeEventListener("pointermove", onMovePointer);
      window.removeEventListener("pointerup", onUp);
      if (mode === "resize") suppressSlotClick.current = true;
      if (held) return;
      const next = draftRef.current;
      commitDraft(null);
      if (moved && next) onMove(appt.id, { time: next.time, minutes: next.minutes, techId: next.techId });
      else if (quiet === "summary") {
        if (event.pointerType === "touch") touchSummaryAt.current = Date.now();
        showHover(appt.id, mark.getBoundingClientRect());
      }
      else onSelect(appt.id);
    }

    window.addEventListener("pointermove", onMovePointer);
    window.addEventListener("pointerup", onUp);
  }

  function pressPad(event: ReactPointerEvent, owner: Appointment) {
    if (event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    suppressSlotClick.current = true;
    const column = (event.currentTarget as HTMLElement).closest("[data-tech]") as HTMLElement | null;
    const neighbourId = column ? [...column.querySelectorAll<HTMLElement>("[data-appt]")].find((node) => {
      if (node.getAttribute("data-appt-id") === owner.id) return false;
      const box = node.getBoundingClientRect();
      return event.clientX >= box.left && event.clientX <= box.right && event.clientY >= box.top && event.clientY <= box.bottom;
    })?.getAttribute("data-appt-id") : null;
    const neighbour = neighbourId ? appointments.find((item) => item.id === neighbourId) ?? null : null;
    if (!neighbour) {
      begin(event, owner, "resize");
      return;
    }
    const origin = { x: event.clientX, y: event.clientY };
    const colWidth = column?.getBoundingClientRect().width ?? 140;
    let moved = false;
    let held = false;
    const pressTimer = onCopy
      ? window.setTimeout(() => {
        if (moved) return;
        held = true;
        window.removeEventListener("pointermove", onMovePointer);
        window.removeEventListener("pointerup", onUp);
        commitDraft(null);
        openMenu({ kind: "copy", id: neighbour.id, x: origin.x, y: origin.y, rowCenter: column ? slotRowCenter(column, origin.y) : origin.y }, false);
      }, longPressMs)
      : 0;
    function onMovePointer(ev: PointerEvent) {
      const dx = ev.clientX - origin.x;
      const dy = ev.clientY - origin.y;
      if (Math.abs(dx) + Math.abs(dy) <= 4) return;
      moved = true;
      if (pressTimer) window.clearTimeout(pressTimer);
      const next = planCalendarDrag({
        mode: "resize",
        time: owner.time,
        minutes: owner.minutes,
        techId: owner.techId,
        dx,
        dy,
        techIds,
        colWidth,
      });
      commitDraft({ id: owner.id, ...next });
    }
    function onUp() {
      if (pressTimer) window.clearTimeout(pressTimer);
      window.removeEventListener("pointermove", onMovePointer);
      window.removeEventListener("pointerup", onUp);
      suppressSlotClick.current = true;
      if (held) return;
      const next = draftRef.current;
      commitDraft(null);
      if (moved && next) onMove(owner.id, { time: next.time, minutes: next.minutes, techId: next.techId });
      else if (neighbour) onSelect(neighbour.id);
    }
    window.addEventListener("pointermove", onMovePointer);
    window.addEventListener("pointerup", onUp);
  }

  const shown = appointments.map((row) => placed(row, draft));

  return (
    <div className="card mt-4 overflow-x-auto p-0" style={{ scrollMarginTop: "calc(var(--app-header-height, 0px) + var(--copy-bar-height, 0px))" }}>
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
                const clickPointerId = (event.nativeEvent as PointerEvent | undefined)?.pointerId;
                const usablePointer = typeof clickPointerId === "number" && clickPointerId >= 0;
                if (heldPointerId.current !== null && (!usablePointer || clickPointerId !== heldPointerId.current)) {
                  if (usablePointer) foreignPointers.current.delete(clickPointerId);
                  event.preventDefault();
                  return;
                }
                if (usablePointer && foreignPointers.current.delete(clickPointerId)) {
                  event.preventDefault();
                  return;
                }
                if ((event.target as HTMLElement).closest?.("[data-appt]")) return;
                if (suppressSlotClick.current) {
                  suppressSlotClick.current = false;
                  return;
                }
                const top = event.currentTarget.getBoundingClientRect().top;
                const mins = clamp(START + Math.floor((event.clientY - top) / SLOT) * SNAP, START, END - 30);
                const time = fromMinutes(mins);
                if (!slotOpen) {
                  onSlotRefused?.();
                  return;
                }
                const block = slotError?.(time);
                if (block) {
                  onSlotRefused?.(block);
                  return;
                }
                onSlotAccepted?.();
                onSlot(tech.id, time);
              }}
              onContextMenu={(event) => {
                if (heldPointerActive.current) {
                  event.preventDefault();
                  return;
                }
                if ((event.target as HTMLElement).closest("[data-appt]")) return;
                event.preventDefault();
                const top = event.currentTarget.getBoundingClientRect().top;
                const mins = clamp(START + Math.floor((event.clientY - top) / SLOT) * SNAP, START, END - 30);
                const time = fromMinutes(mins);
                if (!slotOpen) {
                  onSlotRefused?.();
                  return;
                }
                const block = slotError?.(time);
                if (block) {
                  onSlotRefused?.(block);
                  return;
                }
                if (canPaste && onPasteSlot) {
                  openMenu({ kind: "paste", techId: tech.id, time, x: event.clientX, y: event.clientY, rowCenter: slotRowCenter(event.currentTarget, event.clientY), pointerType: "mouse" }, true);
                  return;
                }
                onSlotAccepted?.();
                onSlot(tech.id, time);
              }}
              onPointerDown={(event) => {
                if (heldPointerId.current !== null && event.pointerId !== heldPointerId.current) {
                  if (!foreignPointers.current.has(event.pointerId)) {
                    const pointerId = event.pointerId;
                    foreignPointers.current.add(pointerId);
                    let finish: (ev: PointerEvent) => void = () => undefined;
                    const detach = () => {
                      window.removeEventListener("pointerup", finish);
                      window.removeEventListener("pointercancel", finish);
                    };
                    finish = (ev: PointerEvent) => {
                      if (ev.pointerId !== pointerId) return;
                      detach();
                      windowCleanups.current.delete(detach);
                      if (ev.type === "pointercancel") foreignPointers.current.delete(pointerId);
                    };
                    windowCleanups.current.add(detach);
                    window.addEventListener("pointerup", finish);
                    window.addEventListener("pointercancel", finish);
                  }
                  return;
                }
                const primary = event.isPrimary === true && (event.pointerType !== "mouse" || event.button === 0);
                if (primary && heldPointerId.current === null) {
                  suppressSlotClick.current = false;
                  foreignPointers.current.clear();
                }
                if (!primary) return;
                if (event.button !== 0 && event.pointerType !== "touch") return;
                if ((event.target as HTMLElement).closest("[data-appt]")) return;
                const startX = event.clientX;
                const startY = event.clientY;
                const column = event.currentTarget;
                const pointerId = event.pointerId;
                const slotAt = () => fromMinutes(clamp(START + Math.floor((startY - column.getBoundingClientRect().top) / SLOT) * SNAP, START, END - 30));
                const heldTime = slotAt();
                const heldRow = slotRowIndex(column, startY);
                const pointerKind = event.pointerType;
                const hoursBlock = slotError?.(heldTime) ?? null;
                const scrollOrigin = new Map<EventTarget, { x: number; y: number }>();
                const rememberScroll = (node: EventTarget, x: number, y: number) => scrollOrigin.set(node, { x, y });
                rememberScroll(window, window.scrollX, window.scrollY);
                rememberScroll(document, window.scrollX, window.scrollY);
                rememberScroll(document.documentElement, document.documentElement.scrollLeft, document.documentElement.scrollTop);
                let scrollNode: HTMLElement | null = column;
                while (scrollNode) {
                  rememberScroll(scrollNode, scrollNode.scrollLeft, scrollNode.scrollTop);
                  scrollNode = scrollNode.parentElement;
                }
                const arm = (timer: number) => {
                  heldPointerId.current = pointerId;
                  heldPointerActive.current = true;
                  const move = (ev: PointerEvent) => {
                    if (ev.pointerId !== pointerId) return;
                    if (Math.abs(ev.clientX - startX) + Math.abs(ev.clientY - startY) > 8) window.clearTimeout(timer);
                  };
                  let end: (ev: PointerEvent) => void = () => undefined;
                  let onScroll: (event: Event) => void = () => undefined;
                  const widthAtArm = window.innerWidth;
                  const onViewport = (viewportEvent: Event) => {
                    if (viewportEvent.type === "resize" && window.innerWidth === widthAtArm) return;
                    window.clearTimeout(timer);
                    suppressSlotClick.current = true;
                    disarm();
                  };
                  const disarm = () => {
                    ignoreMenuScroll.current = false;
                    window.clearTimeout(timer);
                    window.removeEventListener("pointermove", move);
                    window.removeEventListener("pointerup", end);
                    window.removeEventListener("pointercancel", end);
                    window.removeEventListener("scroll", onScroll, true);
                    window.removeEventListener("wheel", onScroll, true);
                    window.removeEventListener("resize", onViewport);
                    window.removeEventListener("orientationchange", onViewport);
                    windowCleanups.current.delete(disarm);
                    if (disarmHold.current === disarm) disarmHold.current = null;
                    if (heldPointerId.current === pointerId) {
                      heldPointerId.current = null;
                      heldPointerActive.current = false;
                    }
                    syncAnchor();
                  };
                  onScroll = (event: Event) => {
                    if (heldPointerId.current !== pointerId) return;
                    // A touch scroll's target is the element under the finger. That node usually
                    // does not scroll; comparing its scrollTop of 0 with the window's scrollY
                    // looked like a jump and cancelled a 6px hold.
                    const now = scrollOffset(event.target);
                    const then = scrollOrigin.get(now.node);
                    if (!then) {
                      scrollOrigin.set(now.node, { x: now.x, y: now.y });
                      return;
                    }
                    if (Math.abs(now.x - then.x) <= 8 && Math.abs(now.y - then.y) <= 8) return;
                    suppressSlotClick.current = true;
                    dismissMenu();
                    disarm();
                  };
                  end = (ev: PointerEvent) => {
                    if (ev.pointerId !== pointerId) return;
                    disarm();
                  };
                  disarmHold.current = disarm;
                  windowCleanups.current.add(disarm);
                  syncAnchor();
                  window.addEventListener("pointermove", move);
                  window.addEventListener("pointerup", end);
                  window.addEventListener("pointercancel", end);
                  window.addEventListener("scroll", onScroll, true);
                  window.addEventListener("wheel", onScroll, true);
                  window.addEventListener("resize", onViewport);
                  window.addEventListener("orientationchange", onViewport);
                };
                const claimHold = () => {
                  suppressSlotClick.current = true;
                  heldPointerId.current = pointerId;
                  heldPointerActive.current = true;
                };
                if (!slotOpen || hoursBlock) {
                  arm(window.setTimeout(() => {
                    claimHold();
                    onSlotRefused?.(slotOpen ? hoursBlock ?? undefined : undefined);
                  }, longPressMs));
                  return;
                }
                if (!onPasteSlot || !canPaste) return;
                arm(window.setTimeout(() => {
                  claimHold();
                  openMenu({
                    kind: "paste",
                    techId: tech.id,
                    time: heldTime,
                    x: startX,
                    y: startY,
                    rowCenter: column.getBoundingClientRect().top + heldRow * SLOT + SLOT / 2,
                    pointerType: pointerKind,
                  }, true);
                }, longPressMs));
              }}
            >
              {menu?.kind === "paste" && menu.techId === tech.id && menu.pointerType === "touch" ? (
                <div
                  data-held-slot
                  aria-hidden
                  className="pointer-events-none absolute z-30 rounded-sm"
                  style={{
                    left: 2,
                    right: 2,
                    top: ((toMinutes(menu.time) - START) / SNAP) * SLOT,
                    height: SLOT - 2,
                    boxShadow: "inset 0 0 0 3px #011b65",
                  }}
                />
              ) : null}
              {rows.map(({ row, offset, lanes }) => {
                const start = toMinutes(row.time);
                const top = ((start - START) / SNAP) * SLOT;
                const block = Math.max(SLOT - 2, (row.minutes / SNAP) * SLOT - 2);
                const split = lanes > 1;
                const laneStyle = split
                  ? { left: `calc(4px + ${offset} * ((100% - 8px) / ${lanes}))`, width: `calc((100% - 8px) / ${lanes} - 4px)`, right: "auto" }
                  : { left: 4 + offset * 12, right: 4 };
                const selected = row.id === selectedId;
                const titleBand = 11;
                const mark = summaryMarkBox(block);
                const gutter = mark.width + 2;
                const concernRoom = block - HANDLE - titleBand - 1;
                const concernLines = concernRoom >= 14 ? Math.floor(concernRoom / 14) : 0;
                const concernHeight = concernLines * 14;
                const titleRight = mark.top < titleBand ? gutter : 6;
                const concernRight = titleBand + concernHeight > mark.top ? gutter : 6;
                const tag = laneTag(row.lane);
                const visit = appointments.find((item) => item.id === row.id) ?? row;
                const strip = stretchStrip(rows, row.id, top, block);
                return (
                  <Fragment key={row.id}>
                  <article
                    data-appt
                    data-appt-id={row.id}
                    data-drag="move"
                    className={`group absolute rounded-md border border-[#c5d7ee] bg-[#e7f1fb] text-left shadow-card ${selected ? "border-primary ring-2 ring-primary/30" : ""} ${row.status === "no_show" ? "opacity-55" : ""}`}
                    data-appt-time={row.time}
                    style={{ position: "absolute", overflow: "hidden", top, height: block, ...laneStyle, zIndex: split ? 1 : 1 + offset, cursor: "grab", touchAction: "none", scrollMarginTop: "calc(var(--app-header-height, 0px) + var(--copy-bar-height, 0px))" }}
                    onPointerDown={(event) => begin(event, visit, "move")}
                    onContextMenu={(event) => {
                      if (heldPointerActive.current) {
                        event.preventDefault();
                        return;
                      }
                      if (!onCopy) return;
                      event.preventDefault();
                      event.stopPropagation();
                      const column = (event.currentTarget as HTMLElement).closest("[data-tech]");
                      openMenu({ kind: "copy", id: row.id, x: event.clientX, y: event.clientY, rowCenter: column instanceof HTMLElement ? slotRowCenter(column, event.clientY) : event.clientY }, false);
                    }}
                  >
                    <div data-card-clip className="absolute inset-0 overflow-hidden rounded-md" style={{ overflow: "hidden" }}>
                      <p className="pointer-events-none absolute truncate text-[11px] font-semibold" style={{ left: 6, right: titleRight, top: 0, height: titleBand, margin: 0, lineHeight: "14px", fontSize: 11, overflow: "hidden" }}>{clockTime(row.time)} {label(row)}</p>
                      {tag ? (
                        <span
                          data-lane-tag
                          className="pointer-events-none absolute z-10 truncate rounded-sm border border-[#9eb6d4] bg-white px-1 font-semibold text-[#14315c]"
                          style={{ position: "absolute", left: 4, bottom: HANDLE, maxWidth: `calc(100% - ${gutter + 8}px)`, height: 14, lineHeight: "12px", fontSize: 10, zIndex: 1 }}
                        >{tag}</span>
                      ) : null}
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
                        onPointerDown={(event) => begin(event, visit, pointOn(event) ? "resize" : "move")}
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
                        onTouchStart={(event) => {
                          const touch = event.changedTouches?.[0];
                          gesture.current = { moved: false, summary: true, x: touch?.clientX ?? 0, y: touch?.clientY ?? 0 };
                        }}
                        onTouchMove={(event) => {
                          const touch = event.changedTouches?.[0];
                          if (!touch) return;
                          const dx = touch.clientX - gesture.current.x;
                          const dy = touch.clientY - gesture.current.y;
                          if (Math.abs(dx) + Math.abs(dy) > 16) gesture.current.moved = true;
                        }}
                        onTouchEnd={(event) => {
                          if (heldPointerId.current !== null) {
                            event.stopPropagation();
                            if (event.cancelable) event.preventDefault();
                            return;
                          }
                          const touch = event.changedTouches?.[0];
                          const dx = touch ? Math.abs(touch.clientX - gesture.current.x) : 0;
                          const dy = touch ? Math.abs(touch.clientY - gesture.current.y) : 0;
                          event.stopPropagation();
                          if (event.cancelable) event.preventDefault();
                          if (dx + dy > 16) return;
                          touchSummaryAt.current = Date.now();
                          showHover(row.id, event.currentTarget.getBoundingClientRect());
                        }}
                        onClick={(event) => {
                          const id = (event.nativeEvent as PointerEvent | undefined)?.pointerId;
                          if (heldPointerId.current !== null && id !== heldPointerId.current) {
                            event.preventDefault();
                            event.stopPropagation();
                            return;
                          }
                          event.stopPropagation();
                          showHover(row.id, event.currentTarget.getBoundingClientRect());
                        }}
                        onKeyDown={(event) => {
                          if (event.key !== "Enter" && event.key !== " ") return;
                          event.preventDefault();
                          event.stopPropagation();
                          showHover(row.id, event.currentTarget.getBoundingClientRect());
                        }}
                        onPointerDown={(event) => {
                          event.stopPropagation();
                          const card = appointments.find((item) => item.id === row.id) ?? row;
                          begin(event, card, "move", pointOn(event) ? "summary" : undefined);
                        }}
                      >
                        <span className="pointer-events-none text-[8px] leading-none">?</span>
                      </button>
                    </div>
                  </article>
                  <button
                    type="button"
                    aria-label="Change length"
                    data-resize-pad
                    data-resize-for={row.id}
                    className="absolute cursor-ns-resize border-0 bg-transparent p-0"
                    style={{ position: "absolute", ...laneStyle, right: split ? "auto" : 4 + gutter, top: top + block, height: strip.height, zIndex: strip.raised ? 12 : 0, touchAction: "none", background: "transparent" }}
                    onPointerDown={(event) => pressPad(event, visit)}
                  />
                  </Fragment>
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
      {menu ? (
        <div ref={menuNode} data-context-menu role="menu" data-menu-time={menu.kind === "paste" ? menu.time : undefined} className="fixed z-50 rounded-md border border-line bg-surface p-1 shadow-card" style={{ left: menu.x, top: menu.y }}>
          {menu.kind === "copy" ? (
            <button type="button" role="menuitem" data-copy className="btn btn-ghost min-h-11 w-full" onClick={() => { const id = menu.kind === "copy" ? menu.id : ""; dismissMenu(() => { if (id) onCopy?.(id); }); }}>Copy</button>
          ) : canPaste && menu.kind === "paste" ? (
            <button type="button" role="menuitem" data-paste className="btn btn-ghost min-h-11 w-full" onClick={() => { const techId = menu.techId; const time = menu.time; dismissMenu(() => { onPasteSlot?.(techId, time); }); }}>Paste</button>
          ) : null}
        </div>
      ) : null}
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
      data-hover-summary
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
