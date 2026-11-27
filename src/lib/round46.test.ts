import "./test-dom.ts";
import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import { createElement } from "react";
import { flushSync } from "react-dom";
import { createRoot } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { AppointmentCalendar } from "../components/appointment-calendar.tsx";
import { AppointmentFields } from "../routes/schedule.tsx";
import { clearCopiedVisits, readCopiedVisit, saveCopiedVisit, type StoredCopy } from "./copied-visit.ts";
import { pinClock, resetClock } from "./clock.ts";
import { deskBlockMinutes, linesForDesk } from "./labor-lines.ts";
import { commitPaste, copiedFrom, copyWorkerKey, pasteAppointmentInput } from "./paste-appointment.ts";
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

class MemoryCopyStorage {
  private items = new Map<string, string>();
  get length() { return this.items.size; }
  key(index: number) { return [...this.items.keys()][index] ?? null; }
  getItem(key: string) { return this.items.get(key) ?? null; }
  setItem(key: string, value: string) { this.items.set(key, value); }
  removeItem(key: string) { this.items.delete(key); }
}

function shop(who = "megan") {
  pinClock(when);
  const store = createShopStore({ demoMode: true, storage: memoryStorage() });
  store.getState().setWorkingAs(who);
  return store;
}

function body(store: ReturnType<typeof shop>, patch: Partial<Appointment> = {}): Omit<Appointment, "id" | "orderId"> {
  const state = store.getState();
  const customer = state.customers.find((row) => state.vehicles.some((vehicle) => vehicle.customerId === row.id)) ?? state.customers[0];
  const vehicle = state.vehicles.find((row) => row.customerId === customer.id) ?? state.vehicles[0];
  const misc = state.laborOps.find((op) => op.opcode === "MISC");
  assert.ok(customer && vehicle && misc);
  return {
    date: friday, time: "09:00", minutes: 60, customerId: customer.id, vehicleId: vehicle.id,
    advisorId: "megan", techId: "elena", concern: "Oil", lines: [{ id: "a", code: "A", concern: "Oil", laborOpId: misc.id, hours: 1 }],
    vin: vehicle.vin, laborOpIds: [misc.id], lane: "drop", status: "scheduled", ...patch,
  };
}

