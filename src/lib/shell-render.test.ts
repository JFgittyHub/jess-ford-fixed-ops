import assert from "node:assert/strict";
import { after, describe, it } from "node:test";
import { Window } from "happy-dom";
import { createElement } from "react";
import { flushSync } from "react-dom";
import { createRoot } from "react-dom/client";
import { createMemoryHistory, createRouter, RouterProvider } from "@tanstack/react-router";
import { AppErrorComponent } from "./error-component.tsx";
import { isLockedPath, SECTION_LOCK_NOTICE } from "./section-lock.ts";
import { previewPathRewrite } from "./preview-path-prefix.ts";
import { createEmptyShop, createSeed } from "./seed.ts";
import { migrateSavedShop, useShop } from "./store.ts";
import type { OnlineRequest } from "./types.ts";
import { routeTree } from "../routeTree.gen.ts";
import type { ShopData } from "./types.ts";

(globalThis as { __JF_DEMO_MODE__?: string; __JF_SHELL_MOUNT__?: boolean }).__JF_DEMO_MODE__ = "true";
(globalThis as { __JF_SHELL_MOUNT__?: boolean }).__JF_SHELL_MOUNT__ = true;

const dom = new Window({ url: "http://127.0.0.1:8080/" });
Object.defineProperty(globalThis, "window", { value: dom, configurable: true });
Object.defineProperty(globalThis, "document", { value: dom.document, configurable: true });
Object.defineProperty(globalThis, "HTMLElement", { value: dom.HTMLElement, configurable: true });
Object.defineProperty(globalThis, "Node", { value: dom.Node, configurable: true });
Object.defineProperty(globalThis, "localStorage", { value: dom.localStorage, configurable: true });
Object.defineProperty(globalThis, "location", { value: dom.location, configurable: true });
Object.defineProperty(globalThis, "history", { value: dom.history, configurable: true });
Object.defineProperty(globalThis, "navigator", { value: dom.navigator, configurable: true });
globalThis.requestAnimationFrame = ((callback: FrameRequestCallback) => setTimeout(() => callback(Date.now()), 0)) as unknown as typeof requestAnimationFrame;
globalThis.cancelAnimationFrame = ((id: number) => clearTimeout(id)) as unknown as typeof cancelAnimationFrame;

const ROUTES = process.env.SMOKE_ROUTES?.split(",") ?? [
  "/",
  "/schedule",
  "/request",
  "/online-requests",
  "/overrides",
  "/orders",
  "/estimates",
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
];

function deskState(data: ShopData) {
  useShop.setState({
    ...data,
    dataset: "sample",
    focusOrderId: null,
    activeStoreId: "grand-coulee",
    stores: { "grand-coulee": { ...data, dataset: "sample" }, pullman: createEmptyShop() },
  });
}

function olderSavedShop(): ShopData {
  const saved = createSeed();
  delete (saved as Partial<ShopData>).serviceManagers;
  for (const advisor of saved.advisors) {
    if (advisor.id === "derek") advisor.role = "service-manager";
  }
  return migrateSavedShop(saved);
}

async function mount(path: string, interact?: (host: HTMLElement) => Promise<void> | void) {
  const history = createMemoryHistory({ initialEntries: [path] });
  const router = createRouter({
    routeTree,
    history,
    rewrite: previewPathRewrite(),
    defaultErrorComponent: AppErrorComponent,
  });
  await router.load();
  (router as { _rendered?: unknown[] })._rendered = [];
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  let thrown = "";
  try {
    flushSync(() => {
      root.render(createElement(RouterProvider, { router }));
    });
    for (let i = 0; i < 25; i += 1) {
      await new Promise((resolve) => setTimeout(resolve, 20));
      const text = host.textContent ?? "";
      if (text.includes("Fixed operations") || text.includes("Something went wrong") || text.includes("Maximum update depth")) break;
    }
  } catch (error) {
    thrown = error instanceof Error ? `${error.message}\n${error.stack}` : String(error);
  }
  try {
    if (interact) await interact(host as HTMLElement);
  } catch (error) {
    thrown = thrown || (error instanceof Error ? `${error.message}\n${error.stack}` : String(error));
  }
  const text = host.textContent ?? "";
  const html = host.innerHTML ?? "";
  flushSync(() => {
    root.unmount();
  });
  host.remove();
  if (thrown && interact) throw new Error(thrown);
  return { text, html, thrown, status: router.state.status, location: router.state.location.href };
}

const LOCKED_BODY: Record<string, string> = {
  "/dispatch": "The roster",
  "/tech-board": "There is no password",
  "/advisors": "The drive",
  "/service-managers": "The desk",
  "/parts": "Cash on the shelf",
  "/expenses": "What you can still change",
  "/customers": "Who is due back",
  "/reports": "Fixed absorption statement",
  "/labor-ops": "The book every repair order sells from",
  "/pay-types": "Each pay type has its own labor rate",
  "/fees": "Misc shop fee is a percent",
};

function staffNav(html: string) {
  return [...html.matchAll(/data-staff-nav[\s\S]*?<\/nav>/g)].map((match) => match[0]).join("\n");
}

