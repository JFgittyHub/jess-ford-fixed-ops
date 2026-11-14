import { useRef, useState } from "react";
import { advisorBookingNote, assessAppointment, PAST_CLOSE_MESSAGE, PAST_CLOSE_REASON, visitRunsPastClose, visitTimeError } from "./capacity";
import { deskActor } from "./cancel";
import { bookingDateMessage } from "./store";
import type { Appointment } from "./types";

/** Fields Copy keeps. The slot supplies the day, the start, and the technician. */
export type CopiedAppointment = Pick<Appointment, "customerId" | "vehicleId" | "vin" | "concern" | "lines" | "minutes" | "lane" | "advisorId" | "laborOpIds">;

export function copiedFrom(row: Appointment): CopiedAppointment {
  return {
    customerId: row.customerId,
    vehicleId: row.vehicleId,
    vin: row.vin,
    concern: row.concern,
    lines: row.lines.map((line) => ({ id: "", code: line.code, concern: line.concern })),
    minutes: row.minutes,
    lane: row.lane,
    advisorId: row.advisorId,
    laborOpIds: [...(row.laborOpIds ?? [])],
  };
}

export function pasteAppointmentInput(copy: CopiedAppointment, slot: { date: string; time: string; techId: string; advisorId?: string }): Omit<Appointment, "id" | "orderId"> {
  return {
    ...copy,
    lines: copy.lines.map((line) => ({ ...line })),
    laborOpIds: [...(copy.laborOpIds ?? [])],
    date: slot.date,
    time: slot.time,
    techId: slot.techId,
    advisorId: slot.advisorId ?? copy.advisorId,
    status: "scheduled",
  };
}

/** Right-click or press-and-hold opens Book only on an open day at this store. */
export function slotOpensBook(input: {
  actor: string;
  day: string;
  scheduling: Parameters<typeof bookingDateMessage>[1];
  userStoreId?: string;
  activeStoreId?: string;
}): { ok: true } | { ok: false; error: string } {
  if (input.actor !== "advisor" && input.actor !== "service-manager") {
    return { ok: false, error: input.actor === "technician" ? "Techs can view only." : "Choose who is working to book or change anything." };
  }
  if (input.userStoreId && input.activeStoreId && input.userStoreId !== input.activeStoreId) {
    return { ok: false, error: "Book on your own store. Each store keeps its own schedule." };
  }
  const dateError = bookingDateMessage(input.day, input.scheduling);
  if (dateError) return { ok: false, error: dateError };
  return { ok: true };
}

/** Day, store, and the slot's own clock. A miss opens neither Book nor Paste. */
export function slotGestureError(input: {
  actor: string;
  day: string;
  time: string;
  scheduling: Parameters<typeof visitTimeError>[0];
  userStoreId?: string;
  activeStoreId?: string;
}): string | null {
  const dayDecision = slotOpensBook(input);
  if (!dayDecision.ok) return dayDecision.error;
  return visitTimeError(input.scheduling, input.day, input.time);
}

/** The pasted visit belongs to whoever is Working as, when that person is an advisor on this store. */
export function pasterAdvisorId(state: { workingAsId: string; advisors: { id: string }[] }): string | null {
  if (!state.workingAsId) return null;
  return state.advisors.some((row) => row.id === state.workingAsId) ? state.workingAsId : null;
}

/** Copy is tied to the person, their role, and the store they are viewing. Any change drops it. */
export function copyWorkerKey(state: {
  userStoreId?: string;
  activeStoreId?: string;
  workingAsId: string;
  advisors?: { id: string; role?: string }[];
  techs?: { id: string }[];
  serviceManagers?: { id: string; active?: boolean }[];
}): string {
  const role = state.advisors || state.serviceManagers || state.techs
    ? deskActor({
        workingAsId: state.workingAsId,
        advisors: state.advisors ?? [],
        techs: state.techs ?? [],
        serviceManagers: state.serviceManagers,
      })
    : "";
  return `${state.userStoreId ?? ""}|${state.activeStoreId ?? ""}|${state.workingAsId}|${role}`;
}

/** Drop a copied card during render when the person, role, or store changes, so the old line never paints. */
export function useForgetCopy(workerKey: string, clear: () => void) {
  const clearRef = useRef(clear);
  clearRef.current = clear;
  const [seen, setSeen] = useState(workerKey);
  if (seen !== workerKey) {
    setSeen(workerKey);
    clearRef.current();
  }
}

type PasteStore = {
  getState: () => {
    settings: { scheduling: Parameters<typeof visitRunsPastClose>[0] };
    appointments: Appointment[];
    advisors: { id: string; role?: string }[];
    techs: { id: string }[];
    serviceManagers?: { id: string }[];
    laborOps: { id: string; hours: number }[];
    workingAsId: string;
    userStoreId?: string;
    activeStoreId?: string;
    saveAdvisorAppointment: (
      input: Omit<Appointment, "id" | "orderId">,
      existingId?: string,
      confirmTransfer?: boolean,
      transferReason?: string,
      closeReason?: string,
    ) => { ok: boolean; appointmentId: string; overrideId: string | null; error: string | null; warning?: string | null; needsCloseReason?: boolean };
  };
};

export type PasteResult = {
  ok: boolean;
  error: string | null;
  warning?: string | null;
  needsOverride?: boolean;
  needsCloseReason?: boolean;
  appointmentId: string;
  overrideId: string | null;
};

/**
 * Paste uses the Book save. Capacity and a missing past-close reason stop before that
 * save so cancelling writes nothing. The same vehicle stays on the same customer.
 */
export function commitPaste(
  store: PasteStore,
  input: Omit<Appointment, "id" | "orderId">,
  opts?: { confirmOverride?: boolean; closeReason?: string },
): PasteResult {
  const state = store.getState();
  if (state.userStoreId && state.activeStoreId && state.userStoreId !== state.activeStoreId) {
    return { ok: false, error: "Book on your own store. Each store keeps its own schedule.", appointmentId: "", overrideId: null };
  }
  const advisorId = pasterAdvisorId(state);
  if (!advisorId) {
    return { ok: false, error: "That advisor isn't on this store.", appointmentId: "", overrideId: null };
  }
  const booked = { ...input, advisorId };
  const pastClose = visitRunsPastClose(state.settings.scheduling, booked.date, booked.time, booked.minutes);
  if (pastClose && deskActor(state) !== "service-manager") {
    return { ok: false, error: PAST_CLOSE_MESSAGE, appointmentId: "", overrideId: null };
  }
  const reason = opts?.closeReason?.trim() ?? "";
  if (pastClose && !reason) {
    return { ok: false, error: PAST_CLOSE_REASON, needsCloseReason: true, appointmentId: "", overrideId: null };
  }
  const judged = assessAppointment({
    scheduling: state.settings.scheduling,
    advisors: state.advisors,
    techs: state.techs,
    appointments: state.appointments,
    laborOps: state.laborOps,
    proposal: {
      date: booked.date,
      time: booked.time,
      minutes: booked.minutes,
      advisorId: booked.advisorId,
      techId: booked.techId,
      laborOpIds: booked.laborOpIds ?? [],
    },
  });
  if (judged.blocked) return { ok: false, error: judged.blocked, appointmentId: "", overrideId: null };
  const warning = advisorBookingNote(judged);
  if (warning && !opts?.confirmOverride) {
    return { ok: false, error: null, warning, needsOverride: true, appointmentId: "", overrideId: null };
  }
  const saved = state.saveAdvisorAppointment(booked, undefined, undefined, undefined, pastClose ? reason : undefined);
  return { ...saved, warning: saved.warning ?? null };
}
