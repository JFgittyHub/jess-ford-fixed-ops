import "./test-dom.ts";
import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import { readFileSync } from "node:fs";
import { createConnection, createServer } from "node:net";
import { afterEach, describe, it } from "node:test";
import { act, createElement, useState, type ReactNode } from "react";
import { flushSync } from "react-dom";
import { createRoot } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { compile } from "@tailwindcss/node";
import { createMemoryHistory, createRouter, RouterProvider } from "@tanstack/react-router";
import { chromium, type Page } from "playwright";
import { AppointmentCalendar } from "../components/appointment-calendar.tsx";
import { CopyBar, PasteNoticeBar, type PasteNotice } from "../routes/schedule.tsx";
import { routeTree } from "../routeTree.gen.ts";
import { AppErrorComponent } from "./error-component.tsx";
import { deskLocationRewrite } from "./preview-path-prefix.ts";
import { createEmptyShop, createSeed } from "./seed.ts";
import { useShop } from "./store.ts";
import { pinClock, resetClock } from "./clock.ts";
import { commitPaste, copiedFrom, copyWorkerKey, pasteAppointmentInput, slotGestureError, slotOpensBook, useForgetCopy, type CopiedAppointment } from "./paste-appointment.ts";
import type { ShopStorage } from "./shop-storage.ts";
import { createShopStore } from "./store.ts";
import type { Appointment } from "./types.ts";

const originalPointerCapture = HTMLElement.prototype.setPointerCapture;
let restoreFakeTimers: (() => void) | null = null;

afterEach(() => {
  resetClock();
  restoreFakeTimers?.();
  restoreFakeTimers = null;
  if (originalPointerCapture) HTMLElement.prototype.setPointerCapture = originalPointerCapture;
});

function fakeWindowTimers() {
  restoreFakeTimers?.();
  const real = {
    setTimeout: window.setTimeout.bind(window),
    clearTimeout: window.clearTimeout.bind(window),
    setInterval: window.setInterval.bind(window),
    clearInterval: window.clearInterval.bind(window),
  };
  let now = 0;
  let nextId = 1_000_000;
  const timers = new Map<number, { at: number; fn: () => void; interval?: number }>();
  const setTimeoutFake = ((fn: () => void, ms = 0) => {
    const id = nextId++;
    timers.set(id, { at: now + (Number(ms) || 0), fn });
    return id;
  }) as typeof window.setTimeout;
  const clearTimeoutFake = ((id?: number) => {
    if (typeof id === "number" && timers.has(id)) timers.delete(id);
    else real.clearTimeout(id as number);
  }) as typeof window.clearTimeout;
  const setIntervalFake = ((fn: () => void, ms = 0) => {
    const id = nextId++;
    timers.set(id, { at: now + Number(ms), fn, interval: Number(ms) });
    return id;
  }) as typeof window.setInterval;
  window.setTimeout = setTimeoutFake;
  window.clearTimeout = clearTimeoutFake;
  window.setInterval = setIntervalFake;
  window.clearInterval = clearTimeoutFake;
  const clock = {
    tick(ms: number) {
      const end = now + ms;
      for (;;) {
        let nextIdDue: number | null = null;
        let nextAt = Infinity;
        for (const [id, timer] of timers) {
          if (timer.at <= end && timer.at < nextAt) {
            nextIdDue = id;
            nextAt = timer.at;
          }
        }
        if (nextIdDue === null) break;
        const timer = timers.get(nextIdDue);
        if (!timer) break;
        now = timer.at;
        if (timer.interval === undefined) timers.delete(nextIdDue);
        else timer.at = now + timer.interval;
        timer.fn();
      }
      now = end;
    },
  };
  restoreFakeTimers = () => {
    for (const id of timers.keys()) real.clearTimeout(id);
    timers.clear();
    window.setTimeout = real.setTimeout;
    window.clearTimeout = real.clearTimeout;
    window.setInterval = real.setInterval;
    window.clearInterval = real.clearInterval;
    restoreFakeTimers = null;
  };
  return clock;
}

function advance(clock: { tick: (ms: number) => void }, ms: number) {
  act(() => {
    clock.tick(ms);
  });
}

function afterMacrotask() {
  return new Promise<void>((resolve) => {
    setImmediate(resolve);
  });
}

function pointerClick(node: HTMLElement, init: { pointerId: number; pointerType: string; clientX: number; clientY: number }) {
  const Pointer = window.PointerEvent;
  node.dispatchEvent(new Pointer("click", {
    bubbles: true,
    cancelable: true,
    button: 0,
    pointerId: init.pointerId,
    pointerType: init.pointerType,
    isPrimary: true,
    clientX: init.clientX,
    clientY: init.clientY,
  }));
}

const when = "2026-11-10T20:00:00.000Z";
const friday = "2026-11-13";
const saturday = "2026-11-14";

function memoryStorage(): ShopStorage {
  const items = new Map<string, string>();
  return {
    getItem: (key) => items.get(key) ?? null,
    setItem: (key, value) => { items.set(key, value); },
    removeItem: (key) => { items.delete(key); },
  };
}

function shop(who = "megan") {
  const store = createShopStore({ demoMode: true, storage: memoryStorage() });
  store.getState().setWorkingAs(who);
  return store;
}

function book(store: ReturnType<typeof shop>, patch: Partial<Appointment> = {}) {
  const state = store.getState();
  const customer = state.customers.find((row) => row.name === "Helen Cho") ?? state.customers[0];
  const vehicle = state.vehicles.find((row) => row.customerId === customer.id) ?? state.vehicles[0];
  return store.getState().saveAdvisorAppointment({
    date: friday,
    time: "09:00",
    minutes: 60,
    customerId: customer.id,
    vehicleId: vehicle.id,
    advisorId: "megan",
    techId: "marcus",
    concern: "Oil",
    lines: [{ id: "a", code: "A", concern: "Oil" }],
    vin: vehicle.vin,
    laborOpIds: [],
    lane: "drop",
    status: "scheduled",
    ...patch,
  });
}

function halfHours() {
  const times: string[] = [];
  for (let mins = 7 * 60 + 30; mins <= 15 * 60; mins += 30) {
    const time = `${String(Math.floor(mins / 60)).padStart(2, "0")}:${String(mins % 60).padStart(2, "0")}`;
    if (time === "13:30" || time === "14:00") continue;
    times.push(time);
  }
  return times;
}

function stamp(store: ReturnType<typeof shop>) {
  const state = store.getState();
  return {
    appointments: state.appointments.map((row) => `${row.id}|${row.date}|${row.time}|${row.minutes}|${row.techId}|${row.concern}|${row.vin}|${row.vehicleId}`).join("\n"),
    overrides: state.overrides.length,
    log: state.settingsLog?.length ?? 0,
    ownership: JSON.stringify(state.ownershipLog ?? []),
    vehicles: state.vehicles.map((row) => `${row.id}|${row.customerId}|${row.vin}`).join("\n"),
    customers: state.customers.length,
  };
}

describe("round 26 paste appointments", () => {
  it("copies through the book save, leaves the original alone, and can paste again", () => {
    pinClock(when);
    const store = shop();
    const saved = book(store, { minutes: 90, lane: "waiter", concern: "Brakes", lines: [{ id: "a", code: "A", concern: "Brakes" }] });
    assert.equal(saved.ok, true, saved.error ?? "");
    const original = store.getState().appointments.find((row) => row.id === saved.appointmentId);
    assert.ok(original);
    const before = JSON.stringify(original);
    const ownership = JSON.stringify(store.getState().ownershipLog ?? []);
    const copy = copiedFrom(original);
    const first = commitPaste(store, pasteAppointmentInput(copy, { date: friday, time: "11:00", techId: "elena" }));
    assert.equal(first.ok, true, first.error ?? "");
    const second = commitPaste(store, pasteAppointmentInput(copy, { date: friday, time: "13:00", techId: "elena" }));
    assert.equal(second.ok, true, second.error ?? "");
    const rows = store.getState().appointments.filter((row) => row.customerId === original.customerId && row.concern.includes("Brakes"));
    assert.equal(rows.length, 3);
    const pasted = rows.filter((row) => row.id !== original.id);
    assert.equal(pasted.length, 2);
    for (const row of pasted) {
      assert.equal(row.techId, "elena");
      assert.equal(row.vehicleId, original.vehicleId);
      assert.equal(row.vin, original.vin);
      assert.equal(row.minutes, 90);
      assert.equal(row.lane, "waiter");
      assert.equal(row.advisorId, "megan");
      assert.notEqual(row.id, original.id);
    }
    assert.deepEqual(pasted.map((row) => row.time).sort(), ["11:00", "13:00"]);
    assert.equal(JSON.stringify(store.getState().appointments.find((row) => row.id === original.id)), before);
    assert.equal(JSON.stringify(store.getState().ownershipLog ?? []), ownership);
    assert.equal(store.getState().vehicles.find((row) => row.id === original.vehicleId)?.customerId, original.customerId);
  });

  it("refuses a bad slot for Megan and Derek without writing, and logs one past-close reason", () => {
    pinClock(when);
    for (const who of ["megan", "derek"] as const) {
      const store = shop(who);
      const saved = book(store, { minutes: 120, concern: "Long visit", lines: [{ id: "a", code: "A", concern: "Long visit" }] });
      assert.equal(saved.ok, true, saved.error ?? "");
      const source = store.getState().appointments.find((row) => row.id === saved.appointmentId);
      assert.ok(source);
      const copy = copiedFrom(source);
      const cases = [
        pasteAppointmentInput(copy, { date: saturday, time: "16:00", techId: "marcus" }),
        pasteAppointmentInput(copy, { date: "2026-11-26", time: "09:00", techId: "marcus" }),
        pasteAppointmentInput(copy, { date: "2026-11-09", time: "09:00", techId: "marcus" }),
      ];
      for (const input of cases) {
        const before = stamp(store);
        const refused = commitPaste(store, input, { closeReason: "Does not matter", confirmOverride: true });
        assert.equal(refused.ok, false, input.date + input.time);
        assert.ok(refused.error);
        assert.deepEqual(stamp(store), before);
      }
      const crossing = pasteAppointmentInput(copy, { date: saturday, time: "11:30", techId: "elena" });
      const beforeCross = stamp(store);
      if (who === "megan") {
        const refused = commitPaste(store, crossing, { closeReason: "Advisor tried" });
        assert.match(refused.error ?? "", /past closing/);
        assert.deepEqual(stamp(store), beforeCross);
      } else {
        const blank = commitPaste(store, crossing, { closeReason: "   " });
        assert.equal(blank.needsCloseReason, true);
        assert.deepEqual(stamp(store), beforeCross);
        const approved = commitPaste(store, crossing, { closeReason: "Staying past one" });
        assert.equal(approved.ok, true, approved.error ?? "");
        const logged = store.getState().overrides.filter((row) => row.appointmentId === approved.appointmentId && row.reason === "past-close");
        assert.equal(logged.length, 1);
        assert.equal(logged[0].note, "Staying past one");
        assert.equal(logged[0].who, "Derek Lang");
        assert.equal(logged[0].at, when);
      }
    }
  });

  it("asks Derek for one reason on a 180-minute Friday 5:00 PM paste and refuses Megan", () => {
    pinClock(when);
    for (const who of ["megan", "derek"] as const) {
      const store = shop(who);
      const saved = book(store, { minutes: 180, time: "09:00", concern: "Long visit", lines: [{ id: "a", code: "A", concern: "Long visit" }] });
      assert.equal(saved.ok, true, saved.error ?? "");
      const source = store.getState().appointments.find((row) => row.id === saved.appointmentId);
      assert.ok(source);
      const input = pasteAppointmentInput(copiedFrom(source), { date: friday, time: "17:00", techId: "elena" });
      const before = stamp(store);
      if (who === "megan") {
        const refused = commitPaste(store, input, { closeReason: "Advisor tried" });
        assert.match(refused.error ?? "", /past closing/);
        assert.deepEqual(stamp(store), before);
      } else {
        const asked = commitPaste(store, input);
        assert.equal(asked.needsCloseReason, true);
        assert.deepEqual(stamp(store), before);
        const accepted = commitPaste(store, input, { closeReason: "Staying for the tow" });
        assert.equal(accepted.ok, true, accepted.error ?? "");
        const pasted = store.getState().appointments.find((row) => row.id === accepted.appointmentId);
        assert.equal(pasted?.time, "17:00");
        assert.equal(pasted?.minutes, 180);
        assert.equal(pasted?.advisorId, "derek");
        const logged = store.getState().overrides.filter((row) => row.appointmentId === accepted.appointmentId && row.reason === "past-close");
        assert.equal(logged.length, 1);
        assert.equal(logged[0]?.who, "Derek Lang");
      }
    }
  });

  it("warns Megan and Derek before an overloaded paste and logs the override only if they accept", () => {
    pinClock(when);
    for (const who of ["megan", "derek"] as const) {
      const store = shop(who);
      store.setState({ laborOps: [...store.getState().laborOps, { id: "op-heavy", opcode: "HEAVY", description: "Heavy", hours: 12, payType: "cp" }] });
      const filler = book(store, { time: "09:00", minutes: 60, laborOpIds: ["op-heavy"], techId: "marcus" });
      assert.equal(filler.ok, true, filler.error ?? "");
      const source = book(store, { time: "10:00", minutes: 60, techId: "elena", concern: "Copy me", lines: [{ id: "b", code: "A", concern: "Copy me" }] });
      assert.equal(source.ok, true, source.error ?? "");
      const row = store.getState().appointments.find((item) => item.id === source.appointmentId);
      assert.ok(row);
      const input = pasteAppointmentInput(copiedFrom(row), { date: friday, time: "11:00", techId: "marcus" });
      const before = stamp(store);
      const asked = commitPaste(store, input);
      assert.equal(asked.needsOverride, true);
      assert.match(asked.warning ?? "", /You can still book it/);
      assert.deepEqual(stamp(store), before);
      const accepted = commitPaste(store, input, { confirmOverride: true });
      assert.equal(accepted.ok, true, accepted.error ?? "");
      const entry = store.getState().overrides.find((item) => item.id === accepted.overrideId);
      assert.equal(entry?.whoId, who);
      assert.equal(entry?.at, when);
      assert.equal(store.getState().appointments.find((item) => item.id === accepted.appointmentId)?.techId, "marcus");
      assert.equal(store.getState().appointments.find((item) => item.id === accepted.appointmentId)?.advisorId, who);
    }
  });

  it("records the paste on the Working-as advisor for Megan and Derek, and counts that person's capacity", () => {
    pinClock(when);
    for (const who of ["megan", "derek"] as const) {
      const store = shop(who);
      const sourceAdvisor = who === "megan" ? "jordan" : "megan";
      const open = halfHours().filter((time) => !store.getState().appointments.some((row) => row.date === friday && row.techId === "marcus" && row.time === time));
      const onBook = (row: Appointment) => row.date === friday && row.advisorId === who && row.status !== "cancelled" && row.status !== "no_show";
      const existing = store.getState().appointments.filter(onBook).length;
      const need = Math.max(0, 10 - existing);
      assert.ok(open.length >= need + 2, `${who} needs open slots`);
      for (const time of open.slice(0, need)) {
        const filled = book(store, { advisorId: who, time, minutes: 30, techId: "marcus", concern: `Fill ${time}`, lines: [{ id: "a", code: "A", concern: `Fill ${time}` }] });
        assert.equal(filled.ok, true, filled.error ?? time);
      }
      const source = book(store, { advisorId: sourceAdvisor, time: "13:30", minutes: 30, techId: "elena", concern: "Source card", lines: [{ id: "b", code: "A", concern: "Source card" }] });
      assert.equal(source.ok, true, source.error ?? "");
      const row = store.getState().appointments.find((item) => item.id === source.appointmentId);
      assert.ok(row);
      const input = pasteAppointmentInput(copiedFrom(row), { date: friday, time: "14:00", techId: "elena" });
      const before = stamp(store);
      const asked = commitPaste(store, input);
      assert.equal(asked.needsOverride, true, who);
      assert.match(asked.warning ?? "", /advisor capacity/);
      assert.deepEqual(stamp(store), before);
      const accepted = commitPaste(store, input, { confirmOverride: true });
      assert.equal(accepted.ok, true, accepted.error ?? "");
      const pasted = store.getState().appointments.find((item) => item.id === accepted.appointmentId);
      assert.equal(pasted?.advisorId, who);
      assert.notEqual(pasted?.advisorId, sourceAdvisor);
      const entry = store.getState().overrides.find((item) => item.id === accepted.overrideId);
      assert.equal(entry?.whoId, who);
      assert.equal(store.getState().appointments.filter(onBook).length, existing + need + 1);
      assert.equal(store.getState().appointments.find((item) => item.id === source.appointmentId)?.advisorId, sourceAdvisor);
    }
  });

  it("refuses a paste when Working as is not an advisor on this store", () => {
    pinClock(when);
    for (const who of ["megan", "derek"] as const) {
      const store = shop(who);
      const saved = book(store);
      assert.equal(saved.ok, true, saved.error ?? "");
      const source = store.getState().appointments.find((row) => row.id === saved.appointmentId);
      assert.ok(source);
      for (const outsider of ["marcus", "pl-jordan"]) {
        if (outsider === "marcus") store.getState().setWorkingAs("marcus");
        else store.setState({ workingAsId: "pl-jordan" });
        const before = stamp(store);
        const refused = commitPaste(store, pasteAppointmentInput(copiedFrom(source), { date: friday, time: "11:00", techId: "elena" }));
        assert.match(refused.error ?? "", /isn't on this store/, outsider);
        assert.deepEqual(stamp(store), before);
      }
    }
  });
});

function Board({
  store,
  day,
  children,
}: {
  store: ReturnType<typeof shop>;
  day: string;
  children?: ReactNode;
}) {
  const [clip, setClip] = useState<CopiedAppointment | null>(null);
  const [notice, setNotice] = useState<PasteNotice | null>(null);
  const [label, setLabel] = useState("");
  const state = store.getState();
  useForgetCopy(copyWorkerKey(state), () => {
    setClip(null);
    setLabel("");
    setNotice(null);
  });
  const rows = state.appointments.filter((row) => row.date === day && row.status !== "cancelled");
  function paste(techId: string, time: string, opts?: { confirmOverride?: boolean; closeReason?: string }) {
    if (!clip) {
      setNotice({ kind: "error", text: "Copy an appointment first." });
      return;
    }
    const result = commitPaste(store, pasteAppointmentInput(clip, { date: day, time, techId }), opts);
    if (result.needsCloseReason) {
      setNotice({ kind: "close", techId, time, reason: "", text: result.error });
      return;
    }
    if (result.needsOverride && result.warning) {
      setNotice({ kind: "override", techId, time, warning: result.warning, closeReason: opts?.closeReason });
      return;
    }
    if (!result.ok) {
      setNotice({ kind: "error", text: result.error ?? "That appointment could not be saved." });
      return;
    }
    setNotice(null);
  }
  return createElement("div", null,
    createElement("p", { "data-copied": label ? "yes" : "no" }, label ? `Copied ${label}` : ""),
    createElement(PasteNoticeBar, {
      notice,
      onOverride: () => {
        if (notice?.kind === "override") paste(notice.techId, notice.time, { confirmOverride: true, closeReason: notice.closeReason });
      },
      onReason: (reason) => {
        if (notice?.kind !== "close") return;
        if (!reason.trim()) {
          setNotice({ ...notice, text: "Add a reason for running past close." });
          return;
        }
        paste(notice.techId, notice.time, { closeReason: reason });
      },
      onDismiss: () => setNotice(null),
    }),
    createElement(AppointmentCalendar, {
      appointments: rows,
      day,
      techs: [
        { id: "marcus", number: "1", name: "Marcus", board: "main" as const },
        { id: "elena", number: "2", name: "Elena", board: "express" as const },
      ],
      selectedId: null,
      onSelect: () => undefined,
      onSlot: () => undefined,
      onMove: () => undefined,
      onWrite: () => undefined,
      onEdit: () => undefined,
      onCopy: (id: string) => {
        const row = store.getState().appointments.find((item) => item.id === id);
        if (!row) return;
        setClip(copiedFrom(row));
        setLabel(row.concern);
        setNotice(null);
      },
      onPasteSlot: (techId: string, time: string) => paste(techId, time),
      canPaste: clip !== null,
      longPressMs: 30,
      label: (row: Appointment) => row.concern,
      summary: () => ({ name: "Pat", vehicle: "Ford", advisor: "Megan", tech: "Marcus", when: "9:00", lane: "Drop", concern: "Oil", vin: "", ops: "", status: "Scheduled", canWrite: false }),
      hoursFor: () => 1,
    }),
    children,
  );
}

describe("round 26 paste store boundary", () => {
  it("refuses a paste into the other store without changing either book", () => {
    pinClock(when);
    const store = shop();
    const saved = book(store);
    assert.equal(saved.ok, true, saved.error ?? "");
    const source = store.getState().appointments.find((row) => row.id === saved.appointmentId);
    assert.ok(source);
    const copy = copiedFrom(source);
    store.getState().switchStore("pullman");
    store.setState({ userStoreId: "grand-coulee" });
    store.getState().setWorkingAs("megan");
    const before = stamp(store);
    const refused = commitPaste(store, pasteAppointmentInput(copy, { date: friday, time: "11:00", techId: "pl-marcus" }));
    assert.match(refused.error ?? "", /own store/);
    assert.deepEqual(stamp(store), before);
  });
});

describe("round 26 paste board", () => {
  it("copies from a right-click or a long press, pastes into a lane, and keeps the copy", async () => {
    pinClock(when);
    HTMLElement.prototype.setPointerCapture = () => undefined;
    const store = shop();
    const saved = book(store);
    assert.equal(saved.ok, true, saved.error ?? "");
    const host = document.createElement("div");
    document.body.appendChild(host);
    const root = createRoot(host);
    const moves: string[] = [];
    const slots: string[] = [];
    flushSync(() => {
      root.render(createElement(AppointmentCalendar, {
        appointments: store.getState().appointments.filter((row) => row.id === saved.appointmentId),
        day: friday,
        techs: [
          { id: "marcus", number: "1", name: "Marcus", board: "main" as const },
          { id: "elena", number: "2", name: "Elena", board: "express" as const },
        ],
        selectedId: null,
        onSelect: () => undefined,
        onSlot: (techId: string, time: string) => slots.push(`${techId}|${time}`),
        onMove: (id: string) => moves.push(id),
        onWrite: () => undefined,
        onEdit: () => undefined,
        onCopy: () => undefined,
        onPasteSlot: () => undefined,
        canPaste: true,
        longPressMs: 30,
        label: () => "Helen",
        summary: () => ({ name: "Helen", vehicle: "Ford", advisor: "Megan", tech: "Marcus", when: "9:00", lane: "Drop", concern: "Oil", vin: "", ops: "", status: "Scheduled", canWrite: false }),
        hoursFor: () => 1,
      }));
    });
    const card = host.querySelector<HTMLElement>(`[data-appt-id='${saved.appointmentId}']`);
    assert.ok(card);
    flushSync(() => card.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true, clientX: 12, clientY: 24 })));
    const copy = host.querySelector<HTMLButtonElement>("[data-copy]");
    assert.ok(copy);
    assert.equal(host.querySelector("[data-hover-summary]"), null);
    flushSync(() => copy.click());
    const mark = host.querySelector<HTMLElement>("[aria-label='Appointment summary']");
    assert.ok(mark);
    flushSync(() => mark.click());
    assert.ok(host.querySelector("[data-hover-summary]"));
    assert.equal(host.querySelector("[data-copy]"), null);
    const pointer = window.PointerEvent;
    flushSync(() => {
      card.dispatchEvent(new pointer("pointerdown", { bubbles: true, button: 0, clientX: 10, clientY: 10, pointerId: 1 }));
      window.dispatchEvent(new pointer("pointermove", { bubbles: true, clientX: 10, clientY: 80, pointerId: 1 }));
      window.dispatchEvent(new pointer("pointerup", { bubbles: true, clientX: 10, clientY: 80, pointerId: 1 }));
    });
    assert.deepEqual(moves, [saved.appointmentId]);
    assert.equal(host.querySelector("[data-context-menu]"), null);
    await act(async () => {
      card.dispatchEvent(new pointer("pointerdown", { bubbles: true, button: 0, clientX: 8, clientY: 8, pointerId: 2 }));
      await new Promise((resolve) => setTimeout(resolve, 50));
    });
    assert.ok(host.querySelector("[data-copy]"));
    const column = host.querySelector<HTMLElement>("[data-tech='elena']");
    assert.ok(column);
    column.getBoundingClientRect = () => ({ top: 100, left: 0, right: 120, bottom: 800, width: 120, height: 700, x: 0, y: 100, toJSON() { return {}; } });
    flushSync(() => column.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true, clientX: 20, clientY: 164 })));
    const paste = host.querySelector<HTMLButtonElement>("[data-paste]");
    assert.ok(paste);
    flushSync(() => paste.click());
    flushSync(() => column.dispatchEvent(new pointer("pointerdown", { bubbles: true, button: 0, clientX: 20, clientY: 100, pointerId: 3 })));
    window.dispatchEvent(new pointer("pointerup", { bubbles: true, clientX: 20, clientY: 100, pointerId: 3 }));
    column.dispatchEvent(new MouseEvent("click", { bubbles: true, clientX: 20, clientY: 100 }));
    assert.ok(slots.some((slot) => slot.startsWith("elena|")));
    root.unmount();
    host.remove();
  });

  it("shows Megan and Derek the paste rules on the board", async () => {
    pinClock(when);
    HTMLElement.prototype.setPointerCapture = () => undefined;
    const store = shop("derek");
    const saved = book(store, { minutes: 120, concern: "Long visit", lines: [{ id: "a", code: "A", concern: "Long visit" }] });
    assert.equal(saved.ok, true, saved.error ?? "");
    const host = document.createElement("div");
    document.body.appendChild(host);
    const root = createRoot(host);
    function draw() {
      act(() => {
        flushSync(() => root.render(createElement(Board, { store, day: friday })));
      });
    }
    try {
    draw();
    const card = () => host.querySelector<HTMLElement>(`[data-appt-id='${saved.appointmentId}']`);
    const lane = host.querySelector<HTMLElement>("[data-tech='elena']");
    assert.ok(lane);
    lane.getBoundingClientRect = () => ({ top: 0, left: 0, right: 100, bottom: 800, width: 100, height: 800, x: 0, y: 0, toJSON() { return {}; } });
    flushSync(() => lane.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true, clientX: 8, clientY: 64 })));
    assert.equal(host.querySelector("[data-paste]"), null);
    const pointer = window.PointerEvent;
    await act(async () => {
      lane.dispatchEvent(new pointer("pointerdown", { bubbles: true, button: 0, clientX: 8, clientY: 96, pointerId: 9 }));
      await new Promise((resolve) => setTimeout(resolve, 50));
    });
    assert.equal(host.querySelector("[data-paste]"), null);
    window.dispatchEvent(new pointer("pointerup", { bubbles: true, clientX: 8, clientY: 96, pointerId: 9 }));
    const beforeCopy = store.getState().appointments.length;
    assert.equal(store.getState().appointments.length, beforeCopy);
    assert.equal(host.querySelector("[data-paste-notice]"), null);
    flushSync(() => card()?.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true, clientX: 4, clientY: 4 })));
    flushSync(() => host.querySelector<HTMLButtonElement>("[data-copy]")?.click());
    assert.match(host.textContent ?? "", /Copied/);
    const column = () => host.querySelector<HTMLElement>("[data-tech='elena']");
    const elena = column();
    assert.ok(elena);
    elena.getBoundingClientRect = () => ({ top: 0, left: 0, right: 100, bottom: 800, width: 100, height: 800, x: 0, y: 0, toJSON() { return {}; } });
    function openPaste(clientY: number) {
      const lane = column();
      assert.ok(lane);
      lane.getBoundingClientRect = () => ({ top: 0, left: 0, right: 100, bottom: 800, width: 100, height: 800, x: 0, y: 0, toJSON() { return {}; } });
      flushSync(() => lane.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true, clientX: 8, clientY })));
      flushSync(() => host.querySelector<HTMLButtonElement>("[data-paste]")?.click());
    }
    const before = stamp(store);
    openPaste(19 * 32);
    assert.match(host.querySelector("[data-paste-notice]")?.textContent ?? "", /past closing/);
    flushSync(() => host.querySelector<HTMLFormElement>("[data-paste-notice] form")?.requestSubmit());
    assert.match(host.querySelector("[data-paste-notice]")?.textContent ?? "", /Add a reason/);
    assert.deepEqual(stamp(store), before);
    const reason = host.querySelector<HTMLInputElement>("[aria-label='Reason for running past close']");
    assert.ok(reason);
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
    flushSync(() => {
      setter?.call(reason, "Staying past one");
      reason.dispatchEvent(new Event("input", { bubbles: true }));
    });
    flushSync(() => host.querySelector<HTMLFormElement>("[data-paste-notice] form")?.requestSubmit());
    const pasted = store.getState().appointments.find((row) => row.techId === "elena" && row.time === "16:30");
    assert.ok(pasted);
    assert.equal(pasted.advisorId, "derek");
    const logged = store.getState().overrides.filter((row) => row.appointmentId === pasted.id && row.reason === "past-close");
    assert.equal(logged.length, 1);
    assert.equal(logged[0].note, "Staying past one");
    assert.equal(logged[0].who, "Derek Lang");
    store.getState().setWorkingAs("megan");
    draw();
    assert.equal(host.querySelector("[data-copied]")?.textContent, "");
    flushSync(() => card()?.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true, clientX: 4, clientY: 4 })));
    flushSync(() => host.querySelector<HTMLButtonElement>("[data-copy]")?.click());
    const elenaBefore = store.getState().appointments.filter((row) => row.techId === "elena").length;
    openPaste(19 * 32);
    assert.match(host.querySelector("[data-paste-notice]")?.textContent ?? "", /past closing/);
    assert.equal(store.getState().appointments.filter((row) => row.techId === "elena").length, elenaBefore);
    openPaste(0);
    assert.match(host.querySelector("[data-paste-notice]")?.textContent ?? "", /outside shop hours/);
    assert.equal(store.getState().appointments.filter((row) => row.techId === "elena").length, elenaBefore);
    openPaste(2 * 32);
    openPaste(4 * 32);
    assert.equal(store.getState().appointments.filter((row) => row.techId === "elena").length, elenaBefore + 2);
    assert.equal(store.getState().appointments.filter((row) => row.techId === "elena" && row.advisorId === "megan").length, 2);
    const original = store.getState().appointments.find((row) => row.id === saved.appointmentId);
    assert.equal(original?.techId, "marcus");
    assert.equal(original?.time, "09:00");
    } finally {
      root.unmount();
      host.remove();
    }
  });
});

