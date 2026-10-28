import assert from "node:assert/strict";
import { after, describe, it } from "node:test";
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { Shell } from "../components/shell.tsx";
import { createEmptyShop } from "./seed.ts";
import { useShop } from "./store.ts";

describe("desk lock", () => {
  after(() => {
    useShop.setState({ ...createEmptyShop(), focusOrderId: null });
  });

  it("renders the locked screen when demo mode is off", async () => {
    useShop.setState({ dataset: "sample" });
    await useShop.persist.rehydrate();
    assert.equal(useShop.persist.hasHydrated(), true);
    const html = renderToString(createElement(Shell, null, createElement("p", null, "desk body")));
    assert.match(html, /Sign-in via Azure\/Entra coming; demo mode only for now/);
    assert.equal(html.includes("desk body"), false);
    assert.equal(html.includes("Repair orders"), false);
    assert.equal(html.includes(">Settings<"), false);
  });
});
