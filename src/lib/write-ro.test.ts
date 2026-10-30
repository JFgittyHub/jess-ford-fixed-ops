import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { createElement, type ComponentType } from "react";
import { createRoot } from "react-dom/client";
import { act } from "react";
import { createEmptyShop } from "./seed.ts";
import { useShop } from "./store.ts";
import type { Appointment, Tech } from "./types.ts";

type Preset = {
  customerId?: string;
  vehicleId?: string;
  advisorId?: string;
  concern?: string;
  laborOpIds?: string[];
  appointmentId?: string;
  mileage?: string;
};

type NewOrderProps = {
  open: boolean;
  onClose: () => void;
  preset?: Preset;
};

type FakeNode = {
  nodeType: number;
  tagName: string;
  nodeName: string;
  style: Record<string, string>;
  childNodes: FakeNode[];
  attributes: Record<string, string>;
  text: string;
  value: string;
  _value: string;
  selected: boolean;
  options: FakeNode[];
  parentNode: FakeNode | null;
  ownerDocument: FakeDocument | null;
  namespaceURI: string;
  listeners: Record<string, ((event: FakeEvent) => void)[]>;
  appendChild: (child: FakeNode) => FakeNode;
  removeChild: (child: FakeNode) => FakeNode;
  textContent: string;
  dispatchEvent: (event: FakeEvent) => boolean;
  contains: (other: FakeNode) => boolean;
};

type FakeEvent = {
  type: string;
  bubbles?: boolean;
  cancelable?: boolean;
  target?: FakeNode;
  currentTarget?: FakeNode;
  defaultPrevented?: boolean;
  cancelBubble?: boolean;
  preventDefault: () => void;
  stopPropagation: () => void;
};

type FakeDocument = FakeNode & {
  body: FakeNode;
  documentElement: FakeNode;
  head: FakeNode;
  defaultView: typeof globalThis;
  activeElement: FakeNode;
  createElement: (tag: string) => FakeNode;
  createElementNS: (ns: string, tag: string) => FakeNode;
  createTextNode: (text: string) => FakeNode;
  createComment: (text: string) => FakeNode;
  createDocumentFragment: () => FakeNode;
  getElementById: (id: string) => FakeNode | null;
  querySelector: () => null;
  querySelectorAll: () => FakeNode[];
};

let NewOrder: ComponentType<NewOrderProps>;

