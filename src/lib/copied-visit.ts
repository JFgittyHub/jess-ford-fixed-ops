import type { CopiedAppointment } from "./paste-appointment";

const PREFIX = "jf-desk-copy:";

const COPY_LIMIT = maxCopiedBytes();

/** Every allowlisted copy fits. A larger raw value is refused instead of dropped quietly. */
export function copyLimit() {
  return COPY_LIMIT;
}

function maxCopiedBytes() {
  const line = { id: "", code: "W".repeat(4), concern: "c".repeat(500), laborOpId: "o".repeat(64), hours: 24 };
  const copy = allowCopiedAppointment({
    customerId: "c".repeat(80),
    vehicleId: "v".repeat(80),
    vin: "1".repeat(17),
    concern: "c".repeat(800),
    lines: Array.from({ length: 20 }, () => line),
    minutes: 100000,
    lane: "l".repeat(80),
    advisorId: "a".repeat(80),
    laborOpIds: Array.from({ length: 20 }, () => "i".repeat(80)),
    lengthOverrideMinutes: 100000,
  } as CopiedAppointment);
  return JSON.stringify({
    workingAsId: "w".repeat(64),
    storeId: "s".repeat(64),
    workerKey: "k".repeat(200),
    copy,
  }).length;
}

/** The copy the desk keeps. Customer id only: no name, phone, email, address, or VIN. */
export type StoredCopy = {
  workingAsId: string;
  storeId: string;
  workerKey: string;
  copy: CopiedAppointment;
};

function text(value: unknown, max: number) {
  return typeof value === "string" ? value.slice(0, max) : "";
}

/** Only the fields Paste needs. Anything else, including a name or VIN, is dropped. */
export function allowCopiedAppointment(copy: CopiedAppointment): CopiedAppointment {
  const lines = Array.isArray(copy.lines) ? copy.lines.filter((line) => line != null && typeof line === "object").slice(0, 12) : [];
  return {
    customerId: text(copy.customerId, 64),
    vehicleId: text(copy.vehicleId, 64),
    vin: "",
    concern: text(copy.concern, 500),
    lines: lines.map((line) => ({
      id: "",
      code: text(line.code, 4),
      concern: text(line.concern, 500),
      ...(typeof line.laborOpId === "string" && line.laborOpId ? { laborOpId: line.laborOpId.slice(0, 64) } : {}),
      ...(typeof line.hours === "number" && Number.isFinite(line.hours) ? { hours: line.hours } : {}),
    })),
    minutes: typeof copy.minutes === "number" && Number.isFinite(copy.minutes) ? copy.minutes : 30,
    lane: text(copy.lane, 32),
    advisorId: text(copy.advisorId, 64),
    laborOpIds: (Array.isArray(copy.laborOpIds) ? copy.laborOpIds : []).slice(0, 12).map((id) => text(id, 64)).filter(Boolean),
    lengthOverrideMinutes: typeof copy.lengthOverrideMinutes === "number" && Number.isFinite(copy.lengthOverrideMinutes) ? copy.lengthOverrideMinutes : null,
  };
}

type KeyedStorage = {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
  key?(index: number): string | null;
  readonly length?: number;
};

export function copyStorageKey(workingAsId: string, storeId: string) {
  return `${PREFIX}${workingAsId}:${storeId}`;
}

export function isCopyStorageKey(key: string | null) {
  return Boolean(key && key.startsWith(PREFIX));
}

function storageKeys(storage: KeyedStorage) {
  if (typeof storage.length === "number" && storage.key) {
    const keys: string[] = [];
    for (let index = 0; index < storage.length; index += 1) {
      const key = storage.key(index);
      if (key) keys.push(key);
    }
    return keys;
  }
  return [];
}

export function saveCopiedVisit(storage: KeyedStorage, record: StoredCopy): { ok: true } | { ok: false; error: string } {
  const stored: StoredCopy = {
    workingAsId: text(record.workingAsId, 64),
    storeId: text(record.storeId, 64),
    workerKey: text(record.workerKey, 200),
    copy: allowCopiedAppointment(record.copy),
  };
  const json = JSON.stringify(stored);
  if (json.length > COPY_LIMIT) return { ok: false, error: "That copy is too long to keep." };
  storage.setItem(copyStorageKey(stored.workingAsId, stored.storeId), json);
  return { ok: true };
}

/**
 * The copy for this Working-as person, store, and worker. An empty person is
 * not a mismatch: a fresh mount must not delete the copy before Working as
 * is restored. A real mismatch is dropped so it cannot leak.
 */
export function readCopiedVisit(storage: KeyedStorage, workingAsId: string, storeId: string, workerKey: string): StoredCopy | null {
  if (!workingAsId || !storeId) return null;
  const key = copyStorageKey(workingAsId, storeId);
  const raw = storage.getItem(key);
  if (!raw) return null;
  if (raw.length > COPY_LIMIT) {
    storage.removeItem(key);
    return null;
  }
  let parsed: StoredCopy;
  try {
    parsed = JSON.parse(raw) as StoredCopy;
  } catch {
    storage.removeItem(key);
    return null;
  }
  if (!parsed?.copy || parsed.workingAsId !== workingAsId || parsed.storeId !== storeId || parsed.workerKey !== workerKey) {
    storage.removeItem(key);
    return null;
  }
  const rawLines = (parsed.copy as { lines?: unknown }).lines;
  if (Array.isArray(rawLines) && rawLines.some((line) => line == null || typeof line !== "object")) {
    storage.removeItem(key);
    return null;
  }
  const clean: StoredCopy = { workingAsId, storeId, workerKey, copy: allowCopiedAppointment(parsed.copy) };
  const json = JSON.stringify(clean);
  if (json !== raw) storage.setItem(key, json);
  return clean;
}

/** Sign-out and a worker change remove the copies for that person. No id removes every copy. */
export function clearCopiedVisits(storage: KeyedStorage, workingAsId?: string) {
  const prefix = workingAsId ? `${PREFIX}${workingAsId}:` : PREFIX;
  for (const key of storageKeys(storage)) {
    if (key.startsWith(prefix)) storage.removeItem(key);
  }
}
