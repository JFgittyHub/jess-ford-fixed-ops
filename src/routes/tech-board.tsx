import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState, type FormEvent } from "react";
import { Shell } from "@/components/shell";
import { Button, Field } from "@/components/ui";
import { BAY_LABEL, STATUS_LABEL, TODAY, clockTime, formatDuration, punchHours } from "@/lib/format";
import { lookups } from "@/lib/metrics";
import { useShop } from "@/lib/store";
import { useSession, writeSession } from "@/lib/session";
import type { BayStatus, RepairOrder, RoStatus, TimeLog } from "@/lib/types";

export const Route = createFileRoute("/tech-board")({ component: TechBoardPage });

function useNow() {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 15000);
    return () => window.clearInterval(id);
  }, []);
  return now;
}

function assignedOpen(techId: string, orders: RepairOrder[]) {
  return orders.filter((order) => order.status !== "invoiced" && order.labor.some((line) => line.techId === techId));
}

function loggedHours(logs: TimeLog[], techId: string, orderId: string | null, now: number) {
  return logs
    .filter((row) => row.techId === techId && (orderId === null || row.orderId === orderId))
    .reduce((sum, row) => sum + punchHours(row.startedAt, row.endedAt, now), 0);
}

const SESSION_KEY = "jess-ford-tech-session";

