import { createFileRoute, redirect } from "@tanstack/react-router";
import { SchedulePage } from "./schedule";

export const Route = createFileRoute("/online-requests")({
  beforeLoad: () => {
    throw redirect({ to: "/schedule", hash: "online-requests", replace: true });
  },
  component: OnlineRequestsPage,
});

/** Staff desk for this URL is the appointments calendar, with the requests panel open. */
function OnlineRequestsPage() {
  return <SchedulePage openRequests />;
}
