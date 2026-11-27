const KEY = "jf-desk-working-as";

type TabStorage = {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
};

/** Who is Working as in this tab. A new tab has its own empty slot. */
export function readTabWorker(storage: TabStorage) {
  return storage.getItem(KEY) ?? "";
}

export function writeTabWorker(storage: TabStorage, id: string) {
  if (id) storage.setItem(KEY, id);
  else storage.removeItem(KEY);
}
