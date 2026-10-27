import { createFileRoute } from "@tanstack/react-router";
import { OnlineRequestList } from "@/components/online-request-list";
import { Shell } from "@/components/shell";
import { useShop } from "@/lib/store";

export const Route = createFileRoute("/online-requests")({ component: OnlineRequestsPage });

function OnlineRequestsPage() {
  const storeName = useShop((state) => state.settings.storeName);
  const requests = useShop((state) => state.onlineRequests);
  const pending = requests.filter((row) => row.status === "pending");
  return (
    <Shell>
      <p className="text-sm font-semibold uppercase tracking-wide text-muted">Waiting on the shop</p>
      <h1 className="mt-1 font-display text-5xl leading-none tracking-tight">Online requests</h1>
      <p className="mt-3 max-w-2xl text-muted">
        These are requests for {storeName}, not confirmed appointments. Each one holds its time against technician hours and advisor capacity. This list is the open store only.
      </p>
      <OnlineRequestList rows={pending} />
    </Shell>
  );
}