function CopyHold({ workerKey, name }: { workerKey: string; name: string }) {
  const [held, setHeld] = useState(name);
  const [seenName, setSeenName] = useState(name);
  if (name !== seenName) {
    setSeenName(name);
    setHeld(name);
  }
  useForgetCopy(workerKey, () => setHeld(""));
  return createElement("p", { "data-copied": "yes" }, held ? `Copied ${held}` : "");
}

describe("round 26 empty slot opens book", () => {
  it("right-click opens Book when nothing is copied, and shows Paste once a copy exists", () => {
    pinClock(when);
    HTMLElement.prototype.setPointerCapture = () => undefined;
    const host = document.createElement("div");
    document.body.appendChild(host);
    const root = createRoot(host);
    const slots: string[] = [];
    function draw(canPaste: boolean) {
      flushSync(() => root.render(createElement(AppointmentCalendar, {
        appointments: [],
        day: friday,
        techs: [{ id: "elena", number: "2", name: "Elena", board: "express" as const }],
        selectedId: null,
        onSelect: () => undefined,
        onSlot: (techId: string, time: string) => slots.push(`${techId}|${time}`),
        onMove: () => undefined,
        onWrite: () => undefined,
        onEdit: () => undefined,
        onPasteSlot: () => slots.push("menu"),
        canPaste,
        longPressMs: 30,
        label: () => "",
        summary: () => ({ name: "", vehicle: "", advisor: "", tech: "", when: "", lane: "", concern: "", vin: "", ops: "", status: "", canWrite: false }),
        hoursFor: () => 0,
      })));
    }
    try {
      draw(false);
      const column = host.querySelector<HTMLElement>("[data-tech='elena']");
      assert.ok(column);
      column.getBoundingClientRect = () => ({ top: 0, left: 0, right: 100, bottom: 800, width: 100, height: 800, x: 0, y: 0, toJSON() { return {}; } });
      flushSync(() => column.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true, clientX: 8, clientY: 64 })));
      assert.equal(host.querySelector("[data-paste]"), null);
      assert.equal(host.querySelector("[data-context-menu]"), null);
      assert.deepEqual(slots, ["elena|08:00"]);
      slots.length = 0;
      draw(true);
      const copied = host.querySelector<HTMLElement>("[data-tech='elena']");
      assert.ok(copied);
      copied.getBoundingClientRect = () => ({ top: 0, left: 0, right: 100, bottom: 800, width: 100, height: 800, x: 0, y: 0, toJSON() { return {}; } });
      flushSync(() => copied.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true, clientX: 8, clientY: 64 })));
      assert.ok(host.querySelector("[data-paste]"));
      assert.deepEqual(slots, []);
    } finally {
      root.unmount();
      host.remove();
    }
  });

  it("opens nothing on a closed, past, or other-store day, with or without a copy", async () => {
    pinClock(when);
    HTMLElement.prototype.setPointerCapture = () => undefined;
    const host = document.createElement("div");
    document.body.appendChild(host);
    const root = createRoot(host);
    const bookings: string[] = [];
    const messages = ["The shop is closed that day.", "That day is already past.", "Book on your own store. Each store keeps its own schedule."];
    function draw(canPaste: boolean, text: string) {
      flushSync(() => root.render(createElement("div", null,
        createElement("div", { "data-copy-anchor": "yes" },
          createElement(CopyBar, {
            copiedName: canPaste ? "Helen Cho" : "",
            notice: null,
            onOverride: () => undefined,
            onReason: () => undefined,
            onDismiss: () => undefined,
          }),
          createElement(AppointmentCalendar, {
            appointments: [],
            day: "2026-11-15",
            techs: [{ id: "elena", number: "2", name: "Elena", board: "express" as const }],
            selectedId: null,
            onSelect: () => undefined,
            onSlot: (techId: string, time: string) => bookings.push(`${techId}|${time}`),
            onMove: () => undefined,
            onWrite: () => undefined,
            onEdit: () => undefined,
            onPasteSlot: () => bookings.push("paste"),
            canPaste,
            slotOpen: false,
            onSlotRefused: () => {
              flushSync(() => root.render(createElement("div", null,
                createElement("div", { "data-copy-anchor": "yes" },
                  createElement(CopyBar, {
                    copiedName: canPaste ? "Helen Cho" : "",
                    notice: { kind: "error", text },
                    onOverride: () => undefined,
                    onReason: () => undefined,
                    onDismiss: () => undefined,
                  }),
                  createElement("div", { "data-desk-heading": "yes" }, "Today"),
                ),
                createElement("p", { "data-below-board": "yes" }, "below the board"),
              )));
            },
            longPressMs: 30,
            label: () => "",
            summary: () => ({ name: "", vehicle: "", advisor: "", tech: "", when: "", lane: "", concern: "", vin: "", ops: "", status: "", canWrite: false }),
            hoursFor: () => 0,
          }),
        ),
        createElement("p", { "data-below-board": "yes" }, "below the board"),
      )));
    }
    try {
      for (const canPaste of [false, true]) {
        for (const text of messages) {
          bookings.length = 0;
          draw(canPaste, text);
          const column = host.querySelector<HTMLElement>("[data-tech='elena']");
          assert.ok(column);
          column.getBoundingClientRect = () => ({ top: 0, left: 0, right: 100, bottom: 800, width: 100, height: 800, x: 0, y: 0, toJSON() { return {}; } });
          flushSync(() => column.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true, clientX: 8, clientY: 64 })));
          assert.equal(host.querySelector("[data-paste]"), null);
          assert.equal(host.querySelector("[data-context-menu]"), null);
          assert.equal(bookings.length, 0);
          assert.match(host.querySelector("[data-copy-bar]")?.textContent ?? "", new RegExp(text.replace(/[.]/g, "\\.")));
          assert.equal(host.querySelector("[data-below-board]")?.textContent?.includes(text), false);
          draw(canPaste, text);
          const lane = host.querySelector<HTMLElement>("[data-tech='elena']");
          assert.ok(lane);
          lane.getBoundingClientRect = () => ({ top: 0, left: 0, right: 100, bottom: 800, width: 100, height: 800, x: 0, y: 0, toJSON() { return {}; } });
          const pointer = window.PointerEvent;
          await act(async () => {
            lane.dispatchEvent(new pointer("pointerdown", { bubbles: true, button: 0, clientX: 8, clientY: 96, pointerId: 4 }));
            await new Promise((resolve) => setTimeout(resolve, 50));
            window.dispatchEvent(new pointer("pointerup", { bubbles: true, clientX: 8, clientY: 96, pointerId: 4 }));
          });
          lane.dispatchEvent(new MouseEvent("click", { bubbles: true, clientX: 8, clientY: 96 }));
          assert.equal(host.querySelector("[data-paste]"), null);
          assert.equal(bookings.length, 0);
          assert.match(host.querySelector("[data-copy-bar]")?.textContent ?? "", new RegExp(text.replace(/[.]/g, "\\.")));
        }
      }
    } finally {
      root.unmount();
      host.remove();
    }
  });

  it("refuses a Saturday time after close for Megan and Derek, and clears that notice when the next slot is valid", () => {
    pinClock(when);
    HTMLElement.prototype.setPointerCapture = () => undefined;
    const scheduling = shop("derek").getState().settings.scheduling;
    const saturday = "2026-11-14";
    for (const actor of ["advisor", "service-manager"] as const) {
      assert.equal(slotGestureError({ actor, day: saturday, time: "10:00", scheduling, userStoreId: "grand-coulee", activeStoreId: "grand-coulee" }), null);
      assert.match(slotGestureError({ actor, day: saturday, time: "16:00", scheduling, userStoreId: "grand-coulee", activeStoreId: "grand-coulee" }) ?? "", /outside shop hours/);
    }
    const host = document.createElement("div");
    document.body.appendChild(host);
    const root = createRoot(host);
    const bookings: string[] = [];
    let notice: PasteNotice | null = { kind: "error", text: "That time is outside shop hours." };
    function paint(canPaste: boolean) {
      flushSync(() => root.render(createElement("div", null,
        createElement(CopyBar, {
          copiedName: "Helen Cho",
          notice,
          onOverride: () => undefined,
          onReason: () => undefined,
          onDismiss: () => undefined,
        }),
        createElement(AppointmentCalendar, {
          appointments: [],
          day: saturday,
          techs: [{ id: "elena", number: "2", name: "Elena", board: "express" as const }],
          selectedId: null,
          onSelect: () => undefined,
          onSlot: (techId: string, time: string) => bookings.push(`${techId}|${time}`),
          onMove: () => undefined,
          onWrite: () => undefined,
          onEdit: () => undefined,
          onPasteSlot: () => bookings.push("paste"),
          canPaste,
          slotOpen: true,
          slotError: (time: string) => slotGestureError({ actor: "advisor", day: saturday, time, scheduling, userStoreId: "grand-coulee", activeStoreId: "grand-coulee" }),
          onSlotRefused: (message?: string) => {
            notice = { kind: "error", text: message ?? "That time is outside shop hours." };
            paint(canPaste);
          },
          onSlotAccepted: () => {
            notice = null;
            paint(canPaste);
          },
          longPressMs: 30,
          label: () => "",
          summary: () => ({ name: "", vehicle: "", advisor: "", tech: "", when: "", lane: "", concern: "", vin: "", ops: "", status: "", canWrite: false }),
          hoursFor: () => 0,
        }),
        createElement("p", { "data-below-board": "yes" }, "below the board"),
      )));
    }
    try {
      for (const canPaste of [true, false]) {
        bookings.length = 0;
        notice = null;
        paint(canPaste);
        const late = host.querySelector<HTMLElement>("[data-tech='elena']");
        assert.ok(late);
        late.getBoundingClientRect = () => ({ top: 0, left: 0, right: 120, bottom: 900, width: 120, height: 900, x: 0, y: 0, toJSON() { return {}; } });
        flushSync(() => late.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true, clientX: 8, clientY: 18 * 32 })));
        assert.equal(host.querySelector("[data-paste]"), null);
        assert.equal(bookings.length, 0);
        assert.match(host.querySelector("[data-copy-bar]")?.textContent ?? "", /outside shop hours/);
        assert.equal((host.querySelector("[data-below-board]")?.textContent ?? "").includes("outside shop hours"), false);
        const open = host.querySelector<HTMLElement>("[data-tech='elena']");
        assert.ok(open);
        open.getBoundingClientRect = () => ({ top: 0, left: 0, right: 120, bottom: 900, width: 120, height: 900, x: 0, y: 0, toJSON() { return {}; } });
        flushSync(() => open.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true, clientX: 8, clientY: 6 * 32 })));
        if (canPaste) {
          assert.match(host.querySelector("[data-copy-bar]")?.textContent ?? "", /outside shop hours/);
          assert.ok(host.querySelector("[data-paste]"));
          flushSync(() => window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })));
          assert.equal((host.querySelector("[data-copy-bar]")?.textContent ?? "").includes("outside shop hours"), false);
        } else {
          assert.equal((host.querySelector("[data-copy-bar]")?.textContent ?? "").includes("outside shop hours"), false);
          assert.deepEqual(bookings, ["elena|10:00"]);
        }
      }
    } finally {
      root.unmount();
      host.remove();
    }
  });

  it("shows a refusal at the hold threshold for a mouse and a touch, before the finger lifts", async () => {
    pinClock(when);
    HTMLElement.prototype.setPointerCapture = () => undefined;
    const scheduling = shop("megan").getState().settings.scheduling;
    const saturday = "2026-11-14";
    const host = document.createElement("div");
    document.body.appendChild(host);
    const root = createRoot(host);
    const bookings: string[] = [];
    let notice: PasteNotice | null = null;
    function paint(canPaste: boolean, slotOpen: boolean, refused: string) {
      flushSync(() => root.render(createElement("div", null,
        createElement(CopyBar, {
          copiedName: canPaste ? "Helen Cho" : "",
          notice,
          onOverride: () => undefined,
          onReason: () => undefined,
          onDismiss: () => undefined,
        }),
        createElement(AppointmentCalendar, {
          appointments: [],
          day: slotOpen ? saturday : "2026-11-15",
          techs: [{ id: "elena", number: "2", name: "Elena", board: "express" as const }],
          selectedId: null,
          onSelect: () => undefined,
          onSlot: (techId: string, time: string) => bookings.push(`${techId}|${time}`),
          onMove: () => undefined,
          onWrite: () => undefined,
          onEdit: () => undefined,
          onPasteSlot: () => bookings.push("paste"),
          canPaste,
          slotOpen,
          slotError: slotOpen
            ? (time: string) => slotGestureError({ actor: "advisor", day: saturday, time, scheduling, userStoreId: "grand-coulee", activeStoreId: "grand-coulee" })
            : undefined,
          onSlotRefused: (message?: string) => {
            notice = { kind: "error", text: message ?? refused };
            paint(canPaste, slotOpen, refused);
          },
          longPressMs: slotOpen ? 550 : 30,
          label: () => "",
          summary: () => ({ name: "", vehicle: "", advisor: "", tech: "", when: "", lane: "", concern: "", vin: "", ops: "", status: "", canWrite: false }),
          hoursFor: () => 0,
        }),
        createElement("p", { "data-below-board": "yes" }, "below the board"),
      )));
    }
    function column() {
      const node = host.querySelector<HTMLElement>("[data-tech='elena']");
      assert.ok(node);
      node.getBoundingClientRect = () => ({ top: 0, left: 0, right: 120, bottom: 900, width: 120, height: 900, x: 0, y: 0, toJSON() { return {}; } });
      return node;
    }
    async function hold(pointerType: "mouse" | "touch", clientY: number, waitMs: number) {
      const lane = column();
      const pointer = window.PointerEvent;
      lane.dispatchEvent(new pointer("pointerdown", { bubbles: true, button: 0, pointerType, isPrimary: true, clientX: 8, clientY, pointerId: 11 }));
      await new Promise((resolve) => setTimeout(resolve, waitMs));
      return lane;
    }
    try {
      for (const canPaste of [false, true]) {
        for (const pointerType of ["mouse", "touch"] as const) {
          bookings.length = 0;
          notice = null;
          paint(canPaste, true, "That time is outside shop hours.");
          await hold(pointerType, 18 * 32, 200);
          assert.equal((host.querySelector("[data-copy-bar]")?.textContent ?? "").includes("outside shop hours"), false, `${pointerType} showed the refusal before the hold finished`);
          assert.equal(bookings.length, 0);
          await new Promise((resolve) => setTimeout(resolve, 400));
          assert.match(host.querySelector("[data-copy-bar]")?.textContent ?? "", /outside shop hours/);
          assert.equal(host.querySelector("[data-paste]"), null);
          assert.equal(host.querySelector("[data-context-menu]"), null);
          assert.equal(bookings.length, 0);
          assert.equal((host.querySelector("[data-below-board]")?.textContent ?? "").includes("outside shop hours"), false);
          const lane = column();
          const pointer = window.PointerEvent;
          window.dispatchEvent(new pointer("pointerup", { bubbles: true, button: 0, pointerType, clientX: 8, clientY: 18 * 32, pointerId: 11 }));
          lane.dispatchEvent(new MouseEvent("click", { bubbles: true, clientX: 8, clientY: 18 * 32 }));
          assert.equal(bookings.length, 0);
          assert.equal(host.querySelector("[data-paste]"), null);
        }
      }
      for (const [slotOpen, refused, clientY] of [
        [false, "The shop is closed that day.", 64],
        [false, "That day is already past.", 96],
      ] as const) {
        bookings.length = 0;
        notice = null;
        paint(true, slotOpen, refused);
        await hold("touch", clientY, 50);
        assert.match(host.querySelector("[data-copy-bar]")?.textContent ?? "", new RegExp(refused.replace(/[.]/g, "\\.")));
        assert.equal(host.querySelector("[data-paste]"), null);
        assert.equal(bookings.length, 0);
      }
    } finally {
      root.unmount();
      host.remove();
    }
  });

  it("a cancelled hold on Saturday 4 PM still lets the next tap at 10:00 open Book", async () => {
    pinClock(when);
    HTMLElement.prototype.setPointerCapture = () => undefined;
    const scheduling = shop("megan").getState().settings.scheduling;
    const saturday = "2026-11-14";
    const host = document.createElement("div");
    document.body.appendChild(host);
    const root = createRoot(host);
    const bookings: string[] = [];
    flushSync(() => root.render(createElement(AppointmentCalendar, {
      appointments: [],
      day: saturday,
      techs: [{ id: "elena", number: "2", name: "Elena", board: "express" as const }],
      selectedId: null,
      onSelect: () => undefined,
      onSlot: (techId: string, time: string) => bookings.push(`${techId}|${time}`),
      onMove: () => undefined,
      onWrite: () => undefined,
      onEdit: () => undefined,
      onPasteSlot: () => bookings.push("paste"),
      canPaste: false,
      slotOpen: true,
      slotError: (time: string) => slotGestureError({ actor: "advisor", day: saturday, time, scheduling, userStoreId: "grand-coulee", activeStoreId: "grand-coulee" }),
      onSlotRefused: () => bookings.push("refused"),
      longPressMs: 30,
      label: () => "",
      summary: () => ({ name: "", vehicle: "", advisor: "", tech: "", when: "", lane: "", concern: "", vin: "", ops: "", status: "", canWrite: false }),
      hoursFor: () => 0,
    })));
    try {
      const column = host.querySelector<HTMLElement>("[data-tech='elena']");
      assert.ok(column);
      column.getBoundingClientRect = () => ({ top: 0, left: 0, right: 120, bottom: 900, width: 120, height: 900, x: 0, y: 0, toJSON() { return {}; } });
      const pointer = window.PointerEvent;
      column.dispatchEvent(new pointer("pointerdown", { bubbles: true, button: 0, pointerType: "touch", isPrimary: true, clientX: 8, clientY: 18 * 32, pointerId: 21 }));
      column.dispatchEvent(new pointer("pointercancel", { bubbles: true, button: 0, pointerType: "touch", isPrimary: true, clientX: 8, clientY: 18 * 32, pointerId: 21 }));
      await new Promise((resolve) => setTimeout(resolve, 50));
      assert.deepEqual(bookings, []);
      assert.equal(host.querySelector("[data-paste]"), null);
      column.dispatchEvent(new pointer("pointerdown", { bubbles: true, button: 0, pointerType: "touch", isPrimary: true, clientX: 8, clientY: 6 * 32, pointerId: 22 }));
      column.dispatchEvent(new pointer("pointerup", { bubbles: true, button: 0, pointerType: "touch", clientX: 8, clientY: 6 * 32, pointerId: 22 }));
      column.dispatchEvent(new MouseEvent("click", { bubbles: true, clientX: 8, clientY: 6 * 32 }));
      assert.deepEqual(bookings, ["elena|10:00"]);
      assert.equal(host.querySelector("[data-paste]"), null);
    } finally {
      root.unmount();
      host.remove();
    }
  });

  it("a hold that finishes and then cancels or lifts still lets the next legal tap open Book", async () => {
    pinClock(when);
    HTMLElement.prototype.setPointerCapture = () => undefined;
    const scheduling = shop("megan").getState().settings.scheduling;
    const saturday = "2026-11-14";
    const host = document.createElement("div");
    document.body.appendChild(host);
    const root = createRoot(host);
    const bookings: string[] = [];
    const refusals: string[] = [];
    function draw(canPaste: boolean) {
      flushSync(() => root.render(createElement(AppointmentCalendar, {
        appointments: [],
        day: saturday,
        techs: [{ id: "elena", number: "2", name: "Elena", board: "express" as const }],
        selectedId: null,
        onSelect: () => undefined,
        onSlot: (techId: string, time: string) => bookings.push(`book|${techId}|${time}`),
        onMove: () => undefined,
        onWrite: () => undefined,
        onEdit: () => undefined,
        onPasteSlot: () => bookings.push("paste-save"),
        canPaste,
        slotOpen: true,
        slotError: (time: string) => slotGestureError({ actor: "advisor", day: saturday, time, scheduling, userStoreId: "grand-coulee", activeStoreId: "grand-coulee" }),
        onSlotRefused: (message?: string) => refusals.push(message ?? ""),
        longPressMs: 40,
        label: () => "",
        summary: () => ({ name: "", vehicle: "", advisor: "", tech: "", when: "", lane: "", concern: "", vin: "", ops: "", status: "", canWrite: false }),
        hoursFor: () => 0,
      })));
    }
    function column() {
      const node = host.querySelector<HTMLElement>("[data-tech='elena']");
      assert.ok(node);
      node.getBoundingClientRect = () => ({ top: 0, left: 0, right: 120, bottom: 900, width: 120, height: 900, x: 0, y: 0, toJSON() { return {}; } });
      return node;
    }
    try {
      const pointer = window.PointerEvent;
      for (const canPaste of [false, true]) {
        for (const pointerType of ["mouse", "touch"] as const) {
          for (const ending of ["cancel", "up"] as const) {
            bookings.length = 0;
            refusals.length = 0;
            draw(canPaste);
            const lane = column();
            lane.dispatchEvent(new pointer("pointerdown", { bubbles: true, button: 0, pointerType, isPrimary: true, clientX: 8, clientY: 18 * 32, pointerId: 31 }));
            await new Promise((resolve) => setTimeout(resolve, 60));
            assert.match(refusals.join(" "), /outside shop hours/, `${pointerType} ${ending} ${canPaste}`);
            assert.equal(host.querySelector("[data-paste]"), null);
            assert.deepEqual(bookings, []);
            const endName = ending === "cancel" ? "pointercancel" : "pointerup";
            window.dispatchEvent(new pointer(endName, { bubbles: true, button: 0, pointerType, clientX: 8, clientY: 18 * 32, pointerId: 31 }));
            const next = column();
            next.dispatchEvent(new pointer("pointerdown", { bubbles: true, button: 0, pointerType, isPrimary: true, clientX: 12, clientY: 6 * 32, pointerId: 32 }));
            next.dispatchEvent(new pointer("pointerup", { bubbles: true, button: 0, pointerType, clientX: 12, clientY: 6 * 32, pointerId: 32 }));
            next.dispatchEvent(new MouseEvent("click", { bubbles: true, clientX: 12, clientY: 6 * 32 }));
            assert.deepEqual(bookings, ["book|elena|10:00"], `${pointerType} ${ending} copy ${canPaste}`);
            assert.equal(host.querySelector("[data-paste]"), null);
          }
        }
      }
      bookings.length = 0;
      refusals.length = 0;
      draw(true);
      const legal = column();
      legal.dispatchEvent(new pointer("pointerdown", { bubbles: true, button: 0, pointerType: "mouse", isPrimary: true, clientX: 8, clientY: 6 * 32, pointerId: 41 }));
      await new Promise((resolve) => setTimeout(resolve, 60));
      assert.ok(host.querySelector("[data-paste]"));
      assert.equal(host.querySelectorAll("[data-paste]").length, 1);
      window.dispatchEvent(new pointer("pointerup", { bubbles: true, button: 0, pointerType: "mouse", clientX: 8, clientY: 6 * 32, pointerId: 41 }));
      legal.dispatchEvent(new MouseEvent("click", { bubbles: true, clientX: 8, clientY: 6 * 32 }));
      assert.deepEqual(bookings, []);
      assert.equal(host.querySelectorAll("[data-paste]").length, 1);
    } finally {
      root.unmount();
      host.remove();
    }
  });

  it("a second finger or a right button does not turn the held click into Book", async () => {
    pinClock(when);
    HTMLElement.prototype.setPointerCapture = () => undefined;
    const scheduling = shop("megan").getState().settings.scheduling;
    const saturday = "2026-11-14";
    const host = document.createElement("div");
    document.body.appendChild(host);
    const root = createRoot(host);
    const bookings: string[] = [];
    flushSync(() => root.render(createElement(AppointmentCalendar, {
      appointments: [],
      day: saturday,
      techs: [{ id: "elena", number: "2", name: "Elena", board: "express" as const }],
      selectedId: null,
      onSelect: () => undefined,
      onSlot: (techId: string, time: string) => bookings.push(`book|${techId}|${time}`),
      onMove: () => undefined,
      onWrite: () => undefined,
      onEdit: () => undefined,
      onPasteSlot: () => bookings.push("paste-save"),
      canPaste: true,
      slotOpen: true,
      slotError: (time: string) => slotGestureError({ actor: "advisor", day: saturday, time, scheduling, userStoreId: "grand-coulee", activeStoreId: "grand-coulee" }),
      longPressMs: 40,
      label: () => "",
      summary: () => ({ name: "", vehicle: "", advisor: "", tech: "", when: "", lane: "", concern: "", vin: "", ops: "", status: "", canWrite: false }),
      hoursFor: () => 0,
    })));
    try {
      const pointer = window.PointerEvent;
      const column = () => {
        const node = host.querySelector<HTMLElement>("[data-tech='elena']");
        assert.ok(node);
        node.getBoundingClientRect = () => ({ top: 0, left: 0, right: 120, bottom: 900, width: 120, height: 900, x: 0, y: 0, toJSON() { return {}; } });
        return node;
      };
      const lane = column();
      lane.dispatchEvent(new pointer("pointerdown", { bubbles: true, button: 0, pointerType: "touch", isPrimary: true, clientX: 8, clientY: 6 * 32, pointerId: 51 }));
      await new Promise((resolve) => setTimeout(resolve, 60));
      assert.equal(host.querySelectorAll("[data-paste]").length, 1);
      lane.dispatchEvent(new pointer("pointerdown", { bubbles: true, button: 0, pointerType: "touch", isPrimary: false, clientX: 40, clientY: 18 * 32, pointerId: 52 }));
      lane.dispatchEvent(new MouseEvent("click", { bubbles: true, clientX: 8, clientY: 6 * 32 }));
      assert.deepEqual(bookings, []);
      assert.equal(host.querySelectorAll("[data-paste]").length, 1);
      window.dispatchEvent(new pointer("pointerup", { bubbles: true, button: 0, pointerType: "touch", isPrimary: true, clientX: 8, clientY: 6 * 32, pointerId: 51 }));
      bookings.length = 0;
      const mouse = column();
      mouse.dispatchEvent(new pointer("pointerdown", { bubbles: true, button: 0, pointerType: "mouse", isPrimary: true, clientX: 8, clientY: 6 * 32, pointerId: 61 }));
      await new Promise((resolve) => setTimeout(resolve, 60));
      assert.equal(host.querySelectorAll("[data-paste]").length, 1);
      mouse.dispatchEvent(new pointer("pointerdown", { bubbles: true, button: 2, pointerType: "mouse", isPrimary: true, clientX: 8, clientY: 6 * 32, pointerId: 61 }));
      mouse.dispatchEvent(new MouseEvent("click", { bubbles: true, button: 0, clientX: 8, clientY: 6 * 32 }));
      assert.deepEqual(bookings, []);
      assert.equal(host.querySelectorAll("[data-paste]").length, 1);
    } finally {
      root.unmount();
      host.remove();
    }
  });

  it("a second finger cannot take the hold or open Book on its own slot", async () => {
    pinClock(when);
    HTMLElement.prototype.setPointerCapture = () => undefined;
    const scheduling = shop("megan").getState().settings.scheduling;
    const saturday = "2026-11-14";
    const pointer = window.PointerEvent;
    for (const pointerType of ["touch", "mouse"] as const) {
      const clock = fakeWindowTimers();
      const host = document.createElement("div");
      document.body.appendChild(host);
      const root = createRoot(host);
      const bookings: string[] = [];
      const heldId = pointerType === "touch" ? 71 : 81;
      const otherId = pointerType === "touch" ? 72 : 82;
      flushSync(() => root.render(createElement(AppointmentCalendar, {
        appointments: [],
        day: saturday,
        techs: [{ id: "elena", number: "2", name: "Elena", board: "express" as const }],
        selectedId: null,
        onSelect: () => undefined,
        onSlot: (techId: string, time: string) => bookings.push(`book|${techId}|${time}`),
        onMove: () => undefined,
        onWrite: () => undefined,
        onEdit: () => undefined,
        onPasteSlot: () => bookings.push("paste-save"),
        canPaste: true,
        slotOpen: true,
        slotError: (time: string) => slotGestureError({ actor: "advisor", day: saturday, time, scheduling, userStoreId: "grand-coulee", activeStoreId: "grand-coulee" }),
        longPressMs: 550,
        label: () => "",
        summary: () => ({ name: "", vehicle: "", advisor: "", tech: "", when: "", lane: "", concern: "", vin: "", ops: "", status: "", canWrite: false }),
        hoursFor: () => 0,
      })));
      try {
        const column = () => {
          const node = host.querySelector<HTMLElement>("[data-tech='elena']");
          assert.ok(node);
          node.getBoundingClientRect = () => ({ top: 0, left: 0, right: 120, bottom: 900, width: 120, height: 900, x: 0, y: 0, toJSON() { return {}; } });
          return node;
        };
        const pasteSlot = () => {
          const menu = host.querySelector<HTMLElement>("[data-context-menu]");
          return { count: host.querySelectorAll("[data-paste]").length, left: menu?.style.left ?? "", top: menu?.style.top ?? "" };
        };
        const lane = column();
        lane.dispatchEvent(new pointer("pointerdown", { bubbles: true, button: 0, pointerType, isPrimary: true, clientX: 8, clientY: 6 * 32, pointerId: heldId }));
        advance(clock, 550);
        assert.deepEqual(pasteSlot(), { count: 1, left: "8px", top: "192px" }, pointerType);
        column().dispatchEvent(new pointer("pointerdown", { bubbles: true, button: 0, pointerType, isPrimary: true, clientX: 48, clientY: 8 * 32, pointerId: otherId }));
        advance(clock, 550);
        window.dispatchEvent(new pointer("pointerup", { bubbles: true, button: 0, pointerType, isPrimary: true, clientX: 48, clientY: 8 * 32, pointerId: otherId }));
        await afterMacrotask();
        pointerClick(column(), { pointerId: otherId, pointerType, clientX: 48, clientY: 8 * 32 });
        assert.deepEqual(bookings, [], pointerType);
        assert.deepEqual(pasteSlot(), { count: 1, left: "8px", top: "192px" }, pointerType);
        window.dispatchEvent(new pointer("pointerup", { bubbles: true, button: 0, pointerType, isPrimary: true, clientX: 8, clientY: 6 * 32, pointerId: heldId }));
        await afterMacrotask();
        pointerClick(column(), { pointerId: heldId, pointerType, clientX: 8, clientY: 6 * 32 });
        assert.deepEqual(bookings, [], pointerType);
        assert.deepEqual(pasteSlot(), { count: 1, left: "8px", top: "192px" }, pointerType);
      } finally {
        root.unmount();
        host.remove();
        restoreFakeTimers?.();
      }
    }
  });

  it("a second pointer during an armed hold is ignored before the hold fires", async () => {
    pinClock(when);
    HTMLElement.prototype.setPointerCapture = () => undefined;
    const clock = fakeWindowTimers();
    const scheduling = shop("megan").getState().settings.scheduling;
    const saturday = "2026-11-14";
    const host = document.createElement("div");
    document.body.appendChild(host);
    const root = createRoot(host);
    const bookings: string[] = [];
    flushSync(() => root.render(createElement(AppointmentCalendar, {
      appointments: [],
      day: saturday,
      techs: [{ id: "elena", number: "2", name: "Elena", board: "express" as const }],
      selectedId: null,
      onSelect: () => undefined,
      onSlot: (techId: string, time: string) => bookings.push(`book|${techId}|${time}`),
      onMove: () => undefined,
      onWrite: () => undefined,
      onEdit: () => undefined,
      onPasteSlot: () => bookings.push("paste-save"),
      canPaste: true,
      slotOpen: true,
      slotError: (time: string) => slotGestureError({ actor: "advisor", day: saturday, time, scheduling, userStoreId: "grand-coulee", activeStoreId: "grand-coulee" }),
      longPressMs: 550,
      label: () => "",
      summary: () => ({ name: "", vehicle: "", advisor: "", tech: "", when: "", lane: "", concern: "", vin: "", ops: "", status: "", canWrite: false }),
      hoursFor: () => 0,
    })));
    try {
      const pointer = window.PointerEvent;
      const column = () => {
        const node = host.querySelector<HTMLElement>("[data-tech='elena']");
        assert.ok(node);
        node.getBoundingClientRect = () => ({ top: 0, left: 0, right: 120, bottom: 900, width: 120, height: 900, x: 0, y: 0, toJSON() { return {}; } });
        return node;
      };
      const lane = column();
      lane.dispatchEvent(new pointer("pointerdown", { bubbles: true, button: 0, pointerType: "touch", isPrimary: true, clientX: 8, clientY: 6 * 32, pointerId: 101 }));
      advance(clock, 549);
      assert.equal(host.querySelector("[data-paste]"), null);
      column().dispatchEvent(new pointer("pointerdown", { bubbles: true, button: 0, pointerType: "touch", isPrimary: true, clientX: 48, clientY: 8 * 32, pointerId: 102 }));
      window.dispatchEvent(new pointer("pointerup", { bubbles: true, button: 0, pointerType: "touch", isPrimary: true, clientX: 48, clientY: 8 * 32, pointerId: 102 }));
      await afterMacrotask();
      pointerClick(column(), { pointerId: 102, pointerType: "touch", clientX: 48, clientY: 8 * 32 });
      assert.deepEqual(bookings, []);
      assert.equal(host.querySelector("[data-paste]"), null);
      advance(clock, 1);
      const menu = host.querySelector<HTMLElement>("[data-context-menu]");
      assert.equal(host.querySelectorAll("[data-paste]").length, 1);
      assert.equal(menu?.style.left, "8px");
      assert.equal(menu?.style.top, "192px");
      window.dispatchEvent(new pointer("pointerup", { bubbles: true, button: 0, pointerType: "touch", isPrimary: true, clientX: 8, clientY: 6 * 32, pointerId: 101 }));
      await afterMacrotask();
      pointerClick(column(), { pointerId: 101, pointerType: "touch", clientX: 8, clientY: 6 * 32 });
      assert.deepEqual(bookings, []);
      assert.equal(host.querySelectorAll("[data-paste]").length, 1);
      assert.equal(host.querySelector<HTMLElement>("[data-context-menu]")?.style.top, "192px");
    } finally {
      root.unmount();
      host.remove();
      restoreFakeTimers?.();
    }
  });

  it("a mouse click while a touch holds, and a touch while the mouse holds, do not open Book", async () => {
    pinClock(when);
    HTMLElement.prototype.setPointerCapture = () => undefined;
    const scheduling = shop("megan").getState().settings.scheduling;
    const saturday = "2026-11-14";
    const pointer = window.PointerEvent;
    for (const phase of ["armed", "active"] as const) {
      for (const [heldType, otherType] of [["touch", "mouse"], ["mouse", "touch"]] as const) {
        const clock = fakeWindowTimers();
        const host = document.createElement("div");
        document.body.appendChild(host);
        const root = createRoot(host);
        const bookings: string[] = [];
        flushSync(() => root.render(createElement(AppointmentCalendar, {
          appointments: [],
          day: saturday,
          techs: [{ id: "elena", number: "2", name: "Elena", board: "express" as const }],
          selectedId: null,
          onSelect: () => undefined,
          onSlot: (techId: string, time: string) => bookings.push(`book|${techId}|${time}`),
          onMove: () => undefined,
          onWrite: () => undefined,
          onEdit: () => undefined,
          onPasteSlot: () => bookings.push("paste-save"),
          canPaste: true,
          slotOpen: true,
          slotError: (time: string) => slotGestureError({ actor: "advisor", day: saturday, time, scheduling, userStoreId: "grand-coulee", activeStoreId: "grand-coulee" }),
          longPressMs: 550,
          label: () => "",
          summary: () => ({ name: "", vehicle: "", advisor: "", tech: "", when: "", lane: "", concern: "", vin: "", ops: "", status: "", canWrite: false }),
          hoursFor: () => 0,
        })));
        try {
          const column = () => {
            const node = host.querySelector<HTMLElement>("[data-tech='elena']");
            assert.ok(node);
            node.getBoundingClientRect = () => ({ top: 0, left: 0, right: 120, bottom: 900, width: 120, height: 900, x: 0, y: 0, toJSON() { return {}; } });
            return node;
          };
          const label = `${phase} ${heldType}-held ${otherType}-click`;
          column().dispatchEvent(new pointer("pointerdown", { bubbles: true, button: 0, pointerType: heldType, isPrimary: true, clientX: 8, clientY: 6 * 32, pointerId: 301 }));
          advance(clock, phase === "armed" ? 200 : 550);
          if (phase === "armed") assert.equal(host.querySelector("[data-paste]"), null, label);
          else {
            assert.equal(host.querySelector<HTMLElement>("[data-context-menu]")?.style.top, "192px", label);
          }
          column().dispatchEvent(new pointer("pointerdown", { bubbles: true, button: 0, pointerType: otherType, isPrimary: true, clientX: 48, clientY: 8 * 32, pointerId: 302 }));
          window.dispatchEvent(new pointer("pointerup", { bubbles: true, button: 0, pointerType: otherType, isPrimary: true, clientX: 48, clientY: 8 * 32, pointerId: 302 }));
          await afterMacrotask();
          pointerClick(column(), { pointerId: 302, pointerType: otherType, clientX: 48, clientY: 8 * 32 });
          assert.deepEqual(bookings, [], label);
          if (phase === "armed") {
            advance(clock, 350);
            assert.equal(host.querySelector<HTMLElement>("[data-context-menu]")?.style.top, "192px", label);
          }
          assert.equal(host.querySelectorAll("[data-paste]").length, 1, label);
          assert.equal(host.querySelector<HTMLElement>("[data-context-menu]")?.style.left, "8px", label);
          window.dispatchEvent(new pointer("pointerup", { bubbles: true, button: 0, pointerType: heldType, isPrimary: true, clientX: 8, clientY: 6 * 32, pointerId: 301 }));
          await afterMacrotask();
          pointerClick(column(), { pointerId: 301, pointerType: heldType, clientX: 8, clientY: 6 * 32 });
          assert.deepEqual(bookings, [], label);
          assert.equal(host.querySelector<HTMLElement>("[data-context-menu]")?.style.top, "192px", label);
        } finally {
          root.unmount();
          host.remove();
          restoreFakeTimers?.();
        }
      }
    }
  });

  it("a click without a pointer id does not drop a foreign pointer before its own click", async () => {
    pinClock(when);
    HTMLElement.prototype.setPointerCapture = () => undefined;
    const clock = fakeWindowTimers();
    const scheduling = shop("megan").getState().settings.scheduling;
    const saturday = "2026-11-14";
    const host = document.createElement("div");
    document.body.appendChild(host);
    const root = createRoot(host);
    const bookings: string[] = [];
    flushSync(() => root.render(createElement(AppointmentCalendar, {
      appointments: [],
      day: saturday,
      techs: [{ id: "elena", number: "2", name: "Elena", board: "express" as const }],
      selectedId: null,
      onSelect: () => undefined,
      onSlot: (techId: string, time: string) => bookings.push(`book|${techId}|${time}`),
      onMove: () => undefined,
      onWrite: () => undefined,
      onEdit: () => undefined,
      onPasteSlot: () => bookings.push("paste-save"),
      canPaste: true,
      slotOpen: true,
      slotError: (time: string) => slotGestureError({ actor: "advisor", day: saturday, time, scheduling, userStoreId: "grand-coulee", activeStoreId: "grand-coulee" }),
      longPressMs: 550,
      label: () => "",
      summary: () => ({ name: "", vehicle: "", advisor: "", tech: "", when: "", lane: "", concern: "", vin: "", ops: "", status: "", canWrite: false }),
      hoursFor: () => 0,
    })));
    try {
      const pointer = window.PointerEvent;
      const column = () => {
        const node = host.querySelector<HTMLElement>("[data-tech='elena']");
        assert.ok(node);
        node.getBoundingClientRect = () => ({ top: 0, left: 0, right: 120, bottom: 900, width: 120, height: 900, x: 0, y: 0, toJSON() { return {}; } });
        return node;
      };
      column().dispatchEvent(new pointer("pointerdown", { bubbles: true, button: 0, pointerType: "touch", isPrimary: true, clientX: 8, clientY: 6 * 32, pointerId: 311 }));
      advance(clock, 550);
      assert.equal(host.querySelector<HTMLElement>("[data-context-menu]")?.style.top, "192px");
      column().dispatchEvent(new pointer("pointerdown", { bubbles: true, button: 0, pointerType: "mouse", isPrimary: true, clientX: 48, clientY: 8 * 32, pointerId: 312 }));
      window.dispatchEvent(new pointer("pointerup", { bubbles: true, button: 0, pointerType: "mouse", isPrimary: true, clientX: 48, clientY: 8 * 32, pointerId: 312 }));
      await afterMacrotask();
      column().dispatchEvent(new pointer("click", { bubbles: true, cancelable: true, button: 0, pointerId: -1, pointerType: "mouse", clientX: 48, clientY: 8 * 32 }));
      pointerClick(column(), { pointerId: 312, pointerType: "mouse", clientX: 48, clientY: 8 * 32 });
      assert.deepEqual(bookings, []);
      assert.equal(host.querySelector<HTMLElement>("[data-context-menu]")?.style.top, "192px");
    } finally {
      root.unmount();
      host.remove();
      restoreFakeTimers?.();
    }
  });

  it("the next primary press clears foreign pointers left from the hold", async () => {
    pinClock(when);
    HTMLElement.prototype.setPointerCapture = () => undefined;
    const clock = fakeWindowTimers();
    const scheduling = shop("megan").getState().settings.scheduling;
    const saturday = "2026-11-14";
    const host = document.createElement("div");
    document.body.appendChild(host);
    const root = createRoot(host);
    const bookings: string[] = [];
    flushSync(() => root.render(createElement(AppointmentCalendar, {
      appointments: [],
      day: saturday,
      techs: [{ id: "elena", number: "2", name: "Elena", board: "express" as const }],
      selectedId: null,
      onSelect: () => undefined,
      onSlot: (techId: string, time: string) => bookings.push(`book|${techId}|${time}`),
      onMove: () => undefined,
      onWrite: () => undefined,
      onEdit: () => undefined,
      onPasteSlot: () => bookings.push("paste-save"),
      canPaste: true,
      slotOpen: true,
      slotError: (time: string) => slotGestureError({ actor: "advisor", day: saturday, time, scheduling, userStoreId: "grand-coulee", activeStoreId: "grand-coulee" }),
      longPressMs: 550,
      label: () => "",
      summary: () => ({ name: "", vehicle: "", advisor: "", tech: "", when: "", lane: "", concern: "", vin: "", ops: "", status: "", canWrite: false }),
      hoursFor: () => 0,
    })));
    try {
      const pointer = window.PointerEvent;
      const column = () => {
        const node = host.querySelector<HTMLElement>("[data-tech='elena']");
        assert.ok(node);
        node.getBoundingClientRect = () => ({ top: 0, left: 0, right: 120, bottom: 900, width: 120, height: 900, x: 0, y: 0, toJSON() { return {}; } });
        return node;
      };
      const onClock = (run: () => void) => {
        window.setTimeout(run, 0);
        advance(clock, 0);
      };
      onClock(() => column().dispatchEvent(new pointer("pointerdown", { bubbles: true, button: 0, pointerType: "touch", isPrimary: true, clientX: 8, clientY: 6 * 32, pointerId: 321 })));
      advance(clock, 100);
      onClock(() => column().dispatchEvent(new pointer("pointerdown", { bubbles: true, button: 0, pointerType: "mouse", isPrimary: true, clientX: 48, clientY: 8 * 32, pointerId: 322 })));
      onClock(() => window.dispatchEvent(new pointer("pointerup", { bubbles: true, button: 0, pointerType: "mouse", isPrimary: true, clientX: 48, clientY: 8 * 32, pointerId: 322 })));
      onClock(() => window.dispatchEvent(new pointer("pointerup", { bubbles: true, button: 0, pointerType: "touch", isPrimary: true, clientX: 8, clientY: 6 * 32, pointerId: 321 })));
      onClock(() => column().dispatchEvent(new pointer("pointerdown", { bubbles: true, button: 0, pointerType: "mouse", isPrimary: true, clientX: 48, clientY: 8 * 32, pointerId: 322 })));
      onClock(() => window.dispatchEvent(new pointer("pointerup", { bubbles: true, button: 0, pointerType: "mouse", isPrimary: true, clientX: 48, clientY: 8 * 32, pointerId: 322 })));
      onClock(() => pointerClick(column(), { pointerId: 322, pointerType: "mouse", clientX: 48, clientY: 8 * 32 }));
      assert.deepEqual(bookings, ["book|elena|11:00"]);
      assert.equal(host.querySelector("[data-paste]"), null);
    } finally {
      root.unmount();
      host.remove();
      restoreFakeTimers?.();
    }
  });

  it("a foreign click that arrives after the hold ends still belongs to that pointer", async () => {
    pinClock(when);
    HTMLElement.prototype.setPointerCapture = () => undefined;
    const clock = fakeWindowTimers();
    const scheduling = shop("megan").getState().settings.scheduling;
    const saturday = "2026-11-14";
    const host = document.createElement("div");
    document.body.appendChild(host);
    const root = createRoot(host);
    const bookings: string[] = [];
    flushSync(() => root.render(createElement(AppointmentCalendar, {
      appointments: [],
      day: saturday,
      techs: [{ id: "elena", number: "2", name: "Elena", board: "express" as const }],
      selectedId: null,
      onSelect: () => undefined,
      onSlot: (techId: string, time: string) => bookings.push(`book|${techId}|${time}`),
      onMove: () => undefined,
      onWrite: () => undefined,
      onEdit: () => undefined,
      onPasteSlot: () => bookings.push("paste-save"),
      canPaste: true,
      slotOpen: true,
      slotError: (time: string) => slotGestureError({ actor: "advisor", day: saturday, time, scheduling, userStoreId: "grand-coulee", activeStoreId: "grand-coulee" }),
      longPressMs: 550,
      label: () => "",
      summary: () => ({ name: "", vehicle: "", advisor: "", tech: "", when: "", lane: "", concern: "", vin: "", ops: "", status: "", canWrite: false }),
      hoursFor: () => 0,
    })));
    try {
      const pointer = window.PointerEvent;
      const column = () => {
        const node = host.querySelector<HTMLElement>("[data-tech='elena']");
        assert.ok(node);
        node.getBoundingClientRect = () => ({ top: 0, left: 0, right: 120, bottom: 900, width: 120, height: 900, x: 0, y: 0, toJSON() { return {}; } });
        return node;
      };
      column().dispatchEvent(new pointer("pointerdown", { bubbles: true, button: 0, pointerType: "touch", isPrimary: true, clientX: 8, clientY: 6 * 32, pointerId: 501 }));
      advance(clock, 550);
      assert.equal(host.querySelector<HTMLElement>("[data-context-menu]")?.style.top, "192px");
      column().dispatchEvent(new pointer("pointerdown", { bubbles: true, button: 0, pointerType: "touch", isPrimary: false, clientX: 48, clientY: 8 * 32, pointerId: 502 }));
      window.dispatchEvent(new pointer("pointerup", { bubbles: true, button: 0, pointerType: "touch", isPrimary: false, clientX: 48, clientY: 8 * 32, pointerId: 502 }));
      window.dispatchEvent(new pointer("pointerup", { bubbles: true, button: 0, pointerType: "touch", isPrimary: true, clientX: 8, clientY: 6 * 32, pointerId: 501 }));
      await afterMacrotask();
      pointerClick(column(), { pointerId: 502, pointerType: "touch", clientX: 48, clientY: 8 * 32 });
      column().dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, button: 0, clientX: 48, clientY: 8 * 32 }));
      assert.deepEqual(bookings, []);
      assert.equal(host.querySelectorAll("[data-paste]").length, 1);
      assert.equal(host.querySelector<HTMLElement>("[data-context-menu]")?.style.top, "192px");
      column().dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, button: 0, clientX: 48, clientY: 8 * 32 }));
      assert.deepEqual(bookings, ["book|elena|11:00"]);
    } finally {
      root.unmount();
      host.remove();
      restoreFakeTimers?.();
    }
  });

  it("a second finger on a card during a hold does not open details", async () => {
    pinClock(when);
    HTMLElement.prototype.setPointerCapture = () => undefined;
    const scheduling = shop("megan").getState().settings.scheduling;
    const saturday = "2026-11-14";
    const pointer = window.PointerEvent;
    const card = {
      id: "oil", date: saturday, time: "09:00", minutes: 90, customerId: "c", vehicleId: "v", advisorId: "megan",
      concern: "Oil", lines: [{ id: "oil-a", code: "A", concern: "Oil" }],
      vin: "", laborOpIds: [] as string[], techId: "elena", lane: "waiter" as const, status: "scheduled" as const, orderId: null,
    };
    for (const phase of ["armed", "active"] as const) {
      const clock = fakeWindowTimers();
      const host = document.createElement("div");
      document.body.appendChild(host);
      const root = createRoot(host);
      const bookings: string[] = [];
      const selected: string[] = [];
      flushSync(() => root.render(createElement(AppointmentCalendar, {
        appointments: [card],
        day: saturday,
        techs: [{ id: "elena", number: "2", name: "Elena", board: "express" as const }],
        selectedId: null,
        onSelect: (id: string) => selected.push(id),
        onSlot: (techId: string, time: string) => bookings.push(`book|${techId}|${time}`),
        onMove: () => undefined,
        onWrite: () => undefined,
        onEdit: () => undefined,
        onPasteSlot: () => bookings.push("paste-save"),
        canPaste: true,
        slotOpen: true,
        slotError: (time: string) => slotGestureError({ actor: "advisor", day: saturday, time, scheduling, userStoreId: "grand-coulee", activeStoreId: "grand-coulee" }),
        longPressMs: 550,
        label: () => "Oil",
        summary: () => ({ name: "Pat", vehicle: "Ford", advisor: "Megan", tech: "Elena", when: "9:00", lane: "Waiter", concern: "Oil", vin: "", ops: "", status: "Scheduled", canWrite: false }),
        hoursFor: () => 0,
      })));
      try {
        const column = () => {
          const node = host.querySelector<HTMLElement>("[data-tech='elena']");
          assert.ok(node);
          node.getBoundingClientRect = () => ({ top: 0, left: 0, right: 120, bottom: 900, width: 120, height: 900, x: 0, y: 0, toJSON() { return {}; } });
          return node;
        };
        const visit = () => {
          const node = host.querySelector<HTMLElement>("[data-appt]");
          assert.ok(node);
          return node;
        };
        const onClock = (run: () => void) => {
          window.setTimeout(run, 0);
          advance(clock, 0);
        };
        column().dispatchEvent(new pointer("pointerdown", { bubbles: true, button: 0, pointerType: "touch", isPrimary: true, clientX: 8, clientY: 6 * 32, pointerId: 601 }));
        advance(clock, phase === "armed" ? 120 : 550);
        onClock(() => visit().dispatchEvent(new pointer("pointerdown", { bubbles: true, cancelable: true, button: 0, pointerType: "touch", isPrimary: false, clientX: 20, clientY: 4 * 32, pointerId: 602 })));
        onClock(() => visit().dispatchEvent(new pointer("pointerup", { bubbles: true, cancelable: true, button: 0, pointerType: "touch", isPrimary: false, clientX: 20, clientY: 4 * 32, pointerId: 602 })));
        onClock(() => pointerClick(visit(), { pointerId: 602, pointerType: "touch", clientX: 20, clientY: 4 * 32 }));
        assert.deepEqual(selected, [], phase);
        assert.equal(host.querySelector("[data-hover-summary]"), null, phase);
        assert.deepEqual(bookings, [], phase);
        if (phase === "armed") advance(clock, 430);
        assert.equal(host.querySelector<HTMLElement>("[data-context-menu]")?.style.top, "192px", phase);
        window.dispatchEvent(new pointer("pointerup", { bubbles: true, button: 0, pointerType: "touch", isPrimary: true, clientX: 8, clientY: 6 * 32, pointerId: 601 }));
        await afterMacrotask();
        pointerClick(column(), { pointerId: 601, pointerType: "touch", clientX: 8, clientY: 6 * 32 });
        assert.deepEqual(bookings, [], phase);
        assert.equal(host.querySelectorAll("[data-paste]").length, 1, phase);
        onClock(() => visit().dispatchEvent(new pointer("pointerdown", { bubbles: true, cancelable: true, button: 0, pointerType: "touch", isPrimary: true, clientX: 20, clientY: 4 * 32, pointerId: 603 })));
        onClock(() => window.dispatchEvent(new pointer("pointerup", { bubbles: true, cancelable: true, button: 0, pointerType: "touch", isPrimary: true, clientX: 20, clientY: 4 * 32, pointerId: 603 })));
        onClock(() => pointerClick(visit(), { pointerId: 603, pointerType: "touch", clientX: 20, clientY: 4 * 32 }));
        assert.deepEqual(selected, ["oil"], phase);
        assert.deepEqual(bookings, [], phase);
        assert.equal(host.querySelectorAll("[data-paste]").length, 1, phase);
      } finally {
        root.unmount();
        host.remove();
        restoreFakeTimers?.();
      }
    }
  });

  it("a scroll while a hold is armed or active opens nothing and writes nothing", async () => {
    pinClock(when);
    HTMLElement.prototype.setPointerCapture = () => undefined;
    const scheduling = shop("megan").getState().settings.scheduling;
    const saturday = "2026-11-14";
    const pointer = window.PointerEvent;
    const card = {
      id: "oil", date: saturday, time: "09:00", minutes: 60, customerId: "c", vehicleId: "v", advisorId: "megan",
      concern: "Oil", lines: [{ id: "oil-a", code: "A", concern: "Oil" }],
      vin: "", laborOpIds: [] as string[], techId: "elena", lane: "waiter" as const, status: "scheduled" as const, orderId: null,
    };
    for (const phase of ["armed", "active"] as const) {
      const clock = fakeWindowTimers();
      const host = document.createElement("div");
      document.body.appendChild(host);
      const root = createRoot(host);
      const bookings: string[] = [];
      flushSync(() => root.render(createElement(AppointmentCalendar, {
        appointments: [card],
        day: saturday,
        techs: [{ id: "elena", number: "2", name: "Elena", board: "express" as const }],
        selectedId: null,
        onSelect: () => undefined,
        onSlot: (techId: string, time: string) => bookings.push(`book|${techId}|${time}`),
        onMove: () => undefined,
        onWrite: () => undefined,
        onEdit: () => undefined,
        onPasteSlot: () => bookings.push("paste-save"),
        canPaste: true,
        slotOpen: true,
        slotError: (time: string) => slotGestureError({ actor: "advisor", day: saturday, time, scheduling, userStoreId: "grand-coulee", activeStoreId: "grand-coulee" }),
        longPressMs: 550,
        label: () => "Oil",
        summary: () => ({ name: "Pat", vehicle: "Ford", advisor: "Megan", tech: "Elena", when: "9:00", lane: "Waiter", concern: "Oil", vin: "", ops: "", status: "Scheduled", canWrite: false }),
        hoursFor: () => 1,
      })));
      try {
        const before = host.querySelectorAll("[data-appt]").length;
        const column = () => {
          const node = host.querySelector<HTMLElement>("[data-tech='elena']");
          assert.ok(node);
          node.getBoundingClientRect = () => ({ top: 0, left: 0, right: 120, bottom: 900, width: 120, height: 900, x: 0, y: 0, toJSON() { return {}; } });
          return node;
        };
        document.body.style.minHeight = "2400px";
        column().dispatchEvent(new pointer("pointerdown", { bubbles: true, button: 0, pointerType: "touch", isPrimary: true, clientX: 8, clientY: 6 * 32, pointerId: 801 }));
        advance(clock, phase === "armed" ? 120 : 550);
        if (phase === "active") assert.equal(host.querySelectorAll("[data-paste]").length, 1, phase);
        act(() => {
          if (phase === "armed") {
            column().dispatchEvent(new window.WheelEvent("wheel", { bubbles: true, cancelable: true, deltaY: 120 }));
            window.scrollTo(0, 180);
            assert.ok(window.scrollY >= 180, phase);
            window.dispatchEvent(new Event("scroll"));
          } else {
            const scroller = column().closest(".overflow-x-auto");
            assert.ok(scroller instanceof HTMLElement, phase);
            scroller.style.height = "140px";
            scroller.style.overflow = "auto";
            scroller.scrollTop = 48;
            assert.ok(scroller.scrollTop > 0, phase);
            scroller.dispatchEvent(new Event("scroll"));
          }
        });
        if (phase === "armed") advance(clock, 500);
        assert.equal(host.querySelectorAll("[data-context-menu]").length, 0, phase);
        assert.equal(host.querySelectorAll("[data-paste]").length, 0, phase);
        assert.equal(host.querySelectorAll("[data-appt]").length, before, phase);
        window.dispatchEvent(new pointer("pointerup", { bubbles: true, button: 0, pointerType: "touch", isPrimary: true, clientX: 8, clientY: 6 * 32, pointerId: 801 }));
        pointerClick(column(), { pointerId: 801, pointerType: "touch", clientX: 8, clientY: 6 * 32 });
        assert.deepEqual(bookings, [], phase);
        assert.equal(host.querySelectorAll("[data-appt]").length, before, phase);
      } finally {
        window.scrollTo(0, 0);
        document.body.style.minHeight = "";
        root.unmount();
        host.remove();
        restoreFakeTimers?.();
      }
    }
  });

  it("a scroll event that does not move keeps the hold", async () => {
    pinClock(when);
    HTMLElement.prototype.setPointerCapture = () => undefined;
    const clock = fakeWindowTimers();
    const scheduling = shop("megan").getState().settings.scheduling;
    const saturday = "2026-11-14";
    const host = document.createElement("div");
    document.body.appendChild(host);
    const root = createRoot(host);
    const bookings: string[] = [];
    const card = {
      id: "oil", date: saturday, time: "09:00", minutes: 60, customerId: "c", vehicleId: "v", advisorId: "megan",
      concern: "Oil", lines: [{ id: "oil-a", code: "A", concern: "Oil" }],
      vin: "", laborOpIds: [] as string[], techId: "elena", lane: "waiter" as const, status: "scheduled" as const, orderId: null,
    };
    flushSync(() => root.render(createElement(AppointmentCalendar, {
      appointments: [card],
      day: saturday,
      techs: [{ id: "elena", number: "2", name: "Elena", board: "express" as const }],
      selectedId: null,
      onSelect: () => undefined,
      onSlot: (techId: string, time: string) => bookings.push(`book|${techId}|${time}`),
      onMove: () => undefined,
      onWrite: () => undefined,
      onEdit: () => undefined,
      onPasteSlot: () => bookings.push("paste-save"),
      canPaste: true,
      slotOpen: true,
      slotError: (time: string) => slotGestureError({ actor: "advisor", day: saturday, time, scheduling, userStoreId: "grand-coulee", activeStoreId: "grand-coulee" }),
      longPressMs: 550,
      label: () => "Oil",
      summary: () => ({ name: "Pat", vehicle: "Ford", advisor: "Megan", tech: "Elena", when: "9:00", lane: "Waiter", concern: "Oil", vin: "", ops: "", status: "Scheduled", canWrite: false }),
      hoursFor: () => 1,
    })));
    try {
      const before = host.querySelectorAll("[data-appt]").length;
      const pointer = window.PointerEvent;
      const column = host.querySelector<HTMLElement>("[data-tech='elena']");
      assert.ok(column);
      column.getBoundingClientRect = () => ({ top: 0, left: 0, right: 120, bottom: 900, width: 120, height: 900, x: 0, y: 0, toJSON() { return {}; } });
      const scrollY = window.scrollY;
      column.dispatchEvent(new pointer("pointerdown", { bubbles: true, button: 0, pointerType: "touch", isPrimary: true, clientX: 8, clientY: 6 * 32, pointerId: 811 }));
      advance(clock, 120);
      act(() => {
        window.dispatchEvent(new Event("scroll"));
        column.dispatchEvent(new Event("scroll"));
      });
      assert.equal(window.scrollY, scrollY);
      advance(clock, 430);
      assert.equal(host.querySelectorAll("[data-paste]").length, 1);
      assert.equal(host.querySelectorAll("[data-appt]").length, before);
      assert.deepEqual(bookings, []);
    } finally {
      root.unmount();
      host.remove();
      restoreFakeTimers?.();
    }
  });

  it("a released Paste or Copy menu closes when the page scrolls and writes nothing", async () => {
    pinClock(when);
    HTMLElement.prototype.setPointerCapture = () => undefined;
    const scheduling = shop("megan").getState().settings.scheduling;
    const saturday = "2026-11-14";
    const pointer = window.PointerEvent;
    const cards = [0, 1].map((index) => ({
      id: `oil-${index}`, date: saturday, time: index === 0 ? "09:00" : "09:30", minutes: 30, customerId: "c", vehicleId: "v", advisorId: "megan",
      concern: "Oil", lines: [{ id: `oil-${index}-a`, code: "A", concern: "Oil" }],
      vin: "", laborOpIds: [] as string[], techId: "elena", lane: "waiter" as const, status: "scheduled" as const, orderId: null,
    }));
    for (const kind of ["paste-hold", "paste-click", "copy-hold", "copy-click"] as const) {
      const clock = fakeWindowTimers();
      const host = document.createElement("div");
      document.body.appendChild(host);
      const root = createRoot(host);
      const bookings: string[] = [];
      flushSync(() => root.render(createElement(AppointmentCalendar, {
        appointments: cards,
        day: saturday,
        techs: [{ id: "elena", number: "2", name: "Elena", board: "express" as const }],
        selectedId: null,
        onSelect: () => undefined,
        onSlot: (techId: string, time: string) => bookings.push(`book|${techId}|${time}`),
        onMove: () => undefined,
        onWrite: () => undefined,
        onEdit: () => undefined,
        onCopy: (id: string) => bookings.push(`copy|${id}`),
        onPasteSlot: (techId: string, time: string) => bookings.push(`paste|${techId}|${time}`),
        canPaste: true,
        slotOpen: true,
        slotError: (time: string) => slotGestureError({ actor: "advisor", day: saturday, time, scheduling, userStoreId: "grand-coulee", activeStoreId: "grand-coulee" }),
        longPressMs: 550,
        label: () => "Oil",
        summary: () => ({ name: "Pat", vehicle: "Ford", advisor: "Megan", tech: "Elena", when: "9:00", lane: "Waiter", concern: "Oil", vin: "", ops: "", status: "Scheduled", canWrite: false }),
        hoursFor: () => 1,
      })));
      try {
        const before = host.querySelectorAll("[data-appt]").length;
        const column = () => {
          const node = host.querySelector<HTMLElement>("[data-tech='elena']");
          assert.ok(node);
          node.getBoundingClientRect = () => ({ top: 0, left: 0, right: 120, bottom: 900, width: 120, height: 900, x: 0, y: 0, toJSON() { return {}; } });
          return node;
        };
        document.body.style.minHeight = "2400px";
        if (kind === "paste-hold") {
          column().dispatchEvent(new pointer("pointerdown", { bubbles: true, button: 0, pointerType: "touch", isPrimary: true, clientX: 8, clientY: 10 * 32, pointerId: 821 }));
          advance(clock, 550);
          window.dispatchEvent(new pointer("pointerup", { bubbles: true, button: 0, pointerType: "touch", isPrimary: true, clientX: 8, clientY: 10 * 32, pointerId: 821 }));
          assert.equal(host.querySelectorAll("[data-paste]").length, 1, kind);
        } else if (kind === "paste-click") {
          flushSync(() => column().dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true, button: 2, clientX: 8, clientY: 10 * 32 })));
          assert.equal(host.querySelectorAll("[data-paste]").length, 1, kind);
        } else if (kind === "copy-hold") {
          const visit = host.querySelector<HTMLElement>("[data-appt]");
          assert.ok(visit);
          visit.dispatchEvent(new pointer("pointerdown", { bubbles: true, button: 0, pointerType: "touch", isPrimary: true, clientX: 20, clientY: 4 * 32, pointerId: 822 }));
          advance(clock, 550);
          window.dispatchEvent(new pointer("pointerup", { bubbles: true, button: 0, pointerType: "touch", isPrimary: true, clientX: 20, clientY: 4 * 32, pointerId: 822 }));
          assert.equal(host.querySelectorAll("[data-copy]").length, 1, kind);
        } else {
          const visit = host.querySelector<HTMLElement>("[data-appt]");
          assert.ok(visit);
          flushSync(() => visit.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true, button: 2, clientX: 20, clientY: 4 * 32 })));
          assert.equal(host.querySelectorAll("[data-copy]").length, 1, kind);
        }
        await act(async () => { await afterMacrotask(); });
        act(() => {
          if (kind === "paste-click" || kind === "copy-hold") {
            const scroller = column().closest(".overflow-x-auto");
            assert.ok(scroller instanceof HTMLElement, kind);
            scroller.style.height = "140px";
            scroller.style.overflow = "auto";
            scroller.scrollTop = 36;
            assert.ok(scroller.scrollTop > 8, kind);
            scroller.dispatchEvent(new Event("scroll"));
          } else if (kind === "copy-click") {
            column().dispatchEvent(new window.WheelEvent("wheel", { bubbles: true, cancelable: true, deltaY: 140 }));
          } else {
            window.scrollTo(0, 160);
            assert.ok(window.scrollY > 8, kind);
            window.dispatchEvent(new Event("scroll"));
          }
        });
        assert.equal(host.querySelectorAll("[data-context-menu]").length, 0, kind);
        assert.equal(host.querySelectorAll("[data-appt]").length, before, kind);
        assert.deepEqual(bookings, [], kind);
      } finally {
        window.scrollTo(0, 0);
        document.body.style.minHeight = "";
        root.unmount();
        host.remove();
        restoreFakeTimers?.();
      }
    }
  });

  it("a Friday hold still opens Paste when the outside-hours notice shrinks the bar", async () => {
    pinClock(when);
    HTMLElement.prototype.setPointerCapture = () => undefined;
    const clock = fakeWindowTimers();
    const scheduling = shop("megan").getState().settings.scheduling;
    const host = document.createElement("div");
    document.body.appendChild(host);
    const root = createRoot(host);
    const bookings: string[] = [];
    const rows = [0, 1].map((index) => ({
      id: `fri-${index}`, date: friday, time: index === 0 ? "09:00" : "09:30", minutes: 30, customerId: "c", vehicleId: "v", advisorId: "megan",
      concern: "Oil", lines: [{ id: `fri-${index}-a`, code: "A", concern: "Oil" }],
      vin: "", laborOpIds: [] as string[], techId: "elena", lane: "waiter" as const, status: "scheduled" as const, orderId: null,
    }));
    function FridayBoard() {
      const [showNotice, setShowNotice] = useState(true);
      return createElement("div", null,
        createElement(CopyBar, {
          copiedName: "Helen Cho",
          notice: showNotice ? { kind: "error" as const, text: "That time is outside shop hours." } : null,
          onOverride: () => undefined,
          onReason: () => undefined,
          onDismiss: () => setShowNotice(false),
        }),
        createElement(AppointmentCalendar, {
          appointments: rows,
          day: friday,
          techs: [{ id: "elena", number: "2", name: "Elena", board: "express" as const }],
          selectedId: null,
          onSelect: () => undefined,
          onSlot: (techId: string, time: string) => bookings.push(`book|${techId}|${time}`),
          onMove: () => undefined,
          onWrite: () => undefined,
          onEdit: () => undefined,
          onPasteSlot: (techId: string, time: string) => bookings.push(`paste|${techId}|${time}`),
          canPaste: true,
          slotOpen: true,
          slotError: (time: string) => slotGestureError({ actor: "advisor", day: friday, time, scheduling, userStoreId: "grand-coulee", activeStoreId: "grand-coulee" }),
          onSlotAccepted: () => {
            setShowNotice(false);
            window.scrollTo(0, Math.max(0, window.scrollY - 80));
            window.dispatchEvent(new Event("scroll"));
          },
          longPressMs: 550,
          label: () => "Helen",
          summary: () => ({ name: "Helen", vehicle: "Ford", advisor: "Megan", tech: "Elena", when: "9:00", lane: "Waiter", concern: "Oil", vin: "", ops: "", status: "Scheduled", canWrite: false }),
          hoursFor: () => 1,
        }),
      );
    }
    flushSync(() => root.render(createElement(FridayBoard)));
    try {
      assert.match(host.querySelector("[data-paste-notice]")?.textContent ?? "", /outside shop hours/);
      const before = host.querySelectorAll("[data-appt]").length;
      const pointer = window.PointerEvent;
      const column = host.querySelector<HTMLElement>("[data-tech='elena']");
      assert.ok(column);
      column.getBoundingClientRect = () => ({ top: 0, left: 0, right: 120, bottom: 900, width: 120, height: 900, x: 0, y: 0, toJSON() { return {}; } });
      document.body.style.minHeight = "2400px";
      window.scrollTo(0, 400);
      column.dispatchEvent(new pointer("pointerdown", { bubbles: true, button: 0, pointerType: "touch", isPrimary: true, clientX: 8, clientY: 6 * 32, pointerId: 831 }));
      advance(clock, 200);
      act(() => {
        window.scrollTo(0, 520);
        window.dispatchEvent(new Event("scroll"));
      });
      advance(clock, 400);
      assert.equal(host.querySelectorAll("[data-paste]").length, 0);
      assert.deepEqual(bookings, []);
      assert.equal(host.querySelectorAll("[data-appt]").length, before);
      window.dispatchEvent(new pointer("pointerup", { bubbles: true, button: 0, pointerType: "touch", isPrimary: true, clientX: 8, clientY: 6 * 32, pointerId: 831 }));
      const parked = window.scrollY;
      column.dispatchEvent(new pointer("pointerdown", { bubbles: true, button: 0, pointerType: "touch", isPrimary: true, clientX: 8, clientY: 6 * 32, pointerId: 832 }));
      advance(clock, 550);
      assert.equal(host.querySelectorAll("[data-paste]").length, 1);
      assert.match(host.querySelector("[data-paste-notice]")?.textContent ?? "", /outside shop hours/);
      assert.equal(window.scrollY, parked);
      assert.deepEqual(bookings, []);
      assert.equal(host.querySelectorAll("[data-appt]").length, before);
      window.dispatchEvent(new pointer("pointerup", { bubbles: true, button: 0, pointerType: "touch", isPrimary: true, clientX: 8, clientY: 6 * 32, pointerId: 832 }));
      assert.equal(host.querySelectorAll("[data-paste]").length, 1);
      assert.equal(window.scrollY, parked);
      flushSync(() => window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })));
      assert.equal(host.querySelector("[data-paste-notice]"), null);
    } finally {
      window.scrollTo(0, 0);
      document.body.style.minHeight = "";
      root.unmount();
      host.remove();
      restoreFakeTimers?.();
    }
  });

  it("a non-primary pointer does not arm a hold", async () => {
    pinClock(when);
    HTMLElement.prototype.setPointerCapture = () => undefined;
    const clock = fakeWindowTimers();
    const scheduling = shop("megan").getState().settings.scheduling;
    const saturday = "2026-11-14";
    const host = document.createElement("div");
    document.body.appendChild(host);
    const root = createRoot(host);
    const bookings: string[] = [];
    flushSync(() => root.render(createElement(AppointmentCalendar, {
      appointments: [],
      day: saturday,
      techs: [{ id: "elena", number: "2", name: "Elena", board: "express" as const }],
      selectedId: null,
      onSelect: () => undefined,
      onSlot: (techId: string, time: string) => bookings.push(`book|${techId}|${time}`),
      onMove: () => undefined,
      onWrite: () => undefined,
      onEdit: () => undefined,
      onPasteSlot: () => bookings.push("paste-save"),
      canPaste: true,
      slotOpen: true,
      slotError: (time: string) => slotGestureError({ actor: "advisor", day: saturday, time, scheduling, userStoreId: "grand-coulee", activeStoreId: "grand-coulee" }),
      longPressMs: 550,
      label: () => "",
      summary: () => ({ name: "", vehicle: "", advisor: "", tech: "", when: "", lane: "", concern: "", vin: "", ops: "", status: "", canWrite: false }),
      hoursFor: () => 0,
    })));
    try {
      const pointer = window.PointerEvent;
      const column = () => {
        const node = host.querySelector<HTMLElement>("[data-tech='elena']");
        assert.ok(node);
        node.getBoundingClientRect = () => ({ top: 0, left: 0, right: 120, bottom: 900, width: 120, height: 900, x: 0, y: 0, toJSON() { return {}; } });
        return node;
      };
      column().dispatchEvent(new pointer("pointerdown", { bubbles: true, button: 0, pointerType: "touch", isPrimary: false, clientX: 8, clientY: 6 * 32, pointerId: 901 }));
      advance(clock, 550);
      assert.equal(host.querySelectorAll("[data-context-menu]").length, 0);
      assert.equal(host.querySelectorAll("[data-paste]").length, 0);
      assert.deepEqual(bookings, []);
      window.dispatchEvent(new pointer("pointerup", { bubbles: true, button: 0, pointerType: "touch", isPrimary: false, clientX: 8, clientY: 6 * 32, pointerId: 901 }));
      column().dispatchEvent(new pointer("pointerdown", { bubbles: true, button: 0, pointerType: "mouse", isPrimary: true, clientX: 48, clientY: 8 * 32, pointerId: 902 }));
      window.dispatchEvent(new pointer("pointerup", { bubbles: true, button: 0, pointerType: "mouse", isPrimary: true, clientX: 48, clientY: 8 * 32, pointerId: 902 }));
      pointerClick(column(), { pointerId: 902, pointerType: "mouse", clientX: 48, clientY: 8 * 32 });
      assert.deepEqual(bookings, ["book|elena|11:00"]);
      assert.equal(host.querySelector("[data-paste]"), null);
    } finally {
      root.unmount();
      host.remove();
      restoreFakeTimers?.();
    }
  });

  it("an untrusted click during a hold does not open Book or clear Paste", async () => {
    pinClock(when);
    HTMLElement.prototype.setPointerCapture = () => undefined;
    const scheduling = shop("megan").getState().settings.scheduling;
    const saturday = "2026-11-14";
    const pointer = window.PointerEvent;
    for (const phase of ["armed", "active"] as const) {
      for (const kind of ["mouse", "minus-one", "element"] as const) {
        const clock = fakeWindowTimers();
        const host = document.createElement("div");
        document.body.appendChild(host);
        const root = createRoot(host);
        const bookings: string[] = [];
        flushSync(() => root.render(createElement(AppointmentCalendar, {
          appointments: [],
          day: saturday,
          techs: [{ id: "elena", number: "2", name: "Elena", board: "express" as const }],
          selectedId: null,
          onSelect: () => undefined,
          onSlot: (techId: string, time: string) => bookings.push(`book|${techId}|${time}`),
          onMove: () => undefined,
          onWrite: () => undefined,
          onEdit: () => undefined,
          onPasteSlot: () => bookings.push("paste-save"),
          canPaste: true,
          slotOpen: true,
          slotError: (time: string) => slotGestureError({ actor: "advisor", day: saturday, time, scheduling, userStoreId: "grand-coulee", activeStoreId: "grand-coulee" }),
          longPressMs: 550,
          label: () => "",
          summary: () => ({ name: "", vehicle: "", advisor: "", tech: "", when: "", lane: "", concern: "", vin: "", ops: "", status: "", canWrite: false }),
          hoursFor: () => 0,
        })));
        try {
          const column = () => {
            const node = host.querySelector<HTMLElement>("[data-tech='elena']");
            assert.ok(node);
            node.getBoundingClientRect = () => ({ top: 0, left: 0, right: 120, bottom: 900, width: 120, height: 900, x: 0, y: 0, toJSON() { return {}; } });
            return node;
          };
          const label = `${phase} ${kind}`;
          column().dispatchEvent(new pointer("pointerdown", { bubbles: true, button: 0, pointerType: "touch", isPrimary: true, clientX: 8, clientY: 6 * 32, pointerId: 401 }));
          advance(clock, phase === "armed" ? 120 : 550);
          const untrusted = () => {
            const lane = column();
            if (kind === "mouse") lane.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, button: 0, clientX: 48, clientY: 8 * 32 }));
            else if (kind === "minus-one") lane.dispatchEvent(new pointer("click", { bubbles: true, cancelable: true, button: 0, pointerId: -1, pointerType: "mouse", clientX: 48, clientY: 8 * 32 }));
            else lane.click();
          };
          untrusted();
          assert.deepEqual(bookings, [], label);
          if (phase === "armed") advance(clock, 430);
          assert.equal(host.querySelector<HTMLElement>("[data-context-menu]")?.style.top, "192px", label);
          window.dispatchEvent(new pointer("pointerup", { bubbles: true, button: 0, pointerType: "touch", isPrimary: true, clientX: 8, clientY: 6 * 32, pointerId: 401 }));
          await afterMacrotask();
          pointerClick(column(), { pointerId: 401, pointerType: "touch", clientX: 8, clientY: 6 * 32 });
          assert.deepEqual(bookings, [], label);
          assert.equal(host.querySelectorAll("[data-paste]").length, 1, label);
          assert.equal(host.querySelector<HTMLElement>("[data-context-menu]")?.style.left, "8px", label);
          assert.equal(host.querySelector<HTMLElement>("[data-context-menu]")?.style.top, "192px", label);
        } finally {
          root.unmount();
          host.remove();
          restoreFakeTimers?.();
        }
      }
    }
  });

  it("a click with no id opens Book after the hold ends", async () => {
    pinClock(when);
    HTMLElement.prototype.setPointerCapture = () => undefined;
    const clock = fakeWindowTimers();
    const scheduling = shop("megan").getState().settings.scheduling;
    const saturday = "2026-11-14";
    const host = document.createElement("div");
    document.body.appendChild(host);
    const root = createRoot(host);
    const bookings: string[] = [];
    flushSync(() => root.render(createElement(AppointmentCalendar, {
      appointments: [],
      day: saturday,
      techs: [{ id: "elena", number: "2", name: "Elena", board: "express" as const }],
      selectedId: null,
      onSelect: () => undefined,
      onSlot: (techId: string, time: string) => bookings.push(`book|${techId}|${time}`),
      onMove: () => undefined,
      onWrite: () => undefined,
      onEdit: () => undefined,
      onPasteSlot: () => bookings.push("paste-save"),
      canPaste: true,
      slotOpen: true,
      slotError: (time: string) => slotGestureError({ actor: "advisor", day: saturday, time, scheduling, userStoreId: "grand-coulee", activeStoreId: "grand-coulee" }),
      longPressMs: 550,
      label: () => "",
      summary: () => ({ name: "", vehicle: "", advisor: "", tech: "", when: "", lane: "", concern: "", vin: "", ops: "", status: "", canWrite: false }),
      hoursFor: () => 0,
    })));
    try {
      const pointer = window.PointerEvent;
      const lane = host.querySelector<HTMLElement>("[data-tech='elena']");
      assert.ok(lane);
      lane.getBoundingClientRect = () => ({ top: 0, left: 0, right: 120, bottom: 900, width: 120, height: 900, x: 0, y: 0, toJSON() { return {}; } });
      lane.dispatchEvent(new pointer("pointerdown", { bubbles: true, button: 0, pointerType: "mouse", isPrimary: true, clientX: 8, clientY: 6 * 32, pointerId: 411 }));
      advance(clock, 80);
      window.dispatchEvent(new pointer("pointerup", { bubbles: true, button: 0, pointerType: "mouse", isPrimary: true, clientX: 8, clientY: 6 * 32, pointerId: 411 }));
      await afterMacrotask();
      lane.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, button: 0, clientX: 8, clientY: 6 * 32 }));
      assert.deepEqual(bookings, ["book|elena|10:00"]);
      assert.equal(host.querySelector("[data-paste]"), null);
    } finally {
      root.unmount();
      host.remove();
      restoreFakeTimers?.();
    }
  });

  it("a cancelled foreign pointer can click normally after the hold ends", async () => {
    pinClock(when);
    HTMLElement.prototype.setPointerCapture = () => undefined;
    const clock = fakeWindowTimers();
    const scheduling = shop("megan").getState().settings.scheduling;
    const saturday = "2026-11-14";
    const host = document.createElement("div");
    document.body.appendChild(host);
    const root = createRoot(host);
    const bookings: string[] = [];
    flushSync(() => root.render(createElement(AppointmentCalendar, {
      appointments: [],
      day: saturday,
      techs: [{ id: "elena", number: "2", name: "Elena", board: "express" as const }],
      selectedId: null,
      onSelect: () => undefined,
      onSlot: (techId: string, time: string) => bookings.push(`book|${techId}|${time}`),
      onMove: () => undefined,
      onWrite: () => undefined,
      onEdit: () => undefined,
      onPasteSlot: () => bookings.push("paste-save"),
      canPaste: true,
      slotOpen: true,
      slotError: (time: string) => slotGestureError({ actor: "advisor", day: saturday, time, scheduling, userStoreId: "grand-coulee", activeStoreId: "grand-coulee" }),
      longPressMs: 550,
      label: () => "",
      summary: () => ({ name: "", vehicle: "", advisor: "", tech: "", when: "", lane: "", concern: "", vin: "", ops: "", status: "", canWrite: false }),
      hoursFor: () => 0,
    })));
    try {
      const pointer = window.PointerEvent;
      const column = () => {
        const node = host.querySelector<HTMLElement>("[data-tech='elena']");
        assert.ok(node);
        node.getBoundingClientRect = () => ({ top: 0, left: 0, right: 120, bottom: 900, width: 120, height: 900, x: 0, y: 0, toJSON() { return {}; } });
        return node;
      };
      column().dispatchEvent(new pointer("pointerdown", { bubbles: true, button: 0, pointerType: "touch", isPrimary: true, clientX: 8, clientY: 6 * 32, pointerId: 421 }));
      advance(clock, 80);
      column().dispatchEvent(new pointer("pointerdown", { bubbles: true, button: 0, pointerType: "mouse", isPrimary: true, clientX: 48, clientY: 8 * 32, pointerId: 422 }));
      window.dispatchEvent(new pointer("pointercancel", { bubbles: true, button: 0, pointerType: "mouse", clientX: 48, clientY: 8 * 32, pointerId: 422 }));
      window.dispatchEvent(new pointer("pointerup", { bubbles: true, button: 0, pointerType: "touch", isPrimary: true, clientX: 8, clientY: 6 * 32, pointerId: 421 }));
      await afterMacrotask();
      pointerClick(column(), { pointerId: 422, pointerType: "mouse", clientX: 48, clientY: 8 * 32 });
      assert.deepEqual(bookings, ["book|elena|11:00"]);
      assert.equal(host.querySelector("[data-paste]"), null);
    } finally {
      root.unmount();
      host.remove();
      restoreFakeTimers?.();
    }
  });

  it("a foreign click on a card during a hold opens nothing and leaves the hold", async () => {
    pinClock(when);
    HTMLElement.prototype.setPointerCapture = () => undefined;
    const clock = fakeWindowTimers();
    const scheduling = shop("megan").getState().settings.scheduling;
    const saturday = "2026-11-14";
    const host = document.createElement("div");
    document.body.appendChild(host);
    const root = createRoot(host);
    const bookings: string[] = [];
    const selected: string[] = [];
    const card = {
      id: "oil", date: saturday, time: "09:00", minutes: 90, customerId: "c", vehicleId: "v", advisorId: "megan",
      concern: "Oil", lines: [{ id: "oil-a", code: "A", concern: "Oil" }],
      vin: "", laborOpIds: [] as string[], techId: "elena", lane: "waiter" as const, status: "scheduled" as const, orderId: null,
    };
    flushSync(() => root.render(createElement(AppointmentCalendar, {
      appointments: [card],
      day: saturday,
      techs: [{ id: "elena", number: "2", name: "Elena", board: "express" as const }],
      selectedId: null,
      onSelect: (id: string) => selected.push(id),
      onSlot: (techId: string, time: string) => bookings.push(`book|${techId}|${time}`),
      onMove: () => undefined,
      onWrite: () => undefined,
      onEdit: () => undefined,
      onPasteSlot: () => bookings.push("paste-save"),
      canPaste: true,
      slotOpen: true,
      slotError: (time: string) => slotGestureError({ actor: "advisor", day: saturday, time, scheduling, userStoreId: "grand-coulee", activeStoreId: "grand-coulee" }),
      longPressMs: 550,
      label: () => "Oil",
      summary: () => ({ name: "Pat", vehicle: "Ford", advisor: "Megan", tech: "Elena", when: "9:00", lane: "Waiter", concern: "Oil", vin: "", ops: "", status: "Scheduled", canWrite: false }),
      hoursFor: () => 0,
    })));
    try {
      const pointer = window.PointerEvent;
      const column = () => {
        const node = host.querySelector<HTMLElement>("[data-tech='elena']");
        assert.ok(node);
        node.getBoundingClientRect = () => ({ top: 0, left: 0, right: 120, bottom: 900, width: 120, height: 900, x: 0, y: 0, toJSON() { return {}; } });
        return node;
      };
      column().dispatchEvent(new pointer("pointerdown", { bubbles: true, button: 0, pointerType: "touch", isPrimary: true, clientX: 8, clientY: 6 * 32, pointerId: 431 }));
      advance(clock, 550);
      assert.equal(host.querySelector<HTMLElement>("[data-context-menu]")?.style.top, "192px");
      column().dispatchEvent(new pointer("pointerdown", { bubbles: true, button: 0, pointerType: "mouse", isPrimary: true, clientX: 20, clientY: 4 * 32, pointerId: 432 }));
      const visit = host.querySelector<HTMLElement>("[data-appt]");
      assert.ok(visit);
      pointerClick(visit, { pointerId: 432, pointerType: "mouse", clientX: 20, clientY: 4 * 32 });
      assert.deepEqual(selected, []);
      assert.equal(host.querySelector("[data-hover-summary]"), null);
      assert.deepEqual(bookings, []);
      assert.equal(host.querySelector<HTMLElement>("[data-context-menu]")?.style.top, "192px");
      window.dispatchEvent(new pointer("pointerup", { bubbles: true, button: 0, pointerType: "touch", isPrimary: true, clientX: 8, clientY: 6 * 32, pointerId: 431 }));
      await afterMacrotask();
      pointerClick(column(), { pointerId: 431, pointerType: "touch", clientX: 8, clientY: 6 * 32 });
      assert.deepEqual(bookings, []);
      assert.equal(host.querySelectorAll("[data-paste]").length, 1);
      pointerClick(column(), { pointerId: 432, pointerType: "mouse", clientX: 48, clientY: 8 * 32 });
      assert.deepEqual(bookings, ["book|elena|11:00"]);
    } finally {
      root.unmount();
      host.remove();
      restoreFakeTimers?.();
    }
  });

  it("a tap on an appointment card does not clear the held slot", () => {
    pinClock(when);
    HTMLElement.prototype.setPointerCapture = () => undefined;
    const clock = fakeWindowTimers();
    const scheduling = shop("megan").getState().settings.scheduling;
    const saturday = "2026-11-14";
    const host = document.createElement("div");
    document.body.appendChild(host);
    const root = createRoot(host);
    const bookings: string[] = [];
    const card = {
      id: "oil", date: saturday, time: "09:00", minutes: 30, customerId: "c", vehicleId: "v", advisorId: "megan",
      concern: "Oil", lines: [{ id: "oil-a", code: "A", concern: "Oil" }],
      vin: "", laborOpIds: [] as string[], techId: "elena", lane: "waiter", status: "scheduled" as const, orderId: null,
    };
    flushSync(() => root.render(createElement(AppointmentCalendar, {
      appointments: [card],
      day: saturday,
      techs: [{ id: "elena", number: "2", name: "Elena", board: "express" as const }],
      selectedId: null,
      onSelect: () => undefined,
      onSlot: (techId: string, time: string) => bookings.push(`book|${techId}|${time}`),
      onMove: () => undefined,
      onWrite: () => undefined,
      onEdit: () => undefined,
      onPasteSlot: () => bookings.push("paste-save"),
      canPaste: true,
      slotOpen: true,
      slotError: (time: string) => slotGestureError({ actor: "advisor", day: saturday, time, scheduling, userStoreId: "grand-coulee", activeStoreId: "grand-coulee" }),
      longPressMs: 550,
      label: () => "Oil",
      summary: () => ({ name: "", vehicle: "", advisor: "", tech: "", when: "", lane: "", concern: "", vin: "", ops: "", status: "", canWrite: false }),
      hoursFor: () => 0,
    })));
    try {
      const pointer = window.PointerEvent;
      const lane = host.querySelector<HTMLElement>("[data-tech='elena']");
      const visit = host.querySelector<HTMLElement>("[data-appt]");
      assert.ok(lane);
      assert.ok(visit);
      lane.getBoundingClientRect = () => ({ top: 0, left: 0, right: 120, bottom: 900, width: 120, height: 900, x: 0, y: 0, toJSON() { return {}; } });
      lane.dispatchEvent(new pointer("pointerdown", { bubbles: true, button: 0, pointerType: "touch", isPrimary: true, clientX: 8, clientY: 6 * 32, pointerId: 111 }));
      advance(clock, 550);
      const menu = host.querySelector<HTMLElement>("[data-context-menu]");
      assert.equal(menu?.style.left, "8px");
      assert.equal(menu?.style.top, "192px");
      visit.dispatchEvent(new MouseEvent("click", { bubbles: true, button: 0, clientX: 20, clientY: 4 * 32 }));
      window.dispatchEvent(new pointer("pointerup", { bubbles: true, button: 0, pointerType: "touch", isPrimary: true, clientX: 8, clientY: 6 * 32, pointerId: 111 }));
      lane.dispatchEvent(new MouseEvent("click", { bubbles: true, button: 0, clientX: 8, clientY: 6 * 32 }));
      assert.deepEqual(bookings, []);
      assert.equal(host.querySelectorAll("[data-paste]").length, 1);
      assert.equal(host.querySelector<HTMLElement>("[data-context-menu]")?.style.top, "192px");
    } finally {
      root.unmount();
      host.remove();
    }
  });

  it("a card right-click during an armed or active hold does not open Copy", async () => {
    pinClock(when);
    HTMLElement.prototype.setPointerCapture = () => undefined;
    const scheduling = shop("megan").getState().settings.scheduling;
    const saturday = "2026-11-14";
    const pointer = window.PointerEvent;
    const card = {
      id: "oil", date: saturday, time: "09:00", minutes: 30, customerId: "c", vehicleId: "v", advisorId: "megan",
      concern: "Oil", lines: [{ id: "oil-a", code: "A", concern: "Oil" }],
      vin: "", laborOpIds: [] as string[], techId: "elena", lane: "waiter" as const, status: "scheduled" as const, orderId: null,
    };
    for (const phase of ["armed", "active"] as const) {
      const clock = fakeWindowTimers();
      const host = document.createElement("div");
      document.body.appendChild(host);
      const root = createRoot(host);
      const bookings: string[] = [];
      const copies: string[] = [];
      flushSync(() => root.render(createElement(AppointmentCalendar, {
        appointments: [card],
        day: saturday,
        techs: [{ id: "elena", number: "2", name: "Elena", board: "express" as const }],
        selectedId: null,
        onSelect: () => undefined,
        onSlot: (techId: string, time: string) => bookings.push(`book|${techId}|${time}`),
        onMove: () => undefined,
        onWrite: () => undefined,
        onEdit: () => undefined,
        onCopy: (id: string) => copies.push(id),
        onPasteSlot: () => bookings.push("paste-save"),
        canPaste: true,
        slotOpen: true,
        slotError: (time: string) => slotGestureError({ actor: "advisor", day: saturday, time, scheduling, userStoreId: "grand-coulee", activeStoreId: "grand-coulee" }),
        longPressMs: 550,
        label: () => "Oil",
        summary: () => ({ name: "", vehicle: "", advisor: "", tech: "", when: "", lane: "", concern: "", vin: "", ops: "", status: "", canWrite: false }),
        hoursFor: () => 0,
      })));
      try {
        const column = () => {
          const node = host.querySelector<HTMLElement>("[data-tech='elena']");
          assert.ok(node);
          node.getBoundingClientRect = () => ({ top: 0, left: 0, right: 120, bottom: 900, width: 120, height: 900, x: 0, y: 0, toJSON() { return {}; } });
          return node;
        };
        column().dispatchEvent(new pointer("pointerdown", { bubbles: true, button: 0, pointerType: "touch", isPrimary: true, clientX: 8, clientY: 6 * 32, pointerId: 331 }));
        advance(clock, phase === "armed" ? 200 : 550);
        if (phase === "active") assert.equal(host.querySelector<HTMLElement>("[data-context-menu]")?.style.top, "192px");
        const visit = host.querySelector<HTMLElement>("[data-appt]");
        assert.ok(visit);
        act(() => {
          visit.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true, button: 2, clientX: 20, clientY: 4 * 32 }));
        });
        assert.equal(host.querySelector("[data-copy]"), null, phase);
        assert.deepEqual(copies, [], phase);
        assert.deepEqual(bookings, [], phase);
        if (phase === "armed") {
          advance(clock, 350);
        }
        assert.equal(host.querySelectorAll("[data-paste]").length, 1, phase);
        assert.equal(host.querySelector<HTMLElement>("[data-context-menu]")?.style.top, "192px", phase);
        assert.equal(host.querySelector("[data-copy]"), null, phase);
      } finally {
        root.unmount();
        host.remove();
        restoreFakeTimers?.();
      }
    }
  });

  it("a right-click during an armed or active hold does not move Paste or open Book", async () => {
    pinClock(when);
    HTMLElement.prototype.setPointerCapture = () => undefined;
    const clock = fakeWindowTimers();
    const scheduling = shop("megan").getState().settings.scheduling;
    const saturday = "2026-11-14";
    const pointer = window.PointerEvent;
    const props = (bookings: string[], canPaste: boolean) => ({
      appointments: [],
      day: saturday,
      techs: [{ id: "elena", number: "2", name: "Elena", board: "express" as const }],
      selectedId: null,
      onSelect: () => undefined,
      onSlot: (techId: string, time: string) => bookings.push(`book|${techId}|${time}`),
      onMove: () => undefined,
      onWrite: () => undefined,
      onEdit: () => undefined,
      onPasteSlot: () => bookings.push("paste-save"),
      canPaste,
      slotOpen: true,
      slotError: (time: string) => slotGestureError({ actor: "advisor", day: saturday, time, scheduling, userStoreId: "grand-coulee", activeStoreId: "grand-coulee" }),
      longPressMs: 550,
      label: () => "",
      summary: () => ({ name: "", vehicle: "", advisor: "", tech: "", when: "", lane: "", concern: "", vin: "", ops: "", status: "", canWrite: false }),
      hoursFor: () => 0,
    });
    const host = document.createElement("div");
    document.body.appendChild(host);
    const root = createRoot(host);
    const bookings: string[] = [];
    flushSync(() => root.render(createElement(AppointmentCalendar, props(bookings, true))));
    try {
      const lane = host.querySelector<HTMLElement>("[data-tech='elena']");
      assert.ok(lane);
      lane.getBoundingClientRect = () => ({ top: 0, left: 0, right: 120, bottom: 900, width: 120, height: 900, x: 0, y: 0, toJSON() { return {}; } });
      const rightClick = () => lane.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true, button: 2, clientX: 48, clientY: 8 * 32 }));
      lane.dispatchEvent(new pointer("pointerdown", { bubbles: true, button: 0, pointerType: "mouse", isPrimary: true, clientX: 8, clientY: 6 * 32, pointerId: 121 }));
      rightClick();
      await afterMacrotask();
      assert.deepEqual(bookings, []);
      assert.equal(host.querySelector("[data-paste]"), null);
      advance(clock, 550);
      assert.equal(host.querySelector<HTMLElement>("[data-context-menu]")?.style.left, "8px");
      assert.equal(host.querySelector<HTMLElement>("[data-context-menu]")?.style.top, "192px");
      rightClick();
      await afterMacrotask();
      assert.deepEqual(bookings, []);
      assert.equal(host.querySelectorAll("[data-paste]").length, 1);
      assert.equal(host.querySelector<HTMLElement>("[data-context-menu]")?.style.left, "8px");
      assert.equal(host.querySelector<HTMLElement>("[data-context-menu]")?.style.top, "192px");
      window.dispatchEvent(new pointer("pointerup", { bubbles: true, button: 0, pointerType: "mouse", clientX: 8, clientY: 6 * 32, pointerId: 121 }));
    } finally {
      root.unmount();
      host.remove();
      restoreFakeTimers?.();
    }
  });

  it("a cancelled second finger does not swallow the short tap", async () => {
    pinClock(when);
    HTMLElement.prototype.setPointerCapture = () => undefined;
    const scheduling = shop("megan").getState().settings.scheduling;
    const saturday = "2026-11-14";
    const pointer = window.PointerEvent;
    for (const ending of ["cancel", "up"] as const) {
      const clock = fakeWindowTimers();
      const host = document.createElement("div");
      document.body.appendChild(host);
      const root = createRoot(host);
      const bookings: string[] = [];
      flushSync(() => root.render(createElement(AppointmentCalendar, {
        appointments: [],
        day: saturday,
        techs: [{ id: "elena", number: "2", name: "Elena", board: "express" as const }],
        selectedId: null,
        onSelect: () => undefined,
        onSlot: (techId: string, time: string) => bookings.push(`book|${techId}|${time}`),
        onMove: () => undefined,
        onWrite: () => undefined,
        onEdit: () => undefined,
        onPasteSlot: () => bookings.push("paste-save"),
        canPaste: true,
        slotOpen: true,
        slotError: (time: string) => slotGestureError({ actor: "advisor", day: saturday, time, scheduling, userStoreId: "grand-coulee", activeStoreId: "grand-coulee" }),
        longPressMs: 550,
        label: () => "",
        summary: () => ({ name: "", vehicle: "", advisor: "", tech: "", when: "", lane: "", concern: "", vin: "", ops: "", status: "", canWrite: false }),
        hoursFor: () => 0,
      })));
      try {
        const lane = host.querySelector<HTMLElement>("[data-tech='elena']");
        assert.ok(lane);
        lane.getBoundingClientRect = () => ({ top: 0, left: 0, right: 120, bottom: 900, width: 120, height: 900, x: 0, y: 0, toJSON() { return {}; } });
        lane.dispatchEvent(new pointer("pointerdown", { bubbles: true, button: 0, pointerType: "touch", isPrimary: true, clientX: 8, clientY: 6 * 32, pointerId: 131 }));
        lane.dispatchEvent(new pointer("pointerdown", { bubbles: true, button: 0, pointerType: "touch", isPrimary: false, clientX: 48, clientY: 8 * 32, pointerId: 132 }));
        const endName = ending === "cancel" ? "pointercancel" : "pointerup";
        window.dispatchEvent(new pointer(endName, { bubbles: true, button: 0, pointerType: "touch", isPrimary: false, clientX: 48, clientY: 8 * 32, pointerId: 132 }));
        if (ending === "up") await afterMacrotask();
        advance(clock, 200);
        window.dispatchEvent(new pointer("pointerup", { bubbles: true, button: 0, pointerType: "touch", isPrimary: true, clientX: 8, clientY: 6 * 32, pointerId: 131 }));
        lane.dispatchEvent(new MouseEvent("click", { bubbles: true, button: 0, clientX: 8, clientY: 6 * 32 }));
        assert.deepEqual(bookings, ["book|elena|10:00"], ending);
        assert.equal(host.querySelector("[data-paste]"), null, ending);
      } finally {
        root.unmount();
        host.remove();
        restoreFakeTimers?.();
      }
    }
  });

  it("a second finger that lifts early does not cancel the first hold", async () => {
    pinClock(when);
    HTMLElement.prototype.setPointerCapture = () => undefined;
    const clock = fakeWindowTimers();
    const scheduling = shop("megan").getState().settings.scheduling;
    const saturday = "2026-11-14";
    const host = document.createElement("div");
    document.body.appendChild(host);
    const root = createRoot(host);
    const bookings: string[] = [];
    flushSync(() => root.render(createElement(AppointmentCalendar, {
      appointments: [],
      day: saturday,
      techs: [{ id: "elena", number: "2", name: "Elena", board: "express" as const }],
      selectedId: null,
      onSelect: () => undefined,
      onSlot: (techId: string, time: string) => bookings.push(`book|${techId}|${time}`),
      onMove: () => undefined,
      onWrite: () => undefined,
      onEdit: () => undefined,
      onPasteSlot: () => bookings.push("paste-save"),
      canPaste: true,
      slotOpen: true,
      slotError: (time: string) => slotGestureError({ actor: "advisor", day: saturday, time, scheduling, userStoreId: "grand-coulee", activeStoreId: "grand-coulee" }),
      longPressMs: 550,
      label: () => "",
      summary: () => ({ name: "", vehicle: "", advisor: "", tech: "", when: "", lane: "", concern: "", vin: "", ops: "", status: "", canWrite: false }),
      hoursFor: () => 0,
    })));
    try {
      const pointer = window.PointerEvent;
      const lane = host.querySelector<HTMLElement>("[data-tech='elena']");
      assert.ok(lane);
      lane.getBoundingClientRect = () => ({ top: 0, left: 0, right: 120, bottom: 900, width: 120, height: 900, x: 0, y: 0, toJSON() { return {}; } });
      lane.dispatchEvent(new pointer("pointerdown", { bubbles: true, button: 0, pointerType: "touch", isPrimary: true, clientX: 8, clientY: 6 * 32, pointerId: 81 }));
      advance(clock, 100);
      lane.dispatchEvent(new pointer("pointerdown", { bubbles: true, button: 0, pointerType: "touch", isPrimary: true, clientX: 48, clientY: 8 * 32, pointerId: 82 }));
      window.dispatchEvent(new pointer("pointerup", { bubbles: true, button: 0, pointerType: "touch", isPrimary: true, clientX: 48, clientY: 8 * 32, pointerId: 82 }));
      assert.equal(host.querySelector("[data-paste]"), null);
      advance(clock, 450);
      const menu = host.querySelector<HTMLElement>("[data-context-menu]");
      assert.equal(host.querySelectorAll("[data-paste]").length, 1);
      assert.equal(menu?.style.left, "8px");
      assert.equal(menu?.style.top, "192px");
      window.dispatchEvent(new pointer("pointerup", { bubbles: true, button: 0, pointerType: "touch", isPrimary: true, clientX: 8, clientY: 6 * 32, pointerId: 81 }));
      lane.dispatchEvent(new MouseEvent("click", { bubbles: true, button: 0, clientX: 8, clientY: 6 * 32 }));
      assert.deepEqual(bookings, []);
      assert.equal(host.querySelectorAll("[data-paste]").length, 1);
    } finally {
      root.unmount();
      host.remove();
      restoreFakeTimers?.();
    }
  });

  it("a non-primary press does not clear a finished hold", async () => {
    pinClock(when);
    HTMLElement.prototype.setPointerCapture = () => undefined;
    const clock = fakeWindowTimers();
    const scheduling = shop("megan").getState().settings.scheduling;
    const saturday = "2026-11-14";
    const host = document.createElement("div");
    document.body.appendChild(host);
    const root = createRoot(host);
    const bookings: string[] = [];
    flushSync(() => root.render(createElement(AppointmentCalendar, {
      appointments: [],
      day: saturday,
      techs: [{ id: "elena", number: "2", name: "Elena", board: "express" as const }],
      selectedId: null,
      onSelect: () => undefined,
      onSlot: (techId: string, time: string) => bookings.push(`book|${techId}|${time}`),
      onMove: () => undefined,
      onWrite: () => undefined,
      onEdit: () => undefined,
      onPasteSlot: () => bookings.push("paste-save"),
      canPaste: true,
      slotOpen: true,
      slotError: (time: string) => slotGestureError({ actor: "advisor", day: saturday, time, scheduling, userStoreId: "grand-coulee", activeStoreId: "grand-coulee" }),
      longPressMs: 550,
      label: () => "",
      summary: () => ({ name: "", vehicle: "", advisor: "", tech: "", when: "", lane: "", concern: "", vin: "", ops: "", status: "", canWrite: false }),
      hoursFor: () => 0,
    })));
    try {
      const pointer = window.PointerEvent;
      const lane = host.querySelector<HTMLElement>("[data-tech='elena']");
      assert.ok(lane);
      lane.getBoundingClientRect = () => ({ top: 0, left: 0, right: 120, bottom: 900, width: 120, height: 900, x: 0, y: 0, toJSON() { return {}; } });
      lane.dispatchEvent(new pointer("pointerdown", { bubbles: true, button: 0, pointerType: "touch", isPrimary: true, clientX: 8, clientY: 6 * 32, pointerId: 91 }));
      advance(clock, 550);
      assert.equal(host.querySelectorAll("[data-paste]").length, 1);
      window.dispatchEvent(new pointer("pointerup", { bubbles: true, button: 0, pointerType: "touch", isPrimary: true, clientX: 8, clientY: 6 * 32, pointerId: 91 }));
      lane.dispatchEvent(new pointer("pointerdown", { bubbles: true, button: 0, pointerType: "touch", isPrimary: false, clientX: 48, clientY: 8 * 32, pointerId: 92 }));
      lane.dispatchEvent(new MouseEvent("click", { bubbles: true, button: 0, clientX: 8, clientY: 6 * 32 }));
      assert.deepEqual(bookings, []);
      assert.equal(host.querySelectorAll("[data-paste]").length, 1);
      const menu = host.querySelector<HTMLElement>("[data-context-menu]");
      assert.equal(menu?.style.left, "8px");
      assert.equal(menu?.style.top, "192px");
      window.dispatchEvent(new pointer("pointerup", { bubbles: true, button: 0, pointerType: "touch", isPrimary: false, clientX: 48, clientY: 8 * 32, pointerId: 92 }));
    } finally {
      root.unmount();
      host.remove();
      restoreFakeTimers?.();
    }
  });

  it("keeps Book closed for Megan and Derek on a past day, a closed day, and the other store", () => {
    pinClock(when);
    const scheduling = shop().getState().settings.scheduling;
    for (const actor of ["advisor", "service-manager"] as const) {
      const open = slotOpensBook({ actor, day: friday, scheduling, userStoreId: "grand-coulee", activeStoreId: "grand-coulee" });
      assert.equal(open.ok, true, actor);
      const past = slotOpensBook({ actor, day: "2026-11-09", scheduling, userStoreId: "grand-coulee", activeStoreId: "grand-coulee" });
      assert.equal(past.ok, false);
      if (!past.ok) assert.match(past.error, /already past/);
      const sunday = slotOpensBook({ actor, day: "2026-11-15", scheduling, userStoreId: "grand-coulee", activeStoreId: "grand-coulee" });
      assert.equal(sunday.ok, false);
      if (!sunday.ok) assert.match(sunday.error, /closed/);
      const holiday = slotOpensBook({ actor, day: "2026-11-26", scheduling, userStoreId: "grand-coulee", activeStoreId: "grand-coulee" });
      assert.equal(holiday.ok, false);
      if (!holiday.ok) assert.match(holiday.error, /closed/);
      const other = slotOpensBook({ actor, day: friday, scheduling, userStoreId: "grand-coulee", activeStoreId: "pullman" });
      assert.equal(other.ok, false);
      if (!other.ok) assert.match(other.error, /own store/);
    }
  });
});

