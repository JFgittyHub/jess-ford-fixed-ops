import { createFileRoute, useRouter } from "@tanstack/react-router";
import { useEffect } from "react";
import { SchedulePage } from "./schedule";

export const Route = createFileRoute("/online-requests")({ component: OnlineRequestsPage });

/** Staff desk for this URL is the appointments calendar, with the requests panel open. */
function OnlineRequestsPage() {
  const router = useRouter();
  useEffect(() => {
    void router.navigate({ to: "/schedule", hash: "online-requests", replace: true });
  }, [router]);
  return <SchedulePage openRequests />;
}
