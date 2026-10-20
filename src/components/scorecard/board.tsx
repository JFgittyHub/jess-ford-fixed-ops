import { useEffect, useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { cn } from "@/lib/cn";
import { shopTodayDate } from "@/lib/clock";
import { isDemoMode } from "@/lib/demo";
import { SCORECARD_STORAGE_KEY, scrubDemoStorage } from "@/lib/shop-storage";
import { PULLMAN_SAMPLE_MONTHS, SAMPLE_MONTHS, sampleFor } from "@/lib/scorecard/sample";
import {
  ELR_STANDARD,
  PARTS_GP_STANDARD,
  SERVICE_GP_STANDARD,
  attentionItems,
  availableHours,
  countsTowardShopEff,
  effStatus,
  emptyBoard,
  formatHours,
  formatMoney,
  formatPct,
  monthKey,
  monthLabel,
  paceFor,
  yearToDate,
  partsRows,
  serviceRows,
  shiftMonth,
  statusLabel,
  tally,
  techEff,
  MIN_MONTH,
  type AppState,
  type MetricRow,
  type MonthBoard,
  type Pace,
  type Status,
  type StoreId,
  type Tech,
  type YearTotals,
} from "@/lib/scorecard/model";
import { Button, Field } from "@/components/ui";
import { useShop } from "@/lib/store";

const STORAGE_KEY = SCORECARD_STORAGE_KEY;

function seed(source: Record<string, MonthBoard>): Record<string, MonthBoard> {
  return Object.fromEntries(Object.entries(source).map(([key, board]) => [key, structuredClone(board)]));
}

function withPullmanSamples(months: Record<string, MonthBoard>, demo: boolean): Record<string, MonthBoard> {
  if (!demo) return months;
  const next = { ...months };
  for (const [key, board] of Object.entries(PULLMAN_SAMPLE_MONTHS)) {
    if (!next[key]?.recorded) next[key] = structuredClone(board);
  }
  return next;
}

function buildInitial(demo: boolean): AppState {
  const todayKey = monthKey(shopTodayDate());
  if (!demo) {
    return {
      activeStore: "grand-coulee",
      activeMonth: todayKey,
      stores: {
        "grand-coulee": { [todayKey]: emptyBoard(todayKey) },
        pullman: withPullmanSamples({ [todayKey]: emptyBoard(todayKey, 1800) }, false),
      },
    };
  }
  const coulee = seed(SAMPLE_MONTHS);
  if (!coulee[todayKey]) coulee[todayKey] = emptyBoard(todayKey);
  const seeded = Object.keys(SAMPLE_MONTHS).filter((key) => key <= todayKey).sort();
  return {
    activeStore: "grand-coulee",
    activeMonth: coulee[todayKey]?.recorded ? todayKey : (seeded.at(-1) ?? todayKey),
    stores: { "grand-coulee": coulee, pullman: withPullmanSamples({}, true) },
  };
}

function readStored(): AppState | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as AppState;
    if (!parsed?.stores?.["grand-coulee"] || !parsed.stores.pullman || typeof parsed.activeMonth !== "string") return null;
    const activeStore: StoreId = parsed.activeStore === "pullman" ? "pullman" : "grand-coulee";
    return { ...parsed, activeStore, stores: { ...parsed.stores, pullman: withPullmanSamples(parsed.stores.pullman, isDemoMode()) } };
  } catch {
    return null;
  }
}

function toneText(status: Status) {
  if (status === "good") return "text-accent";
  if (status === "watch") return "text-[#8a5a00]";
  if (status === "bad") return "text-[#8f1d1d]";
  return "text-muted";
}

function toneBar(status: Status) {
  if (status === "good") return "bg-accent";
  if (status === "watch") return "bg-[#c49212]";
  if (status === "bad") return "bg-[#b42318]";
  return "bg-line";
}

function tonePill(status: Status) {
  if (status === "good") return "bg-accent-soft text-accent";
  if (status === "watch") return "bg-[#f8efd4] text-[#8a5a00]";
  if (status === "bad") return "bg-[#f8e4e2] text-[#8f1d1d]";
  return "bg-surface text-muted";
}

