import { createFileRoute } from "@tanstack/react-router";
import { ScorecardPulse } from "@/components/scorecard/board";
import { Shell } from "@/components/shell";

export const Route = createFileRoute("/")({ component: PulsePage });

function PulsePage() {
  return (
    <Shell>
      <ScorecardPulse />
    </Shell>
  );
}
