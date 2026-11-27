import "./test-dom.ts";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createConnection } from "node:net";
import { createServer } from "node:http";
import { afterEach, describe, it } from "node:test";
import { createElement } from "react";
import { flushSync } from "react-dom";
import { createRoot } from "react-dom/client";
import { chromium, type Page } from "playwright";
import { AppointmentFields } from "../routes/schedule.tsx";
import { realCloseReason, PAST_CLOSE_REASON } from "./capacity.ts";
import { pinClock, resetClock } from "./clock.ts";
import { copyLimit, copyStorageKey, readCopiedVisit, saveCopiedVisit } from "./copied-visit.ts";
import { linesForDesk } from "./labor-lines.ts";
import { copiedFrom, copyWorkerKey, useDeskCopy } from "./paste-appointment.ts";
import type { ShopStorage } from "./shop-storage.ts";
import { createShopStore } from "./store.ts";
import { readTabSlot, readTabWorker, withoutTabWorker, writeTabWorker } from "./tab-worker.ts";
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
  assert.ok(customer && vehicle && lof);
  return { customer, vehicle, lof };
}

function visit(store: ReturnType<typeof shop>, patch: Partial<Appointment> = {}) {
  const { customer, vehicle, lof } = party(store);
  return store.getState().saveAdvisorAppointment({
    date: friday, time: "09:00", minutes: 60, customerId: customer.id, vehicleId: vehicle.id,
    advisorId: "megan", techId: "elena", concern: "Oil", lines: [{ id: "a", code: "A", concern: "Oil", laborOpId: lof.id, hours: 1 }],
    vin: vehicle.vin, laborOpIds: [lof.id], lane: "drop", status: "scheduled",
    ...patch,
  });
}

describe("round 32 a same-length drag does not ask", () => {
  it("moves onto the same advisor with no prompt, and a stretch still asks", () => {
    const store = shop();
    const { customer, lof } = party(store);
    const other = store.getState().customers.find((row) => row.id !== customer.id);
    const otherVehicle = store.getState().vehicles.find((row) => row.customerId === other?.id);
    assert.ok(other && otherVehicle);
    const first = visit(store);
    const second = visit(store, {
      time: "11:00", customerId: other.id, vehicleId: otherVehicle.id, vin: otherVehicle.vin,
      lines: [{ id: "b", code: "A", concern: "Rotate", laborOpId: lof.id, hours: 1 }],
    });
    assert.equal(first.ok && second.ok, true, first.error ?? second.error ?? "");
    const before = store.getState().overrides.length;
    const moved = store.getState().moveAppointment(second.appointmentId, { time: "09:30", minutes: 60 });
    assert.equal(moved.ok, true, moved.error ?? "");
    assert.equal(moved.needsDoubleBook ?? false, false);
    assert.equal(store.getState().appointments.find((row) => row.id === second.appointmentId)?.time, "09:30");
    assert.equal(store.getState().appointments.find((row) => row.id === second.appointmentId)?.minutes, 60);
    assert.equal(store.getState().overrides.filter((row) => row.reason === "double-book").length, 0);
    assert.equal(store.getState().overrides.length, before);
    const stretched = store.getState().moveAppointment(second.appointmentId, { time: "09:00", minutes: 120 });
    assert.equal(stretched.ok, false);
    assert.equal(stretched.needsDoubleBook, true);
    assert.equal(store.getState().appointments.find((row) => row.id === second.appointmentId)?.minutes, 60);
    assert.equal(store.getState().overrides.filter((row) => row.reason === "double-book").length, 0);
  });

  it("keeps an unchanged seeded a9 at 90, with the line loaded at 1.5 hr", () => {
    const store = shop("alicia");
    const row = store.getState().appointments.find((item) => item.id === "a9");
    assert.ok(row);
    const loaded = linesForDesk(row.lines, row.laborOpIds, row.minutes, store.getState().laborOps, row.lengthOverrideMinutes);
    assert.equal(loaded[0]?.hours, 1.5);
    const { id: _id, orderId: _orderId, ...editable } = row;
    const saved = store.getState().saveAdvisorAppointment({
      ...editable,
      lines: loaded.map((line) => ({ ...line, concern: line.concern || "Oil" })),
      minutes: row.minutes,
      lengthOverrideMinutes: null,
    }, row.id);
    assert.equal(saved.ok, true, saved.error ?? "");
    assert.equal(store.getState().appointments.find((item) => item.id === "a9")?.minutes, 90);
    assert.equal(store.getState().appointments.find((item) => item.id === "a9")?.lines[0]?.hours, 1.5);
  });
});