export function ScorecardPulse() {
  useShop((shop) => shop.activeStoreId);
  useShop((shop) => shop.dataset);
  const storeId = useShop.getState().activeStoreId;
  const demo = isDemoMode() || useShop.getState().dataset === "sample";
  const [state, setState] = useState<AppState>(() => buildInitial(demo));
  const [ready, setReady] = useState(false);
  const [editing, setEditing] = useState(false);

  useEffect(() => {
    if (isDemoMode()) {
      try {
        scrubDemoStorage(window.localStorage);
      } catch {
        /* storage unavailable */
      }
      setReady(true);
      return;
    }
    const stored = readStored();
    if (stored) setState(stored);
    setReady(true);
  }, []);

  useEffect(() => {
    if (!ready || isDemoMode()) return;
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch {
      /* storage unavailable */
    }
  }, [state, ready]);

  const today = shopTodayDate();
  const todayKey = monthKey(today);
  const board = state.stores[storeId][state.activeMonth] ?? emptyBoard(state.activeMonth, storeId === "pullman" ? 1800 : 900);
  const pace = paceFor(board, today);
  const service = serviceRows(board);
  const parts = partsRows(board);
  const health = tally([...service, ...parts]);
  const attention = attentionItems(board, today);
  const fordIds = ["uptime", "cvp", "warranty", "ford"];
  const ford = fordIds.flatMap((id) => {
    const row = service.find((item) => item.id === id);
    return row ? [row] : [];
  });
  const serviceLines = service.filter((row) => !fordIds.includes(row.id));
  const ytd = yearToDate(yearBoards(state, state.activeMonth, storeId), state.activeMonth);
  const asOf = today.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" });

  function replaceBoard(next: MonthBoard) {
    setState((prev) => ({
      ...prev,
      activeStore: storeId,
      stores: { ...prev.stores, [storeId]: { ...prev.stores[storeId], [prev.activeMonth]: { ...next, month: prev.activeMonth, recorded: true } } },
    }));
  }

  function go(delta: number) {
    setState((prev) => {
      const nextKey = shiftMonth(prev.activeMonth, delta);
      if (nextKey < MIN_MONTH || nextKey > todayKey) return prev;
      const months = { ...prev.stores[storeId] };
      if (!months[nextKey]) months[nextKey] = emptyBoard(nextKey, storeId === "pullman" ? 1800 : 900);
      return { ...prev, activeStore: storeId, activeMonth: nextKey, stores: { ...prev.stores, [storeId]: months } };
    });
  }

  return (
    <>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-sm font-semibold uppercase tracking-wide text-muted">Pulse</p>
          <h1 className="mt-1 font-display text-5xl leading-none tracking-tight">Fixed Ops Pulse</h1>
          <p className="mt-2 max-w-xl text-muted">
            As of {asOf}. {storeId === "pullman" ? (demo ? "Pullman. Sample numbers until the feed is connected." : "Pullman. Hand entry for now.") : "Grand Coulee. Hand entry for now."}
          </p>
        </div>
        <Button
          small
          tone={editing ? "primary" : "ghost"}
          onClick={() => setEditing((value) => !value)}
        >
          Operating metrics
        </Button>
      </div>

      <div className="mt-4 flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center rounded-md border border-line bg-surface-2">
          <button type="button" className="flex size-9 items-center justify-center disabled:opacity-40" aria-label="Previous month" disabled={state.activeMonth <= MIN_MONTH} onClick={() => go(-1)}>
            <ChevronLeft className="size-5" />
          </button>
          <p className="min-w-36 text-center text-sm font-semibold tabular-nums">{monthLabel(state.activeMonth)}</p>
          <button type="button" className="flex size-9 items-center justify-center disabled:opacity-40" aria-label="Next month" disabled={state.activeMonth >= todayKey} onClick={() => go(1)}>
            <ChevronRight className="size-5" />
          </button>
        </div>
      </div>

      <div className="mt-4">
        {editing ? (
          <Editor
            board={board}
            onChange={replaceBoard}
            onClose={() => setEditing(false)}
            onRestore={() => {
              const sample = sampleFor(state.activeMonth, storeId);
              if (sample) replaceBoard(sample);
            }}
          />
        ) : (
          <Board board={board} pace={pace} ytd={ytd} service={serviceLines} parts={parts} ford={ford} health={health} attention={attention} today={today} />
        )}
      </div>
    </>
  );
}

function yearBoards(state: AppState, through: string, storeId: StoreId): MonthBoard[] {
  const year = through.slice(0, 4);
  return Object.keys(state.stores[storeId])
    .filter((key) => key.startsWith(`${year}-`) && key <= through)
    .sort()
    .map((key) => state.stores[storeId][key] ?? emptyBoard(key, storeId === "pullman" ? 1800 : 900));
}

