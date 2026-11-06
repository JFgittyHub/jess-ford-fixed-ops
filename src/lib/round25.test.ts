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
import { appointmentLoads, onlineSlots, visitLengthError, visitRunsPastClose, PAST_CLOSE_REASON } from "./capacity.ts";
import { pinClock, resetClock } from "./clock.ts";
import type { ShopStorage } from "./shop-storage.ts";
import { createShopStore } from "./store.ts";
import type { Appointment } from "./types.ts";
import { fullVin } from "./vin.ts";

afterEach(() => resetClock());

function memoryStorage(): ShopStorage {
  const items = new Map<string, string>();
  return {
    getItem: (key) => items.get(key) ?? null,
    setItem: (key, value) => { items.set(key, value); },
    removeItem: (key) => { items.delete(key); },
  };
}

function shop() {
  const store = createShopStore({ demoMode: true, storage: memoryStorage() });
  store.getState().setWorkingAs("megan");
  return store;
}

function bookInput(state: ReturnType<ReturnType<typeof shop>["getState"]>, patch: Partial<Appointment> = {}) {
  const customer = state.customers.find((row) => row.name === "Helen Cho") ?? state.customers[0];
  const vehicle = state.vehicles.find((row) => row.customerId === customer.id) ?? state.vehicles[0];
  return {
    date: "2026-11-06",
    time: "09:00",
    minutes: 60,
    customerId: customer.id,
    vehicleId: vehicle.id,
    advisorId: "megan",
    techId: "marcus",
    concern: "Oil",
    lines: [{ id: "a", code: "A", concern: "Oil" }],
    vin: "",
    laborOpIds: [] as string[],
    lane: "drop",
    status: "scheduled" as const,
    ...patch,
  };
}

const friday = "2026-11-06";
const saturday = "2026-11-07";

describe("round 25 new booking past day", () => {
  it("keeps a new booking editable when the day is changed to a past date", () => {
    const host = document.createElement("div");
    document.body.appendChild(host);
    const root = createRoot(host);
    let date = friday;
    const draw = () => {
      flushSync(() => {
        root.render(createElement(AppointmentFields, {
          initial: {
            date,
            time: "09:00",
            minutes: 60,
            customerId: "c",
            vehicleId: "v",
            advisorId: "megan",
            techId: "marcus",
            concern: "Brakes",
            lines: [{ id: "a", code: "A", concern: "Brakes" }],
            vin: "1FTAB12C3NG000222",
            laborOpIds: [],
            lane: "drop",
            status: "scheduled",
          },
          customers: [{ id: "c", name: "Pat Example" }],
          vehicles: [{ id: "v", customerId: "c", year: 2020, model: "Escape", vin: "1FTAB12C3NG000222" }],
          advisors: [{ id: "megan", number: "1", name: "Megan" }],
          techs: [{ id: "marcus", number: "2", name: "Marcus" }],
          laborOps: [],
          transports: [{ id: "drop", name: "Drop-off" }, { id: "waiter", name: "Waiter" }],
          submitLabel: "Book it",
          onVisitChange: (next) => {
            date = next.date;
            draw();
          },
          onSubmit: () => null,
        }));
      });
    };
    draw();
    const day = host.querySelector<HTMLInputElement>("input[type='date']");
    const vin = host.querySelector<HTMLInputElement>("input.font-mono");
    assert.ok(day && vin);
    assert.equal(day.disabled, false);
    const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
    flushSync(() => {
      setValue?.call(day, "2020-01-01");
      day.dispatchEvent(new Event("input", { bubbles: true }));
      day.dispatchEvent(new Event("change", { bubbles: true }));
    });
    const dayAfter = host.querySelector<HTMLInputElement>("input[type='date']");
    const vinAfter = host.querySelector<HTMLInputElement>("input.font-mono");
    const tech = host.querySelector<HTMLSelectElement>("select");
    assert.ok(dayAfter && vinAfter);
    assert.equal(date, "2020-01-01");
    assert.equal(dayAfter.disabled, false);
    assert.equal(vinAfter.disabled, false);
    assert.equal(vinAfter.value, "1FTAB12C3NG000222");
    assert.equal(tech?.disabled, false);
    flushSync(() => {
      setValue?.call(dayAfter, friday);
      dayAfter.dispatchEvent(new Event("input", { bubbles: true }));
      dayAfter.dispatchEvent(new Event("change", { bubbles: true }));
    });
    const restored = host.querySelector<HTMLInputElement>("input[type='date']");
    assert.equal(restored?.disabled, false);
    assert.equal(restored?.value, friday);
    root.unmount();
    host.remove();
  });

  it("still locks an existing past visit from the original day", () => {
    const markup = renderToStaticMarkup(createElement(AppointmentFields, {
      initial: {
        date: "2026-10-01",
        time: "09:00",
        minutes: 60,
        customerId: "c",
        vehicleId: "v",
        advisorId: "megan",
        techId: "marcus",
        concern: "Oil",
        lines: [{ id: "a", code: "A", concern: "Oil" }],
        vin: "",
        laborOpIds: [],
        lane: "drop",
        status: "scheduled",
      },
      customers: [{ id: "c", name: "Pat" }],
      vehicles: [{ id: "v", customerId: "c", year: 2020, model: "Escape", vin: "1" }],
      advisors: [{ id: "megan", number: "1", name: "Megan" }],
      techs: [{ id: "marcus", number: "2", name: "Marcus" }],
      laborOps: [],
      transports: [{ id: "drop", name: "Drop-off" }],
      submitLabel: "Save changes",
      showStatus: true,
      onSubmit: () => null,
    }));
    assert.match(markup, /type="date" disabled=""/);
    assert.match(markup, /Showed/);
    assert.match(markup, /No-show/);
  });
});

