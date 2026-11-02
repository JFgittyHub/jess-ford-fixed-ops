import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { bookableDay } from "./bookable-day.ts";
import { RO_CREATION_ENABLED, RO_WRITES_ENABLED, roCreationEnabled, roWritesEnabled } from "./ro-flags.ts";
import { LOCKED_SECTIONS, SECTION_LOCK_ENABLED, isLockedPath, sectionLockEnabled } from "./section-lock.ts";
import type { ShopStorage } from "./shop-storage.ts";
import { createShopStore } from "./store.ts";
import { fullVin } from "./vin.ts";
import { normalizeWa } from "./wa.ts";

const flags = globalThis as {
  __RO_CREATION_ENABLED__?: boolean;
  __RO_WRITES_ENABLED__?: boolean;
  __SECTION_LOCK_ENABLED__?: boolean;
};

/** Sandra's open ticket, stripped to a no-work close that would succeed if writes were on. */
function prepareNoWorkClose(shop: ReturnType<typeof createShopStore>) {
  const order = shop.getState().orders.find((row) => row.id === "open-sandra");
  if (!order) return;
  shop.setState({
    orders: shop.getState().orders.map((row) => (row.id === "open-sandra"
      ? {
          ...row,
          labor: [],
          parts: [],
          jobs: row.jobs.map((job) => ({ ...job, cause: "", correction: "" })),
          inspection: null,
          history: [],
          payments: [],
          fees: [],
          mileageOut: row.mileage + 4,
          wa: { ...normalizeWa(row.wa), address: "100 Main Street" },
        }
      : row)),
    timeLogs: shop.getState().timeLogs.filter((row) => row.orderId !== "open-sandra"),
  });
}

function memoryStorage(): ShopStorage {
  const items = new Map<string, string>();
  return {
    getItem: (key) => items.get(key) ?? null,
    setItem: (key, value) => { items.set(key, value); },
    removeItem: (key) => { items.delete(key); },
  };
}