describe("round 26 copy follows the person", () => {
  it("drops the copied line during render when the person, role, or store changes", () => {
    const host = document.createElement("div");
    document.body.appendChild(host);
    const root = createRoot(host);
    try {
      flushSync(() => root.render(createElement(CopyHold, { workerKey: "grand-coulee|grand-coulee|megan|advisor", name: "Helen Cho" })));
      assert.match(host.textContent ?? "", /Copied Helen Cho/);
      flushSync(() => root.render(createElement(CopyHold, { workerKey: "grand-coulee|grand-coulee|megan|advisor", name: "Helen Cho" })));
      assert.match(host.textContent ?? "", /Copied Helen Cho/);
      flushSync(() => root.render(createElement(CopyHold, { workerKey: "grand-coulee|grand-coulee|derek|service-manager", name: "Helen Cho" })));
      assert.equal(host.querySelector("[data-copied]")?.textContent, "");
      flushSync(() => root.render(createElement(CopyHold, { workerKey: "grand-coulee|grand-coulee|derek|service-manager", name: "Jordan Hale" })));
      assert.match(host.textContent ?? "", /Copied Jordan Hale/);
      flushSync(() => root.render(createElement(CopyHold, { workerKey: "grand-coulee|grand-coulee|derek|advisor", name: "Jordan Hale" })));
      assert.equal(host.querySelector("[data-copied]")?.textContent, "");
      flushSync(() => root.render(createElement(CopyHold, { workerKey: "grand-coulee|grand-coulee|derek|advisor", name: "Helen Cho" })));
      assert.match(host.textContent ?? "", /Copied Helen Cho/);
      flushSync(() => root.render(createElement(CopyHold, { workerKey: "pullman|pullman|derek|advisor", name: "Helen Cho" })));
      assert.equal(host.querySelector("[data-copied]")?.textContent, "");
      const megan = shop("megan");
      const first = copyWorkerKey(megan.getState());
      assert.match(first, /\|megan\|advisor$/);
      megan.getState().setWorkingAs("derek");
      const asDerek = copyWorkerKey(megan.getState());
      assert.match(asDerek, /\|derek\|service-manager$/);
      assert.notEqual(asDerek, first);
      megan.getState().switchStore("pullman");
      assert.notEqual(copyWorkerKey(megan.getState()), asDerek);
    } finally {
      root.unmount();
      host.remove();
    }
  });
});

