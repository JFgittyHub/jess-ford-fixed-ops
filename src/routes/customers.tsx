import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { NewOrder } from "@/components/new-order";
import { NoShowMark } from "@/components/no-show-mark";
import { Shell } from "@/components/shell";
import { Button, Field, Pill } from "@/components/ui";
import { displayRecordedWhen } from "@/lib/cancel";
import { vehicleHistoryEntries } from "@/lib/ownership";
import { daySpan, today } from "@/lib/format";
import { isSold, lookups } from "@/lib/metrics";
import { useShop } from "@/lib/store";
import type { Campaign } from "@/lib/types";

export const Route = createFileRoute("/customers")({ component: CustomersPage });

const AUDIENCES: { id: Campaign["audience"]; label: string }[] = [
  { id: "due7", label: "Not seen in 7 days" },
  { id: "lapsed90", label: "No visit in 90 days" },
  { id: "lapsed150", label: "No visit in 150 days" },
  { id: "none", label: "Never been in" },
  { id: "all", label: "Every customer" },
];

function CustomersPage() {
  const shop = useShop();
  const look = lookups(shop);
  const navigate = useNavigate();
  const setFocus = useShop((state) => state.setFocus);
  const sendCampaign = useShop((state) => state.sendCampaign);
  const [query, setQuery] = useState("");
  const [riskOnly, setRiskOnly] = useState(false);
  const [writing, setWriting] = useState<string | null>(null);
  const [name, setName] = useState("Maintenance reminder");
  const [audience, setAudience] = useState<Campaign["audience"]>("due7");
  const [message, setMessage] = useState("Jess Ford service: your vehicle is due for a visit. Call the store to book maintenance. Reply STOP to opt out.");
  const [skipOpen, setSkipOpen] = useState(true);
  const [skipRecent, setSkipRecent] = useState(true);
  const [note, setNote] = useState("");

  const base = useMemo(() => {
    return shop.customers.map((customer) => {
      const vehicles = shop.vehicles.filter((vehicle) => vehicle.customerId === customer.id);
      const orders = shop.orders.filter((order) => order.customerId === customer.id);
      const sold = orders.filter(isSold);
      const last = orders.reduce<string>((max, order) => (order.openedOn > max ? order.openedOn : max), "");
      const open = orders.find((order) => order.status !== "closed");
      const age = last ? daySpan(last) : 999;
      return { customer, vehicles, visits: sold.length, last, age, open };
    });
  }, [shop.customers, shop.vehicles, shop.orders]);

  const recentIds = useMemo(() => {
    const ids = new Set<string>();
    for (const campaign of shop.campaigns) {
      if (daySpan(campaign.sentOn) > 30) continue;
      for (const id of campaign.recipientIds) ids.add(id);
    }
    return ids;
  }, [shop.campaigns]);

  const recipients = useMemo(() => {
    return base.filter((row) => {
      if (skipOpen && row.open) return false;
      if (skipRecent && recentIds.has(row.customer.id)) return false;
      if (audience === "due7") return row.age >= 7;
      if (audience === "lapsed150") return row.age >= 150;
      if (audience === "lapsed90") return row.age >= 90;
      if (audience === "none") return row.visits === 0;
      return true;
    });
  }, [base, audience, skipOpen, skipRecent, recentIds]);

  const rows = useMemo(() => {
    return base.filter((row) => {
      if (riskOnly && row.age < 150 && row.visits > 0) return false;
      const hay = `${row.customer.name} ${row.customer.phone} ${row.customer.mobile} ${row.customer.email} ${row.vehicles.map((vehicle) => `${vehicle.model} ${vehicle.vin}`).join(" ")}`.toLowerCase();
      return hay.includes(query.trim().toLowerCase());
    }).sort((a, b) => b.age - a.age);
  }, [base, query, riskOnly]);

  const preview = recipients.slice(0, 4).map((row) => row.customer.name).join(", ");

  return (
    <Shell>
      <p className="text-sm font-semibold uppercase tracking-wide text-muted">Marketing</p>
      <h1 className="mt-1 font-display text-5xl leading-none tracking-tight">Who is due back</h1>
      <p className="mt-3 max-w-2xl text-muted">
        A quiet owner is a lost maintenance visit. Names stay in this browser. Today is {today()}.
      </p>

      <section className="card mt-5">
        <h2 className="font-display text-2xl leading-none">Campaign</h2>
        <p className="mt-2 max-w-2xl text-sm text-muted">
          Pick who is due and send a service reminder. The list is saved here. It does not go out through a phone carrier.
        </p>
        <form
          className="mt-4 grid gap-3"
          onSubmit={(event) => {
            event.preventDefault();
            if (!name.trim() || !message.trim() || recipients.length === 0) {
              setNote(recipients.length === 0 ? "Nobody matches that list." : "Need a name and a message.");
              return;
            }
            sendCampaign({
              name,
              message,
              audience,
              recipientIds: recipients.map((row) => row.customer.id),
            });
            setNote(`Sent to ${recipients.length} customers.`);
          }}
        >
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Campaign name">
              <input className="field" value={name} onChange={(event) => setName(event.target.value)} />
            </Field>
            <Field label="Who gets it">
              <select className="field" value={audience} onChange={(event) => setAudience(event.target.value as Campaign["audience"])}>
                {AUDIENCES.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}
              </select>
            </Field>
          </div>
          <Field label="Message">
            <textarea className="field min-h-24" rows={3} value={message} onChange={(event) => setMessage(event.target.value)} />
          </Field>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={skipOpen} onChange={(event) => setSkipOpen(event.target.checked)} />
            Skip anyone with an open repair order
          </label>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={skipRecent} onChange={(event) => setSkipRecent(event.target.checked)} />
            Skip anyone texted in the last 30 days
          </label>
          <p className="text-sm text-muted">
            {recipients.length} customers{preview ? `: ${preview}${recipients.length > 4 ? `, and ${recipients.length - 4} more` : ""}` : ""}.
          </p>
          {note ? <p className="text-sm text-primary">{note}</p> : null}
          <div>
            <Button tone="primary" type="submit">Send campaign</Button>
          </div>
        </form>
        {shop.campaigns.length > 0 ? (
          <ul className="mt-4 divide-y divide-line border-t border-line">
            {shop.campaigns.map((campaign) => (
              <li key={campaign.id} className="py-3 text-sm">
                <p className="font-semibold">{campaign.name}</p>
                <p className="text-muted">{campaign.sentOn} · {campaign.recipientIds.length} customers</p>
                <p className="mt-1 text-muted">{campaign.message}</p>
              </li>
            ))}
          </ul>
        ) : null}
      </section>

      <div className="mt-4 flex flex-wrap gap-2">
        <input className="field max-w-xs" placeholder="Search name or vehicle" value={query} onChange={(event) => setQuery(event.target.value)} aria-label="Search customers" />
        <Button small tone={riskOnly ? "accent" : "ghost"} onClick={() => setRiskOnly((value) => !value)}>No visit in 150 days</Button>
      </div>
      <div className="mt-4 overflow-x-auto card p-0">
        <table className="data-table min-w-[42rem]">
          <thead>
            <tr><th>Customer</th><th>Vehicle</th><th>Visits</th><th>Last in</th><th></th></tr>
          </thead>
          <tbody>
            {rows.slice(0, 40).map((row) => {
              const lastText = shop.campaigns.find((campaign) => campaign.recipientIds.includes(row.customer.id));
              return (
              <tr key={row.customer.id}>
                <td>
                  <span className="flex flex-wrap items-baseline gap-2 font-semibold">
                    {row.customer.name}{row.customer.formerRecord ? " · former record" : ""}
                    <NoShowMark count={row.customer.noShows} />
                  </span>
                  <span className="text-sm text-muted">{row.customer.phone}</span>
                  <span className="block text-sm text-muted">{row.customer.email}</span>
                  {row.customer.mobile && row.customer.mobile !== row.customer.phone ? <span className="block text-sm text-muted">{row.customer.mobile}</span> : null}
                  {row.customer.mobile ? null : <span className="block text-sm text-muted">No mobile on file</span>}
                  {lastText ? <span className="block text-sm text-muted">Texted {lastText.sentOn}</span> : null}
                </td>
                <td>
                  {row.vehicles.map((vehicle) => (
                    <span key={vehicle.id} className="block">
                      {vehicle.year} Ford {vehicle.model}
                      <span className="block font-mono text-xs text-muted">{vehicle.vin}</span>
                      {(vehicle.ownership ?? []).map((span) => {
                        const person = shop.customers.find((customer) => customer.id === span.customerId);
                        return (
                          <span key={`${vehicle.id}-${span.startedAt}`} className="block text-xs text-muted">
                            {span.endedAt ? "Previous owner" : "Owner"}: {person?.name ?? span.customerId}
                            {person?.phone ? ` · ${person.phone}` : ""}
                            {" · "}{displayRecordedWhen(span.startedAt)}
                            {span.endedAt ? ` to ${displayRecordedWhen(span.endedAt)}` : ""}
                            {span.who ? ` · recorded by ${span.who}` : ""}
                            {span.reason ? ` · ${span.reason}` : ""}
                          </span>
                        );
                      })}
                      <p className="mt-1 text-xs font-semibold">Service history</p>
                      <ul className="grid gap-1 text-xs">
                        {vehicleHistoryEntries(shop.orders, vehicle, shop.customers, shop.vehicles).map((entry) => (
                          entry.kind === "divider"
                            ? <li key={entry.text} className="font-semibold text-ink">{entry.text}</li>
                            : <li key={entry.order.id}>RO {entry.order.number} · {entry.ownerName} · {entry.order.openedOn} · {entry.order.concern}</li>
                        ))}
                      </ul>
                    </span>
                  ))}
                </td>
                <td className="tabular-nums">{row.visits}</td>
                <td>
                  {row.last || "—"}
                  {row.age >= 150 ? <div className="mt-1"><Pill tone="bad">{row.age >= 900 ? "No history" : `${row.age} days`}</Pill></div> : null}
                  {row.open ? <div className="mt-1"><Pill tone="good">Open RO</Pill></div> : null}
                </td>
                <td>
                  <div className="flex flex-wrap gap-2">
                    {row.open ? (
                      <Button small onClick={() => { setFocus(row.open!.id); void navigate({ to: "/orders" }); }}>Open RO</Button>
                    ) : (
                      <Button small tone="primary" onClick={() => setWriting(row.customer.id)}>Write RO</Button>
                    )}
                  </div>
                </td>
              </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="mt-2 text-sm text-muted">Showing {Math.min(40, rows.length)} of {rows.length}.</p>
      <section className="mt-4">
        <h2 className="font-display text-2xl leading-none">Ownership changes</h2>
        {(shop.ownershipLog ?? []).length === 0 ? <p className="mt-2 text-sm text-muted">No vehicle transfers on this store.</p> : (
          <ul className="mt-2 grid gap-1 text-sm">
            {(shop.ownershipLog ?? []).map((row) => {
              const from = shop.customers.find((customer) => customer.id === row.beforeCustomerId)?.name ?? "the previous owner";
              const to = shop.customers.find((customer) => customer.id === row.afterCustomerId)?.name ?? "the new owner";
              const vehicle = shop.vehicles.find((item) => item.id === row.afterVehicleId)
                ?? shop.vehicles.find((item) => item.id === row.beforeVehicleId)
                ?? shop.vehicles.find((item) => item.vin && row.vin && item.vin.toUpperCase() === row.vin.toUpperCase());
              const vin = (vehicle?.vin || row.vin || "").replace(/\s/g, "").toUpperCase();
              const tail = vin.length >= 8 ? vin.slice(-8) : vin;
              const title = vehicle ? `${vehicle.year} ${vehicle.make || "Ford"} ${vehicle.model}` : "Vehicle";
              return <li key={`${row.at}-${row.beforeVehicleId}-${row.afterVehicleId}`}>{row.who || "Unnamed"} transferred {title}{tail ? ` · ${tail}` : ""} from {from} to {to}.{row.reason ? ` ${row.reason}.` : ""} {displayRecordedWhen(row.at)}</li>;
            })}
          </ul>
        )}
      </section>
      <NewOrder
        open={writing !== null}
        onClose={() => setWriting(null)}
        preset={writing ? {
          customerId: writing,
          vehicleId: look.vehicle ? shop.vehicles.find((vehicle) => vehicle.customerId === writing)?.id : undefined,
        } : undefined}
      />
    </Shell>
  );
}
