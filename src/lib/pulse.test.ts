import assert from "node:assert/strict";
import { after, describe, it } from "node:test";
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { ScorecardPulse } from "../components/scorecard/board.tsx";
import { pinClock, resetClock } from "./clock.ts";
import { createEmptyShop } from "./seed.ts";
import { useShop } from "./store.ts";

describe("Pulse follows the active store", () => {
  after(() => {
    resetClock();
    useShop.setState({ ...createEmptyShop(), activeStoreId: "grand-coulee", focusOrderId: null, stores: useShop.getState().stores });
  });

  it("shows only that store's month and technicians", () => {
    pinClock("2026-10-20T19:00:00Z");
    const pullman = renderPulse("pullman");
    assert.match(pullman, /Pullman/);
    assert.match(pullman, /Nate Briggs/);
    assert.equal(pullman.includes("Marcus Hale"), false);
    assert.equal(pullman.includes("Grand Coulee"), false);
    assert.equal(pullman.includes("tablist"), false);

    const coulee = renderPulse("grand-coulee");
    assert.match(coulee, /Grand Coulee/);
    assert.match(coulee, /Marcus Hale/);
    assert.equal(coulee.includes("Nate Briggs"), false);
    assert.equal(coulee.includes("Pullman"), false);
  });
});

function renderPulse(storeId: "grand-coulee" | "pullman") {
  useShop.setState({ dataset: "sample", activeStoreId: storeId });
  return renderToString(createElement(ScorecardPulse));
}
