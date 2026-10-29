import { mpiCounts, mpiGroups, type MpiMark, type MpiPoint } from "@/lib/mpi";
import { useShop } from "@/lib/store";
import { Button, Field } from "./ui";

const MARKS: { id: MpiMark; label: string }[] = [
  { id: "green", label: "OK" },
  { id: "yellow", label: "Soon" },
  { id: "red", label: "Now" },
];

function scaleFor(group: string) {
  const name = group.toLowerCase();
  if (name.includes("brake")) return ["6 mm or more", "3 to 5 mm", "Under 3 mm"] as const;
  if (name.includes("tire")) return ["6/32 or more", "4/32 to 5/32", "3/32 or less"] as const;
  return null;
}

export function MultiPointSheet({ orderId }: { orderId: string }) {
  const order = useShop((state) => state.orders.find((row) => row.id === orderId));
  const techs = useShop((state) => state.techs);
  const customers = useShop((state) => state.customers);
  const vehicles = useShop((state) => state.vehicles);
  const advisors = useShop((state) => state.advisors);
  const storeName = useShop((state) => state.settings.storeName);
  const attachInspection = useShop((state) => state.attachInspection);
  const setInspectionTech = useShop((state) => state.setInspectionTech);
  const setInspectionPoint = useShop((state) => state.setInspectionPoint);

  if (!order) return null;
  const locked = order.status === "invoiced" || order.status === "closed";
  const sheet = order.inspection;
  const customer = customers.find((row) => row.id === order.customerId);
  const vehicle = vehicles.find((row) => row.id === order.vehicleId);
  const advisor = advisors.find((row) => row.id === order.advisorId);

  if (!sheet) {
    return (
      <section className="card">
        <h3 className="font-display text-2xl leading-none">Multi-point</h3>
        <p className="mt-2 text-sm text-muted">
          {locked
            ? order.status === "closed"
              ? "This repair order was closed with no work."
              : "This ticket was booked without a multi-point on it."
            : "No inspection sheet on this repair order yet. Attach one and the tech marks it while the car is in the air."}
        </p>
        {locked ? null : (
          <Button className="mt-3" tone="primary" onClick={() => attachInspection(order.id)}>Attach multi-point</Button>
        )}
      </section>
    );
  }

  const counts = mpiCounts(sheet);
  const now = sheet.items.filter((item) => item.status === "red");
  const soon = sheet.items.filter((item) => item.status === "yellow");
  const techName = techs.find((tech) => tech.id === sheet.techId)?.name;

  return (
    <section className="mpi-sheet">
      <div className="mpi-title">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-muted">{storeName}</p>
          <h3 className="font-display text-3xl leading-none">Vehicle inspection</h3>
        </div>
        <p className="mpi-banner">Multi-point inspection</p>
        <Button className="no-print" small onClick={printSheet}>Print sheet</Button>
      </div>

      <div className="mpi-legend">
        <span><i className="mpi-swatch is-green" aria-hidden /> OK at this visit</span>
        <span><i className="mpi-swatch is-yellow" aria-hidden /> Coming due</span>
        <span><i className="mpi-swatch is-red" aria-hidden /> Needs it now</span>
        <span className="text-muted">{counts.green} ok · {counts.yellow} soon · {counts.red} now{counts.open ? ` · ${counts.open} open` : ""}</span>
      </div>

      <dl className="mpi-meta">
        <div><dt>Date</dt><dd>{order.openedOn}</dd></div>
        <div><dt>RO</dt><dd className="tabular-nums">{order.number}</dd></div>
        <div><dt>Customer</dt><dd>{customer?.name ?? "—"}</dd></div>
        <div><dt>Vehicle</dt><dd>{vehicle ? `${vehicle.year} ${vehicle.model}` : "—"}</dd></div>
        <div><dt>Miles</dt><dd className="tabular-nums">{order.mileage.toLocaleString("en-US")}</dd></div>
        <div><dt>Advisor</dt><dd>{advisor?.name ?? "—"}</dd></div>
        <div className="mpi-tech">
          <dt>Technician</dt>
          <dd>
            {locked ? (
              techName ?? "Not named"
            ) : (
              <select className="field" aria-label="Technician" value={sheet.techId} onChange={(event) => setInspectionTech(order.id, event.target.value)}>
                <option value="">Choose a tech</option>
                {techs.map((tech) => <option key={tech.id} value={tech.id}>{tech.name}</option>)}
              </select>
            )}
          </dd>
        </div>
      </dl>

      <div className="mt-3 grid gap-3">
        {mpiGroups(sheet).map((group) => {
          const scale = scaleFor(group.name);
          return (
            <div key={group.name} className="mpi-block">
              <h4 className="mpi-group-bar">{group.name}</h4>
              {scale ? (
                <p className="mpi-scale">
                  <span className="mpi-scale-ok">{scale[0]}</span>
                  <span className="mpi-scale-soon">{scale[1]}</span>
                  <span className="mpi-scale-now">{scale[2]}</span>
                </p>
              ) : null}
              {group.items.map((item) => (
                <PointRow key={item.id} item={item} locked={locked} onChange={(patch) => setInspectionPoint(order.id, item.id, patch)} />
              ))}
            </div>
          );
        })}
      </div>

      <div className="mpi-findings">
        <div>
          <h4>Needs it now</h4>
          {now.length === 0 ? <p className="text-sm text-muted">Nothing marked red.</p> : (
            <ul>{now.map((item) => <li key={item.id}><strong>{item.label}</strong>{item.note ? ` — ${item.note}` : ""}{readingText(item)}</li>)}</ul>
          )}
        </div>
        <div>
          <h4>Coming due</h4>
          {soon.length === 0 ? <p className="text-sm text-muted">Nothing marked yellow.</p> : (
            <ul>{soon.map((item) => <li key={item.id}><strong>{item.label}</strong>{item.note ? ` — ${item.note}` : ""}{readingText(item)}</li>)}</ul>
          )}
        </div>
      </div>

      <div className="mpi-sign">
        <p>Technician: {techName ?? "________________"}</p>
        <p>Advisor: {advisor?.name ?? "________________"}</p>
        <p>Customer: ________________</p>
      </div>
    </section>
  );
}

