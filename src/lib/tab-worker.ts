const KEY = "jf-desk-working-as";

type TabStorage = {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
};

type TabSlot = { person: string; storeId: string; owner: string };

function parseSlot(raw: string | null): TabSlot | null {
  if (!raw) return null;
  if (!raw.startsWith("{")) return { person: raw, storeId: "", owner: "" };
  try {
    const parsed = JSON.parse(raw) as Partial<TabSlot>;
    const storeId = parsed.storeId === "pullman" || parsed.storeId === "grand-coulee" ? parsed.storeId : "";
    return {
      person: typeof parsed.person === "string" ? parsed.person : "",
      storeId,
      owner: typeof parsed.owner === "string" ? parsed.owner : "",
    };
  } catch {
    return null;
  }
}

/** Who is Working as in this tab. A window.open clone does not keep the opener's person. */
export function readTabWorker(storage: TabStorage, owner = "") {
  return readTabSlot(storage, owner)?.person ?? "";
}

export function readTabSlot(storage: TabStorage, owner = ""): { person: string; storeId: string } | null {
  const slot = parseSlot(storage.getItem(KEY));
  if (!slot) return null;
  if (slot.owner && owner && slot.owner !== owner) {
    storage.removeItem(KEY);
    return null;
  }
  if (!slot.person && !slot.storeId) return null;
  return { person: slot.person, storeId: slot.storeId };
}

export function writeTabWorker(storage: TabStorage, person: string, extra?: { storeId?: string; owner?: string }) {
  const current = parseSlot(storage.getItem(KEY));
  const storeId = extra?.storeId || current?.storeId || "";
  const owner = extra?.owner || current?.owner || "";
  if (!person && !storeId) {
    storage.removeItem(KEY);
    return;
  }
  const next: TabSlot = { person, storeId, owner };
  storage.setItem(KEY, JSON.stringify(next));
}

export function clearTabWorker(storage: TabStorage) {
  storage.removeItem(KEY);
}

/** Drop the tab slot for the duration of window.open so the new window does not inherit it. */
export function withoutTabWorker<T>(storage: TabStorage, open: () => T): T {
  const saved = storage.getItem(KEY);
  if (saved != null) storage.removeItem(KEY);
  try {
    return open();
  } finally {
    if (saved != null) storage.setItem(KEY, saved);
  }
}
