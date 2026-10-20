import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import { pinClock, resetClock } from "./clock.ts";
import { createEmptyShop } from "./seed.ts";
import { useShop } from "./store.ts";
import type { Advisor, RepairOrder, Tech, TimeLog } from "./types.ts";
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

const wa: WaRecord = {
  choice: "written",
  initials: "JH",
  date: "2026-10-19",
  time: "09:00",
  estimate: 900,
  cap: 0,
  returnParts: false,
  plate: "",
  address: "",
  extras: [],
};

function bookedOrder(): RepairOrder {
  return {
    id: "ro-1",
    number: 1001,
    openedOn: "2026-10-19",
    promiseTime: "15:00",
    status: "booked",
    bay: "ready",
    advisorId: advisor.id,
    customerId: "c",
    vehicleId: "v",
    concern: "Brakes",
    jobs: [],
    mileage: 1000,
    mileageOut: null,
    fees: [],
    taxRate: 0,
    labor: [
      { id: "l1", opcode: "BRK", description: "Brakes", hours: 1, rate: 189, payType: "cp", techId: tech.id },
    ],
    parts: [
      { id: "p1", partId: "pads", number: "BL", description: "Pads", qty: 2, cost: 10, price: 40, payType: "cp" },
    ],
    invoicedOn: null,
    stockApplied: false,
    inspection: null,
    wa,
  };
}

const log: TimeLog = {
  id: "clk",
  techId: tech.id,
  orderId: "ro-1",
  startedAt: "2026-10-19T09:00:00",
  endedAt: "2026-10-19T10:00:00",
};

describe("shop store", () => {
  afterEach(() => {
    resetClock();
    useShop.setState({ ...createEmptyShop(), focusOrderId: null });
  });

  it("drops the closed-history row when a repair order is reopened", () => {
    pinClock("2026-10-19T19:00:00.000Z");
    const empty = createEmptyShop();
    useShop.setState({
      ...empty,
      advisors: [advisor],
      techs: [tech],
      parts: [
        {
          id: "pads",
          number: "BL",
          description: "Pads",
          bin: "B",
          onHand: 4,
          onOrder: 0,
          cost: 10,
          list: 40,
          lastSale: "",
          source: "Factory",
        },
      ],
      orders: [bookedOrder()],
      timeLogs: [log],
      closedHistory: [],
    });
    useShop.getState().invoiceOrder("ro-1");
    assert.equal(
      useShop.getState().closedHistory.some((row) => row.orderId === "ro-1"),
      true,
    );
    useShop.getState().reopenOrder("ro-1");
    const next = useShop.getState();
    assert.equal(next.orders.find((order) => order.id === "ro-1")?.status, "ready");
    assert.equal(
      next.closedHistory.some((row) => row.orderId === "ro-1"),
      false,
    );
    assert.equal(next.parts.find((part) => part.id === "pads")?.onHand, 4);
  });

  it("keeps settings when the shop is cleared or the sample month is loaded", () => {
    const empty = createEmptyShop();
    useShop.setState({
      ...empty,
      settings: {
        ...empty.settings,
        adminPassword: "kept-secret",
        storeName: "Coulee",
        cpRate: 210,
        targetElr: 190,
      },
      customers: [{ id: "c", name: "Helen", phone: "5095550100" }],
      orders: [bookedOrder()],
    });
    useShop.getState().clearShop();
    const cleared = useShop.getState();
    assert.equal(cleared.orders.length, 0);
    assert.equal(cleared.customers.length, 0);
    assert.equal(cleared.settings.adminPassword, "kept-secret");
    assert.equal(cleared.settings.storeName, "Coulee");
    assert.equal(cleared.settings.cpRate, 210);
    assert.equal(cleared.settings.targetElr, 190);

    useShop.getState().resetDemo();
    const seeded = useShop.getState();
    assert.ok(seeded.customers.length > 0);
    assert.equal(seeded.settings.adminPassword, "kept-secret");
    assert.equal(seeded.settings.storeName, "Coulee");
    assert.equal(seeded.settings.cpRate, 210);
    assert.equal(seeded.settings.targetElr, 190);
  });
});