describe("round 25 past close", () => {
  const samples = [
    { date: friday, time: "17:00", minutes: 630 },
    { date: friday, time: "15:00", minutes: 600 },
    { date: saturday, time: "08:30", minutes: 300 },
    { date: saturday, time: "10:00", minutes: 300 },
    { date: saturday, time: "12:30", minutes: 600 },
    { date: friday, time: "10:00", minutes: 900 },
    { date: friday, time: "10:00", minutes: 1410 },
  ];

  it("refuses every visit that ends after close, including one as long as the open day", () => {
    pinClock("2026-11-04T20:00:00.000Z");
    const store = shop();
    const scheduling = store.getState().settings.scheduling;
    for (const sample of samples) {
      assert.equal(visitRunsPastClose(scheduling, sample.date, sample.time, sample.minutes), true, `${sample.date} ${sample.time} ${sample.minutes}`);
      const before = store.getState().overrides.length;
      const saved = store.getState().saveAdvisorAppointment(bookInput(store.getState(), sample));
      assert.equal(saved.ok, false, `${sample.time}+${sample.minutes}`);
      assert.match(saved.error ?? "", /past closing/);
      assert.equal(store.getState().overrides.length, before);
    }
    assert.match(visitLengthError(1440) ?? "", /not on this desk/);
    const dayLong = store.getState().saveAdvisorAppointment(bookInput(store.getState(), { minutes: 1440 }));
    assert.equal(dayLong.ok, false);
    assert.equal(store.getState().overrides.some((row) => row.reason === "past-close"), false);
  });

  it("lets a service manager approve past close only with a reason, on book, new customer, and move", () => {
    pinClock("2026-11-04T20:00:00.000Z");
    const store = shop();
    const input = bookInput(store.getState(), { date: saturday, time: "12:30", minutes: 120, vin: "" });
    store.getState().setWorkingAs("derek");
    const missing = store.getState().saveAdvisorAppointment({ ...input, advisorId: "derek" }, undefined, undefined, undefined, "   ");
    assert.equal(missing.needsCloseReason, true);
    assert.equal(missing.error, PAST_CLOSE_REASON);
    assert.equal(store.getState().overrides.length, 0);
    const manager = store.getState().saveAdvisorAppointment({ ...input, advisorId: "derek" }, undefined, undefined, undefined, "Waited for a tow");
    assert.equal(manager.ok, true, manager.error ?? "");
    const logged = store.getState().overrides.find((row) => row.id === manager.overrideId);
    assert.equal(logged?.reason, "past-close");
    assert.equal(logged?.note, "Waited for a tow");
    assert.equal(logged?.who, "Derek Lang");
    assert.ok(logged?.at);

    const created = store.getState().saveNewCustomerAppointment({
      name: "Rita Gomez",
      phone: "5095550188",
      email: "",
      year: 2021,
      make: "Ford",
      model: "Escape",
      vin: fullVin({ prefix: "1FTAB12C", year: 2021, plant: "G", serial: 5151 }),
      plate: "RITA2",
      date: saturday,
      time: "08:30",
      minutes: 300,
      advisorId: "derek",
      techId: "marcus",
      lane: "drop",
      concern: "Stays late",
      lines: [{ id: "a", code: "A", concern: "Stays late" }],
      laborOpIds: [],
    });
    assert.equal(created.needsCloseReason, true);
    assert.equal(created.ok, false);
    const createdOk = store.getState().saveNewCustomerAppointment({
      name: "Rita Gomez",
      phone: "5095550188",
      email: "",
      year: 2021,
      make: "Ford",
      model: "Escape",
      vin: fullVin({ prefix: "1FTAB12C", year: 2021, plant: "G", serial: 5151 }),
      plate: "RITA2",
      date: saturday,
      time: "08:30",
      minutes: 300,
      advisorId: "derek",
      techId: "marcus",
      lane: "drop",
      concern: "Stays late",
      lines: [{ id: "a", code: "A", concern: "Stays late" }],
      laborOpIds: [],
    }, undefined, undefined, "Saturday carryover");
    assert.equal(createdOk.ok, true, createdOk.error ?? "");
    assert.equal(store.getState().overrides.find((row) => row.id === createdOk.overrideId)?.note, "Saturday carryover");

    store.getState().setWorkingAs("megan");
    const visit = store.getState().saveAdvisorAppointment(bookInput(store.getState(), { time: "09:00", minutes: 60, vin: "" }));
    assert.equal(visit.ok, true, visit.error ?? "");
    const advisorMove = store.getState().moveAppointment(visit.appointmentId, { time: "17:00", minutes: 60 });
    assert.match(advisorMove.error ?? "", /past closing/);
    assert.equal(store.getState().appointments.find((row) => row.id === visit.appointmentId)?.time, "09:00");
    store.getState().setWorkingAs("derek");
    const managerMove = store.getState().moveAppointment(visit.appointmentId, { time: "17:00", minutes: 60 });
    assert.equal(managerMove.needsCloseReason, true);
    assert.equal(store.getState().appointments.find((row) => row.id === visit.appointmentId)?.minutes, 60);
    const approved = store.getState().moveAppointment(visit.appointmentId, { time: "17:00", minutes: 60 }, false, "Parts arrived after close");
    assert.equal(approved.ok, true, approved.error ?? "");
    assert.equal(store.getState().overrides.find((row) => row.id === approved.overrideId)?.note, "Parts arrived after close");
    assert.equal(store.getState().appointments.find((row) => row.id === visit.appointmentId)?.time, "17:00");
  });
});

