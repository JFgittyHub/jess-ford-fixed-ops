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
import { appointmentLoads, onlineSlots, visitLengthError, visitRunsPastClose, visitTimeError, PAST_CLOSE_MESSAGE, PAST_CLOSE_REASON } from "./capacity.ts";
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

describe("round 25 direct past-close boundary", () => {
  const when = "2026-11-04T20:00:00.000Z";

  function stamp(store: ReturnType<typeof shop>) {
    const state = store.getState();
    return {
      appointments: state.appointments.map((row) => `${row.id}|${row.date}|${row.time}|${row.minutes}`).join("\n"),
      overrides: state.overrides.length,
      log: state.settingsLog?.length ?? 0,
      ownership: JSON.stringify(state.ownershipLog ?? []),
      vehicles: state.vehicles.map((row) => `${row.id}|${row.customerId}|${row.vin}`).join("\n"),
      customers: state.customers.length,
    };
  }

  function addBody(state: ReturnType<ReturnType<typeof shop>["getState"]>, patch: Partial<Appointment> = {}) {
    const { status, ...rest } = bookInput(state, patch);
    void status;
    return rest;
  }

  it("refuses a direct past-close update or add with no reason, and logs one override when the reason is real", () => {
    pinClock(when);
    const store = shop();
    const scheduling = store.getState().settings.scheduling;
    assert.equal(visitRunsPastClose(scheduling, friday, "17:00", 120), true);
    assert.equal(visitRunsPastClose(scheduling, friday, "09:00", 600), true);
    assert.equal(visitRunsPastClose(scheduling, friday, "08:00", 600), true);
    assert.equal(visitRunsPastClose(scheduling, friday, "10:00", 630), true);
    assert.equal(visitRunsPastClose(scheduling, friday, "07:30", 600), false);
    assert.equal(visitRunsPastClose(scheduling, saturday, "12:30", 120), true);
    assert.equal(visitRunsPastClose(scheduling, saturday, "12:30", 60), true);

    const quiet = store.getState().saveAdvisorAppointment(bookInput(store.getState(), { vin: "" }));
    assert.equal(quiet.ok, true, quiet.error ?? "");
    const id = quiet.appointmentId;
    store.getState().setWorkingAs("derek");

    const beforeUpdate = stamp(store);
    const missing = store.getState().updateAppointment(id, { time: "17:00", minutes: 120 });
    assert.equal(missing.ok, false);
    assert.equal(missing.needsCloseReason, true);
    assert.equal(missing.error, PAST_CLOSE_REASON);
    assert.deepEqual(stamp(store), beforeUpdate);

    const blank = store.getState().updateAppointment(id, { time: "17:00" }, "   ");
    assert.equal(blank.ok, false);
    assert.equal(blank.error, PAST_CLOSE_REASON);
    assert.deepEqual(stamp(store), beforeUpdate);
    const spaces = store.getState().updateAppointment(id, { minutes: 600 }, " \n\t ");
    assert.equal(spaces.ok, false);
    assert.deepEqual(stamp(store), beforeUpdate);

    store.getState().setWorkingAs("megan");
    const advisor = store.getState().updateAppointment(id, { time: "17:00", minutes: 120 }, "Advisor tried");
    assert.equal(advisor.ok, false);
    assert.equal(advisor.error, PAST_CLOSE_MESSAGE);
    assert.deepEqual(stamp(store), beforeUpdate);

    store.getState().setWorkingAs("derek");
    const timed = store.getState().updateAppointment(id, { time: "17:00" }, "Customer stayed");
    assert.equal(timed.ok, true, timed.error ?? "");
    assert.equal(store.getState().appointments.find((row) => row.id === id)?.time, "17:00");
    const timedLog = store.getState().overrides.filter((row) => row.reason === "past-close");
    assert.equal(timedLog.length, 1);
    assert.equal(timedLog[0].note, "Customer stayed");
    assert.equal(timedLog[0].who, "Derek Lang");
    assert.equal(timedLog[0].whoId, "derek");
    assert.equal(timedLog[0].at, when);
    assert.equal(timed.overrideId, timedLog[0].id);

    const lengthOnly = store.getState().updateAppointment(id, { minutes: 600 }, "Diagnosis ran long");
    assert.equal(lengthOnly.ok, true, lengthOnly.error ?? "");
    assert.equal(store.getState().overrides.filter((row) => row.reason === "past-close").length, 2);
    assert.equal(store.getState().overrides.find((row) => row.id === lengthOnly.overrideId)?.note, "Diagnosis ran long");

    const dayLength = store.getState().updateAppointment(id, { time: "08:00", minutes: 600 });
    assert.equal(dayLength.ok, false);
    assert.equal(dayLength.error, PAST_CLOSE_REASON);
    const longer = store.getState().updateAppointment(id, { time: "10:00", minutes: 630 }, "  ");
    assert.equal(longer.ok, false);
    const fitsClose = store.getState().updateAppointment(id, { time: "07:30", minutes: 600 });
    assert.equal(fitsClose.ok, true, fitsClose.error ?? "");
    assert.equal(fitsClose.overrideId ?? null, null);
    assert.equal(store.getState().appointments.find((row) => row.id === id)?.time, "07:30");

    const tooLong = store.getState().updateAppointment(id, { minutes: 1440 }, "All day");
    assert.match(tooLong.error ?? "", /not on this desk/);
    assert.equal(store.getState().appointments.find((row) => row.id === id)?.minutes, 600);

    const saturdayVisit = store.getState().saveAdvisorAppointment(bookInput(store.getState(), {
      date: saturday, time: "09:00", minutes: 60, vin: "", advisorId: "derek",
    }), undefined, undefined, undefined, undefined);
    assert.equal(saturdayVisit.ok, true, saturdayVisit.error ?? "");
    const saturdayBlank = store.getState().updateAppointment(saturdayVisit.appointmentId, { time: "12:30" }, "  ");
    assert.equal(saturdayBlank.ok, false);
    assert.equal(store.getState().appointments.find((row) => row.id === saturdayVisit.appointmentId)?.time, "09:00");
    const beforeAdds = stamp(store);

    store.getState().setWorkingAs("megan");
    assert.equal(store.getState().addAppointment(addBody(store.getState(), { date: friday, time: "17:00", minutes: 120, vin: "" }), undefined, "Advisor tried"), "");
    assert.deepEqual(stamp(store), beforeAdds);

    store.getState().setWorkingAs("derek");
    assert.equal(store.getState().addAppointment(addBody(store.getState(), { date: friday, time: "17:00", minutes: 120, vin: "" })), "");
    assert.equal(store.getState().addAppointment(addBody(store.getState(), { date: saturday, time: "12:30", minutes: 120, vin: "" }), undefined, "   "), "");
    assert.equal(store.getState().addAppointment(addBody(store.getState(), { date: friday, time: "10:00", minutes: 1440, vin: "" }), undefined, "All day"), "");
    assert.deepEqual(stamp(store), beforeAdds);

    const added = store.getState().addAppointment(addBody(store.getState(), { date: friday, time: "17:00", minutes: 120, vin: "" }), undefined, "Tow truck");
    assert.ok(added);
    const addedLog = store.getState().overrides.filter((row) => row.appointmentId === added && row.reason === "past-close");
    assert.equal(addedLog.length, 1);
    assert.equal(addedLog[0].note, "Tow truck");
    assert.equal(addedLog[0].who, "Derek Lang");
    assert.equal(addedLog[0].at, when);
    const saturdayAdded = store.getState().addAppointment(addBody(store.getState(), { date: saturday, time: "12:30", minutes: 120, vin: "" }), undefined, "Saturday carry");
    assert.ok(saturdayAdded);
    assert.equal(store.getState().overrides.filter((row) => row.appointmentId === saturdayAdded && row.reason === "past-close").length, 1);

    const screenBefore = store.getState().overrides.filter((row) => row.reason === "past-close").length;
    const screened = store.getState().saveAdvisorAppointment(bookInput(store.getState(), {
      date: friday, time: "16:30", minutes: 120, vin: "", advisorId: "derek", concern: "Screen book",
    }), undefined, undefined, undefined, "Screen reason");
    assert.equal(screened.ok, true, screened.error ?? "");
    assert.equal(store.getState().overrides.filter((row) => row.reason === "past-close").length, screenBefore + 1);
    assert.equal(store.getState().overrides.find((row) => row.id === screened.overrideId)?.note, "Screen reason");

    const created = store.getState().saveNewCustomerAppointment({
      name: "Nora Diaz",
      phone: "5095550199",
      email: "",
      year: 2022,
      make: "Ford",
      model: "Escape",
      vin: fullVin({ prefix: "1FTAB12C", year: 2022, plant: "G", serial: 6161 }),
      plate: "NORA1",
      date: saturday,
      time: "08:30",
      minutes: 300,
      advisorId: "derek",
      techId: "marcus",
      lane: "drop",
      concern: "Stays late",
      lines: [{ id: "a", code: "A", concern: "Stays late" }],
      laborOpIds: [],
    }, undefined, undefined, "New customer reason");
    assert.equal(created.ok, true, created.error ?? "");
    assert.equal(store.getState().overrides.filter((row) => row.appointmentId === created.appointmentId && row.reason === "past-close").length, 1);
    assert.equal(store.getState().overrides.find((row) => row.id === created.overrideId)?.note, "New customer reason");
  });
});

