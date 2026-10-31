import { laborHoursFor } from "./capacity";
import { addDays, todayIso } from "./clock";
import { matchRequestCustomer } from "./online-request";
import { textingAdapter } from "./adapters/texting";
import type { Appointment, ContactMethod, Customer, OnlineRequest, ShopNotice, Vehicle } from "./types";

export function noticeRecipient(method: ContactMethod, contact: { phone?: string; email?: string; mobile?: string }): string {
  if (method === "email") return (contact.email ?? "").trim() || "No email";
  if (method === "call") return (contact.phone ?? "").trim() || (contact.mobile ?? "").trim() || "No phone";
  return (contact.mobile ?? "").trim() || (contact.phone ?? "").trim() || "No mobile";
}

export function decisionNotice(input: {
  id: string;
  at: string;
  request: OnlineRequest;
  kind: "approval" | "decline";
  appointmentId?: string | null;
}): ShopNotice {
  const request = input.request;
  const when = `${request.date} at ${request.time}`;
  const body = input.kind === "approval"
    ? `The shop confirmed ${request.customerName} for ${request.serviceName} on ${when} with ${request.advisorName}. ${request.transportName}.`
    : `The shop declined ${request.customerName} for ${request.serviceName} on ${when}. Call the shop to pick another time.`;
  const notice: ShopNotice = {
    id: input.id,
    storeId: request.storeId,
    at: input.at,
    kind: input.kind,
    method: request.contactMethod,
    recipient: noticeRecipient(request.contactMethod, request),
    body,
    requestId: request.id,
    appointmentId: input.appointmentId ?? null,
    customerName: request.customerName,
  };
  simulateDelivery(notice);
  return notice;
}

export function reminderNotice(input: {
  id: string;
  at: string;
  appointment: Appointment;
  customer: Customer | undefined;
  advisorName: string;
  transportName: string;
  method: ContactMethod;
  storeId: ShopNotice["storeId"];
}): ShopNotice {
  const customer = input.customer;
  const notice: ShopNotice = {
    id: input.id,
    storeId: input.storeId,
    at: input.at,
    kind: "reminder",
    method: input.method,
    recipient: noticeRecipient(input.method, {
      phone: customer?.phone,
      mobile: customer?.mobile,
      email: customer?.email,
    }),
    body: `Reminder for tomorrow: ${input.appointment.concern || "your visit"} at ${input.appointment.time} with ${input.advisorName}. ${input.transportName}.`,
    requestId: null,
    appointmentId: input.appointment.id,
    customerName: customer?.name ?? "Customer",
  };
  simulateDelivery(notice);
  return notice;
}

/** The texting adapter stays off. Calling it records nothing and sends nothing. */
export function simulateDelivery(notice: ShopNotice): void {
  if (notice.method !== "text") return;
  textingAdapter.send({ to: notice.recipient, body: notice.body, purpose: notice.kind === "reminder" ? "reminder" : "notice" });
}

export function appointmentMinutes(laborHours: number): number {
  return Math.max(1, Math.round(laborHours * 60));
}

export function confirmedHours(appointment: Pick<Appointment, "laborOpIds" | "minutes">, laborOps: { id: string; hours: number }[]): number {
  return laborHoursFor(appointment.laborOpIds, appointment.minutes, laborOps);
}

export interface ApprovalPlan {
  customerId: string;
  vehicleId: string;
  newCustomer: Customer | null;
  newVehicle: Vehicle | null;
  appointment: Appointment;
  notice: ShopNotice;
  request: OnlineRequest;
}

export function planApproval(input: {
  request: OnlineRequest;
  customers: Customer[];
  vehicles: Vehicle[];
  linkCustomerId?: string;
  at: string;
  ids: { appointmentId: string; noticeId: string; customerId: string; vehicleId: string };
}): ApprovalPlan | { ok: false; reason: "customer" | "vehicle" } {
  const request = input.request;
  const linked = linkParty(input);
  if ("ok" in linked) return linked;
  const minutes = appointmentMinutes(request.laborHours);
  const appointment: Appointment = {
    id: input.ids.appointmentId,
    date: request.date,
    time: request.time,
    minutes,
    customerId: linked.customerId,
    vehicleId: linked.vehicleId,
    advisorId: request.advisorId,
    concern: request.serviceName,
    lines: [{ id: `${input.ids.appointmentId}-a`, code: "A", concern: request.serviceName }],
    vin: linked.vin,
    laborOpIds: [],
    techId: request.techId,
    lane: request.transportId,
    status: "scheduled",
    orderId: null,
  };
  const named = input.customers.find((row) => row.id === linked.customerId) ?? linked.newCustomer;
  const nextRequest: OnlineRequest = {
    ...request,
    status: "approved",
    customerId: linked.customerId,
    vehicleId: linked.vehicleId,
    customerName: named?.name || request.customerName,
    appointmentId: appointment.id,
  };
  return {
    customerId: linked.customerId,
    vehicleId: linked.vehicleId,
    newCustomer: linked.newCustomer,
    newVehicle: linked.newVehicle,
    appointment,
    notice: decisionNotice({ id: input.ids.noticeId, at: input.at, request: nextRequest, kind: "approval", appointmentId: appointment.id }),
    request: nextRequest,
  };
}

