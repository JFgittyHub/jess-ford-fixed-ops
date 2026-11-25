import "./test-dom.ts";
import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import { createConnection } from "node:net";
import { createServer } from "node:http";
import { afterEach, describe, it } from "node:test";
import { createElement } from "react";
import { flushSync } from "react-dom";
import { createRoot } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { chromium } from "playwright";
import { AppointmentCalendar } from "../components/appointment-calendar.tsx";
import { AppointmentFields } from "../routes/schedule.tsx";
import { clearCopiedVisits, copyStorageKey, readCopiedVisit, saveCopiedVisit, type StoredCopy } from "./copied-visit.ts";
import { pinClock, resetClock } from "./clock.ts";
import { blockAfterLineEdit, deskBlockMinutes } from "./labor-lines.ts";
import { commitPaste, copiedFrom, copyWorkerKey, pasteAppointmentInput, useDeskCopy } from "./paste-appointment.ts";
import type { ShopStorage } from "./shop-storage.ts";
import { createShopStore } from "./store.ts";
import type { Appointment } from "./types.ts";

afterEach(() => {
  resetClock();
  clearCopiedVisits(localStorage);
});

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
  const customer = state.customers.find((row) => state.vehicles.some((vehicle) => vehicle.customerId === row.id)) ?? state.customers[0];
  const vehicle = state.vehicles.find((row) => row.customerId === customer.id) ?? state.vehicles[0];
  const lof = state.laborOps.find((op) => op.opcode === "LOF");
  const rot = state.laborOps.find((op) => op.opcode === "ROT");
  const misc = state.laborOps.find((op) => op.opcode === "MISC");
  assert.ok(customer && vehicle && lof && rot && misc);
  return { customer, vehicle, lof, rot, misc };
}

function body(store: ReturnType<typeof shop>, patch: Partial<Appointment> = {}): Omit<Appointment, "id" | "orderId"> {
  const { customer, vehicle, lof } = party(store);
  return {
    date: friday, time: "09:00", minutes: 90, customerId: customer.id, vehicleId: vehicle.id,
    advisorId: "megan", techId: "elena", concern: "Oil", lines: [{ id: "a", code: "A", concern: "Oil", laborOpId: lof.id, hours: 1.5 }],
    vin: vehicle.vin, laborOpIds: [lof.id], lane: "drop", status: "scheduled", ...patch,
  };
}

