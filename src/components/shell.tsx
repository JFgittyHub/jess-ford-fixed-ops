import { Link, useRouter, useRouterState } from "@tanstack/react-router";
import {
  ArrowLeft,
  CalendarClock,
  ClipboardList,
  FileText,
  ListChecks,
  ScrollText,
  Settings,
  Users,
  Wallet,
  UserRound,
  Wrench,
  Timer,
  Activity,
  BadgeDollarSign,
  Package,
  Receipt,
} from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { cn } from "@/lib/cn";
import { confirmedDemoStaffAccess, isDemoMode } from "@/lib/demo";
import { todayLabel } from "@/lib/format";
import { shopHasOperationalData, useShop } from "@/lib/store";
import { Button, Field, Modal } from "./ui";

const NAV = [
  { to: "/", label: "Pulse", icon: Activity },
  { to: "/schedule", label: "Appointments", icon: CalendarClock },
  { to: "/orders", label: "Repair orders", icon: ClipboardList },
  { to: "/estimates", label: "Repair estimates", icon: FileText },
  { to: "/dispatch", label: "Technicians", icon: Wrench },
  { to: "/tech-board", label: "Tech board", icon: Timer },
  { to: "/advisors", label: "Advisors", icon: UserRound },
  { to: "/parts", label: "Parts", icon: Package },
  { to: "/expenses", label: "Fixed costs", icon: Wallet },
  { to: "/customers", label: "Marketing", icon: Users },
  { to: "/reports", label: "Month close", icon: ScrollText },
  { to: "/labor-ops", label: "Labor Ops", icon: ListChecks, gear: true },
  { to: "/pay-types", label: "Pay Type", icon: BadgeDollarSign, gear: true },
  { to: "/fees", label: "Fees", icon: Receipt, gear: true },
] as const;

function NavLinks({ onNavigate }: { onNavigate?: () => void }) {
  const pathname = useRouterState({ select: (state) => state.location.pathname });
  const items = NAV;
  return (
    <>
      {items.map((item) => {
        const active = item.to === "/" ? pathname === "/" : pathname.startsWith(item.to);
        const Icon = item.icon;
        return (
          <Link key={item.to} to={item.to} onClick={onNavigate} className={cn("nav-link", active && "is-active")}>
            <Icon className="size-4 shrink-0" aria-hidden />
            <span className="min-w-0 flex-1 truncate">{item.label}</span>
            {"gear" in item && item.gear ? <Settings className="size-3.5 shrink-0" aria-hidden /> : null}
          </Link>
        );
      })}
    </>
  );
}

function tabLabel(path: string) {
  const item = NAV.find((row) => (row.to === "/" ? path === "/" : path.startsWith(row.to)));
  return item?.label ?? "Back";
}

export function Shell({ children }: { children: ReactNode }) {
  const storeName = useShop((state) => state.settings.storeName);
  const dataset = useShop((state) => state.dataset);
  const [hydrated, setHydrated] = useState(() => useShop.persist.hasHydrated());

  useEffect(() => {
    let live = true;
    void Promise.resolve(useShop.persist.rehydrate()).finally(() => {
      if (live) setHydrated(true);
    });
    return () => {
      live = false;
    };
  }, []);

  if (!hydrated || !confirmedDemoStaffAccess({ dataset })) return <DeskLocked storeName={storeName} />;
  return <OpenDesk>{children}</OpenDesk>;
}