describe("round 26 copy bar stays under the header", () => {
  it("keeps the desk header the same height when the copied bar is up", async () => {
    const bare = await scheduleShellHtml();
    const copied = await copiedScheduleHtml();
    const css = await appCss(`${bare.page}${copied.html}`);
    const browser = await chromium.launch({ headless: true });
    const widths = [1280, 1024, 768, 390] as const;
    const measured: Record<string, { bare: number; withBar: number; barRemoved: number; bar: number }> = {};
    try {
      const page = await browser.newPage();
      for (const width of widths) {
        await page.setViewportSize({ width, height: 800 });
        await page.setContent(`<!doctype html><html><head><style>${css}</style></head><body style="margin:0">${bare.page}</body></html>`);
        const bareHeight = await page.evaluate(() => Math.round(document.querySelector("header.app-header")?.getBoundingClientRect().height ?? 0));
        await page.setContent(`<!doctype html><html><head><style>${css}</style></head><body style="margin:0">${copied.html}</body></html>`);
        await page.evaluate((style) => document.documentElement.setAttribute("style", style), copied.rootStyle);
        const row = await page.evaluate(() => {
          const header = document.querySelector("header.app-header");
          const bar = document.querySelector("[data-copy-bar]");
          const withBar = Math.round(header?.getBoundingClientRect().height ?? 0);
          const barHeight = Math.round(bar?.getBoundingClientRect().height ?? 0);
          bar?.remove();
          const barRemoved = Math.round(document.querySelector("header.app-header")?.getBoundingClientRect().height ?? 0);
          return { withBar, barRemoved, bar: barHeight };
        });
        measured[String(width)] = { bare: bareHeight, ...row };
        assert.ok(Math.abs(row.withBar - row.barRemoved) <= 2, `${width} header changed from ${row.barRemoved} to ${row.withBar} because of the copied bar`);
      }
    } finally {
      await browser.close();
    }
    console.log(`header-heights ${JSON.stringify(measured)}`);
  });

  it("keeps the copied line and a dismissible refusal below the desk header", async () => {
    const shell = await scheduleShellHtml();
    const header = shell.header;
    assert.ok(shell.page.indexOf("data-copy-anchor") !== -1 && shell.page.indexOf("data-copy-anchor") < shell.page.indexOf("data-desk-heading"));
    const bar = renderToStaticMarkup(createElement(CopyBar, {
      copiedName: "Helen Cho",
      notice: { kind: "error", text: "That time is outside shop hours." },
      onOverride: () => undefined,
      onReason: () => undefined,
      onDismiss: () => undefined,
    }));
    const board = renderToStaticMarkup(createElement(AppointmentCalendar, {
      appointments: [],
      day: friday,
      techs: [
        { id: "marcus", number: "1", name: "Marcus", board: "main" as const },
        { id: "elena", number: "2", name: "Elena", board: "express" as const },
      ],
      selectedId: null,
      onSelect: () => undefined,
      onSlot: () => undefined,
      onMove: () => undefined,
      onWrite: () => undefined,
      onEdit: () => undefined,
      label: () => "",
      summary: () => ({ name: "", vehicle: "", advisor: "", tech: "", when: "", lane: "", concern: "", vin: "", ops: "", status: "", canWrite: false }),
      hoursFor: () => 0,
    }));
    assert.ok(header.includes("Working as"));
    assert.ok(header.includes("Viewing as"));
    assert.ok(header.includes("Settings"));
    assert.ok(bar.includes("data-dismiss"));
    const html = `<div class="min-h-screen bg-bg text-ink"><div class="md:pl-60">${header}<main class="mx-auto w-full max-w-6xl px-4 py-5"><div data-copy-anchor>${bar}<div data-desk-heading class="flex flex-wrap gap-3" style="min-height:28rem"><h1 class="font-display text-5xl">Today</h1><div class="desk-actions flex flex-wrap gap-2"><button class="btn min-h-11" type="button">Book appointment</button></div></div>${board}</div></main></div></div>`;
    const css = await appCss(`${header}${bar}${board}${html}`);
    const browser = await chromium.launch({ headless: true });
    try {
      const page = await browser.newPage();
      await page.setContent(`<!doctype html><html><head><style>${css}</style></head><body style="margin:0">${html}</body></html>`);
      for (const [width, height] of [[1400, 700], [820, 700], [390, 700]] as const) {
        await page.setViewportSize({ width, height });
        await page.evaluate(() => window.scrollTo(0, 0));
        await pinHeader(page);
        const before = await measure(page);
        assert.ok(before.header && before.bar && before.copied && before.notice && before.dismiss && before.working && before.viewing && before.settings, `${width} missing header or bar`);
        assert.ok(before.bar.top >= before.header.bottom - 1, `${width} bar starts below the header`);
        assert.ok(before.copied.top >= before.header.bottom - 1 && before.notice.top >= before.header.bottom - 1, `${width} copy text stays below the header`);
        assert.ok(before.working.bottom <= before.header.bottom + 1 && before.viewing.bottom <= before.header.bottom + 1 && before.settings.bottom <= before.header.bottom + 1, `${width} header controls stay in the header`);
        assert.equal(before.scrollY, 0, `${width} starts at the top`);
        assert.ok(before.bar.top >= 0 && before.bar.bottom <= height, `${width} the whole bar is inside the viewport`);
        assert.ok(before.copied.top >= 0 && before.copied.bottom <= height && before.notice.top >= 0 && before.notice.bottom <= height && before.dismiss.top >= 0 && before.dismiss.bottom <= height, `${width} refusal stays on screen`);
        assert.ok(before.padTop >= 8, `${width} bar is padded`);
        assert.equal(before.opaque, true, `${width} bar is opaque`);
        assert.equal(before.coversHeader, false, `${width} bar covers a header control`);
        await page.evaluate(() => {
          const afternoon = [...document.querySelectorAll("p")].find((node) => node.textContent === "5 PM");
          afternoon?.scrollIntoView({ block: "center" });
        });
        await pinHeader(page);
        const after = await measure(page);
        assert.ok(after.afternoon, `${width} afternoon label`);
        assert.ok(after.scrollY > 80, `${width} scrolled the afternoon`);
        assert.ok(after.header && after.header.top >= -1 && after.header.top < 8, `${width} header stays pinned`);
        assert.ok(after.bar && after.bar.top >= after.header.bottom - 1, `${width} bar stays below the header`);
        assert.ok(after.copied && after.notice && after.dismiss, `${width} copy bar stayed mounted`);
        assert.ok(after.copied.top >= after.header.bottom - 1 && after.copied.bottom <= height, `${width} copied line stays visible`);
        assert.ok(after.notice.top >= after.header.bottom - 1 && after.notice.bottom <= height, `${width} refusal stays visible`);
        assert.ok(after.dismiss.top >= after.header.bottom - 1 && after.dismiss.bottom <= height, `${width} dismiss stays visible`);
        assert.equal(after.coversHeader, false, `${width} scrolled bar covers a header control`);
        assert.ok(after.afternoon.bottom <= height, `${width} afternoon is in view`);
      }
    } finally {
      await browser.close();
    }
  });

  it("keeps a past-close reason form under the header with the copied line visible", async () => {
    const header = (await scheduleShellHtml()).header;
    const bar = renderToStaticMarkup(createElement(CopyBar, {
      copiedName: "Helen Cho",
      notice: { kind: "close", techId: "elena", time: "17:00", reason: "", text: "Friday 5:00 PM for 180 minutes runs past close." },
      onOverride: () => undefined,
      onReason: () => undefined,
      onDismiss: () => undefined,
    }));
    const board = renderToStaticMarkup(createElement(AppointmentCalendar, {
      appointments: [],
      day: friday,
      techs: [
        { id: "marcus", number: "1", name: "Marcus", board: "main" as const },
        { id: "elena", number: "2", name: "Elena", board: "express" as const },
      ],
      selectedId: null,
      onSelect: () => undefined,
      onSlot: () => undefined,
      onMove: () => undefined,
      onWrite: () => undefined,
      onEdit: () => undefined,
      label: () => "",
      summary: () => ({ name: "", vehicle: "", advisor: "", tech: "", when: "", lane: "", concern: "", vin: "", ops: "", status: "", canWrite: false }),
      hoursFor: () => 0,
    }));
    const html = `<div class="min-h-screen bg-bg text-ink"><div class="md:pl-60">${header}<main class="mx-auto w-full max-w-6xl px-4 py-5"><div data-copy-anchor class="contents" style="display:contents">${bar}<div data-desk-heading class="flex flex-wrap gap-3" style="min-height:12rem"><h1 class="font-display text-5xl">Friday</h1></div>${board}</div><footer class="pb-8 text-xs text-muted"><p>This visit is the sample month. Grand Coulee and Pullman are separate stores, and this footer sits under the board on a phone.</p></footer><div data-sticky-tail style="height:calc(100vh - var(--app-header-height, 0px))"></div></main></div></div>`;
    const css = await appCss(`${header}${bar}${board}${html}`);
    const browser = await chromium.launch({ headless: true });
    try {
      const page = await browser.newPage();
      await page.setContent(`<!doctype html><html><head><style>${css}</style></head><body style="margin:0">${html}</body></html>`);
      for (const [width, height] of [[1400, 700], [820, 700], [390, 700]] as const) {
        await page.setViewportSize({ width, height });
        await pinHeader(page);
        const maxScroll = await page.evaluate(() => Math.max(0, document.documentElement.scrollHeight - window.innerHeight));
        for (const depth of [0, 240, 480, 800, maxScroll]) {
          await page.evaluate((top) => window.scrollTo(0, top), depth);
          await pinHeader(page);
          const pinned = await measure(page);
          assert.ok(pinned.header && pinned.bar && pinned.copied, `${width} missing the pinned bar at ${depth}`);
          const slack = depth === 0 ? 24 : 1;
          assert.ok(pinned.bar.top >= pinned.header.bottom - 1 && pinned.bar.top <= pinned.header.bottom + slack, `${width} bar left the header at scroll ${depth} (top ${pinned.bar.top}, header ${pinned.header.bottom}, scroll ${pinned.scrollY})`);
          assert.ok(pinned.copied.top >= pinned.header.bottom - 1 && pinned.copied.bottom <= height, `${width} copied line left the screen at scroll ${depth}`);
          assert.equal(pinned.coversHeader, false, `${width} bar covers the header at scroll ${depth}`);
          if (depth === 0) {
            assert.equal(pinned.scrollY, 0);
            assert.ok(pinned.bar.bottom <= height, `${width} the whole bar is inside the viewport at scroll 0`);
          }
        }
        await page.evaluate(() => {
          const afternoon = [...document.querySelectorAll("p")].find((node) => node.textContent === "5 PM");
          afternoon?.scrollIntoView({ block: "center" });
        });
        await pinHeader(page);
        const laid = await page.evaluate(() => {
          const scroller = document.querySelector("[data-copy-scroll]");
          if (scroller instanceof HTMLElement) scroller.scrollTop = scroller.scrollHeight;
          const box = (selector: string) => {
            const node = document.querySelector(selector);
            if (!node) return null;
            const rect = node.getBoundingClientRect();
            return { top: rect.top, bottom: rect.bottom };
          };
          const leave = [...document.querySelectorAll("button")].find((button) => button.textContent === "Leave it");
          const leaveRect = leave?.getBoundingClientRect();
          const copied = document.querySelector("[data-copied]");
          return {
            header: box("header.app-header"),
            bar: box("[data-copy-bar]"),
            copied: box("[data-copied]"),
            reason: box("[aria-label='Reason for running past close']"),
            paste: box("[data-paste-notice] button[type='submit']"),
            leave: leaveRect ? { top: leaveRect.top, bottom: leaveRect.bottom } : null,
            copiedOutsideScroll: copied ? !copied.closest("[data-copy-scroll]") : false,
            formScroll: scroller instanceof HTMLElement ? scroller.scrollHeight - scroller.clientHeight : 0,
          };
        });
        if (width === 390 && laid.formScroll <= 20) {
          assert.ok(laid.reason && laid.paste && laid.leave, "390 reason form is on screen without an inner scroll");
        }
        assert.ok(laid.header && laid.bar && laid.copied && laid.reason && laid.paste && laid.leave, `${width} missing the reason form`);
        assert.ok(laid.bar.top >= laid.header.bottom - 1, `${width} form rides over the header`);
        assert.ok(laid.copied.top >= laid.header.bottom - 1 && laid.copied.bottom <= height, `${width} copied line stays visible`);
        assert.equal(laid.copiedOutsideScroll, true, `${width} copied line scrolls away with the form`);
        for (const [name, rect] of [["reason", laid.reason], ["paste", laid.paste], ["leave", laid.leave]] as const) {
          assert.ok(rect.top >= laid.header.bottom - 1 && rect.bottom <= height + 1, `${width} ${name} is not reachable`);
        }
      }
    } finally {
      await browser.close();
    }
  });

  it("keeps the copied bar off the top card at phone, tablet, and desktop", async () => {
    const rendered = await copiedScheduleHtml();
    const pageHtml = rendered.html;
    const css = await appCss(pageHtml);
    const browser = await chromium.launch({ headless: true });
    try {
      const page = await browser.newPage();
      await page.setContent(`<!doctype html><html><head><style>${css}</style></head><body style="margin:0">${pageHtml}</body></html>`);
      await page.evaluate((style) => {
        document.documentElement.setAttribute("style", style);
      }, rendered.rootStyle);
      const headerBottom = { 1400: 69, 820: 169, 390: 297 } as const;
      for (const [width, height] of [[1400, 700], [820, 700], [390, 700]] as const) {
        await page.setViewportSize({ width, height });
        await pinHeader(page);
        const padding = await page.evaluate(() => ({
          bar: document.documentElement.style.getPropertyValue("--copy-bar-height").trim(),
          padding: document.documentElement.style.scrollPaddingTop.trim(),
        }));
        assert.notEqual(padding.bar, "", `${width} the rendered app has no --copy-bar-height`);
        assert.notEqual(padding.padding, "", `${width} the rendered app has no scroll-padding-top`);
        assert.notEqual(padding.bar, "0px", `${width} the rendered app left the copied bar height at 0`);
        assert.equal(await page.locator("[data-board-scroll]").count(), 0, `${width} the board has its own scroller`);
        const friday = await page.evaluate(() => {
          const label = [...document.querySelectorAll("p")].find((node) => node.textContent === "5 PM");
          const column = document.querySelector("[data-tech]");
          if (!label || !column) return null;
          const top = label.getBoundingClientRect().top + window.scrollY + 32;
          return { top, scrollers: [...column.querySelectorAll("*"), column].some((node) => node instanceof HTMLElement && node.scrollTop > 0) };
        });
        assert.ok(friday, `${width} missing Friday 5:00 PM`);
        await page.evaluate((top) => window.scrollTo({ top: Math.max(0, top - 220), left: 0, behavior: "instant" }), friday.top);
        await page.waitForFunction((top) => Math.abs(window.scrollY - Math.max(0, top - 220)) < 1, friday.top);
        await page.evaluate(() => new Promise<void>((resolve) => {
          requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
        }));
        const reached = await page.evaluate((top) => {
          const y = top - window.scrollY;
          const column = document.querySelector("[data-tech]");
          const clipped = column ? [...column.parentElement ? [column.parentElement] : [], column].some((node) => {
            if (!(node instanceof HTMLElement)) return false;
            const style = getComputedStyle(node);
            return (style.overflowY === "auto" || style.overflowY === "scroll") && node.scrollTop === 0 && node.clientHeight + 8 < node.scrollHeight && y > node.getBoundingClientRect().bottom;
          }) : true;
          return { y, scrollY: window.scrollY, inView: y > 0 && y < window.innerHeight, clipped, boardScroll: Boolean(document.querySelector("[data-board-scroll]")) };
        }, friday.top);
        assert.ok(reached.scrollY > 40, `${width} Friday 5:30 PM did not move the window`);
        assert.equal(reached.inView, true, `${width} Friday 5:30 PM is not in the window (y ${reached.y})`);
        assert.equal(reached.clipped, false, `${width} Friday 5:30 PM is inside a board scroller`);
        assert.equal(reached.boardScroll, false, `${width} the board scroller is back`);
        await page.evaluate(() => window.scrollTo({ top: 0, left: 0, behavior: "instant" }));
        await page.waitForFunction(() => window.scrollY < 1);
        await page.evaluate(() => new Promise<void>((resolve) => {
          requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
        }));
        const atTop = await page.evaluate(() => {
          const card = document.querySelector("[data-appt]");
          const barNode = document.querySelector("[data-copy-bar]");
          if (!card || !barNode) return null;
          const cardBox = card.getBoundingClientRect();
          const barBox = barNode.getBoundingClientRect();
          return { intersects: cardBox.left < barBox.right && cardBox.right > barBox.left && cardBox.top < barBox.bottom && cardBox.bottom > barBox.top };
        });
        assert.ok(atTop, `${width} missing the top card at scroll 0`);
        assert.equal(atTop.intersects, false, `${width} the top card is under the copied bar at scroll 0`);
        const rested = await page.evaluate(() => {
          const card = document.querySelector("[data-appt]");
          card?.scrollIntoView({ block: "start", behavior: "instant" });
          return window.scrollY;
        });
        await page.waitForFunction((top) => Math.abs(window.scrollY - top) < 2, rested);
        await page.evaluate(() => new Promise<void>((resolve) => {
          requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
        }));
        const clear = await page.evaluate(() => {
          const card = document.querySelector("[data-appt]");
          const barNode = document.querySelector("[data-copy-bar]");
          if (!card || !barNode) return null;
          const cardBox = card.getBoundingClientRect();
          const barBox = barNode.getBoundingClientRect();
          const intersects = cardBox.left < barBox.right && cardBox.right > barBox.left && cardBox.top < barBox.bottom && cardBox.bottom > barBox.top;
          return { intersects, scrollY: window.scrollY };
        });
        assert.ok(clear, `${width} missing the top card at rest`);
        assert.equal(clear.intersects, false, `${width} the top card rests under the copied bar`);
        const maxScroll = await page.evaluate(() => Math.max(0, document.documentElement.scrollHeight - window.innerHeight));
        await page.evaluate((top) => window.scrollTo({ top, left: 0, behavior: "instant" }), maxScroll);
        await page.waitForFunction((top) => Math.abs(window.scrollY - top) < 1, maxScroll);
        await page.evaluate(() => new Promise<void>((resolve) => {
          requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
        }));
        const bottom = await page.evaluate(() => {
          const barNode = document.querySelector("[data-copy-bar]");
          const headerNode = document.querySelector("header.app-header");
          if (!barNode || !headerNode) return null;
          const barBox = barNode.getBoundingClientRect();
          const headerBox = headerNode.getBoundingClientRect();
          const cards = [...document.querySelectorAll("[data-appt]")].map((card) => {
            const box = card.getBoundingClientRect();
            return box.left < barBox.right && box.right > barBox.left && box.top < barBox.bottom && box.bottom > barBox.top;
          });
          return { barTop: barBox.top, headerBottom: headerBox.bottom, covered: cards.some(Boolean), scrollY: window.scrollY };
        });
        assert.ok(bottom, `${width} missing the bar at max scroll`);
        assert.equal(bottom.covered, false, `${width} a card sits under the copied bar at max scroll`);
        assert.ok(Math.abs(bottom.barTop - bottom.headerBottom) <= 1, `${width} bar left the header at max scroll (top ${bottom.barTop}, header ${bottom.headerBottom})`);
        assert.ok(Math.abs(bottom.headerBottom - headerBottom[width]) <= 1, `${width} header bottom ${bottom.headerBottom} is not ${headerBottom[width]}`);
      }
    } finally {
      await browser.close();
    }
  });

  it("a press on the copied bar opens nothing and leaves the appointments", async () => {
    const pageHtml = (await copiedScheduleHtml()).html;
    const css = await appCss(pageHtml);
    const browser = await chromium.launch({ headless: true });
    try {
      const page = await browser.newPage();
      await page.setContent(`<!doctype html><html><head><style>${css}</style></head><body style="margin:0">${pageHtml}</body></html>`);
      await page.evaluate(() => {
        const hits: string[] = [];
        (window as unknown as { __hits: string[] }).__hits = hits;
        const note = (kind: string) => (event: Event) => {
          const node = event.target;
          if (!(node instanceof Element)) return;
          if (node.closest("[data-copy-bar]")) return;
          hits.push(kind);
        };
        document.addEventListener("pointerdown", note("down"), true);
        document.addEventListener("pointerup", note("up"), true);
        document.addEventListener("click", note("click"), true);
        document.addEventListener("contextmenu", note("menu"), true);
        document.querySelector("[data-dismiss]")?.addEventListener("click", () => {
          document.querySelector("[data-paste-notice]")?.remove();
        });
      });
      for (const [width, height] of [[390, 700], [820, 700], [1400, 700]] as const) {
        await page.setViewportSize({ width, height });
        await pinHeader(page);
        await page.evaluate(() => { (window as unknown as { __hits: string[] }).__hits = []; });
        const before = await page.locator("[data-appt]").count();
        const point = await page.evaluate((narrow) => {
          const barNode = document.querySelector("[data-copy-bar]");
          const text = document.querySelector("[data-copied]");
          if (!barNode || !text) return null;
          const barBox = barNode.getBoundingClientRect();
          const textBox = text.getBoundingClientRect();
          const overlapTop = Math.max(barBox.top + 2, 297);
          const overlapBottom = Math.min(barBox.bottom - 2, 374);
          let y = narrow && overlapBottom > overlapTop ? (overlapTop + overlapBottom) / 2 : textBox.top + Math.min(6, textBox.height / 2);
          const x = Math.min(Math.max(textBox.left + 12, barBox.left + 8), barBox.right - 8);
          const hit = document.elementFromPoint(x, y);
          if (hit?.closest("button, input, textarea, a")) y = textBox.top + Math.min(6, textBox.height / 2);
          return { x, y, barTop: barBox.top, barBottom: barBox.bottom };
        }, width === 390);
        assert.ok(point, `${width} missing the copied bar`);
        assert.ok(point.y > point.barTop && point.y < point.barBottom, `${width} press missed the bar`);
        if (width === 390) assert.ok(point.y > 297 && point.y < 374, `${width} press y ${point.y} is outside 297-374 (bar ${point.barTop}-${point.barBottom})`);
        const press = async (button?: "left" | "right", hold = false) => {
          await page.mouse.move(point.x, point.y);
          await page.mouse.down({ button });
          if (hold) {
            await page.evaluate(() => new Promise<void>((resolve) => {
              requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
            }));
          }
          await page.mouse.up({ button });
        };
        await press();
        await page.mouse.click(point.x, point.y);
        await press(undefined, true);
        await page.mouse.click(point.x, point.y, { button: "right" });
        const hits = await page.evaluate(() => (window as unknown as { __hits: string[] }).__hits);
        assert.deepEqual(hits, [], `${width} a press on the bar reached the board`);
        assert.equal(await page.locator("[data-appt]").count(), before, `${width} the bar press changed the appointments`);
        assert.equal(await page.locator("[data-context-menu]").count(), 0, `${width} the bar opened a menu`);
        assert.equal(await page.locator("[data-paste]").count(), 0, `${width} the bar opened Paste`);
      }
      await page.locator("[data-dismiss]").click();
      assert.equal(await page.locator("[data-paste-notice]").count(), 0, "Dismiss still closes the notice");
      assert.equal(await page.locator("[data-copied]").count(), 1, "Dismiss leaves the copied line");
    } finally {
      await browser.close();
    }
  });
});