describe("round 32 the tab slot and the copy", () => {
  it("drops a window.open clone and never brings Megan's copy back after a blank", () => {
    const slot = memoryStorage();
    writeTabWorker(slot, "megan", { storeId: "pullman", owner: "tab-a" });
    assert.equal(readTabSlot(slot, "tab-a")?.storeId, "pullman");
    assert.equal(readTabWorker(slot, "tab-a"), "megan");
    assert.equal(readTabWorker(slot, "tab-b"), "");
    assert.equal(slot.getItem("jf-desk-working-as"), null);
    writeTabWorker(slot, "megan", { storeId: "pullman", owner: "tab-a" });
    let seen = "present";
    const opened = withoutTabWorker(slot, () => {
      seen = slot.getItem("jf-desk-working-as") ?? "absent";
      return "window";
    });
    assert.equal(opened, "window");
    assert.equal(seen, "absent");
    assert.equal(readTabWorker(slot, "tab-a"), "megan");

    const store = shop("megan");
    const row = store.getState().appointments.find((item) => item.advisorId === "megan");
    assert.ok(row);
    const storeId = store.getState().activeStoreId;
    const meganKey = copyWorkerKey(store.getState());
    saveCopiedVisit(localStorage, { workingAsId: "megan", storeId, workerKey: meganKey, copy: copiedFrom(row) });
    const host = document.createElement("div");
    document.body.appendChild(host);
    const root = createRoot(host);
    function Probe({ workingAsId, workerKey, activeStore }: { workingAsId: string; workerKey: string; activeStore: string }) {
      const copy = useDeskCopy(workingAsId, activeStore, workerKey, () => "", (id) => store.getState().customers.find((item) => item.id === id)?.name ?? "");
      return createElement("p", null, copy.name || "none");
    }
    const show = (workingAsId: string) => {
      const state = store.getState();
      if (workingAsId) state.setWorkingAs(workingAsId);
      flushSync(() => root.render(createElement(Probe, {
        workingAsId,
        workerKey: workingAsId ? copyWorkerKey(store.getState()) : `|${storeId}||`,
        activeStore: storeId,
      })));
    };
    show("megan");
    const owner = store.getState().customers.find((item) => item.id === row.customerId);
    assert.equal(host.textContent, owner?.name);
    show("");
    assert.equal(host.textContent, "none");
    assert.equal(readCopiedVisit(localStorage, "megan", storeId, meganKey), null);
    flushSync(() => root.render(null));
    show("megan");
    assert.equal(host.textContent, "none");
    show("jordan");
    show("megan");
    assert.equal(host.textContent, "none");
    flushSync(() => root.unmount());
    host.remove();
  });

  it("rewrites a stored copy down to the allowlist and refuses a value over the cap", () => {
    const store = shop();
    const { customer, vehicle, lof } = party(store);
    const copy = copiedFrom({
      id: "x", date: friday, time: "09:00", minutes: 60, customerId: customer.id, vehicleId: vehicle.id,
      advisorId: "megan", techId: "elena", concern: "Oil", lines: [{ id: "a", code: "A", concern: "Oil", laborOpId: lof.id, hours: 1 }],
      vin: vehicle.vin, laborOpIds: [lof.id], lane: "drop", status: "scheduled", orderId: null,
    });
    const workerKey = copyWorkerKey(store.getState());
    const key = copyStorageKey("megan", store.getState().activeStoreId);
    localStorage.setItem(key, JSON.stringify({
      workingAsId: "megan",
      storeId: store.getState().activeStoreId,
      workerKey,
      name: "Helen Cho",
      copy: { ...copy, name: customer.name },
    }));
    const restored = readCopiedVisit(localStorage, "megan", store.getState().activeStoreId, workerKey);
    const raw = localStorage.getItem(key) ?? "";
    assert.equal(restored?.copy.customerId, customer.id);
    assert.equal(raw.includes("Helen Cho") || raw.includes(customer.name), false);
    assert.equal(raw.includes("\"name\""), false);
    localStorage.setItem(key, JSON.stringify({
      workingAsId: "megan",
      storeId: store.getState().activeStoreId,
      workerKey,
      copy: { ...copy, lines: [null] },
    }));
    assert.equal(readCopiedVisit(localStorage, "megan", store.getState().activeStoreId, workerKey), null);
    assert.equal(localStorage.getItem(key), null);
    const full = saveCopiedVisit(localStorage, {
      workingAsId: "megan",
      storeId: store.getState().activeStoreId,
      workerKey,
      copy: {
        ...copy,
        concern: "c".repeat(500),
        lines: Array.from({ length: 12 }, () => ({ id: "", code: "A", concern: "c".repeat(500), laborOpId: lof.id, hours: 1 })),
      },
    });
    assert.equal(full.ok, true, "error" in full ? full.error : "");
    assert.ok((localStorage.getItem(key)?.length ?? 0) <= copyLimit());
    localStorage.setItem(key, "x".repeat(copyLimit() + 1));
    assert.equal(readCopiedVisit(localStorage, "megan", store.getState().activeStoreId, workerKey), null);
    assert.equal(localStorage.getItem(key), null);
  });
});

