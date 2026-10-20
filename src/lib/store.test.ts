import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import { pinClock, resetClock } from "./clock.ts";
import { createEmptyShop, createSeed } from "./seed.ts";
import { confirmedDemoStaffAccess } from "./demo.ts";
import { SCORECARD_STORAGE_KEY, SHOP_STORAGE_KEY, type ShopStorage } from "./shop-storage.ts";
import { createShopStore, migrateSavedShop, mergeSavedShop, sampleLoadAllowed, useShop } from "./store.ts";
import type { Advisor, RepairOrder, Tech, TimeLog } from "./types.ts";
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
    assert.equal("adminPassword" in cleared.settings, false);
    assert.equal(cleared.settings.storeName, "Coulee");
    assert.equal(cleared.settings.cpRate, 210);
    assert.equal(cleared.settings.targetElr, 190);

    useShop.getState().resetDemo();
    const seeded = useShop.getState();
    assert.ok(seeded.customers.length > 0);
    assert.equal("adminPassword" in seeded.settings, false);
    assert.equal(seeded.settings.storeName, "Coulee");
    assert.equal(seeded.settings.cpRate, 210);
    assert.equal(seeded.settings.targetElr, 190);
    assert.equal(seeded.dataset, "sample");
  });

  it("treats a cleared shop as real data and a loaded sample as the demo dataset", () => {
    const sample = createSeed();
    useShop.setState({
      ...sample,
      settings: { ...sample.settings, storeName: "Coulee" },
    });
    useShop.getState().clearShop();
    assert.equal(useShop.getState().dataset, "shop");
    assert.equal(useShop.getState().settings.storeName, "Coulee");
    useShop.getState().resetDemo();
    assert.equal(useShop.getState().dataset, "sample");
    assert.equal(useShop.getState().settings.storeName, "Coulee");
  });

  it("strips staff passwords and the admin password on every load path", () => {
    const savedSettings = { ...createEmptyShop().settings, adminPassword: "kept-secret", storeName: "Coulee" };
    const bare = migrateSavedShop({
      advisors: [{ ...advisor, password: "21" }],
      techs: [{ ...tech, password: "41" }],
      settings: savedSettings,
    });
    assert.equal(Object.hasOwn(bare.advisors[0] as object, "password"), false);
    assert.equal(Object.hasOwn(bare.techs[0] as object, "password"), false);
    assert.equal(Object.hasOwn(bare.settings, "adminPassword"), false);
    assert.equal(bare.settings.storeName, "Coulee");
    assert.equal(bare.dataset, "shop");

    const withOrders = migrateSavedShop({
      orders: [bookedOrder()],
      advisors: [{ ...advisor, password: "21" }],
      techs: [{ ...tech, password: "41" }],
      settings: { ...savedSettings, adminPassword: "old-admin" },
    });
    assert.equal(Object.hasOwn(withOrders.advisors[0] as object, "password"), false);
    assert.equal(Object.hasOwn(withOrders.techs[0] as object, "password"), false);
    assert.equal(Object.hasOwn(withOrders.settings, "adminPassword"), false);
    assert.equal(withOrders.settings.storeName, "Coulee");
    assert.equal(withOrders.orders.length, 1);
  });

  it("refuses to replace a real shop with the sample month unless that replacement is confirmed", () => {
    const empty = createEmptyShop();
    const withCustomer = {
      ...empty,
      customers: [{ id: "c", name: "Helen", phone: "5095550100" }],
    };
    assert.equal(sampleLoadAllowed(withCustomer, false), false);
    assert.equal(sampleLoadAllowed(withCustomer, true), true);
    assert.equal(sampleLoadAllowed(empty, false), true);
    assert.equal(sampleLoadAllowed({ ...createSeed(), settings: empty.settings }, false), true);

    useShop.setState({
      ...withCustomer,
      settings: { ...empty.settings, storeName: "Coulee" },
    });
    useShop.getState().resetDemo();
    assert.equal(useShop.getState().customers.length, 1);
    assert.equal(useShop.getState().dataset, "shop");
    assert.equal(useShop.getState().settings.storeName, "Coulee");
    useShop.getState().resetDemo(true);
    assert.ok(useShop.getState().customers.length > 1);
    assert.equal(useShop.getState().dataset, "sample");
    assert.equal(useShop.getState().settings.storeName, "Coulee");
  });

  it("keeps a demo visit in memory and drops it on reload", async () => {
    const backing = memoryStorage();
    const demoBlob = JSON.stringify({
      state: {
        dataset: "sample",
        customers: [{ id: "old", name: "Helen Typed" }],
        advisors: [{ id: "old", name: "Typed Advisor", password: "21" }],
        settings: { adminPassword: "kept-secret" },
      },
      version: 28,
    });
    backing.setItem(SHOP_STORAGE_KEY, demoBlob);
    backing.setItem(SCORECARD_STORAGE_KEY, "{\"typed\":1}");

    const visit = createShopStore({ demoMode: true, storage: backing });
    await visit.persist.rehydrate();
    assert.equal(backing.getItem(SHOP_STORAGE_KEY), null);
    assert.equal(backing.getItem(SCORECARD_STORAGE_KEY), null);
    assert.equal(visit.getState().customers.some((row) => row.name === "Helen Typed"), false);
    const seedCustomers = visit.getState().customers.map((row) => row.name);
    const seedAdvisors = visit.getState().advisors.map((row) => row.name);

    visit.getState().createCustomer({ name: "Helen Typed", phone: "5095550199", year: 2020, model: "F-150" });
    assert.equal(
      visit.getState().addAdvisor({ number: "9901", name: "Typed Advisor", base: 1000, laborPercent: 1, partsPercent: 1 }),
      true,
    );
    assert.equal(visit.getState().dataset, "sample");
    assert.equal(confirmedDemoStaffAccess({ demoFlag: "true", dataset: visit.getState().dataset }), true);
    assert.equal(visit.getState().customers.some((row) => row.name === "Helen Typed"), true);
    assert.equal(backing.getItem(SHOP_STORAGE_KEY), null);
    assert.equal(backing.getItem(SCORECARD_STORAGE_KEY), null);
    assert.equal(backing.size(), 0);

    const reloaded = createShopStore({ demoMode: true, storage: backing });
    await reloaded.persist.rehydrate();
    assert.deepEqual(reloaded.getState().customers.map((row) => row.name), seedCustomers);
    assert.deepEqual(reloaded.getState().advisors.map((row) => row.name), seedAdvisors);
    assert.equal(reloaded.getState().dataset, "sample");
    assert.equal(confirmedDemoStaffAccess({ demoFlag: "true", dataset: reloaded.getState().dataset }), true);
    assert.equal(backing.size(), 0);
  });

  it("does not overwrite a real shop while a demo visit is open", async () => {
    const backing = memoryStorage();
    const real = JSON.stringify({
      state: { dataset: "shop", customers: [{ id: "real", name: "Real Helen" }] },
      version: 28,
    });
    backing.setItem(SHOP_STORAGE_KEY, real);
    const visit = createShopStore({ demoMode: true, storage: backing });
    visit.getState().createCustomer({ name: "Helen Typed", phone: "5095550199", year: 2020, model: "F-150" });
    await visit.persist.rehydrate();
    assert.equal(backing.getItem(SHOP_STORAGE_KEY), real);
    assert.equal(visit.getState().customers.some((row) => row.name === "Real Helen"), false);
    assert.equal(visit.getState().customers.some((row) => row.name === "Helen Typed"), true);
  });

  it("strips passwords from a version 28 blob, including a null advisor and an order with no labor or parts", async () => {
    const broken = migrateSavedShop({
      settings: { ...createEmptyShop().settings, adminPassword: "kept-secret", storeName: "Coulee" },
      advisors: [null, { ...advisor, password: "21" }],
      techs: "oops",
      orders: [{ ...bookedOrder(), labor: undefined, parts: undefined }],
    });
    assert.equal(passwordKeyCount(broken), 0);
    assert.equal(broken.settings.storeName, "Coulee");
    assert.equal(broken.advisors.length, 1);
    assert.equal(Object.hasOwn(broken.advisors[0] as object, "password"), false);
    assert.ok(Array.isArray(broken.orders[0]?.labor));
    assert.ok(Array.isArray(broken.orders[0]?.parts));
    assert.equal(broken.techs, "oops");

    const backing = memoryStorage();
    backing.setItem(SHOP_STORAGE_KEY, JSON.stringify({
      state: {
        dataset: "shop",
        settings: { ...createEmptyShop().settings, adminPassword: "kept-secret", storeName: "Coulee" },
        advisors: [null, { ...advisor, password: "21" }],
        techs: [{ ...tech, password: "41" }],
        orders: [{ ...bookedOrder(), labor: undefined, parts: undefined }],
      },
      version: 28,
    }));
    const shop = createShopStore({ demoMode: false, storage: backing });
    await shop.persist.rehydrate();
    const stored = backing.getItem(SHOP_STORAGE_KEY) ?? "";
    assert.equal(stored.includes("adminPassword"), false);
    assert.equal(stored.includes("\"password\""), false);
    assert.equal(passwordKeyCount(shop.getState().settings), 0);
    assert.equal(passwordKeyCount(shop.getState().advisors), 0);
    assert.equal(passwordKeyCount(shop.getState().techs), 0);
    assert.equal(shop.getState().settings.storeName, "Coulee");
    assert.ok(Array.isArray(shop.getState().orders[0]?.labor));
    assert.ok(Array.isArray(shop.getState().orders[0]?.parts));
    assert.equal(mergeSavedShop(undefined, shop.getState()), shop.getState());
  });
});

function memoryStorage(): ShopStorage & { size: () => number } {
  const items = new Map<string, string>();
  return {
    getItem: (key) => items.get(key) ?? null,
    setItem: (key, value) => {
      items.set(key, value);
    },
    removeItem: (key) => {
      items.delete(key);
    },
    size: () => items.size,
  };
}

function passwordKeyCount(value: unknown): number {
  if (Array.isArray(value)) return value.reduce((sum, item) => sum + passwordKeyCount(item), 0);
  if (!value || typeof value !== "object") return 0;
  return Object.entries(value).reduce((sum, [key, child]) => {
    const here = key === "password" || key === "adminPassword" ? 1 : 0;
    return sum + here + passwordKeyCount(child);
  }, 0);
}