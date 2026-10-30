import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Shell } from "@/components/shell";
import { Button, Field } from "@/components/ui";
import { BAY_LABEL, clockTime, formatDuration, punchHours, reviewCap, roStatusLabel, today as shopToday } from "@/lib/format";
import { lookups } from "@/lib/metrics";
import { useShop } from "@/lib/store";
import type { BayStatus, RepairOrder, TimeLog } from "@/lib/types";

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
  return orders.filter((order) => order.status !== "closed" && order.labor.some((line) => line.techId === techId));
}

function loggedHours(logs: TimeLog[], techId: string, orderId: string | null, now: number, orders: RepairOrder[]) {
  return logs
    .filter((row) => row.techId === techId && (orderId === null || row.orderId === orderId))
    .reduce((sum, row) => sum + punchHours(row.startedAt, row.endedAt, now, reviewCap(row, orders.find((order) => order.id === row.orderId)?.closedAt)), 0);
}

function TechBoardPage() {
  const shop = useShop();
  const look = lookups(shop);
  const now = useNow();
  const [techId, setTechId] = useState("");
  const [clockError, setClockError] = useState("");
  const tech = shop.techs.find((row) => row.id === techId);
  const roster = [...shop.techs].sort((a, b) => a.number.localeCompare(b.number, undefined, { numeric: true }));

  const picker = (
    <Field label="Technician">
      <select className="field max-w-md" value={techId} onChange={(event) => setTechId(event.target.value)}>
        <option value="">Choose who is at the board</option>
        {roster.map((row) => (
          <option key={row.id} value={row.id}>#{row.number} {row.name}</option>
        ))}
      </select>
    </Field>
  );

  if (!tech) {
    return (
      <Shell>
        <p className="text-sm font-semibold uppercase tracking-wide text-muted">Technicians</p>
        <h1 className="mt-1 font-display text-5xl leading-none tracking-tight">Tech board</h1>
        <p className="mt-3 max-w-xl text-muted">
          {roster.length === 0
            ? "Add a technician on the roster, then pick them here. There is no password."
            : "Pick a technician. The board shows the open repair orders assigned to that person. There is no password."}
        </p>
        <div className="mt-5 max-w-md">{picker}</div>
      </Shell>
    );
  }

  const jobs = assignedOpen(tech.id, shop.orders);
  const open = shop.timeLogs.find((row) => row.techId === tech.id && row.endedAt === null) ?? null;
  const current = open ? shop.orders.find((order) => order.id === open.orderId) : undefined;
  const todayLogs = shop.timeLogs.filter((row) => row.techId === tech.id && (row.startedAt.startsWith(shopToday()) || row.endedAt === null));
  const today = loggedHours(todayLogs, tech.id, null, now, shop.orders);
  const flagged = jobs.reduce((sum, order) => sum + order.labor.filter((line) => line.techId === tech.id).reduce((hours, line) => hours + line.hours, 0), 0);
  const ordered = [...jobs].sort((a, b) => (a.id === open?.orderId ? -1 : b.id === open?.orderId ? 1 : a.promiseTime.localeCompare(b.promiseTime)));

  return (
    <Shell>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-sm font-semibold uppercase tracking-wide text-muted">Tech {tech.number}</p>
          <h1 className="mt-1 font-display text-5xl leading-none tracking-tight">{tech.name}</h1>
          <p className="mt-3 max-w-2xl text-muted">These are the open repair orders assigned to this technician. Clock onto one at a time.</p>
        </div>
        <div className="min-w-56">{picker}</div>
      </div>

      <div className="mt-4 grid gap-3 sm:grid-cols-3">
        <article className="card">
          <p className="text-sm text-muted">Status</p>
          <p className="mt-1 font-display text-3xl leading-none">{open ? "On the clock" : "Off the clock"}</p>
          <p className="mt-2 text-sm text-muted">{current ? `RO ${current.number}` : "No repair order punched"}</p>
          {open && current?.status === "closed" ? (
            <Button onClick={() => shop.clockOut(tech.id)}>Clock out {tech.name}</Button>
          ) : null}
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
          const hours = loggedHours(shop.timeLogs, tech.id, order.id, now, shop.orders);
          return (
            <article key={order.id} className={onThis ? "card border-2 border-primary" : "card"}>
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <p className="font-display text-3xl leading-none">RO {order.number}</p>
                  <p className="mt-2 font-semibold">{customer?.name ?? "Customer"} · {vehicle ? `${vehicle.year} ${vehicle.model}` : "Vehicle"}</p>
                  <p className="text-sm text-muted">{roStatusLabel(order)} · {BAY_LABEL[(order.bay ?? "dispatch") as BayStatus]}{order.promiseTime ? ` · Promise ${clockTime(order.promiseTime)}` : ""}</p>
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
                  <Button onClick={() => { const result = shop.clockOut(tech.id); setClockError(result.error ?? ""); }}>Clock out {tech.name}</Button>
                ) : (
                  <Button tone="primary" onClick={() => { const result = shop.clockIn(tech.id, order.id); setClockError(result.error ?? ""); }}>{open ? "Move clock here" : "Clock in"}</Button>
                )}
              </div>
            </article>
          );
        })}
      </div>
      {clockError ? <p role="alert" className="mt-2 text-sm text-[#8a3b2a]">{clockError}</p> : null}
    </Shell>
  );
}