function readingText(item: MpiPoint) {
  if (!item.reading) return "";
  if (item.unit === "mm") return ` (${item.reading} mm)`;
  if (item.unit === "/32") return ` (${item.reading}/32)`;
  return ` (${item.reading})`;
}

function PointRow({
  item,
  locked,
  onChange,
}: {
  item: MpiPoint;
  locked: boolean;
  onChange: (patch: Partial<Pick<MpiPoint, "status" | "reading" | "note">>) => void;
}) {
  return (
    <div className="mpi-row">
      <div className="mpi-dots" role="radiogroup" aria-label={item.label}>
        {MARKS.map((mark) => {
          const on = item.status === mark.id;
          return (
            <button
              key={mark.id}
              type="button"
              role="radio"
              aria-checked={on}
              aria-label={`${item.label} ${mark.label}`}
              disabled={locked}
              className={`mpi-choice ${on ? `is-${mark.id}` : `is-off-${mark.id}`}`}
              onClick={() => onChange({ status: on ? null : mark.id })}
            />
          );
        })}
      </div>
      <p className="font-semibold">{item.label}</p>
      {item.unit ? (
        <Field label={item.unit === "mm" ? "mm" : "/32"}>
          <input
            className="field tabular-nums"
            disabled={locked}
            inputMode="decimal"
            value={item.reading}
            aria-label={`${item.label} reading`}
            onChange={(event) => onChange({ reading: event.target.value })}
          />
        </Field>
      ) : <span className="mpi-blank" />}
      <input
        className="field"
        disabled={locked}
        placeholder="Note"
        aria-label={`${item.label} note`}
        value={item.note}
        onChange={(event) => onChange({ note: event.target.value })}
      />
    </div>
  );
}

function printSheet() {
  document.body.classList.add("printing-mpi");
  const done = () => {
    document.body.classList.remove("printing-mpi");
    window.removeEventListener("afterprint", done);
  };
  window.addEventListener("afterprint", done);
  window.print();
}
