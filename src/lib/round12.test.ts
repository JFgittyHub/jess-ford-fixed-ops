import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { lastVisitMileage, preparedReason } from "./mileage.ts";
import type { ShopStorage } from "./shop-storage.ts";
import { customerCopyIdentity, vehicleHistoryEntries } from "./ownership.ts";
import { createShopStore, migrateSavedShop } from "./store.ts";
import { fullVin } from "./vin.ts";

const transferReason = "Sold the truck to the new owner";

const vinA = fullVin({ prefix: "1FTAB12C", year: 2019, plant: "G", serial: 41 });

describe("round 12", () => {
  it("uses one transfer rule, writes nothing until the repair order exists, and retires the old copy", () => {
    const shop = createShopStore({ demoMode: false, storage: memoryStorage() });
    shop.getState().addAdvisor({ number: "1", name: "Megan Cho", base: 4000, laborPercent: 5, partsPercent: 2 });
    const megan = shop.getState().advisors[0];
    shop.getState().setWorkingAs(megan.id);
    shop.getState().addTech({ number: "9", name: "Marcus Hale", skill: "a", payStyle: "flat", flagRate: 20, hourlyRate: 20, board: "main" });
    const marcus = shop.getState().techs[0];
    const helen = shop.getState().createCustomer({ name: "Helen Cho", phone: "5095550199", year: 2019, model: "F-150", make: "Ford", vin: vinA });
    const helenOrder = shop.getState().createOrder({
      customerId: helen.customerId,
      vehicleId: helen.vehicleId,
      advisorId: megan.id,
      lines: [{ concern: "Earlier" }],
      mileage: 4000,
      mileageOut: 4000,
      promiseTime: "",
    });
    shop.getState().setWorkingAs(marcus.id);
    const tech = shop.getState().openWalkIn({
      name: "Pat Newowner", phone: "5095550177", year: 2020, model: "Escape", make: "Ford", vin: vinA.toLowerCase(),
      confirmTransfer: true, transferReason, advisorId: megan.id, lines: [{ concern: "Brakes" }], mileage: 5000, promiseTime: "",
    });
    assert.match(tech.error ?? "", /advisor or service manager/);
    assert.equal(shop.getState().customers.some((row) => row.name === "Pat Newowner"), false);
    shop.setState({ workingAsId: "" });
    assert.match(shop.getState().openWalkIn({
      name: "Pat Newowner", phone: "5095550177", year: 2020, model: "Escape", make: "Ford", vin: vinA,
      confirmTransfer: true, transferReason, advisorId: megan.id, lines: [{ concern: "Brakes" }], mileage: 5000, promiseTime: "",
    }).error ?? "", /who is working/);
    shop.getState().setWorkingAs(megan.id);
    const helenLive = shop.getState().orders.find((row) => row.id === helenOrder);
    assert.ok(helenLive);
    const closed = { ...helenLive, id: "closed-helen", number: helenLive.number - 1, status: "closed" as const, authorizationLocked: true, closeSnapshot: { customerName: "Helen Cho", phone: "5095550199", address: "1 Main", plate: "", vin: vinA, year: 2019, make: "Ford", model: "F-150" } };
    const closedBefore = JSON.stringify(closed);
    shop.setState({ orders: [closed, ...shop.getState().orders] });
    const missingReason = shop.getState().openWalkIn({
      name: "Pat Newowner", phone: "5095550177", year: 2020, model: "Escape", make: "Ford", vin: vinA,
      confirmTransfer: true, advisorId: megan.id, lines: [{ concern: "Brakes" }], mileage: 5000, promiseTime: "",
    });
    assert.equal(missingReason.ok, false);
    assert.match(missingReason.error ?? "", /reason/);
    assert.equal(shop.getState().customers.some((row) => row.name === "Pat Newowner"), false);
    const opened = shop.getState().openWalkIn({
      name: "Pat Newowner", phone: "5095550177", year: 2020, model: "Escape", make: "Ford", vin: ` ${vinA} `,
      confirmTransfer: true, transferReason, advisorId: megan.id, lines: [{ concern: "Brakes" }], mileage: 5000, promiseTime: "",
    });
    assert.equal(opened.ok, true, opened.error ?? "");
    assert.equal(shop.getState().customers.filter((row) => row.name === "Pat Newowner").length, 1);
    const again = shop.getState().openWalkIn({
      name: "Pat Newowner", phone: "5095550177", year: 2020, model: "Escape", make: "Ford", vin: vinA,
      confirmTransfer: true, transferReason, advisorId: megan.id, lines: [{ concern: "Again" }], mileage: 5100, promiseTime: "",
    });
    assert.equal(again.ok, true, again.error ?? "");
    assert.equal(shop.getState().customers.filter((row) => row.name === "Pat Newowner").length, 1);
    const current = shop.getState().vehicles.filter((row) => row.vin === vinA);
    assert.equal(current.length, 1);
    assert.equal(current[0]?.id, helen.vehicleId);
    const pat = shop.getState().customers.find((row) => row.name === "Pat Newowner");
    assert.equal(current[0]?.customerId, pat?.id);
    assert.equal(current[0]?.transferredTo, undefined);
    const spans = current[0]?.ownership ?? [];
    assert.equal(spans.length, 2);
    assert.equal(spans[0]?.customerId, helen.customerId);
    assert.ok(spans[0]?.endedAt);
    assert.equal(spans[1]?.customerId, pat?.id);
    assert.equal(spans[1]?.endedAt, null);
    assert.equal(spans[1]?.reason, transferReason);
    assert.equal(spans[1]?.who, "Megan Cho");
    assert.equal(shop.getState().createOrder({
      customerId: helen.customerId, vehicleId: helen.vehicleId, advisorId: megan.id,
      lines: [{ concern: "Nope" }], mileage: 6000, promiseTime: "",
    }), "");
    assert.match(shop.getState().orders.find((row) => row.id === helenOrder)?.history?.at(-1)?.text ?? "", /transferred to Pat Newowner/i);
    assert.equal(shop.getState().orders.find((row) => row.id === helenOrder)?.customerId, helen.customerId);
    assert.equal(JSON.stringify(shop.getState().orders.find((row) => row.id === "closed-helen")), closedBefore);
    const log = shop.getState().ownershipLog ?? [];
    assert.equal(log.length, 1);
    assert.equal(log[0]?.beforeVehicleId, helen.vehicleId);
    assert.equal(log[0]?.afterVehicleId, helen.vehicleId);
    assert.match(shop.getState().orders.find((row) => row.id === opened.orderId)?.history?.map((row) => row.text).join(" ") ?? "", /Transferred VIN/);
    const history = vehicleHistoryEntries(shop.getState().orders, current[0], shop.getState().customers, shop.getState().vehicles);
    assert.equal(history.some((row) => row.kind === "divider" && row.text.startsWith("New owner: Pat Newowner, since ")), true);
    assert.equal(history.some((row) => row.kind === "order" && row.ownerName === "Helen Cho"), true);
    assert.equal(history.some((row) => row.kind === "order" && row.order.id === opened.orderId && row.ownerName === "Pat Newowner"), true);
    const copy = customerCopyIdentity(shop.getState().orders.find((row) => row.id === opened.orderId)!, pat);
    assert.equal(copy.name, "Pat Newowner");
    assert.equal(copy.phone, "5095550177");
    assert.equal(copy.name.includes("Helen"), false);
    assert.equal(copy.phone.includes("5095550199"), false);
    const closedCopy = customerCopyIdentity(shop.getState().orders.find((row) => row.id === "closed-helen")!, pat);
    assert.equal(closedCopy.name, "Helen Cho");
    assert.equal(closedCopy.phone, "5095550199");
  });

  it("asks before an appointment uses a VIN on file and does not write a held vehicle", () => {
    const shop = createShopStore({ demoMode: true, storage: memoryStorage() });
    shop.getState().setWorkingAs("megan");
    const helen = shop.getState().customers.find((row) => row.name === "Helen Cho");
    const other = shop.getState().customers.find((row) => row.name !== "Helen Cho");
    const helenVehicle = shop.getState().vehicles.find((row) => row.customerId === helen?.id);
    const otherVehicle = shop.getState().vehicles.find((row) => row.customerId === other?.id && !row.transferredTo);
    assert.ok(helen && other && helenVehicle && otherVehicle);
    const before = helenVehicle.vin;
    const draft = {
      date: "2026-10-30", time: "09:00", minutes: 60, customerId: other.id, vehicleId: otherVehicle.id,
      advisorId: "megan", techId: "marcus", concern: "Oil", lines: [{ id: "a", code: "A", concern: "Oil" }],
      vin: before.toLowerCase(), laborOpIds: [] as string[], lane: "drop", status: "scheduled" as const,
    };
    const asked = shop.getState().saveAdvisorAppointment(draft);
    assert.equal(asked.needsTransfer, true);
    assert.equal(shop.getState().vehicles.filter((row) => row.vin === before).length, 1);
    shop.getState().setWorkingAs("marcus");
    assert.match(shop.getState().saveAdvisorAppointment(draft, undefined, true).error ?? "", /advisor or service manager/);
    shop.getState().setWorkingAs("megan");
    const missing = shop.getState().saveAdvisorAppointment(draft, undefined, true);
    assert.equal(missing.ok, false);
    assert.equal(shop.getState().vehicles.find((row) => row.id === helenVehicle.id)?.customerId, helen.id);
    const saved = shop.getState().saveAdvisorAppointment(draft, undefined, true, transferReason);
    assert.equal(saved.ok, true, saved.error ?? "");
    const kept = shop.getState().vehicles.find((row) => row.id === helenVehicle.id);
    assert.equal(kept?.vin, before);
    assert.equal(kept?.customerId, other.id);
    assert.equal(kept?.transferredTo, undefined);
    assert.equal(shop.getState().vehicles.filter((row) => row.vin === before).length, 1);
    assert.equal(kept?.ownership?.some((row) => row.who === "Megan Cho" && row.reason === transferReason), true);
    assert.equal(shop.getState().ownershipLog?.some((row) => row.who === "Megan Cho" && row.beforeVehicleId === row.afterVehicleId), true);
    const bad = shop.getState().saveAdvisorAppointment({ ...draft, vin: "1FTEW1EPOKFA12345", customerId: other.id, vehicleId: otherVehicle.id });
    assert.match(bad.error ?? "", /I, O, or Q/);
  });

  it("logs pay and fee changes for an advisor and refuses a technician", () => {
    const shop = createShopStore({ demoMode: true, storage: memoryStorage() });
    const before = shop.getState().techs.find((row) => row.id === "marcus")?.flagRate;
    shop.getState().setWorkingAs("marcus");
    assert.equal(shop.getState().updateTech("elena", { flagRate: 999, number: "77" }), false);
    assert.equal(shop.getState().techs.find((row) => row.id === "elena")?.flagRate === before || shop.getState().techs.find((row) => row.id === "elena")?.number !== "77", true);
    assert.equal(shop.getState().updateAdvisor("jordan", { base: 99999 }), false);
    assert.notEqual(shop.getState().advisors.find((row) => row.id === "jordan")?.base, 99999);
    const fees = shop.getState().settings.fees.length;
    const feeId = shop.getState().settings.fees[0]?.id ?? "";
    const feeAmount = shop.getState().settings.fees[0]?.amount;
    assert.equal(shop.getState().addFee({ name: "Shop towels", amount: 4 }), false);
    shop.getState().updateFee(feeId, { amount: 12 });
    shop.getState().removeFee(feeId);
    assert.equal(shop.getState().settings.fees.length, fees);
    assert.equal(shop.getState().settings.fees.find((row) => row.id === feeId)?.amount, feeAmount);
    shop.getState().setWorkingAs("megan");
    assert.equal(shop.getState().updateTech("marcus", { flagRate: 40 }), true);
    assert.equal(shop.getState().roleLog?.some((row) => row.advisorName === "Marcus Hale" && row.after.includes("flag 40")), true);
    assert.equal(shop.getState().addFee({ name: "Shop towels", amount: 4 }), true);
    assert.equal(shop.getState().roleLog?.some((row) => row.advisorName === "Shop towels"), true);
    const phoneBefore = shop.getState().customers[0]?.phone;
    shop.setState({ workingAsId: "" });
    shop.getState().updateOpenContact(shop.getState().orders.find((row) => row.status !== "closed")?.id ?? "", { phone: "5095550100" });
    assert.equal(shop.getState().customers[0]?.phone, phoneBefore);
  });

  it("resolves a flagged punch only inside the open-to-close window and keeps the note", () => {
    const shop = createShopStore({ demoMode: true, storage: memoryStorage() });
    shop.getState().setWorkingAs("megan");
    const created = shop.getState().createCustomer({ name: "Helen Cho", phone: "5095550199", year: 2019, model: "F-150", make: "Ford" });
    const orderId = shop.getState().createOrder({
      customerId: created.customerId, vehicleId: created.vehicleId, advisorId: "megan",
      lines: [{ concern: "Brakes" }], mileage: 4000, mileageOut: 4000, promiseTime: "",
    });
    shop.getState().addLabor(orderId, { opcode: "BRK", description: "Pads", hours: 1, rate: 10, payType: "cp", techId: "marcus" });
    const order = shop.getState().orders.find((row) => row.id === orderId);
    assert.ok(order);
    shop.getState().clockIn("marcus", order.id);
    const started = shop.getState().timeLogs.find((row) => row.orderId === order.id && !row.endedAt)?.startedAt ?? "";
    shop.setState({
      orders: shop.getState().orders.map((row) => (row.id === order.id ? { ...row, status: "closed" as const, authorizationLocked: true, closedAt: new Date(Date.parse(started) + 3_600_000).toISOString() } : row)),
      timeLogs: shop.getState().timeLogs.map((row) => (row.orderId === order.id && !row.endedAt ? { ...row, needsReview: true, note: "No close time is on this repair order, so the punch stays open for service manager review." } : row)),
    });
    const punch = shop.getState().timeLogs.find((row) => row.orderId === order.id && !row.endedAt);
    shop.setState({ workingAsId: "" });
    assert.match(shop.getState().clockOut("marcus").error ?? "", /name/);
    assert.equal(shop.getState().timeLogs.find((row) => row.id === punch?.id)?.endedAt ?? null, null);
    shop.getState().setWorkingAs("derek");
    const tooLate = new Date(Date.parse(started) + 86_400_000).toISOString();
    assert.equal(shop.getState().resolveFlaggedPunch(punch?.id ?? "", tooLate).ok, false);
    const ended = new Date(Date.parse(started) + 1_800_000).toISOString();
    assert.equal(shop.getState().resolveFlaggedPunch(punch?.id ?? "", ended).ok, true);
    const saved = shop.getState().timeLogs.find((row) => row.id === punch?.id);
    assert.equal(saved?.needsReview, false);
    assert.match(saved?.note ?? "", /No close time/);
    assert.equal(saved?.resolvedBy, "Derek Lang");
    const resolved = shop.getState().timeLogs.find((row) => row.id === punch?.id)?.note ?? "";
    assert.match(resolved, /resolved the punch/);
    assert.match(resolved, /Ended /);
    assert.doesNotMatch(resolved, /\d{4}-\d{2}-\d{2}T/);
    assert.equal(shop.getState().orders.find((row) => row.id === order.id)?.history?.some((row) => /resolved the punch/.test(row.text)), false);
  });

  it("orders visits by instant, then store, then number, independent of list order", () => {
    const vehicle = { id: "v", vin: "" };
    const morning = { id: "m", number: 241900, storeId: "grand-coulee", openedOn: "2026-10-30", openedAt: "2026-10-30T16:00:00.000Z", vehicleId: "v", mileage: 10, mileageOut: 1000 };
    const noon = { id: "n", number: 100, storeId: "grand-coulee", openedOn: "2026-10-30", openedAt: "2026-10-30T19:00:00.000Z", vehicleId: "v", mileage: 10, mileageOut: 2000 };
    const pullman = { id: "p", number: 318700, storeId: "pullman", openedOn: "2026-10-30", openedAt: "2026-10-30T19:00:00.000Z", vehicleId: "v", mileage: 10, mileageOut: 3000 };
    const orders = [morning, noon, pullman];
    const permutations = [orders, [pullman, morning, noon], [noon, pullman, morning]];
    const cutoff = { openedAt: "2026-10-30T22:00:00.000Z", openedOn: "2026-10-30", number: 999, storeId: "grand-coulee" };
    const picks = permutations.map((rows) => lastVisitMileage([{ orders: rows, vehicles: [vehicle] }], vehicle, cutoff)?.orderId);
    assert.deepEqual(picks, ["p", "p", "p"]);
    assert.equal(lastVisitMileage([{ orders: [morning, { ...pullman, openedAt: undefined, mileageOut: 9000 }], vehicles: [vehicle] }], vehicle, { excludeOrderId: "m", openedAt: morning.openedAt, openedOn: "2026-10-30", number: morning.number, storeId: "grand-coulee" })?.orderId, "p");
  });

  it("refuses a higher mileage in than mileage out and keeps the last service manager", () => {
    const shop = createShopStore({ demoMode: true, storage: memoryStorage() });
    shop.getState().setWorkingAs("derek");
    const order = shop.getState().orders.find((row) => row.status !== "closed");
    assert.ok(order);
    shop.getState().updateOrder(order.id, { mileageOut: order.mileage + 10 });
    shop.getState().updateOrder(order.id, { mileage: (order.mileageOut ?? order.mileage) + 50 });
    assert.equal(shop.getState().orders.find((row) => row.id === order.id)?.mileage, order.mileage);
    shop.getState().setWorkingAs("megan");
    assert.equal(shop.getState().removeAdvisor("derek"), "role");
    assert.equal(shop.getState().advisors.some((row) => row.id === "derek"), true);
    const visit = shop.getState().appointments.find((row) => !row.orderId);
    const closed = shop.getState().orders.find((row) => row.status === "closed");
    assert.ok(visit && closed);
    shop.getState().linkAppointment(visit.id, closed.id);
    assert.equal(shop.getState().appointments.find((row) => row.id === visit.id)?.orderId ?? null, null);
    assert.equal("error" in preparedReason(12), true);
    assert.equal(shop.getState().recordMileageOverride(order.id, 0, "this reading is above the floor").ok, false);
    assert.equal(shop.getState().recordMileageOverride(order.id, 1_000_000, "this reading is above the floor").ok, false);
    const jobs = order.jobs ?? [];
    if (jobs.length > 1) {
      shop.getState().addPartLine(order.id, { partId: null, number: "BL", description: "Bolt", qty: 1, cost: 1, price: 2, payType: "cp", condition: "new", jobId: jobs[1].id });
      assert.equal(shop.getState().orders.find((row) => row.id === order.id)?.parts.at(-1)?.jobId, jobs[1].id);
    }
    shop.getState().setWorkingAs("megan");
    const locked = shop.getState().orders.find((row) => row.status === "closed");
    assert.equal(shop.getState().updateOpenVin(locked?.id ?? "", fullVin({ prefix: "1FTAB12C", year: 2020, plant: "G", serial: 42 })).ok, false);
  });

  it("does not let a second tab appoint another first service manager", async () => {
    const storage = memoryStorage();
    const first = createShopStore({ demoMode: false, storage });
    first.getState().addAdvisor({ number: "1", name: "Pat Reyes", base: 4000, laborPercent: 5, partsPercent: 2 });
    first.getState().setWorkingAs(first.getState().advisors[0]?.id ?? "");
    const second = createShopStore({ demoMode: false, storage });
    await second.persist.rehydrate();
    assert.equal(first.getState().appointFirstServiceManager(first.getState().advisors[0]?.id ?? "").ok, true);
    const again = second.getState().appointFirstServiceManager(second.getState().advisors[0]?.id ?? "");
    assert.equal(again.ok, false);
    assert.match(again.error ?? "", /already has/);
    const fresh = createShopStore({ demoMode: false, storage: memoryStorage() });
    fresh.getState().addAdvisor({ number: "1", name: "Pat Reyes", base: 4000, laborPercent: 5, partsPercent: 2 });
    fresh.getState().setWorkingAs(fresh.getState().advisors[0]?.id ?? "");
    assert.match(fresh.getState().appointFirstServiceManager("no-such-advisor").error ?? "", /not on this store/);
    assert.equal(fresh.getState().serviceManagers.length, 0);
    assert.equal(first.getState().serviceManagers.filter((row) => row.active !== false).length, 1);
    assert.equal(second.getState().serviceManagers.filter((row) => row.active !== false).length, 1);
  });

  it("keeps a setup-card service manager log when the role becomes a service manager record", () => {
    const loaded = migrateSavedShop({
      advisors: [{ id: "pat", number: "1", name: "Pat Reyes", base: 4000, laborPercent: 5, partsPercent: 2, role: "service-manager" }],
      roleLog: [{ at: "2026-10-30T17:00:00.000Z", who: "Pat Reyes", whoId: "pat", advisorId: "pat", advisorName: "Pat Reyes", before: "advisor", after: "service-manager" }],
      orders: [],
    });
    assert.equal(loaded.advisors.find((row) => row.id === "pat")?.role, "advisor");
    assert.equal(loaded.serviceManagers.filter((row) => row.id === "pat" && row.name === "Pat Reyes" && row.active).length, 1);
    assert.equal(loaded.roleLog?.some((row) => row.after === "service-manager" && row.advisorName === "Pat Reyes"), true);
    const again = migrateSavedShop(loaded);
    assert.equal(again.serviceManagers.filter((row) => row.id === "pat").length, 1);
    assert.equal(again.roleLog?.length, loaded.roleLog?.length);
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
