import { DB_VERSION } from "./constants";

const DB_NAME = "flashbang";

let dbPromise: Promise<IDBDatabase> | null = null;

export function openDB(): Promise<IDBDatabase> {
  if (!dbPromise) {
    dbPromise = new Promise((ok, err) => {
      const r = indexedDB.open(DB_NAME, DB_VERSION);
      r.onupgradeneeded = (event) => {
        const db = r.result;
        const oldVersion = event.oldVersion;
        if (oldVersion < 1) {
          db.createObjectStore("settings", { keyPath: "key" });
          db.createObjectStore("custom-bangs", { keyPath: "trigger" });
        }
      };
      r.onsuccess = () => ok(r.result);
      r.onerror = () => err(r.error);
    });
  }
  return dbPromise;
}

export function resetDB(): void {
  dbPromise = null;
}

export function idbWrap<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((ok, err) => {
    req.onsuccess = () => ok(req.result);
    req.onerror = () => err(req.error);
  });
}