async function copiedScheduleHtml() {
  pinClock("2026-11-13T20:00:00.000Z");
  const data = createSeed();
  useShop.setState({
    ...data,
    dataset: "sample",
    focusOrderId: null,
    activeStoreId: "grand-coulee",
    userStoreId: "grand-coulee",
    workingAsId: "megan",
    stores: {
      "grand-coulee": { ...data, dataset: "sample" },
      pullman: createEmptyShop(),
    },
  });
  const router = createRouter({
    routeTree,
    history: createMemoryHistory({ initialEntries: ["/schedule"] }),
    rewrite: deskLocationRewrite(),
    caseSensitive: false,
    trailingSlash: "never",
    defaultErrorComponent: AppErrorComponent,
  });
  await router.load();
  (router as { _rendered?: unknown[] })._rendered = [];
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  const realRect = HTMLElement.prototype.getBoundingClientRect;
  HTMLElement.prototype.getBoundingClientRect = function () {
    if (this instanceof HTMLElement && this.hasAttribute("data-copy-bar")) {
      const height = 200;
      return { x: 0, y: 0, top: 0, left: 0, right: 800, bottom: height, width: 800, height, toJSON() { return {}; } };
    }
    return realRect.call(this);
  };
  try {
    flushSync(() => {
      root.render(createElement(RouterProvider, { router }));
    });
    for (let i = 0; i < 25 && !host.querySelector("[data-appt]"); i += 1) {
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    const working = host.querySelector<HTMLSelectElement>("[aria-label='Working as']");
    assert.ok(working, "the schedule page has no Working as control");
    flushSync(() => {
      working.value = "megan";
      working.dispatchEvent(new Event("change", { bubbles: true }));
    });
    const card = host.querySelector<HTMLElement>("[data-appt]");
    assert.ok(card, "Friday has no appointment to copy");
    flushSync(() => card.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true, clientX: 24, clientY: 24 })));
    const copy = host.querySelector<HTMLButtonElement>("[data-copy]");
    assert.ok(copy, "the real schedule did not open Copy");
    flushSync(() => copy.click());
    assert.ok(host.querySelector("[data-copied]"), "CopyBarFrame did not render the copied line");
    const column = host.querySelector<HTMLElement>("[data-tech]");
    assert.ok(column);
    column.getBoundingClientRect = () => ({ top: 0, left: 0, right: 160, bottom: 900, width: 160, height: 900, x: 0, y: 0, toJSON() { return {}; } });
    flushSync(() => column.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true, button: 2, clientX: 12, clientY: 0 })));
    assert.ok(host.querySelector("[data-copy-bar]"), "the real schedule did not render the copied bar");
    assert.ok(host.querySelector("[data-dismiss]"), "the real schedule did not render Dismiss");
    assert.equal(host.querySelector("[data-board-scroll]"), null, "the board still has an inner scroller");
    const copyBarHeight = document.documentElement.style.getPropertyValue("--copy-bar-height").trim();
    const scrollPaddingTop = document.documentElement.style.scrollPaddingTop.trim();
    assert.notEqual(copyBarHeight, "", "CopyBarFrame did not set --copy-bar-height while the route was mounted");
    assert.notEqual(copyBarHeight, "0px", "CopyBarFrame measured the copied bar as 0px");
    assert.notEqual(scrollPaddingTop, "", "CopyBarFrame did not set scroll-padding-top while the route was mounted");
    return { html: host.innerHTML, rootStyle: document.documentElement.getAttribute("style") ?? "" };
  } finally {
    HTMLElement.prototype.getBoundingClientRect = realRect;
    flushSync(() => root.unmount());
    host.remove();
    useShop.setState({ ...createEmptyShop(), focusOrderId: null, dataset: "sample" });
  }
}