function installTestDom() {
  (globalThis as unknown as { window: typeof globalThis }).window = globalThis;
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  for (const name of [
    "HTMLElement",
    "Element",
    "Node",
    "HTMLIFrameElement",
    "HTMLInputElement",
    "HTMLSelectElement",
    "HTMLButtonElement",
    "HTMLFormElement",
    "SVGElement",
    "DocumentFragment",
    "Comment",
    "Text",
    "HTMLDivElement",
  ]) {
    if (typeof (globalThis as Record<string, unknown>)[name] !== "function") {
      (globalThis as Record<string, unknown>)[name] = function ctor() {};
    }
  }

  function node(tag = "div"): FakeNode {
    const listeners: FakeNode["listeners"] = {};
    const el = {
      nodeType: 1,
      tagName: String(tag).toUpperCase(),
      nodeName: String(tag).toUpperCase(),
      style: {},
      childNodes: [] as FakeNode[],
      attributes: {} as Record<string, string>,
      text: "",
      _value: "",
      parentNode: null as FakeNode | null,
      ownerDocument: null as FakeDocument | null,
      namespaceURI: "http://www.w3.org/1999/xhtml",
      listeners,
      addEventListener(type: string, fn: (event: FakeEvent) => void) {
        (listeners[type] ||= []).push(fn);
      },
      removeEventListener(type: string, fn: (event: FakeEvent) => void) {
        listeners[type] = (listeners[type] || []).filter((item) => item !== fn);
      },
      dispatchEvent(event: FakeEvent) {
        const assign = (key: "target" | "currentTarget", value: FakeNode) => {
          try {
            event[key] = value;
          } catch {
            // Native events lock target and currentTarget.
          }
        };
        assign("target", el);
        let current: FakeNode | null = el;
        while (current) {
          assign("currentTarget", current);
          for (const fn of current.listeners[event.type] || []) fn(event);
          if (!event.bubbles || event.cancelBubble) break;
          current = current.parentNode;
        }
        return true;
      },
      setAttribute(name: string, value: string) {
        el.attributes[name] = String(value);
      },
      getAttribute(name: string) {
        return el.attributes[name] ?? null;
      },
      removeAttribute(name: string) {
        delete el.attributes[name];
      },
      hasAttribute(name: string) {
        return Object.prototype.hasOwnProperty.call(el.attributes, name);
      },
      appendChild(child: FakeNode) {
        if (child) child.parentNode = el;
        el.childNodes.push(child);
        return child;
      },
      removeChild(child: FakeNode) {
        el.childNodes = el.childNodes.filter((item) => item !== child);
        if (child) child.parentNode = null;
        return child;
      },
      insertBefore(child: FakeNode) {
        return el.appendChild(child);
      },
      contains(other: FakeNode) {
        return el === other || el.childNodes.some((child) => child.contains?.(other));
      },
      getBoundingClientRect() {
        return { x: 0, y: 0, width: 1, height: 1, top: 0, left: 0, right: 1, bottom: 1, toJSON() { return {}; } };
      },
      focus() {},
      blur() {},
      set textContent(value: string) {
        el.text = String(value);
        el.childNodes = [];
      },
      get textContent() {
        return el.childNodes.map((child) => child.textContent || child.text || "").join("") || el.text;
      },
      get firstChild() {
        return el.childNodes[0] ?? null;
      },
      get children() {
        return el.childNodes.filter((child) => child.nodeType === 1);
      },
      get options() {
        return el.childNodes.filter((child) => child.tagName === "OPTION");
      },
      get firstElementChild() {
        return el.childNodes.find((child) => child.nodeType === 1) ?? null;
      },
      get lastElementChild() {
        const rows = el.childNodes.filter((child) => child.nodeType === 1);
        return rows[rows.length - 1] ?? null;
      },
      insertAdjacentElement(position: string, child: FakeNode) {
        child.parentNode = el;
        if (position === "afterbegin") el.childNodes.unshift(child);
        else el.childNodes.push(child);
        return child;
      },
      remove() {
        el.parentNode?.removeChild(el);
      },
      querySelectorAll() {
        return [];
      },
      selected: false,
      disabled: false,
      get value() {
        if (el.tagName === "SELECT") {
          const selected = el.options.find((option) => option.selected);
          if (selected) return selected.value;
        }
        return el._value || el.attributes.value || "";
      },
      set value(next: string) {
        el._value = String(next ?? "");
        if (el.tagName === "SELECT") {
          for (const option of el.options) option.selected = option.value === el._value;
        }
      },
    };
    return el;
  }

  const documentElement = node("html");
  const body = node("body");
  const head = node("head");
  documentElement.appendChild(body);
  const document = Object.assign(node("#document"), {
    nodeType: 9,
    documentElement,
    body,
    head,
    defaultView: globalThis,
    activeElement: body,
    createElement(tag: string) {
      const el = node(tag);
      el.ownerDocument = document;
      return el;
    },
    createElementNS(_ns: string, tag: string) {
      return document.createElement(tag);
    },
    createTextNode(text: string) {
      return {
        nodeType: 3,
        tagName: "#text",
        textContent: String(text),
        nodeName: "#text",
        parentNode: null,
        ownerDocument: document,
        childNodes: [],
      } as unknown as FakeNode;
    },
    createComment(text: string) {
      return {
        nodeType: 8,
        tagName: "#comment",
        textContent: String(text),
        nodeName: "#comment",
        parentNode: null,
        ownerDocument: document,
        childNodes: [],
      } as unknown as FakeNode;
    },
    getElementById(id: string) {
      const found = elements(documentElement, "*").find((el) => el.attributes.id === id);
      return found ?? null;
    },
    querySelector() {
      return null;
    },
    querySelectorAll() {
      return [];
    },
    createDocumentFragment() {
      const el = node("fragment");
      el.ownerDocument = document;
      return el;
    },
    createTreeWalker(root: FakeNode) {
      const list: FakeNode[] = [];
      const visit = (current: FakeNode) => {
        for (const child of current.childNodes || []) {
          if (child.nodeType === 1) {
            list.push(child);
            visit(child);
          }
        }
      };
      visit(root);
      let index = -1;
      return {
        currentNode: null as FakeNode | null,
        nextNode() {
          index += 1;
          this.currentNode = list[index] ?? null;
          return this.currentNode;
        },
      };
    },
  }) as FakeDocument;
  (globalThis as { NodeFilter?: object }).NodeFilter = {
    SHOW_ELEMENT: 1,
    FILTER_ACCEPT: 1,
    FILTER_REJECT: 2,
    FILTER_SKIP: 3,
  };
  documentElement.ownerDocument = document;
  body.ownerDocument = document;
  globalThis.document = document as unknown as Document;
  globalThis.getComputedStyle = () => new Proxy({}, { get: () => "" }) as CSSStyleDeclaration;
  globalThis.requestAnimationFrame = (cb: FrameRequestCallback) => {
    cb(0);
    return 1;
  };
  globalThis.cancelAnimationFrame = (id: number) => clearTimeout(id);
  globalThis.MutationObserver = class {
    observe() {}
    disconnect() {}
    takeRecords() {
      return [];
    }
  } as unknown as typeof MutationObserver;
  globalThis.ResizeObserver = class {
    observe() {}
    disconnect() {}
    unobserve() {}
  } as unknown as typeof ResizeObserver;
}

