import "./test-dom.ts";
import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import { createConnection, createServer } from "node:net";
import { afterEach, describe, it } from "node:test";
import { createElement } from "react";
import { flushSync } from "react-dom";
import { createRoot } from "react-dom/client";
import { chromium, type Page } from "playwright";
import { AppointmentFields } from "../routes/schedule.tsx";
import { pinClock, resetClock } from "./clock.ts";
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

describe("round 26 block, capacity, and the resize pad", () => {
  it("explains a calendar block that was rounded up and still saves the line hours", () => {
    const store = shop();
    const state = store.getState();
    const { customer, vehicle, misc } = party(store);
    const host = document.createElement("div");
    document.body.appendChild(host);
    const root = createRoot(host);
    let saved = false;
    flushSync(() => {
      root.render(createElement(AppointmentFields, {
        initial: {
          date: friday, time: "09:00", minutes: 60, customerId: customer.id, vehicleId: vehicle.id,
          advisorId: "megan", techId: "marcus", concern: "Long",
          lines: [{ id: "a", code: "A", concern: "Long", laborOpId: misc.id, hours: 4.1 }],
          vin: vehicle.vin, laborOpIds: [misc.id], lane: "drop", status: "scheduled",
        },
        customers: state.customers, vehicles: state.vehicles, advisors: state.advisors, techs: state.techs,
        laborOps: state.laborOps, transports: state.settings.scheduling.transportOptions,
        submitLabel: "Book it", scheduling: state.settings.scheduling,
        onSubmit: (value) => {
          saved = true;
          const result = store.getState().saveAdvisorAppointment(value);
          return result.ok ? null : result.error;
        },
      }));
    });
    assert.match(host.textContent ?? "", /Labor 4\.1 hr\. Calendar block 4\.5 hr \(rounded up to the next half hour\)\./);
    assert.equal(host.querySelector<HTMLSelectElement>("[aria-label='Visit length']")?.value, "270");
    const form = host.querySelector("form");
    flushSync(() => form?.requestSubmit());
    assert.equal(saved, true, host.querySelector("[role='alert']")?.textContent || `valid ${form?.checkValidity()}`);
    const row = store.getState().appointments.find((item) => item.lines.some((line) => line.hours === 4.1));
    assert.equal(row?.minutes, 270);
    assert.equal(row?.lines[0]?.hours, 4.1);
    flushSync(() => root.unmount());
    host.remove();
  });

  it("refuses a bad length override on save and paste and writes nothing", () => {
    const store = shop();
    const saved = store.getState().saveAdvisorAppointment(body(store));
    assert.equal(saved.ok, true, saved.error ?? "");
    const source = store.getState().appointments.find((row) => row.id === saved.appointmentId);
    assert.ok(source);
    const bad = [Number.NaN, Number.POSITIVE_INFINITY, "60" as unknown as number, 31, 45];
    for (const lengthOverrideMinutes of bad) {
      const before = store.getState().appointments.map((row) => `${row.id}|${row.minutes}|${row.lengthOverrideMinutes ?? ""}`).join("\n");
      const overrides = store.getState().overrides.length;
      const refused = store.getState().saveAdvisorAppointment(body(store, { time: "11:00", lengthOverrideMinutes }));
      assert.equal(refused.ok, false);
      assert.match(refused.error ?? "", /not on this desk/);
      assert.equal(store.getState().appointments.map((row) => `${row.id}|${row.minutes}|${row.lengthOverrideMinutes ?? ""}`).join("\n"), before);
      assert.equal(store.getState().overrides.length, overrides);
      const pasted = commitPaste(store, {
        ...pasteAppointmentInput(copiedFrom(source), { date: friday, time: "11:30", techId: "elena" }),
        lengthOverrideMinutes,
      });
      assert.equal(pasted.ok, false);
      assert.equal(store.getState().appointments.map((row) => `${row.id}|${row.minutes}|${row.lengthOverrideMinutes ?? ""}`).join("\n"), before);
    }
    const kept = store.getState().saveAdvisorAppointment(body(store, { time: "11:00", lengthOverrideMinutes: 90 }));
    assert.equal(kept.ok, true, kept.error ?? "");
    assert.equal(store.getState().appointments.find((row) => row.id === kept.appointmentId)?.minutes, 90);
    assert.equal(store.getState().appointments.find((row) => row.id === kept.appointmentId)?.lengthOverrideMinutes, 90);
  });

  it("refuses an overloaded add and still lets the desk save record the override", () => {
    const store = shop();
    const { misc } = party(store);
    const first = store.getState().saveAdvisorAppointment(body(store, {
      time: "08:00",
      lines: [{ id: "a", code: "A", concern: "Fill", laborOpId: misc.id, hours: 6 }],
    }));
    assert.equal(first.ok, true, first.error ?? "");
    const before = store.getState().appointments.length;
    const { status: _status, ...addable } = body(store, {
      time: "08:00",
      lines: [{ id: "b", code: "B", concern: "More", laborOpId: misc.id, hours: 6 }],
    });
    assert.equal(store.getState().addAppointment(addable), "");
    assert.equal(store.getState().appointments.length, before);
    const quiet = store.getState().addAppointment({ ...addable, time: "14:00", lines: [{ id: "c", code: "A", concern: "Short", laborOpId: misc.id, hours: 1 }], minutes: 60 });
    assert.notEqual(quiet, "");
    assert.equal(store.getState().appointments.find((row) => row.id === quiet)?.minutes, 60);
  });

  it("returns the capacity override id when an edit is what overloads the technician", () => {
    const store = shop();
    const { misc } = party(store);
    const fill = store.getState().saveAdvisorAppointment(body(store, {
      time: "08:00",
      lines: [{ id: "a", code: "A", concern: "Fill", laborOpId: misc.id, hours: 6 }],
    }));
    assert.equal(fill.ok, true, fill.error ?? "");
    assert.equal(fill.overrideId, null);
    const second = store.getState().saveAdvisorAppointment(body(store, { time: "08:00" }));
    assert.equal(second.ok, true, second.error ?? "");
    assert.equal(second.overrideId, null);
    const edited = store.getState().saveAdvisorAppointment(body(store, {
      time: "08:00",
      lines: [{ id: "a", code: "A", concern: "Grew", laborOpId: misc.id, hours: 6 }],
    }), second.appointmentId);
    assert.equal(edited.ok, true, edited.error ?? "");
    assert.ok(edited.overrideId);
    const row = store.getState().overrides.find((item) => item.id === edited.overrideId);
    assert.equal(row?.appointmentId, second.appointmentId);
    assert.equal(row?.reason, "tech-hours");
  });
});

