import type { ReactElement } from "react";
import { ComingLater, Shell } from "@/components/shell";
import { sectionLockEnabled } from "@/lib/section-lock";

/** Runs before a locked screen loads. The wrapped component is what keeps the screen off. */
export function lockedBeforeLoad() {
  sectionLockEnabled();
}

export function guardLocked(Page: () => ReactElement) {
  return function LockedSection() {
    if (sectionLockEnabled()) {
      return (
        <Shell>
          <ComingLater />
        </Shell>
      );
    }
    return <Page />;
  };
}
