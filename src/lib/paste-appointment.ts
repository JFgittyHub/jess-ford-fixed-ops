import { advisorBookingNote, assessAppointment, PAST_CLOSE_MESSAGE, PAST_CLOSE_REASON, visitRunsPastClose } from "./capacity";
import { deskActor } from "./cancel";
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

export function pasteAppointmentInput(copy: CopiedAppointment, slot: { date: string; time: string; techId: string }): Omit<Appointment, "id" | "orderId"> {
  return {
    ...copy,
    lines: copy.lines.map((line) => ({ ...line })),
    laborOpIds: [...(copy.laborOpIds ?? [])],
    date: slot.date,
    time: slot.time,
    techId: slot.techId,
    status: "scheduled",
  };
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
  const pastClose = visitRunsPastClose(state.settings.scheduling, input.date, input.time, input.minutes);
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
      date: input.date,
      time: input.time,
      minutes: input.minutes,
      advisorId: input.advisorId,
      techId: input.techId,
      laborOpIds: input.laborOpIds ?? [],
    },
  });
  if (judged.blocked) return { ok: false, error: judged.blocked, appointmentId: "", overrideId: null };
  const warning = advisorBookingNote(judged);
  if (warning && !opts?.confirmOverride) {
    return { ok: false, error: null, warning, needsOverride: true, appointmentId: "", overrideId: null };
  }
  const saved = state.saveAdvisorAppointment(input, undefined, undefined, undefined, pastClose ? reason : undefined);
  return { ...saved, warning: saved.warning ?? null };
}