describe("round 29 lines, overlap, and a lasting copy", () => {
  it("loads a seeded visit's labor op and hours and does not shrink it when a line is added", () => {
    const store = shop();
    const state = store.getState();
    const seeded = state.appointments.find((row) => row.laborOpIds.length > 0 && row.lines.some((line) => !line.laborOpId));
    assert.ok(seeded, "the sample month has a visit whose lines have not stored an op");
    const loaded = linesForDesk(seeded.lines, seeded.laborOpIds, seeded.minutes, state.laborOps, seeded.lengthOverrideMinutes);
    assert.equal(loaded.every((line) => line.laborOpId), true);
    assert.equal(loaded.some((line) => typeof line.hours === "number" && line.hours > 0), true);
    const host = document.createElement("div");
    document.body.appendChild(host);
    const root = createRoot(host);
    flushSync(() => {
      root.render(createElement(AppointmentFields, {
        initial: { ...seeded, lengthOverrideMinutes: seeded.lengthOverrideMinutes ?? null },
        customers: state.customers, vehicles: state.vehicles, advisors: state.advisors, techs: state.techs,
        laborOps: state.laborOps, transports: state.settings.scheduling.transportOptions,
        submitLabel: "Save changes", showStatus: true, scheduling: state.settings.scheduling, onSubmit: () => null,
      }));
    });
    const op = host.querySelector<HTMLSelectElement>("[aria-label='Labor op for line A']");
    const hours = host.querySelector<HTMLInputElement>("[aria-label='Hours for line A']");
    const length = host.querySelector<HTMLSelectElement>("[aria-label='Visit length']");
    assert.ok(op && hours && length);
    assert.notEqual(op.value, "");
    assert.equal(host.textContent?.includes("Choose a labor op.") && op.value === "", false);
    assert.ok(Number(hours.value) > 0);
    assert.ok(Number(length.value) >= seeded.minutes);
    flushSync(() => root.unmount());
    host.remove();

    assert.equal(deskBlockMinutes({ openedMinutes: 90, openedLineMinutes: 90, lineMinutes: 120, override: null }), 120);
    assert.equal(deskBlockMinutes({ openedMinutes: 90, openedLineMinutes: 0, lineMinutes: 30, override: null }), 120);
    assert.equal(deskBlockMinutes({ openedMinutes: 90, openedLineMinutes: 90, lineMinutes: 60, override: 90 }), 90);
  });

  it("refuses a labor line with a blank concern and does not count it in the length", () => {
    const store = shop();
    const saved = store.getState().saveAdvisorAppointment(body(store));
    assert.equal(saved.ok, true, saved.error ?? "");
    const before = store.getState().appointments.find((row) => row.id === saved.appointmentId);
    const refused = store.getState().saveAdvisorAppointment({
      ...body(store),
      minutes: 120,
      lines: [
        { id: "a", code: "A", concern: "Oil", laborOpId: body(store).laborOpIds[0], hours: 1 },
        { id: "b", code: "B", concern: "   ", laborOpId: body(store).laborOpIds[0], hours: 1 },
      ],
    }, saved.appointmentId);
    assert.equal(refused.ok, false);
    assert.equal(refused.error, "Add a concern for this labor op.");
    assert.equal(store.getState().appointments.find((row) => row.id === saved.appointmentId)?.minutes, before?.minutes);
    assert.equal(store.getState().appointments.find((row) => row.id === saved.appointmentId)?.lines.length, 1);
  });

  it("asks before a saved length overlaps the same advisor and writes one row only when kept", () => {
    const store = shop();
    const first = store.getState().saveAdvisorAppointment(body(store, { time: "09:00", minutes: 60 }));
    const other = store.getState().customers.find((row) => row.id !== store.getState().appointments.find((item) => item.id === first.appointmentId)?.customerId);
    const vehicle = store.getState().vehicles.find((row) => row.customerId === other?.id);
    assert.ok(first.ok && other && vehicle);
    const second = store.getState().saveAdvisorAppointment(body(store, {
      time: "10:00", minutes: 60, customerId: other.id, vehicleId: vehicle.id, vin: vehicle.vin,
    }));
    assert.equal(second.ok, true, second.error ?? "");
    const current = store.getState().appointments.find((row) => row.id === first.appointmentId);
    assert.ok(current);
    const before = store.getState().overrides.length;
    const longer = body(store, {
      time: "09:00",
      minutes: 120,
      customerId: current.customerId,
      vehicleId: current.vehicleId,
      vin: current.vin,
      lines: [{ id: "a", code: "A", concern: "Oil", laborOpId: current.laborOpIds[0], hours: 2 }],
      laborOpIds: current.laborOpIds,
    });
    const asked = store.getState().saveAdvisorAppointment(longer, current.id);
    assert.equal(asked.ok, false);
    assert.equal(asked.needsDoubleBook, true, JSON.stringify(asked));
    assert.match(asked.warning ?? "", /double-books the advisor/);
    assert.equal(store.getState().appointments.find((row) => row.id === current.id)?.minutes, 60);
    assert.equal(store.getState().overrides.length, before);
    const kept = store.getState().saveAdvisorAppointment(longer, current.id, undefined, undefined, undefined, true);
    assert.equal(kept.ok, true, kept.error ?? "");
    assert.equal(store.getState().appointments.find((row) => row.id === current.id)?.minutes, 120);
    const rows = store.getState().overrides.filter((row) => row.appointmentId === current.id && row.reason === "double-book");
    assert.equal(rows.length, 1);
    const markup = renderToStaticMarkup(createElement(AppointmentCalendar, {
      appointments: store.getState().appointments.filter((row) => row.id === current.id || row.id === second.appointmentId),
      day: friday,
      techs: [{ id: "elena", number: "1", name: "Elena", board: "main" }],
      selectedId: null,
      onSelect: () => undefined,
      onSlot: () => undefined,
      onMove: () => undefined,
      onWrite: () => undefined,
      onEdit: () => undefined,
      label: () => "Visit",
      summary: () => ({ name: "Pat", vehicle: "Ford", advisor: "Megan", tech: "Elena", when: "9:00", lane: "Drop", concern: "Oil", vin: "", ops: "", status: "Scheduled", canWrite: false }),
      hoursFor: () => 1,
    }));
    assert.match(markup, /calc\(\(100% - 8px\) \/ 2/);
  });

  it("keeps a copy for the same user and store until sign-out or a worker change, and paste still checks the day", () => {
    const storage = new MemoryCopyStorage();
    const store = shop();
    const saved = store.getState().saveAdvisorAppointment(body(store));
    assert.equal(saved.ok, true, saved.error ?? "");
    const row = store.getState().appointments.find((item) => item.id === saved.appointmentId);
    assert.ok(row);
    const workerKey = copyWorkerKey(store.getState());
    const record: StoredCopy = {
      workingAsId: "megan",
      storeId: store.getState().activeStoreId,
      workerKey,
      copy: copiedFrom(row),
    };
    saveCopiedVisit(storage, record);
    const restored = readCopiedVisit(storage, "megan", record.storeId, workerKey);
    const customer = store.getState().customers.find((item) => item.id === row.customerId);
    const raw = JSON.stringify(restored);
    assert.equal(restored?.copy.customerId, row.customerId);
    assert.equal(restored?.copy.vin, "");
    assert.equal(raw.includes("\"name\""), false);
    assert.equal(customer?.name ? raw.includes(customer.name) : false, false);
    assert.equal(customer?.phone ? raw.includes(customer.phone) : false, false);
    assert.equal(readCopiedVisit(storage, "", record.storeId, workerKey), null);
    assert.equal(readCopiedVisit(storage, "megan", record.storeId, workerKey)?.copy.customerId, row.customerId);
    assert.equal(readCopiedVisit(storage, "other-user", record.storeId, workerKey), null);
    saveCopiedVisit(storage, record);
    assert.equal(readCopiedVisit(storage, "megan", "pullman", workerKey), null);
    saveCopiedVisit(storage, record);
    assert.equal(readCopiedVisit(storage, "megan", record.storeId, `${workerKey}|other`), null);
    saveCopiedVisit(storage, record);
    clearCopiedVisits(storage, "megan");
    assert.equal(readCopiedVisit(storage, "megan", record.storeId, workerKey), null);

    const sunday = "2026-11-15";
    const pasted = commitPaste(store, pasteAppointmentInput(copiedFrom(row), { date: sunday, time: "10:00", techId: "elena" }));
    assert.equal(pasted.ok, false);
    assert.match(pasted.error ?? "", /closed/);
    assert.equal(store.getState().appointments.some((item) => item.date === sunday), false);
  });
});
