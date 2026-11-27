import "./test-dom.ts";
import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import { createElement } from "react";
import { flushSync } from "react-dom";
import { createRoot } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { chromium } from "playwright";
import { AppointmentCalendar } from "../components/appointment-calendar.tsx";
import { AppointmentFields } from "../routes/schedule.tsx";
import { pinClock, resetClock } from "./clock.ts";
import { copyStorageKey, readCopiedVisit, saveCopiedVisit } from "./copied-visit.ts";
import { deskBlockMinutes, linesForDesk } from "./labor-lines.ts";
import { copiedFrom, copyWorkerKey, useDeskCopy } from "./paste-appointment.ts";
import type { ShopStorage } from "./shop-storage.ts";
import { createShopStore } from "./store.ts";
import { readTabWorker, writeTabWorker } from "./tab-worker.ts";
import type { Appointment } from "./types.ts";

afterEach(() => resetClock());

const when = "2026-11-16T20:00:00.000Z";
const friday = "2026-11-20";

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
  const customer = state.customers.find((row) => state.vehicles.some((vehicle) => vehicle.customerId === row.id)) ?? state.customers[0];
  const vehicle = state.vehicles.find((row) => row.customerId === customer?.id) ?? state.vehicles[0];
  const lof = state.laborOps.find((op) => op.opcode === "LOF");
  const rot = state.laborOps.find((op) => op.opcode === "ROT");
  assert.ok(customer && vehicle && lof && rot);
  return { customer, vehicle, lof, rot };
}

describe("round 31 seeded lines and a lasting Working as", () => {
  it("loads seeded a9 at the visit length and saves 120 after a half hour is added", () => {
    const store = shop("alicia");
    const visit = store.getState().appointments.find((row) => row.id === "a9");
    const { rot } = party(store);
    assert.ok(visit);
    const loaded = linesForDesk(visit.lines, visit.laborOpIds, visit.minutes, store.getState().laborOps, visit.lengthOverrideMinutes);
    assert.equal(loaded[0]?.hours, 1.5);
    const opened = 90;
    const withHalf = [
      { ...loaded[0], concern: loaded[0]?.concern || "Oil" },
      { id: "b", code: "B", concern: "Rotate", laborOpId: rot.id, hours: 0.5 },
    ];
    assert.equal(deskBlockMinutes({ openedMinutes: opened, openedLineMinutes: 0, lineMinutes: 30, override: null }), 120);
    assert.equal(deskBlockMinutes({
      openedMinutes: visit.minutes,
      openedLineMinutes: (loaded[0]?.hours ?? 0) * 60,
      lineMinutes: ((loaded[0]?.hours ?? 0) + 0.5) * 60,
      override: null,
    }), 120);
    const { id: _id, orderId: _orderId, ...editable } = visit;
    const saved = store.getState().saveAdvisorAppointment({
      ...editable,
      lines: withHalf,
      laborOpIds: [visit.laborOpIds[0], rot.id],
      minutes: 120,
      lengthOverrideMinutes: null,
    }, visit.id);
    assert.equal(saved.ok, true, saved.error ?? "");
    assert.equal(store.getState().appointments.find((row) => row.id === "a9")?.minutes, 120);
    assert.equal(store.getState().appointments.find((row) => row.id === "a9")?.lines[0]?.hours, 1.5);
  });

  it("keeps Working as for this tab only", () => {
    const here = memoryStorage();
    const nextTab = memoryStorage();
    writeTabWorker(here, "megan");
    assert.equal(readTabWorker(here), "megan");
    assert.equal(readTabWorker(nextTab), "");
    writeTabWorker(here, "");
    assert.equal(readTabWorker(here), "");
  });
});

