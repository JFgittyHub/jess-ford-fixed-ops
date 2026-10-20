/**
 * Outbound texts sit behind this adapter. The default is off and delivers
 * nothing: no carrier, no simulated send. A later online check will ask this
 * adapter to carry a one-time code, and will show that code on screen only
 * when a demo adapter is switched on. That flow is not built yet.
 *
 * The later check also needs an expiry, a small attempt cap, and must not
 * reveal whether a lookup matched before the code step. Those rules belong
 * to that flow, not to this adapter.
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
