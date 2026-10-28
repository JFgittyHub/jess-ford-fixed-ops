import { createFileRoute } from "@tanstack/react-router";
import { NoticeLog } from "@/components/notice-log";
import { OnlineRequestList } from "@/components/online-request-list";
import { Shell } from "@/components/shell";
import { Button } from "@/components/ui";
import { matchRequestCustomer } from "@/lib/online-request";
import { useShop } from "@/lib/store";

export const Route = createFileRoute("/online-requests")({ component: OnlineRequestsPage });

function OnlineRequestsPage() {
  const shop = useShop();
  const simulateDayBeforeReminders = useShop((state) => state.simulateDayBeforeReminders);
  const approveOnlineRequest = useShop((state) => state.approveOnlineRequest);
  const declineOnlineRequest = useShop((state) => state.declineOnlineRequest);
  const pending = shop.onlineRequests.filter((row) => row.status === "pending");
  return (
    <Shell>
      <p className="text-sm font-semibold uppercase tracking-wide text-muted">Waiting on the shop</p>
      <h1 className="mt-1 font-display text-5xl leading-none tracking-tight">Online requests</h1>
      <p className="mt-3 max-w-2xl text-muted">
        Pending requests for this store hold their time. Approve turns one into an appointment. Decline frees the time. This list is the open store only.
      </p>
      <OnlineRequestList
        rows={pending}
        customers={shop.customers}
        suggested={(row) => matchRequestCustomer(shop.customers, shop.vehicles, row)?.customerId ?? ""}
        onApprove={(id, linkCustomerId) => approveOnlineRequest(id, linkCustomerId)}
        onDecline={(id) => declineOnlineRequest(id)}
      />

      <div className="mt-8 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="font-display text-3xl leading-none">Notices</h2>
          <p className="mt-2 max-w-xl text-sm text-muted">
            Approval, decline, and the day-before reminder are simulated here. The texting adapter is off, so nothing leaves this desk.
          </p>
        </div>
        <Button onClick={() => simulateDayBeforeReminders()}>Simulate day-before reminders</Button>
      </div>
      <NoticeLog rows={shop.notices} />
    </Shell>
  );
}
