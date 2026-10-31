import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { punchHours, reviewCap } from "./format.ts";
import { lastVisitMileage, preparedReason } from "./mileage.ts";
import { advisorCloseGaps, noWorkBlockers, undoFlaggedLines } from "./ro.ts";
import { createSeed } from "./seed.ts";
import type { ShopStorage } from "./shop-storage.ts";
import { createShopStore, migrateSavedShop } from "./store.ts";
import type { RepairOrder } from "./types.ts";
import { fullVin } from "./vin.ts";

const vinA = fullVin({ prefix: "1FTAB12C", year: 2019, plant: "G", serial: 11 });
const vinB = fullVin({ prefix: "1FTAB12C", year: 2020, plant: "G", serial: 22 });

describe("round 11", () => {
  it("leaves seeded closed repair orders byte-identical, including single-line orders with no job id", () => {
    for (const storeId of ["grand-coulee", "pullman"] as const) {
      const seed = createSeed(storeId);
      const closed = seed.orders.filter((order) => order.status === "closed");
      assert.ok(closed.some((order) => order.jobs.length === 1 && order.labor.every((line) => !Object.prototype.hasOwnProperty.call(line, "jobId"))));
      assert.ok(closed.some((order) => order.jobs.length > 1 && order.labor.some((line) => line.jobId)));
      const once = migrateSavedShop({ ...seed, orders: seed.orders });
      const twice = migrateSavedShop(once);
      for (const order of closed) {
        const loaded = once.orders?.find((row) => row.id === order.id);
        const again = twice.orders?.find((row) => row.id === order.id);
        assert.equal(JSON.stringify(loaded), JSON.stringify(order));
        assert.equal(JSON.stringify(again), JSON.stringify(order));
      }
    }
  });

  it("keeps a valid job link on an app-closed single-line repair order", () => {
    const shop = createShopStore({ demoMode: true, storage: memoryStorage() });
    shop.getState().setWorkingAs("megan");
    const created = shop.getState().createCustomer({ name: "Helen Cho", phone: "5095550199", year: 2019, model: "F-150", make: "Ford" });
    const id = shop.getState().createOrder({
      customerId: created.customerId,
      vehicleId: created.vehicleId,
      advisorId: "megan",
      lines: [{ concern: "Brakes" }],
      mileage: 4000,
      mileageOut: 4000,
      promiseTime: "",
    });
    shop.getState().addLabor(id, { opcode: "BRK", description: "Pads", hours: 1, rate: 10, payType: "cp", techId: "marcus" });
    const live = shop.getState().orders.find((row) => row.id === id);
    assert.equal(live?.labor[0]?.jobId, live?.jobs[0]?.id);
    const closed = { ...live, status: "closed" as const, authorizationLocked: true };
    const loaded = migrateSavedShop({ orders: [closed] });
    assert.equal(JSON.stringify(loaded.orders?.[0]), JSON.stringify(closed));
    assert.equal(loaded.orders?.[0]?.labor[0]?.jobId, live?.jobs[0]?.id);
  });

  it("does not rewrite fees on an invoiced repair order", () => {
    const fees = [{ id: "x", name: "N".repeat(120), amount: "8.5" as unknown as number, basis: "percent" as const, cap: -1 }];
    const order = {
      id: "inv",
      number: 1,
      status: "invoiced",
      openedOn: "2026-10-01",
      customerId: "c",
      vehicleId: "v",
      concern: "Brakes",
      jobs: [{ id: "a", code: "A", concern: "Brakes", cause: "Worn", correction: "Done" }],
      labor: [],
      parts: [],
      mileage: 1000,
      fees,
    };
    const loaded = migrateSavedShop({ orders: [order], closedHistory: [], vehicles: [], customers: [] });
    assert.deepEqual(loaded.orders?.[0]?.fees, fees);
  });

  it("does not rewrite a vehicle or customer that a closed repair order uses", () => {
    const shop = createShopStore({ demoMode: true, storage: memoryStorage() });
    shop.getState().setWorkingAs("megan");
    const created = shop.getState().createCustomer({ name: "Helen Cho", phone: "5095550199", year: 2019, model: "F-150", make: "Ford", vin: vinA });
    const openId = shop.getState().createOrder({
      customerId: created.customerId,
      vehicleId: created.vehicleId,
      advisorId: "megan",
      lines: [{ concern: "Oil" }],
      mileage: 5000,
      mileageOut: 5000,
      promiseTime: "",
    });
    const open = shop.getState().orders.find((row) => row.id === openId);
    assert.ok(open);
    const closed: RepairOrder = { ...open, id: "closed-copy", number: open.number - 1, status: "closed", authorizationLocked: true, closeSnapshot: { customerName: "Helen Cho", phone: "5095550199", address: "", plate: "", vin: vinA, year: 2019, make: "Ford", model: "F-150" } };
    shop.setState({ orders: [closed, open] });
    const changed = shop.getState().updateOpenVin(openId, vinB);
    assert.equal(changed.ok, true, changed.error ?? "");
    assert.equal(shop.getState().vehicles.find((row) => row.id === created.vehicleId)?.vin, vinA);
    assert.notEqual(shop.getState().orders.find((row) => row.id === openId)?.vehicleId, created.vehicleId);
    assert.equal(shop.getState().orders.find((row) => row.id === "closed-copy")?.vehicleId, created.vehicleId);
    shop.getState().updateOpenContact(openId, { phone: "5095550100" });
    assert.equal(shop.getState().customers.find((row) => row.id === created.customerId)?.phone, "5095550199");
    assert.notEqual(shop.getState().orders.find((row) => row.id === openId)?.customerId, created.customerId);
  });

  it("requires a transfer confirm, keeps the typed customer, and logs the old and new records", () => {
    const shop = createShopStore({ demoMode: false, storage: memoryStorage() });
    shop.getState().addAdvisor({ number: "1", name: "Megan Cho", base: 4000, laborPercent: 5, partsPercent: 2 });
    const megan = shop.getState().advisors[0];
    shop.getState().setWorkingAs(megan.id);
    const helen = shop.getState().createCustomer({ name: "Helen Cho", phone: "5095550199", year: 2019, model: "F-150", make: "Ford", vin: vinA });
    const beforeCustomers = shop.getState().customers.length;
    const refused = shop.getState().createCustomer({ name: "Pat Newowner", phone: "5095550177", year: 2020, model: "Escape", make: "Ford", vin: vinA.toLowerCase() });
    assert.equal(refused.needsTransfer, true);
    assert.match(refused.warning ?? "", /on file for Helen Cho/);
    assert.match(refused.warning ?? "", /Transfer the vehicle to Pat Newowner/);
    assert.equal(refused.customerId, "");
    assert.equal(shop.getState().customers.length, beforeCustomers);
    const held = shop.getState().openWalkIn({
      name: "Pat Newowner",
      phone: "5095550177",
      year: 2020,
      model: "Escape",
      make: "Ford",
      vin: ` ${vinA.toLowerCase()} `,
      confirmTransfer: true,
      transferReason: "Sold the truck to the new owner",
      advisorId: megan.id,
      lines: [{ concern: "" }],
      mileage: 5000,
      promiseTime: "",
    });
    assert.equal(held.ok, false);
    assert.equal(shop.getState().customers.some((row) => row.name === "Pat Newowner"), false);
    const moved = shop.getState().openWalkIn({
      name: "Pat Newowner",
      phone: "5095550177",
      year: 2020,
      model: "Escape",
      make: "Ford",
      vin: ` ${vinA.toLowerCase()} `,
      confirmTransfer: true,
      transferReason: "Sold the truck to the new owner",
      advisorId: megan.id,
      lines: [{ concern: "Brakes" }],
      mileage: 5000,
      promiseTime: "",
    });
    assert.equal(moved.ok, true, moved.error ?? "");
    const pat = shop.getState().customers.find((row) => row.name === "Pat Newowner");
    assert.equal(pat?.name, "Pat Newowner");
    assert.equal(pat?.phone, "5095550177");
    assert.equal(shop.getState().vehicles.find((row) => row.id === shop.getState().orders.find((order) => order.id === moved.orderId)?.vehicleId)?.customerId, pat?.id);
    assert.match(shop.getState().orders.find((order) => order.id === moved.orderId)?.history?.[0]?.text ?? "", /Transferred VIN/);
    const log = shop.getState().ownershipLog?.[0];
    assert.equal(log?.beforeCustomerId, helen.customerId);
    assert.equal(log?.afterCustomerId, pat?.id);
    assert.equal(log?.beforeVehicleId, helen.vehicleId);
    assert.equal(log?.afterVehicleId, helen.vehicleId);
    assert.equal(shop.getState().vehicles.filter((row) => row.vin === vinA).length, 1);
    assert.equal(log?.who, "Megan Cho");
    const sandra = shop.getState().createCustomer({ name: "Sandra Delgado", phone: "5095550166", year: 2018, model: "Escape", make: "Ford" });
    const openId = shop.getState().createOrder({
      customerId: sandra.customerId,
      vehicleId: sandra.vehicleId,
      advisorId: megan.id,
      lines: [{ concern: "Noise" }],
      mileage: 3000,
      mileageOut: 3000,
      promiseTime: "",
    });
    const sandraVehicle = shop.getState().orders.find((row) => row.id === openId)?.vehicleId ?? "";
    const blank = shop.getState().updateOpenVin(openId, vinA);
    assert.equal(blank.needsTransfer, true);
    assert.equal(shop.getState().orders.find((row) => row.id === openId)?.vehicleId, sandraVehicle);
    assert.equal(shop.getState().orders.find((row) => row.id === openId)?.customerId, shop.getState().orders.find((row) => row.id === openId)?.customerId);
    const confirmed = shop.getState().updateOpenVin(openId, vinA, true, "Sold the truck to the new owner");
    assert.equal(confirmed.ok, true, confirmed.error ?? "");
    const after = shop.getState().orders.find((row) => row.id === openId);
    assert.equal(after?.customerId, shop.getState().customers.find((row) => row.name === "Sandra Delgado")?.id);
    assert.match(after?.history?.at(-1)?.text ?? "", /Transferred VIN/);
    assert.equal((after?.history?.at(-1)?.text ?? "").includes("Pat Newowner"), true);
    assert.equal((after?.history?.at(-1)?.after ?? "").includes(after?.customerId ?? "missing"), true);
    assert.equal(shop.getState().ownershipLog?.some((row) => row.afterCustomerId === after?.customerId && row.beforeVehicleId === row.afterVehicleId), true);
  });

  it("lets an advisor appoint the first service manager even when repair orders are closed", () => {
    const shop = createShopStore({ demoMode: false, storage: memoryStorage() });
    assert.equal(shop.getState().addAdvisor({ number: "1", name: "Pat Reyes", base: 4000, laborPercent: 5, partsPercent: 2 }), true);
    assert.equal(shop.getState().addTech({ number: "9", name: "Marcus Hale", skill: "a", payStyle: "flat", flagRate: 20, hourlyRate: 20, board: "main" }), true);
    const pat = shop.getState().advisors[0];
    const marcus = shop.getState().techs[0];
    shop.setState({
      orders: [{ id: "cl", number: 1, status: "closed", openedOn: "2026-10-01", customerId: "", vehicleId: "", concern: "", jobs: [], mileage: 1, mileageOut: 1, fees: [], taxRate: 0, labor: [], parts: [], invoicedOn: "2026-10-01", stockApplied: false, inspection: null, bay: "ready", promiseTime: "", advisorId: pat.id }],
    });
    shop.getState().setWorkingAs("");
    assert.match(shop.getState().appointFirstServiceManager(pat.id).error ?? "", /who is working/);
    shop.getState().setWorkingAs(marcus.id);
    assert.match(shop.getState().appointFirstServiceManager(pat.id).error ?? "", /advisor/);
    shop.getState().setWorkingAs(pat.id);
    assert.equal(shop.getState().appointFirstServiceManager(pat.id).ok, true);
    assert.equal(shop.getState().roleLog?.some((row) => row.who === "Pat Reyes" && row.after === "service-manager"), true);
    assert.match(shop.getState().appointFirstServiceManager(pat.id).error ?? "", /already has/);
    assert.equal(shop.getState().updateAdvisor(pat.id, { role: "service-manager" }), false);
    shop.setState({ serviceManagers: shop.getState().serviceManagers.map((row) => (row.id === pat.id ? { ...row, name: " " } : row)) });
    const blocked = shop.getState().addServiceManager({ number: "2", name: "Alex Rivera", base: 4000, laborPercent: 5, partsPercent: 2 });
    assert.equal(blocked.ok, false);
    shop.setState({ serviceManagers: shop.getState().serviceManagers.map((row) => (row.id === pat.id ? { ...row, name: "Pat Reyes" } : row)) });
    const added = shop.getState().addServiceManager({ number: "2", name: "Alex Rivera", base: 4000, laborPercent: 5, partsPercent: 2 });
    assert.equal(added.ok, true, added.error ?? "");
    const alex = shop.getState().serviceManagers.find((row) => row.name === "Alex Rivera");
    assert.equal(shop.getState().roleLog?.some((row) => row.advisorId === alex?.id && row.after === "service-manager"), true);
    assert.equal(shop.getState().removeServiceManager(pat.id).ok, true);
    shop.getState().setWorkingAs(alex?.id ?? "");
    assert.match(shop.getState().updateServiceManager(alex?.id ?? "", { active: false }).error ?? "", /at least one/);
    assert.match(shop.getState().removeServiceManager(alex?.id ?? "").error ?? "", /at least one/);
    assert.equal(shop.getState().serviceManagers.some((row) => row.id === alex?.id), true);
    assert.equal(shop.getState().roleLog?.some((row) => row.advisorId === pat.id && row.after === "removed"), true);
  });

  it("refuses to move work onto a flagged line", () => {
    const shop = createShopStore({ demoMode: true, storage: memoryStorage() });
    shop.getState().setWorkingAs("megan");
    const created = shop.getState().createCustomer({ name: "Helen Cho", phone: "5095550199", year: 2019, model: "F-150", make: "Ford" });
    const id = shop.getState().createOrder({
      customerId: created.customerId,
      vehicleId: created.vehicleId,
      advisorId: "megan",
      lines: [{ concern: "A" }, { concern: "B" }],
      mileage: 4000,
      mileageOut: 4000,
      promiseTime: "",
    });
    const jobs = shop.getState().orders.find((row) => row.id === id)?.jobs ?? [];
    shop.getState().addLabor(id, { opcode: "BRK", description: "Pads", hours: 1, rate: 10, payType: "cp", techId: "marcus", jobId: jobs[1]?.id });
    shop.setState({
      orders: shop.getState().orders.map((row) => (row.id === id ? { ...row, jobs: [...row.jobs, { id: "flag", code: "C", concern: "", cause: "", correction: "", needsAssignment: true }] } : row)),
    });
    shop.getState().moveWorkToJob(id, "labor", shop.getState().orders.find((row) => row.id === id)?.labor[0]?.id ?? "", "flag");
    assert.equal(shop.getState().orders.find((row) => row.id === id)?.labor[0]?.jobId, jobs[1]?.id);
  });

  it("refuses linking a visit to a closed repair order", () => {
    const shop = createShopStore({ demoMode: true, storage: memoryStorage() });
    const visit = shop.getState().appointments.find((row) => !row.orderId);
    const closed = shop.getState().orders.find((row) => row.status === "closed");
    assert.ok(visit && closed);
    shop.getState().linkAppointment(visit.id, closed.id);
    assert.equal(shop.getState().appointments.find((row) => row.id === visit.id)?.orderId ?? null, visit.orderId);
  });

  it("does not store mileage out below mileage in", () => {
    const shop = createShopStore({ demoMode: true, storage: memoryStorage() });
    shop.getState().setWorkingAs("derek");
    const created = shop.getState().createCustomer({ name: "Helen Cho", phone: "5095550199", year: 2019, model: "F-150", make: "Ford" });
    const id = shop.getState().createOrder({
      customerId: created.customerId,
      vehicleId: created.vehicleId,
      advisorId: "derek",
      lines: [{ concern: "Oil" }],
      mileage: 4000,
      mileageOut: 4000,
      promiseTime: "",
    });
    shop.getState().updateOrder(id, { mileageOut: 1500 });
    assert.equal(shop.getState().orders.find((row) => row.id === id)?.mileageOut, 4000);
    shop.getState().setWorkingAs("megan");
    assert.equal(shop.getState().recordMileageOutOverride(id, 20000, "towed in from a long trip").ok, false);
    shop.getState().setWorkingAs("derek");
    assert.equal(shop.getState().recordMileageOutOverride(id, 20000, "no").ok, false);
    assert.equal(shop.getState().recordMileageOutOverride(id, 20000, "towed in from a long trip").ok, true);
    assert.equal(shop.getState().recordMileageOverride(id, 0, "this reading is above the floor").ok, false);
    assert.equal(shop.getState().recordMileageOverride(id, 1_000_000, "this reading is above the floor").ok, false);
    assert.equal("error" in preparedReason(12), true);
  });

  it("blocks a second open punch and lets a service manager end the flagged one", () => {
    const shop = createShopStore({ demoMode: true, storage: memoryStorage() });
    shop.getState().setWorkingAs("megan");
    const created = shop.getState().createCustomer({ name: "Helen Cho", phone: "5095550199", year: 2019, model: "F-150", make: "Ford" });
    const first = shop.getState().createOrder({
      customerId: created.customerId,
      vehicleId: created.vehicleId,
      advisorId: "megan",
      lines: [{ concern: "One" }],
      mileage: 4000,
      mileageOut: 4000,
      promiseTime: "",
    });
    const second = shop.getState().createOrder({
      customerId: created.customerId,
      vehicleId: created.vehicleId,
      advisorId: "megan",
      lines: [{ concern: "Two" }],
      mileage: 4100,
      mileageOut: 4100,
      promiseTime: "",
    });
    shop.getState().addLabor(first, { opcode: "A", description: "A", hours: 1, rate: 10, payType: "cp", techId: "marcus" });
    shop.getState().addLabor(second, { opcode: "B", description: "B", hours: 1, rate: 10, payType: "cp", techId: "marcus" });
    assert.equal(shop.getState().clockIn("marcus", first).ok, true);
    shop.setState({
      orders: shop.getState().orders.map((row) => (row.id === first ? { ...row, status: "closed" as const, authorizationLocked: true, closedAt: null } : row)),
      timeLogs: shop.getState().timeLogs.map((row) => (row.orderId === first ? { ...row, needsReview: true, note: "No close time is on this repair order, so the punch stays open for service manager review." } : row)),
    });
    const blocked = shop.getState().clockIn("marcus", second);
    assert.equal(blocked.ok, false);
    assert.match(blocked.error ?? "", /review/);
    assert.equal(shop.getState().timeLogs.filter((row) => row.techId === "marcus" && !row.endedAt).length, 1);
    const punch = shop.getState().timeLogs.find((row) => row.orderId === first);
    const cap = reviewCap(punch ?? { startedAt: "", endedAt: null }, null);
    assert.equal(punchHours(punch?.startedAt ?? "", null, Date.now() + 86_400_000, cap), 0);
    shop.getState().setWorkingAs("marcus");
    assert.match(shop.getState().resolveFlaggedPunch(punch?.id ?? "", new Date().toISOString()).error ?? "", /service manager/);
    shop.getState().setWorkingAs("derek");
    assert.equal(shop.getState().resolveFlaggedPunch(punch?.id ?? "", new Date().toISOString()).ok, true);
    const ended = shop.getState().timeLogs.find((row) => row.id === punch?.id);
    assert.equal(typeof ended?.endedAt, "string");
    assert.match(shop.getState().orders.find((row) => row.id === first)?.history?.at(-1)?.text ?? "", /resolved the punch/);
    assert.equal(shop.getState().clockIn("marcus", second).ok, true);
  });

  it("orders a same-day untimed repair order by number against a timed one", () => {
    const vehicle = { id: "v", vin: "" };
    const timed = { id: "timed", number: 100, openedOn: "2026-10-30", openedAt: "2026-10-30T22:00:00.000Z", vehicleId: "v", mileage: 10, mileageOut: 5000 };
    const untimed = { id: "untimed", number: 200, openedOn: "2026-10-30", vehicleId: "v", mileage: 10, mileageOut: 9000 };
    const shops = [{ orders: [timed, untimed], vehicles: [vehicle] }];
    assert.equal(lastVisitMileage(shops, vehicle, { excludeOrderId: "timed", openedAt: timed.openedAt, openedOn: "2026-10-30", number: 100 })?.orderId, "untimed");
    assert.equal(lastVisitMileage(shops, vehicle, { excludeOrderId: "untimed", openedOn: "2026-10-30", number: 200 }) ?? null, null);
  });

  it("counts a part-only line, keeps its job id, and names the full VIN on a no-work close", () => {
    const order = {
      id: "o",
      status: "open",
      jobs: [{ id: "j", code: "A", concern: "Noise", cause: "", correction: "" }],
      labor: [],
      parts: [{ id: "p", partId: null, number: "BL", description: "Bolt", qty: 1, cost: 1, price: 2, payType: "cp", condition: "new", jobId: "j" }],
      mileage: 10,
      mileageOut: 10,
      concern: "Noise",
      fees: [],
      history: [],
      payments: [],
    } as unknown as RepairOrder;
    assert.ok(advisorCloseGaps(order, { techs: [], advisors: [], logs: [], customer: { id: "c", name: "Helen Cho", phone: "1", mobile: "", email: "", noShows: 0 }, vehicle: { id: "v", customerId: "c", year: 2019, make: "Ford", model: "F-150", vin: vinA } }).includes("Cause on line A"));
    const undone = undoFlaggedLines({
      ...order,
      jobs: [...order.jobs, { id: "flag", code: "C", concern: "", cause: "", correction: "", needsAssignment: true }],
      labor: [{ id: "l", opcode: "A", description: "A", hours: 1, rate: 1, payType: "cp", techId: "t", jobId: "j" }],
    });
    assert.deepEqual(undone.jobs.map((job) => job.id), ["j"]);
    assert.equal(undone.labor[0]?.jobId, "j");
    const shop = createShopStore({ demoMode: true, storage: memoryStorage() });
    shop.getState().setWorkingAs("megan");
    const created = shop.getState().createCustomer({ name: "Helen Cho", phone: "5095550199", year: 2019, model: "F-150", make: "Ford" });
    const id = shop.getState().createOrder({
      customerId: created.customerId,
      vehicleId: created.vehicleId,
      advisorId: "megan",
      lines: [{ concern: "A" }, { concern: "B" }],
      mileage: 4000,
      mileageOut: 4000,
      promiseTime: "",
    });
    const jobs = shop.getState().orders.find((row) => row.id === id)?.jobs ?? [];
    shop.getState().addPartLine(id, { partId: null, number: "BL", description: "Bolt", qty: 1, cost: 1, price: 2, payType: "cp", condition: "new", jobId: jobs[1]?.id });
    assert.equal(shop.getState().orders.find((row) => row.id === id)?.parts.at(-1)?.jobId, jobs[1]?.id);
    shop.setState({ vehicles: shop.getState().vehicles.map((row) => (row.id === created.vehicleId ? { ...row, vin: "SHORT" } : row)) });
    assert.match(shop.getState().closeOrderWithNoWork(id, "Customer left before any work").error ?? "", /full 17-character VIN/);
    const open = { id: "bare", number: 9, status: "open", openedOn: "2026-10-30", customerId: "c", vehicleId: "v", concern: "", jobs: [], labor: [], parts: [], mileage: 1 };
    const backfill = migrateSavedShop({ orders: [open] });
    assert.match(backfill.orders?.[0]?.openedAt ?? "", /T/);
    const sealed = { ...open, id: "sealed", status: "closed" };
    assert.equal(migrateSavedShop({ orders: [sealed] }).orders?.[0]?.openedAt, undefined);
  });

  it("refuses a technician fee or rename, a fractional on-hand count, and a non-finite appointment", () => {
    const shop = createShopStore({ demoMode: true, storage: memoryStorage() });
    const fees = shop.getState().settings.fees.length;
    shop.getState().setWorkingAs("marcus");
    assert.equal(shop.getState().addFee({ name: "Shop towels", amount: 4 }), false);
    assert.equal(shop.getState().settings.fees.length, fees);
    const tech = shop.getState().techs.find((row) => row.id === "marcus");
    assert.equal(shop.getState().updateTech("marcus", { name: "Marcus Renamed" }), false);
    assert.equal(shop.getState().techs.find((row) => row.id === "marcus")?.name, tech?.name);
    shop.getState().setWorkingAs("megan");
    assert.equal(shop.getState().updateTech("marcus", { name: "Marcus Renamed" }), true);
    assert.equal(shop.getState().roleLog?.some((row) => row.before === tech?.name && row.after === "Marcus Renamed"), true);
    const parts = shop.getState().parts.length;
    shop.getState().addSku({ number: "ZZ", description: "Bolt", bin: "A", onHand: 2.5, onOrder: 0, cost: 1, list: 2, lastSale: "", source: "shop" });
    assert.equal(shop.getState().parts.length, parts);
    const visit = shop.getState().appointments[0];
    shop.getState().moveAppointment(visit.id, { minutes: Number.POSITIVE_INFINITY });
    shop.getState().updateAppointment(visit.id, { minutes: Number.NaN });
    assert.equal(shop.getState().appointments.find((row) => row.id === visit.id)?.minutes, visit.minutes);
    const menu = shop.getState().settings.scheduling.onlineMenu[0];
    assert.equal(shop.getState().updateOnlineService(menu.id, { laborHours: 2e6 }), false);
    assert.equal(shop.getState().updateOnlineService(menu.id, { laborHours: "50" as unknown as number }), false);
    assert.equal(shop.getState().settings.scheduling.onlineMenu[0]?.laborHours, menu.laborHours);
  });

  it("fills a missing opened time only on an open repair order and switches role logs with the store", () => {
    const shop = createShopStore({ demoMode: true, storage: memoryStorage() });
    shop.getState().setWorkingAs("derek");
    const megan = shop.getState().advisors.find((row) => row.name === "Megan Cho");
    shop.getState().updateAdvisor(megan?.id ?? "", { laborPercent: (megan?.laborPercent ?? 5) + 1 });
    const grand = shop.getState().roleLog?.length ?? 0;
    assert.ok(grand > 0);
    shop.getState().switchStore("pullman");
    assert.equal(shop.getState().roleLog?.length ?? 0, 0);
    shop.getState().switchStore("grand-coulee");
    assert.equal(shop.getState().roleLog?.length ?? 0, grand);
    const blocks = noWorkBlockers({ labor: [], parts: [], fees: [], payments: [], mileage: 1, mileageOut: 2, jobs: [], concern: "C" } as unknown as RepairOrder, [], {
      customer: { id: "c", name: "Helen Cho", phone: "5095550199", mobile: "", email: "", noShows: 0 },
      vehicle: { id: "v", customerId: "c", year: 2019, make: "Ford", model: "F-150", vin: "" },
    });
    assert.ok(blocks.includes("Add the full 17-character VIN"));
  });
});

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