describe("round 31 copy clearing and storage", () => {
  it("clears the copy when Working as goes blank and then to someone else, and on a store switch", () => {
    const store = shop("jordan");
    const { customer, vehicle, lof } = party(store);
    const saved = store.getState().saveAdvisorAppointment({
      date: friday, time: "09:00", minutes: 60, customerId: customer.id, vehicleId: vehicle.id,
      advisorId: "jordan", techId: "elena", concern: "Oil", lines: [{ id: "a", code: "A", concern: "Oil", laborOpId: lof.id, hours: 1 }],
      vin: vehicle.vin, laborOpIds: [lof.id], lane: "drop", status: "scheduled",
    });
    assert.equal(saved.ok, true, saved.error ?? "");
    const row = store.getState().appointments.find((item) => item.id === saved.appointmentId);
    assert.ok(row);
    const storeId = store.getState().activeStoreId;
    const jordanKey = copyWorkerKey(store.getState());
    saveCopiedVisit(localStorage, { workingAsId: "jordan", storeId, workerKey: jordanKey, copy: copiedFrom(row) });
    const host = document.createElement("div");
    document.body.appendChild(host);
    const root = createRoot(host);
    function Probe({ workingAsId, workerKey, activeStore }: { workingAsId: string; workerKey: string; activeStore: string }) {
      const copy = useDeskCopy(workingAsId, activeStore, workerKey, () => "", (customerId) => store.getState().customers.find((item) => item.id === customerId)?.name ?? "");
      return createElement("p", null, copy.name || "none");
    }
    const show = (props: { workingAsId: string; workerKey: string; activeStore: string }) => {
      flushSync(() => root.render(createElement(Probe, props)));
    };
    show({ workingAsId: "jordan", workerKey: jordanKey, activeStore: storeId });
    assert.equal(host.textContent, customer.name, localStorage.getItem(copyStorageKey("jordan", storeId)) ?? "missing");
    show({ workingAsId: "", workerKey: `|${storeId}||`, activeStore: storeId });
    show({ workingAsId: "megan", workerKey: jordanKey.replace("|jordan|", "|megan|"), activeStore: storeId });
    assert.equal(host.textContent, "none");
    assert.equal(readCopiedVisit(localStorage, "jordan", storeId, jordanKey), null);
    saveCopiedVisit(localStorage, { workingAsId: "megan", storeId, workerKey: jordanKey.replace("|jordan|", "|megan|"), copy: copiedFrom(row) });
    flushSync(() => root.render(null));
    show({ workingAsId: "megan", workerKey: jordanKey.replace("|jordan|", "|megan|"), activeStore: storeId });
    assert.equal(host.textContent, customer.name);
    const pullmanKey = jordanKey.replace("|jordan|", "|megan|").replace(storeId, "pullman");
    show({ workingAsId: "megan", workerKey: pullmanKey, activeStore: "pullman" });
    assert.equal(host.textContent, "none");
    assert.equal(localStorage.getItem(copyStorageKey("megan", storeId)), null);
    flushSync(() => root.unmount());
    host.remove();
  });

  it("stores the customer id only and drops the copy when another tab clears storage", () => {
    const store = shop();
    const { customer, vehicle, lof } = party(store);
    const copy = copiedFrom({
      id: "x", date: friday, time: "09:00", minutes: 60, customerId: customer.id, vehicleId: vehicle.id,
      advisorId: "megan", techId: "elena", concern: "Oil", lines: [{ id: "a", code: "A", concern: "Oil", laborOpId: lof.id, hours: 1 }],
      vin: "1FTFW1E59NFA12345", laborOpIds: [lof.id], lane: "drop", status: "scheduled", orderId: null,
    });
    const workerKey = copyWorkerKey(store.getState());
    saveCopiedVisit(localStorage, {
      workingAsId: "megan",
      storeId: store.getState().activeStoreId,
      workerKey,
      copy: { ...copy, phone: "5095550100", email: "a@b.com", address: "1 Main" } as typeof copy,
    });
    const raw = localStorage.getItem(copyStorageKey("megan", store.getState().activeStoreId)) ?? "";
    assert.equal(raw.includes(customer.name), false);
    assert.equal(raw.includes("5095550100"), false);
    assert.equal(raw.includes("a@b.com"), false);
    assert.equal(raw.includes("1 Main"), false);
    assert.equal(raw.includes("1FTFW1E59NFA12345"), false);
    assert.match(raw, new RegExp(customer.id));
    const huge = "x".repeat(5000);
    saveCopiedVisit(localStorage, {
      workingAsId: "megan",
      storeId: store.getState().activeStoreId,
      workerKey,
      copy: { ...copy, concern: huge },
    });
    assert.equal(localStorage.getItem(copyStorageKey("megan", store.getState().activeStoreId))?.includes(huge) ?? false, false);
    saveCopiedVisit(localStorage, { workingAsId: "megan", storeId: store.getState().activeStoreId, workerKey, copy });
    const host = document.createElement("div");
    document.body.appendChild(host);
    const root = createRoot(host);
    flushSync(() => {
      root.render(createElement(() => {
        const desk = useDeskCopy("megan", store.getState().activeStoreId, workerKey, () => "", () => customer.name);
        return createElement("p", null, desk.name || "none");
      }));
    });
    assert.equal(host.textContent, customer.name);
    const cleared = new window.Event("storage");
    Object.defineProperty(cleared, "key", { value: null });
    Object.defineProperty(cleared, "newValue", { value: null });
    flushSync(() => { window.dispatchEvent(cleared); });
    assert.equal(host.textContent, "none");
    flushSync(() => root.unmount());
    host.remove();
  });
});

