import "./test-dom.ts";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { afterEach, describe, it } from "node:test";
import { createElement } from "react";
import { flushSync } from "react-dom";
import { createRoot } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { compile } from "@tailwindcss/node";
import { chromium } from "playwright";
import { AppointmentCalendar } from "../components/appointment-calendar.tsx";
import { AppointmentFields } from "../routes/schedule.tsx";
import { appointmentLoads, PAST_CLOSE_MESSAGE } from "./capacity.ts";
import { pinClock, resetClock } from "./clock.ts";
import { snapBlockMinutes } from "./labor-lines.ts";
import { commitPaste, copiedFrom, pasteAppointmentInput } from "./paste-appointment.ts";
import type { ShopStorage } from "./shop-storage.ts";
import { createShopStore } from "./store.ts";
import type { Appointment } from "./types.ts";

afterEach(() => resetClock());

const when = "2026-11-10T20:00:00.000Z";
const friday = "2026-11-13";

function memoryStorage(): ShopStorage {
  const items = new Map<string, string>();
  return {
    getItem: (key) => items.get(key) ?? null,
    setItem: (key, value) => { items.set(key, value); },
    removeItem: (key) => { items.delete(key); },
  };
}

function shop(who = "megan") {
  pinClock(when);
  const store = createShopStore({ demoMode: true, storage: memoryStorage() });
  store.getState().setWorkingAs(who);
  return store;
}

function party(store: ReturnType<typeof shop>) {
  const state = store.getState();
  const customer = state.customers[0];
  const vehicle = state.vehicles.find((row) => row.customerId === customer.id) ?? state.vehicles[0];
  const misc = state.laborOps.find((op) => op.opcode === "MISC");
  assert.ok(customer && vehicle && misc);
  return { customer, vehicle, misc };
}

function body(store: ReturnType<typeof shop>, patch: Partial<Appointment> = {}): Omit<Appointment, "id" | "orderId"> {
  const { customer, vehicle, misc } = party(store);
  return {
    date: friday,
    time: "09:00",
    minutes: 60,
    customerId: customer.id,
    vehicleId: vehicle.id,
    advisorId: "megan",
    techId: "marcus",
    concern: "Oil",
    lines: [{ id: "a", code: "A", concern: "Oil", laborOpId: misc.id, hours: 1 }],
    vin: vehicle.vin,
    laborOpIds: [misc.id],
    lane: "drop",
    status: "scheduled",
    ...patch,
  };
}

