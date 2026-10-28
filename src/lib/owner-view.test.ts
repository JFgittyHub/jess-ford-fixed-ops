import assert from "node:assert/strict";
import { after, describe, it } from "node:test";
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { ScorecardPulse } from "../components/scorecard/board.tsx";
import { pinClock, resetClock } from "./clock.ts";
import { formatHours, formatMoney, ownerMonth, ownerYearBoards, roundTo, yearToDate } from "./scorecard/model.ts";
import { sampleFor } from "./scorecard/sample.ts";
import { createEmptyShop } from "./seed.ts";
import type { ShopStorage } from "./shop-storage.ts";
import { createShopStore, useShop } from "./store.ts";

describe("Owner view totals", () => {
  it("adds both stores and keeps rates weighted", () => {
    const coulee = sampleFor("2026-10", "grand-coulee");
    const pullman = sampleFor("2026-10", "pullman");
    assert.ok(coulee && pullman);
    const couleeSales = coulee.service.sales;
    const view = ownerMonth({ "grand-coulee": { "2026-10": coulee }, pullman: { "2026-10": pullman } }, "2026-10");

    assert.equal(view.combined.service.sales, coulee.service.sales + pullman.service.sales);
    assert.equal(view.combined.service.gross, coulee.service.gross + pullman.service.gross);
    assert.equal(view.combined.service.totalHours, roundTo(coulee.service.totalHours + pullman.service.totalHours, 1));
    assert.equal(view.combined.parts.sales, coulee.parts.sales + pullman.parts.sales);
    assert.equal(view.combined.parts.gross, coulee.parts.gross + pullman.parts.gross);
    assert.equal(view.combined.parts.inventory, coulee.parts.inventory + pullman.parts.inventory);
    assert.equal(view.combined.hoursGoal, coulee.hoursGoal + pullman.hoursGoal);
    assert.equal(view.combined.service.roOpenOver30, coulee.service.roOpenOver30 + pullman.service.roOpenOver30);
    assert.equal(view.stores[0]?.name, "Grand Coulee");
    assert.equal(view.stores[1]?.name, "Pullman");
    assert.equal(view.stores[0]?.board.service.sales, coulee.service.sales);
    assert.equal(view.stores[1]?.board.service.sales, pullman.service.sales);
    assert.equal(coulee.service.sales, couleeSales);

    const hours = coulee.service.totalHours + pullman.service.totalHours;
    const elr = roundTo((coulee.service.elr * coulee.service.totalHours + pullman.service.elr * pullman.service.totalHours) / hours, 2);
    assert.equal(view.combined.service.elr, elr);
    assert.notEqual(view.combined.service.elr, coulee.service.elr + pullman.service.elr);
    assert.equal(view.combined.period1.some((tech) => tech.name === "Marcus Hale · Coulee"), true);
    assert.equal(view.combined.period1.some((tech) => tech.name === "Nate Briggs · Pullman"), true);
  });

  it("sums the year the same way, and skips a store that has not entered the month", () => {
    const coulee = sampleFor("2026-10", "grand-coulee");
    const pullman = sampleFor("2026-10", "pullman");
    const couleeYear = { "2026-09": sampleFor("2026-09", "grand-coulee"), "2026-10": coulee };
    const pullmanYear = { "2026-09": sampleFor("2026-09", "pullman"), "2026-10": pullman };
    assert.ok(coulee && pullman && couleeYear["2026-09"] && pullmanYear["2026-09"]);
    const stores = { "grand-coulee": { "2026-09": couleeYear["2026-09"], "2026-10": coulee }, pullman: { "2026-09": pullmanYear["2026-09"], "2026-10": pullman } };
    const combined = yearToDate(ownerYearBoards(stores, "2026-10"), "2026-10");
    const couleeYtd = yearToDate([couleeYear["2026-09"], coulee], "2026-10");
    const pullmanYtd = yearToDate([pullmanYear["2026-09"], pullman], "2026-10");
    assert.equal(combined.serviceSales, couleeYtd.serviceSales + pullmanYtd.serviceSales);
    assert.equal(combined.serviceGross, couleeYtd.serviceGross + pullmanYtd.serviceGross);
    assert.equal(combined.partsSales, couleeYtd.partsSales + pullmanYtd.partsSales);
    assert.equal(combined.partsGross, couleeYtd.partsGross + pullmanYtd.partsGross);

    const oneStore = ownerMonth({ "grand-coulee": { "2026-10": coulee }, pullman: {} }, "2026-10");
    assert.equal(oneStore.stores[1]?.board.recorded, false);
    assert.equal(oneStore.combined.service.sales, coulee.service.sales);
    assert.equal(oneStore.combined.parts.sales, coulee.parts.sales);
    assert.equal(oneStore.combined.service.totalHours, coulee.service.totalHours);
  });
});

