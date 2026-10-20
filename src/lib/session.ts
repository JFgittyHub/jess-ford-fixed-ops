import { useEffect, useState } from "react";

/** Office sign-in only. Advisors and technicians are not a session. */
export type Session = { role: "admin" };

const KEY = "jess-ford-session";
const EVENT = "jess-session";

export function readSession(): Session | null {
  try {
    const raw = sessionStorage.getItem(KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { role?: string };
    if (parsed?.role === "admin") return { role: "admin" };
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
