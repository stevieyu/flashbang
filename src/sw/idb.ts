import { BANGS } from "../generated/bangs-min.js";
import { idbWrap, openDB } from "../shared/idb";
import type { RedirectSettings } from "./redirect";

const DEFAULT_URL = "https://www.google.com/search?q={}";

const LUCKY_URLS: Record<string, string> = {
  g: "https://www.google.com/search?q={}&btnI=1",
  ddg: "https://duckduckgo.com/?q=\\{}",
  kagi: "https://kagi.com/search?q=\\{}",
};
const DEFAULT_LUCKY_URL = "https://duckduckgo.com/?q=\\{}";

let dbPromise: Promise<IDBDatabase> | null = null;

function getDB(): Promise<IDBDatabase> {
  if (!dbPromise) {
    dbPromise = openDB();
  }
  return dbPromise;
}

let cachedRedirect: RedirectSettings | null = null;
let frecencyCounts: Record<string, number> | null = null;
let frecencyCookie: string = "";

export function getCachedSettings(): RedirectSettings | null {
  return cachedRedirect;
}

export async function readRedirectSettings(): Promise<RedirectSettings> {
  if (cachedRedirect) {
    return cachedRedirect;
  }
  try {
    const db = await getDB();
    const tx = db.transaction(["settings", "custom-bangs"], "readonly");
    const store = tx.objectStore("settings");
    const [result, luckyProviderResult, luckyUrlResult, all] =
      await Promise.all([
        idbWrap(store.get("default-bang")),
        idbWrap(store.get("lucky-provider")),
        idbWrap(store.get("lucky-url")),
        idbWrap(tx.objectStore("custom-bangs").getAll()),
      ]);
    const defaultBang = result?.value || "g";
    const defaultUrl = BANGS[defaultBang] || DEFAULT_URL;
    const luckyProvider = luckyProviderResult?.value ?? "default";
    let luckyUrl: string | null;
    switch (luckyProvider) {
      case "none":
        luckyUrl = null;
        break;
      case "google":
        luckyUrl = LUCKY_URLS.g;
        break;
      case "ddg":
        luckyUrl = LUCKY_URLS.ddg;
        break;
      case "kagi":
        luckyUrl = LUCKY_URLS.kagi;
        break;
      case "custom":
        luckyUrl = luckyUrlResult?.value || null;
        break;
      default:
        luckyUrl = LUCKY_URLS[defaultBang] || DEFAULT_LUCKY_URL;
        break;
    }
    const custom: Record<string, string> = {};
    for (const e of all) {
      custom[e.trigger] = e.url;
    }

    cachedRedirect = { defaultUrl, custom, luckyUrl };
  } catch {
    cachedRedirect = {
      defaultUrl: DEFAULT_URL,
      custom: {},
      luckyUrl: DEFAULT_LUCKY_URL,
    };
  }

  return cachedRedirect;
}

export function invalidateCache() {
  cachedRedirect = null;
  dbPromise = null;
  frecencyCounts = null;
  frecencyCookie = "";
}

function regenerateFrecencyValue(): void {
  if (!frecencyCounts) {
    frecencyCookie = "";
    return;
  }
  const entries = Object.entries(frecencyCounts);
  entries.sort((a, b) => b[1] - a[1]);
  const top = entries.slice(0, 8);
  if (top.length === 0) {
    frecencyCookie = "";
    return;
  }
  frecencyCookie = top.map(([k, v]) => `${k}:${v}`).join(".");
}

export function getFrecencyValue(): string {
  return frecencyCookie;
}

export async function loadFrecency(): Promise<void> {
  if (frecencyCounts) {
    return;
  }
  try {
    const db = await getDB();
    const tx = db.transaction("settings", "readonly");
    const store = tx.objectStore("settings");
    const result = await idbWrap(store.get("frecency"));
    frecencyCounts = result?.value ? JSON.parse(result.value) : {};
    regenerateFrecencyValue();
  } catch {
    frecencyCounts = {};
  }
}

export function trackBangUsage(trigger: string) {
  if (!frecencyCounts) {
    frecencyCounts = {};
  }
  frecencyCounts[trigger] = (frecencyCounts[trigger] || 0) + 1;
  regenerateFrecencyValue();

  // Fire-and-forget IDB write for persistence across SW restarts
  getDB()
    .then((db) => {
      const tx = db.transaction("settings", "readwrite");
      const store = tx.objectStore("settings");
      store.put({
        key: "frecency",
        value: JSON.stringify(frecencyCounts),
      });
    })
    .catch(() => {
      /* fire-and-forget */
    });
}
