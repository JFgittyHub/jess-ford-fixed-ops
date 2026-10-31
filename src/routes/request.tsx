import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { DeskLocked } from "@/components/shell";
import { Button, Field } from "@/components/ui";
import { confirmedDemoStaffAccess } from "@/lib/demo";
import { today } from "@/lib/format";
import { lookupOnlineCustomer, revealSavedVehicles, visitSlots } from "@/lib/online-request";
import { useShop } from "@/lib/store";
import type { StoreId } from "@/lib/types";
import { vinScheduleError } from "@/lib/vin";

export const Route = createFileRoute("/request")({ component: RequestPage });

const STORES: { id: StoreId; label: string }[] = [
  { id: "grand-coulee", label: "Grand Coulee" },
  { id: "pullman", label: "Pullman" },
];

function requestDeviceId() {
  try {
    const key = "jf-request-device";
    const existing = localStorage.getItem(key);
    if (existing) return existing;
    const next = `dev-${Math.random().toString(36).slice(2, 10)}`;
    localStorage.setItem(key, next);
    return next;
  } catch {
    return "";
  }
}

function RequestPage() {
  const shop = useShop();
  const dataset = useShop((state) => state.dataset);
  const storeName = useShop((state) => state.settings.storeName);
  const [hydrated, setHydrated] = useState(() => useShop.persist.hasHydrated());
  const switchStore = useShop((state) => state.switchStore);
  const [step, setStep] = useState<"lookup" | "code" | "details" | "visit" | "sent">("lookup");
  const [query, setQuery] = useState("");
  const [note, setNote] = useState("");
  const [customerNote, setCustomerNote] = useState("");
  const [error, setError] = useState("");
  const [customerId, setCustomerId] = useState<string | null>(null);
  const [issuedCode, setIssuedCode] = useState<string | null>(null);
  const [mobileLast4, setMobileLast4] = useState("");
  const [enteredCode, setEnteredCode] = useState("");
  const [verified, setVerified] = useState(false);
  const [vehicleId, setVehicleId] = useState("");
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [year, setYear] = useState("2020");
  const [make, setMake] = useState("");
  const [model, setModel] = useState("");
  const [vin, setVin] = useState("");
  const [plate, setPlate] = useState("");
  const [serviceId, setServiceId] = useState(shop.settings.scheduling.onlineMenu[0]?.id ?? "");
  const advisorId = shop.advisors[0]?.id ?? "";
  const [transportId, setTransportId] = useState(shop.settings.scheduling.transportOptions[0]?.id ?? "");
  const [contactMethod, setContactMethod] = useState<"text" | "email" | "call">("text");
  const [date, setDate] = useState(today());
  const [time, setTime] = useState("");
  const [sentId, setSentId] = useState<string | null>(null);

  const menu = shop.settings.scheduling.onlineMenu;
  const transports = shop.settings.scheduling.transportOptions;
  const service = menu.some((row) => row.id === serviceId) ? serviceId : menu[0]?.id ?? "";
  const advisor = advisorId;
  const transport = transports.some((row) => row.id === transportId) ? transportId : transports[0]?.id ?? "";
  const slots = visitSlots(shop, { serviceId: service, advisorId: advisor });
  const dates = [...new Set(slots.map((slot) => slot.date))];
  const day = dates.includes(date) ? date : dates[0] ?? "";
  const times = [...new Set(slots.filter((slot) => slot.date === day).map((slot) => slot.time))];
  const pickedTime = times.includes(time) ? time : times[0] ?? "";
  const savedVehicles = verified
    ? shop.vehicles.filter((vehicle) => vehicle.customerId === customerId)
    : [];
  const sent = shop.onlineRequests.find((row) => row.id === sentId) ?? null;

  function findRecord() {
    setError("");
    const result = lookupOnlineCustomer(shop.customers, shop.vehicles, query);
    if (result.kind === "ambiguous") {
      setError("That matches more than one record. Use a phone number, an email, or the last 8 of the VIN.");
      return;
    }
    if (result.kind === "code") {
      const issued = shop.issueOnlineChallenge(result.customerId);
      if (!issued.ok) {
        setVerified(false);
        setCustomerId(null);
        setNote("No mobile is on file, so this request stays unverified. Saved vehicles stay hidden.");
        setStep("details");
        return;
      }
      setCustomerId(result.customerId);
      setIssuedCode(issued.code);
      setMobileLast4(issued.mobileLast4);
      setEnteredCode("");
      setVerified(false);
      setNote("");
      setStep("code");
      return;
    }
    setVerified(false);
    setCustomerId(null);
    setIssuedCode(null);
    setNote(result.kind === "unverified"
      ? "No mobile is on file, so this request stays unverified. Saved vehicles stay hidden. Enter the vehicle for this visit."
      : "No record matched. Enter your name and vehicle for this request.");
    setStep("details");
  }

  function checkCode() {
    const customer = shop.customers.find((row) => row.id === customerId) ?? null;
    const revealed = revealSavedVehicles({
      customer,
      vehicles: shop.vehicles,
      issuedCode,
      enteredCode,
    });
    if (!revealed.unlocked) {
      setVerified(false);
      setError("That code does not match. Saved vehicles stay hidden.");
      return;
    }
    setVerified(true);
    setVehicleId(revealed.vehicles[0]?.id ?? "");
    setError("");
    setNote("Code matched. Pick a saved vehicle.");
    setStep("details");
  }

  function sendRequest() {
    setError("");
    const result = shop.addOnlineRequest({
      serviceId: service,
      date: day,
      time: pickedTime,
      advisorId: advisor,
      transportId: transport,
      contactMethod,
      verified,
      code: enteredCode,
      customerId: customerId ?? undefined,
      vehicleId: vehicleId || undefined,
      customerName: name,
      phone,
      email,
      year: Number(year),
      make,
      model,
      vin,
      note: customerNote,
      plate,
      deviceId: requestDeviceId(),
    });
    if (!result.ok) {
      setError(result.reason === "full"
        ? "That time is no longer open."
        : result.reason === "code"
          ? "The code did not match, so the saved vehicle was not used."
          : result.reason === "vin"
            ? (vinScheduleError(vin) || "Enter a 17-character VIN.")
            : result.reason === "limit"
              ? `This phone, email, or browser already has ${"limit" in result && result.limit != null ? result.limit : 3} requests waiting.`
              : "Enter the visit details and try again.");
      return;
    }
    setSentId(result.id);
    setStep("sent");
  }

  useEffect(() => {
    let live = true;
    void Promise.resolve(useShop.persist.rehydrate()).finally(() => {
      if (live) setHydrated(true);
    });
    return () => { live = false; };
  }, []);

  if (!hydrated || !confirmedDemoStaffAccess({ dataset })) return <DeskLocked storeName={storeName} />;

  return (
    <main className="mx-auto min-h-screen max-w-3xl bg-bg px-4 py-8 text-ink">
      <p className="text-sm font-semibold uppercase tracking-wide text-muted">Online request</p>
      <h1 className="mt-1 font-display text-5xl leading-none tracking-tight">Request a visit</h1>
      <p className="mt-3 max-w-2xl text-muted">
        Pick a service, a day, a time, and waiter or drop-off. This stays a request until the shop confirms it. The menu shows labor time only.
      </p>
      <div role="group" aria-label="Store" className="tap-targets mt-4 flex flex-wrap gap-2">
        {STORES.map((store) => (
          <Button
            key={store.id}
            small
            tone={shop.activeStoreId === store.id ? "primary" : "ghost"}
            aria-pressed={shop.activeStoreId === store.id}
            onClick={() => switchStore(store.id)}
          >
            {store.label}
          </Button>
        ))}
      </div>

      {step === "lookup" ? (
        <form
          className="card mt-4 grid max-w-xl gap-3"
          onSubmit={(event) => {
            event.preventDefault();
            findRecord();
          }}
        >
          <Field label="Phone, email, or last 8 of the VIN">
            <input className="field" value={query} autoComplete="username" onChange={(event) => setQuery(event.target.value)} />
          </Field>
          {error ? <p role="alert" className="text-sm text-primary">{error}</p> : null}
          <div className="flex flex-wrap gap-2">
            <Button tone="primary" type="submit">Find my record</Button>
            <Button
              type="button"
              onClick={() => {
                setVerified(false);
                setCustomerId(null);
                setNote("Enter your name and vehicle for this request.");
                setError("");
                setStep("details");
              }}
            >
              I'm new
            </Button>
          </div>
        </form>
      ) : null}

      {step === "code" ? (
        <form
          className="card mt-4 grid max-w-xl gap-3"
          onSubmit={(event) => {
            event.preventDefault();
            checkCode();
          }}
        >
          {/* BLOCKER before real SMS or real data: the one-time code is shown on this page for the demo only. */}
          <p role="status" className="text-sm">
            Demo text to the mobile ending {mobileLast4}. The code is <strong className="tabular-nums">{issuedCode}</strong>. Nothing was sent.
          </p>
          <Field label="One-time code">
            <input
              className="field tabular-nums"
              inputMode="numeric"
              autoComplete="one-time-code"
              maxLength={6}
              value={enteredCode}
              onChange={(event) => setEnteredCode(event.target.value)}
            />
          </Field>
          {error ? <p role="alert" className="text-sm text-primary">{error}</p> : null}
          <div className="flex flex-wrap gap-2">
            <Button tone="primary" type="submit">Check code</Button>
            <Button type="button" onClick={() => { setError(""); setStep("lookup"); }}>Back</Button>
          </div>
        </form>
      ) : null}

      {step === "details" ? (
        <form
          className="card mt-4 grid max-w-xl gap-3"
          onSubmit={(event) => {
            event.preventDefault();
            if (verified) {
              if (!vehicleId) {
                setError("Pick a saved vehicle.");
                return;
              }
              setError("");
              setStep("visit");
              return;
            }
            if (!vin.trim()) {
              setError("Enter a 17-character VIN.");
              return;
            }
            const vinProblem = vinScheduleError(vin);
            if (!name.trim() || !make.trim() || !model.trim() || !plate.trim() || vinProblem) {
              setError(vinProblem || "Enter your name, make, model, VIN, and plate.");
              return;
            }
            if (!phone.trim() && !email.trim()) {
              setError("Enter a phone number or an email.");
              return;
            }
            setError("");
            setStep("visit");
          }}
        >
          {note ? <p className="text-sm text-muted">{note}</p> : null}
          {verified ? (
            <fieldset className="grid gap-2">
              <legend className="text-sm font-semibold">Saved vehicles</legend>
              {savedVehicles.length === 0 ? <p className="text-sm text-muted">No saved vehicles on this record.</p> : null}
              {savedVehicles.map((vehicle) => (
                <label key={vehicle.id} className="flex items-center gap-2 text-sm">
                  <input type="radio" name="vehicle" checked={vehicleId === vehicle.id} onChange={() => setVehicleId(vehicle.id)} />
                  <span>{vehicle.year} {vehicle.model} · VIN {vehicle.vin}</span>
                </label>
              ))}
            </fieldset>
          ) : (
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Name"><input className="field" maxLength={80} value={name} onChange={(event) => setName(event.target.value)} /></Field>
              <Field label="Phone"><input className="field" maxLength={20} value={phone} onChange={(event) => setPhone(event.target.value)} /></Field>
              <Field label="Email"><input className="field" maxLength={120} value={email} onChange={(event) => setEmail(event.target.value)} /></Field>
              <Field label="Year"><input className="field tabular-nums" value={year} onChange={(event) => setYear(event.target.value)} /></Field>
              <Field label="Make"><input className="field" value={make} onChange={(event) => setMake(event.target.value)} /></Field>
              <Field label="Model"><input className="field" value={model} onChange={(event) => setModel(event.target.value)} /></Field>
              <Field label="VIN"><input className="field font-mono uppercase" maxLength={17} value={vin} onChange={(event) => setVin(event.target.value.toUpperCase())} /></Field>
              <Field label="License plate"><input className="field uppercase" maxLength={10} value={plate} onChange={(event) => setPlate(event.target.value.toUpperCase())} /></Field>
              <Field label="Notes"><textarea className="field min-h-20" maxLength={500} value={customerNote} onChange={(event) => setCustomerNote(event.target.value)} /></Field>
            </div>
          )}
          {error ? <p role="alert" className="text-sm text-primary">{error}</p> : null}
          <div className="flex flex-wrap gap-2">
            <Button tone="primary" type="submit">Continue</Button>
            <Button type="button" onClick={() => { setError(""); setStep("lookup"); }}>Back</Button>
          </div>
        </form>
      ) : null}

      {step === "visit" ? (
        <form
          className="card mt-4 grid max-w-xl gap-3"
          onSubmit={(event) => {
            event.preventDefault();
            sendRequest();
          }}
        >
          <Field label="Service">
            <select className="field" value={service} onChange={(event) => setServiceId(event.target.value)}>
              {menu.map((row) => <option key={row.id} value={row.id}>{row.name} · {row.laborHours} hr</option>)}
            </select>
          </Field>
          <Field label="How should the shop reach you">
            <select className="field" value={contactMethod} onChange={(event) => setContactMethod(event.target.value as "text" | "email" | "call")}>
              <option value="text">Text</option>
              <option value="email">Email</option>
              <option value="call">Call</option>
            </select>
          </Field>
          <Field label="Waiter or drop-off">
            <select className="field" value={transport} onChange={(event) => setTransportId(event.target.value)}>
              {transports.map((row) => <option key={row.id} value={row.id}>{row.name}</option>)}
            </select>
          </Field>
          <Field label="Day">
            <select className="field" value={day} onChange={(event) => { setDate(event.target.value); setTime(""); }}>
              {dates.map((item) => <option key={item} value={item}>{item}</option>)}
            </select>
          </Field>
          <div>
            <p className="mb-2 text-sm font-semibold">Time</p>
            {times.length === 0 ? <p className="text-sm text-muted">No open times in the booking window for this advisor.</p> : (
              <div className="tap-targets flex flex-wrap gap-2" role="group" aria-label="Open times">
                {times.map((item) => (
                  <Button key={item} small type="button" tone={pickedTime === item ? "primary" : "ghost"} aria-pressed={pickedTime === item} onClick={() => setTime(item)}>
                    {item}
                  </Button>
                ))}
              </div>
            )}
          </div>
          {error ? <p role="alert" className="text-sm text-primary">{error}</p> : null}
          <div className="flex flex-wrap gap-2">
            <Button tone="primary" type="submit" disabled={!pickedTime}>Send request</Button>
            <Button type="button" onClick={() => setStep("details")}>Back</Button>
          </div>
        </form>
      ) : null}

      {step === "sent" && sent ? (
        <div className="card mt-4 max-w-xl" role="status">
          <h2 className="font-display text-3xl leading-none">Request received</h2>
          <p className="mt-3 text-sm text-muted">
            {sent.customerName} · {sent.serviceName} · {sent.date} at {sent.time} · {sent.transportName}. This is waiting for the shop. It is not a confirmed appointment.
          </p>
          <p className="mt-2 text-sm">{sent.verified ? "Identity verified." : "Unverified. The shop will match the record when it confirms the request."}</p>
          <Button className="mt-4" onClick={() => {
            setStep("lookup");
            setSentId(null);
            setQuery("");
            setEnteredCode("");
            setVerified(false);
            setCustomerId(null);
            setVehicleId("");
            setName("");
            setPhone("");
            setEmail("");
            setYear("2020");
            setMake("");
            setModel("");
            setVin("");
            setPlate("");
            setNote("");
            setCustomerNote("");
            setError("");
          }}>Request another</Button>
        </div>
      ) : null}
    </main>
  );
}