describe("round 32 confirms and length", () => {
  it("judges a minutes-only update, and refuses minutes that disagree with the lines", () => {
    const store = shop("derek");
    const { lof } = party(store);
    const booked = visit(store, { advisorId: "derek", time: "08:00", minutes: 60 });
    assert.equal(booked.ok, true, booked.error ?? "");
    const before = store.getState().overrides.length;
    const asked = store.getState().updateAppointment(booked.appointmentId, { minutes: 630, laborOpIds: [] }, "Customer stayed late");
    assert.equal(asked.needsOverride, true, JSON.stringify(asked));
    assert.equal(store.getState().appointments.find((row) => row.id === booked.appointmentId)?.minutes, 60);
    assert.equal(store.getState().overrides.length, before);
    const kept = store.getState().updateAppointment(booked.appointmentId, { minutes: 630, laborOpIds: [] }, "Customer stayed late", false, true);
    assert.equal(kept.ok, true, kept.error ?? JSON.stringify(kept));
    assert.equal(store.getState().overrides.filter((row) => row.appointmentId === booked.appointmentId && row.reason === "tech-hours").length, 1);
    const mismatched = store.getState().updateAppointment(booked.appointmentId, {
      minutes: 90,
      lines: [{ id: "a", code: "A", concern: "Oil", laborOpId: lof.id, hours: 1 }],
    });
    assert.equal(mismatched.ok, false);
    assert.match(mismatched.error ?? "", /not on this desk/);
    assert.equal(store.getState().appointments.find((row) => row.id === booked.appointmentId)?.minutes, 630);
    const { customer, vehicle } = party(store);
    const other = store.getState().customers.find((row) => row.id !== customer.id);
    const otherVehicle = store.getState().vehicles.find((row) => row.customerId === other?.id);
    assert.ok(other && otherVehicle);
    const fill = store.getState().saveAdvisorAppointment({
      date: friday, time: "07:30", minutes: 480, customerId: customer.id, vehicleId: vehicle.id,
      advisorId: "derek", techId: "marcus", concern: "Fill", lines: [{ id: "f", code: "A", concern: "Fill", laborOpId: lof.id, hours: 8 }],
      vin: vehicle.vin, laborOpIds: [lof.id], lane: "drop", status: "scheduled",
    });
    assert.equal(fill.ok, true, fill.error ?? "");
    const short = store.getState().saveAdvisorAppointment({
      date: friday, time: "07:30", minutes: 60, customerId: other.id, vehicleId: otherVehicle.id,
      advisorId: "megan", techId: "marcus", concern: "Short", lines: [{ id: "s", code: "A", concern: "Short", laborOpId: lof.id, hours: 1 }],
      vin: otherVehicle.vin, laborOpIds: [lof.id], lane: "drop", status: "scheduled",
    });
    assert.equal(short.ok, true, short.error ?? "");
    const unconfirmed = store.getState().saveAdvisorAppointment({
      date: friday, time: "07:30", minutes: 180, customerId: other.id, vehicleId: otherVehicle.id,
      advisorId: "megan", techId: "marcus", concern: "Short", lines: [{ id: "s", code: "A", concern: "Short", laborOpId: lof.id, hours: 3 }],
      vin: otherVehicle.vin, laborOpIds: [lof.id], lane: "drop", status: "scheduled",
    }, short.appointmentId, undefined, undefined, undefined, false, 1 as unknown as boolean);
    assert.equal(unconfirmed.needsOverride, true, JSON.stringify(unconfirmed));
    assert.equal(store.getState().appointments.find((row) => row.id === short.appointmentId)?.minutes, 60);
    assert.equal(store.getState().overrides.filter((row) => row.appointmentId === short.appointmentId && row.reason === "tech-hours").length, 0);
  });

  it("accepts a real past-close reason and ignores a bare yes, and a numeric confirm is not a confirm", () => {
    assert.equal(realCloseReason("yes"), null);
    assert.equal(realCloseReason("Tow truck"), "Tow truck");
    const store = shop("derek");
    const booked = visit(store, { advisorId: "derek", time: "16:00", minutes: 60 });
    assert.equal(booked.ok, true, booked.error ?? "");
    const before = store.getState().appointments.find((row) => row.id === booked.appointmentId)?.time;
    const shy = store.getState().updateAppointment(booked.appointmentId, { time: "17:00" }, "yes");
    assert.equal(shy.ok, false);
    assert.equal(shy.error, PAST_CLOSE_REASON);
    assert.equal(store.getState().appointments.find((row) => row.id === booked.appointmentId)?.time, before);
    store.getState().setAppointmentStatus(booked.appointmentId, "arrived");
    const fuzzyCancel = store.getState().cancelAppointment(booked.appointmentId, { reason: "customer-request" }, 1 as unknown as boolean);
    assert.equal(fuzzyCancel.ok, false);
    assert.equal(fuzzyCancel.arrivedConfirm, "The customer is here — cancel anyway?");
    assert.equal(store.getState().appointments.find((row) => row.id === booked.appointmentId)?.status, "arrived");
  });

  it("clears the double-book flag when the draft changes, so the next save asks again", () => {
    const store = shop();
    const state = store.getState();
    const { customer, lof } = party(store);
    const other = state.customers.find((row) => row.id !== customer.id);
    const otherVehicle = state.vehicles.find((row) => row.customerId === other?.id);
    assert.ok(other && otherVehicle);
    const first = visit(store);
    const second = visit(store, {
      time: "11:00", customerId: other.id, vehicleId: otherVehicle.id, vin: otherVehicle.vin,
      lines: [{ id: "b", code: "A", concern: "Rotate", laborOpId: lof.id, hours: 1 }],
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
        onSubmit: (value, _transfer, _reason, _close, confirmDouble, confirmOverride) => {
          const result = store.getState().saveAdvisorAppointment(value, current.id, undefined, undefined, undefined, confirmDouble === true, confirmOverride === true);
          if (!result.ok && result.needsDoubleBook) return { error: null, needsDoubleBook: true, warning: result.warning ?? null };
          return result.ok ? null : result.error;
        },
      }));
    });
    const starts = host.querySelector<HTMLSelectElement>("[aria-label='Starts']");
    assert.ok(starts);
    const pick = (time: string) => {
      flushSync(() => {
        starts.value = time;
        starts.dispatchEvent(new Event("change", { bubbles: true }));
      });
    };
    pick("09:30");
    flushSync(() => host.querySelector("form")?.requestSubmit());
    assert.ok(host.querySelector("[data-double-book]"));
    pick("10:00");
    assert.equal(host.querySelector("[data-double-book]"), null);
    pick("09:30");
    flushSync(() => host.querySelector("form")?.requestSubmit());
    assert.ok(host.querySelector("[data-double-book]"));
    assert.equal(store.getState().appointments.find((row) => row.id === current.id)?.time, "11:00");
    assert.equal(store.getState().overrides.filter((row) => row.reason === "double-book").length, 0);
    flushSync(() => root.unmount());
    host.remove();
  });
});

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

