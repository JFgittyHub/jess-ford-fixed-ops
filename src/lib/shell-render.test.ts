import "./test-dom.ts";
import assert from "node:assert/strict";
import { after, describe, it } from "node:test";
import { createElement } from "react";
import { flushSync } from "react-dom";
import { createRoot } from "react-dom/client";
import { createMemoryHistory, createRouter, RouterProvider } from "@tanstack/react-router";
import { AppErrorComponent } from "./error-component.tsx";
import { isLockedPath, SECTION_LOCK_NOTICE } from "./section-lock.ts";
import { deskLocationRewrite } from "./preview-path-prefix.ts";
import { createEmptyShop, createSeed } from "./seed.ts";
import { migrateSavedShop, useShop } from "./store.ts";
import type { OnlineRequest } from "./types.ts";
import { OrderEditor } from "../components/order-editor.tsx";
import { routeTree } from "../routeTree.gen.ts";
import type { ShopData } from "./types.ts";

(globalThis as { __SECTION_LOCK_ENABLED__?: boolean }).__SECTION_LOCK_ENABLED__ = true;

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

function deskRouter(path: string) {
  const history = createMemoryHistory({ initialEntries: [path] });
  return createRouter({
    routeTree,
    history,
    rewrite: deskLocationRewrite(),
    caseSensitive: false,
    trailingSlash: "never",
    defaultErrorComponent: AppErrorComponent,
  });
}

