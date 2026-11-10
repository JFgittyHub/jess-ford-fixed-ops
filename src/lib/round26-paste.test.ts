import "./test-dom.ts";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
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
import { commitPaste, copiedFrom, copyWorkerKey, pasteAppointmentInput, slotOpensBook, useForgetCopy, type CopiedAppointment } from "./paste-appointment.ts";
import type { ShopStorage } from "./shop-storage.ts";
import { createShopStore } from "./store.ts";
import type { Appointment } from "./types.ts";

afterEach(() => resetClock());

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
    const html = `<div class="min-h-screen bg-bg text-ink"><div class="md:pl-60">${header}<main class="mx-auto w-full max-w-6xl px-4 py-5">${bar}<div data-desk-heading class="flex flex-wrap gap-3" style="min-height:28rem"><h1 class="font-display text-5xl">Today</h1><div class="desk-actions flex flex-wrap gap-2"><button class="btn min-h-11" type="button">Book appointment</button></div></div>${board}</main></div></div>`;
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
      notice: { kind: "close", techId: "elena", time: "17:00", reason: "", text: "Staying past close so the tow truck can finish. ".repeat(30) },
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
    const html = `<div class="min-h-screen bg-bg text-ink"><div class="md:pl-60">${header}<main class="mx-auto w-full max-w-6xl px-4 py-5">${bar}${board}</main></div></div>`;
    const css = await appCss(`${header}${bar}${board}${html}`);
    const browser = await chromium.launch({ headless: true });
    try {
      const page = await browser.newPage();
      await page.setContent(`<!doctype html><html><head><style>${css}</style></head><body style="margin:0">${html}</body></html>`);
      for (const [width, height] of [[1400, 700], [820, 700], [390, 700]] as const) {
        await page.setViewportSize({ width, height });
        await page.evaluate(() => window.scrollTo(0, 0));
        await pinHeader(page);
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
        if (width === 390) assert.ok(laid.formScroll > 20, "the reason form does not scroll inside the bar");
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
});

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
    assert.ok(header, "the schedule page rendered the desk header");
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

async function appCss(markup: string) {
  const source = readFileSync(new URL("../styles.css", import.meta.url), "utf8");
  const compiled = await compile(source, { base: new URL("..", import.meta.url).pathname, onDependency() {} });
  const classes = [...markup.matchAll(/class="([^"]+)"/g)].flatMap((match) => match[1].split(/\s+/));
  return compiled.build([...new Set(classes)]);
}
