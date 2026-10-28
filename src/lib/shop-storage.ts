/**
 * Browser persistence for the shop. Demo mode keeps the visit in memory:
 * nothing is written, a reload starts from the sample month again, and a
 * previously saved sample-month blob is removed. A real shop blob is left
 * where it is so a later non-demo visit can still open it.
 */

export const SHOP_STORAGE_KEY = "jess-ford-fixed-ops-v1";
export const SCORECARD_STORAGE_KEY = "jess-ford-scorecard-v2";

export interface ShopStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

/** Dataset label inside a raw shop blob or a zustand persist envelope. */
export function persistedShopDataset(raw: string | null): string | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as { state?: { dataset?: unknown }; dataset?: unknown };
    const dataset = parsed?.state && typeof parsed.state === "object" ? parsed.state.dataset : parsed?.dataset;
    return typeof dataset === "string" ? dataset : null;
  } catch {
    return null;
  }
}

export function isPersistedDemoShop(raw: string | null): boolean {
  return persistedShopDataset(raw) === "sample";
}

function safeGet(backing: ShopStorage, key: string): string | null {
  try {
    return backing.getItem(key);
  } catch {
    return null;
  }
}

function safeRemove(backing: ShopStorage, key: string) {
  try {
    backing.removeItem(key);
  } catch {
    /* storage unavailable */
  }
}

/**
 * Drop demo leftovers. The shop key goes only when it is the sample month.
 * The scorecard key has no dataset label, so a demo visit drops it too rather
 * than leaving demo numbers behind. A real shop record stays.
 */
export function scrubDemoStorage(backing: ShopStorage): void {
  if (isPersistedDemoShop(safeGet(backing, SHOP_STORAGE_KEY))) safeRemove(backing, SHOP_STORAGE_KEY);
  safeRemove(backing, SCORECARD_STORAGE_KEY);
}

/** Storage adapter for zustand persist. `demoMode` must be the explicit demo flag. */
export function shopPersistStorage(demoMode: boolean, backing: ShopStorage): ShopStorage {
  if (!demoMode) return backing;
  return {
    getItem() {
      scrubDemoStorage(backing);
      return null;
    },
    setItem() {
      scrubDemoStorage(backing);
    },
    removeItem() {
      scrubDemoStorage(backing);
    },
  };
}

export function browserLocalStorage(): ShopStorage {
  return {
    getItem(key) {
      try {
        return globalThis.localStorage.getItem(key);
      } catch {
        return null;
      }
    },
    setItem(key, value) {
      try {
        globalThis.localStorage.setItem(key, value);
      } catch {
        /* storage unavailable */
      }
    },
    removeItem(key) {
      try {
        globalThis.localStorage.removeItem(key);
      } catch {
        /* storage unavailable */
      }
    },
  };
}