function elements(root: FakeNode, tag: string) {
  const found: FakeNode[] = [];
  const visit = (node: FakeNode) => {
    if (tag === "*" || node.tagName === tag) found.push(node);
    for (const child of node.childNodes || []) visit(child);
  };
  visit(root);
  return found;
}

function appointment(id: string, customerId: string, vehicleId: string, advisorId: string, status: Appointment["status"]): Appointment {
  return {
    id,
    date: "2026-10-20",
    time: "09:00",
    minutes: 60,
    customerId,
    vehicleId,
    advisorId,
    techId: "",
    concern: "Visit",
    lines: [{ id: `${id}-a`, code: "A", concern: "Visit" }],
    vin: "",
    laborOpIds: [],
    lane: "drop",
    status,
    orderId: null,
  };
}

function loadShop() {
  const empty = createEmptyShop();
  useShop.setState({
    ...empty,
    focusOrderId: null,
    customers: [
      { id: "helen", name: "Helen Cho", phone: "(555) 010-0001", mobile: "", email: "", noShows: 0 },
      { id: "glenn", name: "Glenn Ortiz", phone: "(555) 010-0002", mobile: "", email: "", noShows: 0 },
      { id: "mina", name: "Mina Patel", phone: "(555) 010-0003", mobile: "", email: "", noShows: 0 },
    ],
    vehicles: [
      { id: "helen-truck", customerId: "helen", year: 2024, make: "Ford", model: "F-150", vin: "1FTH" },
      { id: "glenn-car", customerId: "glenn", year: 2019, make: "Ford", model: "Escape", vin: "1FMC" },
      { id: "mina-suv", customerId: "mina", year: 2021, make: "Ford", model: "Explorer", vin: "1FM5" },
    ],
    advisors: [
      { id: "advisor-21", number: "21", name: "First Advisor", base: 1, laborPercent: 1, partsPercent: 1 },
      { id: "advisor-glenn", number: "44", name: "Glenn's advisor", base: 1, laborPercent: 1, partsPercent: 1 },
      { id: "advisor-mina", number: "18", name: "Mina's advisor", base: 1, laborPercent: 1, partsPercent: 1 },
    ],
    appointments: [
      appointment("appt-helen", "helen", "helen-truck", "advisor-21", "scheduled"),
      appointment("appt-glenn", "glenn", "glenn-car", "advisor-glenn", "arrived"),
      appointment("appt-mina", "mina", "mina-suv", "advisor-mina", "scheduled"),
    ],
    orders: [],
  });
}