describe("round 31 overlap confirm and a moved visit", () => {
  it("requires a real true before a lengthening update writes the technician-hours row", () => {
    const store = shop();
    const { customer, vehicle, lof } = party(store);
    const other = store.getState().customers.find((row) => row.id !== customer.id);
    const otherVehicle = store.getState().vehicles.find((row) => row.customerId === other?.id);
    assert.ok(other && otherVehicle);
    const fill = store.getState().saveAdvisorAppointment({
      date: friday, time: "08:00", minutes: 360, customerId: customer.id, vehicleId: vehicle.id,
      advisorId: "megan", techId: "elena", concern: "Fill", lines: [{ id: "a", code: "A", concern: "Fill", laborOpId: lof.id, hours: 6 }],
      vin: vehicle.vin, laborOpIds: [lof.id], lane: "drop", status: "scheduled",
    });
    assert.equal(fill.ok, true, fill.error ?? "");
    const short = store.getState().saveAdvisorAppointment({
      date: friday, time: "10:00", minutes: 60, customerId: other.id, vehicleId: otherVehicle.id,
      advisorId: "derek", techId: "elena", concern: "Short", lines: [{ id: "b", code: "A", concern: "Short", laborOpId: lof.id, hours: 1 }],
      vin: otherVehicle.vin, laborOpIds: [lof.id], lane: "drop", status: "scheduled",
    });
    assert.equal(short.ok, true, short.error ?? "");
    const before = store.getState().overrides.length;
    const asked = store.getState().updateAppointment(short.appointmentId, {
      lines: [{ id: "b", code: "A", concern: "Short", laborOpId: lof.id, hours: 5 }],
      minutes: 300,
      lengthOverrideMinutes: null,
    });
    assert.equal(asked.ok, false, JSON.stringify(asked));
    assert.equal(asked.needsOverride, true, JSON.stringify(asked));
    assert.equal(store.getState().appointments.find((row) => row.id === short.appointmentId)?.minutes, 60);
    assert.equal(store.getState().overrides.length, before);
    const fuzzy = store.getState().updateAppointment(short.appointmentId, {
      lines: [{ id: "b", code: "A", concern: "Short", laborOpId: lof.id, hours: 5 }],
      minutes: 300,
      lengthOverrideMinutes: null,
    }, undefined, false, 1 as unknown as boolean);
    assert.equal(fuzzy.needsOverride, true);
    assert.equal(store.getState().overrides.length, before);
    const kept = store.getState().updateAppointment(short.appointmentId, {
      lines: [{ id: "b", code: "A", concern: "Short", laborOpId: lof.id, hours: 5 }],
      minutes: 300,
      lengthOverrideMinutes: null,
    }, undefined, false, true);
    assert.equal(kept.ok, true, kept.error ?? "");
    assert.equal(store.getState().appointments.find((row) => row.id === short.appointmentId)?.minutes, 300);
    assert.equal(store.getState().overrides.filter((row) => row.appointmentId === short.appointmentId && row.reason === "tech-hours").length, 1);
  });

  it("asks before a form save moves a visit onto the same advisor", () => {
    const store = shop();
    const state = store.getState();
    const { customer, vehicle, lof } = party(store);
    const other = state.customers.find((row) => row.id !== customer.id);
    const otherVehicle = state.vehicles.find((row) => row.customerId === other?.id);
    assert.ok(other && otherVehicle);
    const first = store.getState().saveAdvisorAppointment({
      date: friday, time: "09:00", minutes: 60, customerId: customer.id, vehicleId: vehicle.id,
      advisorId: "megan", techId: "elena", concern: "Oil", lines: [{ id: "a", code: "A", concern: "Oil", laborOpId: lof.id, hours: 1 }],
      vin: vehicle.vin, laborOpIds: [lof.id], lane: "drop", status: "scheduled",
    });
    const second = store.getState().saveAdvisorAppointment({
      date: friday, time: "11:00", minutes: 60, customerId: other.id, vehicleId: otherVehicle.id,
      advisorId: "megan", techId: "marcus", concern: "Rotate", lines: [{ id: "b", code: "A", concern: "Rotate", laborOpId: lof.id, hours: 1 }],
      vin: otherVehicle.vin, laborOpIds: [lof.id], lane: "drop", status: "scheduled",
    });
    assert.equal(first.ok && second.ok, true);
    const current = store.getState().appointments.find((row) => row.id === second.appointmentId);
    assert.ok(current);
    const host = document.createElement("div");
    document.body.appendChild(host);
    const root = createRoot(host);
    flushSync(() => {
      root.render(createElement(AppointmentFields, {
        initial: current,
        customers: state.customers, vehicles: state.vehicles, advisors: state.advisors, techs: state.techs,
        laborOps: state.laborOps, transports: state.settings.scheduling.transportOptions,
        submitLabel: "Save changes", scheduling: state.settings.scheduling,
        onSubmit: (value, _transfer, _reason, _close, confirmDouble) => {
          const result = store.getState().saveAdvisorAppointment(value, current.id, undefined, undefined, undefined, confirmDouble === true);
          if (!result.ok && result.needsDoubleBook) return { error: null, needsDoubleBook: true, warning: result.warning ?? null };
          return result.ok ? null : result.error;
        },
      }));
    });
    const starts = host.querySelector<HTMLSelectElement>("[aria-label='Starts']");
    assert.ok(starts);
    flushSync(() => {
      starts.value = "09:30";
      starts.dispatchEvent(new Event("change", { bubbles: true }));
    });
    flushSync(() => host.querySelector("form")?.requestSubmit());
    assert.ok(host.querySelector("[data-double-book]"));
    const leave = [...host.querySelectorAll("button")].find((button) => button.textContent === "Leave it");
    flushSync(() => leave?.click());
    assert.equal(store.getState().appointments.find((row) => row.id === current.id)?.time, "11:00");
    assert.equal(store.getState().overrides.filter((row) => row.reason === "double-book").length, 0);
    flushSync(() => host.querySelector("form")?.requestSubmit());
    const keep = [...host.querySelectorAll("button")].find((button) => button.textContent === "Keep both");
    flushSync(() => keep?.click());
    assert.equal(store.getState().appointments.find((row) => row.id === current.id)?.time, "09:30");
    assert.equal(store.getState().overrides.filter((row) => row.appointmentId === current.id && row.reason === "double-book").length, 1);
    flushSync(() => root.unmount());
    host.remove();
  });

  it("does not submit a lengthening edit until Book it anyway is chosen", () => {
    const store = shop();
    const state = store.getState();
    const { customer, vehicle, lof } = party(store);
    let submits = 0;
    const host = document.createElement("div");
    document.body.appendChild(host);
    const root = createRoot(host);
    flushSync(() => {
      root.render(createElement(AppointmentFields, {
        initial: {
          date: friday, time: "09:00", minutes: 60, customerId: customer.id, vehicleId: vehicle.id,
          advisorId: "megan", techId: "elena", concern: "Oil", lines: [{ id: "a", code: "A", concern: "Oil", laborOpId: lof.id, hours: 1 }],
          vin: vehicle.vin, laborOpIds: [lof.id], lane: "drop", status: "scheduled",
        },
        customers: state.customers, vehicles: state.vehicles, advisors: state.advisors, techs: state.techs,
        laborOps: state.laborOps, transports: state.settings.scheduling.transportOptions,
        submitLabel: "Save changes", scheduling: state.settings.scheduling,
        capacityFor: () => ({ blocked: null, warning: "Elena Voss would have 11.0 hr booked on Fri Nov 20 (10.0 hr available)." }),
        onSubmit: () => { submits += 1; return null; },
      }));
    });
    assert.equal(host.querySelector("button[type='submit']"), null);
    assert.ok([...host.querySelectorAll("button")].some((button) => button.textContent === "Book it anyway"));
    flushSync(() => host.querySelector("form")?.requestSubmit());
    assert.equal(submits, 0);
    const anyway = [...host.querySelectorAll("button")].find((button) => button.textContent === "Book it anyway");
    flushSync(() => anyway?.click());
    assert.equal(submits, 1);
    flushSync(() => root.unmount());
    host.remove();
  });
});

