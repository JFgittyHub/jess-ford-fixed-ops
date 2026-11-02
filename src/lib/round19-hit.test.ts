import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { compile } from "@tailwindcss/node";
import { chromium } from "playwright";
import { AppointmentCalendar } from "../components/appointment-calendar.tsx";
import { OnlineRequestList } from "../components/online-request-list.tsx";
import type { Appointment, OnlineRequest } from "./types.ts";

async function appCss(markup: string) {
  const source = readFileSync(new URL("../styles.css", import.meta.url), "utf8");
  const compiled = await compile(source, { base: new URL("..", import.meta.url).pathname, onDependency() {} });
  const classes = [...markup.matchAll(/class="([^"]+)"/g)].flatMap((match) => match[1].split(/\s+/));
  return compiled.build([...new Set(classes)]);
}

function card(id: string, time: string, techId: string, minutes = 30): Appointment {
  return {
    id, date: "2026-11-02", time, minutes, customerId: "c", vehicleId: "v", advisorId: "megan",
    concern: id, lines: [{ id: `${id}-a`, code: "A", concern: id }], vin: "", laborOpIds: [],
    techId, lane: "drop", status: "scheduled", orderId: null,
  };
}

describe("round 19 page hits", () => {
  it("keeps a selected card's length grip off the next card and the empty slot", async () => {
    const html = renderToStaticMarkup(createElement(AppointmentCalendar, {
      appointments: [
        card("upper", "09:00", "marcus"),
        card("lower", "09:30", "marcus"),
        card("solo", "09:00", "elena"),
        card("closing", "17:30", "marcus"),
      ],
      day: "2026-11-02",
      techs: [
        { id: "marcus", number: "1", name: "Marcus", board: "main" },
        { id: "elena", number: "2", name: "Elena", board: "express" },
      ],
      selectedId: "upper",
      onSelect: () => undefined,
      onSlot: () => undefined,
      onMove: () => undefined,
      onWrite: () => undefined,
      onEdit: () => undefined,
      label: (row) => row.id,
      summary: () => ({
        name: "Pat", vehicle: "Ford", advisor: "Megan", tech: "Marcus", when: "9:00", lane: "Drop",
        concern: "Oil", vin: "", ops: "", status: "Scheduled", canWrite: false,
      }),
      hoursFor: () => 1,
    }));
    const browser = await chromium.launch({ headless: true });
    try {
      const page = await browser.newPage({ viewport: { width: 1200, height: 900 } });
      const css = await appCss(html);
      await page.setContent(`<!doctype html><html><head><style>${css}</style></head><body style="margin:0">${html}</body></html>`);
      const hit = await page.evaluate(() => {
        const box = (selector: string) => document.querySelector(selector)?.getBoundingClientRect() ?? null;
        const upper = box("[data-appt-id='upper']");
        const lower = box("[data-appt-id='lower']");
        const grip = box("[data-appt-id='upper'] [data-drag='resize']");
        const solo = box("[data-appt-id='solo']");
        const soloColumn = document.querySelector("[data-appt-id='solo']")?.closest("[data-tech]")?.getBoundingClientRect() ?? null;
        const closing = box("[data-appt-id='closing']");
        const closingGrip = box("[data-appt-id='closing'] [data-drag='resize']");
        const closingColumn = document.querySelector("[data-appt-id='closing']")?.closest("[data-tech]")?.getBoundingClientRect() ?? null;
        const at = (x: number, y: number) => document.elementFromPoint(x, y);
        const lowerHit = lower ? at(lower.left + lower.width / 2, lower.top + lower.height / 2) : null;
        const slotHit = solo ? at(solo.left + Math.min(24, solo.width / 2), solo.bottom + 16) : null;
        const upperStyle = getComputedStyle(document.querySelector("[data-appt-id='upper']") as Element);
        const lowerStyle = getComputedStyle(document.querySelector("[data-appt-id='lower']") as Element);
        return {
          upper, lower, grip, solo, soloColumn, closing, closingGrip, closingColumn,
          lowerId: lowerHit?.closest("[data-appt]")?.getAttribute("data-appt-id") ?? "",
          lowerDrag: lowerHit?.closest("[data-drag]")?.getAttribute("data-drag") ?? "",
          slotTech: slotHit?.closest("[data-tech]")?.getAttribute("data-tech") ?? "",
          slotAppt: slotHit?.closest("[data-appt]")?.getAttribute("data-appt-id") ?? "",
          slotResize: Boolean(slotHit?.closest("[data-drag='resize']")),
          upperZ: upperStyle.zIndex,
          lowerZ: lowerStyle.zIndex,
          upperOverflow: upperStyle.overflow,
          gripZ: getComputedStyle(document.querySelector("[data-appt-id='upper'] [data-drag='resize']") as Element).zIndex,
          concern: document.querySelector("[data-appt-id='upper'] [data-concern]")?.getBoundingClientRect() ?? null,
          concernText: document.querySelector("[data-appt-id='upper'] [data-concern]")?.textContent ?? "",
          summary: document.querySelector("[data-appt-id='upper'] [aria-label='Appointment summary']")?.getBoundingClientRect() ?? null,
        };
      });
      assert.ok(hit.upper && hit.lower && hit.grip && hit.solo && hit.closing && hit.closingGrip);
      assert.ok(hit.grip.top >= hit.upper.top - 0.5);
      assert.ok(hit.grip.bottom <= hit.upper.bottom + 0.5);
      assert.ok(hit.grip.height >= 8 && hit.grip.height <= 12);
      assert.equal(hit.lowerId, "lower");
      assert.equal(hit.lowerDrag, "move");
      assert.equal(hit.slotTech, "elena");
      assert.equal(hit.slotAppt, "");
      assert.equal(hit.slotResize, false);
      assert.ok(hit.closingGrip.bottom <= hit.closing.bottom + 0.5);
      assert.ok(hit.closingColumn && hit.closingGrip.bottom <= hit.closingColumn.bottom + 1);
      assert.ok(Number(hit.upperZ) <= Number(hit.lowerZ));
      assert.equal(hit.upperOverflow, "hidden");
      assert.equal(hit.gripZ, "0");
      assert.ok(hit.concern && hit.concern.height >= 8);
      assert.equal(hit.concernText, "upper");
      assert.ok(hit.concern && hit.grip && hit.concern.bottom <= hit.grip.top + 1);
      assert.ok(hit.summary && hit.summary.width >= 44 && hit.summary.height >= 44);
      assert.ok(hit.soloColumn);
      assert.ok(hit.solo.bottom + 16 <= hit.soloColumn.bottom);
    } finally {
      await browser.close();
    }
  });

  it("shows Cancel and Override on a phone without sideways scrolling", async () => {
    const row = {
      id: "rq-1", storeId: "grand-coulee", status: "pending", createdAt: "2026-10-31T16:00:00.000Z",
      serviceId: "oil", serviceName: "Oil", laborHours: 0.5, date: "2026-11-10", time: "08:00",
      advisorId: "megan", advisorName: "Megan Cho", techId: "marcus", techName: "Marcus Hale",
      transportId: "drop", transportName: "Drop", contactMethod: "text", verified: false,
      customerId: null, customerName: "Pat Example", phone: "5095550100", email: "", vehicleId: null,
      year: 2020, make: "Ford", model: "Escape", vin: "1FTAB12C3NG000002", plate: "ABC", appointmentId: null,
    } as OnlineRequest;
    const html = renderToStaticMarkup(createElement(OnlineRequestList, {
      rows: [row],
      rowWarning: { id: "rq-1", text: "Pat Example at Tue, Nov 10, 8:00 AM PT. That time is heavy." },
      onCancelWarning: () => undefined,
      onConfirmWarning: () => undefined,
    }));
    const css = await appCss(html);
    const browser = await chromium.launch({ headless: true });
    try {
      const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
      await page.setContent(`<!doctype html><html><head><style>${css}</style></head><body style="margin:0">${html}</body></html>`);
      const box = await page.evaluate(() => {
        const warning = document.querySelector("[data-approve-warning]")?.getBoundingClientRect();
        const buttons = [...document.querySelectorAll("[data-approve-warning] button")].map((button) => button.getBoundingClientRect());
        return { warning, buttons, width: window.innerWidth };
      });
      assert.ok(box.warning);
      assert.ok(box.warning.top < 844);
      assert.ok(box.warning.left >= 0 && box.warning.right <= box.width + 1);
      assert.equal(box.buttons.length, 2);
      for (const button of box.buttons) {
        assert.ok(button.top >= 0 && button.bottom <= 844);
        assert.ok(button.left >= 0 && button.right <= box.width + 1);
      }
    } finally {
      await browser.close();
    }
  });
});