function TechBoardPage() {
  const shop = useShop();
  const { session } = useSession();
  const look = lookups(shop);
  const now = useNow();
  const [techId, setTechId] = useState("");
  const [ready, setReady] = useState(false);
  const [number, setNumber] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const tech = shop.techs.find((row) => row.id === (session?.role === "tech" ? session.id : techId));

  useEffect(() => {
    setTechId(sessionStorage.getItem(SESSION_KEY) ?? "");
    setReady(true);
  }, []);

  function login(event: FormEvent) {
    event.preventDefault();
    const match = shop.techs.find((row) => row.number.trim().toLowerCase() === number.trim().toLowerCase());
    if (!match || !password || password !== match.password) {
      setError("Tech number or password is wrong.");
      return;
    }
    sessionStorage.setItem(SESSION_KEY, match.id);
    setTechId(match.id);
    setPassword("");
    setError("");
  }

  function logout() {
    sessionStorage.removeItem(SESSION_KEY);
    setTechId("");
    setNumber("");
    setPassword("");
  }

  if (!ready && session?.role !== "tech") {
    return (
      <Shell>
        <h1 className="font-display text-5xl leading-none">Tech board</h1>
      </Shell>
    );
  }

  if (!tech) {
    if (session?.role === "tech") {
      return (
        <Shell>
          <h1 className="font-display text-5xl leading-none">Tech board</h1>
          <p className="mt-3 text-muted">This technician is not on the roster.</p>
        </Shell>
      );
    }
    return (
      <Shell>
        <p className="text-sm font-semibold uppercase tracking-wide text-muted">Technicians</p>
        <h1 className="mt-1 font-display text-5xl leading-none tracking-tight">Tech board</h1>
        <p className="mt-3 max-w-xl text-muted">Sign in with your tech number and password. You only see the repair orders assigned to you.</p>
        <form className="card mt-5 grid max-w-md gap-3" onSubmit={login}>
          <Field label="Tech number">
            <input className="field tabular-nums" value={number} onChange={(event) => setNumber(event.target.value)} autoComplete="username" />
          </Field>
          <Field label="Password">
            <input className="field" type="password" value={password} onChange={(event) => setPassword(event.target.value)} autoComplete="current-password" />
          </Field>
          {error ? <p className="text-sm text-primary">{error}</p> : null}
          <div>
            <Button tone="primary" type="submit">Sign in</Button>
          </div>
          <p className="text-sm text-muted">Until the password is changed on the roster, the demo password is the tech number.</p>
        </form>
      </Shell>
    );
  }

  const jobs = assignedOpen(tech.id, shop.orders);
  const open = shop.timeLogs.find((row) => row.techId === tech.id && row.endedAt === null) ?? null;
  const current = open ? shop.orders.find((order) => order.id === open.orderId) : undefined;
  const todayLogs = shop.timeLogs.filter((row) => row.techId === tech.id && (row.startedAt.startsWith(TODAY) || row.endedAt === null));
  const today = loggedHours(todayLogs, tech.id, null, now);
  const flagged = jobs.reduce((sum, order) => sum + order.labor.filter((line) => line.techId === tech.id).reduce((hours, line) => hours + line.hours, 0), 0);
  const ordered = [...jobs].sort((a, b) => (a.id === open?.orderId ? -1 : b.id === open?.orderId ? 1 : a.promiseTime.localeCompare(b.promiseTime)));

  return (
    <Shell>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-sm font-semibold uppercase tracking-wide text-muted">Tech {tech.number}</p>
          <h1 className="mt-1 font-display text-5xl leading-none tracking-tight">{tech.name}</h1>
          <p className="mt-3 max-w-2xl text-muted">These are the open repair orders assigned to you. Clock onto one at a time.</p>
        </div>
        <Button onClick={() => (session?.role === "tech" ? writeSession(null) : logout())}>Sign out</Button>
      </div>

      <div className="mt-4 grid gap-3 sm:grid-cols-3">
        <article className="card">
          <p className="text-sm text-muted">Status</p>
          <p className="mt-1 font-display text-3xl leading-none">{open ? "On the clock" : "Off the clock"}</p>
          <p className="mt-2 text-sm text-muted">{current ? `RO ${current.number}` : "No repair order punched"}</p>
        </article>
        <article className="card">
          <p className="text-sm text-muted">Clocked today</p>
          <p className="mt-1 font-display text-3xl leading-none tabular-nums">{formatDuration(today)}</p>
          <p className="mt-2 text-sm text-muted">{open ? `${formatDuration(punchHours(open.startedAt, null, now))} on this punch` : "Not punched in"}</p>
        </article>
        <article className="card">
          <p className="text-sm text-muted">Flagged on open work</p>
          <p className="mt-1 font-display text-3xl leading-none tabular-nums">{flagged.toFixed(1)} hrs</p>
          <p className="mt-2 text-sm text-muted">{jobs.length} assigned repair {jobs.length === 1 ? "order" : "orders"}</p>
        </article>
      </div>

      <h2 className="mt-8 font-display text-3xl leading-none">Assigned repair orders</h2>
      {ordered.length === 0 ? <p className="mt-3 text-muted">Nothing open is assigned to {tech.name}.</p> : null}
      <div className="mt-3 grid gap-3">
        {ordered.map((order) => {
          const customer = look.customer.get(order.customerId);
          const vehicle = look.vehicle.get(order.vehicleId);
          const lines = order.labor.filter((line) => line.techId === tech.id);
          const onThis = open?.orderId === order.id;
          const hours = loggedHours(shop.timeLogs, tech.id, order.id, now);
          return (
            <article key={order.id} className={onThis ? "card border-2 border-primary" : "card"}>
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <p className="font-display text-3xl leading-none">RO {order.number}</p>
                  <p className="mt-2 font-semibold">{customer?.name ?? "Customer"} · {vehicle ? `${vehicle.year} ${vehicle.model}` : "Vehicle"}</p>
                  <p className="text-sm text-muted">{STATUS_LABEL[order.status as RoStatus]} · {BAY_LABEL[(order.bay ?? "dispatch") as BayStatus]}{order.promiseTime ? ` · Promise ${clockTime(order.promiseTime)}` : ""}</p>
                </div>
                <div className="text-right">
                  <p className="tabular-nums font-semibold">{formatDuration(hours)} logged</p>
                  <p className="text-sm text-muted">{lines.reduce((sum, line) => sum + line.hours, 0).toFixed(1)} flagged hrs</p>
                </div>
              </div>
              <ul className="mt-3 grid gap-1 text-sm">
                {lines.map((line) => <li key={line.id}>{line.opcode} · {line.description}</li>)}
              </ul>
              <p className="mt-2 text-sm">{order.concern}</p>
              <div className="mt-4 flex flex-wrap gap-2">
                {onThis ? (
                  <Button onClick={() => shop.clockOut(tech.id)}>Clock out</Button>
                ) : (
                  <Button tone="primary" onClick={() => shop.clockIn(tech.id, order.id)}>{open ? "Move clock here" : "Clock in"}</Button>
                )}
              </div>
            </article>
          );
        })}
      </div>
    </Shell>
  );
}