function cardBox(id: string) {
  return {
    id, date: friday, time: "09:00", minutes: 120, customerId: "c", vehicleId: "v", advisorId: "megan",
    concern: id, lines: [], vin: "", laborOpIds: [], techId: "elena", lane: "drop" as const, status: "scheduled" as const, orderId: null,
  };
}

describe("round 31 side by side stays in the column", () => {
  it("keeps 2-lane and 3-lane cards inside their column at phone, tablet, and desktop", async () => {
    const two: Appointment[] = [
      { ...cardBox("e1"), techId: "elena", time: "09:00", minutes: 60, concern: "Elena one" },
      { ...cardBox("e2"), techId: "elena", time: "09:30", minutes: 60, concern: "Elena two" },
    ];
    const three: Appointment[] = [
      { ...cardBox("m1"), techId: "marcus", time: "09:00", minutes: 120, concern: "Marcus one" },
      { ...cardBox("m2"), techId: "marcus", time: "09:30", minutes: 90, concern: "Marcus two" },
      { ...cardBox("m3"), techId: "marcus", time: "10:00", minutes: 60, concern: "Marcus three" },
    ];
    const markup = renderToStaticMarkup(createElement(AppointmentCalendar, {
      appointments: [...two, ...three],
      day: friday,
      techs: [
        { id: "elena", number: "1", name: "Elena", board: "main" },
        { id: "marcus", number: "2", name: "Marcus", board: "main" },
        { id: "andre", number: "3", name: "Andre", board: "main" },
      ],
      selectedId: null, onSelect: () => undefined, onSlot: () => undefined, onMove: () => undefined,
      onWrite: () => undefined, onEdit: () => undefined, label: (row) => row.concern,
      summary: () => ({ name: "Pat", vehicle: "Ford", advisor: "Megan", tech: "Elena", when: "9:00", lane: "Drop", concern: "Oil", vin: "", ops: "", status: "Scheduled", canWrite: false }),
      hoursFor: () => 1,
    }));
    assert.match(markup, /minmax\(18rem, 1fr\)/);
    assert.match(markup, /minmax\(27rem, 1fr\)/);
    const browser = await chromium.launch({ headless: true });
    try {
      const page = await browser.newPage();
      await page.setContent(`<!doctype html><body style="margin:0">${markup}</body>`);
      const widths: Record<string, number> = {};
      for (const width of [390, 820, 1280]) {
        await page.setViewportSize({ width, height: 800 });
        const measured = await page.evaluate(() => {
          const read = (tech: string) => {
            const column = document.querySelector<HTMLElement>(`[data-tech='${tech}']`);
            const next = column?.nextElementSibling as HTMLElement | null;
            column?.scrollIntoView({ inline: "center", block: "center" });
            const box = column?.getBoundingClientRect();
            const nextLeft = next?.getBoundingClientRect().left ?? 0;
            const cards = [...(column?.querySelectorAll<HTMLElement>("[data-appt]") ?? [])].map((card) => {
              const rect = card.getBoundingClientRect();
              const hit = document.elementFromPoint(rect.left + rect.width / 2, rect.top + Math.min(rect.height / 2, 20));
              return {
                id: card.getAttribute("data-appt-id"),
                width: rect.width,
                right: rect.right,
                hit: hit?.closest("[data-appt]")?.getAttribute("data-appt-id") ?? "",
              };
            });
            return { width: box?.width ?? 0, right: box?.right ?? 0, nextLeft, lanes: column?.getAttribute("data-lanes"), cards };
          };
          return { elena: read("elena"), marcus: read("marcus") };
        });
        assert.equal(measured.elena.lanes, "2");
        assert.equal(measured.marcus.lanes, "3");
        for (const card of measured.elena.cards) {
          assert.ok(card.width >= 120, `${width} 2-lane card is ${Math.round(card.width)}px`);
          assert.equal(card.hit, card.id, `${width} 2-lane tap missed ${card.id}`);
          widths[`${width}-2`] = Math.round(card.width);
        }
        for (const card of measured.marcus.cards) {
          assert.ok(card.width >= 120, `${width} 3-lane card is ${Math.round(card.width)}px in a ${Math.round(measured.marcus.width)}px column`);
          assert.ok(card.right <= measured.marcus.right + 1, `${width} 3-lane card ends at ${Math.round(card.right)} past the column ${Math.round(measured.marcus.right)}`);
          assert.equal(card.hit, card.id, `${width} 3-lane tap missed ${card.id}`);
          widths[`${width}-3`] = Math.round(card.width);
        }
        assert.ok(measured.marcus.right <= measured.marcus.nextLeft + 1, `${width} the 3-lane column ends at ${Math.round(measured.marcus.right)} and the next starts at ${Math.round(measured.marcus.nextLeft)}`);
      }
      console.log(JSON.stringify(widths));
    } finally {
      await browser.close();
    }
  });
});