describe("round 25 move overload", () => {
  it("warns when a visit is moved onto a full technician and logs the override only if confirmed", () => {
    pinClock("2026-11-04T16:00:00.000Z");
    const store = shop();
    store.setState({
      laborOps: [...store.getState().laborOps, { id: "op-heavy", opcode: "HEAVY", description: "Heavy job", hours: 12, payType: "cp" }],
    });
    const glenn = store.getState().customers.find((row) => row.name === "Glenn Ortiz");
    const glennVehicle = store.getState().vehicles.find((row) => row.customerId === glenn?.id);
    assert.ok(glenn && glennVehicle);
    const filler = store.getState().saveAdvisorAppointment(bookInput(store.getState(), {
      date: friday,
      time: "09:00",
      minutes: 60,
      techId: "luis",
      laborOpIds: ["op-heavy"],
      vin: "",
      concern: "Fills Luis",
    }));
    assert.equal(filler.ok, true, filler.error ?? "");
    const before = store.getState().overrides.length;
    assert.ok(before >= 1);
    const visit = store.getState().saveAdvisorAppointment(bookInput(store.getState(), {
      date: friday,
      time: "13:00",
      minutes: 60,
      customerId: glenn.id,
      vehicleId: glennVehicle.id,
      techId: "marcus",
      vin: "",
      concern: "Glenn at 1",
    }));
    assert.equal(visit.ok, true, visit.error ?? "");
    const logged = store.getState().overrides.length;
    const declined = store.getState().moveAppointment(visit.appointmentId, { time: "13:00", techId: "luis" });
    assert.equal(declined.ok, false);
    assert.equal(declined.needsOverride, true);
    assert.match(declined.warning ?? "", /You can still book it/);
    assert.equal(store.getState().appointments.find((row) => row.id === visit.appointmentId)?.techId, "marcus");
    assert.equal(store.getState().overrides.length, logged);
    const confirmed = store.getState().moveAppointment(visit.appointmentId, { time: "13:00", techId: "luis" }, true);
    assert.equal(confirmed.ok, true, confirmed.error ?? "");
    assert.equal(store.getState().appointments.find((row) => row.id === visit.appointmentId)?.techId, "luis");
    const row = store.getState().overrides.find((item) => item.id === confirmed.overrideId);
    assert.equal(row?.who, "Megan Cho");
    assert.equal(row?.whoId, "megan");
    assert.equal(row?.at, "2026-11-04T16:00:00.000Z");
    assert.ok(row?.reason === "tech-hours" || row?.reason === "both");
    const hidden = onlineSlots({
      scheduling: store.getState().settings.scheduling,
      advisors: store.getState().advisors,
      techs: store.getState().techs,
      loads: appointmentLoads(store.getState().appointments, store.getState().laborOps),
      serviceId: store.getState().settings.scheduling.onlineMenu[0].id,
      from: friday,
      through: friday,
      techId: "luis",
    });
    assert.equal(hidden.length, 0);
  });
});