describe("round 25 block length", () => {
  it("rounds a line total up to the next 30 minutes and refuses 31 and 45", () => {
    assert.equal(snapBlockMinutes(246), 270);
    assert.equal(snapBlockMinutes(60), 60);
    assert.equal(snapBlockMinutes(6), 30);
    const store = shop();
    const { misc } = party(store);
    const before = store.getState().appointments.length;
    const saved = store.getState().saveAdvisorAppointment(body(store, {
      lines: [{ id: "a", code: "A", concern: "Long", laborOpId: misc.id, hours: 4.1 }],
    }));
    assert.equal(saved.ok, true, saved.error ?? "");
    const row = store.getState().appointments.find((item) => item.id === saved.appointmentId);
    assert.equal(row?.minutes, 270);
    assert.equal(row?.lines[0]?.hours, 4.1);
    for (const minutes of [31, 45]) {
      const refused = store.getState().saveAdvisorAppointment(body(store, { time: "11:00", minutes, lines: [{ id: "a", code: "A", concern: "Odd" }], laborOpIds: [] }));
      assert.match(refused.error ?? "", /not on this desk/, String(minutes));
      const { status: _status, ...addable } = body(store, { time: "11:30", minutes, lines: [{ id: "a", code: "A", concern: "Odd" }], laborOpIds: [] });
      const added = store.getState().addAppointment(addable);
      assert.equal(added, "", String(minutes));
      const updated = store.getState().updateAppointment(saved.appointmentId, { minutes });
      assert.match(updated.error ?? "", /not on this desk/);
    }
    assert.equal(store.getState().appointments.length, before + 1);
    assert.equal(store.getState().appointments.find((item) => item.id === saved.appointmentId)?.minutes, 270);
  });

  it("judges a paste by the block length for overload and for the past-close reason", () => {
    const store = shop();
    const { misc } = party(store);
    const fill = store.getState().saveAdvisorAppointment(body(store, {
      time: "08:00",
      lines: [{ id: "a", code: "A", concern: "Fill", laborOpId: misc.id, hours: 6 }],
    }));
    assert.equal(fill.ok, true, fill.error ?? "");
    const source = store.getState().appointments.find((row) => row.id === fill.appointmentId);
    assert.ok(source);
    const copy = copiedFrom(source);
    const before = store.getState().appointments.length;
    const asked = commitPaste(store, { ...pasteAppointmentInput(copy, { date: friday, time: "11:00", techId: "marcus" }), minutes: 60 });
    assert.equal(asked.needsOverride, true);
    assert.match(asked.warning ?? "", /overload/);
    assert.equal(store.getState().appointments.length, before);
    const late = commitPaste(store, {
      ...pasteAppointmentInput(copy, { date: friday, time: "16:00", techId: "elena" }),
      minutes: 30,
      lines: [{ id: "a", code: "A", concern: "Late", laborOpId: misc.id, hours: 3 }],
      laborOpIds: [misc.id],
    });
    assert.equal(late.ok, false);
    assert.match(late.error ?? "", new RegExp(PAST_CLOSE_MESSAGE.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
    assert.equal(store.getState().appointments.some((row) => row.time === "16:00" && row.techId === "elena"), false);
  });

  it("checks capacity on update from the final length", () => {
    const store = shop();
    const { misc } = party(store);
    const first = store.getState().saveAdvisorAppointment(body(store, {
      time: "08:00",
      lines: [{ id: "a", code: "A", concern: "Fill", laborOpId: misc.id, hours: 6 }],
    }));
    const second = store.getState().saveAdvisorAppointment(body(store, {
      time: "11:00",
      lines: [{ id: "a", code: "A", concern: "Short", laborOpId: misc.id, hours: 1 }],
    }));
    assert.equal(first.ok && second.ok, true);
    const before = store.getState().overrides.length;
    const edited = store.getState().updateAppointment(second.appointmentId, {
      lines: [{ id: "a", code: "A", concern: "Short", laborOpId: misc.id, hours: 6 }],
    });
    assert.equal(edited.ok, true, edited.error ?? "");
    assert.equal(store.getState().appointments.find((row) => row.id === second.appointmentId)?.minutes, 360);
    assert.ok(store.getState().overrides.length > before);
  });

  it("refuses an empty advisor id and ignores a non-finite length in the load", () => {
    const store = shop();
    const saved = store.getState().saveAdvisorAppointment(body(store));
    assert.equal(saved.ok, true, saved.error ?? "");
    const refused = store.getState().updateAppointment(saved.appointmentId, { advisorId: "" });
    assert.equal(refused.ok, false);
    assert.match(refused.error ?? "", /advisor/);
    assert.equal(store.getState().appointments.find((row) => row.id === saved.appointmentId)?.advisorId, "megan");
    const loads = appointmentLoads([
      { id: "bad", date: friday, time: "09:00", minutes: Number.NaN, advisorId: "megan", techId: "marcus", laborOpIds: [], status: "scheduled" },
      { id: "huge", date: friday, time: "10:00", minutes: Number.POSITIVE_INFINITY, advisorId: "megan", techId: "marcus", laborOpIds: [], status: "scheduled" },
    ], []);
    assert.equal(Number.isFinite(loads[0]?.laborHours), true);
    assert.equal(Number.isFinite(loads[1]?.laborHours), true);
    assert.equal(loads[0]?.laborHours, 0);
    assert.equal(loads[1]?.laborHours, 0);
  });

  it("marks a line with no labor op before it asks for a past-close reason", () => {
    const store = shop("derek");
    const state = store.getState();
    const { customer, vehicle, misc } = party(store);
    const host = document.createElement("div");
    document.body.appendChild(host);
    const root = createRoot(host);
    flushSync(() => {
      root.render(createElement(AppointmentFields, {
        initial: {
          date: friday, time: "16:00", minutes: 180, customerId: customer.id, vehicleId: vehicle.id,
          advisorId: "derek", techId: "marcus", concern: "Late",
          lines: [
            { id: "a", code: "A", concern: "Late", laborOpId: misc.id, hours: 3 },
            { id: "b", code: "B", concern: "Also the noise", hours: 0.1 },
          ],
          vin: vehicle.vin, laborOpIds: [misc.id], lane: "drop", status: "scheduled",
        },
        customers: state.customers, vehicles: state.vehicles, advisors: state.advisors, techs: state.techs,
        laborOps: state.laborOps, transports: state.settings.scheduling.transportOptions,
        submitLabel: "Save", manager: true, scheduling: state.settings.scheduling,
        onSubmit: () => "should not ask yet",
      }));
    });
    assert.ok(host.querySelector("[data-line-error]"));
    assert.equal(host.querySelector("[aria-label='Reason for running past close']"), null);
    assert.equal(host.querySelector<HTMLSelectElement>("[aria-label='Visit length']")?.value, "180");
    flushSync(() => root.unmount());
    host.remove();
  });

  it("resizes a 30-minute card from the touch pad under it", async () => {
    const moves: { minutes: number }[] = [];
    const card: Appointment = {
      id: "short", date: friday, time: "09:00", minutes: 30, customerId: "c", vehicleId: "v", advisorId: "megan",
      concern: "Oil", lines: [{ id: "a", code: "A", concern: "Oil" }], vin: "", laborOpIds: [],
      techId: "marcus", lane: "drop", status: "scheduled", orderId: null,
    };
    const host = document.createElement("div");
    host.style.width = "390px";
    document.body.appendChild(host);
    const root = createRoot(host);
    flushSync(() => {
      root.render(createElement(AppointmentCalendar, {
        appointments: [card],
        day: friday,
        techs: [{ id: "marcus", number: "1", name: "Marcus", board: "main" }],
        selectedId: "short",
        onSelect: () => undefined,
        onSlot: () => undefined,
        onMove: (_id, patch) => moves.push({ minutes: patch.minutes }),
        onWrite: () => undefined,
        onEdit: () => undefined,
        label: () => "Oil",
        summary: () => ({ name: "Pat", vehicle: "Ford", advisor: "Megan", tech: "Marcus", when: "9:00", lane: "Drop", concern: "Oil", vin: "", ops: "", status: "Scheduled", canWrite: false }),
        hoursFor: () => 0.5,
      }));
    });
    const pad = host.querySelector<HTMLElement>("[data-resize-pad]");
    const concern = host.querySelector<HTMLElement>("[data-concern]");
    assert.ok(pad);
    assert.equal(pad.closest("[data-appt]"), null);
    assert.equal(pad.style.height, "24px");
    const pointer = window.PointerEvent;
    pad.dispatchEvent(new pointer("pointerdown", { bubbles: true, button: 0, pointerId: 3, pointerType: "touch", isPrimary: true, clientX: 40, clientY: 200 }));
    window.dispatchEvent(new pointer("pointermove", { bubbles: true, button: 0, pointerId: 3, pointerType: "touch", isPrimary: true, clientX: 40, clientY: 232 }));
    window.dispatchEvent(new pointer("pointerup", { bubbles: true, button: 0, pointerId: 3, pointerType: "touch", isPrimary: true, clientX: 40, clientY: 232 }));
    assert.equal(moves[0]?.minutes, 60);
    assert.ok(concern);
    flushSync(() => root.unmount());
    host.remove();

    const html = renderToStaticMarkup(createElement(AppointmentCalendar, {
      appointments: [card],
      day: friday,
      techs: [{ id: "marcus", number: "1", name: "Marcus", board: "main" }],
      selectedId: "short",
      onSelect: () => undefined,
      onSlot: () => undefined,
      onMove: () => undefined,
      onWrite: () => undefined,
      onEdit: () => undefined,
      label: () => "Oil",
      summary: () => ({ name: "Pat", vehicle: "Ford", advisor: "Megan", tech: "Marcus", when: "9:00", lane: "Drop", concern: "Oil", vin: "", ops: "", status: "Scheduled", canWrite: false }),
      hoursFor: () => 0.5,
    }));
    const source = readFileSync(new URL("../styles.css", import.meta.url), "utf8");
    const compiled = await compile(source, { base: new URL("..", import.meta.url).pathname, onDependency() {} });
    const classes = [...html.matchAll(/class="([^"]+)"/g)].flatMap((match) => match[1].split(/\s+/));
    const css = compiled.build([...new Set(classes)]);
    const browser = await chromium.launch({ headless: true });
    try {
      const page = await browser.newPage({ viewport: { width: 390, height: 800 } });
      await page.setContent(`<!doctype html><html><head><style>${css}</style></head><body style="margin:0">${html}</body></html>`);
      const box = await page.evaluate(() => {
        const cardBox = document.querySelector("[data-appt]")?.getBoundingClientRect();
        const padBox = document.querySelector("[data-resize-pad]")?.getBoundingClientRect();
        const text = document.querySelector("[data-concern]")?.getBoundingClientRect();
        return {
          card: cardBox ? { top: cardBox.top, bottom: cardBox.bottom } : null,
          pad: padBox ? { top: padBox.top, bottom: padBox.bottom, height: padBox.height } : null,
          text: text ? { top: text.top, bottom: text.bottom } : null,
        };
      });
      assert.ok(box.card && box.pad && box.text);
      assert.ok(box.pad.height >= 24);
      assert.ok(box.pad.top >= box.card.bottom - 1);
      assert.ok(box.text.bottom <= box.card.bottom + 1);
    } finally {
      await browser.close();
    }
  });
});
