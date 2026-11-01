import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { chromium } from "playwright";
import { AppointmentCalendar } from "../components/appointment-calendar.tsx";
import type { Appointment } from "./types.ts";

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
      await page.setContent(`<!doctype html><html><body style="margin:0">${html}</body></html>`);
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
      assert.ok(hit.soloColumn);
      assert.ok(hit.solo.bottom + 16 <= hit.soloColumn.bottom);
    } finally {
      await browser.close();
    }
  });
});