describe("round 25 date-only hours and unchanged past-close edits", () => {
  const when = "2026-11-04T20:00:00.000Z";

  function stamp(store: ReturnType<typeof shop>) {
    const state = store.getState();
    return {
      appointments: state.appointments.map((row) => `${row.id}|${row.date}|${row.time}|${row.minutes}|${row.concern}`).join("\n"),
      overrides: state.overrides.length,
      log: state.settingsLog?.length ?? 0,
      ownership: JSON.stringify(state.ownershipLog ?? []),
      vehicles: state.vehicles.map((row) => `${row.id}|${row.customerId}|${row.vin}`).join("\n"),
      customers: state.customers.length,
    };
  }

  it("refuses a date-only move onto an illegal start and keeps a past-close reason for a real schedule change", () => {
    pinClock(when);
    const store = shop();
    const scheduling = store.getState().settings.scheduling;
    assert.equal(visitRunsPastClose(scheduling, saturday, "16:00", 60), false);
    assert.match(visitTimeError(scheduling, saturday, "16:00") ?? "", /outside shop hours/);
    assert.equal(visitRunsPastClose(scheduling, saturday, "11:30", 120), true);
    assert.equal(visitRunsPastClose(scheduling, saturday, "12:30", 30), false);

    const fridayVisit = store.getState().saveAdvisorAppointment(bookInput(store.getState(), { time: "16:00", minutes: 60, vin: "" }));
    assert.equal(fridayVisit.ok, true, fridayVisit.error ?? "");
    const id = fridayVisit.appointmentId;
    const before = stamp(store);

    const advisorUpdate = store.getState().updateAppointment(id, { date: saturday });
    assert.match(advisorUpdate.error ?? "", /outside shop hours/);
    assert.deepEqual(stamp(store), before);
    const advisorMove = store.getState().moveAppointment(id, { date: saturday });
    assert.match(advisorMove.error ?? "", /outside shop hours/);
    assert.deepEqual(stamp(store), before);

    store.getState().setWorkingAs("derek");
    const managerUpdate = store.getState().updateAppointment(id, { date: saturday }, "Saturday anyway");
    assert.match(managerUpdate.error ?? "", /outside shop hours/);
    assert.equal(managerUpdate.ok, false);
    assert.deepEqual(stamp(store), before);
    const managerMove = store.getState().moveAppointment(id, { date: saturday }, false, "Saturday anyway");
    assert.match(managerMove.error ?? "", /outside shop hours/);
    assert.deepEqual(stamp(store), before);
    assert.equal(store.getState().appointments.find((row) => row.id === id)?.date, friday);

    const crossing = store.getState().saveAdvisorAppointment(bookInput(store.getState(), {
      time: "11:30", minutes: 120, vin: "", advisorId: "derek", concern: "Crosses close",
    }));
    assert.equal(crossing.ok, true, crossing.error ?? "");
    store.getState().setWorkingAs("megan");
    const advisorCross = store.getState().updateAppointment(crossing.appointmentId, { date: saturday });
    assert.equal(advisorCross.error, PAST_CLOSE_MESSAGE);
    const advisorCrossMove = store.getState().moveAppointment(crossing.appointmentId, { date: saturday });
    assert.equal(advisorCrossMove.error, PAST_CLOSE_MESSAGE);
    assert.equal(store.getState().appointments.find((row) => row.id === crossing.appointmentId)?.date, friday);
    store.getState().setWorkingAs("derek");
    const missing = store.getState().updateAppointment(crossing.appointmentId, { date: saturday }, "  ");
    assert.equal(missing.error, PAST_CLOSE_REASON);
    assert.equal(store.getState().appointments.find((row) => row.id === crossing.appointmentId)?.date, friday);
    const approved = store.getState().updateAppointment(crossing.appointmentId, { date: saturday }, "Staying past one");
    assert.equal(approved.ok, true, approved.error ?? "");
    assert.equal(store.getState().overrides.filter((row) => row.appointmentId === crossing.appointmentId && row.reason === "past-close").length, 1);
    assert.equal(store.getState().overrides.find((row) => row.id === approved.overrideId)?.note, "Staying past one");
    const back = store.getState().updateAppointment(crossing.appointmentId, { date: friday }, "Back to Friday");
    assert.equal(back.ok, true, back.error ?? "");
    const moveApproved = store.getState().moveAppointment(crossing.appointmentId, { date: saturday }, false, "Moved past one");
    assert.equal(moveApproved.ok, true, moveApproved.error ?? "");
    assert.equal(store.getState().overrides.filter((row) => row.appointmentId === crossing.appointmentId && row.reason === "past-close" && row.note === "Moved past one").length, 1);

    const onTime = store.getState().saveAdvisorAppointment(bookInput(store.getState(), {
      time: "12:30", minutes: 30, vin: "", advisorId: "derek",
    }));
    assert.equal(onTime.ok, true, onTime.error ?? "");
    const beforeOnTime = store.getState().overrides.length;
    store.getState().setWorkingAs("megan");
    const exact = store.getState().moveAppointment(onTime.appointmentId, { date: saturday });
    assert.equal(exact.ok, true, exact.error ?? "");
    assert.equal(store.getState().appointments.find((row) => row.id === onTime.appointmentId)?.date, saturday);
    assert.equal(store.getState().overrides.length, beforeOnTime);

    const late = store.getState().saveAdvisorAppointment(bookInput(store.getState(), {
      time: "16:30", minutes: 120, vin: "", advisorId: "megan", concern: "Screen", lines: [{ id: "a", code: "A", concern: "Screen" }],
    }), undefined, undefined, undefined, "Screen reason");
    assert.equal(late.ok, false);
    store.getState().setWorkingAs("derek");
    const approvedLate = store.getState().saveAdvisorAppointment(bookInput(store.getState(), {
      time: "16:30", minutes: 120, vin: "", advisorId: "derek", concern: "Screen", lines: [{ id: "a", code: "A", concern: "Screen" }],
    }), undefined, undefined, undefined, "Screen reason");
    assert.equal(approvedLate.ok, true, approvedLate.error ?? "");
    const concernOnly = store.getState().saveAdvisorAppointment(bookInput(store.getState(), {
      time: "16:30", minutes: 120, vin: "", advisorId: "derek", concern: "Updated concern", lines: [{ id: "a", code: "A", concern: "Updated concern" }],
    }), approvedLate.appointmentId);
    assert.equal(concernOnly.ok, true, concernOnly.error ?? "");
    assert.equal(store.getState().appointments.find((row) => row.id === approvedLate.appointmentId)?.concern, "A. Updated concern");
    const kept = store.getState().overrides.filter((row) => row.appointmentId === approvedLate.appointmentId && row.reason === "past-close");
    assert.equal(kept.length, 1);
    assert.equal(kept[0].note, "Screen reason");
    const blankShift = store.getState().saveAdvisorAppointment(bookInput(store.getState(), {
      time: "17:00", minutes: 120, vin: "", advisorId: "derek", concern: "Updated concern", lines: [{ id: "a", code: "A", concern: "Updated concern" }],
    }), approvedLate.appointmentId, undefined, undefined, "   ");
    assert.equal(blankShift.ok, false);
    assert.equal(blankShift.needsCloseReason, true);
    assert.equal(store.getState().appointments.find((row) => row.id === approvedLate.appointmentId)?.time, "16:30");
    assert.equal(store.getState().overrides.filter((row) => row.appointmentId === approvedLate.appointmentId && row.reason === "past-close").length, 1);
    const shifted = store.getState().saveAdvisorAppointment(bookInput(store.getState(), {
      time: "17:00", minutes: 120, vin: "", advisorId: "derek", concern: "Updated concern", lines: [{ id: "a", code: "A", concern: "Updated concern" }],
    }), approvedLate.appointmentId, undefined, undefined, "Second reason");
    assert.equal(shifted.ok, true, shifted.error ?? "");
    const rows = store.getState().overrides.filter((row) => row.appointmentId === approvedLate.appointmentId && row.reason === "past-close");
    assert.equal(rows.length, 2);
    assert.equal(rows.some((row) => row.note === "Screen reason"), true);
    assert.equal(rows.filter((row) => row.note === "Second reason").length, 1);
  });
});