async function mount(path: string, interact?: (host: HTMLElement) => Promise<void> | void) {
  let router = deskRouter(path);
  await router.load();
  const server = (router as { _serverResult?: { type?: string; redirect?: { options?: { href?: string } } } })._serverResult;
  const redirectHref = server?.type === "redirect" ? server.redirect?.options?.href : undefined;
  // An encoded path or a trailing slash is canonicalized before the screen renders.
  if (redirectHref && redirectHref !== path) {
    router = deskRouter(redirectHref);
    await router.load();
  }
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
        if (path === "/schedule" && !text.includes("Online requests (0)")) {
          problems.push("/schedule did not show the Online requests (0) button");
        }
        if (path === "/schedule" && !text.includes("Online times")) {
          problems.push("/schedule did not show the Online times button");
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

  it("locks mixed-case and encoded section paths", async () => {
    deskState(createSeed());
    for (const path of ["/ADVISORS", "/Customers", "/%66ees", "/Pay-Types/"]) {
      const { text, thrown } = await mount(path);
      if (thrown) assert.fail(`${path} threw ${thrown}`);
      assert.equal(text.includes("The drive"), false, path);
      assert.equal(text.includes("Who is due back"), false, path);
      assert.equal(text.includes("Misc shop fee is a percent"), false, path);
      assert.equal(text.includes("Each pay type has its own labor rate"), false, path);
      if (path !== "/Pay-Types/") assert.match(text, /This section is coming later/);
    }
  });

  it("renders a repair order as view-only when writes are off", async () => {
    deskState(createSeed());
    const flags = globalThis as { __RO_WRITES_ENABLED__?: boolean; __RO_CREATION_ENABLED__?: boolean };
    const previousWrite = flags.__RO_WRITES_ENABLED__;
    const previousCreate = flags.__RO_CREATION_ENABLED__;
    flags.__RO_WRITES_ENABLED__ = false;
    flags.__RO_CREATION_ENABLED__ = false;
    const host = document.createElement("div");
    document.body.appendChild(host);
    const root = createRoot(host);
    try {
      const order = useShop.getState().orders.find((row) => row.status !== "closed");
      assert.ok(order);
      const before = JSON.stringify(useShop.getState().orders);
      flushSync(() => {
        root.render(createElement(OrderEditor, { orderId: order.id, onClose: () => undefined }));
      });
      await new Promise((resolve) => setTimeout(resolve, 40));
      assert.match(document.body.textContent ?? "", /Read-only — repair orders come from Dealertrack/);
      const enabled = [...document.querySelectorAll("input, select, textarea, button")].filter((element) => {
        if (element.hasAttribute("disabled") || element.getAttribute("aria-disabled") === "true") return false;
        const text = (element.textContent ?? "").replace(/\s+/g, " ").trim();
        if (element.tagName === "BUTTON" && /^(print|print repair order|print sheet|print copy|ticket|multi-point|close)$/i.test(text)) return false;
        return true;
      });
      assert.deepEqual(enabled.map((element) => `${element.tagName}:${(element.textContent ?? "").slice(0, 80)}`), []);
      useShop.getState().updateOpenVin(order.id, "1FTFW1E50NFA00001");
      useShop.getState().updateOrder(order.id, { mileage: order.mileage + 9 });
      assert.equal(JSON.stringify(useShop.getState().orders), before);
    } finally {
      flushSync(() => root.unmount());
      host.remove();
      flags.__RO_WRITES_ENABLED__ = previousWrite;
      flags.__RO_CREATION_ENABLED__ = previousCreate;
    }
  });

  it("hides repair-order writes on the list, tech board, schedule, and estimates", async () => {
    const flags = globalThis as {
      __RO_WRITES_ENABLED__?: boolean;
      __RO_CREATION_ENABLED__?: boolean;
      __SECTION_LOCK_ENABLED__?: boolean;
    };
    const previous = {
      write: flags.__RO_WRITES_ENABLED__,
      create: flags.__RO_CREATION_ENABLED__,
      lock: flags.__SECTION_LOCK_ENABLED__,
    };
    flags.__RO_WRITES_ENABLED__ = false;
    flags.__RO_CREATION_ENABLED__ = false;
    flags.__SECTION_LOCK_ENABLED__ = false;
    try {
      deskState(createSeed());
      const orders = await mount("/orders");
      assert.equal(orders.thrown, "");
      assert.match(orders.text, /Read-only — repair orders come from Dealertrack/);
      assert.equal(orders.text.includes("Book — ready to close"), false);
      const schedule = await mount("/schedule");
      assert.equal(schedule.thrown, "");
      assert.equal(schedule.text.includes("Write RO"), false);
      assert.equal(schedule.text.includes("Write repair order"), false);
      assert.equal(schedule.text.includes("Open as repair order"), false);
      const estimates = await mount("/estimates");
      assert.equal(estimates.thrown, "");
      assert.equal(estimates.text.includes("Open as repair order"), false);
      assert.match(estimates.text, /Repair orders come from Dealertrack/);
      const board = await mount("/tech-board");
      assert.equal(board.thrown, "");
      assert.equal(board.text.includes("Clock in"), false);
      assert.equal(board.text.includes("Clock out"), false);
      assert.equal(board.text.includes("Move clock here"), false);
      assert.match(board.text, /Read-only — repair orders come from Dealertrack/);
    } finally {
      flags.__RO_WRITES_ENABLED__ = previous.write;
      flags.__RO_CREATION_ENABLED__ = previous.create;
      flags.__SECTION_LOCK_ENABLED__ = previous.lock;
    }
  });

  it("labels the online requests button with the pending count, including zero", async () => {
    deskState(createSeed());
    const closed = await mount("/schedule");
    assert.equal(closed.thrown, "");
    assert.match(closed.text, /Online requests \(0\)/);
    assert.equal(closed.text.includes("Online requests (0)"), true);
    const opened = await mount("/schedule", async (host) => {
      const button = [...host.querySelectorAll("button")].find((item) => item.textContent === "Online requests (0)");
      assert.ok(button);
      button.click();
      await new Promise((resolve) => setTimeout(resolve, 30));
      assert.match(document.body.textContent ?? "", /Pending requests for this store hold their time/);
      const dialog = [...document.querySelectorAll("[role=dialog]")].at(-1);
      const close = [...(dialog?.querySelectorAll("button") ?? [])].find((item) => item.textContent === "Close");
      assert.ok(close);
      close.click();
      await new Promise((resolve) => setTimeout(resolve, 30));
      assert.equal((document.body.textContent ?? "").includes("Pending requests for this store hold their time"), false);
    });
    assert.equal(opened.thrown, "");
  });

  it("opens and closes online times from the header button", async () => {
    deskState(createSeed());
    const { thrown } = await mount("/schedule", async (host) => {
      const button = [...host.querySelectorAll("button")].find((item) => item.textContent === "Online times");
      assert.ok(button);
      button.click();
      await new Promise((resolve) => setTimeout(resolve, 30));
      assert.match(document.body.textContent ?? "", /Customers only see a time when the technician still has hours/);
      const dialog = [...document.querySelectorAll("[role=dialog]")].at(-1);
      const close = [...(dialog?.querySelectorAll("button") ?? [])].find((item) => item.textContent === "Close");
      assert.ok(close);
      close.click();
      await new Promise((resolve) => setTimeout(resolve, 30));
      assert.equal((document.body.textContent ?? "").includes("Customers only see a time when the technician still has hours"), false);
    });
    assert.equal(thrown, "");
  });

  it("opens the online requests modal from /online-requests and from the #online-requests hash", async () => {
    deskState(createSeed());
    let routeText = "";
    const fromRoute = await mount("/online-requests", async () => {
      for (let i = 0; i < 25 && !(document.body.textContent ?? "").includes("Pending requests for this store hold their time"); i += 1) {
        await new Promise((resolve) => setTimeout(resolve, 20));
      }
      routeText = document.body.textContent ?? "";
    });
    assert.equal(fromRoute.thrown, "");
    assert.match(routeText, /Online requests \(0\)/);
    assert.match(routeText, /Pending requests for this store hold their time/);
    let hashText = "";
    const fromHash = await mount("/schedule#online-requests", async () => {
      for (let i = 0; i < 25 && !(document.body.textContent ?? "").includes("Pending requests for this store hold their time"); i += 1) {
        await new Promise((resolve) => setTimeout(resolve, 20));
      }
      hashText = document.body.textContent ?? "";
    });
    assert.equal(fromHash.thrown, "");
    assert.match(hashText, /Online requests \(0\)/);
    assert.match(hashText, /Pending requests for this store hold their time/);
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
      for (let i = 0; i < 20 && !host.textContent?.includes("Online requests (2)"); i += 1) {
        await new Promise((resolve) => setTimeout(resolve, 20));
      }
      const opener = [...host.querySelectorAll("button")].find((button) => button.textContent === "Online requests (2)");
      assert.ok(opener);
      opener.click();
      for (let i = 0; i < 20 && !(document.body.textContent ?? "").includes("Decline Me"); i += 1) {
        await new Promise((resolve) => setTimeout(resolve, 20));
      }
      const decline = [...document.querySelectorAll("button")].find((button) => button.textContent === "Decline");
      assert.ok(decline);
      decline.click();
      await new Promise((resolve) => setTimeout(resolve, 30));
      const approve = [...document.querySelectorAll("button")].find((button) => button.textContent === "Approve");
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
