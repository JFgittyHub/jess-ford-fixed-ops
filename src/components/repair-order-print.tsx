import { clockTime, feeCharge, roStatusLabel, usd } from "@/lib/format";
import { orderMoney, vehicleTitle } from "@/lib/metrics";
import { customerCopyIdentity } from "@/lib/ownership";
import { payLabel } from "@/lib/pay";
import { useShop } from "@/lib/store";
import { normalizeWa, vinTail, waLimit } from "@/lib/wa";

const CHOICE: Record<string, string> = {
  written: "Written estimate. Contact the customer if the price will exceed it by more than ten percent.",
  cap: "Proceed, and contact the customer if the price will exceed the cap.",
  waive: "Customer does not want a written estimate.",
  dropoff: "No face-to-face drop-off. Amount authorized before parts or labor.",
};

export function RepairOrderPrint({ orderId }: { orderId: string }) {
  const order = useShop((state) => state.orders.find((row) => row.id === orderId));
  const settings = useShop((state) => state.settings);
  const customer = useShop((state) => state.customers.find((row) => row.id === order?.customerId));
  const vehicle = useShop((state) => state.vehicles.find((row) => row.id === order?.vehicleId));
  const advisor = useShop((state) => state.advisors.find((row) => row.id === order?.advisorId));
  const techs = useShop((state) => state.techs);
  const payTypes = useShop((state) => state.payTypes);
  const closedHistory = useShop((state) => state.closedHistory);
  const closedRows = closedHistory.filter((row) => row.orderId === orderId);

  if (!order) return null;
  const snap = order.closeSnapshot;
  const copy = customerCopyIdentity(order, customer);
  const version = closedRows.reduce((max, row) => Math.max(max, row.version ?? 1), order.status === "closed" ? 1 : 0);
  const money = orderMoney(order);
  const wa = normalizeWa(order.wa);
  const limit = waLimit(wa);
  const techName = (id: string) => techs.find((tech) => tech.id === id)?.name ?? "";

  return (
    <article className="ro-print">
      <header className="ro-head">
        <div>
          <p className="ro-kicker">{settings.storeName}</p>
          <h1>Repair order {order.number}</h1>
          <p>{[settings.address, settings.city, settings.phone].filter(Boolean).join(" · ") || settings.city}</p>
        </div>
        <div>
          <p>Opened {order.openedOn}</p>
          <p>{order.closeType === "no_work" && order.status === "closed" ? "Closed — no work ($0)" : order.status === "closed" ? `Closed ${order.invoicedOn ?? ""}`.trim() : roStatusLabel(order)}{order.status === "closed" ? ` · Version ${version}` : ""}</p>
          {order.closeType === "no_work" && order.closeNote ? <p>{order.closeNote}</p> : null}
          <p>{order.promiseTime ? `Promise ${clockTime(order.promiseTime)}` : "No promise time"}</p>
          <p>Advisor {advisor?.name ?? "—"}</p>
        </div>
      </header>

      <section className="ro-split">
        <div>
          <h2>Customer</h2>
          <p>{copy.name}</p>
          <p>{copy.phone}</p>
          <p>{(snap?.address ?? wa.address) || "No address on the ticket"}</p>
        </div>
        <div>
          <h2>Vehicle</h2>
          <p>{snap ? vehicleTitle(snap.year, snap.make, snap.model) : vehicle ? vehicleTitle(vehicle.year, vehicle.make || "Ford", vehicle.model) : "—"}</p>
          <p>{(snap?.plate || wa.plate) ? `Plate ${snap?.plate || wa.plate}` : (snap?.vin || vehicle?.vin) ? `VIN ${vinTail(snap?.vin || vehicle?.vin || "")}` : ""}</p>
          <p>In {order.mileage.toLocaleString("en-US")} miles</p>
          <p>Out {order.mileageOut != null ? `${order.mileageOut.toLocaleString("en-US")} miles` : "—"}</p>
          {(order.history ?? []).filter((row) => row.kind === "mileage-override").map((row) => (
            <p key={`${row.at}-${row.field ?? "mileage"}`}>{row.text}</p>
          ))}
        </div>
      </section>

      <h2>Lines</h2>
      <table>
        <thead>
          <tr><th>Line</th><th>Concern</th><th>Cause</th><th>Correction</th></tr>
        </thead>
        <tbody>
          {(order.jobs ?? []).map((job) => (
            <tr key={job.id}>
              <td>{job.code}</td>
              <td>{job.concern}</td>
              <td>{job.cause}</td>
              <td>{job.correction}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <h2>Labor</h2>
      <table>
        <thead>
          <tr><th>Op</th><th>Description</th><th>Tech</th><th>Pay</th><th>Hours</th><th>Amount</th></tr>
        </thead>
        <tbody>
          {order.labor.length === 0 ? <tr><td colSpan={6}>No labor</td></tr> : null}
          {order.labor.map((line) => (
            <tr key={line.id}>
              <td>{line.opcode}</td>
              <td>{line.description}</td>
              <td>{techName(line.techId)}</td>
              <td>{payLabel(payTypes, line.payType)}</td>
              <td>{line.hours.toFixed(1)}</td>
              <td>{usd(line.hours * line.rate, true)}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <h2>Parts</h2>
      <table>
        <thead>
          <tr><th>Number</th><th>Description</th><th>Condition</th><th>Qty</th><th>Price</th><th>Amount</th></tr>
        </thead>
        <tbody>
          {order.parts.length === 0 ? <tr><td colSpan={6}>No parts</td></tr> : null}
          {order.parts.map((line) => (
            <tr key={line.id}>
              <td>{line.number}</td>
              <td>{line.description}</td>
              <td>{line.condition ?? "new"}</td>
              <td>{line.qty}</td>
              <td>{usd(line.price, true)}</td>
              <td>{usd(line.qty * line.price, true)}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <h2>Fees</h2>
      <table>
        <thead>
          <tr><th>Fee</th><th>Amount</th></tr>
        </thead>
        <tbody>
          {(order.fees ?? []).length === 0 ? <tr><td colSpan={2}>No fees</td></tr> : null}
          {(order.fees ?? []).map((line) => (
            <tr key={line.id}>
              <td>{line.name}{line.basis === "percent" ? ` (${line.amount}%${line.cap > 0 ? `, cap ${usd(line.cap, true)}` : ""})` : ""}</td>
              <td>{usd(feeCharge(line, money.labor + money.parts), true)}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <p className="ro-totals">Labor {usd(money.labor)} · Parts {usd(money.parts)} · Fees {usd(money.fees)} · Before tax {usd(money.ticket)} · Sales tax {order.taxRate}% {usd(money.tax, true)} · Total {usd(money.total)}</p>

      <section className="ro-sign">
        <p>Customer _______________________________ Date __________</p>
        <p>Advisor _______________________________ Technician _______________________________</p>
      </section>

      <p>Sales tax is {order.taxRate}% and is not part of the 110% cap.</p>
      <p>{wa.choice ? CHOICE[wa.choice] : "Not captured"} {wa.initials ? `Initials ${wa.initials} on ${wa.date} at ${wa.time}.` : ""} {limit !== null && Number.isFinite(limit) ? `Authorized to ${usd(limit)} before tax.` : ""}</p>
      <p>{wa.returnParts ? "Customer asked for replaced parts back, or to see them if they must be returned." : "Replaced parts were not requested."}</p>
      {wa.extras.length > 0 ? (
        <ul>
          {wa.extras.map((row) => (
            <li key={row.id}>{row.date} {row.time}: {row.person} authorized {usd(row.amount)} for {row.work || "additional work"}. Taken by {row.employee}.</li>
          ))}
        </ul>
      ) : null}
    </article>
  );
}

export function printRepairOrder() {
  document.body.classList.add("printing-ro");
  const done = () => {
    document.body.classList.remove("printing-ro");
    window.removeEventListener("afterprint", done);
  };
  window.addEventListener("afterprint", done);
  window.print();
}