describe("round 30 line length only grows", () => {
  it("keeps 90 minutes when LOF 1.5 becomes ROT 0.3, and a drag can still shorten", () => {
    const store = shop();
    const { lof, rot } = party(store);
    const saved = store.getState().saveAdvisorAppointment(body(store));
    assert.equal(saved.ok, true, saved.error ?? "");
    const id = saved.appointmentId;
    const before = store.getState().appointments.length;
    const swapped = store.getState().updateAppointment(id, {
      lines: [{ id: "a", code: "A", concern: "Oil", laborOpId: rot.id, hours: 0.3 }],
      laborOpIds: [rot.id],
      lengthOverrideMinutes: null,
    });
    assert.equal(swapped.ok, true, swapped.error ?? "");
    const row = store.getState().appointments.find((item) => item.id === id);
    assert.equal(row?.minutes, 90);
    assert.equal(row?.lines[0]?.hours, 0.3);
    assert.equal(row?.lines[0]?.laborOpId, rot.id);
    const lowered = store.getState().updateAppointment(id, {
      lines: [{ id: "a", code: "A", concern: "Oil", laborOpId: rot.id, hours: 0.2 }],
      lengthOverrideMinutes: null,
    });
    assert.equal(lowered.ok, true, lowered.error ?? "");
    assert.equal(store.getState().appointments.find((item) => item.id === id)?.minutes, 90);
    const raised = store.getState().updateAppointment(id, {
      lines: [{ id: "a", code: "A", concern: "Oil", laborOpId: lof.id, hours: 2 }],
      laborOpIds: [lof.id],
      lengthOverrideMinutes: null,
    });
    assert.equal(raised.ok, true, raised.error ?? "");
    assert.equal(store.getState().appointments.find((item) => item.id === id)?.minutes, 120);
    const dragged = store.getState().moveAppointment(id, { time: "09:00", minutes: 60, techId: "elena" });
    assert.equal(dragged.ok, true, dragged.error ?? "");
    assert.equal(store.getState().appointments.find((item) => item.id === id)?.minutes, 60);
    assert.equal(store.getState().appointments.length, before);
    assert.equal(blockAfterLineEdit(90, 18, null).minutes, 90);
    assert.equal(blockAfterLineEdit(90, 120, null).minutes, 120);
    assert.equal(blockAfterLineEdit(90, 18, 60).minutes, 60);
    assert.equal(deskBlockMinutes({ openedMinutes: 90, openedLineMinutes: 90, lineMinutes: 18, override: null }), 90);
    assert.equal(deskBlockMinutes({ openedMinutes: 90, openedLineMinutes: 90, lineMinutes: 120, override: null }), 120);
    assert.equal(deskBlockMinutes({ openedMinutes: 90, openedLineMinutes: 90, lineMinutes: 90, override: 60 }), 60);
  });

  it("shows the labor-op message on the line, and a lower line total does not shrink the form", () => {
    const store = shop();
    const state = store.getState();
    const { customer, vehicle, lof, rot, misc } = party(store);
    const host = document.createElement("div");
    document.body.appendChild(host);
    const root = createRoot(host);
    flushSync(() => {
      root.render(createElement(AppointmentFields, {
        initial: {
          date: friday, time: "09:00", minutes: 90, customerId: customer.id, vehicleId: vehicle.id,
          advisorId: "megan", techId: "elena", concern: "", lines: [{ id: "a", code: "A", concern: "", laborOpId: lof.id, hours: 1.5 }],
          vin: vehicle.vin, laborOpIds: [lof.id], lane: "drop", status: "scheduled",
        },
        customers: state.customers, vehicles: state.vehicles, advisors: state.advisors, techs: state.techs,
        laborOps: state.laborOps, transports: state.settings.scheduling.transportOptions,
        submitLabel: "Save changes", scheduling: state.settings.scheduling,
        onSubmit: () => null,
      }));
    });
    const inline = host.querySelector("[data-line-error]");
    assert.equal(inline?.textContent, "Add a concern for this labor op.");
    assert.equal(inline?.closest("div")?.textContent?.includes("Line A"), true);
    const hours = host.querySelector<HTMLInputElement>("[aria-label='Hours for line A']");
    const length = host.querySelector<HTMLSelectElement>("[aria-label='Visit length']");
    const op = host.querySelector<HTMLSelectElement>("[aria-label='Labor op for line A']");
    assert.ok(hours && length && op);
    const setValue = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value")?.set;
    flushSync(() => {
      op.value = rot.id;
      op.dispatchEvent(new Event("change", { bubbles: true }));
    });
    assert.equal(host.querySelector<HTMLInputElement>("[aria-label='Hours for line A']")?.value, "0.3");
    assert.equal(host.querySelector<HTMLSelectElement>("[aria-label='Visit length']")?.value, "90");
    flushSync(() => {
      const hourNode = host.querySelector<HTMLInputElement>("[aria-label='Hours for line A']");
      assert.ok(hourNode && setValue);
      setValue.call(hourNode, "2");
      hourNode.dispatchEvent(new Event("input", { bubbles: true }));
    });
    assert.equal(host.querySelector<HTMLSelectElement>("[aria-label='Visit length']")?.value, "120");
    flushSync(() => root.unmount());
    host.remove();
    void misc;
  });
});