async function scheduleShellHtml() {
  useShop.setState({
    ...createSeed(),
    dataset: "sample",
    focusOrderId: null,
    activeStoreId: "grand-coulee",
    userStoreId: "grand-coulee",
    stores: {
      "grand-coulee": { ...createSeed(), dataset: "sample" },
      pullman: createEmptyShop(),
    },
  });
  const router = createRouter({
    routeTree,
    history: createMemoryHistory({ initialEntries: ["/schedule"] }),
    rewrite: deskLocationRewrite(),
    caseSensitive: false,
    trailingSlash: "never",
    defaultErrorComponent: AppErrorComponent,
  });
  await router.load();
  (router as { _rendered?: unknown[] })._rendered = [];
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  try {
    flushSync(() => {
      root.render(createElement(RouterProvider, { router }));
    });
    for (let i = 0; i < 25 && !host.querySelector("header.app-header"); i += 1) {
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    const header = host.querySelector("header.app-header");
    const anchor = host.querySelector("[data-copy-anchor]");
    assert.ok(header, "the schedule page rendered the desk header");
    assert.ok(anchor?.querySelector("[data-desk-heading]"), "the sticky container does not span the day heading");
    assert.ok(anchor?.querySelector("[data-tech]"), "the sticky container does not span the board");
    assert.ok(host.querySelector("main [data-sticky-tail]"), "the schedule page has no room under the board for the sticky bar");
    return { header: header.outerHTML, page: host.innerHTML };
  } finally {
    flushSync(() => root.unmount());
    host.remove();
    useShop.setState({ ...createEmptyShop(), focusOrderId: null, dataset: "sample" });
  }
}

async function pinHeader(page: Page) {
  await page.evaluate(() => {
    const header = document.querySelector("header.app-header");
    if (!header) return;
    document.documentElement.style.setProperty("--app-header-height", `${Math.ceil(header.getBoundingClientRect().height)}px`);
  });
}

async function measure(page: Page) {
  return page.evaluate(() => {
    const box = (selector: string) => {
      const node = document.querySelector(selector);
      if (!node) return null;
      const rect = node.getBoundingClientRect();
      return { top: rect.top, bottom: rect.bottom, left: rect.left, right: rect.right };
    };
    const afternoon = [...document.querySelectorAll("p")].find((node) => node.textContent === "5 PM");
    const rect = afternoon?.getBoundingClientRect();
    const barNode = document.querySelector("[data-copy-bar]");
    const barStyle = barNode ? getComputedStyle(barNode) : null;
    const paint = barStyle?.backgroundColor ?? "";
    const channels = paint.match(/[\d.]+/g)?.map(Number) ?? [];
    const opaque = channels.length === 3 || (channels.length === 4 && channels[3] === 1);
    const covers = (selector: string) => {
      const node = document.querySelector(selector);
      if (!node) return true;
      const rect = node.getBoundingClientRect();
      const hit = document.elementFromPoint(rect.left + Math.min(12, rect.width / 2), rect.top + Math.min(8, rect.height / 2));
      return Boolean(hit?.closest("[data-copy-bar]"));
    };
    return {
      header: box("header.app-header"),
      bar: box("[data-copy-bar]"),
      copied: box("[data-copied]"),
      notice: box("[data-paste-notice]"),
      dismiss: box("[data-dismiss]"),
      working: box("[aria-label='Working as']"),
      viewing: box("[aria-label='Viewing as']"),
      settings: box("[aria-label='Store settings']"),
      afternoon: rect ? { top: rect.top, bottom: rect.bottom } : null,
      scrollY: window.scrollY,
      padTop: barStyle ? Number.parseFloat(barStyle.paddingTop) : 0,
      opaque,
      coversHeader: covers("[aria-label='Working as']") || covers("[aria-label='Viewing as']") || covers("[aria-label='Store settings']"),
    };
  });
}

describe("round 26 live scroll anchoring", () => {
  it("keeps Friday Paste open after the notice shrinks, and a real scroll or a 6 px nudge still closes it", async () => {
    const root = new URL("../..", import.meta.url).pathname;
    const port = await new Promise<number>((resolve, reject) => {
      const probe = createServer();
      probe.once("error", reject);
      probe.listen(0, "127.0.0.1", () => {
        const address = probe.address();
        const chosen = typeof address === "object" && address ? address.port : 0;
        probe.close(() => resolve(chosen));
      });
    });
    const fixedClock = "2026-11-16T20:00:00.000Z";
    const server = spawn(process.execPath, ["scripts/with-app-env.mjs", "vite", "dev", "--host", "127.0.0.1", "--port", String(port), "--strictPort"], {
      cwd: root,
      env: { ...process.env, VITE_DEMO_MODE: "true", JF_PIN_CLOCK: fixedClock, PATH: `${root}/node_modules/.bin:${process.env.PATH ?? ""}` },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let serverLog = "";
    server.stdout?.on("data", (chunk) => { serverLog += String(chunk); });
    server.stderr?.on("data", (chunk) => { serverLog += String(chunk); });
    const browser = await chromium.launch({ headless: true });
    try {
      const listening = await Promise.race([
        waitForPort(port).then(() => true),
        new Promise<boolean>((resolve) => server.once("exit", () => resolve(false))),
      ]);
      assert.ok(listening, `the schedule server stopped\n${serverLog.slice(-800)}`);
      const page = await browser.newPage();
      await page.clock.install({ time: new Date(fixedClock) });
      await page.goto(`http://127.0.0.1:${port}/schedule`, { waitUntil: "domcontentloaded" });
      assert.ok(await waitForSelector(page, "[data-tech]", 20000), "the board did not load");
      assert.ok(await waitForSelector(page, "[data-appt]", 20000), "no visit to copy");
      await page.locator("[aria-label='Working as']").selectOption("megan");
      await page.locator("[data-appt]").first().click({ button: "right" });
      const copyCenter = await page.evaluate(() => {
        const button = document.querySelector("[data-copy]");
        const rect = button?.getBoundingClientRect();
        if (!rect) return { open: false, offset: -1, center: 0, height: window.innerHeight };
        const y = rect.top + rect.height / 2;
        const x = rect.left + rect.width / 2;
        let offset = -1;
        for (const node of document.elementsFromPoint(x, y)) {
          if (!(node instanceof Element) || node.closest("[data-context-menu]")) continue;
          const column = node.closest("[data-tech]");
          if (!column) continue;
          const rel = y - column.getBoundingClientRect().top;
          offset = rel - Math.floor(rel / 32) * 32;
          break;
        }
        return { open: true, offset, center: y, height: window.innerHeight };
      });
      assert.equal(copyCenter.open, true, "Copy did not open");
      assert.ok(copyCenter.center > 0 && copyCenter.center < copyCenter.height, `Copy center is off the screen at ${copyCenter.center}`);
      assert.ok(copyCenter.offset >= 10 && copyCenter.offset <= 22, `Copy center is ${copyCenter.offset}px into the row`);
      await page.locator("[data-copy]").click();
      assert.ok(await waitForSelector(page, "[data-copied]"), "the copied line did not appear");
      for (let step = 0; step < 6 && !/\bFri\b/.test(await page.locator("[data-desk-heading] h1").innerText()); step += 1) {
        await page.getByRole("button", { name: "Next", exact: true }).click();
      }
      assert.match(await page.locator("[data-desk-heading] h1").innerText(), /\bFri\b/);
      const outside = await page.evaluate(() => {
        const columns = [...document.querySelectorAll<HTMLElement>("[data-tech]")];
        for (const column of columns) {
          const top = column.getBoundingClientRect().top + window.scrollY + 21 * 32 + 16;
          return { top };
        }
        return null;
      });
      assert.ok(outside, "no technician column");
      await page.evaluate((top) => window.scrollTo({ top: Math.max(0, top - 280), left: 0, behavior: "instant" }), outside.top);
      const outsidePoint = await page.evaluate(() => {
        const columns = [...document.querySelectorAll<HTMLElement>("[data-tech]")];
        for (const column of columns) {
          const rect = column.getBoundingClientRect();
          const y = rect.top + 21 * 32 + 16;
          const x = rect.left + Math.min(36, rect.width / 2);
          if (y < 80 || y > window.innerHeight - 20) continue;
          const hit = document.elementFromPoint(x, y);
          if (hit?.closest("[data-appt], [data-copy-bar], header")) continue;
          return { x, y };
        }
        return null;
      });
      assert.ok(outsidePoint, "17:30 is not an empty slot in view");
      await page.mouse.click(outsidePoint.x, outsidePoint.y, { button: "right" });
      const noticed = await waitForSelector(page, "[data-paste-notice]");
      if (!noticed) {
        const debug = await page.evaluate((point) => {
          const hit = document.elementFromPoint(point.x, point.y);
          return {
            point,
            hit: hit ? `${hit.tagName}.${String(hit.className).slice(0, 80)}` : "none",
            menu: document.querySelector("[data-context-menu]")?.textContent ?? "",
            bar: document.querySelector("[data-copy-bar]")?.textContent?.slice(0, 180) ?? "",
            heading: document.querySelector("[data-desk-heading] h1")?.textContent ?? "",
          };
        }, outsidePoint);
        assert.fail(`17:30 did not raise the notice ${JSON.stringify(debug)}`);
      }
      assert.match(await page.locator("[data-paste-notice]").innerText(), /outside shop hours/);
      if ((await page.evaluate(() => window.scrollY)) < 40) {
        await page.evaluate(() => window.scrollBy(0, 220));
      }
      assert.ok(await page.evaluate(() => window.scrollY > 0), "the page is still at the top");

      for (const width of [360, 390, 820, 1400]) {
        await page.setViewportSize({ width, height: 800 });
        await raiseOutsideNotice(page);
        await page.clock.fastForward(50);
        const before = await page.locator("[data-appt]").count();
        let spot: { x: number; y: number; time: string; scrollY: number } | null = null;
        for (let attempt = 0; attempt < 4 && !spot; attempt += 1) {
          await page.evaluate(() => {
            const column = document.querySelector("[data-tech]");
            if (!column) return;
            const bar = document.querySelector("[data-copy-bar]")?.getBoundingClientRect().bottom ?? 300;
            const target = column.getBoundingClientRect().top + window.scrollY + 8 * 32 + 16;
            window.scrollTo({ top: Math.max(40, target - (bar + 180)), left: 0, behavior: "instant" });
          });
          spot = await pressInHours(page);
        }
        assert.ok(spot, `${width} has no in-hours slot in view`);
        assert.ok(spot.scrollY > 0, `${width} scrolled to the top`);
        // Step the clock so the notice-clear settle timer runs during this hold.
        for (let step = 0; step < 20; step += 1) await page.clock.fastForward(100);
        const held = await page.evaluate(() => ({
          scrollY: window.scrollY,
          paste: document.querySelectorAll("[data-paste]").length,
          time: document.querySelector("[data-context-menu]")?.getAttribute("data-menu-time") ?? "",
          count: document.querySelectorAll("[data-appt]").length,
        }));
        await releaseHold(page, spot);
        assert.equal(held.paste, 1, `${width} Paste did not stay open ${JSON.stringify({ spot, held })}`);
        assert.ok(Math.abs(held.scrollY - spot.scrollY) <= 8, `${width} scroll jumped ${held.scrollY - spot.scrollY} ${JSON.stringify(held)}`);
        assert.equal(held.time, spot.time, `${width} Paste used ${held.time} instead of ${spot.time}`);
        assert.equal(held.count, before, `${width} the hold wrote a visit`);
        await page.keyboard.press("Escape");
      }

      await page.setViewportSize({ width: 1400, height: 800 });
      await raiseOutsideNotice(page);
      await page.evaluate(() => {
        const column = document.querySelector("[data-tech]");
        if (!column) return;
        const bar = document.querySelector("[data-copy-bar]")?.getBoundingClientRect().bottom ?? 300;
        const target = column.getBoundingClientRect().top + window.scrollY + 8 * 32 + 16;
        window.scrollTo({ top: Math.max(40, target - (bar + 140)), left: 0, behavior: "instant" });
      });
      const blocked = await pressInHours(page);
      assert.ok(blocked, "no slot for the real-scroll check");
      const beforeScroll = await page.locator("[data-appt]").count();
      await page.clock.fastForward(200);
      await page.evaluate(() => {
        window.scrollBy(0, 240);
        // The page clock holds the scroll event until the next frame.
        document.dispatchEvent(new Event("scroll"));
      });
      await page.clock.fastForward(1600);
      const disarmed = await page.evaluate(() => ({
        paste: document.querySelectorAll("[data-paste]").length,
        count: document.querySelectorAll("[data-appt]").length,
      }));
      await releaseHold(page, blocked);
      assert.equal(disarmed.paste, 0, "a real scroll left Paste open");
      assert.equal(disarmed.count, beforeScroll, "a real scroll wrote a visit");

      const line = await page.evaluate(() => {
        const scroller = document.querySelector<HTMLElement>(".overflow-x-auto");
        if (scroller) scroller.scrollLeft = 0;
        const column = document.querySelector<HTMLElement>("[data-tech]");
        if (!column) return null;
        const bar = document.querySelector("[data-copy-bar]")?.getBoundingClientRect().bottom ?? 200;
        const absolute = column.getBoundingClientRect().top + window.scrollY + 11 * 32 - 3;
        window.scrollTo({ top: Math.max(40, absolute - (bar + 36)), left: 0, behavior: "instant" });
        const next = column.getBoundingClientRect();
        const y = next.top + 11 * 32 - 3;
        const x = Math.min(window.innerWidth - 12, Math.max(12, next.left + 24));
        const hit = document.elementFromPoint(x, y);
        const onColumn = Boolean(hit?.closest("[data-tech]")) && !hit?.closest("[data-appt], [data-copy-bar], header");
        if (onColumn && hit) {
          hit.dispatchEvent(new PointerEvent("pointerdown", {
            bubbles: true, cancelable: true, clientX: x, clientY: y,
            button: 0, buttons: 1, pointerId: 7, pointerType: "mouse", isPrimary: true,
          }));
        }
        return {
          x,
          y,
          scrollY: window.scrollY,
          hit: hit ? `${hit.tagName}.${String(hit.className).slice(0, 40)}` : "none",
          onColumn,
        };
      });
      assert.ok(line?.onColumn, `the 12:30 line is not an empty slot ${JSON.stringify(line)}`);
      const beforeNudge = await page.locator("[data-appt]").count();
      await page.clock.fastForward(900);
      await releaseHold(page, line);
      await page.clock.fastForward(50);
      const opened = await page.evaluate(() => ({
        paste: document.querySelectorAll("[data-paste]").length,
        time: document.querySelector("[data-context-menu]")?.getAttribute("data-menu-time") ?? "",
        bar: document.querySelector("[data-copy-bar]")?.textContent?.slice(0, 80) ?? "",
      }));
      assert.equal(opened.paste, 1, `the 12:00 hold did not open Paste ${JSON.stringify({ line, opened })}`);
      assert.equal(await page.locator("[data-context-menu]").getAttribute("data-menu-time"), "12:00");
      const nudged = await page.evaluate(() => {
        const before = window.scrollY;
        window.scrollTo(0, before + 6);
        window.dispatchEvent(new Event("scroll"));
        return { before, after: window.scrollY, menu: document.querySelectorAll("[data-context-menu]").length };
      });
      assert.equal(nudged.menu, 0, `a 6 px scroll left Paste open ${JSON.stringify(nudged)}`);
      assert.equal(await page.locator("[data-appt]").count(), beforeNudge);
      const columnTarget = await pressInHours(page);
      assert.ok(columnTarget, "no slot for the column scroll");
      await page.clock.fastForward(2000);
      await releaseHold(page, columnTarget);
      assert.equal(await page.locator("[data-paste]").count(), 1, "Paste did not open before the column scroll");
      const columnNudge = await page.evaluate(() => {
        window.scrollBy(0, 6);
        document.querySelector("[data-tech]")?.dispatchEvent(new Event("scroll", { bubbles: true }));
        return document.querySelectorAll("[data-context-menu]").length;
      });
      assert.equal(columnNudge, 0, "a 6 px scroll aimed at a column left Paste open");
      assert.equal(await page.locator("[data-appt]").count(), beforeNudge, "the column scroll wrote a visit");

      await raiseOutsideNotice(page);
      const fine = await page.evaluate(() => {
        const column = document.querySelector<HTMLElement>("[data-tech]");
        if (!column) return null;
        const bar = document.querySelector("[data-copy-bar]")?.getBoundingClientRect().bottom ?? 200;
        const absolute = column.getBoundingClientRect().top + window.scrollY + 10 * 32 + 16;
        window.scrollTo({ top: Math.max(40, absolute - (bar + 160)), left: 0, behavior: "instant" });
        return true;
      });
      assert.ok(fine);
      const pixel = await pressInHours(page);
      assert.ok(pixel, "no slot for the 1 px check");
      const beforePixel = await page.locator("[data-appt]").count();
      await page.clock.fastForward(2000);
      await releaseHold(page, pixel);
      assert.equal(await page.locator("[data-paste]").count(), 1, "the 1 px hold did not open Paste");
      const pixelNudge = await page.evaluate(() => {
        const before = window.scrollY;
        window.scrollTo(0, before + 1);
        window.dispatchEvent(new Event("scroll"));
        return { before, after: window.scrollY, menu: document.querySelectorAll("[data-context-menu]").length };
      });
      assert.equal(pixelNudge.menu, 0, `a 1 px scroll left Paste open ${JSON.stringify(pixelNudge)}`);
      assert.ok(Math.abs(pixelNudge.after - pixelNudge.before) >= 1, "the page did not move by 1 px");
      assert.equal(await page.locator("[data-appt]").count(), beforePixel);

      await page.setViewportSize({ width: 1400, height: 800 });
      await raiseOutsideNotice(page);
      const showMorning = () => page.evaluate(() => {
        const column = document.querySelector("[data-tech]");
        const bar = document.querySelector("[data-copy-bar]")?.getBoundingClientRect().bottom ?? 200;
        if (!column) return;
        const target = column.getBoundingClientRect().top + window.scrollY + 4 * 32 + 16;
        window.scrollTo({ top: Math.max(40, target - (bar + 120)), left: 0, behavior: "instant" });
      });
      await showMorning();
      const turned = await pressInHours(page);
      assert.ok(turned, "no slot for the orientation check");
      const beforeTurn = await page.locator("[data-appt]").count();
      await page.clock.fastForward(2000);
      await releaseHold(page, turned);
      assert.equal(await page.locator("[data-paste]").count(), 1, "Paste was not open for the orientation change");
      await page.evaluate(() => window.dispatchEvent(new Event("orientationchange")));
      assert.equal(await page.locator("[data-context-menu]").count(), 0, "orientationchange left Paste open");
      assert.equal(await page.locator("[data-appt]").count(), beforeTurn, "orientationchange wrote a visit");
      await raiseOutsideNotice(page);
      await showMorning();
      const resized = await pressInHours(page);
      assert.ok(resized, "no slot for the resize check");
      await page.clock.fastForward(2000);
      await releaseHold(page, resized);
      assert.equal(await page.locator("[data-paste]").count(), 1, "Paste was not open for the resize");
      await page.setViewportSize({ width: 1400, height: 720 });
      await page.evaluate(() => window.dispatchEvent(new Event("resize")));
      assert.equal(await page.locator("[data-context-menu]").count(), 1, "a height-only resize closed Paste");
      assert.equal(await page.locator("[data-appt]").count(), beforeTurn, "a height-only resize wrote a visit");
      await page.setViewportSize({ width: 1100, height: 720 });
      await page.evaluate(() => window.dispatchEvent(new Event("resize")));
      assert.equal(await page.locator("[data-context-menu]").count(), 0, "resize left Paste open");
      assert.equal(await page.locator("[data-appt]").count(), beforeTurn, "resize wrote a visit");

      await page.setViewportSize({ width: 1400, height: 800 });
      await raiseOutsideNotice(page);
      await showMorning();
      const shifted = await pressInHours(page);
      assert.ok(shifted, "no slot for the 6 px hold");
      const beforeShift = await page.locator("[data-appt]").count();
      await page.clock.fastForward(120);
      await page.evaluate(() => {
        window.scrollBy(0, 6);
        document.dispatchEvent(new Event("scroll"));
      });
      await page.clock.fastForward(2000);
      const shiftedMenu = await page.evaluate(() => {
        const menu = document.querySelector("[data-context-menu]");
        const button = menu?.querySelector("[data-paste]");
        const rect = button?.getBoundingClientRect();
        if (!rect || !menu) return { paste: 0, time: "", under: "" };
        const y = rect.top + rect.height / 2;
        const x = rect.left + rect.width / 2;
        let under = "";
        for (const node of document.elementsFromPoint(x, y)) {
          if (!(node instanceof Element) || node.closest("[data-context-menu]")) continue;
          const column = node.closest("[data-tech]");
          if (!column) continue;
          const mins = 7 * 60 + Math.floor((y - column.getBoundingClientRect().top) / 32) * 30;
          under = `${String(Math.floor(mins / 60)).padStart(2, "0")}:${String(mins % 60).padStart(2, "0")}`;
          break;
        }
        return { paste: 1, time: menu.getAttribute("data-menu-time") ?? "", under };
      });
      assert.equal(shiftedMenu.paste, 1, "a 6 px scroll during the hold closed Paste");
      assert.equal(shiftedMenu.time, shifted.time, "a 6 px scroll changed the saved time");
      assert.equal(shiftedMenu.under, shifted.time, `a 6 px scroll moved the button center to ${shiftedMenu.under}`);
      await releaseHold(page, shifted);
      await page.keyboard.press("Escape");
      assert.equal(await page.locator("[data-appt]").count(), beforeShift, "a 6 px scroll wrote a visit");

      for (const width of [360, 820, 1400]) {
        await page.setViewportSize({ width, height: 800 });
        await raiseOutsideNotice(page);
        for (const edge of ["top", "bottom"] as const) {
          const slotIndex = edge === "top" ? 2 : 19;
          const expected = edge === "top" ? "08:00" : "16:30";
          const spot = await page.evaluate(({ slotIndex, edge }) => {
            const scroller = document.querySelector<HTMLElement>(".overflow-x-auto");
            if (scroller) scroller.scrollLeft = 0;
            const columns = [...document.querySelectorAll<HTMLElement>("[data-tech]")];
            const bar = Math.max(
              document.querySelector("[data-copy-bar]")?.getBoundingClientRect().bottom ?? 0,
              document.querySelector("header.app-header")?.getBoundingClientRect().bottom ?? 0,
            );
            const anchorColumn = columns.find((node) => node.getBoundingClientRect().width > 40) ?? columns[0];
            if (!anchorColumn) return null;
            const anchor = anchorColumn.getBoundingClientRect().top + window.scrollY + slotIndex * 32 + (edge === "top" ? 0 : 32);
            window.scrollTo({ top: Math.max(0, anchor - (edge === "top" ? bar + 6 : window.innerHeight - 4)), left: 0, behavior: "instant" });
            let last = "";
            for (const column of columns) {
              const rect = column.getBoundingClientRect();
              const visibleLeft = Math.max(rect.left, 8);
              const visibleRight = Math.min(rect.right, window.innerWidth - 8);
              if (visibleRight - visibleLeft < 40) continue;
              const x = visibleLeft + 16;
              const y = rect.top + slotIndex * 32 + (edge === "top" ? 2 : 30);
              if (y < 0 || y > window.innerHeight - 1) continue;
              const hit = document.elementFromPoint(x, y);
              last = `${Math.round(x)},${Math.round(y)} ${hit ? hit.tagName : "none"} bar ${Math.round(bar)}`;
              if (!hit?.closest("[data-tech]") || hit.closest("[data-appt], [data-copy-bar], header")) continue;
              hit.dispatchEvent(new PointerEvent("pointerdown", {
                bubbles: true, cancelable: true, clientX: x, clientY: y,
                button: 0, buttons: 1, pointerId: 7, pointerType: "mouse", isPrimary: true,
              }));
              return { x, y, blocked: false };
            }
            return { x: 0, y: 0, blocked: true, last };
          }, { slotIndex, edge });
          assert.ok(spot && !spot.blocked, `${width} ${edge} row is not an empty slot ${JSON.stringify(spot)}`);
          const beforeEdge = await page.locator("[data-appt]").count();
          const beforeTime = await page.locator(`[data-appt-time="${expected}"]`).count();
          await page.clock.fastForward(2000);
          const placed = await page.evaluate(() => {
            const menu = document.querySelector("[data-context-menu]");
            const button = menu?.querySelector("[data-paste]");
            const rect = button?.getBoundingClientRect();
            if (!rect || !menu) return { paste: 0, time: "", under: "", offset: -1 };
            const y = rect.top + rect.height / 2;
            const x = rect.left + rect.width / 2;
            let under = "";
            let offset = -1;
            for (const node of document.elementsFromPoint(x, y)) {
              if (!(node instanceof Element) || node.closest("[data-context-menu]")) continue;
              const column = node.closest("[data-tech]");
              if (!column) continue;
              const rel = y - column.getBoundingClientRect().top;
              const index = Math.floor(rel / 32);
              const mins = 7 * 60 + index * 30;
              under = `${String(Math.floor(mins / 60)).padStart(2, "0")}:${String(mins % 60).padStart(2, "0")}`;
              offset = rel - index * 32;
              break;
            }
            return { paste: 1, time: menu.getAttribute("data-menu-time") ?? "", under, offset };
          });
          assert.equal(placed.paste, 1, `${width} ${edge} Paste did not open`);
          assert.equal(placed.time, expected, `${width} ${edge} saved ${placed.time}`);
          assert.equal(placed.under, expected, `${width} ${edge} center is on ${placed.under}`);
          assert.ok(placed.offset >= 10 && placed.offset <= 22, `${width} ${edge} center is ${placed.offset}px into the row`);
          await releaseHold(page, spot);
          await page.evaluate(() => document.querySelector<HTMLButtonElement>("[data-paste]")?.click());
          assert.equal(await page.locator("[data-appt]").count(), beforeEdge + 1, `${width} ${edge} Paste did not save`);
          assert.equal(await page.locator(`[data-appt-time="${expected}"]`).count(), beforeTime + 1, `${width} ${edge} saved a different time`);
        }
      }

      await page.setViewportSize({ width: 1400, height: 800 });
      await raiseOutsideNotice(page);
      await showMorning();
      const armed = await pressInHours(page);
      assert.ok(armed, "no slot for the resize-while-held check");
      const beforeArmed = await page.locator("[data-appt]").count();
      await page.clock.fastForward(150);
      await page.setViewportSize({ width: 1000, height: 800 });
      await page.evaluate(() => window.dispatchEvent(new Event("resize")));
      await page.clock.fastForward(2000);
      assert.equal(await page.locator("[data-paste]").count(), 0, "a resize while the finger was down still opened Paste");
      assert.equal(await page.locator("[data-appt]").count(), beforeArmed, "a resize while the finger was down wrote a visit");
      await releaseHold(page, armed);

      await page.setViewportSize({ width: 1400, height: 800 });
      await raiseOutsideNotice(page);
      const noticeHold = await page.evaluate(() => {
        const column = document.querySelector("[data-tech]");
        return {
          top: column?.getBoundingClientRect().top ?? 0,
          bar: document.querySelector("[data-copy-bar]")?.getBoundingClientRect().height ?? 0,
        };
      });
      const noticeStill = await page.evaluate(() => {
        const column = document.querySelector("[data-tech]");
        return column?.getBoundingClientRect().top ?? 0;
      });
      assert.ok(Math.abs(noticeStill - noticeHold.top) < 8, `the board moved ${Math.abs(noticeStill - noticeHold.top)}px between aim and press`);
      await page.locator("[data-dismiss]").click();
      const afterDismiss = await page.evaluate(() => document.querySelector("[data-copy-bar]")?.getBoundingClientRect().height ?? 0);
      assert.ok(noticeHold.bar - afterDismiss > 40, `clearing the notice only shrank the bar ${noticeHold.bar - afterDismiss}px`);
      await raiseOutsideNotice(page);

      for (const delta of [-1, -6, 6]) {
        await page.evaluate(() => window.scrollTo({ top: 80, left: 0, behavior: "instant" }));
        const beforeNeg = await page.locator("[data-appt]").count();
        const neg = await pressInHours(page, "touch");
        assert.ok(neg, `no slot for the ${delta}px touch hold`);
        await page.clock.fastForward(120);
        await page.evaluate((delta) => {
          window.scrollBy(0, delta);
          const column = document.querySelector("[data-tech]");
          (column ?? document).dispatchEvent(new Event("scroll", { bubbles: true }));
        }, delta);
        await page.clock.fastForward(2000);
        assert.equal(await page.locator("[data-paste]").count(), 1, `a ${delta}px scroll during the hold did not open Paste`);
        assert.equal(await page.locator("[data-appt]").count(), beforeNeg, `a ${delta}px scroll wrote a visit`);
        await releaseHold(page, neg);
        await page.keyboard.press("Escape");
      }

      await page.evaluate(() => {
        const column = document.querySelector("[data-tech]");
        const bar = document.querySelector("[data-copy-bar]")?.getBoundingClientRect().bottom ?? 200;
        if (!column) return;
        const target = column.getBoundingClientRect().top + window.scrollY + 6 * 32;
        window.scrollTo({ top: Math.max(0, target - (bar + 40)), left: 0, behavior: "instant" });
      });
      const boundary = await page.evaluate(() => {
        const columns = [...document.querySelectorAll<HTMLElement>("[data-tech]")];
        for (const column of columns) {
          const rect = column.getBoundingClientRect();
          if (rect.width < 40) continue;
          const x = Math.max(rect.left, 8) + 16;
          const y = rect.top + 6 * 32 + 30;
          if (y < 0 || y > window.innerHeight - 1) continue;
          const hit = document.elementFromPoint(x, y);
          if (!hit?.closest("[data-tech]") || hit.closest("[data-appt], [data-copy-bar], header")) continue;
          hit.dispatchEvent(new PointerEvent("pointerdown", {
            bubbles: true, cancelable: true, clientX: x, clientY: y,
            button: 0, buttons: 1, pointerId: 7, pointerType: "mouse", isPrimary: true,
          }));
          return { x, y };
        }
        return null;
      });
      assert.ok(boundary, "no slot within 2px of a row boundary");
      const beforeBoundary = await page.locator("[data-appt]").count();
      await page.clock.fastForward(120);
      await page.evaluate(() => {
        window.scrollBy(0, 8);
        document.dispatchEvent(new Event("scroll"));
      });
      await page.clock.fastForward(2000);
      const boundaryMenu = await page.evaluate(() => {
        const menu = document.querySelector("[data-context-menu]");
        const button = menu?.querySelector("[data-paste]");
        const rect = button?.getBoundingClientRect();
        if (!rect || !menu) return { paste: 0, time: "", under: "" };
        const y = rect.top + rect.height / 2;
        const x = rect.left + rect.width / 2;
        let under = "";
        for (const node of document.elementsFromPoint(x, y)) {
          if (!(node instanceof Element) || node.closest("[data-context-menu]")) continue;
          const column = node.closest("[data-tech]");
          if (!column) continue;
          const mins = 7 * 60 + Math.floor((y - column.getBoundingClientRect().top) / 32) * 30;
          under = `${String(Math.floor(mins / 60)).padStart(2, "0")}:${String(mins % 60).padStart(2, "0")}`;
          break;
        }
        return { paste: 1, time: menu.getAttribute("data-menu-time") ?? "", under };
      });
      assert.equal(boundaryMenu.paste, 1, "scrolling 8px across a slot boundary closed Paste");
      assert.equal(boundaryMenu.time, "10:00", `the boundary hold saved ${boundaryMenu.time}`);
      assert.equal(boundaryMenu.under, "10:00", `the center left the held row for ${boundaryMenu.under}`);
      await releaseHold(page, boundary);
      await page.keyboard.press("Escape");
      assert.equal(await page.locator("[data-appt]").count(), beforeBoundary, "the boundary scroll wrote a visit");

      const tucked = await page.evaluate(() => {
        const columns = [...document.querySelectorAll<HTMLElement>("[data-tech]")].filter((node) => node.getBoundingClientRect().width > 40);
        const anchor = columns[0];
        const bar = Math.max(
          document.querySelector("[data-copy-bar]")?.getBoundingClientRect().bottom ?? 0,
          document.querySelector("header.app-header")?.getBoundingClientRect().bottom ?? 0,
        );
        if (!anchor) return { blocked: true, x: 0, y: 0, bar };
        const rowTop = bar - 26;
        window.scrollTo({ top: window.scrollY + (anchor.getBoundingClientRect().top + 4 * 32) - rowTop, left: 0, behavior: "instant" });
        for (const column of columns) {
          const rect = column.getBoundingClientRect();
          const x = Math.max(rect.left, 8) + 16;
          const y = rect.top + 4 * 32 + 30;
          const hit = document.elementFromPoint(x, y);
          if (!hit?.closest("[data-tech]") || hit.closest("[data-appt], [data-copy-bar], header")) continue;
          hit.dispatchEvent(new PointerEvent("pointerdown", {
            bubbles: true, cancelable: true, clientX: x, clientY: y,
            button: 0, buttons: 1, pointerId: 7, pointerType: "mouse", isPrimary: true,
          }));
          return { blocked: false, x, y, bar };
        }
        return { blocked: true, x: 0, y: 0, bar };
      });
      assert.ok(tucked && !tucked.blocked, `the tucked row is not pressable ${JSON.stringify(tucked)}`);
      const beforeTucked = await page.locator(`[data-appt-time="09:00"]`).count();
      await page.clock.fastForward(2000);
      const tuckedMenu = await page.evaluate(() => {
        const menu = document.querySelector("[data-context-menu]");
        const button = menu?.querySelector("[data-paste]");
        const rect = button?.getBoundingClientRect();
        const bar = Math.max(
          document.querySelector("[data-copy-bar]")?.getBoundingClientRect().bottom ?? 0,
          document.querySelector("header.app-header")?.getBoundingClientRect().bottom ?? 0,
        );
        if (!rect || !menu) return { paste: 0, time: "", under: "", center: 0, bar, rowTop: 0, rowBottom: 0, innerHeight: window.innerHeight };
        const y = rect.top + rect.height / 2;
        const x = rect.left + rect.width / 2;
        let under = "";
        let rowTop = 0;
        let rowBottom = 0;
        for (const node of document.elementsFromPoint(x, y)) {
          if (!(node instanceof Element) || node.closest("[data-context-menu]")) continue;
          const column = node.closest("[data-tech]");
          if (!column) continue;
          const top = column.getBoundingClientRect().top + 4 * 32;
          rowTop = top;
          rowBottom = top + 32;
          const mins = 7 * 60 + Math.floor((y - column.getBoundingClientRect().top) / 32) * 30;
          under = `${String(Math.floor(mins / 60)).padStart(2, "0")}:${String(mins % 60).padStart(2, "0")}`;
          break;
        }
        return { paste: 1, time: menu.getAttribute("data-menu-time") ?? "", under, center: y, bar, rowTop, rowBottom, innerHeight: window.innerHeight };
      });
      assert.equal(tuckedMenu.paste, 1, "a row under the bar did not open Paste");
      assert.equal(tuckedMenu.time, "09:00");
      assert.equal(tuckedMenu.under, "09:00");
      assert.ok(tuckedMenu.center >= tuckedMenu.bar - 1, `the center sits over the bar at ${tuckedMenu.center}`);
      assert.ok(tuckedMenu.center < tuckedMenu.innerHeight, "the center is below the window");
      assert.ok(tuckedMenu.center >= tuckedMenu.rowTop && tuckedMenu.center <= tuckedMenu.rowBottom, "the center left the held row");
      await releaseHold(page, tucked);
      await page.evaluate(() => document.querySelector<HTMLButtonElement>("[data-paste]")?.click());
      assert.equal(await page.locator(`[data-appt-time="09:00"]`).count(), beforeTucked + 1, "the tucked row saved a different slot");

      const low = await page.evaluate(() => {
        const columns = [...document.querySelectorAll<HTMLElement>("[data-tech]")].filter((node) => node.getBoundingClientRect().width > 40);
        const anchor = columns[0];
        if (!anchor) return { blocked: true, x: 0, y: 0 };
        const rowTop = window.innerHeight - 6;
        window.scrollTo({ top: window.scrollY + (anchor.getBoundingClientRect().top + 8 * 32) - rowTop, left: 0, behavior: "instant" });
        for (const column of columns) {
          const rect = column.getBoundingClientRect();
          const x = Math.max(rect.left, 8) + 16;
          const y = rect.top + 8 * 32 + 2;
          if (y < 0 || y > window.innerHeight - 1) continue;
          const hit = document.elementFromPoint(x, y);
          if (!hit?.closest("[data-tech]") || hit.closest("[data-appt], [data-copy-bar], header")) continue;
          hit.dispatchEvent(new PointerEvent("pointerdown", {
            bubbles: true, cancelable: true, clientX: x, clientY: y,
            button: 0, buttons: 1, pointerId: 7, pointerType: "mouse", isPrimary: true,
          }));
          return { blocked: false, x, y };
        }
        return { blocked: true, x: 0, y: 0 };
      });
      assert.ok(low && !low.blocked, `the low row is not pressable ${JSON.stringify(low)}`);
      await page.clock.fastForward(2000);
      const lowMenu = await page.evaluate(() => {
        const menu = document.querySelector("[data-context-menu]");
        const button = menu?.querySelector("[data-paste]");
        const rect = button?.getBoundingClientRect();
        if (!rect || !menu) return { paste: 0, time: "", under: "", center: 0, innerHeight: window.innerHeight, rowTop: 0, rowBottom: 0 };
        const y = rect.top + rect.height / 2;
        const x = rect.left + rect.width / 2;
        let under = "";
        let rowTop = 0;
        let rowBottom = 0;
        for (const node of document.elementsFromPoint(x, y)) {
          if (!(node instanceof Element) || node.closest("[data-context-menu]")) continue;
          const column = node.closest("[data-tech]");
          if (!column) continue;
          const top = column.getBoundingClientRect().top + 8 * 32;
          rowTop = top;
          rowBottom = top + 32;
          const mins = 7 * 60 + Math.floor((y - column.getBoundingClientRect().top) / 32) * 30;
          under = `${String(Math.floor(mins / 60)).padStart(2, "0")}:${String(mins % 60).padStart(2, "0")}`;
          break;
        }
        return { paste: 1, time: menu.getAttribute("data-menu-time") ?? "", under, center: y, innerHeight: window.innerHeight, rowTop, rowBottom };
      });
      assert.equal(lowMenu.paste, 1, "a row below the window did not open Paste");
      assert.equal(lowMenu.time, "11:00");
      assert.equal(lowMenu.under, "11:00");
      assert.ok(lowMenu.center < lowMenu.innerHeight, `the center is off the window at ${lowMenu.center}`);
      assert.ok(lowMenu.center >= lowMenu.rowTop && lowMenu.center <= lowMenu.rowBottom, "the low center left the held row");
      await releaseHold(page, low);
      await page.keyboard.press("Escape");

      for (const person of ["megan", "derek"] as const) {
        await page.locator("[aria-label='Working as']").selectOption(person);
        for (let step = 0; step < 8 && (await page.locator("[data-appt]").count()) === 0; step += 1) {
          await page.getByRole("button", { name: "Previous", exact: true }).click();
        }
        const copied = await page.evaluate(() => {
          const cards = [...document.querySelectorAll<HTMLElement>("[data-appt]")];
          cards.sort((a, b) => a.getBoundingClientRect().height - b.getBoundingClientRect().height);
          const card = cards[0];
          if (!card) return false;
          const rect = card.getBoundingClientRect();
          card.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true, clientX: rect.left + 12, clientY: rect.top + 8, button: 2 }));
          return true;
        });
        assert.ok(copied, `${person} has no card to copy`);
        await page.locator("[data-copy]").click();
        assert.ok(await waitForSelector(page, "[data-copied]"), "the copied line did not appear");
        for (let step = 0; step < 8 && !/\bFri\b/.test(await page.locator("[data-desk-heading] h1").innerText()); step += 1) {
          await page.getByRole("button", { name: "Next", exact: true }).click();
        }
        assert.match(await page.locator("[data-desk-heading] h1").innerText(), /\bFri\b/);
        for (const width of [1400, 820, 390, 360]) {
          await page.setViewportSize({ width, height: 800 });
          for (const mode of ["0", "40", "mid"] as const) {
            for (const pointerType of ["mouse", "touch"] as const) {
              await raiseOutsideNotice(page);
              await page.evaluate((mode) => {
                const column = document.querySelector("[data-tech]");
                const morning = column ? column.getBoundingClientRect().top + window.scrollY + 4 * 32 : 400;
                const top = mode === "0" ? 0 : mode === "40" ? 40 : Math.max(80, morning - 160);
                window.scrollTo({ top, left: 0, behavior: "instant" });
              }, mode);
              const latest = width === 1400 && mode === "0" ? "11:00" : "17:00";
              let spot = await pressInHours(page, pointerType, latest);
              if (!spot && mode !== "mid") {
                await page.evaluate(() => {
                  const column = document.querySelector("[data-tech]");
                  const bar = document.querySelector("[data-copy-bar]")?.getBoundingClientRect().bottom ?? 200;
                  if (!column) return;
                  const target = column.getBoundingClientRect().top + window.scrollY + 2 * 32 + 16;
                  window.scrollTo({ top: Math.max(0, target - (bar + 80)), left: 0, behavior: "instant" });
                });
                spot = await pressInHours(page, pointerType, latest);
              }
              if (!spot) {
                const debug = await page.evaluate(() => ({
                  scrollY: window.scrollY,
                  height: window.innerHeight,
                  bar: document.querySelector("[data-copy-bar]")?.getBoundingClientRect().bottom ?? 0,
                  columns: [...document.querySelectorAll<HTMLElement>("[data-tech]")].slice(0, 3).map((column) => {
                    const rect = column.getBoundingClientRect();
                    return { top: rect.top, bottom: rect.bottom, left: rect.left, right: rect.right };
                  }),
                }));
                assert.fail(`${person} ${width} scroll ${mode} ${pointerType} has no in-hours slot ${JSON.stringify(debug)}`);
              }
              if (width === 1400 && mode === "0") assert.equal(spot.scrollY, 0, "1400 did not hold at the top");
              if (width === 1400 && mode === "40") assert.ok(Math.abs(spot.scrollY - 40) <= 2, `1400 scroll 40 landed at ${spot.scrollY}`);
              const before = await page.locator("[data-appt]").count();
              const beforeTime = await page.locator(`[data-appt-time="${spot.time}"]`).count();
              await page.clock.fastForward(2000);
              const held = await page.evaluate(() => {
                const menu = document.querySelector("[data-context-menu]");
                const button = menu?.querySelector("[data-paste]");
                const rect = button?.getBoundingClientRect();
                const point = rect ? { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 } : null;
                let under = "";
                if (point) {
                  const stack = document.elementsFromPoint(point.x, point.y);
                  for (const node of stack) {
                    if (!(node instanceof Element) || node.closest("[data-context-menu]")) continue;
                    const column = node.closest("[data-tech]");
                    if (!column) continue;
                    const box = column.getBoundingClientRect();
                    const mins = 7 * 60 + Math.floor((point.y - box.top) / 32) * 30;
                    under = `${String(Math.floor(mins / 60)).padStart(2, "0")}:${String(mins % 60).padStart(2, "0")}`;
                    break;
                  }
                }
                const column = document.querySelector("[data-tech]");
                return {
                  paste: document.querySelectorAll("[data-paste]").length,
                  time: menu?.getAttribute("data-menu-time") ?? "",
                  under,
                  scrollY: window.scrollY,
                  columnTop: column?.getBoundingClientRect().top ?? 0,
                  count: document.querySelectorAll("[data-appt]").length,
                  heldSlot: document.querySelectorAll("[data-held-slot]").length,
                };
              });
              assert.equal(held.paste, 1, `${person} ${width} ${mode} ${pointerType} Paste did not stay open ${JSON.stringify({ spot, held })}`);
              assert.equal(held.heldSlot, pointerType === "touch" ? 1 : 0, `${person} ${width} ${mode} ${pointerType} held-cell outline`);
              assert.equal(held.time, spot.time, `${person} ${width} ${mode} ${pointerType} Paste used ${held.time} instead of ${spot.time}`);
              assert.equal(held.under, held.time, `${person} ${width} ${mode} ${pointerType} the button sits over ${held.under} but saves ${held.time}`);
              assert.ok(Math.abs(held.scrollY - spot.scrollY) <= 8, `${person} ${width} ${mode} ${pointerType} scroll jumped ${held.scrollY - spot.scrollY}`);
              assert.ok(Math.abs(held.columnTop - spot.columnTop) <= 2, `${person} ${width} ${mode} ${pointerType} the column moved ${held.columnTop - spot.columnTop}`);
              assert.equal(held.count, before, `${person} ${width} ${mode} ${pointerType} the hold wrote a visit`);
              await releaseHold(page, spot);
              const late = await page.evaluate(() => ({
                paste: document.querySelectorAll("[data-paste]").length,
                bar: document.querySelector("[data-copy-bar]")?.getBoundingClientRect().height ?? 0,
                columnTop: document.querySelector("[data-tech]")?.getBoundingClientRect().top ?? 0,
              }));
              assert.equal(late.paste, 1, `${person} ${width} ${mode} ${pointerType} Paste closed when the finger lifted`);
              assert.ok(Math.abs(late.bar - spot.barHeight) <= 2, `${person} ${width} ${mode} ${pointerType} the bar changed after release`);
              assert.ok(Math.abs(late.columnTop - spot.columnTop) <= 2, `${person} ${width} ${mode} ${pointerType} the column moved after release`);
              if (width === 1400 && mode === "0") {
                await page.evaluate(() => document.querySelector<HTMLButtonElement>("[data-paste]")?.click());
                const savedCount = await page.locator("[data-appt]").count();
                if (savedCount !== before + 1) {
                  const notice = await page.locator("[data-paste-notice]").innerText().catch(() => "");
                  assert.equal(savedCount, before + 1, `${person} ${width} ${mode} ${pointerType} Paste did not save ${notice}`);
                }
                assert.equal(await page.locator(`[data-appt-time="${spot.time}"]`).count(), beforeTime + 1, `${person} ${width} ${mode} ${pointerType} saved a different time`);
              } else {
                await page.keyboard.press("Escape");
                assert.equal(await page.locator("[data-appt]").count(), before, `${person} ${width} ${mode} ${pointerType} closing Paste wrote a visit`);
              }
            }
          }
        }
      }
    } finally {
      await browser.close();
      stopServer(server);
      if (server.exitCode == null) {
        await new Promise((resolve) => server.once("exit", resolve));
      }
      if (serverLog.includes("error") && server.exitCode && server.exitCode !== 0) {
        console.log(serverLog.slice(-2000));
      }
    }
  });
});