function card(id: string, time: string, lane: string, minutes = 30): Appointment {
  return {
    id, date: friday, time, minutes, customerId: "c", vehicleId: "v", advisorId: "megan",
    concern: "Oil change and a long customer name", lines: [{ id: `${id}-a`, code: "A", concern: "Oil" }],
    vin: "", laborOpIds: [], techId: "marcus", lane, status: "scheduled", orderId: null,
  };
}

function calendarProps(onMove: (id: string) => void = () => undefined, onSelect: (id: string) => void = () => undefined) {
  return {
    appointments: [card("waiter", "09:00", "waiter"), card("drop", "09:30", "drop")],
    day: friday,
    techs: [
      { id: "marcus", number: "1", name: "Marcus", board: "main" as const },
      { id: "elena", number: "2", name: "Elena", board: "express" as const },
    ],
    selectedId: null,
    onSelect,
    onSlot: () => undefined,
    onMove,
    onWrite: () => undefined,
    onEdit: () => undefined,
    onCancel: () => undefined,
    label: () => "Pat Example with a long name",
    summary: () => ({
      name: "Pat Example", vehicle: "Ford", advisor: "Megan", tech: "Marcus", when: "9:00 AM", lane: "Waiter",
      concern: "Oil", vin: "", ops: "", status: "Scheduled", canWrite: false,
    }),
    hoursFor: () => 0.5,
  };
}

