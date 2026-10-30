import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { DEFAULT_FEES, money2 } from "./format.ts";
import { orderMoney } from "./metrics.ts";
import { partSell } from "./pay.ts";
import {
  applyPartStock,
  bookRepairOrder,
  closeRepairOrder,
  dropClosedHistory,
  invoiceRepairOrder,
  reopenRepairOrder,
  ticketBeforeTax,
  unbookRepairOrder,
} from "./ro.ts";
import type { Advisor, ClosedRecord, Customer, PartSku, RepairOrder, Tech, TimeLog, Vehicle } from "./types.ts";
import { fullVin } from "./vin.ts";
import type { WaRecord } from "./wa.ts";

const advisor: Advisor = {
  id: "adv",
  number: "21",
  name: "Jordan Hale",
  base: 4800,
  laborPercent: 6,
  partsPercent: 3,
};

const tech: Tech = {
  id: "tech",
  number: "41",
  name: "Marcus Hale",
  skill: "master",
  board: "main",
  payStyle: "flat",
  flagRate: 36,
  hourlyRate: 36,
  availableHoursMonth: 118,
  clockedHoursMonth: 0,
  clockedToday: 0,
};

function written(estimate: number, extra = 0): WaRecord {
  return {
    choice: "written",
    initials: "JH",
    date: "2026-10-19",
    time: "09:00",
    estimate,
    cap: 0,
    returnParts: false,
    plate: "ABC123",
    address: "1 Main",
    extras:
      extra > 0
        ? [
            {
              id: "x1",
              date: "2026-10-19",
              time: "10:00",
              employee: "JH",
              person: "Helen",
              phone: "5095550100",
              work: "Rotors",
              amount: extra,
            },
          ]
        : [],
  };
}

function ticket(wa: WaRecord, status: RepairOrder["status"] = "ready"): RepairOrder {
  return {
    id: "ro-1",
    number: 1001,
    openedOn: "2026-10-19",
    promiseTime: "15:00",
    status,
    bay: "ready",
    advisorId: advisor.id,
    customerId: "c",
    vehicleId: "v",
    concern: "Brakes",
    jobs: [],
    mileage: 41220,
    mileageOut: null,
    fees: DEFAULT_FEES.map((line) => ({ ...line })),
    taxRate: 6.5,
    labor: [
      { id: "l1", opcode: "BRK", description: "Brakes", hours: 1.5, rate: 189, payType: "cp", techId: tech.id },
    ],
    parts: [
      { id: "p1", partId: "pads", number: "BL-BRK", description: "Pads", qty: 2, cost: 10, price: 41.95, payType: "cp", condition: "new" },
    ],
    invoicedOn: null,
    stockApplied: false,
    inspection: null,
    wa,
  };
}

function bin(onHand: number): PartSku {
  return {
    id: "pads",
    number: "BL-BRK",
    description: "Pads",
    bin: "B-04",
    onHand,
    onOrder: 0,
    cost: 10,
    list: 41.95,
    lastSale: "2026-10-01",
    source: "Factory",
  };
}

const log: TimeLog = {
  id: "clk",
  techId: tech.id,
  orderId: "ro-1",
  startedAt: "2026-10-19T09:00:00",
  endedAt: "2026-10-19T10:00:00",
};

describe("repair order money", () => {
  const order = ticket(written(400));

  it("prices labor, parts, capped fees, and tax", () => {
    // 8% of labor + parts reaches the $35 shop-fee cap at $437.50.
    // 2.5h × $189 + $50 of parts is $522.50, so the cap has to bind.
    const capped = {
      ...order,
      labor: [{ ...order.labor[0], hours: 2.5 }],
      parts: [{ ...order.parts[0], qty: 1, price: 50 }],
      fees: [{ id: "shop", name: "Misc Shop Fee", amount: 8, basis: "percent" as const, cap: 35 }],
    };
    const money = orderMoney(capped);
    assert.ok(money.labor + money.parts >= 437.5);
    assert.equal(money.labor, 472.5);
    assert.equal(money.parts, 50);
    assert.equal(money.fees, 35);
    // Ticket is labor + parts + the capped fee. Tax is 6.5% of that.
    assert.equal(money2(money.ticket), 557.5);
    assert.equal(money2(ticketBeforeTax(capped)), 557.5);
    assert.equal(money.tax, 36.24);
    assert.equal(money2(money.total), 593.74);
  });

  it("sells parts by pay type", () => {
    assert.equal(partSell(46, 118, "customer"), 118);
    assert.equal(partSell(46, 118, "warranty"), 62.1);
    assert.equal(partSell(7.5, 19.95, "internal"), 8.4);
  });
});

describe("RCW 46.71 authorization", () => {
  it("books a written estimate within ten percent and blocks one past it", () => {
    assert.equal(bookRepairOrder(ticket(written(400)))?.status, "booked");
    assert.equal(bookRepairOrder(ticket(written(300))), null);
    assert.equal(bookRepairOrder(ticket(written(300, 80)))?.status, "booked");
  });

  it("honors a cap, a drop-off amount, and a waiver", () => {
    const cap = ticket({ ...written(0), choice: "cap", cap: 100, estimate: 0 });
    assert.equal(bookRepairOrder(cap), null);
    const drop = ticket({ ...written(500), choice: "dropoff" });
    assert.equal(bookRepairOrder(drop)?.status, "booked");
    const waive = ticket({ ...written(1), choice: "waive", estimate: 0 });
    assert.equal(bookRepairOrder(waive)?.status, "booked");
  });

  it("blocks booking and closing when the authorization is incomplete", () => {
    const incomplete = closable(ticket({ ...written(900), initials: "  " }));
    assert.equal(bookRepairOrder(incomplete), null);
    const booked = { ...incomplete, status: "booked" as const };
    const refused = closeRepairOrder(booked, [bin(4)], closeContext(), who, at, "2026-10-19");
    assert.ok("error" in refused);
    assert.match(refused.error, /Estimate authorization/);
    const month = invoiceRepairOrder(booked, [bin(4)], [tech], [advisor], [log], "2026-10-19");
    assert.equal(month.order.status, "booked");
    assert.equal(month.parts[0]?.onHand, 4);
  });
});