function Board({ board, pace, ytd, service, parts, ford, health, attention, today }: { board: MonthBoard; pace: Pace; ytd: YearTotals; service: MetricRow[]; parts: MetricRow[]; ford: MetricRow[]; health: ReturnType<typeof tally>; attention: { id: string; status: "bad" | "watch"; text: string }[]; today: Date }) {
  const partsGp = board.parts.sales > 0 ? board.parts.gross / board.parts.sales : null;
  const available = board.recorded ? availableHours(board, pace) : null;
  const bar = available && pace.projected !== null ? Math.min(1, pace.projected / available) : board.recorded ? 0 : undefined;
  const shown = attention.slice(0, 4);
  const elrStatus: Status = !board.recorded || board.service.elr <= 0 ? "empty" : board.service.elr >= ELR_STANDARD ? "good" : board.service.elr >= 115 ? "watch" : "bad";
  const serviceGrossDetail = board.recorded && board.service.sales > 0 ? `${formatPct(board.service.gross / board.service.sales)} gross` : "Gross not in yet";
  const partsGrossDetail = partsGp === null || !board.recorded ? "Gross not in yet" : `${formatPct(partsGp)} gross`;
  const hoursDetail = pace.closed ? `Goal ${formatHours(board.hoursGoal)}` : `Projected of ${available ? formatHours(available) : "—"} available`;

  return (
    <div className="grid gap-3">
      <section className="grid grid-cols-2 gap-3 rounded-lg border-2 border-primary p-3 lg:grid-cols-4">
        <Kpi label="MTD sold hours" value={board.recorded ? formatHours(board.service.totalHours) : "—"} secondary={pace.projected === null ? "—" : formatHours(pace.projected)} status={pace.status} detail={hoursDetail} bar={bar} />
        <Kpi label="MTD effective labor rate" value={board.recorded && board.service.elr > 0 ? formatMoney(board.service.elr, 2) : "—"} status={elrStatus} detail={`Standard ${formatMoney(ELR_STANDARD, 2)}`} />
        <Kpi label="MTD service sales" value={board.recorded ? formatMoney(board.service.sales) : "—"} secondary={board.recorded ? formatMoney(board.service.gross) : "—"} secondaryLabel="Gross" status="empty" detail={serviceGrossDetail} standard={formatPct(SERVICE_GP_STANDARD, 0)} />
        <Kpi label="MTD parts sales" value={board.recorded ? formatMoney(board.parts.sales) : "—"} secondary={board.recorded ? formatMoney(board.parts.gross) : "—"} secondaryLabel="Gross" status="empty" detail={partsGrossDetail} standard={formatPct(PARTS_GP_STANDARD, 0)} />
      </section>
      <section className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Kpi label="YTD sold hours" value={ytd.recorded ? formatHours(ytd.hours) : "—"} status="empty" detail="Year to date" />
        <Kpi label="YTD effective labor rate" value={ytd.recorded && ytd.elr > 0 ? formatMoney(ytd.elr, 2) : "—"} status="empty" detail="Hours weighted" />
        <Kpi label="YTD service sales" value={ytd.recorded ? formatMoney(ytd.serviceSales) : "—"} secondary={ytd.recorded ? formatMoney(ytd.serviceGross) : "—"} secondaryLabel="Gross" status="empty" detail={ytd.recorded && ytd.serviceSales > 0 ? `${formatPct(ytd.serviceGross / ytd.serviceSales)} gross` : "Gross not in yet"} standard={formatPct(SERVICE_GP_STANDARD, 0)} />
        <Kpi label="YTD parts sales" value={ytd.recorded ? formatMoney(ytd.partsSales) : "—"} secondary={ytd.recorded ? formatMoney(ytd.partsGross) : "—"} secondaryLabel="Gross" status="empty" detail={ytd.recorded && ytd.partsSales > 0 ? `${formatPct(ytd.partsGross / ytd.partsSales)} gross` : "Gross not in yet"} standard={formatPct(PARTS_GP_STANDARD, 0)} />
      </section>
      <section className="card p-0">
        <div className="flex items-baseline justify-between gap-3 border-b border-line px-4 py-3">
          <h2 className="font-display text-3xl leading-none">Needs a look</h2>
          <p className="text-sm text-muted">{health.headline} · {health.good}/{health.scored || 0}</p>
        </div>
        {shown.length === 0 ? <p className="px-4 py-4 text-sm">Nothing on this month is off the standard.</p> : (
          <ul>
            {shown.map((item) => (
              <li key={item.id} className="flex gap-3 border-b border-line px-4 py-3 last:border-b-0">
                <StatusPill status={item.status} />
                <p className="text-sm">{item.text}</p>
              </li>
            ))}
          </ul>
        )}
      </section>
      <div className="grid gap-3 xl:grid-cols-2">
        <MetricTable id="service" title="Service" rows={service} />
        <MetricTable id="parts" title="Parts" rows={parts} />
      </div>
      <MetricTable id="ford-metrics" title="Ford metrics" rows={ford} />
      <section id="technicians">
        <h2 className="mb-3 font-display text-3xl leading-none">Technicians</h2>
        <div className="grid gap-3 xl:grid-cols-2">
          <TechPeriod title="1st–15th" techs={board.period1} />
          <TechPeriod title="16th–end of month" techs={board.period2} month={board.month} today={today} />
        </div>
      </section>
    </div>
  );
}