describe("shipped flags", () => {
  it("pins the shipped flag constants and the 11 locked routes", () => {
    assert.equal(RO_WRITES_ENABLED, false);
    assert.equal(RO_CREATION_ENABLED, false);
    assert.equal(SECTION_LOCK_ENABLED, true);
    assert.deepEqual([...LOCKED_SECTIONS], [
      "/dispatch",
      "/tech-board",
      "/advisors",
      "/service-managers",
      "/parts",
      "/expenses",
      "/customers",
      "/reports",
      "/labor-ops",
      "/pay-types",
      "/fees",
    ]);
    const previous = {
      create: flags.__RO_CREATION_ENABLED__,
      write: flags.__RO_WRITES_ENABLED__,
      lock: flags.__SECTION_LOCK_ENABLED__,
    };
    delete flags.__RO_CREATION_ENABLED__;
    delete flags.__RO_WRITES_ENABLED__;
    delete flags.__SECTION_LOCK_ENABLED__;
    try {
      assert.equal(roWritesEnabled(), false);
      assert.equal(roCreationEnabled(), false);
      assert.equal(sectionLockEnabled(), true);
      assert.equal(isLockedPath("/online-requests"), false);
    } finally {
      flags.__RO_CREATION_ENABLED__ = previous.create;
      flags.__RO_WRITES_ENABLED__ = previous.write;
      flags.__SECTION_LOCK_ENABLED__ = previous.lock;
    }
  });

  it("locks every path variant legal listed", () => {
    const previous = flags.__SECTION_LOCK_ENABLED__;
    flags.__SECTION_LOCK_ENABLED__ = true;
    try {
      for (const path of ["/Fees", "/Labor-Ops", "/%46ees", "//Fees", "/Fees/", "/Fees?x=1", "/Fees#x"]) {
        assert.equal(isLockedPath(path), true, path);
      }
      assert.equal(isLockedPath("/schedule"), false);
    } finally {
      flags.__SECTION_LOCK_ENABLED__ = previous;
    }
  });

  it("locks mixed-case, encoded, and trailing-slash paths", () => {
    const previous = flags.__SECTION_LOCK_ENABLED__;
    flags.__SECTION_LOCK_ENABLED__ = true;
    try {
      assert.equal(isLockedPath("/ADVISORS"), true);
      assert.equal(isLockedPath("/Pay-Types/"), true);
      assert.equal(isLockedPath("/FEES"), true);
      assert.equal(isLockedPath("/Customers"), true);
      assert.equal(isLockedPath("/%66ees"), true);
      assert.equal(isLockedPath("/fees/extra"), true);
      assert.equal(isLockedPath("/schedule"), false);
    } finally {
      flags.__SECTION_LOCK_ENABLED__ = previous;
    }
  });

  it("refuses locked-section edits and repair-order writes at the shipped defaults", () => {
    const previous = {
      create: flags.__RO_CREATION_ENABLED__,
      write: flags.__RO_WRITES_ENABLED__,
      lock: flags.__SECTION_LOCK_ENABLED__,
    };
    flags.__RO_CREATION_ENABLED__ = false;
    flags.__RO_WRITES_ENABLED__ = false;
    flags.__SECTION_LOCK_ENABLED__ = true;
    try {
      const shop = createShopStore({ demoMode: true, storage: memoryStorage() });
      shop.getState().setWorkingAs("megan");
      const before = JSON.stringify(shop.getState().orders);
      const expenses = shop.getState().expenses.length;
      const labor = shop.getState().laborOps.length;
      const parts = shop.getState().parts.map((row) => row.onHand);
      const budgets = shop.getState().budgets.map((row) => row.monthly);
      const overhead = shop.getState().overhead.map((row) => row.monthly);
      const fees = shop.getState().settings.fees.map((row) => row.amount);
      const rate = shop.getState().payTypes.find((row) => row.id === "cp")?.rate;
      const campaigns = shop.getState().campaigns.length;
      const order = shop.getState().orders.find((row) => row.status !== "closed");
      assert.ok(order);
      assert.equal(shop.getState().addLaborOp({ opcode: "ZZ", description: "Nope", hours: 1, payType: "cp" }), undefined);
      shop.getState().updateLaborOp(shop.getState().laborOps[0]?.id ?? "", { hours: 9 });
      shop.getState().removeLaborOp(shop.getState().laborOps[0]?.id ?? "");
      assert.equal(shop.getState().addPayType({ name: "Fleet", rate: 50, kind: "customer" }), false);
      shop.getState().updatePayType("cp", { rate: 1 });
      assert.equal(shop.getState().removePayType("cp"), "locked");
      assert.equal(shop.getState().addFee({ name: "Tow", amount: 4 }), false);
      shop.getState().updateFee(shop.getState().settings.fees[0]?.id ?? "", { amount: 99 });
      shop.getState().removeFee(shop.getState().settings.fees[0]?.id ?? "");
      shop.getState().setOnHand(shop.getState().parts[0]?.id ?? "", 0);
      shop.getState().addSku({ number: "ZZ", description: "Bolt", bin: "A", onHand: 1, onOrder: 0, cost: 1, list: 2, lastSale: "", source: "shop" });
      shop.getState().addExpense({ budgetId: "pol", date: "2026-01-15", vendor: "Shop", amount: 10, note: "Towels" });
      assert.equal(shop.getState().expenses.length, expenses);
      shop.setState({
        expenses: [...shop.getState().expenses, { id: "seed-exp", budgetId: "pol", date: "2026-01-15", vendor: "Shop", amount: 10, note: "Towels" }],
      });
      assert.equal(shop.getState().expenses.length, expenses + 1);
      shop.getState().removeExpense("seed-exp");
      assert.equal(shop.getState().expenses.some((row) => row.id === "seed-exp"), true);
      assert.equal(shop.getState().expenses.length, expenses + 1);
      shop.getState().setBudget(shop.getState().budgets[0]?.id ?? "", 1);
      shop.getState().setOverhead(shop.getState().overhead[0]?.id ?? "", 1);
      shop.getState().sendCampaign({ name: "Due", message: "Come in", audience: "all", recipientIds: [shop.getState().customers[0]?.id ?? ""] });
      shop.getState().invoiceOrder(order.id);
      shop.getState().updateOrder(order.id, { mileage: order.mileage + 5 });
      shop.getState().updateOpenVin(order.id, fullVin({ prefix: "1FTAB12C", year: 2020, plant: "G", serial: 3 }));
      assert.equal(shop.getState().laborOps.length, labor);
      assert.equal(shop.getState().laborOps[0]?.hours === 9, false);
      assert.deepEqual(shop.getState().parts.map((row) => row.onHand), parts);
      assert.deepEqual(shop.getState().budgets.map((row) => row.monthly), budgets);
      assert.deepEqual(shop.getState().overhead.map((row) => row.monthly), overhead);
      assert.deepEqual(shop.getState().settings.fees.map((row) => row.amount), fees);
      assert.equal(shop.getState().payTypes.find((row) => row.id === "cp")?.rate, rate);
      assert.equal(shop.getState().campaigns.length, campaigns);
      assert.equal(JSON.stringify(shop.getState().orders), before);
    } finally {
      flags.__RO_CREATION_ENABLED__ = previous.create;
      flags.__RO_WRITES_ENABLED__ = previous.write;
      flags.__SECTION_LOCK_ENABLED__ = previous.lock;
    }
  });

  it("leaves every guarded repair-order action byte-identical when the shipped flags are off", () => {
    const previous = {
      create: flags.__RO_CREATION_ENABLED__,
      write: flags.__RO_WRITES_ENABLED__,
      lock: flags.__SECTION_LOCK_ENABLED__,
    };
    flags.__RO_CREATION_ENABLED__ = false;
    flags.__RO_WRITES_ENABLED__ = false;
    flags.__SECTION_LOCK_ENABLED__ = true;
    try {
      const shop = createShopStore({ demoMode: true, storage: memoryStorage() });
      shop.getState().setWorkingAs("megan");
      const order = shop.getState().orders.find((row) => row.status !== "closed" && row.jobs.length > 0);
      assert.ok(order);
      const before = JSON.stringify(shop.getState().orders);
      const id = order.id;
      const jobId = order.jobs[0]?.id ?? "";
      const laborId = order.labor[0]?.id ?? "missing-labor";
      const partId = order.parts[0]?.id ?? "missing-part";
      const customer = shop.getState().customers.find((row) => row.id !== order.customerId) ?? shop.getState().customers[0];
      const vehicle = shop.getState().vehicles.find((row) => row.customerId === customer.id) ?? shop.getState().vehicles[0];
      shop.getState().updateOrder(id, { concern: "Changed", mileage: order.mileage + 5, mileageOut: order.mileage + 9, promiseTime: "09:00", advisorId: "derek", status: "ready", bay: "ready" });
      shop.getState().updateJob(id, jobId, { concern: "Nope", cause: "Nope", correction: "Nope" });
      shop.getState().addJob(id);
      shop.getState().removeJob(id, jobId);
      shop.getState().updateWa(id, { address: "1 Main", plate: "ABC123", estimate: 40, choice: "written", returnParts: true });
      shop.getState().addExtraAuth(id, { date: "2026-10-30", time: "09:00", employee: "Megan Cho", person: "Helen Cho", phone: "5095550100", work: "Brakes", amount: 25 });
      shop.getState().invoiceOrder(id);
      shop.getState().bookOrder(id);
      shop.getState().unbookOrder(id);
      shop.getState().closeOrder(id);
      shop.getState().closeOrderWithNoWork(id, "Customer left before any work was done");
      shop.getState().recordMileageOverride(id, 1, "the odometer was misread on arrival");
      shop.getState().recordMileageOutOverride(id, order.mileage + 20000, "the replacement odometer read higher");
      shop.getState().updateOpenContact(id, { phone: "5095550101", address: "9 Oak Street" });
      shop.getState().addLabor(id, { opcode: "LOF", description: "Oil", hours: 1, rate: 10, payType: "cp", techId: "marcus", jobId });
      shop.getState().updateLabor(id, laborId, { hours: 9, rate: 1, description: "Nope", opcode: "ZZ" });
      shop.getState().removeLabor(id, laborId);
      shop.getState().clockIn("marcus", id);
      shop.getState().clockOut("marcus");
      shop.getState().resolveFlaggedPunch("missing", "2026-10-30T18:00:00.000Z");
      shop.getState().addPartLine(id, { partId: null, number: "BL", description: "Bolt", qty: 2, cost: 1, price: 4, payType: "cp", jobId });
      shop.getState().updatePartLine(id, partId, { qty: 9, price: 50 });
      shop.getState().removePartLine(id, partId);
      shop.getState().attachInspection(id);
      shop.getState().setInspectionTech(id, "marcus");
      shop.getState().setInspectionPoint(id, "brakes", { status: "red", reading: "1", note: "worn" });
      shop.getState().moveWorkToJob(id, "labor", laborId, jobId);
      shop.getState().updateOpenVin(id, fullVin({ prefix: "1FTAB12C", year: 2020, plant: "G", serial: 44 }));
      assert.equal(shop.getState().createOrder({
        customerId: customer.id, vehicleId: vehicle.id, advisorId: "megan",
        lines: [{ concern: "Oil" }], mileage: 1000, promiseTime: "",
      }), "");
      const walked = shop.getState().openWalkIn({
        name: "New Person", phone: "5095550188", year: 2020, model: "Escape", make: "Ford",
        vin: fullVin({ prefix: "1FTAB12C", year: 2020, plant: "G", serial: 45 }),
        advisorId: "megan", lines: [{ concern: "Brakes" }], mileage: 2000, promiseTime: "",
      });
      assert.equal(walked.ok, false);
      shop.getState().updateSettings({
        taxRate: 1,
        cpRate: 1,
        fees: shop.getState().settings.fees.map((row) => ({ ...row, amount: 99 })),
      });
      const feeId = shop.getState().settings.fees[0]?.id ?? "";
      shop.getState().addFee({ name: "Tow", amount: 4 });
      shop.getState().updateFee(feeId, { amount: 99 });
      shop.getState().removeFee(feeId);
      assert.equal(JSON.stringify(shop.getState().orders), before);
      assert.equal(shop.getState().settings.taxRate === 1, false);
      assert.equal(shop.getState().settings.cpRate === 1, false);
    } finally {
      flags.__RO_CREATION_ENABLED__ = previous.create;
      flags.__RO_WRITES_ENABLED__ = previous.write;
      flags.__SECTION_LOCK_ENABLED__ = previous.lock;
    }
  });

  it("does not write a transfer note onto an open repair order when writes are off", () => {
    const previous = flags.__RO_WRITES_ENABLED__;
    flags.__RO_WRITES_ENABLED__ = false;
    try {
      const shop = createShopStore({ demoMode: true, storage: memoryStorage() });
      shop.getState().setWorkingAs("megan");
      const order = shop.getState().orders.find((row) => row.status !== "closed");
      assert.ok(order);
      const vehicle = shop.getState().vehicles.find((row) => row.id === order.vehicleId);
      const other = shop.getState().customers.find((row) => row.id !== order.customerId);
      const otherVehicle = shop.getState().vehicles.find((row) => row.customerId === other?.id);
      assert.ok(vehicle && other && otherVehicle);
      const before = JSON.stringify(order);
      const saved = shop.getState().saveAdvisorAppointment({
        date: bookableDay(),
        time: "09:00",
        minutes: 60,
        customerId: other.id,
        vehicleId: otherVehicle.id,
        advisorId: "megan",
        techId: "marcus",
        concern: "Oil",
        lines: [{ id: "a", code: "A", concern: "Oil" }],
        vin: vehicle.vin,
        laborOpIds: [],
        lane: "drop",
        status: "scheduled",
      }, undefined, true, "Sold the truck to the new owner");
      assert.match(saved.error ?? "", /open repair order/);
      assert.equal(JSON.stringify(shop.getState().orders.find((row) => row.id === order.id)), before);
    } finally {
      flags.__RO_WRITES_ENABLED__ = previous;
    }
  });

  it("lets only an advisor or service manager approve or decline an online request", () => {
    const shop = createShopStore({ demoMode: true, storage: memoryStorage() });
    const request = {
      id: "rq-role",
      storeId: "grand-coulee" as const,
      status: "pending" as const,
      createdAt: "2026-10-30T16:00:00.000Z",
      serviceId: "oil",
      serviceName: "Oil",
      laborHours: 1,
      date: "2026-10-31",
      time: "09:00",
      advisorId: "megan",
      advisorName: "Megan Cho",
      techId: "marcus",
      techName: "Marcus Hale",
      transportId: "drop",
      transportName: "Drop",
      contactMethod: "text" as const,
      verified: false,
      customerId: null,
      customerName: "New Owner",
      phone: "5095550199",
      email: "",
      vehicleId: null,
      year: 2020,
      make: "Ford",
      model: "Escape",
      vin: fullVin({ prefix: "1FTAB12C", year: 2020, plant: "G", serial: 9 }),
      plate: "NEW123",
      appointmentId: null,
    };
    shop.setState({ onlineRequests: [request], workingAsId: "" });
    assert.equal(shop.getState().approveOnlineRequest(request.id, "").ok, false);
    shop.getState().setWorkingAs("marcus");
    assert.equal(shop.getState().declineOnlineRequest(request.id).ok, false);
    shop.setState({ workingAsId: "nobody" });
    assert.equal(shop.getState().approveOnlineRequest(request.id, "").ok, false);
    assert.equal(shop.getState().onlineRequests[0]?.status, "pending");
    assert.equal(shop.getState().customers.some((row) => row.name === "New Owner"), false);
    shop.getState().setWorkingAs("megan");
    const vehicles = shop.getState().vehicles.length;
    const approved = shop.getState().approveOnlineRequest(request.id, "");
    assert.equal(approved.ok, true);
    assert.equal(shop.getState().vehicles.length, vehicles + 1);
    assert.equal(shop.getState().requestLog?.some((row) => row.who === "Megan Cho" && row.whoId === "megan" && row.action === "approved" && row.requestId === request.id), true);
    assert.equal(shop.getState().roleLog?.some((row) => row.after === "approved"), false);
    const declined = { ...request, id: "rq-no", customerName: "Decline Me" };
    shop.setState({ onlineRequests: [declined, ...shop.getState().onlineRequests] });
    assert.equal(shop.getState().declineOnlineRequest(declined.id).ok, true);
    assert.equal(shop.getState().requestLog?.some((row) => row.who === "Megan Cho" && row.whoId === "megan" && row.action === "declined" && row.requestId === declined.id), true);
  });

  it("does not throw on a non-string VIN and does not save a bad check digit", () => {
    const shop = createShopStore({ demoMode: true, storage: memoryStorage() });
    shop.getState().setWorkingAs("megan");
    const before = shop.getState().appointments.length;
    assert.doesNotThrow(() => shop.getState().addAppointment({
      date: "2026-10-30", time: "09:00", minutes: 60,
      customerId: shop.getState().customers[0].id,
      vehicleId: shop.getState().vehicles[0].id,
      advisorId: "megan", techId: "marcus", concern: "Oil",
      lines: [{ id: "a", code: "A", concern: "Oil" }],
      vin: 17 as unknown as string,
      laborOpIds: [], lane: "drop",
    }));
    assert.equal(shop.getState().appointments.length, before);
    const good = fullVin({ prefix: "1FTAB12C", year: 2019, plant: "G", serial: 4 });
    const bad = `${good.slice(0, 8)}${good[8] === "0" ? "1" : "0"}${good.slice(9)}`;
    const created = shop.getState().createCustomer({ name: "Bad Digit", phone: "5095550101", year: 2019, model: "F-150", make: "Ford", vin: bad });
    assert.match(created.error ?? "", /check digit/);
    assert.equal(shop.getState().customers.some((row) => row.name === "Bad Digit"), false);
    const row = shop.getState().appointments[0];
    assert.ok(row);
    const updated = shop.getState().updateAppointment(row.id, { vin: bad });
    assert.equal(updated.ok, false);
    assert.equal(shop.getState().appointments.find((item) => item.id === row.id)?.vin, row.vin);
  });

  const helenAuth = {
    choice: "cap" as const,
    initials: "HC",
    date: "2026-10-19",
    time: "09:00",
    estimate: 0,
    cap: 50000,
    returnParts: false,
    plate: "",
    address: "100 Main Street",
    extras: [],
  };

  function prepareBookableHelen(shop: ReturnType<typeof createShopStore>) {
    shop.setState({
      orders: shop.getState().orders.map((row) => row.id === "open-helen"
        ? { ...row, status: "working" as const, wa: helenAuth, mileageOut: row.mileage + 4, parts: row.parts.map((line) => ({ ...line, condition: "new" as const })) }
        : row),
    });
  }

  function prepareBookedHelen(shop: ReturnType<typeof createShopStore>) {
    prepareBookableHelen(shop);
    shop.setState({
      orders: shop.getState().orders.map((row) => row.id === "open-helen" ? { ...row, status: "booked" as const } : row),
    });
  }

  function prepareBlankInspection(shop: ReturnType<typeof createShopStore>) {
    shop.setState({
      orders: shop.getState().orders.map((row) => row.id === "open-helen" ? { ...row, inspection: null } : row),
    });
  }

  function prepareMoveTarget(shop: ReturnType<typeof createShopStore>) {
    shop.setState({
      orders: shop.getState().orders.map((row) => row.id === "open-helen"
        ? { ...row, jobs: [...row.jobs, { id: "oh-move", code: "B", concern: "Move the brakes here", cause: "", correction: "" }] }
        : row),
    });
  }

  const guarded: Array<[string, (shop: ReturnType<typeof createShopStore>) => void, ((shop: ReturnType<typeof createShopStore>) => void)?]> = [
    ["updateOrder", (shop) => { const order = shop.getState().orders.find((row) => row.status !== "closed"); shop.getState().updateOrder(order!.id, { concern: "Changed", mileage: (order?.mileage ?? 1) + 4 }); }],
    ["updateJob", (shop) => { const order = shop.getState().orders.find((row) => row.status !== "closed" && row.jobs[0]); shop.getState().updateJob(order!.id, order!.jobs[0].id, { cause: "Nope" }); }],
    ["addJob", (shop) => { const order = shop.getState().orders.find((row) => row.status !== "closed"); shop.getState().addJob(order!.id); }],
    ["removeJob", (shop) => { const order = shop.getState().orders.find((row) => row.status !== "closed" && row.jobs.length > 1); shop.getState().removeJob(order!.id, order!.jobs[1].id); }],
    ["updateWa", (shop) => { const order = shop.getState().orders.find((row) => row.status !== "closed"); shop.getState().updateWa(order!.id, { address: "9 Oak", plate: "NEW" }); }],
    ["addExtraAuth", (shop) => { const order = shop.getState().orders.find((row) => row.status !== "closed"); shop.getState().addExtraAuth(order!.id, { date: "2026-10-30", time: "09:00", employee: "Megan Cho", person: "Helen Cho", phone: "5095550100", work: "Brakes", amount: 20 }); }],
    ["bookOrder", (shop) => { shop.getState().bookOrder("open-helen"); }, prepareBookableHelen],
    ["unbookOrder", (shop) => { shop.getState().unbookOrder("open-helen"); }, prepareBookedHelen],
    ["closeOrder", (shop) => { shop.getState().closeOrder("open-helen"); }, prepareBookedHelen],
    ["closeOrderWithNoWork", (shop) => { shop.getState().closeOrderWithNoWork("open-sandra", "Customer left before any work was done"); }, prepareNoWorkClose],
    ["recordMileageOverride", (shop) => { shop.getState().setWorkingAs("derek"); const order = shop.getState().orders.find((row) => row.status !== "closed"); shop.getState().recordMileageOverride(order!.id, 1, "the odometer was misread on arrival"); }],
    ["recordMileageOutOverride", (shop) => { shop.getState().setWorkingAs("derek"); const order = shop.getState().orders.find((row) => row.status !== "closed"); shop.getState().recordMileageOutOverride(order!.id, (order?.mileage ?? 1) + 20000, "the replacement odometer read higher"); }],
    ["updateOpenContact", (shop) => { const order = shop.getState().orders.find((row) => row.status !== "closed"); shop.getState().updateOpenContact(order!.id, { phone: "5095550101", address: "9 Oak Street" }); }],
    ["addLabor", (shop) => { const order = shop.getState().orders.find((row) => row.status !== "closed"); shop.getState().addLabor(order!.id, { opcode: "LOF", description: "Oil", hours: 1, rate: 10, payType: "cp", techId: "marcus", jobId: order?.jobs[0]?.id }); }],
    ["updateLabor", (shop) => { const order = shop.getState().orders.find((row) => row.labor[0]); shop.getState().updateLabor(order!.id, order!.labor[0].id, { hours: 9 }); }],
    ["removeLabor", (shop) => { const order = shop.getState().orders.find((row) => row.labor[0]); shop.getState().removeLabor(order!.id, order!.labor[0].id); }],
    ["clockIn", (shop) => { shop.getState().clockIn("chris", "open-helen"); }],
    ["clockOut", (shop) => { shop.getState().clockOut("luis"); }],
    ["resolveFlaggedPunch", (shop) => { shop.getState().resolveFlaggedPunch(shop.getState().timeLogs[0]?.id ?? "missing", "2026-10-30T18:00:00.000Z"); }],
    ["addPartLine", (shop) => { const order = shop.getState().orders.find((row) => row.status !== "closed"); shop.getState().addPartLine(order!.id, { partId: null, number: "BL", description: "Bolt", qty: 1, cost: 1, price: 4, payType: "cp", jobId: order?.jobs[0]?.id }); }],
    ["updatePartLine", (shop) => { const order = shop.getState().orders.find((row) => row.parts[0]); shop.getState().updatePartLine(order!.id, order!.parts[0].id, { qty: 4, price: 80 }); }],
    ["removePartLine", (shop) => { const order = shop.getState().orders.find((row) => row.parts[0]); shop.getState().removePartLine(order!.id, order!.parts[0].id); }],
    ["attachInspection", (shop) => { shop.getState().attachInspection("open-helen"); }, prepareBlankInspection],
    ["setInspectionTech", (shop) => { const order = shop.getState().orders.find((row) => row.inspection); shop.getState().setInspectionTech(order!.id, "marcus"); }],
    ["setInspectionPoint", (shop) => { const order = shop.getState().orders.find((row) => row.id === "open-helen" && row.inspection?.items[0]); shop.getState().setInspectionPoint(order!.id, order!.inspection!.items[0].id, { status: "red", reading: "9", note: "replaced" }); }],
    ["moveWorkToJob", (shop) => { shop.getState().moveWorkToJob("open-helen", "labor", "oh-l1", "oh-move"); }, prepareMoveTarget],
    ["updateOpenVin", (shop) => { const order = shop.getState().orders.find((row) => row.status !== "closed"); shop.getState().updateOpenVin(order!.id, fullVin({ prefix: "1FTAB12C", year: 2020, plant: "G", serial: 77 })); }],
    ["createOrder", (shop) => { const vehicle = shop.getState().vehicles.find((row) => row.id === "v7" && !row.transferredTo) ?? shop.getState().vehicles.find((row) => !row.transferredTo); shop.getState().createOrder({ customerId: vehicle!.customerId, vehicleId: vehicle!.id, advisorId: "megan", lines: [{ concern: "Oil" }], mileage: 999999, promiseTime: "16:00" }); }],
    ["openWalkIn", (shop) => { shop.getState().openWalkIn({ name: "New Person", phone: "5095550188", year: 2020, model: "Escape", make: "Ford", vin: fullVin({ prefix: "1FTAB12C", year: 2020, plant: "G", serial: 78 }), advisorId: "megan", lines: [{ concern: "Brakes" }], mileage: 2000, promiseTime: "" }); }],
    ["addFee", (shop) => { shop.getState().addFee({ name: "Tow", amount: 9 }); }],
    ["updateFee", (shop) => { shop.getState().updateFee(shop.getState().settings.fees[0]?.id ?? "", { amount: 77 }); }],
    ["removeFee", (shop) => { shop.getState().removeFee(shop.getState().settings.fees[0]?.id ?? ""); }],
  ];

  for (const [name, run, prepare] of guarded) {
    it(`leaves orders byte-identical when ${name} runs with the shipped flags`, () => {
      const previous = {
        create: flags.__RO_CREATION_ENABLED__,
        write: flags.__RO_WRITES_ENABLED__,
        lock: flags.__SECTION_LOCK_ENABLED__,
      };
      delete flags.__RO_CREATION_ENABLED__;
      delete flags.__RO_WRITES_ENABLED__;
      flags.__SECTION_LOCK_ENABLED__ = true;
      try {
        assert.equal(roWritesEnabled(), false);
        assert.equal(roCreationEnabled(), false);
        const shop = createShopStore({ demoMode: true, storage: memoryStorage() });
        shop.getState().setWorkingAs("megan");
        prepare?.(shop);
        const before = JSON.stringify(shop.getState().orders);
        const punches = JSON.stringify(shop.getState().timeLogs);
        run(shop);
        assert.equal(JSON.stringify(shop.getState().orders), before, name);
        if (name === "clockOut" || name === "clockIn" || name === "resolveFlaggedPunch") {
          assert.equal(JSON.stringify(shop.getState().timeLogs), punches, name);
        }
      } finally {
        flags.__RO_CREATION_ENABLED__ = previous.create;
        flags.__RO_WRITES_ENABLED__ = previous.write;
        flags.__SECTION_LOCK_ENABLED__ = previous.lock;
      }
    });
  }

  it("changes the sample repair order when writes and creation are on", () => {
    const previous = {
      create: flags.__RO_CREATION_ENABLED__,
      write: flags.__RO_WRITES_ENABLED__,
      lock: flags.__SECTION_LOCK_ENABLED__,
    };
    flags.__RO_WRITES_ENABLED__ = true;
    flags.__RO_CREATION_ENABLED__ = true;
    flags.__SECTION_LOCK_ENABLED__ = false;
    try {
      assert.equal(roWritesEnabled(), true);
      assert.equal(roCreationEnabled(), true);
      const shop = createShopStore({ demoMode: true, storage: memoryStorage() });
      shop.getState().setWorkingAs("megan");
      prepareNoWorkClose(shop);
      const closed = shop.getState().closeOrderWithNoWork("open-sandra", "Customer left before any work was done");
      if (!closed.ok) assert.fail(closed.error ?? "The no-work close did not run.");
      assert.equal(shop.getState().orders.find((row) => row.id === "open-sandra")?.status, "closed");
      const helen = shop.getState().orders.find((row) => row.id === "open-helen");
      const point = helen?.inspection?.items[0];
      assert.ok(helen && point);
      shop.getState().setInspectionPoint(helen.id, point.id, { status: "red", reading: "9", note: "replaced" });
      assert.equal(shop.getState().orders.find((row) => row.id === "open-helen")?.inspection?.items[0]?.reading, "9");
      const openPunch = shop.getState().timeLogs.find((row) => row.techId === "luis" && row.endedAt === null);
      assert.ok(openPunch);
      assert.equal(shop.getState().clockOut("luis").ok, true);
      assert.notEqual(shop.getState().timeLogs.find((row) => row.id === openPunch.id)?.endedAt ?? null, null);
      const before = shop.getState().orders.length;
      const vehicle = shop.getState().vehicles.find((row) => row.id === "v7" && !row.transferredTo);
      assert.ok(vehicle);
      const created = shop.getState().createOrder({
        customerId: vehicle.customerId,
        vehicleId: vehicle.id,
        advisorId: "megan",
        lines: [{ concern: "Oil" }],
        mileage: 999999,
        promiseTime: "16:00",
      });
      assert.notEqual(created, "");
      assert.equal(shop.getState().orders.length, before + 1);
    } finally {
      flags.__RO_CREATION_ENABLED__ = previous.create;
      flags.__RO_WRITES_ENABLED__ = previous.write;
      flags.__SECTION_LOCK_ENABLED__ = previous.lock;
    }
  });

  it("refuses the eight staff-setup actions while the section lock is on", () => {
    const previous = flags.__SECTION_LOCK_ENABLED__;
    flags.__SECTION_LOCK_ENABLED__ = true;
    try {
      const shop = createShopStore({ demoMode: true, storage: memoryStorage() });
      shop.getState().setWorkingAs("derek");
      const techs = shop.getState().techs.length;
      const advisors = shop.getState().advisors.length;
      const managers = (shop.getState().serviceManagers ?? []).length;
      assert.equal(shop.getState().addTech({ number: "99", name: "Temp Tech", skill: "b", payStyle: "flat", flagRate: 20, hourlyRate: 20, board: "main" }), false);
      assert.equal(shop.getState().updateTech("marcus", { name: "Not Marcus" }), false);
      assert.equal(shop.getState().removeTech("marcus"), "role");
      assert.equal(shop.getState().addAdvisor({ number: "98", name: "Temp Advisor", base: 1, laborPercent: 1, partsPercent: 1 }), false);
      assert.equal(shop.getState().updateAdvisor("megan", { name: "Not Megan" }), false);
      assert.equal(shop.getState().removeAdvisor("alicia"), "role");
      assert.equal(shop.getState().addServiceManager({ number: "97", name: "Temp Manager", base: 1, laborPercent: 1, partsPercent: 1 }).ok, false);
      assert.equal(shop.getState().updateServiceManager("derek", { name: "Not Derek" }).ok, false);
      assert.equal(shop.getState().techs.length, techs);
      assert.equal(shop.getState().techs.find((row) => row.id === "marcus")?.name.includes("Not"), false);
      assert.equal(shop.getState().advisors.length, advisors);
      assert.equal((shop.getState().serviceManagers ?? []).length, managers);
    } finally {
      flags.__SECTION_LOCK_ENABLED__ = previous;
    }
  });

  it("refuses appointFirstServiceManager while the section lock is on and no manager exists yet", () => {
    const previous = flags.__SECTION_LOCK_ENABLED__;
    flags.__SECTION_LOCK_ENABLED__ = true;
    try {
      const shop = createShopStore({ demoMode: false, storage: memoryStorage() });
      shop.setState({
        advisors: [{ id: "pat", number: "1", name: "Pat Reyes", role: "advisor", base: 1, laborPercent: 1, partsPercent: 1 }],
        serviceManagers: [],
        workingAsId: "pat",
      });
      const before = JSON.stringify(shop.getState().serviceManagers);
      const result = shop.getState().appointFirstServiceManager("pat");
      assert.match(result.error ?? "", /coming later/i);
      assert.equal(JSON.stringify(shop.getState().serviceManagers), before);
    } finally {
      flags.__SECTION_LOCK_ENABLED__ = previous;
    }
  });

  it("refuses removeServiceManager while the section lock is on", () => {
    const previous = flags.__SECTION_LOCK_ENABLED__;
    flags.__SECTION_LOCK_ENABLED__ = false;
    const shop = createShopStore({ demoMode: true, storage: memoryStorage() });
    shop.getState().setWorkingAs("derek");
    const added = shop.getState().addServiceManager({ number: "97", name: "Alex Rivera", base: 1, laborPercent: 1, partsPercent: 1 });
    assert.equal(added.ok, true, added.error ?? "");
    const alex = shop.getState().serviceManagers.find((row) => row.name === "Alex Rivera");
    assert.ok(alex);
    flags.__SECTION_LOCK_ENABLED__ = true;
    try {
      const removed = shop.getState().removeServiceManager(alex.id);
      assert.match(removed.error ?? "", /coming later/i);
      assert.equal(shop.getState().serviceManagers.some((row) => row.id === alex.id), true);
    } finally {
      flags.__SECTION_LOCK_ENABLED__ = previous;
    }
  });

  it("changes Helen, the clock, and the roster when the flags allow it", () => {
    const previous = {
      create: flags.__RO_CREATION_ENABLED__,
      write: flags.__RO_WRITES_ENABLED__,
      lock: flags.__SECTION_LOCK_ENABLED__,
    };
    flags.__RO_WRITES_ENABLED__ = true;
    flags.__RO_CREATION_ENABLED__ = true;
    flags.__SECTION_LOCK_ENABLED__ = false;
    try {
      const shop = createShopStore({ demoMode: true, storage: memoryStorage() });
      shop.getState().setWorkingAs("megan");
      prepareBookableHelen(shop);
      shop.getState().bookOrder("open-helen");
      assert.equal(shop.getState().orders.find((row) => row.id === "open-helen")?.status, "booked");
      shop.getState().unbookOrder("open-helen");
      assert.equal(shop.getState().orders.find((row) => row.id === "open-helen")?.status, "ready");
      shop.setState({ orders: shop.getState().orders.map((row) => row.id === "open-helen" ? { ...row, status: "booked" as const } : row) });
      const closed = shop.getState().closeOrder("open-helen");
      if (!closed.ok) assert.fail(closed.error ?? "close failed");
      const fresh = createShopStore({ demoMode: true, storage: memoryStorage() });
      fresh.getState().setWorkingAs("megan");
      const punches = fresh.getState().timeLogs.length;
      assert.equal(fresh.getState().clockIn("chris", "open-helen").ok, true);
      assert.equal(fresh.getState().timeLogs.length > punches, true);
      prepareBlankInspection(fresh);
      fresh.getState().attachInspection("open-helen");
      assert.ok(fresh.getState().orders.find((row) => row.id === "open-helen")?.inspection);
      prepareMoveTarget(fresh);
      fresh.getState().moveWorkToJob("open-helen", "labor", "oh-l1", "oh-move");
      assert.equal(fresh.getState().orders.find((row) => row.id === "open-helen")?.labor.find((line) => line.id === "oh-l1")?.jobId, "oh-move");
      const beforeTech = fresh.getState().techs.length;
      assert.equal(fresh.getState().addTech({ number: "99", name: "Temp Tech", skill: "b", payStyle: "flat", flagRate: 20, hourlyRate: 20, board: "main" }), true);
      const added = fresh.getState().techs.find((row) => row.number === "99");
      assert.ok(added);
      assert.equal(fresh.getState().techs.length, beforeTech + 1);
      assert.equal(fresh.getState().updateTech(added.id, { name: "Temp Tech Renamed" }), true);
      assert.equal(fresh.getState().removeTech(added.id), "ok");
    } finally {
      flags.__RO_CREATION_ENABLED__ = previous.create;
      flags.__RO_WRITES_ENABLED__ = previous.write;
      flags.__SECTION_LOCK_ENABLED__ = previous.lock;
    }
  });

  it("ignores global flag overrides when the process is production", () => {
    const previous = process.env.NODE_ENV;
    process.env.NODE_ENV = "production";
    flags.__RO_WRITES_ENABLED__ = true;
    flags.__SECTION_LOCK_ENABLED__ = false;
    try {
      assert.equal(isLockedPath("/fees"), true);
    } finally {
      process.env.NODE_ENV = previous;
      flags.__RO_WRITES_ENABLED__ = true;
      flags.__SECTION_LOCK_ENABLED__ = false;
    }
  });
});
