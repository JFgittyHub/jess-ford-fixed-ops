import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { ShopError } from "./error-component.tsx";
import { secondServiceManagerWarning } from "../routes/service-managers.tsx";
import { createSeed } from "./seed.ts";
import { SHOP_STORAGE_KEY, type ShopStorage } from "./shop-storage.ts";
import { createShopStore } from "./store.ts";
import type { ShopData } from "./types.ts";

/** Persist versions written by the earlier previews on this branch. */
const SAVED_BY = [
  { commit: "60e6a69", version: 34 },
  { commit: "9f62d52", version: 35 },
  { commit: "5a2141b", version: 36 },
  { commit: "eb4f2e9", version: 37 },
] as const;

function memoryStorage(initial?: string): ShopStorage {
  const items = new Map<string, string>();
  if (initial) items.set(SHOP_STORAGE_KEY, initial);
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

/** A shop blob from before service-manager records and ownership spans existed. */
function legacyEnvelope(version: number) {
  const coulee = createSeed("grand-coulee");
  const pullman = createSeed("pullman");
  for (const shop of [coulee, pullman]) {
    delete (shop as Partial<ShopData>).serviceManagers;
    for (const advisor of shop.advisors) {
      if (advisor.id === "derek" || advisor.id === "pl-derek") advisor.role = "service-manager";
    }
    for (const vehicle of shop.vehicles) delete vehicle.ownership;
  }
  const closed = coulee.orders.find((row) => row.status === "closed");
  assert.ok(closed);
  const state = {
    ...coulee,
    activeStoreId: "grand-coulee" as const,
    stores: { "grand-coulee": coulee, pullman },
  };
  delete (state as Partial<ShopData>).serviceManagers;
  return { raw: JSON.stringify({ state, version }), closedId: closed.id, closed: JSON.stringify(closed) };
}

describe("saved shop load", () => {
  for (const saved of SAVED_BY) {
    it(`loads storage written at ${saved.commit} (persist version ${saved.version}) and leaves closed repair orders unchanged`, async () => {
      const { raw, closedId, closed } = legacyEnvelope(saved.version);
      const shop = createShopStore({ demoMode: false, storage: memoryStorage(raw) });
      await shop.persist.rehydrate();
      const found = shop.getState().orders.find((row) => row.id === closedId);
      assert.ok(found);
      assert.equal(JSON.stringify(found), closed);
      assert.ok(Array.isArray(shop.getState().serviceManagers));
      assert.ok(shop.getState().serviceManagers.some((row) => row.id === "derek" && row.active !== false));
      assert.ok(shop.getState().appointments.every((row) => Array.isArray(row.laborOpIds)));
      assert.equal(shop.getState().orders.filter((row) => row.status === "closed").every((row) => JSON.stringify(row) === JSON.stringify(JSON.parse(raw).state.orders.find((item: { id: string }) => item.id === row.id))), true);
    });
  }

  it("loads empty storage", async () => {
    const shop = createShopStore({ demoMode: false, storage: memoryStorage() });
    await shop.persist.rehydrate();
    assert.ok(Array.isArray(shop.getState().serviceManagers));
    assert.equal(shop.getState().serviceManagers.length, 0);
    assert.equal(shop.getState().orders.length, 0);
  });

  it("opens seeded demo data", () => {
    const shop = createShopStore({ demoMode: true, storage: memoryStorage() });
    assert.ok(shop.getState().serviceManagers.length > 0);
    assert.ok(shop.getState().orders.some((row) => row.status === "closed" && row.closeSnapshot));
    assert.ok(shop.getState().appointments.every((row) => Array.isArray(row.laborOpIds)));
  });
});

describe("error screen", () => {
  it("shows the thrown message and offers reset only for the demo", () => {
    const demo = renderToString(createElement(ShopError, { error: new Error("Maximum update depth exceeded"), demo: true, onReset: () => undefined }));
    assert.match(demo, /Something went wrong/);
    assert.match(demo, /Maximum update depth exceeded/);
    assert.match(demo, /Reset demo data/);
    const real = renderToString(createElement(ShopError, { error: new Error("Maximum update depth exceeded"), demo: false, onReset: () => undefined }));
    assert.match(real, /Maximum update depth exceeded/);
    assert.equal(real.includes("Reset demo data"), false);
  });

  it("warns before a second service manager is added", () => {
    assert.equal(
      secondServiceManagerWarning("Jess Ford Grand Coulee", ["Derek Lang", "Pat Reyes"]),
      "Jess Ford Grand Coulee will have 2 service managers (Derek Lang, Pat Reyes). Continue?",
    );
  });
});
