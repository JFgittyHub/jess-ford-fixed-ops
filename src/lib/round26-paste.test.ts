import "./test-dom.ts";
import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import { act, createElement, useState, type ReactNode } from "react";
import { flushSync } from "react-dom";
import { createRoot } from "react-dom/client";
import { AppointmentCalendar } from "../components/appointment-calendar.tsx";
import { PasteNoticeBar, type PasteNotice } from "../routes/schedule.tsx";
import { pinClock, resetClock } from "./clock.ts";
import { commitPaste, copiedFrom, pasteAppointmentInput, type CopiedAppointment } from "./paste-appointment.ts";
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
      assert.equal(row.advisorId, original.advisorId);
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
      flushSync(() => root.render(createElement(Board, { store, day: friday })));
    }
    try {
    draw();
    const card = () => host.querySelector<HTMLElement>(`[data-appt-id='${saved.appointmentId}']`);
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
    const logged = store.getState().overrides.filter((row) => row.appointmentId === pasted.id && row.reason === "past-close");
    assert.equal(logged.length, 1);
    assert.equal(logged[0].note, "Staying past one");
    assert.equal(logged[0].who, "Derek Lang");
    store.getState().setWorkingAs("megan");
    draw();
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
    const original = store.getState().appointments.find((row) => row.id === saved.appointmentId);
    assert.equal(original?.techId, "marcus");
    assert.equal(original?.time, "09:00");
    } finally {
      root.unmount();
      host.remove();
    }
  });
});
