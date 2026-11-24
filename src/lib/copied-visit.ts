import type { CopiedAppointment } from "./paste-appointment";

const PREFIX = "jf-desk-copy:";

/** The copy the desk keeps. Only the fields Paste already uses, plus the name on the card. */
export type StoredCopy = {
  userId: string;
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

export function copyStorageKey(userId: string, storeId: string) {
  return `${PREFIX}${userId}:${storeId}`;
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
  storage.setItem(copyStorageKey(record.userId, record.storeId), JSON.stringify(record));
}

/** The copy for this user, store, and worker. A mismatch is dropped so it cannot leak. */
export function readCopiedVisit(storage: KeyedStorage, userId: string, storeId: string, workerKey: string): StoredCopy | null {
  const raw = storage.getItem(copyStorageKey(userId, storeId));
  if (!raw) return null;
  let parsed: StoredCopy;
  try {
    parsed = JSON.parse(raw) as StoredCopy;
  } catch {
    storage.removeItem(copyStorageKey(userId, storeId));
    return null;
  }
  if (!parsed?.copy || parsed.userId !== userId || parsed.storeId !== storeId || parsed.workerKey !== workerKey) {
    storage.removeItem(copyStorageKey(userId, storeId));
    return null;
  }
  return parsed;
}

/** Sign-out and a worker change remove the copies for that user. */
export function clearCopiedVisits(storage: KeyedStorage, userId?: string) {
  const prefix = userId ? `${PREFIX}${userId}:` : PREFIX;
  for (const key of storageKeys(storage)) {
    if (key.startsWith(prefix)) storage.removeItem(key);
  }
}