describe("round 25 edit form past-close reason", () => {
  const when = "2026-11-10T20:00:00.000Z";
  const friday13 = "2026-11-13";

  function setControl(control: HTMLInputElement | HTMLSelectElement, value: string) {
    const proto = control instanceof HTMLSelectElement ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(proto, "value")?.set?.call(control, value);
    control.dispatchEvent(new Event("input", { bubbles: true }));
    control.dispatchEvent(new Event("change", { bubbles: true }));
  }

  function prepare() {
    pinClock(when);
    const store = shop();
    store.getState().setWorkingAs("derek");
    const saved = store.getState().saveAdvisorAppointment(bookInput(store.getState(), {
      date: friday13,
      time: "16:00",
      minutes: 120,
      vin: "",
      advisorId: "derek",
      concern: "Already approved",
      lines: [{ id: "a", code: "A", concern: "Already approved" }],
    }), undefined, undefined, undefined, "Already approved");
    assert.equal(saved.ok, true, saved.error ?? "");
    return { store, id: saved.appointmentId };
  }

  function mount(store: ReturnType<typeof shop>, id: string, manager: boolean) {
    const state = store.getState();
    const row = state.appointments.find((item) => item.id === id);
    assert.ok(row);
    const host = document.createElement("div");
    document.body.appendChild(host);
    const root = createRoot(host);
    flushSync(() => {
      root.render(createElement(AppointmentFields, {
        initial: row,
        customers: state.customers,
        vehicles: state.vehicles,
        advisors: state.advisors,
        techs: state.techs,
        laborOps: state.laborOps,
        transports: state.settings.scheduling.transportOptions,
        submitLabel: "Save changes",
        showStatus: true,
        manager,
        scheduling: state.settings.scheduling,
        onSubmit: (value, confirm, transfer, reason) => {
          const result = store.getState().saveAdvisorAppointment(value, id, confirm, transfer, reason);
          return result.ok ? null : result.error;
        },
      }));
    });
    const concern = [...host.querySelectorAll("label")].find((label) => label.textContent?.startsWith("Concern"))?.querySelector("input");
    const length = host.querySelector<HTMLSelectElement>("[aria-label='Visit length']");
    const day = host.querySelector<HTMLInputElement>("input[type='date']");
    assert.ok(concern instanceof HTMLInputElement && length && day);
    return { host, root, concern, length, day };
  }

  function pastCloseRows(store: ReturnType<typeof shop>, id: string) {
    return store.getState().overrides.filter((row) => row.appointmentId === id && row.reason === "past-close");
  }

  it("lets an advisor change only the concern of an approved late visit from the edit form", () => {
    const { store, id } = prepare();
    store.getState().setWorkingAs("megan");
    const view = mount(store, id, false);
    assert.equal(view.host.querySelector("[aria-label='Reason for running past close']"), null);
    assert.equal(view.host.textContent?.includes(PAST_CLOSE_MESSAGE), false);
    flushSync(() => setControl(view.concern, "Advisor rewrote the concern"));
    flushSync(() => view.host.querySelector("form")?.requestSubmit());
    assert.equal(store.getState().appointments.find((row) => row.id === id)?.concern, "A. Advisor rewrote the concern");
    const kept = pastCloseRows(store, id);
    assert.equal(kept.length, 1);
    assert.equal(kept[0].note, "Already approved");
    assert.equal(kept[0].who, "Derek Lang");
    assert.equal(kept[0].at, when);
    const day = view.host.querySelector<HTMLInputElement>("input[type='date']");
    assert.ok(day);
    flushSync(() => setControl(day, "2026-11-20"));
    assert.match(view.host.textContent ?? "", /past closing/);
    flushSync(() => view.host.querySelector("form")?.requestSubmit());
    assert.equal(store.getState().appointments.find((row) => row.id === id)?.date, friday13);
    assert.equal(pastCloseRows(store, id).length, 1);
    const restoredDay = view.host.querySelector<HTMLInputElement>("input[type='date']");
    const restoredConcern = [...view.host.querySelectorAll("label")].find((label) => label.textContent?.startsWith("Concern"))?.querySelector("input");
    assert.ok(restoredDay && restoredConcern instanceof HTMLInputElement);
    flushSync(() => setControl(restoredDay, friday13));
    assert.equal(view.host.textContent?.includes(PAST_CLOSE_MESSAGE), false);
    flushSync(() => setControl(restoredConcern, "Back to the original clock"));
    flushSync(() => view.host.querySelector("form")?.requestSubmit());
    assert.equal(store.getState().appointments.find((row) => row.id === id)?.concern, "A. Back to the original clock");
    assert.equal(pastCloseRows(store, id).length, 1);
    view.root.unmount();
    view.host.remove();
  });

  it("lets a service manager change only the concern, and asks again only when the clock changes", () => {
    const { store, id } = prepare();
    const view = mount(store, id, true);
    assert.equal(view.host.querySelector("[aria-label='Reason for running past close']"), null);
    flushSync(() => setControl(view.concern, "Manager rewrote the concern"));
    flushSync(() => view.host.querySelector("form")?.requestSubmit());
    assert.equal(store.getState().appointments.find((row) => row.id === id)?.concern, "A. Manager rewrote the concern");
    assert.equal(pastCloseRows(store, id).length, 1);
    assert.equal(pastCloseRows(store, id)[0].note, "Already approved");
    const movedDay = view.host.querySelector<HTMLInputElement>("input[type='date']");
    assert.ok(movedDay);
    flushSync(() => setControl(movedDay, "2026-11-20"));
    const reason = view.host.querySelector<HTMLInputElement>("[aria-label='Reason for running past close']");
    assert.ok(reason);
    flushSync(() => view.host.querySelector("form")?.requestSubmit());
    assert.match(view.host.textContent ?? "", /Add a reason/);
    assert.equal(store.getState().appointments.find((row) => row.id === id)?.date, friday13);
    assert.equal(pastCloseRows(store, id).length, 1);
    const restoredDay = view.host.querySelector<HTMLInputElement>("input[type='date']");
    const restoredConcern = [...view.host.querySelectorAll("label")].find((label) => label.textContent?.startsWith("Concern"))?.querySelector("input");
    assert.ok(restoredDay && restoredConcern instanceof HTMLInputElement);
    flushSync(() => setControl(restoredDay, friday13));
    assert.equal(view.host.querySelector("[aria-label='Reason for running past close']"), null);
    flushSync(() => setControl(restoredConcern, "Clock restored"));
    flushSync(() => view.host.querySelector("form")?.requestSubmit());
    assert.equal(store.getState().appointments.find((row) => row.id === id)?.concern, "A. Clock restored");
    assert.equal(pastCloseRows(store, id).length, 1);
    const again = view.host.querySelector<HTMLInputElement>("input[type='date']");
    assert.ok(again);
    flushSync(() => setControl(again, "2026-11-20"));
    const againReason = view.host.querySelector<HTMLInputElement>("[aria-label='Reason for running past close']");
    assert.ok(againReason);
    flushSync(() => setControl(againReason, "Ran longer"));
    flushSync(() => view.host.querySelector("form")?.requestSubmit());
    assert.equal(store.getState().appointments.find((row) => row.id === id)?.date, "2026-11-20");
    assert.equal(pastCloseRows(store, id).length, 2);
    assert.equal(pastCloseRows(store, id).some((row) => row.note === "Already approved"), true);
    assert.equal(pastCloseRows(store, id).filter((row) => row.note === "Ran longer").length, 1);
    view.root.unmount();
    view.host.remove();
    const illegal = mount(store, id, true);
    const illegalDay = illegal.host.querySelector<HTMLInputElement>("input[type='date']");
    assert.ok(illegalDay);
    flushSync(() => setControl(illegalDay, "2026-11-14"));
    assert.equal(illegal.host.querySelector("[aria-label='Reason for running past close']"), null);
    flushSync(() => illegal.host.querySelector("form")?.requestSubmit());
    assert.match(illegal.host.textContent ?? "", /outside shop hours/);
    assert.equal(store.getState().appointments.find((row) => row.id === id)?.date, "2026-11-20");
    illegal.root.unmount();
    illegal.host.remove();
  });

  it("still protects a new past-close booking and a past-day status edit", () => {
    pinClock(when);
    const store = shop();
    store.getState().setWorkingAs("derek");
    const state = store.getState();
    const seed = bookInput(state, { date: friday13, time: "16:00", minutes: 120, vin: "", advisorId: "derek" });
    const host = document.createElement("div");
    document.body.appendChild(host);
    const root = createRoot(host);
    const draw = (manager: boolean, time: string, minutes: number) => {
      flushSync(() => {
        root.render(createElement(AppointmentFields, {
          initial: { ...seed, time, minutes },
          customers: state.customers,
          vehicles: state.vehicles,
          advisors: state.advisors,
          techs: state.techs,
          laborOps: state.laborOps,
          transports: state.settings.scheduling.transportOptions,
          submitLabel: "Book it",
          manager,
          scheduling: state.settings.scheduling,
          onSubmit: (value, _confirm, _transfer, reason) => {
            const result = store.getState().saveAdvisorAppointment(value, undefined, undefined, undefined, reason);
            return result.ok ? null : result.error;
          },
        }));
      });
    };
    draw(false, "16:00", 120);
    assert.match(host.textContent ?? "", /past closing/);
    const before = store.getState().appointments.length;
    flushSync(() => host.querySelector("form")?.requestSubmit());
    assert.equal(store.getState().appointments.length, before);
    draw(true, "16:00", 120);
    const reason = host.querySelector<HTMLInputElement>("[aria-label='Reason for running past close']");
    assert.ok(reason);
    flushSync(() => host.querySelector("form")?.requestSubmit());
    assert.match(host.textContent ?? "", /Add a reason/);
    assert.equal(store.getState().appointments.length, before);
    flushSync(() => setControl(reason, "New booking stays late"));
    flushSync(() => host.querySelector("form")?.requestSubmit());
    assert.equal(store.getState().appointments.length, before + 1);
    assert.equal(store.getState().overrides.filter((row) => row.note === "New booking stays late").length, 1);
    const exactHost = document.createElement("div");
    document.body.appendChild(exactHost);
    const exactRoot = createRoot(exactHost);
    flushSync(() => {
      exactRoot.render(createElement(AppointmentFields, {
        initial: { ...seed, date: "2026-11-14", time: "12:30", minutes: 30 },
        customers: state.customers,
        vehicles: state.vehicles,
        advisors: state.advisors,
        techs: state.techs,
        laborOps: state.laborOps,
        transports: state.settings.scheduling.transportOptions,
        submitLabel: "Book it",
        manager: true,
        scheduling: state.settings.scheduling,
        onSubmit: () => null,
      }));
    });
    assert.equal(exactHost.querySelector("[aria-label='Reason for running past close']"), null);
    exactRoot.unmount();
    exactHost.remove();
    root.unmount();
    host.remove();

    const past = prepare();
    past.store.setState({
      appointments: past.store.getState().appointments.map((row) => row.id === past.id ? { ...row, date: "2026-11-09" } : row),
    });
    const pastView = mount(past.store, past.id, true);
    assert.equal(pastView.day.disabled, true);
    assert.equal(pastView.host.querySelector("[aria-label='Reason for running past close']"), null);
    const status = [...pastView.host.querySelectorAll("label")].find((label) => label.textContent?.startsWith("Status"))?.querySelector("select");
    assert.ok(status);
    flushSync(() => setControl(status, "arrived"));
    flushSync(() => pastView.host.querySelector("form")?.requestSubmit());
    assert.equal(past.store.getState().appointments.find((row) => row.id === past.id)?.status, "arrived");
    assert.equal(pastCloseRows(past.store, past.id).length, 1);
    assert.equal(pastCloseRows(past.store, past.id)[0].note, "Already approved");
    pastView.root.unmount();
    pastView.host.remove();
  });
});

async function appCss(markup: string) {
  const source = readFileSync(new URL("../styles.css", import.meta.url), "utf8");
  const compiled = await compile(source, { base: new URL("..", import.meta.url).pathname, onDependency() {} });
  const classes = [...markup.matchAll(/class="([^"]+)"/g)].flatMap((match) => match[1].split(/\s+/));
  return compiled.build([...new Set(classes)]);
}

