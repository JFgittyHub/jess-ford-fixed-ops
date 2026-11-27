import "./test-dom.ts";
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createElement, type ReactNode } from "react";
import { flushSync } from "react-dom";
import { createRoot } from "react-dom/client";
import { OnlineRequestList } from "../components/online-request-list.tsx";
import { OrderEditor } from "../components/order-editor.tsx";
import { RepairOrderPrint } from "../components/repair-order-print.tsx";
import { WaAuth } from "../components/wa-auth.tsx";
import { deskGate } from "../components/shell.tsx";
import { SECTION_LOCK_NOTICE } from "./section-lock.ts";
import { createSeed } from "./seed.ts";
import { useShop } from "./store.ts";
import type { OnlineRequest } from "./types.ts";

function mount(node: ReactNode) {
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  flushSync(() => { root.render(node); });
  const text = document.body.textContent ?? "";
  const html = document.body.innerHTML;
  flushSync(() => { root.unmount(); });
  host.remove();
  return { text, html };
}

describe("round 18 rendered desk", () => {
  it("shows Coming later for a locked path and the page everywhere else", () => {
    const flags = globalThis as { __SECTION_LOCK_ENABLED__?: boolean };
    const previous = flags.__SECTION_LOCK_ENABLED__;
    flags.__SECTION_LOCK_ENABLED__ = true;
    try {
      const gate = mount(deskGate("/dispatch", createElement("p", null, "PAGE")));
      assert.match(gate.text, new RegExp(SECTION_LOCK_NOTICE));
      assert.equal(gate.text.includes("PAGE"), false);
      const open = mount(deskGate("/schedule", createElement("p", null, "PAGE")));
      assert.match(open.text, /PAGE/);
    } finally {
      flags.__SECTION_LOCK_ENABLED__ = previous;
    }
  });

  it("shows a Pacific visit time on a request row and the warning beside that row", () => {
    const row = {
      id: "rq-1", storeId: "grand-coulee", status: "pending", createdAt: "2026-10-31T16:00:00.000Z",
      serviceId: "oil", serviceName: "Oil", laborHours: 0.5, date: "2026-11-10", time: "08:00",
      advisorId: "megan", advisorName: "Megan Cho", techId: "marcus", techName: "Marcus Hale",
      transportId: "drop", transportName: "Drop", contactMethod: "text", verified: false,
      customerId: null, customerName: "Pat Example", phone: "5095550100", email: "", vehicleId: null,
      year: 2020, make: "Ford", model: "Escape", vin: "1FTAB12C3NG000002", plate: "ABC", appointmentId: null,
    } as OnlineRequest;
    const view = mount(createElement(OnlineRequestList, {
      rows: [row],
      rowWarning: { id: "rq-1", text: "Pat Example at Tue, Nov 10, 8:00 AM PT. That time is heavy." },
    }));
    assert.match(view.text, /Tue, Nov 10, 8:00 AM PT/);
    assert.equal(view.text.includes("2026-11-10"), false);
    assert.match(view.text, /Pat Example at Tue, Nov 10/);
    assert.match(view.html, /data-approve-warning/);
    assert.match(view.html, />Cancel</);
    assert.match(view.html, />Override</);
  });

  it("shows a frozen last-visit note and the recorded store name after a rename", () => {
    const seed = createSeed();
    const closed = seed.orders.find((row) => row.status === "closed");
    assert.ok(closed);
    const nextOrders = seed.orders.map((row) => row.id === closed.id
      ? { ...row, closeSnapshot: { ...row.closeSnapshot!, storeName: "Jess Ford Grand Coulee", storeAddress: "Grand Coulee service drive", storeCity: "Grand Coulee, WA", storePhone: "(555) 633-1400", lastVisitNote: "Frozen visit note" } }
      : row);
    useShop.setState({
      ...seed,
      orders: nextOrders,
      settings: { ...seed.settings, storeName: "LIVE" },
      focusOrderId: closed.id,
      activeStoreId: "grand-coulee",
      stores: { "grand-coulee": { ...seed, orders: nextOrders, settings: { ...seed.settings, storeName: "LIVE" } }, pullman: seed },
    });
    const editor = mount(createElement(OrderEditor, { orderId: closed.id, onClose: () => undefined }));
    assert.match(editor.text, /Vehicle history/);
    assert.match(editor.text, /Frozen visit note/);
    const printed = mount(createElement(RepairOrderPrint, { orderId: closed.id }));
    assert.match(printed.text, /Jess Ford Grand Coulee/);
    assert.equal(printed.text.includes("LIVE"), false);
    const copy = mount(createElement(WaAuth, { orderId: closed.id }));
    assert.match(copy.text, /Jess Ford Grand Coulee/);
  });
});
