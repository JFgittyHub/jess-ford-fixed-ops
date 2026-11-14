import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { openedInstant } from "./mileage.ts";
import type { ShopStorage } from "./shop-storage.ts";
import { createShopStore, migrateSavedShop } from "./store.ts";

describe("round 10", () => {
  it("reloads round-8 closed repair orders without v34 job ids, fee cleanup, or an invented authorization", () => {
    const orders = [
      ...Array.from({ length: 659 }, (_, index) => round8Closed(`h${index}`, 241201 + index, index < 139)),
      ...Array.from({ length: 672 }, (_, index) => round8Closed(`p${index}`, 318001 + index, index < 135)),
    ];
    const once = migrateSavedShop({ orders });
    const twice = migrateSavedShop(once);
    assert.equal(JSON.stringify(twice.orders), JSON.stringify(once.orders));
    const closed = once.orders ?? [];
    assert.equal(closed.length, 659 + 672);
    const grandCoulee = closed.filter((order) => order.id.startsWith("h"));
    const pullman = closed.filter((order) => order.id.startsWith("p"));
    assert.equal(grandCoulee.length, 659);
    assert.equal(pullman.length, 672);
    for (const order of closed) {
      assert.equal(Boolean(order.labor[0]?.jobId), true);
      assert.equal(Boolean(order.parts[0]?.jobId), true);
      assert.equal(order.fees?.[0]?.amount, 150);
      assert.equal(order.fees?.[0]?.name.length, 120);
      assert.equal(order.wa, undefined);
      assert.equal(JSON.stringify(order).includes("on file"), false);
    }
    assert.equal(grandCoulee.filter((order) => order.jobs.length === 1).length, 520);
    assert.equal(pullman.filter((order) => order.jobs.length === 1).length, 537);
  });

  it("rejects moveWorkToJob on a closed repair order and for a technician", () => {
    const shop = createShopStore({ demoMode: true, storage: memoryStorage() });
    shop.getState().setWorkingAs("megan");
    const created = shop.getState().createCustomer({ name: "Helen Cho", phone: "5095550199", year: 2019, model: "F-150", make: "Ford" });
    const id = shop.getState().createOrder({
      customerId: created.customerId,
      vehicleId: created.vehicleId,
      advisorId: "megan",
      lines: [{ concern: "Brakes" }, { concern: "Oil" }],
      mileage: 4000,
      mileageOut: 4000,
      promiseTime: "",
    });
    const jobs = shop.getState().orders.find((row) => row.id === id)?.jobs ?? [];
    shop.getState().addLabor(id, { opcode: "BRK", description: "Pads", hours: 1, rate: 10, payType: "cp", techId: "marcus", jobId: jobs[1].id });
    shop.getState().setWorkingAs("marcus");
    shop.getState().moveWorkToJob(id, "labor", shop.getState().orders.find((row) => row.id === id)?.labor[0]?.id ?? "", jobs[0].id);
    assert.equal(shop.getState().orders.find((row) => row.id === id)?.labor[0]?.jobId, jobs[1].id);
    shop.getState().setWorkingAs("megan");
    shop.setState({
      orders: shop.getState().orders.map((row) => (row.id === id ? { ...row, status: "closed" as const, authorizationLocked: true } : row)),
    });
    const before = JSON.stringify(shop.getState().orders.find((row) => row.id === id));
    shop.getState().moveWorkToJob(id, "labor", shop.getState().orders.find((row) => row.id === id)?.labor[0]?.id ?? "", jobs[0].id);
    assert.equal(JSON.stringify(shop.getState().orders.find((row) => row.id === id)), before);
  });

  it("keeps a zone-less opened time as Pacific local time and orders legacy rows by number", () => {
    const evening = openedInstant({ openedAt: "2026-10-30T15:50:00", openedOn: "2026-10-30", number: 1 });
    const zoned = openedInstant({ openedAt: "2026-10-30T22:50:00.000Z", number: 1 });
    assert.equal(evening, zoned);
    const earlyNumber = openedInstant({ openedOn: "2026-10-30", number: 319999 });
    const laterNumber = openedInstant({ openedOn: "2026-10-30", number: 320000 });
    assert.equal(earlyNumber, laterNumber);
  });
});

function round8Closed(id: string, number: number, flagged: boolean) {
  const jobId = `${id}-j0`;
  const jobs = flagged
    ? [
        { id: jobId, code: "A", concern: "Brakes", cause: "Worn", correction: "Done" },
        { id: `${id}-b`, code: "B", concern: "Oil", cause: "Due", correction: "Changed" },
        { id: `${id}-assign`, code: "C", concern: "", cause: "", correction: "", needsAssignment: true },
      ]
    : [{ id: jobId, code: "A", concern: "Brakes", cause: "Worn", correction: "Done" }];
  return {
    id,
    number,
    status: "closed" as const,
    openedOn: "2026-10-01",
    jobs,
    labor: [{ id: `${id}-l`, opcode: "BRK", description: "Pads", hours: 1, rate: 10, payType: "cp" as const, techId: "t", jobId: flagged ? `${id}-assign` : jobId }],
    parts: [{ id: `${id}-p`, partId: null, number: "BL", description: "Pad", qty: 1, cost: 1, price: 2, payType: "cp" as const, condition: "new" as const, jobId: flagged ? `${id}-assign` : jobId }],
    fees: [{ id: "shop", name: "X".repeat(120), amount: 150, basis: "percent" as const, cap: 35 }],
    mileage: 1000,
    mileageOut: 1004,
  };
}

function memoryStorage(): ShopStorage {
  const items = new Map<string, string>();
  return {
    getItem: (key) => items.get(key) ?? null,
    setItem: (key, value) => {
      items.set(key, value);
    },
    removeItem: (key) => {
      items.delete(key);
    },
  };
}
