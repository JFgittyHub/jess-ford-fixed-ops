import "./test-dom.ts";
import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import { createConnection, createServer } from "node:net";
import { readFileSync } from "node:fs";
import { afterEach, describe, it } from "node:test";
import { createElement } from "react";
import { flushSync } from "react-dom";
import { createRoot } from "react-dom/client";
import { chromium } from "playwright";
import { AppointmentFields } from "../routes/schedule.tsx";
import { pastCloseMessage } from "./capacity.ts";
import { pinClock, resetClock } from "./clock.ts";
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

function body(store: ReturnType<typeof shop>, patch: Partial<Appointment> = {}): Omit<Appointment, "id" | "orderId"> {
  const state = store.getState();
  const customer = state.customers.find((row) => state.vehicles.some((vehicle) => vehicle.customerId === row.id)) ?? state.customers[0];
  const vehicle = state.vehicles.find((row) => row.customerId === customer.id) ?? state.vehicles[0];
  const misc = state.laborOps.find((op) => op.opcode === "MISC");
  assert.ok(customer && vehicle && misc);
  return {
    date: friday,
    time: "09:00",
    minutes: 30,
    customerId: customer.id,
    vehicleId: vehicle.id,
    advisorId: "megan",
    techId: "elena",
    concern: "Oil",
    lines: [{ id: "a", code: "A", concern: "Oil", laborOpId: misc.id, hours: 1 }],
    vin: vehicle.vin,
    laborOpIds: [misc.id],
    lane: "drop",
    status: "scheduled",
    ...patch,
  };
}