describe("round 25 lane tag and summary touch", () => {
  it("opens the summary from a touch and from Enter, and a drag from the mark does not", () => {
    HTMLElement.prototype.setPointerCapture = () => undefined;
    const host = document.createElement("div");
    document.body.appendChild(host);
    const root = createRoot(host);
    const moves: string[] = [];
    const selects: string[] = [];
    flushSync(() => {
      root.render(createElement(AppointmentCalendar, calendarProps((id) => moves.push(id), (id) => selects.push(id))));
    });
    const button = host.querySelector<HTMLElement>("[data-appt-id='waiter'] [aria-label='Appointment summary']");
    assert.ok(button);
    const touch = (type: string, x: number, y: number) => {
      const point = typeof Touch === "function" ? new Touch({ identifier: 1, target: button, clientX: x, clientY: y }) : null;
      if (point && typeof TouchEvent === "function") {
        return new TouchEvent(type, { bubbles: true, cancelable: true, touches: type === "touchend" ? [] : [point], changedTouches: [point] });
      }
      return new Event(type, { bubbles: true, cancelable: true });
    };
    flushSync(() => {
      button.dispatchEvent(touch("touchstart", 30, 40));
      button.dispatchEvent(touch("touchend", 30, 40));
    });
    assert.ok(host.querySelector("[data-hover-summary]"));
    assert.match(host.querySelector("[data-hover-summary]")?.textContent ?? "", /Edit details/);
    assert.match(host.querySelector("[data-hover-summary]")?.textContent ?? "", /Cancel appointment/);
    const pointer = window.PointerEvent;
    flushSync(() => {
      button.dispatchEvent(new pointer("pointerdown", { bubbles: true, pointerType: "touch", clientX: 20, clientY: 20 }));
      window.dispatchEvent(new pointer("pointerup", { bubbles: true, pointerType: "touch", clientX: 22, clientY: 22 }));
    });
    assert.ok(host.querySelector("[data-hover-summary]"));
    flushSync(() => {
      button.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    });
    assert.ok(host.querySelector("[data-hover-summary]"));
    flushSync(() => {
      button.dispatchEvent(new pointer("pointerdown", { bubbles: true, clientX: 20, clientY: 20 }));
      window.dispatchEvent(new pointer("pointermove", { bubbles: true, clientX: 20, clientY: 80 }));
      window.dispatchEvent(new pointer("pointerup", { bubbles: true, clientX: 20, clientY: 80 }));
    });
    assert.deepEqual(moves, ["waiter"]);
    assert.deepEqual(selects, []);
    assert.equal(host.querySelector("[data-hover-summary]"), null);
    root.unmount();
    host.remove();
  });

  it("shows Waiter and Drop-off as their own tags on a 30-minute card at desktop and phone widths", async () => {
    const html = renderToStaticMarkup(createElement(AppointmentCalendar, calendarProps()));
    assert.equal(html.includes("· Waiter"), false);
    assert.equal(html.includes("· Drop-off"), false);
    assert.match(html, /data-lane-tag/);
    const css = await appCss(html);
    const browser = await chromium.launch({ headless: true });
    try {
      for (const viewport of [{ width: 1400, height: 900 }, { width: 390, height: 844 }, { width: 820, height: 900 }]) {
        const page = await browser.newPage({ viewport, hasTouch: true });
        await page.setContent(`<!doctype html><html><head><style>${css}</style></head><body style="margin:0">${html}</body></html>`);
        const boxes = await page.evaluate(() => {
          return ["waiter", "drop"].map((id) => {
            const card = document.querySelector(`[data-appt-id='${id}']`);
            const tag = card?.querySelector("[data-lane-tag]");
            const mark = card?.querySelector("[data-summary-mark]");
            mark?.scrollIntoView({ inline: "center", block: "center" });
            const title = card?.querySelector("p");
            const tagBox = tag?.getBoundingClientRect();
            const markBox = mark?.getBoundingClientRect();
            const cardBox = card?.getBoundingClientRect();
            const hit = markBox ? document.elementFromPoint(markBox.left + markBox.width / 2, markBox.top + markBox.height / 2) : null;
            return {
              id,
              tag: tag?.textContent ?? "",
              title: title?.textContent ?? "",
              tagWidth: tag instanceof HTMLElement ? tag.clientWidth : 0,
              tagScroll: tag instanceof HTMLElement ? tag.scrollWidth : 0,
              markWidth: markBox?.width ?? 0,
              tagBox,
              markBox,
              cardBox,
              hitSummary: Boolean(hit?.closest("[aria-label='Appointment summary']")),
            };
          });
        });
        for (const box of boxes) {
          assert.equal(box.tag, box.id === "waiter" ? "Waiter" : "Drop-off", `${viewport.width} ${box.id}`);
          assert.equal(box.title.includes(box.tag), false);
          assert.equal(box.markWidth, 34);
          assert.ok(box.tagBox && box.markBox && box.cardBox);
          assert.ok(box.tagScroll <= box.tagWidth + 1, `${viewport.width} ${box.tag} truncated`);
          assert.ok(box.tagBox.right <= box.markBox.left + 1, `${viewport.width} tag overlaps the question mark`);
          assert.ok(box.tagBox.left >= box.cardBox.left - 1 && box.tagBox.bottom <= box.cardBox.bottom + 1);
          assert.equal(box.hitSummary, true, `${viewport.width} question mark is covered`);
        }
        await page.close();
      }
    } finally {
      await browser.close();
    }
  });
});

async function appCss(markup: string) {
  const source = readFileSync(new URL("../styles.css", import.meta.url), "utf8");
  const compiled = await compile(source, { base: new URL("..", import.meta.url).pathname, onDependency() {} });
  const classes = [...markup.matchAll(/class="([^"]+)"/g)].flatMap((match) => match[1].split(/\s+/));
  return compiled.build([...new Set(classes)]);
}