function stopServer(server: ChildProcess) {
  if (server.exitCode != null) return;
  server.kill("SIGTERM");
  setTimeout(() => {
    if (server.exitCode == null) server.kill("SIGKILL");
  }, 2000);
}

async function waitForSelector(page: Page, selector: string, timeoutMs = 4000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    if (await page.evaluate((selector) => Boolean(document.querySelector(selector)), selector)) return true;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  return false;
}

function waitForPort(port: number) {
  const started = Date.now();
  return new Promise<void>((resolve, reject) => {
    const attempt = () => {
      const socket = createConnection({ port, host: "127.0.0.1" }, () => {
        socket.end();
        resolve();
      });
      socket.on("error", () => {
        socket.destroy();
        if (Date.now() - started > 90000) reject(new Error(`vite did not listen on ${port}`));
        else setTimeout(attempt, 300);
      });
    };
    attempt();
  });
}

async function raiseOutsideNotice(page: Page) {
  if (await page.locator("[data-paste-notice]").count()) return;
  let point: { x: number; y: number } | null = null;
  for (let attempt = 0; attempt < 4 && !point; attempt += 1) {
    await page.evaluate((attempt) => {
      const scroller = document.querySelector<HTMLElement>(".overflow-x-auto");
      if (scroller) scroller.scrollLeft = 0;
      const column = document.querySelector("[data-tech]");
      if (!column) return;
      const bar = document.querySelector("[data-copy-bar]")?.getBoundingClientRect().bottom ?? 220;
      const header = document.querySelector("header.app-header")?.getBoundingClientRect().bottom ?? 0;
      const top = column.getBoundingClientRect().top + window.scrollY + 21 * 32 + 16;
      window.scrollTo({ top: Math.max(0, top - (Math.max(bar, header) + 80 + attempt * 70)), left: 0, behavior: "instant" });
    }, attempt);
    point = await page.evaluate(() => {
    const scroller = document.querySelector<HTMLElement>(".overflow-x-auto");
    if (scroller) scroller.scrollLeft = 0;
    const columns = [...document.querySelectorAll<HTMLElement>("[data-tech]")];
    for (const column of columns) {
      const rect = column.getBoundingClientRect();
      const visibleLeft = Math.max(rect.left, 8);
      const visibleRight = Math.min(rect.right, window.innerWidth - 8);
      if (visibleRight - visibleLeft < 40) continue;
      const y = rect.top + 21 * 32 + 16;
      const x = visibleLeft + 20;
      if (y < 80 || y > window.innerHeight - 20) continue;
      const hit = document.elementFromPoint(x, y);
      if (!hit || !hit.closest("[data-tech]") || hit.closest("[data-appt], [data-copy-bar], header")) continue;
      hit.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true, clientX: x, clientY: y, button: 2 }));
      return { x, y };
    }
    return null;
  });
  }
  if (!point) {
    const debug = await page.evaluate(() => ({
      height: window.innerHeight,
      width: window.innerWidth,
      scrollY: window.scrollY,
      columns: [...document.querySelectorAll<HTMLElement>("[data-tech]")].map((column) => {
        const rect = column.getBoundingClientRect();
        return { top: rect.top, left: rect.left, right: rect.right, bottom: rect.bottom, y: rect.top + 21 * 32 + 16 };
      }),
    }));
    assert.fail(`17:30 is not an empty slot in view ${JSON.stringify(debug)}`);
  }
  const appeared = await waitForSelector(page, "[data-paste-notice]");
  if (!appeared) {
    const debug = await page.evaluate((spot) => {
      const hit = document.elementFromPoint(spot.x, spot.y);
      return {
        spot,
        hit: hit ? `${hit.tagName}.${String(hit.className).slice(0, 60)}` : "none",
        menu: document.querySelector("[data-context-menu]")?.getAttribute("data-menu-time") ?? document.querySelector("[data-context-menu]")?.textContent ?? "",
        bar: document.querySelector("[data-copy-bar]")?.textContent?.slice(0, 120) ?? "",
      };
    }, point);
    assert.fail(`could not raise the 17:30 notice ${JSON.stringify(debug)}`);
  }
  await page.keyboard.press("Escape");
}

