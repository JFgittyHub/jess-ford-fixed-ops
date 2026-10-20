import { useEffect, useState } from "react";

export type Session =
  | { role: "admin" }
  | { role: "advisor"; id: string }
  | { role: "tech"; id: string };

const KEY = "jess-ford-session";
const EVENT = "jess-session";

const ADVISOR_PATHS = ["/schedule", "/orders", "/estimates", "/parts"];
const TECH_PATHS = ["/tech-board", "/schedule", "/orders"];

export function readSession(): Session | null {
  try {
    const raw = sessionStorage.getItem(KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Session;
    if (parsed?.role === "admin") return { role: "admin" };
    if ((parsed?.role === "advisor" || parsed?.role === "tech") && typeof parsed.id === "string") return parsed;
  } catch {
    return null;
  }
  return null;
}

export function writeSession(session: Session | null) {
  if (session) sessionStorage.setItem(KEY, JSON.stringify(session));
  else sessionStorage.removeItem(KEY);
  window.dispatchEvent(new Event(EVENT));
}

export function pathAllowed(session: Session, path: string) {
  if (session.role === "admin") return true;
  if (session.role === "tech") return TECH_PATHS.some((item) => path === item || path.startsWith(`${item}/`));
  return ADVISOR_PATHS.some((item) => path === item || path.startsWith(`${item}/`));
}

export function homeFor(session: Session) {
  if (session.role === "tech") return "/tech-board";
  if (session.role === "advisor") return "/orders";
  return "/";
}

export function useSession() {
  const [session, setSession] = useState<Session | null>(null);
  const [ready, setReady] = useState(false);
  useEffect(() => {
    setSession(readSession());
    setReady(true);
    const sync = () => setSession(readSession());
    window.addEventListener(EVENT, sync);
    return () => window.removeEventListener(EVENT, sync);
  }, []);
  return { session, ready };
}
