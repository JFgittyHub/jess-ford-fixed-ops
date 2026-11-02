import { createFileRoute, Link } from "@tanstack/react-router";
import { CapacitySettings } from "@/components/capacity-settings";
import { Shell } from "@/components/shell";
import { useShop } from "@/lib/store";

export const Route = createFileRoute("/capacity")({ component: CapacityPage });

function CapacityPage() {
  const storeName = useShop((state) => state.settings.storeName);
  return (
    <Shell>
      <p className="text-sm font-semibold uppercase tracking-wide text-muted">Appointments</p>
      <h1 className="mt-1 font-display text-5xl leading-none tracking-tight">Capacity</h1>
      <p className="mt-3 max-w-2xl text-muted">
        {storeName}. Service managers can change these settings. Advisors and technicians can look.
        The numbers stay with this store.
      </p>
      <div className="mt-4">
        <Link to="/schedule" className="btn btn-ghost btn-small">
          Back to appointments
        </Link>
      </div>
      <div className="card mt-4">
        <CapacitySettings />
      </div>
    </Shell>
  );
}