async function pressInHours(page: Page, pointerType: "mouse" | "touch" = "mouse", latest = "17:00") {
  return page.evaluate(({ pointerType, latest }) => {
    const scroller = document.querySelector<HTMLElement>(".overflow-x-auto");
    if (scroller) scroller.scrollLeft = 0;
    const columns = [...document.querySelectorAll<HTMLElement>("[data-tech]")];
    const bar = document.querySelector("[data-copy-bar]")?.getBoundingClientRect().bottom ?? 0;
    const header = document.querySelector("header.app-header")?.getBoundingClientRect().bottom ?? 0;
    const topLimit = Math.max(bar, header) + 8;
    for (const column of columns) {
      const rect = column.getBoundingClientRect();
      const visibleLeft = Math.max(rect.left, 8);
      const visibleRight = Math.min(rect.right, window.innerWidth - 8);
      if (visibleRight - visibleLeft < 40) continue;
      for (let slots = 1; slots <= 19; slots += 1) {
        const y = rect.top + slots * 32 + 16;
        const x = visibleLeft + 20;
        if (y <= topLimit || y >= window.innerHeight - 16) continue;
        const mins = 7 * 60 + slots * 30;
        const time = `${String(Math.floor(mins / 60)).padStart(2, "0")}:${String(mins % 60).padStart(2, "0")}`;
        if (time > latest) continue;
        const hit = document.elementFromPoint(x, y);
        if (!hit || !hit.closest("[data-tech]") || hit.closest("[data-appt], [data-copy-bar], header, [data-context-menu]")) continue;
        hit.dispatchEvent(new PointerEvent("pointerdown", {
          bubbles: true, cancelable: true, clientX: x, clientY: y,
          button: 0, buttons: 1, pointerId: 7, pointerType, isPrimary: true,
        }));
        return {
          x, y, time, scrollY: window.scrollY, columnTop: rect.top,
          barHeight: document.querySelector("[data-copy-bar]")?.getBoundingClientRect().height ?? 0,
        };
      }
    }
    return null;
  }, { pointerType, latest });
}

async function releaseHold(page: Page, spot: { x: number; y: number }) {
  await page.evaluate(({ x, y }) => {
    document.dispatchEvent(new PointerEvent("pointerup", {
      bubbles: true, cancelable: true, clientX: x, clientY: y,
      button: 0, buttons: 0, pointerId: 7, pointerType: "mouse", isPrimary: true,
    }));
  }, spot);
}

async function appCss(markup: string) {
  const source = readFileSync(new URL("../styles.css", import.meta.url), "utf8");
  const compiled = await compile(source, { base: new URL("..", import.meta.url).pathname, onDependency() {} });
  const classes = [...markup.matchAll(/class="([^"]+)"/g)].flatMap((match) => match[1].split(/\s+/));
  return compiled.build([...new Set(classes)]);
}