async function openA9(page: Page) {
  for (let step = 0; step < 8 && await page.locator("[data-appt-id='a9']").count() === 0; step += 1) {
    await page.getByRole("button", { name: "Next", exact: true }).click();
  }
  await page.locator("[data-appt-id='a9'] [data-summary-mark]").click();
  await page.locator("[data-hover-summary]").getByRole("button", { name: "Edit details" }).click();
  await page.locator("[aria-label='Hours for line A']").waitFor();
}

describe("round 32 the desk keeps Pullman, the copy, and a9's length", () => {
  it("shows 1.5 hr on a9, saves 90 unchanged and 120 after LOF 0.5, and a reload in Pullman keeps the bar", async () => {
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
      env: { ...process.env, VITE_DEMO_MODE: "true", JF_PIN_CLOCK: when, PATH: `${root}/node_modules/.bin:${process.env.PATH ?? ""}` },
      stdio: ["ignore", "pipe", "pipe"],
    });
    const browser = await chromium.launch({ headless: true });
    try {
      await waitForPort(port);
      const page = await browser.newPage();
      await page.setViewportSize({ width: 1280, height: 800 });
      await page.clock.install({ time: new Date(when) });
      await page.goto(`http://127.0.0.1:${port}/schedule`, { waitUntil: "domcontentloaded" });
      await page.locator("[data-tech]").first().waitFor();
      await page.locator("[aria-label='Working as']").selectOption("megan");
      await openA9(page);
      assert.equal(await page.locator("[aria-label='Hours for line A']").inputValue(), "1.5");
      assert.equal(await page.locator("[aria-label='Visit length']").inputValue(), "90");
      await page.getByRole("button", { name: "Save changes" }).click();
      await page.locator("[aria-label='Hours for line A']").waitFor({ state: "detached" });
      await openA9(page);
      assert.equal(await page.locator("[aria-label='Hours for line A']").inputValue(), "1.5");
      assert.equal(await page.locator("[aria-label='Visit length']").inputValue(), "90");
      await page.getByRole("button", { name: "Add line" }).click();
      const op = page.locator("[aria-label='Labor op for line B']");
      const lof = await op.locator("option", { hasText: "LOF" }).getAttribute("value");
      assert.ok(lof);
      await op.selectOption(lof);
      await page.locator("[aria-label='Hours for line B']").waitFor();
      assert.equal(await page.locator("[aria-label='Hours for line B']").inputValue(), "0.5");
      const typed = await page.evaluate(() => {
        const title = [...document.querySelectorAll("p")].find((node) => node.textContent === "Line B");
        const block = title?.parentElement?.parentElement;
        const input = [...(block?.querySelectorAll("input") ?? [])].find((node) => node.type !== "number");
        if (!input) return "";
        const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value")?.set;
        setter?.call(input, "Rotate");
        input.dispatchEvent(new Event("input", { bubbles: true }));
        return input.value;
      });
      assert.equal(typed, "Rotate");
      assert.equal(await page.locator("[aria-label='Visit length']").inputValue(), "120");
      await page.getByRole("button", { name: "Save changes" }).click();
      try {
        await page.locator("[aria-label='Visit length']").waitFor({ state: "hidden", timeout: 8000 });
      } catch {
        const note = await page.locator("[role='alert'], [data-capacity-choices], [data-double-book]").allInnerTexts();
        assert.fail(note.join(" | ") || "the save stayed open");
      }
      await openA9(page);
      assert.equal(await page.locator("[aria-label='Hours for line A']").inputValue(), "1.5");
      assert.equal(await page.locator("[aria-label='Visit length']").inputValue(), "120");
      await page.keyboard.press("Escape");

      await page.locator("[data-appt-id='a9']").click({ button: "right" });
      await page.locator("[data-copy]").click();
      await page.locator("[data-copied]").waitFor();
      await page.getByRole("button", { name: "Pullman" }).click();
      await page.locator("[data-tech]").first().waitFor();
      assert.equal(await page.locator("[aria-label='Working as']").inputValue(), "");
      assert.equal(await page.locator("[data-copied]").count(), 0);
      await page.locator("[aria-label='Working as']").selectOption({ index: 1 });
      const pullmanPerson = await page.locator("[aria-label='Working as']").inputValue();
      await page.locator("[data-appt]").first().click({ button: "right" });
      await page.locator("[data-copy]").click();
      await page.locator("[data-copied]").waitFor();
      await page.reload({ waitUntil: "domcontentloaded" });
      await page.locator("[data-tech]").first().waitFor();
      await page.locator("[data-copied]").waitFor();
      assert.equal(await page.getByRole("button", { name: "Pullman" }).getAttribute("aria-pressed"), "true");
      assert.equal(await page.locator("[aria-label='Working as']").inputValue(), pullmanPerson);
      await page.getByRole("button", { name: "Grand Coulee" }).click();
      await page.locator("[data-tech]").first().waitFor();
      assert.equal(await page.locator("[data-copied]").count(), 0);
      await page.locator("[aria-label='Working as']").selectOption("megan");
      assert.equal(await page.locator("[data-copied]").count(), 0);
      await page.getByRole("button", { name: "Pullman" }).click();
      await page.getByRole("button", { name: "Grand Coulee" }).click();
      await page.locator("[aria-label='Working as']").selectOption("megan");
      assert.equal(await page.locator("[data-copied]").count(), 0);
    } finally {
      await browser.close();
      if (server.exitCode == null) server.kill("SIGTERM");
    }
  });
});
