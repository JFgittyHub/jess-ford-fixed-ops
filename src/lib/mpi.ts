export type MpiMark = "green" | "yellow" | "red";

export interface MpiPoint {
  id: string;
  group: string;
  label: string;
  unit: "mm" | "/32" | null;
  status: MpiMark | null;
  reading: string;
  note: string;
}

export interface MultiPoint {
  techId: string;
  items: MpiPoint[];
}

const TEMPLATE: Array<Pick<MpiPoint, "id" | "group" | "label" | "unit">> = [
  { id: "oil", group: "Under the hood", label: "Engine oil", unit: null },
  { id: "coolant", group: "Under the hood", label: "Coolant", unit: null },
  { id: "brake-fluid", group: "Under the hood", label: "Brake fluid", unit: null },
  { id: "washer", group: "Under the hood", label: "Washer fluid", unit: null },
  { id: "battery", group: "Under the hood", label: "Battery and cables", unit: null },
  { id: "belts", group: "Under the hood", label: "Drive belts", unit: null },
  { id: "hoses", group: "Under the hood", label: "Hoses", unit: null },
  { id: "air-filter", group: "Under the hood", label: "Engine air filter", unit: null },
  { id: "cabin", group: "Under the hood", label: "Cabin filter", unit: null },
  { id: "pad-lf", group: "Brakes", label: "Left front pads", unit: "mm" },
  { id: "pad-rf", group: "Brakes", label: "Right front pads", unit: "mm" },
  { id: "pad-lr", group: "Brakes", label: "Left rear pads", unit: "mm" },
  { id: "pad-rr", group: "Brakes", label: "Right rear pads", unit: "mm" },
  { id: "tire-lf", group: "Tires", label: "Left front tread", unit: "/32" },
  { id: "tire-rf", group: "Tires", label: "Right front tread", unit: "/32" },
  { id: "tire-lr", group: "Tires", label: "Left rear tread", unit: "/32" },
  { id: "tire-rr", group: "Tires", label: "Right rear tread", unit: "/32" },
  { id: "shocks", group: "Under the vehicle", label: "Shocks and struts", unit: null },
  { id: "steer", group: "Under the vehicle", label: "Steering and ball joints", unit: null },
  { id: "exhaust", group: "Under the vehicle", label: "Exhaust", unit: null },
  { id: "leaks", group: "Under the vehicle", label: "Fluid leaks", unit: null },
  { id: "cv", group: "Under the vehicle", label: "CV boots and driveshaft", unit: null },
  { id: "wipers", group: "Lights and glass", label: "Wiper blades", unit: null },
  { id: "lamps", group: "Lights and glass", label: "Headlamps and brake lamps", unit: null },
  { id: "horn", group: "Lights and glass", label: "Horn", unit: null },
  { id: "glass", group: "Lights and glass", label: "Windshield", unit: null },
];

type Mark = { status: MpiMark; reading?: string; note?: string };

export function blankSheet(techId: string): MultiPoint {
  return {
    techId,
    items: TEMPLATE.map((item) => ({ ...item, status: null, reading: "", note: "" })),
  };
}

function filledSheet(techId: string, marks: Record<string, Mark>, rest: MpiMark | null): MultiPoint {
  const sheet = blankSheet(techId);
  sheet.items = sheet.items.map((item) => {
    const mark = marks[item.id];
    if (mark) {
      return { ...item, status: mark.status, reading: mark.reading ?? "", note: mark.note ?? "" };
    }
    return rest ? { ...item, status: rest } : item;
  });
  return sheet;
}

/** Sample sheets for the open October tickets. Unknown ids stay unattached. */
export function demoSheet(orderId: string): MultiPoint | null {
  if (orderId === "open-helen") {
    return filledSheet("chris", {
      "pad-lf": { status: "red", reading: "2", note: "Metal on the rotor" },
      "pad-rf": { status: "red", reading: "3", note: "Rotor scored" },
      "pad-lr": { status: "yellow", reading: "5", note: "Will not make the next visit" },
      "pad-rr": { status: "yellow", reading: "5", note: "Same as the left" },
      "tire-lf": { status: "yellow", reading: "4", note: "Inner edge" },
      wipers: { status: "yellow", note: "Chatter on the glass" },
    }, "green");
  }
  if (orderId === "open-pat") {
    return filledSheet("luis", {
      cabin: { status: "green", note: "Replaced on this visit" },
      "air-filter": { status: "green", note: "Replaced on this visit" },
      "tire-rr": { status: "yellow", reading: "5", note: "Even wear, mention next time" },
    }, "green");
  }
  if (orderId === "open-carl") return filledSheet("luis", {}, "green");
  if (orderId === "open-sandra") {
    return filledSheet("sam", {
      oil: { status: "green" },
      coolant: { status: "green" },
      battery: { status: "green" },
      shocks: { status: "yellow", note: "Front tires cupped" },
      steer: { status: "yellow", note: "Clunk at the left front ball joint" },
    }, null);
  }
  if (orderId === "open-ruth") {
    return filledSheet("andre", {
      leaks: { status: "yellow", note: "Seep at the fuel-filter housing" },
      battery: { status: "yellow", note: "Slow crank when cold" },
    }, "green");
  }
  if (orderId === "open-malik") {
    return filledSheet("elena", {
      "air-filter": { status: "yellow", note: "Packed with dust" },
    }, "green");
  }
  if (orderId === "open-owen") {
    return filledSheet("priya", {
      wipers: { status: "red", note: "Torn. Blades are on this ticket." },
      "tire-lf": { status: "yellow", reading: "4" },
      "tire-rf": { status: "yellow", reading: "4" },
    }, "green");
  }
  if (orderId === "open-frank") {
    return filledSheet("chris", {
      coolant: { status: "yellow", note: "A little low. No leak found." },
    }, "green");
  }
  return null;
}

export function mpiCounts(sheet: MultiPoint | null | undefined) {
  const items = sheet?.items ?? [];
  let green = 0;
  let yellow = 0;
  let red = 0;
  let open = 0;
  for (const item of items) {
    if (item.status === "green") green += 1;
    else if (item.status === "yellow") yellow += 1;
    else if (item.status === "red") red += 1;
    else open += 1;
  }
  return { green, yellow, red, open, total: items.length };
}

export function mpiGroups(sheet: MultiPoint) {
  const groups: { name: string; items: MpiPoint[] }[] = [];
  for (const item of sheet.items) {
    const last = groups[groups.length - 1];
    if (!last || last.name !== item.group) groups.push({ name: item.group, items: [item] });
    else last.items.push(item);
  }
  return groups;
}
