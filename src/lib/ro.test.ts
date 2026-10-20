import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { DEFAULT_FEES, money2 } from "./format.ts";
import { orderMoney } from "./metrics.ts";
import { partSell } from "./pay.ts";
import {
  applyPartStock,
  bookRepairOrder,
  dropClosedHistory,
  invoiceRepairOrder,
  reopenRepairOrder,
  ticketBeforeTax,
  unbookRepairOrder,
} from "./ro.ts";
import type { Advisor, ClosedRecord, PartSku, RepairOrder, Tech, TimeLog } from "./types.ts";
import type { WaRecord } from "./wa.ts";

const advisor: Advisor = {
  id: "adv",
  number: "21",
  name: "Jordan Hale",
  base: 4800,
  laborPercent: 6,
  partsPercent: 3,
  password: "21",
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
  password: "41",
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
      { id: "p1", partId: "pads", number: "BL-BRK", description: "Pads", qty: 2, cost: 10, price: 41.95, payType: "cp" },
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
    // Labor and parts stay exact hours × rate. The ticket sum can sit a
    // fraction of a cent off in binary; cents are what the desk bills.
    const money = orderMoney(order);
    assert.equal(money.labor, 283.5);
    assert.equal(money.parts, 83.9);
    assert.equal(money.fees, 37.39);
    assert.equal(money2(money.ticket), 404.79);
    assert.equal(money2(ticketBeforeTax(order)), 404.79);
    assert.equal(money.tax, 26.31);
    assert.equal(money2(money.total), 431.1);
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

  it("blocks booking and invoicing when the authorization is incomplete", () => {
    const incomplete = ticket({ ...written(900), initials: "  " });
    assert.equal(bookRepairOrder(incomplete), null);
    const booked = { ...incomplete, status: "booked" as const };
    assert.equal(invoiceRepairOrder(booked, [bin(4)], [tech], [advisor], [log], "2026-10-19"), null);
  });
});

describe("status flow and parts stock", () => {
  it("books, returns to ready, invoices, and reopens", () => {
    const ready = ticket(written(400));
    const booked = bookRepairOrder(ready);
    assert.ok(booked);
    assert.equal(unbookRepairOrder(booked)?.status, "ready");
    assert.equal(invoiceRepairOrder(ready, [bin(4)], [tech], [advisor], [log], "2026-10-19"), null);

    const closed = invoiceRepairOrder(booked, [bin(4)], [tech], [advisor], [log], "2026-10-19");
    assert.ok(closed);
    assert.equal(closed.order.status, "invoiced");
    assert.equal(closed.order.invoicedOn, "2026-10-19");
    assert.equal(closed.parts[0]?.onHand, 2);
    assert.equal(closed.parts[0]?.lastSale, "2026-10-19");

    const again = invoiceRepairOrder(closed.order, closed.parts, [tech], [advisor], [log], "2026-10-19");
    assert.equal(again, null);

    const reopened = reopenRepairOrder(closed.order, closed.parts);
    assert.equal(reopened?.order.status, "ready");
    assert.equal(reopened?.order.invoicedOn, null);
    assert.equal(reopened?.order.stockApplied, false);
    assert.equal(reopened?.parts[0]?.onHand, 4);
  });

  it("lets on-hand go negative so a reopen does not invent parts", () => {
    const booked = bookRepairOrder(ticket(written(400)));
    assert.ok(booked);
    const closed = invoiceRepairOrder(booked, [bin(1)], [tech], [advisor], [log], "2026-10-19");
    assert.equal(closed?.parts[0]?.onHand, -1);
    const reopened = reopenRepairOrder(closed!.order, closed!.parts);
    assert.equal(reopened?.parts[0]?.onHand, 1);
  });

  it("does not move stock twice", () => {
    const booked = { ...ticket(written(400)), status: "booked" as const, stockApplied: true };
    const closed = invoiceRepairOrder(booked, [bin(5)], [tech], [advisor], [log], "2026-10-19");
    assert.equal(closed?.parts[0]?.onHand, 5);
    const restored = applyPartStock(closed!.parts, { ...closed!.order, stockApplied: false }, 1, "2026-10-19");
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

  it("refuses to invoice without an advisor number, a tech number, or clock time", () => {
    const booked = bookRepairOrder(ticket(written(400)));
    assert.ok(booked);
    assert.equal(invoiceRepairOrder(booked, [bin(4)], [tech], [{ ...advisor, number: "" }], [log], "2026-10-19"), null);
    assert.equal(invoiceRepairOrder(booked, [bin(4)], [{ ...tech, number: "" }], [advisor], [log], "2026-10-19"), null);
    assert.equal(invoiceRepairOrder(booked, [bin(4)], [tech], [advisor], [], "2026-10-19"), null);
  });
});