describe("round 28 stretch, warning, and labor op", () => {
  it("asks before a stretch double-books the advisor and writes one row only when kept", () => {
    const store = shop();
    const first = store.getState().saveAdvisorAppointment(body(store, { time: "09:00", minutes: 60 }));
    assert.equal(first.ok, true, first.error ?? "");
    const secondCustomer = store.getState().customers.find((row) => row.id !== store.getState().appointments.find((item) => item.id === first.appointmentId)?.customerId);
    const secondVehicle = store.getState().vehicles.find((row) => row.customerId === secondCustomer?.id);
    assert.ok(secondCustomer && secondVehicle);
    const second = store.getState().saveAdvisorAppointment(body(store, {
      time: "10:00",
      minutes: 60,
      customerId: secondCustomer.id,
      vehicleId: secondVehicle.id,
      vin: secondVehicle.vin,
    }));
    assert.equal(second.ok, true, second.error ?? "");
    const upper = first.appointmentId;
    const lower = second.appointmentId;
    const before = store.getState().overrides.length;
    const asked = store.getState().moveAppointment(upper, { minutes: 120 });
    assert.equal(asked.ok, false);
    assert.equal(asked.needsDoubleBook, true);
    assert.match(asked.warning ?? "", /double-books the advisor/);
    assert.equal(store.getState().appointments.find((row) => row.id === upper)?.minutes, 60);
    assert.equal(store.getState().appointments.find((row) => row.id === lower)?.time, "10:00");
    assert.equal(store.getState().overrides.length, before);
    const kept = store.getState().moveAppointment(upper, { minutes: 120 }, true);
    assert.equal(kept.ok, true, kept.error ?? "");
    assert.equal(store.getState().appointments.find((row) => row.id === upper)?.minutes, 120);
    assert.equal(store.getState().appointments.find((row) => row.id === lower)?.time, "10:00");
    const rows = store.getState().overrides.filter((row) => row.appointmentId === upper && row.reason === "double-book");
    assert.equal(rows.length, 1);
    assert.equal(kept.overrideId, rows[0]?.id);
  });

  it("names the technician, the day, and the hours in the overload warning", () => {
    const store = shop();
    const misc = store.getState().laborOps.find((op) => op.opcode === "MISC");
    assert.ok(misc);
    const fill = store.getState().saveAdvisorAppointment(body(store, {
      lines: [{ id: "a", code: "A", concern: "Fill", laborOpId: misc.id, hours: 6 }],
      minutes: 360,
    }));
    assert.equal(fill.ok, true, fill.error ?? "");
    const asked = store.getState().saveAdvisorAppointment(body(store, {
      time: "08:00",
      lines: [{ id: "b", code: "A", concern: "More", laborOpId: misc.id, hours: 5 }],
      minutes: 300,
      customerId: store.getState().customers[1].id,
      vehicleId: store.getState().vehicles.find((row) => row.customerId === store.getState().customers[1].id)?.id,
      vin: store.getState().vehicles.find((row) => row.customerId === store.getState().customers[1].id)?.vin,
    }));
    assert.match(asked.warning ?? "", /Elena Voss would have 11\.0 hr booked on Fri Nov 13 \(10\.0 hr available\)/);
    assert.match(asked.warning ?? "", /People booking online will not be offered this time/);
    assert.equal((asked.warning ?? "").includes("Online customers will not see this time"), false);
  });

  it("books a new customer only after both the overload and the VIN transfer are confirmed", () => {
    const store = shop();
    const misc = store.getState().laborOps.find((op) => op.opcode === "MISC");
    const openVehicles = new Set(store.getState().orders.filter((order) => order.status !== "closed").map((order) => order.vehicleId));
    const owned = store.getState().vehicles.find((row) => row.vin && row.customerId && !openVehicles.has(row.id));
    assert.ok(misc && owned);
    const fill = store.getState().saveAdvisorAppointment(body(store, {
      lines: [{ id: "a", code: "A", concern: "Fill", laborOpId: misc.id, hours: 6 }],
      minutes: 360,
    }));
    assert.equal(fill.ok, true, fill.error ?? "");
    const input = {
      name: "Rita Gomez",
      phone: "5095550144",
      email: "",
      year: 2021,
      make: "Ford",
      model: "Escape",
      vin: owned.vin,
      plate: "RITA4",
      date: friday,
      time: "08:00",
      minutes: 300,
      advisorId: "megan",
      techId: "elena",
      lane: "drop",
      concern: "Five hours",
      lines: [{ id: "n", code: "A", concern: "Five hours", laborOpId: misc.id, hours: 5 }],
      laborOpIds: [misc.id],
    };
    const before = {
      customers: store.getState().customers.length,
      appointments: store.getState().appointments.length,
      overrides: store.getState().overrides.length,
      ownership: (store.getState().ownershipLog ?? []).length,
    };
    const both = store.getState().saveNewCustomerAppointment(input);
    assert.equal(both.ok, false);
    assert.equal(both.needsOverride, true);
    assert.equal(both.needsTransfer, true);
    assert.equal(store.getState().customers.length, before.customers);
    assert.equal(store.getState().overrides.length, before.overrides);
    const transferOnly = store.getState().saveNewCustomerAppointment(input, true, "Sold the car");
    assert.equal(transferOnly.needsOverride, true);
    assert.equal(transferOnly.needsTransfer, false);
    assert.equal(store.getState().appointments.length, before.appointments);
    const hoursOnly = store.getState().saveNewCustomerAppointment(input, false, undefined, undefined, true);
    assert.equal(hoursOnly.needsTransfer, true);
    assert.equal(hoursOnly.needsOverride, false);
    assert.equal(store.getState().overrides.length, before.overrides);
    const saved = store.getState().saveNewCustomerAppointment(input, true, "Sold the car", undefined, true);
    assert.equal(saved.ok, true, saved.error ?? "");
    const hours = store.getState().overrides.filter((row) => row.appointmentId === saved.appointmentId && row.reason === "tech-hours");
    assert.equal(hours.length, 1);
    assert.ok((store.getState().ownershipLog ?? []).length > before.ownership);
  });

  it("hides Book it while the warning is up and keeps both confirms", () => {
    const store = shop();
    const state = store.getState();
    const misc = state.laborOps.find((op) => op.opcode === "MISC");
    assert.ok(misc);
    const host = document.createElement("div");
    document.body.appendChild(host);
    const root = createRoot(host);
    const calls: { transfer?: boolean; override?: boolean }[] = [];
    flushSync(() => {
      root.render(createElement(AppointmentFields, {
        initial: {
          date: friday, time: "09:00", minutes: 60, customerId: state.customers[0].id, vehicleId: state.vehicles[0].id, advisorId: "megan", techId: "elena",
          concern: "", lines: [{ id: "a", code: "A", concern: "Oil", laborOpId: misc.id, hours: 1 }], vin: "", laborOpIds: [misc.id], lane: "drop", status: "scheduled",
        },
        customers: state.customers,
        vehicles: state.vehicles,
        advisors: state.advisors,
        techs: state.techs,
        laborOps: state.laborOps,
        transports: state.settings.scheduling.transportOptions,
        submitLabel: "Book it",
        scheduling: undefined,
        capacityFor: () => ({ blocked: null, warning: "Elena Voss would have 11.0 hr booked on Tue Nov 24 (8.0 hr available). You can still book it. People booking online will not be offered this time." }),
        onSubmit: () => null,
        onCreate: (_value, transfer, _reason, _close, override) => {
          calls.push({ transfer, override });
          if (!override) return { error: null, needsOverride: true, warning: "hours" };
          if (!transfer) return { error: null, needsTransfer: true, warning: "This VIN is on file for someone. Transfer the vehicle?" };
          return null;
        },
      }));
    });
    const labels = () => [...host.querySelectorAll("button")].map((button) => button.textContent ?? "");
    assert.equal(labels().includes("Book it"), false);
    assert.ok(labels().includes("Book it anyway"));
    assert.ok(labels().includes("Pick another time"));
    const form = host.querySelector("form");
    assert.ok(form);
    flushSync(() => form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })));
    assert.equal(calls.length, 0);
    const anyway = [...host.querySelectorAll("button")].find((button) => button.textContent === "Book it anyway");
    assert.ok(anyway);
    flushSync(() => anyway.click());
    const opener = [...host.querySelectorAll("button")].find((button) => button.textContent === "New customer");
    if (opener) flushSync(() => opener.click());
    flushSync(() => anyway.click());
    assert.equal(calls.at(-1)?.override, true);
    assert.equal(calls.at(-1)?.transfer, false);
    const transfer = [...host.querySelectorAll("button")].find((button) => button.textContent === "Transfer the vehicle");
    assert.ok(transfer);
    flushSync(() => transfer.click());
    assert.equal(calls.at(-1)?.override, true);
    assert.equal(calls.at(-1)?.transfer, true);
    flushSync(() => root.unmount());
    host.remove();
  });

  it("resets a removed labor op to Misc at 1.0 hr and keeps a dragged length", () => {
    const store = shop();
    const state = store.getState();
    const misc = state.laborOps.find((op) => op.opcode === "MISC");
    const other = state.laborOps.find((op) => op.opcode !== "MISC");
    assert.ok(misc && other);
    const host = document.createElement("div");
    document.body.appendChild(host);
    const root = createRoot(host);
    flushSync(() => {
      root.render(createElement(AppointmentFields, {
        initial: {
          date: friday, time: "09:00", minutes: 90, lengthOverrideMinutes: 90, customerId: state.customers[0].id,
          vehicleId: state.vehicles[0].id, advisorId: "megan", techId: "elena", concern: "Brakes",
          lines: [{ id: "a", code: "A", concern: "Brakes", laborOpId: other.id, hours: other.hours }],
          vin: state.vehicles[0].vin, laborOpIds: [other.id], lane: "drop", status: "scheduled",
        },
        customers: state.customers,
        vehicles: state.vehicles,
        advisors: state.advisors,
        techs: state.techs,
        laborOps: state.laborOps,
        transports: state.settings.scheduling.transportOptions,
        submitLabel: "Save changes",
        scheduling: state.settings.scheduling,
        onSubmit: (value) => {
          host.dataset.savedMinutes = String(value.minutes);
          host.dataset.savedHours = String(value.lines[0]?.hours ?? "");
          host.dataset.savedOp = value.lines[0]?.laborOpId ?? "";
          return null;
        },
      }));
    });
    const remove = host.querySelector("[aria-label='Remove labor op from line A']");
    assert.ok(remove, "a non-misc line has a remove control");
    flushSync(() => remove.dispatchEvent(new MouseEvent("click", { bubbles: true })));
    assert.equal(host.querySelector("[aria-label='Remove labor op from line A']"), null);
    const compare = host.querySelector("[data-length-compare]")?.textContent ?? "";
    assert.match(compare, /90 min|1\.5 hr|Block length/);
    const save = [...host.querySelectorAll("button")].find((button) => button.textContent === "Save changes" || button.textContent === "Book it anyway");
    assert.ok(save);
    flushSync(() => save.click());
    assert.equal(host.dataset.savedOp, misc.id);
    assert.equal(host.dataset.savedHours, "1");
    assert.equal(host.dataset.savedMinutes, "90");
    assert.equal(readFileSync(new URL("../routes/request.tsx", import.meta.url), "utf8").includes("Remove labor op"), false);
    flushSync(() => root.unmount());
    host.remove();
  });

  it("shows the past-close sentence once and uses it from add and update", () => {
    const store = shop();
    const scheduling = store.getState().settings.scheduling;
    const host = document.createElement("div");
    document.body.appendChild(host);
    const root = createRoot(host);
    const state = store.getState();
    flushSync(() => {
      root.render(createElement(AppointmentFields, {
        initial: {
          date: friday, time: "16:00", minutes: 120, customerId: state.customers[0].id, vehicleId: state.vehicles[0].id,
          advisorId: "megan", techId: "elena", concern: "Late", lines: [{ id: "a", code: "A", concern: "Late" }],
          vin: state.vehicles[0].vin, laborOpIds: [], lane: "drop", status: "scheduled",
        },
        customers: state.customers, vehicles: state.vehicles, advisors: state.advisors, techs: state.techs,
        laborOps: state.laborOps, transports: state.settings.scheduling.transportOptions, submitLabel: "Book it",
        scheduling, onSubmit: () => "not saved",
      }));
    });
    const save = [...host.querySelectorAll("button")].find((button) => button.textContent === "Book it");
    assert.ok(save);
    flushSync(() => save.click());
    const alerts = [...host.querySelectorAll("[role='alert']")].map((node) => node.textContent ?? "").filter((text) => text.includes("runs past closing"));
    assert.equal(alerts.length, 1);
    assert.match(alerts[0] ?? "", /5:30 PM/);
    flushSync(() => root.unmount());
    host.remove();
    const { status: _status, ...addable } = body(store, { time: "16:00", minutes: 120, lines: [{ id: "a", code: "A", concern: "Late" }], laborOpIds: [] });
    const added = store.getState().addAppointment(addable);
    assert.equal(added, pastCloseMessage(scheduling, friday));
    const booked = store.getState().saveAdvisorAppointment(body(store, { time: "09:00", minutes: 60 }));
    assert.equal(booked.ok, true, booked.error ?? "");
    const updated = store.getState().updateAppointment(booked.appointmentId, { lengthOverrideMinutes: 31 });
    assert.equal(updated.ok, false);
    assert.equal(updated.error, "That length override is not on this desk.");
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

describe("round 28 real stretch", () => {
  it("stretches at the overlap with touch and mouse, and overlapping cards sit side by side", async () => {
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
      const page = await browser.newPage({ hasTouch: true, viewport: { width: 1280, height: 800 } });
      await page.clock.install({ time: new Date("2026-11-16T20:00:00.000Z") });
      await page.goto(`http://127.0.0.1:${port}/schedule`, { waitUntil: "domcontentloaded" });
      await page.locator("[data-tech]").first().waitFor();
      await page.locator("[aria-label='Working as']").selectOption("megan");
      for (const [index, time] of ["09:00", "10:00"].entries()) {
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
        await dialog.getByLabel("Concern").first().fill(`Visit ${index + 1}`);
        const book = dialog.getByRole("button", { name: "Book it", exact: true });
        if (await book.count()) await book.click();
        else await dialog.getByRole("button", { name: "Book it anyway" }).click();
        await dialog.waitFor({ state: "hidden" });
      }
      for (const width of [390, 820, 1280]) {
        await page.setViewportSize({ width, height: 800 });
        const pair = await page.evaluate(() => {
          document.querySelector("[data-tech='elena']")?.scrollIntoView({ inline: "center", block: "center" });
          const columns = [...document.querySelectorAll<HTMLElement>("[data-tech='elena']")];
          for (const column of columns) {
            const cards = [...column.querySelectorAll<HTMLElement>("[data-appt]")].sort((a, b) => a.getBoundingClientRect().top - b.getBoundingClientRect().top);
            for (let index = 0; index < cards.length - 1; index += 1) {
              const upper = cards[index];
              const lower = cards[index + 1];
              const top = upper.getBoundingClientRect();
              const next = lower.getBoundingClientRect();
              if (next.top > top.bottom + 40) continue;
              const pad = document.querySelector<HTMLElement>(`[data-resize-for="${upper.getAttribute("data-appt-id")}"]`);
              pad?.scrollIntoView({ inline: "center", block: "center" });
              const spot = pad?.getBoundingClientRect();
              const box = upper.getBoundingClientRect();
              const x = spot ? spot.left + spot.width / 2 : box.left + 24;
              const y = spot ? spot.top + Math.min(12, spot.height / 2) : box.bottom + 12;
              const hit = document.elementFromPoint(x, y);
              return {
                upperId: upper.getAttribute("data-appt-id") ?? "",
                lowerId: lower.getAttribute("data-appt-id") ?? "",
                lowerTime: lower.getAttribute("data-appt-time") ?? "",
                x, y,
                height: box.height,
                pad: Boolean(hit?.closest("[data-resize-pad]")),
                hit: hit?.getAttribute("data-appt-id") || hit?.getAttribute("aria-label") || hit?.className || hit?.tagName || "",
                onScreen: y > 80 && y < window.innerHeight - 20 && x > 0 && x < window.innerWidth,
              };
            }
          }
          return null;
        });
        assert.ok(pair, `${width} has no stacked visits`);
        assert.equal(pair.onScreen, true, `${width} stretch point is off screen`);
        assert.equal(pair.pad, true, `${width} the stretch spot is not the length pad (${pair.hit})`);
        const client = await page.context().newCDPSession(page);
        await client.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: pair.x, y: pair.y, id: 1 }] });
        await client.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x: pair.x, y: pair.y + 36, id: 1 }] });
        await client.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
        await client.detach();
        await page.waitForTimeout(200);
        const lowerTime = await page.evaluate((id) => document.querySelector(`[data-appt-id="${id}"]`)?.getAttribute("data-appt-time") ?? "", pair.lowerId);
        assert.equal(lowerTime, pair.lowerTime, `${width} touch moved the lower visit`);
        const dialog = page.getByRole("dialog").filter({ hasText: "These visits overlap" });
        if (await dialog.count()) {
          await dialog.getByRole("button", { name: "Leave it" }).click();
          const stayed = await page.evaluate((id) => document.querySelector(`[data-appt-id="${id}"]`)?.getBoundingClientRect().height ?? 0, pair.upperId);
          assert.ok(Math.abs(stayed - pair.height) < 4, `${width} cancel wrote the stretch`);
        } else {
          const grown = await page.evaluate((id) => document.querySelector(`[data-appt-id="${id}"]`)?.getBoundingClientRect().height ?? 0, pair.upperId);
          assert.ok(grown >= pair.height + 28, `${width} touch did not stretch the upper visit`);
          const split = await page.evaluate((ids) => {
            const upper = document.querySelector<HTMLElement>(`[data-appt-id="${ids.upper}"]`);
            const lower = document.querySelector<HTMLElement>(`[data-appt-id="${ids.lower}"]`);
            const column = upper?.closest("[data-tech]");
            if (!upper || !lower || !column) return null;
            const u = upper.getBoundingClientRect();
            const l = lower.getBoundingClientRect();
            const c = column.getBoundingClientRect();
            const upperHit = document.elementFromPoint(u.left + u.width / 2, u.top + u.height / 2);
            const lowerHit = document.elementFromPoint(l.left + l.width / 2, l.top + Math.min(l.height / 2, 20));
            return {
              upperShare: u.width / c.width,
              lowerShare: l.width / c.width,
              upperId: upperHit?.closest("[data-appt]")?.getAttribute("data-appt-id") ?? "",
              lowerId: lowerHit?.closest("[data-appt]")?.getAttribute("data-appt-id") ?? "",
            };
          }, { upper: pair.upperId, lower: pair.lowerId });
          assert.ok(split, `${width} lost a card after the stretch`);
          assert.ok(split.upperShare < 0.7 && split.lowerShare < 0.7, `${width} cards did not split ${JSON.stringify(split)}`);
          assert.equal(split.upperId, pair.upperId);
          assert.equal(split.lowerId, pair.lowerId);
        }
      }
      await page.setViewportSize({ width: 1280, height: 800 });
      await page.locator("[data-tech='elena'] [data-appt]").first().waitFor();
      const mouse = await page.evaluate(() => {
        const column = document.querySelector<HTMLElement>("[data-tech='elena']");
        const cards = [...(column?.querySelectorAll<HTMLElement>("[data-appt]") ?? [])].sort((a, b) => a.getBoundingClientRect().top - b.getBoundingClientRect().top);
        for (let index = 0; index < cards.length - 1; index += 1) {
          const upper = cards[index];
          const lower = cards[index + 1];
          const pad = document.querySelector<HTMLElement>(`[data-resize-for="${upper.getAttribute("data-appt-id")}"]`);
          pad?.scrollIntoView({ inline: "center", block: "center" });
          const spot = pad?.getBoundingClientRect();
          const top = upper.getBoundingClientRect();
          if (!spot) continue;
          return {
            upperId: upper.getAttribute("data-appt-id") ?? "",
            lowerId: lower.getAttribute("data-appt-id") ?? "",
            lowerTime: lower.getAttribute("data-appt-time") ?? "",
            x: spot.left + spot.width / 2,
            y: spot.top + Math.min(12, spot.height / 2),
            height: top.height,
          };
        }
        return null;
      });
      assert.ok(mouse, "no stacked visit for the mouse");
      await page.mouse.move(mouse.x, mouse.y);
      await page.mouse.down();
      await page.mouse.move(mouse.x, mouse.y + 40, { steps: 6 });
      await page.mouse.up();
      await page.waitForTimeout(200);
      const after = await page.evaluate((id) => document.querySelector(`[data-appt-id="${id}"]`)?.getAttribute("data-appt-time") ?? "", mouse.lowerId);
      assert.equal(after, mouse.lowerTime, "the mouse moved the lower visit");
      const mouseDialog = page.getByRole("dialog").filter({ hasText: "These visits overlap" });
      if (await mouseDialog.count()) {
        await mouseDialog.getByRole("button", { name: "Keep both" }).click();
        const grown = await page.evaluate((id) => document.querySelector(`[data-appt-id="${id}"]`)?.getBoundingClientRect().height ?? 0, mouse.upperId);
        assert.ok(grown >= mouse.height + 28, "approving the stretch did not lengthen the visit");
      }
      const held = await page.evaluate((id) => {
        const card = document.querySelector<HTMLElement>(`[data-appt-id="${id}"]`);
        card?.scrollIntoView({ inline: "center", block: "center" });
        const box = card?.getBoundingClientRect();
        if (!box) return null;
        return { x: box.left + 16, y: box.top + 8 };
      }, mouse.lowerId);
      assert.ok(held);
      const covering = await page.evaluate((point) => {
        const hit = document.elementFromPoint(point.x, point.y);
        return {
          hit: hit?.getAttribute("aria-label") || hit?.getAttribute("data-appt-id") || hit?.className || "",
          dialog: document.querySelector("[role='dialog']")?.textContent?.slice(0, 80) ?? "",
        };
      }, held);
      if (covering.dialog.includes("overlap")) {
        await page.getByRole("button", { name: "Keep both" }).click();
      }
      const finger = await page.context().newCDPSession(page);
      await finger.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: held.x, y: held.y, id: 1 }] });
      await new Promise((resolve) => setTimeout(resolve, 700));
      await finger.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
      await finger.detach();
      assert.ok(await page.locator("[data-copy]").count(), `a hold on the lower card did not open Copy (${covering.hit})`);
    } finally {
      await browser.close();
      stopServer(server);
    }
  });
});
