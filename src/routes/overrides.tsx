import { createFileRoute } from "@tanstack/react-router";
import { OverrideLog } from "@/components/override-log";
import { Shell } from "@/components/shell";
import { useShop } from "@/lib/store";

export const Route = createFileRoute("/overrides")({ component: OverridesPage });

function OverridesPage() {
  const storeName = useShop((state) => state.settings.storeName);
  const overrides = useShop((state) => state.overrides);
  return (
    <Shell>
      <p className="text-sm font-semibold uppercase tracking-wide text-muted">Manager review</p>
      <h1 className="mt-1 font-display text-5xl leading-none tracking-tight">Override log</h1>
      <p className="mt-3 max-w-2xl text-muted">
        When an advisor books past a capacity warning, the desk records who did it and when. This list is {storeName} only. Who is the name chosen in Working as. There is no password.
      </p>
      <OverrideLog rows={overrides} />
    </Shell>
  );
}