describe("desk client mount", () => {
  const consoleError = console.error;
  const noise: string[] = [];

  after(() => {
    console.error = consoleError;
    delete (globalThis as { __JF_DEMO_MODE__?: string }).__JF_DEMO_MODE__;
    delete (globalThis as { __JF_SHELL_MOUNT__?: boolean }).__JF_SHELL_MOUNT__;
    useShop.setState({ ...createEmptyShop(), focusOrderId: null });
  });

  for (const [label, shop] of [
    ["empty", () => ({ ...createEmptyShop(), dataset: "sample" as const })],
    ["seeded", () => createSeed()],
    ["older saved", () => olderSavedShop()],
  ] as const) {
    it(`mounts every route on ${label} storage without a console or render error`, async () => {
      deskState(shop());
      const problems: string[] = [];
      console.error = (...args: unknown[]) => {
        const message = args.map((item) => (item instanceof Error ? item.message : String(item))).join(" ");
        if (message.includes("not wrapped in act") || message.includes("not configured to support act") || message.includes("cannot be a child of")) return;
        problems.push(message);
      };
      for (const path of ROUTES) {
        const { text, html, thrown, status, location } = await mount(path);
        if (thrown) problems.push(`${path} threw ${thrown}`);
        if (text.includes("Something went wrong") || text.includes("Maximum update depth")) {
          problems.push(`${path} crashed: ${text.slice(0, 240)}`);
        }
        if (!text.includes("Fixed operations") && !text.includes("Jess Ford") && !text.includes("Service managers") && !text.includes("Repair orders") && !text.includes("Appointments")) {
          problems.push(`${path} did not render the desk (${status} ${location}): ${JSON.stringify(html.slice(0, 180))}`);
        }
        const nav = staffNav(html);
        if (nav.includes('href="/request"') || nav.includes('href="/online-requests"')) {
          problems.push(`${path} still links Request a visit or Online requests in the staff nav`);
        }
        if (isLockedPath(path)) {
          if (!text.includes(SECTION_LOCK_NOTICE)) problems.push(`${path} did not show the locked panel`);
          if (html.includes(`href="${path}"`)) problems.push(`${path} still has a nav link`);
          const marker = LOCKED_BODY[path];
          if (marker && text.includes(marker)) problems.push(`${path} rendered the locked screen (${marker})`);
        }
        if (path === "/online-requests" && !text.includes("Online requests") && !location.includes("/schedule")) {
          problems.push(`/online-requests did not open the appointments calendar (${location})`);
        }
        if (path === "/schedule" && !text.includes("Online requests")) {
          problems.push("/schedule did not show the online requests panel");
        }
        if (path === "/request" && !text.includes("Request a visit")) {
          problems.push("/request did not render the customer booking page");
        }
      }
      console.error = consoleError;
      assert.deepEqual(problems, [], problems.join("\n"));
      noise.push(label);
    });
  }

  it("client-mounts a locked screen when the flag is off, and a sub-route stays locked when it is on", async () => {
    deskState(createSeed());
    const flags = globalThis as { __SECTION_LOCK_ENABLED__?: boolean };
    flags.__SECTION_LOCK_ENABLED__ = false;
    const open = await mount("/dispatch");
    delete flags.__SECTION_LOCK_ENABLED__;
    assert.equal(open.thrown, "");
    assert.match(open.text, /The roster/);
    assert.equal(open.text.includes(SECTION_LOCK_NOTICE), false);
    const nested = await mount("/dispatch/extra");
    assert.equal(nested.text.includes("The roster"), false);
    assert.equal(nested.text.includes("Maximum update depth"), false);
  });

  it("accepts and declines a pending request from the appointments calendar", async () => {
    deskState(createSeed());
    const state = useShop.getState();
    const customer = state.customers[0];
    const vehicle = state.vehicles.find((row) => row.customerId === customer.id);
    const advisor = state.advisors[0];
    const tech = state.techs[0];
    assert.ok(customer && vehicle && advisor && tech);
    const base = {
      storeId: "grand-coulee" as const,
      status: "pending" as const,
      createdAt: "2026-10-30T16:00:00.000Z",
      serviceId: "oil",
      serviceName: "Oil",
      laborHours: 1,
      date: "2026-10-31",
      time: "09:00",
      advisorId: advisor.id,
      advisorName: advisor.name,
      techId: tech.id,
      techName: tech.name,
      transportId: "drop",
      transportName: "Drop",
      contactMethod: "text" as const,
      verified: true,
      customerId: customer.id,
      phone: customer.phone,
      email: "",
      vehicleId: vehicle.id,
      year: vehicle.year,
      make: "Ford",
      model: vehicle.model,
      vin: vehicle.vin,
      plate: "ABC123",
      appointmentId: null,
    };
    const rows: OnlineRequest[] = [
      { ...base, id: "rq-yes", customerName: "Approve Me" },
      { ...base, id: "rq-no", customerName: "Decline Me" },
    ];
    const before = useShop.getState().appointments.length;
    const { text, thrown } = await mount("/schedule", async (host) => {
      useShop.setState({ onlineRequests: rows });
      for (let i = 0; i < 20 && !host.textContent?.includes("Decline Me"); i += 1) {
        await new Promise((resolve) => setTimeout(resolve, 20));
      }
      const decline = [...host.querySelectorAll("button")].find((button) => button.textContent === "Decline");
      assert.ok(decline);
      decline.click();
      await new Promise((resolve) => setTimeout(resolve, 30));
      const approve = [...host.querySelectorAll("button")].find((button) => button.textContent === "Approve");
      assert.ok(approve);
      approve.click();
      await new Promise((resolve) => setTimeout(resolve, 30));
    });
    assert.equal(thrown, "");
    assert.match(text, /Online requests \(0\)/);
    assert.equal(useShop.getState().onlineRequests.find((row) => row.id === "rq-no")?.status, "declined");
    assert.equal(useShop.getState().onlineRequests.find((row) => row.id === "rq-yes")?.status, "approved");
    assert.equal(useShop.getState().appointments.length, before + 1);
  });
});
