import type { CopiedAppointment } from "./paste-appointment";

const PREFIX = "jf-desk-copy:";

/** The copy the desk keeps. Keyed by who is Working as and the store, until sign-in exists. The VIN is not stored. */
export type StoredCopy = {
  workingAsId: string;
  storeId: string;
  workerKey: string;
  name: string;
  copy: CopiedAppointment;
};

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

export function saveCopiedVisit(storage: KeyedStorage, record: StoredCopy) {
  const stored: StoredCopy = { ...record, copy: { ...record.copy, vin: "" } };
  storage.setItem(copyStorageKey(record.workingAsId, record.storeId), JSON.stringify(stored));
}

/**
 * The copy for this Working-as person, store, and worker. An empty person is
 * not a mismatch: a fresh mount must not delete the copy before Working as
 * is restored. A real mismatch is dropped so it cannot leak.
 */
export function readCopiedVisit(storage: KeyedStorage, workingAsId: string, storeId: string, workerKey: string): StoredCopy | null {
  if (!workingAsId || !storeId) return null;
  const raw = storage.getItem(copyStorageKey(workingAsId, storeId));
  if (!raw) return null;
  let parsed: StoredCopy;
  try {
    parsed = JSON.parse(raw) as StoredCopy;
  } catch {
    storage.removeItem(copyStorageKey(workingAsId, storeId));
    return null;
  }
  if (!parsed?.copy || parsed.workingAsId !== workingAsId || parsed.storeId !== storeId || parsed.workerKey !== workerKey) {
    storage.removeItem(copyStorageKey(workingAsId, storeId));
    return null;
  }
  return { ...parsed, copy: { ...parsed.copy, vin: "" } };
}

/** Sign-out and a worker change remove the copies for that person. No id removes every copy. */
export function clearCopiedVisits(storage: KeyedStorage, workingAsId?: string) {
  const prefix = workingAsId ? `${PREFIX}${workingAsId}:` : PREFIX;
  for (const key of storageKeys(storage)) {
    if (key.startsWith(prefix)) storage.removeItem(key);
  }
}