describe("round 30 store refusals", () => {
  it("refuses a blank concern on add and on a new customer, and writes nothing", () => {
    const store = shop();
    const { customer, vehicle, lof } = party(store);
    const before = {
      appointments: store.getState().appointments.length,
      customers: store.getState().customers.length,
      overrides: store.getState().overrides.length,
    };
    const { status: _status, ...addable } = body(store);
    const added = store.getState().addAppointment({
      ...addable,
      lines: [{ id: "a", code: "A", concern: "   ", laborOpId: lof.id, hours: 1.5 }],
      concern: "",
    });
    assert.equal(added, "Add a concern for this labor op.");
    const created = store.getState().saveNewCustomerAppointment({
      name: "Rita Gomez", phone: "5095550148", email: "", year: 2021, make: "Ford", model: "Escape",
      vin: "1FTFW1E59NFA12345", plate: "RITA8", date: friday, time: "11:00", minutes: 90,
      advisorId: "megan", techId: "elena", lane: "drop", concern: "",
      lines: [{ id: "n", code: "A", concern: " ", laborOpId: lof.id, hours: 1.5 }],
      laborOpIds: [lof.id],
    });
    assert.equal(created.ok, false);
    assert.equal(created.error, "Add a concern for this labor op.");
    assert.equal(store.getState().appointments.length, before.appointments);
    assert.equal(store.getState().customers.length, before.customers);
    assert.equal(store.getState().overrides.length, before.overrides);
    void customer;
    void vehicle;
  });

  it("requires one double-book confirmation when a direct update lengthens over the same advisor", () => {
    const store = shop();
    const first = store.getState().saveAdvisorAppointment(body(store, { time: "09:00", minutes: 60, lines: [{ id: "a", code: "A", concern: "Oil", laborOpId: party(store).lof.id, hours: 1 }] }));
    const other = store.getState().customers.find((row) => row.id !== store.getState().appointments.find((item) => item.id === first.appointmentId)?.customerId);
    const vehicle = store.getState().vehicles.find((row) => row.customerId === other?.id);
    assert.ok(first.ok && other && vehicle);
    const second = store.getState().saveAdvisorAppointment(body(store, {
      time: "10:00", minutes: 60, customerId: other.id, vehicleId: vehicle.id, vin: vehicle.vin,
      lines: [{ id: "b", code: "A", concern: "Rotate", laborOpId: party(store).lof.id, hours: 1 }],
    }));
    assert.equal(second.ok, true, second.error ?? "");
    const before = store.getState().overrides.length;
    const minutesBefore = store.getState().appointments.find((row) => row.id === first.appointmentId)?.minutes;
    const refused = store.getState().updateAppointment(first.appointmentId, { minutes: 120 });
    assert.equal(refused.ok, false);
    assert.equal(refused.needsDoubleBook, true);
    assert.match(refused.warning ?? "", /double-books the advisor/);
    assert.equal(store.getState().appointments.find((row) => row.id === first.appointmentId)?.minutes, minutesBefore);
    assert.equal(store.getState().overrides.length, before);
    const kept = store.getState().updateAppointment(first.appointmentId, { minutes: 120 }, undefined, true);
    assert.equal(kept.ok, true, kept.error ?? "");
    assert.equal(store.getState().appointments.find((row) => row.id === first.appointmentId)?.minutes, 120);
    const rows = store.getState().overrides.filter((row) => row.appointmentId === first.appointmentId && row.reason === "double-book");
    assert.equal(rows.length, 1);
  });

  it("refuses a paste with no Working-as person and with no session, and writes nothing", () => {
    const store = shop();
    const saved = store.getState().saveAdvisorAppointment(body(store));
    assert.equal(saved.ok, true, saved.error ?? "");
    const row = store.getState().appointments.find((item) => item.id === saved.appointmentId);
    assert.ok(row);
    const before = store.getState().appointments.length;
    store.getState().setWorkingAs("");
    const missing = commitPaste(store, pasteAppointmentInput(copiedFrom(row), { date: friday, time: "11:00", techId: "elena" }));
    assert.equal(missing.ok, false);
    assert.match(missing.error ?? "", /Choose who is working/);
    store.getState().setWorkingAs("megan");
    const signedOut = commitPaste(store, pasteAppointmentInput(copiedFrom(row), { date: friday, time: "11:00", techId: "elena" }), { signedIn: false });
    assert.equal(signedOut.ok, false);
    assert.equal(signedOut.error, "Sign in to paste.");
    assert.equal(store.getState().appointments.length, before);
  });
});