function Kpi({ label, value, secondary, secondaryLabel = "Projected", status, detail, standard, bar }: { label: string; value: string; secondary?: string; secondaryLabel?: string; status: Status; detail?: string; standard?: string; bar?: number }) {
  return (
    <article className="card flex flex-col">
      <p className="text-xs font-semibold uppercase tracking-wide text-muted">{label}</p>
      <div className="mt-2 flex items-end justify-between gap-3">
        <p className="font-display text-3xl leading-none tabular-nums">{value}</p>
        {secondary ? (
          <div className="text-right">
            <p className="text-[10px] font-semibold uppercase tracking-wide text-muted">{secondaryLabel}</p>
            <p className={cn("font-display text-xl leading-none tabular-nums", toneText(status))}>{secondary}</p>
          </div>
        ) : null}
      </div>
      {detail || standard ? (
        <div className="mt-2 flex items-end justify-between gap-3">
          {detail ? <p className="text-sm text-muted">{detail}</p> : <span />}
          {standard ? (
            <p className="text-right text-sm text-muted">
              <span className="block text-[10px] font-semibold uppercase tracking-wide">Standard</span>
              <span className="tabular-nums">{standard}</span>
            </p>
          ) : null}
        </div>
      ) : null}
      {bar !== undefined ? (
        <div className="mt-3 h-2 overflow-hidden rounded-full bg-surface">
          <div className={cn("h-full rounded-full", toneBar(status))} style={{ width: `${Math.round(bar * 100)}%` }} />
        </div>
      ) : null}
    </article>
  );
}

function StatusPill({ status }: { status: Status }) {
  return <span className={cn("inline-flex h-6 shrink-0 items-center rounded-md px-2 text-xs font-semibold", tonePill(status))}>{statusLabel(status)}</span>;
}

function MetricTable({ id, title, rows }: { id: string; title: string; rows: MetricRow[] }) {
  return (
    <section id={id} className="card p-0">
      <div className="border-b border-line px-4 py-3">
        <h2 className="font-display text-3xl leading-none">{title}</h2>
      </div>
      <ul>
        {rows.map((row) => (
          <li key={row.id} className="grid gap-1 border-t border-line px-4 py-3 sm:grid-cols-12 sm:items-center sm:gap-2">
            <p className="text-sm font-semibold sm:col-span-4">{row.label}</p>
            <p className="text-sm tabular-nums sm:col-span-2">{row.actual}</p>
            <p className="text-sm text-muted tabular-nums sm:col-span-2">{row.standard}</p>
            <p className={cn("text-sm tabular-nums sm:col-span-2", toneText(row.status))}>{row.variance}</p>
            <div className="sm:col-span-2 sm:text-right"><StatusPill status={row.status} /></div>
          </li>
        ))}
      </ul>
    </section>
  );
}