async function renderWriteRo() {
  const host = (document as unknown as FakeDocument).createElement("div");
  (document as unknown as FakeDocument).body.appendChild(host);
  const root = createRoot(host as unknown as Element);
  const props: { current: NewOrderProps } = {
    current: { open: false, onClose() {}, preset: undefined },
  };
  async function draw() {
    await act(async () => {
      root.render(createElement(NewOrder, props.current));
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  }
  await draw();
  return {
    root,
    async set(next: NewOrderProps) {
      props.current = next;
      await draw();
    },
    selects() {
      return elements((document as unknown as FakeDocument).body, "SELECT");
    },
    async submit() {
      const form = elements((document as unknown as FakeDocument).body, "FORM")[0];
      assert.ok(form, "write-up form is on screen");
      await act(async () => {
        form.dispatchEvent(domEvent("submit"));
      });
    },
  };
}

function domEvent(type: string): FakeEvent {
  return {
    type,
    bubbles: true,
    cancelable: true,
    defaultPrevented: false,
    cancelBubble: false,
    preventDefault() {
      this.defaultPrevented = true;
    },
    stopPropagation() {
      this.cancelBubble = true;
    },
  };
}

describe("Write RO", () => {
  const consoleError = console.error;

  before(async () => {
    installTestDom();
    console.error = (...args: unknown[]) => {
      const message = String(args[0] ?? "");
      if (message.includes("not wrapped in act")) return;
      consoleError(...args);
    };
    ({ NewOrder } = await import("../components/new-order.tsx"));
  });

  after(() => {
    console.error = consoleError;
    useShop.setState({ ...createEmptyShop(), focusOrderId: null });
  });

  it("writes the appointment that was just opened, then a different one without reloading", async () => {
    loadShop();
    const view = await renderWriteRo();
    await view.set({
      open: true,
      onClose() {},
      preset: { mileage: "40000",
        customerId: "glenn",
        vehicleId: "glenn-car",
        advisorId: "advisor-glenn",
        concern: "Brake pulsation",
        appointmentId: "appt-glenn",
      },
    });

    const [customer, vehicle, advisor] = view.selects();
    assert.equal(customer?.value, "glenn");
    assert.equal(vehicle?.value, "glenn-car");
    assert.equal(advisor?.value, "advisor-glenn");
    await view.submit();

    const first = useShop.getState().orders[0];
    assert.ok(first);
    assert.equal(first.customerId, "glenn");
    assert.equal(first.vehicleId, "glenn-car");
    assert.equal(first.advisorId, "advisor-glenn");
    assert.match(first.concern, /Brake pulsation/);
    const afterGlenn = Object.fromEntries(useShop.getState().appointments.map((row) => [row.id, row]));
    assert.equal(afterGlenn["appt-glenn"]?.status, "in_shop");
    assert.equal(afterGlenn["appt-glenn"]?.orderId, first.id);
    assert.equal(afterGlenn["appt-helen"]?.status, "scheduled");
    assert.equal(afterGlenn["appt-helen"]?.orderId, null);
    assert.equal(afterGlenn["appt-mina"]?.status, "scheduled");
    assert.equal(afterGlenn["appt-mina"]?.orderId, null);

    await view.set({
      open: true,
      onClose() {},
      preset: { mileage: "40000",
        customerId: "mina",
        vehicleId: "mina-suv",
        advisorId: "advisor-mina",
        concern: "Oil leak",
        appointmentId: "appt-mina",
      },
    });
    const [nextCustomer, nextVehicle, nextAdvisor] = view.selects();
    assert.equal(nextCustomer?.value, "mina");
    assert.equal(nextVehicle?.value, "mina-suv");
    assert.equal(nextAdvisor?.value, "advisor-mina");
    await view.submit();

    const orders = useShop.getState().orders;
    const second = orders.find((order) => order.id !== first.id);
    assert.ok(second);
    assert.equal(second.customerId, "mina");
    assert.equal(second.vehicleId, "mina-suv");
    assert.equal(second.advisorId, "advisor-mina");
    assert.match(second.concern, /Oil leak/);
    const afterMina = Object.fromEntries(useShop.getState().appointments.map((row) => [row.id, row]));
    assert.equal(afterMina["appt-mina"]?.status, "in_shop");
    assert.equal(afterMina["appt-mina"]?.orderId, second.id);
    assert.equal(afterMina["appt-glenn"]?.status, "in_shop");
    assert.equal(afterMina["appt-glenn"]?.orderId, first.id);
    assert.equal(afterMina["appt-helen"]?.status, "scheduled");
    assert.equal(afterMina["appt-helen"]?.orderId, null);
    view.root.unmount();
  });

  it("carries the marketing customer's vehicle into the repair order", async () => {
    loadShop();
    const view = await renderWriteRo();
    await view.set({
      open: true,
      onClose() {},
      preset: { mileage: "40000", customerId: "glenn", vehicleId: "glenn-car", concern: "Tire rotation" },
    });
    const [customer, vehicle] = view.selects();
    assert.equal(customer?.value, "glenn");
    assert.equal(vehicle?.value, "glenn-car");
    await view.submit();

    const first = useShop.getState().orders[0];
    assert.ok(first);
    assert.equal(first.customerId, "glenn");
    assert.equal(first.vehicleId, "glenn-car");
    for (const row of useShop.getState().appointments) {
      assert.equal(row.status === "in_shop", false);
      assert.equal(row.orderId, null);
    }

    await view.set({
      open: true,
      onClose() {},
      preset: { mileage: "40000", customerId: "mina", vehicleId: "mina-suv", concern: "Alignment" },
    });
    const [nextCustomer, nextVehicle] = view.selects();
    assert.equal(nextCustomer?.value, "mina");
    assert.equal(nextVehicle?.value, "mina-suv");
    await view.submit();

    const second = useShop.getState().orders.find((order) => order.id !== first.id);
    assert.ok(second);
    assert.equal(second.customerId, "mina");
    assert.equal(second.vehicleId, "mina-suv");
    for (const row of useShop.getState().appointments) {
      assert.equal(row.orderId, null);
    }
    view.root.unmount();
  });

  it("puts carried labor on the appointment's tech when that tech is not first on the list", async () => {
    loadShop();
    const marcus = tech("marcus", "41", "Marcus Hale");
    const andre = tech("andre", "7", "Andre Brooks");
    useShop.setState({
      techs: [marcus, andre],
      laborOps: [
        { id: "op-dsl", opcode: "DSL", description: "Diesel fuel filters and oil", hours: 2.4, payType: "cp" },
        { id: "op-diag", opcode: "DIAG", description: "Drivability diagnosis", hours: 1.1, payType: "cp" },
      ],
      appointments: useShop.getState().appointments.map((row) =>
        row.id === "appt-glenn" ? { ...row, techId: andre.id, lane: "drop" as const, laborOpIds: ["op-dsl", "op-diag"] } : row,
      ),
    });
    assert.equal(useShop.getState().techs[0]?.id, marcus.id);
    assert.notEqual(andre.id, marcus.id);

    const view = await renderWriteRo();
    await view.set({
      open: true,
      onClose() {},
      preset: { mileage: "40000",
        customerId: "glenn",
        vehicleId: "glenn-car",
        advisorId: "advisor-glenn",
        concern: "Diesel service",
        laborOpIds: ["op-dsl", "op-diag"],
        appointmentId: "appt-glenn",
      },
    });
    await view.submit();

    const order = useShop.getState().orders[0];
    assert.ok(order);
    assert.deepEqual(order.labor.map((line) => line.opcode), ["DSL", "DIAG"]);
    assert.equal(order.labor.every((line) => line.techId === andre.id), true);
    view.root.unmount();
  });

  it("leaves carried labor unassigned when the appointment has no tech", async () => {
    loadShop();
    const marcus = tech("marcus", "41", "Marcus Hale");
    useShop.setState({
      techs: [marcus, tech("andre", "7", "Andre Brooks")],
      laborOps: [
        { id: "op-dsl", opcode: "DSL", description: "Diesel fuel filters and oil", hours: 2.4, payType: "cp" },
      ],
      appointments: useShop.getState().appointments.map((row) =>
        row.id === "appt-glenn" ? { ...row, techId: "", laborOpIds: ["op-dsl"] } : row,
      ),
    });
    assert.equal(useShop.getState().techs[0]?.id, marcus.id);

    const view = await renderWriteRo();
    await view.set({
      open: true,
      onClose() {},
      preset: { mileage: "40000",
        customerId: "glenn",
        vehicleId: "glenn-car",
        advisorId: "advisor-glenn",
        concern: "Diesel service",
        laborOpIds: ["op-dsl"],
        appointmentId: "appt-glenn",
      },
    });
    await view.submit();

    const order = useShop.getState().orders[0];
    assert.ok(order);
    assert.deepEqual(order.labor.map((line) => line.opcode), ["DSL"]);
    assert.equal(order.labor.every((line) => line.techId === ""), true);
    view.root.unmount();
  });
});

describe("RO editor", () => {
  before(async () => {
    installTestDom();
  });

  it("renders an open and a closed repair order for every role", async () => {
    const { OrderEditor } = await import("../components/order-editor.tsx");
    const { createSeed } = await import("./seed.ts");
    useShop.setState({ ...createSeed("grand-coulee"), focusOrderId: null });
    const open = useShop.getState().orders.find((row) => row.status !== "closed");
    const closed = useShop.getState().orders.find((row) => row.status === "closed");
    assert.ok(open && closed);
    for (const who of ["megan", "marcus", "derek"]) {
      useShop.getState().setWorkingAs(who);
      for (const id of [open.id, closed.id]) {
        const host = (document as unknown as { createElement: (tag: string) => { textContent: string } }).createElement("div");
        (document as unknown as { body: { appendChild: (node: unknown) => void } }).body.appendChild(host);
        const root = createRoot(host as unknown as Element);
        await act(async () => {
          root.render(createElement(OrderEditor, { orderId: id, onClose() {} }));
        });
        const text = (document as unknown as { body: { textContent: string } }).body.textContent;
        assert.match(text, new RegExp(String(useShop.getState().orders.find((row) => row.id === id)?.number)));
        if (id === closed.id) assert.match(text, /It can be viewed, and it can't be changed/);
        await act(async () => root.unmount());
      }
    }
  });

  it("renders Pullman for Tara Singh, a technician, and a booked repair order", async () => {
    const { OrderEditor } = await import("../components/order-editor.tsx");
    const { createSeed } = await import("./seed.ts");
    const seed = createSeed("pullman");
    const source = seed.orders.find((row) => row.status !== "closed" && row.labor.some((line) => line.techId));
    assert.ok(source);
    const tech = seed.techs.find((row) => row.id === source.labor.find((line) => line.techId)?.techId);
    assert.ok(tech);
    useShop.setState({
      ...seed,
      focusOrderId: null,
      orders: seed.orders.map((row) => (row.id === source.id ? { ...row, status: "booked" as const } : row)),
    });
    useShop.getState().setWorkingAs("derek");
    const host = (document as unknown as { createElement: (tag: string) => { textContent: string } }).createElement("div");
    (document as unknown as { body: { appendChild: (node: unknown) => void } }).body.appendChild(host);
    const root = createRoot(host as unknown as Element);
    await act(async () => {
      root.render(createElement(OrderEditor, { orderId: source.id, onClose() {} }));
    });
    const text = (document as unknown as { body: { textContent: string } }).body.textContent;
    assert.match(text, /Tara Singh/);
    assert.match(text, new RegExp(tech.name));
    assert.match(text, /Booked/);
    await act(async () => root.unmount());
  });
});

function tech(id: string, number: string, name: string): Tech {
  return {
    id,
    number,
    name,
    skill: "a",
    board: "main",
    payStyle: "flat",
    flagRate: 30,
    hourlyRate: 30,
    availableHoursMonth: 100,
    clockedHoursMonth: 0,
    clockedToday: 0,
  };
}