describe("round 30 the copy stays with Working as", () => {
  it("restores after a remount, drops on person role store and another tab, and ignores an empty Working as", () => {
    const store = shop();
    const saved = store.getState().saveAdvisorAppointment(body(store));
    const row = store.getState().appointments.find((item) => item.id === saved.appointmentId);
    assert.ok(row);
    const storeId = store.getState().activeStoreId;
    const meganKey = copyWorkerKey(store.getState());
    const record: StoredCopy = {
      workingAsId: "megan",
      storeId,
      workerKey: meganKey,
      name: "Helen Cho",
      copy: { ...copiedFrom(row), vin: row.vin },
    };
    saveCopiedVisit(localStorage, record);
    assert.equal(JSON.parse(localStorage.getItem(copyStorageKey("megan", storeId)) ?? "{}").copy.vin, "");
    const seen: string[] = [];
    function Probe({ workingAsId, workerKey, activeStore }: { workingAsId: string; workerKey: string; activeStore: string }) {
      const copy = useDeskCopy(workingAsId, activeStore, workerKey, (vehicleId) => store.getState().vehicles.find((item) => item.id === vehicleId)?.vin ?? "");
      seen.push(copy.name);
      return createElement("p", { "data-copied-name": copy.name }, copy.name || "none");
    }
    const host = document.createElement("div");
    document.body.appendChild(host);
    const root = createRoot(host);
    const show = (props: { workingAsId: string; workerKey: string; activeStore: string }, fresh = false) => {
      if (fresh) flushSync(() => root.render(null));
      flushSync(() => root.render(createElement(Probe, props)));
    };
    show({ workingAsId: "", workerKey: `|${storeId}||`, activeStore: storeId });
    assert.equal(host.textContent, "none");
    assert.equal(readCopiedVisit(localStorage, "megan", storeId, meganKey)?.name, "Helen Cho");
    show({ workingAsId: "megan", workerKey: meganKey, activeStore: storeId });
    assert.equal(host.textContent, "Helen Cho");
    show({ workingAsId: "megan", workerKey: meganKey, activeStore: storeId }, true);
    assert.equal(host.textContent, "Helen Cho");
    store.getState().setWorkingAs("derek");
    const derekKey = copyWorkerKey(store.getState());
    show({ workingAsId: "derek", workerKey: derekKey, activeStore: storeId });
    assert.equal(host.textContent, "none");
    assert.equal(readCopiedVisit(localStorage, "megan", storeId, meganKey), null);
    saveCopiedVisit(localStorage, { ...record, workerKey: derekKey, workingAsId: "derek" });
    show({ workingAsId: "derek", workerKey: derekKey, activeStore: storeId }, true);
    assert.equal(host.textContent, "Helen Cho");
    const roleKey = derekKey.replace(/\|[^|]*$/, "|technician");
    show({ workingAsId: "derek", workerKey: roleKey, activeStore: storeId });
    assert.equal(host.textContent, "none");
    saveCopiedVisit(localStorage, { ...record, workerKey: derekKey, workingAsId: "derek" });
    show({ workingAsId: "derek", workerKey: derekKey, activeStore: "pullman" });
    assert.equal(host.textContent, "none");
    assert.equal(localStorage.getItem(copyStorageKey("derek", storeId)), null);
    saveCopiedVisit(localStorage, { ...record, workerKey: derekKey, workingAsId: "derek" });
    show({ workingAsId: "derek", workerKey: derekKey, activeStore: storeId });
    assert.equal(host.textContent, "Helen Cho");
    localStorage.removeItem(copyStorageKey("derek", storeId));
    const dropped = new window.Event("storage");
    Object.defineProperty(dropped, "key", { value: copyStorageKey("derek", storeId) });
    Object.defineProperty(dropped, "newValue", { value: null });
    flushSync(() => { window.dispatchEvent(dropped); });
    assert.equal(host.textContent, "none");
    flushSync(() => root.unmount());
    host.remove();
    void seen;
  });
});