export function reminderMethod(request: OnlineRequest | undefined, customer: Customer | undefined): ContactMethod {
  if (request) return request.contactMethod;
  if (customer?.mobile.trim() || customer?.phone.trim()) return "text";
  if (customer?.email.trim()) return "email";
  return "call";
}

export function tomorrowIso(at = new Date()): string {
  return addDays(todayIso(at), 1);
}

function linkParty(input: {
  request: OnlineRequest;
  customers: Customer[];
  vehicles: Vehicle[];
  linkCustomerId?: string;
  ids: { customerId: string; vehicleId: string };
}): { ok: false; reason: "customer" | "vehicle" } | {
  customerId: string;
  vehicleId: string;
  vin: string;
  newCustomer: Customer | null;
  newVehicle: Vehicle | null;
} {
  const request = input.request;
  if (request.verified && request.customerId && request.vehicleId) {
    const customer = input.customers.find((row) => row.id === request.customerId);
    const vehicle = input.vehicles.find((row) => row.id === request.vehicleId && row.customerId === request.customerId);
    if (!customer || !vehicle) return { ok: false, reason: "vehicle" };
    return { customerId: customer.id, vehicleId: vehicle.id, vin: vehicle.vin, newCustomer: null, newVehicle: null };
  }

  const chosen = input.linkCustomerId === undefined
    ? matchRequestCustomer(input.customers, input.vehicles, request)?.customerId
    : input.linkCustomerId;
  if (!chosen) return freshParty(input);
  const customer = input.customers.find((row) => row.id === chosen);
  if (!customer) return { ok: false, reason: "customer" };
  const existing = input.vehicles.find((row) => row.id === request.vehicleId && row.customerId === customer.id)
    ?? vehicleByVin(customer.id, input.vehicles, request.vin);
  if (existing) return { customerId: customer.id, vehicleId: existing.id, vin: existing.vin, newCustomer: null, newVehicle: null };
  const vehicle = vehicleFromRequest(input.ids.vehicleId, customer.id, request);
  return { customerId: customer.id, vehicleId: vehicle.id, vin: vehicle.vin, newCustomer: null, newVehicle: vehicle };
}

function freshParty(input: {
  request: OnlineRequest;
  ids: { customerId: string; vehicleId: string };
}): {
  customerId: string;
  vehicleId: string;
  vin: string;
  newCustomer: Customer;
  newVehicle: Vehicle;
} {
  const request = input.request;
  const customer: Customer = {
    id: input.ids.customerId,
    name: request.customerName,
    phone: request.phone,
    mobile: request.contactMethod === "text" ? request.phone : "",
    email: request.email,
    noShows: 0,
  };
  const vehicle = vehicleFromRequest(input.ids.vehicleId, customer.id, request);
  return { customerId: customer.id, vehicleId: vehicle.id, vin: vehicle.vin, newCustomer: customer, newVehicle: vehicle };
}

function vehicleFromRequest(id: string, customerId: string, request: OnlineRequest): Vehicle {
  const make = request.make?.trim() || "Ford";
  let model = request.model?.trim() || "Vehicle";
  if (model.toLowerCase().startsWith(`${make.toLowerCase()} `)) model = model.slice(make.length).trim() || "Vehicle";
  return { id, customerId, year: request.year || 2020, make, model, vin: request.vin };
}

function vehicleByVin(customerId: string, vehicles: Vehicle[], vin: string): Vehicle | undefined {
  const key = vin.toUpperCase().replace(/[^A-HJ-NPR-Z0-9]/g, "");
  if (key.length < 8) return undefined;
  const last8 = key.slice(-8);
  return vehicles.find((vehicle) => vehicle.customerId === customerId && (vehicle.vin.toUpperCase() === key || vehicle.vin.toUpperCase().slice(-8) === last8));
}