describe("Owner view on Pulse and the scorecard", () => {
  after(() => {
    resetClock();
    const empty = createEmptyShop();
    useShop.setState({ ...empty, activeStoreId: "grand-coulee", focusOrderId: null, stores: { "grand-coulee": empty, pullman: createEmptyShop() } });
  });

  it("shows read-only combined totals and a per-store breakdown", () => {
    pinClock("2026-10-20T19:00:00Z");
    const coulee = sampleFor("2026-10", "grand-coulee");
    const pullman = sampleFor("2026-10", "pullman");
    assert.ok(coulee && pullman);
    const html = renderPulse("pullman", true);

    assert.match(html, /aria-label="Pulse scope"/);
    assert.match(html, /aria-label="Scorecard scope"/);
    assert.match(html, /Owner view/);
    assert.match(html, /All stores/);
    assert.match(html, /data-scope="owner"/);
    assert.match(html, /Per-store breakdown/);
    assert.match(html, /Grand Coulee/);
    assert.match(html, /Pullman/);
    assert.match(html, /Both stores/);
    assert.match(html, /Marcus Hale · Coulee/);
    assert.match(html, /Nate Briggs · Pullman/);
    assert.match(html, new RegExp(escapeRegExp(formatMoney(coulee.service.sales + pullman.service.sales))));
    assert.match(html, new RegExp(escapeRegExp(formatMoney(coulee.parts.sales + pullman.parts.sales))));
    assert.match(html, new RegExp(escapeRegExp(formatHours(roundTo(coulee.service.totalHours + pullman.service.totalHours, 1)))));
    assert.match(html, new RegExp(escapeRegExp(formatMoney(coulee.service.sales))));
    assert.match(html, new RegExp(escapeRegExp(formatMoney(pullman.service.sales))));
    assert.match(html, /<button[^>]*disabled=""[^>]*>Operating metrics<\/button>/);
    assert.equal(html.includes("<input"), false);
    assert.equal(html.includes("Restore sample"), false);
    assert.equal(html.includes("tablist"), false);
  });

  it("returns to the active store and leaves every other page on that store", () => {
    pinClock("2026-10-20T19:00:00Z");
    const demo = createShopStore({ demoMode: true, storage: memoryStorage() });
    demo.getState().switchStore("pullman");
    const src = demo.getState();
    const before = deskSnapshot(src);
    useShop.setState({
      dataset: "sample",
      activeStoreId: "pullman",
      customers: src.customers,
      vehicles: src.vehicles,
      orders: src.orders,
      appointments: src.appointments,
      advisors: src.advisors,
      techs: src.techs,
      settings: src.settings,
      stores: src.stores,
      campaigns: src.campaigns,
    });

    const owner = renderToString(createElement(ScorecardPulse, { initialOwnerView: true }));
    assert.match(owner, /data-scope="owner"/);
    assert.equal(useShop.getState().activeStoreId, "pullman");
    assert.deepEqual(deskSnapshot(useShop.getState()), before);
    assert.equal(useShop.getState().customers.some((row) => row.name === "Helen Cho"), false);
    assert.equal(useShop.getState().stores["grand-coulee"].customers.some((row) => row.name === "Helen Cho"), true);

    const desk = renderToString(createElement(OpenDesk));
    assert.match(desk, /pullman/);
    assert.match(desk, /Jess Ford Pullman/);
    assert.match(desk, /Marisol Vega/);
    assert.equal(desk.includes("Helen Cho"), false);
    assert.equal(desk.includes("Owner view"), false);

    const single = renderToString(createElement(ScorecardPulse));
    assert.match(single, /data-scope="store"/);
    assert.match(single, /Nate Briggs/);
    assert.match(single, /Owner view/);
    assert.match(single, /All stores/);
    assert.equal(single.includes("Marcus Hale"), false);
    assert.equal(single.includes("Grand Coulee"), false);
    assert.equal(single.includes("By store"), false);
    assert.equal(single.includes("Both stores"), false);
    assert.equal(single.includes("<input"), false);
    const metrics = single.match(/<button[^>]*>Operating metrics<\/button>/)?.[0] ?? "";
    assert.equal(metrics.includes("disabled="), false);
    assert.equal(useShop.getState().activeStoreId, "pullman");
    assert.deepEqual(deskSnapshot(useShop.getState()), before);
    assert.deepEqual(
      useShop.getState().appointments.map((row) => row.id).sort(),
      src.stores.pullman.appointments.map((row) => row.id).sort(),
    );
  });
});

function OpenDesk() {
  useShop((state) => state.activeStoreId);
  const state = useShop.getState();
  const names = state.customers.map((row) => row.name).join(", ");
  return createElement("section", { "aria-label": "Open desk" }, `${state.activeStoreId} ${state.settings.storeName} ${names}`);
}

function renderPulse(storeId: "grand-coulee" | "pullman", ownerView: boolean) {
  useShop.setState({ dataset: "sample", activeStoreId: storeId });
  return renderToString(createElement(ScorecardPulse, { initialOwnerView: ownerView }));
}

function deskSnapshot(state: { activeStoreId: string; customers: { id: string; name: string }[]; appointments: { id: string }[]; orders: { id: string }[]; vehicles: { id: string }[] }) {
  return {
    activeStoreId: state.activeStoreId,
    customers: state.customers.map((row) => `${row.id}:${row.name}`).sort(),
    appointments: state.appointments.map((row) => row.id).sort(),
    orders: state.orders.map((row) => row.id).sort(),
    vehicles: state.vehicles.map((row) => row.id).sort(),
  };
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
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