describe("status flow and parts stock", () => {
  it("books, returns to ready, closes, and reopens without a month-close status change", () => {
    const ready = closable(ticket(written(400)));
    const booked = bookRepairOrder(ready);
    assert.ok(booked);
    assert.equal(unbookRepairOrder(booked)?.status, "ready");
    const tooSoon = closeRepairOrder(ready, [bin(4)], closeContext(), who, at, "2026-10-19");
    assert.ok("error" in tooSoon);

    const month = invoiceRepairOrder(booked, [bin(4)], [tech], [advisor], [log], "2026-10-19");
    assert.equal(month.order.status, "booked");
    assert.equal(month.order, booked);
    assert.equal(month.parts[0]?.onHand, 4);

    const closed = closeRepairOrder(booked, [bin(4)], closeContext(), who, at, "2026-10-19");
    assert.ok(!("error" in closed));
    assert.equal(closed.order.status, "closed");
    assert.equal(closed.order.closeNote, "Closed by the advisor.");
    assert.equal(closed.order.closedBy, who.name);
    assert.equal(closed.order.closedAt, at);
    assert.equal(closed.order.invoicedOn, "2026-10-19");
    assert.equal(closed.parts[0]?.onHand, 2);
    assert.equal(closed.parts[0]?.lastSale, "2026-10-19");

    const again = closeRepairOrder(closed.order, closed.parts, closeContext(), who, at, "2026-10-19");
    assert.ok("error" in again);

    const reopened = reopenRepairOrder(closed.order, closed.parts);
    assert.equal(reopened?.order.status, "booked");
    assert.equal(reopened?.order.invoicedOn, null);
    assert.equal(reopened?.order.closedBy, "");
    assert.equal(reopened?.order.stockApplied, false);
    assert.equal(reopened?.parts[0]?.onHand, 4);
  });

  it("lets on-hand go negative so a reopen does not invent parts", () => {
    const booked = bookRepairOrder(closable(ticket(written(400))));
    assert.ok(booked);
    const closed = closeRepairOrder(booked, [bin(1)], closeContext(), who, at, "2026-10-19");
    assert.ok(!("error" in closed));
    assert.equal(closed.parts[0]?.onHand, -1);
    const reopened = reopenRepairOrder(closed.order, closed.parts);
    assert.equal(reopened?.parts[0]?.onHand, 1);
  });

  it("does not move stock twice", () => {
    const booked = { ...closable(ticket(written(400))), status: "booked" as const, stockApplied: true };
    const closed = closeRepairOrder(booked, [bin(5)], closeContext(), who, at, "2026-10-19");
    assert.ok(!("error" in closed));
    assert.equal(closed.parts[0]?.onHand, 5);
    const restored = applyPartStock(closed.parts, { ...closed.order, stockApplied: false }, 1, "2026-10-19");
    assert.equal(restored[0]?.onHand, 7);
  });

  it("drops the closed-history row for a reopened repair order", () => {
    const history = [
      { orderId: "ro-1", id: "h1" },
      { orderId: "ro-2", id: "h2" },
    ] as ClosedRecord[];
    assert.deepEqual(
      dropClosedHistory(history, "ro-1").map((row) => row.orderId),
      ["ro-2"],
    );
  });

  it("refuses to close without an advisor number, a tech number, or clock time", () => {
    const booked = bookRepairOrder(closable(ticket(written(400))));
    assert.ok(booked);
    const noAdvisor = closeRepairOrder(booked, [bin(4)], closeContext({ advisors: [{ ...advisor, number: "" }] }), who, at, "2026-10-19");
    const noTech = closeRepairOrder(booked, [bin(4)], closeContext({ techs: [{ ...tech, number: "" }] }), who, at, "2026-10-19");
    const noClock = closeRepairOrder(booked, [bin(4)], closeContext({ logs: [] }), who, at, "2026-10-19");
    assert.ok("error" in noAdvisor && "error" in noTech && "error" in noClock);
    assert.match(noAdvisor.error, /advisor number/);
    assert.match(noTech.error, /technician number/);
    assert.match(noClock.error, /Clock time/);
    assert.equal(booked.status, "booked");
  });
});

const who = { id: advisor.id, name: advisor.name };
const at = "2026-10-19T20:00:00.000Z";
const customer: Customer = { id: "c", name: "Helen Cho", phone: "5095550101", mobile: "", email: "", noShows: 0 };
const vehicle: Vehicle = {
  id: "v",
  customerId: "c",
  year: 2019,
  make: "Ford",
  model: "F-150",
  vin: fullVin({ prefix: "1FTEW1EP", year: 2019, plant: "A", serial: 123456 }),
};

function closeContext(patch: Partial<{ techs: Tech[]; advisors: Advisor[]; logs: TimeLog[] }> = {}) {
  return { customer, vehicle, techs: patch.techs ?? [tech], advisors: patch.advisors ?? [advisor], logs: patch.logs ?? [log] };
}

function closable(order: RepairOrder): RepairOrder {
  return {
    ...order,
    jobs: [{ id: "j", code: "A", concern: order.concern, cause: "The pads were worn.", correction: "Replaced the pads." }],
    mileageOut: order.mileage + 4,
    parts: order.parts.map((line) => ({ ...line, condition: line.condition ?? "new" })),
  };
}