function OpenDesk({ children }: { children: ReactNode }) {
  const settings = useShop((state) => state.settings);
  const updateSettings = useShop((state) => state.updateSettings);
  const resetDemo = useShop((state) => state.resetDemo);
  const clearShop = useShop((state) => state.clearShop);
  const [open, setOpen] = useState(false);
  const [confirmReset, setConfirmReset] = useState(false);
  const [confirmClear, setConfirmClear] = useState(false);
  const [scrolled, setScrolled] = useState(false);
  const pathname = useRouterState({ select: (state) => state.location.pathname });
  const router = useRouter();
  const realShop = useShop((state) => state.dataset !== "sample" && shopHasOperationalData(state));
  const historyRef = useRef<string[]>([]);
  const [backTo, setBackTo] = useState<string | null>(null);

  useEffect(() => {
    const stack = historyRef.current;
    if (stack[stack.length - 1] !== pathname) stack.push(pathname);
    if (stack.length > 24) stack.shift();
    setBackTo(stack.length > 1 ? stack[stack.length - 2] : null);
  }, [pathname]);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 160);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  function goBack() {
    const stack = historyRef.current;
    if (stack.length < 2) return;
    stack.pop();
    const previous = stack[stack.length - 1];
    setBackTo(stack.length > 1 ? stack[stack.length - 2] : null);
    void router.navigate({ to: previous });
  }

  return (
    <div className="min-h-screen bg-bg text-ink">
      <aside className="fixed inset-y-0 left-0 z-20 hidden w-60 flex-col overflow-y-auto border-r border-line bg-surface px-3 py-4 md:flex">
        <div className="px-1 pb-4">
          <img src="/jess-logo.avif" alt="Jess Ford, established 1991" className="h-auto w-full" />
          <p className="mt-2 px-1 text-sm text-muted">Fixed operations</p>
        </div>
        <nav className="flex flex-1 flex-col gap-1">
          <NavLinks />
        </nav>
        <p className="px-3 pt-4 text-xs leading-relaxed text-muted">
          Jess Ford. Not connected to OASIS, warranty submission, or a DMS.
        </p>
      </aside>
      <div className="md:pl-60">
        <header className="sticky top-0 z-30 border-b border-line bg-bg/95 backdrop-blur-sm">
          <div className="flex items-center justify-between gap-3 px-4 py-3 md:px-8">
            <div className="flex min-w-0 items-center gap-3">
              <img src="/jess-logo.avif" alt="Jess Ford, established 1991" className="h-14 w-auto md:hidden" />
              <div className="min-w-0">
                <p className="truncate text-sm font-semibold">{settings.storeName}</p>
                <p className="truncate text-xs text-muted">{settings.city} · {todayLabel()}</p>
              </div>
            </div>
            <Button tone="ghost" small onClick={() => { setConfirmReset(false); setConfirmClear(false); setOpen(true); }} aria-label="Store settings">
              <Settings className="size-4" aria-hidden />
              Settings
            </Button>
          </div>
          <nav className="nav-scroll px-3 pb-3 md:hidden">
            <NavLinks onNavigate={() => undefined} />
          </nav>
        </header>
        <main className="mx-auto w-full max-w-6xl px-4 py-5 md:px-8 md:py-7">{children}</main>
        <footer className="mx-auto w-full max-w-6xl px-4 pb-8 text-xs text-muted md:px-8">
          This visit is the sample month. Changes last until you reload, then the sample month is back. This demo is not saved in the browser. Settings can reload it, and will ask before replacing shop work. Rename a rooftop in Settings if you need one store on the header. This does not submit warranty, order parts from Ford, or replace the manufacturer pipe.
        </footer>
        {scrolled && backTo ? (
          <button type="button" className="btn btn-primary fixed bottom-5 left-4 z-40 shadow-card md:left-[16.5rem]" onClick={goBack}>
            <ArrowLeft className="size-4" aria-hidden />
            {tabLabel(backTo)}
          </button>
        ) : null}
      </div>
      <Modal open={open} onClose={() => setOpen(false)} title="Store settings" description="Name, city, and the targets on the pulse. Labor rates live on Pay Type.">
        <form
          className="grid gap-3 sm:grid-cols-2"
          onSubmit={(event) => {
            event.preventDefault();
            setOpen(false);
          }}
        >
          <Field label="Store name">
            <input className="field" value={settings.storeName} onChange={(event) => updateSettings({ storeName: event.target.value })} />
          </Field>
          <Field label="Street address">
            <input className="field" value={settings.address} onChange={(event) => updateSettings({ address: event.target.value })} />
          </Field>
          <Field label="Shop phone">
            <input className="field" value={settings.phone} onChange={(event) => updateSettings({ phone: event.target.value })} />
          </Field>
          <Field label="City">
            <input className="field" value={settings.city} onChange={(event) => updateSettings({ city: event.target.value })} />
          </Field>
          <Field label="Target effective labor rate">
            <input className="field tabular-nums" type="number" min={0} step={1} value={settings.targetElr} onChange={(event) => updateSettings({ targetElr: Number(event.target.value) || 0 })} />
          </Field>
          <Field label="Absorption target %">
            <input className="field tabular-nums" type="number" min={0} step={1} value={Math.round(settings.targetAbsorption * 100)} onChange={(event) => updateSettings({ targetAbsorption: (Number(event.target.value) || 0) / 100 })} />
          </Field>
          <Field label="Policy guide % of CP labor">
            <input className="field tabular-nums" type="number" min={0} step={0.1} value={Math.round(settings.policyGuide * 1000) / 10} onChange={(event) => updateSettings({ policyGuide: (Number(event.target.value) || 0) / 100 })} />
          </Field>
          <div className="flex flex-wrap gap-2 sm:col-span-2">
            <Button tone="primary" type="submit">Done</Button>
            {isDemoMode() ? (
              <Button
                tone={confirmReset ? "accent" : "ghost"}
                onClick={() => {
                  if (!confirmReset) {
                    setConfirmReset(true);
                    setConfirmClear(false);
                    return;
                  }
                  resetDemo(true);
                  setConfirmReset(false);
                  setOpen(false);
                }}
              >
                {confirmReset ? (realShop ? "Replace this shop with the sample month" : "Load sample month now") : "Load sample month"}
              </Button>
            ) : null}
            <Button
              tone={confirmClear ? "accent" : "ghost"}
              onClick={() => {
                if (!confirmClear) {
                  setConfirmClear(true);
                  setConfirmReset(false);
                  return;
                }
                clearShop();
                setConfirmClear(false);
                setOpen(false);
              }}
            >
              {confirmClear ? "Clear shop data now" : "Clear shop data"}
            </Button>
          </div>
        </form>
      </Modal>
    </div>
  );
}

function DeskLocked({ storeName }: { storeName: string }) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-bg px-4">
      <div className="w-full max-w-md text-center">
        <img src="/jess-logo.avif" alt="Jess Ford, established 1991" className="mx-auto h-auto w-56" />
        <h1 className="mt-4 font-display text-4xl leading-none">{storeName}</h1>
        <p className="mt-3 text-sm text-muted">Sign-in via Azure/Entra coming; demo mode only for now.</p>
      </div>
    </div>
  );
}