describe("round 30 side by side and the stretch", () => {
  it("gives overlapping cards a wider column, and a drag on the stretch pad lengthens the upper visit", () => {
    const upper: Appointment = {
      id: "upper", date: friday, time: "09:00", minutes: 60, customerId: "c", vehicleId: "v", advisorId: "megan",
      concern: "Oil change", lines: [], vin: "", laborOpIds: [], techId: "elena", lane: "drop", status: "scheduled", orderId: null,
    };
    const lower: Appointment = { ...upper, id: "lower", time: "09:30", concern: "Rotate" };
    const markup = renderToStaticMarkup(createElement(AppointmentCalendar, {
      appointments: [upper, lower], day: friday,
      techs: [{ id: "elena", number: "1", name: "Elena", board: "main" }],
      selectedId: null, onSelect: () => undefined, onSlot: () => undefined, onMove: () => undefined,
      onWrite: () => undefined, onEdit: () => undefined, label: (row) => row.id === "upper" ? "Helen Cho" : "Sam Ruiz",
      summary: () => ({ name: "Pat", vehicle: "Ford", advisor: "Megan", tech: "Elena", when: "9:00", lane: "Drop", concern: "Oil", vin: "", ops: "", status: "Scheduled", canWrite: false }),
      hoursFor: () => 1,
    }));
    assert.match(markup, /minmax\(18rem/);
    assert.match(markup, /data-lane-layout="side"/);
    const alone = renderToStaticMarkup(createElement(AppointmentCalendar, {
      appointments: [upper], day: friday,
      techs: [{ id: "elena", number: "1", name: "Elena", board: "main" }],
      selectedId: null, onSelect: () => undefined, onSlot: () => undefined, onMove: () => undefined,
      onWrite: () => undefined, onEdit: () => undefined, label: () => "Helen Cho",
      summary: () => ({ name: "Pat", vehicle: "Ford", advisor: "Megan", tech: "Elena", when: "9:00", lane: "Drop", concern: "Oil", vin: "", ops: "", status: "Scheduled", canWrite: false }),
      hoursFor: () => 1,
    }));
    assert.match(alone, /minmax\(8\.5rem/);
    const moves: { id: string; minutes: number; time: string }[] = [];
    const host = document.createElement("div");
    document.body.appendChild(host);
    const root = createRoot(host);
    flushSync(() => {
      root.render(createElement(AppointmentCalendar, {
        appointments: [upper, lower], day: friday,
        techs: [{ id: "elena", number: "1", name: "Elena", board: "main" }],
        selectedId: null, onSelect: () => undefined, onSlot: () => undefined,
        onMove: (id, patch) => moves.push({ id, minutes: patch.minutes, time: patch.time }),
        onWrite: () => undefined, onEdit: () => undefined, label: () => "Helen Cho",
        summary: () => ({ name: "Pat", vehicle: "Ford", advisor: "Megan", tech: "Elena", when: "9:00", lane: "Drop", concern: "Oil", vin: "", ops: "", status: "Scheduled", canWrite: false }),
        hoursFor: () => 1,
      }));
    });
    const pad = host.querySelector<HTMLElement>("[data-resize-for='upper']");
    const lowerCard = host.querySelector<HTMLElement>("[data-appt-id='lower']");
    assert.ok(pad && lowerCard);
    lowerCard.getBoundingClientRect = () => ({ left: 0, right: 120, top: 70, bottom: 140, width: 120, height: 70, x: 0, y: 70, toJSON: () => ({}) });
    const pointer = window.PointerEvent;
    pad.dispatchEvent(new pointer("pointerdown", { bubbles: true, button: 0, pointerId: 4, pointerType: "mouse", isPrimary: true, clientX: 40, clientY: 90 }));
    window.dispatchEvent(new pointer("pointermove", { bubbles: true, button: 0, pointerId: 4, pointerType: "mouse", isPrimary: true, clientX: 40, clientY: 122 }));
    window.dispatchEvent(new pointer("pointerup", { bubbles: true, button: 0, pointerId: 4, pointerType: "mouse", isPrimary: true, clientX: 40, clientY: 122 }));
    assert.equal(moves.length, 1);
    assert.equal(moves[0]?.id, "upper");
    assert.equal(moves[0]?.time, "09:00");
    assert.ok((moves[0]?.minutes ?? 0) > 60);
    flushSync(() => root.unmount());
    host.remove();
  });
});

function stopServer(server: ChildProcess) {
  if (server.exitCode != null) return;
  server.kill("SIGTERM");
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

describe("round 30 rendered copy and readable cards", () => {
  it("keeps the copy across a reload and a route change, and overlapping cards stay tappable", async () => {
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
    const server = spawn(process.execPath, ["scripts/with-app-env.mjs", "vite", "dev", "--host", "127.0.0.1", "--port", String(port), "--strictPort"], {
      cwd: root,
      env: { ...process.env, VITE_DEMO_MODE: "true", JF_PIN_CLOCK: "2026-11-16T20:00:00.000Z", PATH: `${root}/node_modules/.bin:${process.env.PATH ?? ""}` },
      stdio: ["ignore", "pipe", "pipe"],
    });
    const browser = await chromium.launch({ headless: true });
    try {
      await waitForPort(port);
      const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
      await page.clock.install({ time: new Date("2026-11-16T20:00:00.000Z") });
      await page.goto(`http://127.0.0.1:${port}/schedule`, { waitUntil: "domcontentloaded" });
      await page.locator("[data-tech]").first().waitFor();
      await page.locator("[data-appt]").first().waitFor();
      await page.locator("[aria-label='Working as']").selectOption("megan");
      await page.locator("[data-appt]").first().click({ button: "right" });
      await page.locator("[data-copy]").waitFor();
      await page.locator("[data-copy]").click();
      if (await page.locator("[data-copied]").count() === 0) {
        const note = await page.evaluate(() => document.querySelector("[data-copy-bar], [data-paste-notice], [role='alert']")?.textContent ?? document.body.innerText.slice(0, 400));
        assert.fail(`Copy did not stay on the board: ${note}`);
      }
      const copied = await page.locator("[data-copied]").innerText();
      assert.match(copied, /^Copied /);
      await page.reload({ waitUntil: "domcontentloaded" });
      await page.locator("[data-tech]").first().waitFor();
      const kept = await page.evaluate(() => Object.keys(localStorage).filter((key) => key.startsWith("jf-desk-copy:")));
      assert.ok(kept.length > 0, "the reload deleted the copy");
      await page.locator("[aria-label='Working as']").selectOption("megan");
      await page.locator("[data-copied]").waitFor();
      assert.match(await page.locator("[data-copied]").innerText(), /^Copied /);
      await page.getByRole("link", { name: "Pulse" }).click();
      await page.getByRole("link", { name: "Appointments" }).click();
      await page.locator("[data-tech]").first().waitFor();
      await page.locator("[data-copied]").waitFor();
      assert.match(await page.locator("[data-copied]").innerText(), /^Copied /);
      await page.locator("[aria-label='Working as']").selectOption("derek");
      assert.equal(await page.locator("[data-copied]").count(), 0);
      await page.locator("[aria-label='Working as']").selectOption("megan");
      await page.locator("[data-appt]").first().click({ button: "right" });
      await page.locator("[data-copy]").click();
      await page.setViewportSize({ width: 390, height: 800 });
      const wrapped = await page.locator("[data-copied]").evaluate((node) => {
        const style = getComputedStyle(node);
        const line = parseFloat(style.lineHeight) || 20;
        return Math.round(node.getBoundingClientRect().height / line);
      });
      assert.ok(wrapped > 0 && wrapped <= 3, `the copy bar wrapped to ${wrapped} lines at 390`);
      for (const [index, time] of ["09:00", "09:30"].entries()) {
        await page.setViewportSize({ width: 1280, height: 800 });
        await page.getByRole("button", { name: "Book appointment" }).click();
        const dialog = page.getByRole("dialog", { name: "Book an appointment" });
        await dialog.waitFor();
        const tech = dialog.getByLabel("Technician");
        const elena = await tech.locator("option", { hasText: "Elena" }).getAttribute("value");
        assert.ok(elena);
        await tech.selectOption(elena);
        await dialog.getByLabel("Starts").selectOption(time);
        const customer = dialog.locator("input[placeholder*='Name']");
        await customer.click();
        await customer.fill("a");
        await dialog.locator("ul button").first().click();
        await dialog.getByLabel("Concern").first().fill(`Side ${index + 1}`);
        const book = dialog.getByRole("button", { name: "Book it", exact: true });
        if (await book.count()) await book.click();
        else await dialog.getByRole("button", { name: "Book it anyway" }).click();
        await dialog.waitFor({ state: "hidden" });
      }
      const widths: Record<number, number> = {};
      for (const width of [390, 820, 1280]) {
        await page.setViewportSize({ width, height: 800 });
        const measured = await page.evaluate(() => {
          const column = document.querySelector<HTMLElement>("[data-tech='elena']");
          column?.scrollIntoView({ inline: "center", block: "nearest" });
          const nodes = [...(column?.querySelectorAll<HTMLElement>("[data-appt]") ?? [])];
          const placed = nodes.map((card) => {
            const box = card.getBoundingClientRect();
            return { card, top: box.top, bottom: box.bottom, width: box.width, height: box.height };
          });
          const side = placed.filter((card, index) => placed.some((other, otherIndex) => otherIndex !== index && other.top < card.bottom - 8 && card.top < other.bottom - 8)).map((item) => {
            item.card.scrollIntoView({ block: "center", inline: "center" });
            const box = item.card.getBoundingClientRect();
            const x = box.left + box.width / 2;
            const y = box.top + box.height / 2;
            const hit = document.elementFromPoint(x, y);
            return {
              width: box.width,
              height: box.height,
              left: box.left,
              name: item.card.querySelector("p")?.textContent ?? "",
              hit: hit?.closest("[data-appt]")?.getAttribute("data-appt-id") ?? hit?.getAttribute("aria-label") ?? hit?.tagName ?? "",
              id: item.card.getAttribute("data-appt-id") ?? "",
            };
          });
          return { column: column?.getBoundingClientRect().width ?? 0, min: column?.style.minWidth ?? "", side };
        });
        assert.ok(measured.side.length >= 2, `${width} has no side-by-side cards in a ${Math.round(measured.column)}px column`);
        for (const card of measured.side) {
          assert.ok(card.width >= 120, `${width} side-by-side card is ${Math.round(card.width)}px in a ${Math.round(measured.column)}px column (${measured.min})`);
          assert.ok(card.height >= 24, `${width} card is ${Math.round(card.height)}px tall`);
          assert.ok(card.name.trim().length > 1, `${width} card has no readable name`);
          assert.equal(card.hit, card.id, `${width} a tap on ${card.name} hit ${card.hit} at left ${Math.round(card.left)} width ${Math.round(card.width)}`);
          widths[width] = Math.round(card.width);
        }
      }
      assert.ok(widths[390] >= 96 && widths[820] >= 96 && widths[1280] >= 96);
    } finally {
      await browser.close();
      stopServer(server);
    }
  });
});