function stopServer(server: ChildProcess) {
  if (server.exitCode != null) return;
  server.kill("SIGTERM");
  setTimeout(() => {
    if (server.exitCode == null) server.kill("SIGKILL");
  }, 2000);
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

async function waitForSelector(page: Page, selector: string, timeoutMs = 20000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    if (await page.evaluate((selector) => Boolean(document.querySelector(selector)), selector)) return true;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  return false;
}

describe("round 26 real touch on a one-row card", () => {
  it("drags the pad under a 30-minute card at phone and tablet width, and a hold at the card's center opens Copy", async () => {
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
    const browser = await chromium.launch({ headless: true });
    try {
      await waitForPort(port);
      const page = await browser.newPage({ hasTouch: true, viewport: { width: 390, height: 800 } });
      await page.clock.install({ time: new Date(fixedClock) });
      await page.goto(`http://127.0.0.1:${port}/schedule`, { waitUntil: "domcontentloaded" });
      assert.ok(await waitForSelector(page, "[data-tech]"), "the board did not load");
      await page.locator("[aria-label='Working as']").selectOption("megan");
      let found = false;
      for (let step = 0; step < 24 && !found; step += 1) {
        found = await page.evaluate(() => {
          const cards = [...document.querySelectorAll<HTMLElement>("[data-appt]")];
          return cards.some((card) => {
            const rect = card.getBoundingClientRect();
            const time = card.getAttribute("data-appt-time") ?? "";
            if (rect.height > 34 || time >= "16:00") return false;
            const hit = document.elementFromPoint(rect.left + 20, rect.bottom + 12);
            return !hit?.closest("[data-appt]");
          });
        });
        if (!found) await page.getByRole("button", { name: "Previous", exact: true }).click();
      }
      assert.equal(found, true, "no one-row card with an empty slot under it");

      const held = await page.evaluate(() => {
        const cards = [...document.querySelectorAll<HTMLElement>("[data-appt]")];
        const card = cards.find((item) => {
          const rect = item.getBoundingClientRect();
          const time = item.getAttribute("data-appt-time") ?? "";
          if (rect.height > 34 || time >= "16:00") return false;
          const below = document.elementFromPoint(rect.left + 20, rect.bottom + 12);
          return !below?.closest("[data-appt]");
        });
        if (!card) return null;
        const before = card.getBoundingClientRect();
        window.scrollBy({ top: before.top - 360, left: 0, behavior: "instant" });
        const rect = card.getBoundingClientRect();
        const describe = (node: Element | null) => node ? {
          tag: node.tagName,
          pad: Boolean(node.closest("[data-resize-pad]")),
          drag: node.closest("[data-drag]")?.getAttribute("data-drag") ?? "",
          label: node.getAttribute("aria-label") ?? "",
        } : null;
        return {
          id: card.getAttribute("data-appt-id") ?? "",
          center: { x: rect.left + 16, y: rect.top + rect.height / 2, hit: describe(document.elementFromPoint(rect.left + 16, rect.top + rect.height / 2)) },
          top: { x: rect.left + 16, y: rect.top + 8, hit: describe(document.elementFromPoint(rect.left + 16, rect.top + 8)) },
        };
      });
      assert.ok(held, "no one-row card to hold");
      assert.notEqual(held.center.hit?.drag, "resize", `the center is the grip ${JSON.stringify(held.center.hit)}`);
      const holdSession = await page.context().newCDPSession(page);
      for (const point of [held.top, held.center]) {
        await page.keyboard.press("Escape");
        const x = Math.round(point.x);
        const y = Math.round(point.y);
        await page.evaluate(() => {
          const probe = window as unknown as { __hold?: string };
          probe.__hold = "";
          const note = (text: string) => { probe.__hold = `${probe.__hold ?? ""} ${text}`; };
          if (probe.__hold === "" && !(window as unknown as { __holdWrapped?: boolean }).__holdWrapped) {
            (window as unknown as { __holdWrapped?: boolean }).__holdWrapped = true;
            const orig = window.setTimeout;
            window.setTimeout = ((fn: TimerHandler, ms?: number, ...args: unknown[]) => {
              note(`timer ${ms}`);
              const wrapped = () => {
                note("fired");
                try {
                  if (typeof fn === "function") fn(...args);
                  note(document.querySelector("[data-copy]") ? "copy" : "no-copy");
                } catch (error) {
                  note(`err ${error instanceof Error ? error.message : String(error)}`);
                }
              };
              return orig(wrapped, ms);
            }) as typeof window.setTimeout;
            document.addEventListener("pointerdown", (event) => {
              const target = event.target instanceof Element ? event.target.tagName : "";
              note(`down ${event.pointerType} ${target} ${event.button}`);
            });
          }
        });
        await holdSession.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x, y, id: 1 }] });
        await page.clock.fastForward(700);
        const heard = await page.evaluate(() => (window as unknown as { __hold?: string }).__hold ?? "");
        await holdSession.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
        await page.keyboard.press("Escape");
        assert.match(heard, /copy/, `Copy did not open at ${x},${y} (${JSON.stringify(point.hit)}); pointer ${heard}`);
      }
      await holdSession.detach();
      await page.keyboard.press("Escape");

      for (const width of [390, 820]) {
        await page.setViewportSize({ width, height: 800 });
        await page.keyboard.press("Escape");
        const discard = page.getByRole("button", { name: "Discard" });
        if (await discard.count()) await discard.click();
        const spot: {
          id: string; x: number; y: number; height: number; textInside: boolean;
          pad: { tag: string; pad: boolean; drag: string; label: string; className: string } | null;
          center: { tag: string; pad: boolean; drag: string; label: string; className: string } | null;
          top: { tag: string; pad: boolean; drag: string; label: string; className: string } | null;
        } | null = await page.evaluate((id: string) => {
          const card = document.querySelector<HTMLElement>(`[data-appt-id="${id}"]`);
          if (!card) return null;
          const scroller = card.closest<HTMLElement>(".overflow-x-auto");
          const place = () => {
            const box = card.getBoundingClientRect();
            if (scroller) scroller.scrollLeft = Math.max(0, scroller.scrollLeft + box.left - 260);
            window.scrollBy({ top: box.top - 300, left: 0, behavior: "instant" });
          };
          place();
          place();
          const rect = card.getBoundingClientRect();
          const x = rect.left + 20;
          const y = rect.bottom + 12;
          const hit = document.elementFromPoint(x, y);
          const text = card.querySelector("[data-concern]")?.getBoundingClientRect();
          const centerHit = document.elementFromPoint(rect.left + 16, rect.top + rect.height / 2);
          const topHit = document.elementFromPoint(rect.left + 16, rect.top + 8);
          const describe = (node: Element | null) => node ? {
            tag: node.tagName,
            pad: Boolean(node.closest("[data-resize-pad]")),
            drag: node.closest("[data-drag]")?.getAttribute("data-drag") ?? "",
            label: node.getAttribute("aria-label") ?? node.getAttribute("id") ?? "",
            className: node.getAttribute("class") ?? "",
          } : null;
          return {
            id: card.getAttribute("data-appt-id") ?? "",
            x, y,
            height: rect.height,
            pad: describe(hit),
            center: describe(centerHit),
            top: describe(topHit),
            textInside: Boolean(text && text.bottom <= rect.bottom + 1),
          };
        }, held.id);
        assert.ok(spot, `${width} lost the one-row card`);
        assert.equal(spot.pad?.pad, true, `${width} elementFromPoint at ${spot.x},${spot.y} hit ${JSON.stringify(spot.pad)}`);
        assert.equal(spot.textInside, true, `${width} the pad covers the concern`);
        assert.notEqual(spot.center?.drag, "resize", `${width} the card center is the grip ${JSON.stringify(spot.center)}`);
        assert.notEqual(spot.top?.drag, "resize", `${width} the card top is the grip`);
        const client = await page.context().newCDPSession(page);
        await client.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: spot.x, y: spot.y, id: 1 }] });
        await client.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x: spot.x, y: spot.y + 32, id: 1 }] });
        await client.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
        await client.detach();
        const grown = await page.evaluate((id) => document.querySelector(`[data-appt-id="${id}"]`)?.getBoundingClientRect().height ?? 0, spot.id);
        assert.ok(grown >= spot.height + 30 && grown <= spot.height + 34, `${width} drag changed the card from ${spot.height} to ${grown}`);
        const back = await page.evaluate((id) => {
          const card = document.querySelector<HTMLElement>(`[data-appt-id="${id}"]`);
          const rect = card?.getBoundingClientRect();
          if (!rect) return null;
          return { x: rect.left + 20, y: rect.bottom + 12 };
        }, spot.id);
        assert.ok(back, `${width} lost the pad after the drag`);
        const shrink = await page.context().newCDPSession(page);
        await shrink.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: back.x, y: back.y, id: 1 }] });
        await shrink.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x: back.x, y: back.y - 32, id: 1 }] });
        await shrink.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
        await shrink.detach();
      }
    } finally {
      await browser.close();
      stopServer(server);
    }
  });
});