function TechPeriod({ title, techs, month, today }: { title: string; techs: Tech[]; month?: string; today?: Date }) {
  const hidden = title.startsWith("16") && month && today && month === monthKey(today) && today.getDate() < 16;
  return (
    <section className="card p-0">
      <h3 className="border-b border-line px-4 py-3 font-display text-2xl leading-none">{title}</h3>
      {hidden ? <p className="px-4 py-4 text-sm text-muted">Opens on the 16th.</p> : techs.length === 0 ? <p className="px-4 py-4 text-sm text-muted">No technicians entered.</p> : (
        <ul>
          {techs.map((tech) => {
            const counts = countsTowardShopEff(tech.skill);
            const eff = counts ? techEff(tech) : null;
            const status = counts ? effStatus(eff) : "empty";
            return (
              <li key={tech.id} className="flex items-center justify-between gap-3 border-t border-line px-4 py-3">
                <div>
                  <p className="text-sm font-semibold">{tech.name}</p>
                  <p className="text-sm text-muted">{tech.skill} · {formatHours(tech.soldHours)} sold / {formatHours(tech.clockHours)} clock</p>
                </div>
                <div className="text-right">
                  <p className={cn("text-sm font-semibold tabular-nums", toneText(status))}>{eff === null ? "Excluded" : formatPct(eff, 0)}</p>
                  {tech.elr > 0 ? <p className="text-sm text-muted tabular-nums">{formatMoney(tech.elr, 0)} ELR</p> : null}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

function Editor({ board, onChange, onClose, onRestore }: { board: MonthBoard; onChange: (board: MonthBoard) => void; onClose: () => void; onRestore: () => void }) {
  function patchService(partial: Partial<MonthBoard["service"]>) {
    onChange({ ...board, recorded: true, service: { ...board.service, ...partial } });
  }
  function patchParts(partial: Partial<MonthBoard["parts"]>) {
    onChange({ ...board, recorded: true, parts: { ...board.parts, ...partial } });
  }
  const num = (label: string, value: number, onValue: (n: number) => void) => (
    <Field label={label}>
      <input className="field tabular-nums" type="number" value={value} onChange={(event) => onValue(Number(event.target.value))} />
    </Field>
  );
  return (
    <section className="card">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <h2 className="font-display text-3xl leading-none">Operating metrics</h2>
        <div className="flex gap-2">
          <Button small onClick={onRestore}>Restore sample</Button>
          <Button small tone="primary" onClick={onClose}>Done</Button>
        </div>
      </div>
      <div className="grid gap-3 sm:grid-cols-3">
        {num("Hours goal", board.hoursGoal, (hoursGoal) => onChange({ ...board, recorded: true, hoursGoal }))}
        {num("Sold hours", board.service.totalHours, (totalHours) => patchService({ totalHours }))}
        {num("ELR", board.service.elr, (elr) => patchService({ elr }))}
        {num("Service sales", board.service.sales, (sales) => patchService({ sales }))}
        {num("Service gross", board.service.gross, (gross) => patchService({ gross }))}
        {num("Service GP % (0.75 = 75%)", board.service.grossProfitPct, (grossProfitPct) => patchService({ grossProfitPct }))}
        {num("Parts sales", board.parts.sales, (sales) => patchParts({ sales }))}
        {num("Parts gross", board.parts.gross, (gross) => patchParts({ gross }))}
        {num("Hours / RO", board.service.hoursPerRo, (hoursPerRo) => patchService({ hoursPerRo }))}
        {num("Hours / maint RO", board.service.hoursPerMaintRo, (hoursPerMaintRo) => patchService({ hoursPerMaintRo }))}
        {num("ROs over 30", board.service.roOpenOver30, (roOpenOver30) => patchService({ roOpenOver30 }))}
        {num("Receivables over 90", board.service.arOver90, (arOver90) => patchService({ arOver90 }))}
        {num("Uptime Assist (0.70 = 70%)", board.service.uptimeAssist, (uptimeAssist) => patchService({ uptimeAssist }))}
        {num("Warranty dashboard", board.service.warrantyDashboard, (warrantyDashboard) => patchService({ warrantyDashboard }))}
        {num("Absorption (1 = 100%)", board.service.absorption, (absorption) => patchService({ absorption }))}
        {num("Parts inventory", board.parts.inventory, (inventory) => patchParts({ inventory }))}
        {num("Aged over 3 months", board.parts.agedOver3, (agedOver3) => patchParts({ agedOver3 }))}
        {num("Aged over 6 months", board.parts.agedOver6, (agedOver6) => patchParts({ agedOver6 }))}
        {num("Aged over 9 months", board.parts.agedOver9, (agedOver9) => patchParts({ agedOver9 }))}
        {num("Open parts invoices", board.parts.openInvoicesOver14, (openInvoicesOver14) => patchParts({ openInvoicesOver14 }))}
      </div>
      <p className="mt-3 text-sm text-muted">{board.period1.length + board.period2.length} technicians stay on the month. Restore sample to bring them back.</p>
    </section>
  );
}
