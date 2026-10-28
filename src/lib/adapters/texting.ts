/**
 * Outbound texts sit behind this adapter. The default is off and delivers
 * nothing: no carrier, no simulated send.
 *
 * The online request screen shows a one-time code on screen in the demo and
 * does not call this adapter. Approval, decline, and day-before reminders are
 * recorded on the desk. This adapter stays off and does not deliver them.
 */

export type TextPurpose = "one-time-code" | "notice" | "reminder";

export interface OutboundText {
  to: string;
  body: string;
  purpose: TextPurpose;
}

export interface TextSendResult {
  delivered: false;
  reason: "adapter-off";
}

export interface TextingAdapter {
  readonly enabled: boolean;
  send(message: OutboundText): TextSendResult;
}

export function createTextingAdapter(): TextingAdapter {
  return {
    enabled: false,
    send() {
      return { delivered: false, reason: "adapter-off" };
    },
  };
}

/** The desk uses this instance. It stays off until a real adapter is installed. */
export const textingAdapter = createTextingAdapter();
