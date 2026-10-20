import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { NewOrder } from "@/components/new-order";
import { OrderEditor } from "@/components/order-editor";
import { Shell } from "@/components/shell";
import { Button, Pill } from "@/components/ui";
import { BAY_LABEL, daySpan, monthName, STATUS_LABEL, usd } from "@/lib/format";
import { mpiCounts } from "@/lib/mpi";
import { isOpen, isSold, lookups, orderMoney } from "@/lib/metrics";
import { useShop } from "@/lib/store";
import { useSession } from "@/lib/session";
import type { BayStatus, ClosedRecord, RepairOrder, RoStatus } from "@/lib/types";

export const Route = createFileRoute("/orders")({ component: OrdersPage });

type Filter = "open" | "booked" | "sold" | "closed" | "all";

function OrdersPage() {
  const shop = useShop();
  const { session } = useSession();
  const look = lookups(shop);
  const focusOrderId = useShop((state) => state.focusOrderId);
  const setFocus = useShop((state) => state.setFocus);
  const [filter, setFilter] = useState<Filter>("open");
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(0);
  const [openId, setOpenId] = useState<string | null>(null);
  const [writing, setWriting] = useState(false);

  useEffect(() => {
    if (focusOrderId) {
      setOpenId(focusOrderId);
      setFocus(null);
    }
  }, [focusOrderId, setFocus]);

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    return shop.orders.filter((order) => {
      if (session?.role === "advisor" && order.advisorId !== session.id) return false;
      if (session?.role === "tech" && !order.labor.some((line) => line.techId === session.id)) return false;
      if (filter === "open" && (!isOpen(order) || order.status === "booked")) return false;
      if (filter === "booked" && order.status !== "booked") return false;
      if (filter === "sold" && !isSold(order)) return false;
      if (filter === "closed" && order.status !== "invoiced") return false;
      if (!q) return true;
      const customer = look.customer.get(order.customerId);
      const vehicle = look.vehicle.get(order.vehicleId);
      const money = orderMoney(order);
      const waPlate = order.wa?.plate ?? "";
      const hay = `${order.number} ${customer?.name ?? ""} ${customer?.phone ?? ""} ${vehicle?.model ?? ""} ${vehicle?.vin ?? ""} ${waPlate} ${order.concern} ${money.total.toFixed(2)} ${Math.round(money.total)} ${techsOn(order, look).map((tech) => tech.number).join(" ")}`.toLowerCase();
      return hay.includes(q);
    });
  }, [shop.orders, filter, query, look, session]);

  const history = useMemo(() => {
    const q = query.trim().toLowerCase();
    const digits = q.replace(/\D/g, "");
    return shop.closedHistory.filter((row) => {
      const order = shop.orders.find((item) => item.id === row.orderId);
      if (session?.role === "advisor" && order?.advisorId !== session.id) return false;
      if (session?.role === "tech" && !order?.labor.some((line) => line.techId === session.id)) return false;
      return matchesHistory(row, q, digits);
    }).sort((a, b) => b.closedOn.localeCompare(a.closedOn) || b.number - a.number);
  }, [shop.closedHistory, shop.orders, query, session]);

  const listed = useMemo(() => {
    if (filter !== "closed") return rows;
    return rows.slice().sort((a, b) => (b.invoicedOn ?? "").localeCompare(a.invoicedOn ?? "") || b.number - a.number);
  }, [rows, filter]);

  const pageSize = 12;
  const sourceCount = filter === "closed" ? history.length : listed.length;
  const pageCount = Math.max(1, Math.ceil(sourceCount / pageSize));
  const safePage = Math.min(page, pageCount - 1);
  const visible = listed.slice(safePage * pageSize, safePage * pageSize + pageSize);
  const visibleHistory = history.slice(safePage * pageSize, safePage * pageSize + pageSize);
  const openCount = shop.orders.filter((order) => isOpen(order) && order.status !== "booked").length;
  const soldCount = shop.orders.filter(isSold).length;

  return (
    <Shell>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-sm font-semibold uppercase tracking-wide text-muted">Repair orders</p>
          <h1 className="mt-1 font-display text-5xl leading-none tracking-tight">The board</h1>
          <p className="mt-2 max-w-xl text-muted">{openCount} open. {soldCount} closed in {monthName()}. Book a ticket when it is ready, then close it. Close is what moves absorption.</p>
        </div>
        {session?.role === "tech" ? null : <Button tone="primary" onClick={() => setWriting(true)}>Write RO</Button>}
      </div>

      <div className="mt-5 flex flex-wrap gap-2">
        {(["open", "booked", "sold", "closed", "all"] as const).map((item) => (
          <Button key={item} small tone={filter === item ? "primary" : "ghost"} onClick={() => { setFilter(item); setPage(0); }}>
            {item === "open" ? "Open" : item === "booked" ? "Booked" : item === "sold" ? "Invoiced" : item === "closed" ? "Closed" : "All"}
          </Button>
        ))}
        <input
          className="field max-w-xs"
          placeholder={filter === "closed" ? "Name, phone, VIN, plate, RO, or amount" : "Search name, phone, RO, VIN"}
          value={query}
          onChange={(event) => { setQuery(event.target.value); setPage(0); }}
          aria-label="Search repair orders"
        />
      </div>

      {filter === "closed" ? (
        <p className="mt-3 max-w-3xl text-sm text-muted">
          RCW 46.71.060. A closed repair order stays on this computer for at least one year after the repair, including the estimate and the invoice. Search by customer name, phone, VIN, plate, repair order number, or dollar amount. Open a row to print the copy.
        </p>
      ) : null}

      <div className="mt-4 overflow-x-auto card p-0">
        <table className="data-table min-w-[40rem]">
          <thead>
            <tr>
              {filter === "closed" ? (
                <>
                  <th>RO</th>
                  <th>Closed</th>
                  <th>Customer</th>
                  <th>Phone</th>
                  <th>VIN</th>
                  <th>Plate</th>
                  <th>Totals</th>
                </>
              ) : (
                <>
                  <th>RO</th>
                  <th>Customer</th>
                  <th>Tech #</th>
                  <th>Bay</th>
                  <th>Days open</th>
                  <th>Concern</th>
                  <th>Labor ops</th>
                  <th>Status</th>
                  <th>Multi-point</th>
                  <th>Totals</th>
                </>
              )}
            </tr>
          </thead>
          <tbody>
            {filter === "closed" && visibleHistory.length === 0 ? (
              <tr><td colSpan={7} className="text-muted">No closed repair orders match.</td></tr>
            ) : null}
            {filter !== "closed" && visible.length === 0 ? (
              <tr><td colSpan={10} className="text-muted">Nothing matches.</td></tr>
            ) : null}
            {filter === "closed" ? visibleHistory.map((row) => (
              <tr key={row.id} className="clickable" onClick={() => setOpenId(row.orderId)}>
                <td className="tabular-nums font-semibold">{row.number}</td>
                <td className="tabular-nums">{row.closedOn}</td>
                <td>
                  <span className="block font-semibold">{row.customerName}</span>
                  <span className="block text-sm text-muted">{row.vehicle}</span>
                </td>
                <td className="tabular-nums">{row.phone || "—"}</td>
                <td className="tabular-nums">{row.vin || "—"}</td>
                <td>{row.plate || "—"}</td>
                <td className="tabular-nums">{usd(row.total)}</td>
              </tr>
            )) : visible.map((order) => {
              const customer = look.customer.get(order.customerId);
              const vehicle = look.vehicle.get(order.vehicleId);
              const money = orderMoney(order);
              const age = daysOpen(order);
              const techs = techsOn(order, look);
              return (
                <tr key={order.id} className="clickable" onClick={() => setOpenId(order.id)}>
                  <td className="tabular-nums font-semibold">{order.number}</td>
                  <td>
                    <span className="block font-semibold">{customer?.name}</span>
                    <span className="block text-sm text-muted">{vehicle ? `${vehicle.year} ${vehicle.model}` : ""}</span>
                  </td>
                  <td className="tabular-nums font-semibold" title={techs.map((tech) => tech.name).join(", ")}>
                    {techs.length === 0 ? <span className="font-normal text-muted">—</span> : techs.map((tech) => tech.number).join(", ")}
                  </td>
                  <td>{BAY_LABEL[(order.bay ?? "dispatch") as BayStatus]}</td>
                  <td className={age >= 30 ? "tabular-nums font-semibold text-[#b42318]" : "tabular-nums"}>{age}</td>
                  <td className="max-w-xs">
                    {order.jobs && order.jobs.length > 1
                      ? order.jobs.map((job) => `${job.code}. ${job.concern}`).filter((line) => !line.endsWith(". ")).join(" · ")
                      : order.concern}
                  </td>
                  <td className="max-w-xs" title={order.labor.map((line) => `${line.opcode} · ${line.description}`).join(", ")}>
                    {order.labor.length === 0
                      ? <span className="text-muted">—</span>
                      : order.labor.map((line) => line.opcode).join(", ")}
                  </td>
                  <td><Pill tone={order.status === "parts" ? "bad" : order.status === "ready" || order.status === "booked" || order.status === "invoiced" ? "good" : undefined}>{STATUS_LABEL[order.status as RoStatus]}</Pill></td>
                  <td><MpiCell order={order} /></td>
                  <td className="tabular-nums">{usd(money.total)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <div className="mt-3 flex items-center justify-between gap-3">
        <p className="text-sm text-muted">Page {safePage + 1} of {pageCount}</p>
        <div className="flex gap-2">
          <Button small disabled={safePage === 0} onClick={() => setPage(safePage - 1)}>Previous</Button>
          <Button small disabled={safePage >= pageCount - 1} onClick={() => setPage(safePage + 1)}>Next</Button>
        </div>
      </div>
      <OrderEditor orderId={openId} onClose={() => setOpenId(null)} />
      <NewOrder open={writing} onClose={() => setWriting(false)} />
    </Shell>
  );
}

function matchesHistory(row: ClosedRecord, query: string, digits: string) {
  if (!query) return true;
  const amount = `${row.total.toFixed(2)} ${Math.round(row.total)} ${row.beforeTax.toFixed(2)} ${Math.round(row.beforeTax)}`;
  const hay = `${row.number} ${row.customerName} ${row.phone} ${row.vin} ${row.plate} ${row.vehicle} ${row.address} ${row.concern} ${row.opcodes} ${row.partNumbers} ${amount}`.toLowerCase();
  const phone = row.phone.replace(/\D/g, "");
  return hay.includes(query) || (digits.length >= 3 && (phone.includes(digits) || amount.replace(/\D/g, "").includes(digits)));
}

function daysOpen(order: RepairOrder) {
  const sinceOpen = daySpan(order.openedOn);
  if (order.invoicedOn) return Math.max(0, sinceOpen - daySpan(order.invoicedOn));
  return Math.max(0, sinceOpen);
}

function techsOn(order: RepairOrder, look: ReturnType<typeof lookups>) {
  const ids = [...new Set(order.labor.map((line) => line.techId).filter(Boolean))];
  return ids.map((id) => look.tech.get(id)).filter((tech): tech is NonNullable<typeof tech> => Boolean(tech));
}

function MpiCell({ order }: { order: RepairOrder }) {
  const counts = mpiCounts(order.inspection);
  if (!order.inspection) return <span className="text-sm text-muted">Not on ticket</span>;
  if (counts.green + counts.yellow + counts.red === 0) return <span className="text-sm text-muted">Not started</span>;
  return (
    <span className="inline-flex flex-wrap gap-1">
      {counts.red > 0 ? <span className="mpi-count mpi-red">{counts.red} red</span> : null}
      {counts.yellow > 0 ? <span className="mpi-count mpi-yellow">{counts.yellow} yellow</span> : null}
      {counts.red === 0 && counts.yellow === 0 && counts.open === 0 ? <span className="mpi-count mpi-green">All green</span> : null}
      {counts.open > 0 ? <span className="text-xs text-muted">{counts.open} left</span> : null}
    </span>
  );
}
