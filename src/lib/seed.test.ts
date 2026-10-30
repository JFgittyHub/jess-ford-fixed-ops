import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import { pinClock, resetClock, todayIso } from "./clock.ts";
import { digest } from "./metrics.ts";
import { createEmptyShop, createSeed } from "./seed.ts";

describe("shop sample data", () => {
  afterEach(() => resetClock());

  it("starts empty, with pay types and zero budgets, and the scorecard still runs", () => {
    const shop = createEmptyShop();
    assert.equal(shop.settings.storeName, "Jess Ford");
    assert.equal("adminPassword" in shop.settings, false);
    assert.deepEqual(
      shop.payTypes.map((row) => [row.id, row.rate]),
      [
        ["cp", 189],
        ["warranty", 168],
        ["internal", 140],
      ],
    );
    assert.equal(shop.customers.length, 0);
    assert.equal(shop.orders.length, 0);
    assert.equal(shop.parts.length, 0);
    assert.ok(shop.budgets.every((row) => row.monthly === 0));
    const report = digest(shop);
    assert.equal(report.hoursSold, 0);
    assert.equal(report.soldCount, 0);
  });

  it("keeps the October 19 sample month when the clock is pinned to that day", () => {
    pinClock("2026-10-19T19:00:00.000Z");
    const shop = createSeed();
    const today = todayIso();
    assert.equal(today, "2026-10-19");
    assert.equal(shop.orders.find((order) => order.id === "open-helen")?.openedOn, "2026-10-19");
    assert.equal(shop.orders.find((order) => order.id === "open-ruth")?.openedOn, "2026-10-17");
    assert.equal(shop.parts.find((part) => part.id === "oil")?.lastSale, "2026-10-17");
    assert.equal(shop.parts.find((part) => part.id === "purge")?.lastSale, "2026-09-02");
    const closed = shop.orders.filter((order) => order.status === "closed");
    assert.ok(closed.length > 0);
    for (const order of closed) {
      assert.equal(order.invoicedOn?.slice(0, 7), "2026-10");
      assert.ok((order.invoicedOn ?? "") < today);
      assert.ok(order.closedBy);
      assert.ok(order.closedAt);
      assert.ok(order.closeNote);
      assert.notEqual(order.closeType, "no_work");
    }
    assert.ok(shop.expenses.length > 0);
    for (const row of shop.expenses) {
      assert.equal(row.date.slice(0, 7), "2026-10");
      assert.ok(row.date <= today);
    }
  });

  it("shifts the sample onto February 1 without future invoices or expenses", () => {
    pinClock("2026-02-01T20:00:00.000Z");
    const shop = createSeed();
    assert.equal(todayIso(), "2026-02-01");
    assert.equal(shop.orders.find((order) => order.id === "open-helen")?.openedOn, "2026-02-01");
    assert.equal(shop.orders.find((order) => order.id === "open-ruth")?.openedOn, "2026-01-30");
    assert.equal(shop.parts.find((part) => part.id === "purge")?.lastSale, "2025-12-16");
    assert.equal(
      shop.orders.some((order) => order.status === "closed"),
      false,
    );
    assert.equal(shop.expenses.length, 0);
    assert.equal(shop.appointments.find((row) => row.id === "a1")?.date, "2026-02-01");
    assert.equal(shop.appointments.find((row) => row.id === "a7")?.date, "2026-02-02");
    assert.doesNotThrow(() => digest(shop));
  });
});
