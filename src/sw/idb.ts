import { BANGS } from "../generated/bangs-min.js";
import {
  DEFAULT_LUCKY_URL,
  DEFAULT_URL,
  FRECENCY_HALF_LIFE_MS,
  LUCKY_URLS,
  MAX_FRECENCY_ENTRIES,
} from "../shared/constants";
import { idbWrap, openDB, resetDB } from "../shared/idb";
import type { RedirectSettings, UrlParts } from "./redirect";

function splitUrl(url: string): UrlParts {
  const idx = url.indexOf("{}");
  return idx === -1
    ? [url, null]
    : [url.substring(0, idx), url.substring(idx + 2)];
}

const FRECENCY_COOKIE_ENTRIES = 8;
const PERSIST_DEBOUNCE_MS = 1000;
const PERSIST_FLUSH_THRESHOLD = 32;

let cachedRedirect: RedirectSettings | null = null;
let redirectSettingsPromise: Promise<RedirectSettings> | null = null;
let frecencyCounts: Record<string, number> | null = null;
let loadFrecencyPromise: Promise<void> | null = null;
let frecencyCookie: string = "";
let lastDecayTs: number = 0;
let pendingPersistTimer: ReturnType<typeof setTimeout> | null = null;
let pendingPersistUpdates = 0;

export function getCachedSettings(): RedirectSettings | null {
  return cachedRedirect;
}

export function readRedirectSettings(): Promise<RedirectSettings> {
  if (cachedRedirect) {
    return Promise.resolve(cachedRedirect);
  }

  if (!redirectSettingsPromise) {
    redirectSettingsPromise = (async () => {
      try {
        const db = await openDB();
        const tx = db.transaction(["settings", "custom-bangs"], "readonly");
        const store = tx.objectStore("settings");
        const [result, luckyProviderResult, luckyUrlResult, all] =
          await Promise.all([
            idbWrap<{ value?: string } | undefined>(store.get("default-bang")),
            idbWrap<{ value?: string } | undefined>(
              store.get("lucky-provider")
            ),
            idbWrap<{ value?: string } | undefined>(store.get("lucky-url")),
            idbWrap<Array<{ trigger: string; url: string }>>(
              tx.objectStore("custom-bangs").getAll()
            ),
          ]);
        const defaultBang = result?.value || "g";
        const tpl = BANGS[defaultBang];
        const defaultUrl: UrlParts = tpl || splitUrl(DEFAULT_URL);
        const luckyProvider = luckyProviderResult?.value ?? "default";
        let luckyUrl: UrlParts | null;
        switch (luckyProvider) {
          case "none":
            luckyUrl = null;
            break;
          case "google":
            luckyUrl = splitUrl(LUCKY_URLS.g);
            break;
          case "ddg":
            luckyUrl = splitUrl(LUCKY_URLS.ddg);
            break;
          case "kagi":
            luckyUrl = splitUrl(LUCKY_URLS.kagi);
            break;
          case "custom":
            luckyUrl = luckyUrlResult?.value
              ? splitUrl(luckyUrlResult.value)
              : null;
            break;
          default:
            luckyUrl = splitUrl(LUCKY_URLS[defaultBang] || DEFAULT_LUCKY_URL);
            break;
        }

        const custom: Record<string, UrlParts> = Object.create(null);
        for (const e of all) {
          custom[e.trigger] = splitUrl(e.url);
        }

        cachedRedirect = { defaultUrl, custom, luckyUrl };
      } catch {
        cachedRedirect = {
          defaultUrl: splitUrl(DEFAULT_URL),
          custom: Object.create(null),
          luckyUrl: splitUrl(DEFAULT_LUCKY_URL),
        };
      }

      return cachedRedirect as RedirectSettings;
    })().finally(() => {
      redirectSettingsPromise = null;
    });
  }

  return redirectSettingsPromise;
}

function persistFrecencySnapshot(
  counts: Record<string, number> | null,
  ts: number
): void {
  const value = JSON.stringify({ c: counts, t: ts });
  openDB()
    .then((db) => {
      const tx = db.transaction("settings", "readwrite");
      const store = tx.objectStore("settings");
      store.put({ key: "frecency", value });
    })
    .catch(() => {
      /* fire-and-forget */
    });
}

export function flushFrecencyNow(): void {
  if (pendingPersistTimer) {
    clearTimeout(pendingPersistTimer);
    pendingPersistTimer = null;
  }
  pendingPersistUpdates = 0;
  if (!frecencyCounts) {
    return;
  }
  persistFrecencySnapshot(frecencyCounts, lastDecayTs);
}

function schedulePersistFrecency(): void {
  pendingPersistUpdates++;
  if (pendingPersistUpdates >= PERSIST_FLUSH_THRESHOLD) {
    flushFrecencyNow();
    return;
  }
  if (pendingPersistTimer) {
    return;
  }
  pendingPersistTimer = setTimeout(() => {
    pendingPersistTimer = null;
    flushFrecencyNow();
  }, PERSIST_DEBOUNCE_MS);
}

export function invalidateCache() {
  flushFrecencyNow();
  cachedRedirect = null;
  redirectSettingsPromise = null;
  loadFrecencyPromise = null;
  resetDB();
  frecencyCounts = null;
  frecencyCookie = "";
  lastDecayTs = 0;
}

function regenerateFrecencyValue(): void {
  const counts = frecencyCounts;
  if (!counts) {
    frecencyCookie = "";
    return;
  }
  const keys = Object.keys(counts);
  const len = keys.length;
  if (len === 0) {
    frecencyCookie = "";
    return;
  }
  keys.sort((a, b) => counts[b] - counts[a]);
  const n = len < FRECENCY_COOKIE_ENTRIES ? len : FRECENCY_COOKIE_ENTRIES;
  let s = `${keys[0]}:${counts[keys[0]]}`;
  for (let i = 1; i < n; i++) {
    s += `.${keys[i]}:${counts[keys[i]]}`;
  }
  frecencyCookie = s;
}

function applyDecay(): void {
  if (!(frecencyCounts && lastDecayTs)) {
    lastDecayTs = Date.now();
    return;
  }
  const now = Date.now();
  const elapsed = now - lastDecayTs;
  if (elapsed < 3_600_000) {
    return;
  }
  const factor = 0.5 ** (elapsed / FRECENCY_HALF_LIFE_MS);
  const pruned: Record<string, number> = {};
  for (const key of Object.keys(frecencyCounts)) {
    const decayed = Math.round(frecencyCounts[key] * factor);
    if (decayed >= 1) {
      pruned[key] = decayed;
    }
  }
  frecencyCounts = pruned;
  lastDecayTs = now;
}

function pruneFrecency(): void {
  if (!frecencyCounts) {
    return;
  }
  const keys = Object.keys(frecencyCounts);
  if (keys.length <= MAX_FRECENCY_ENTRIES) {
    return;
  }
  const entries = Object.entries(frecencyCounts);
  entries.sort((a, b) => b[1] - a[1]);
  frecencyCounts = Object.fromEntries(entries.slice(0, MAX_FRECENCY_ENTRIES));
}

export function getFrecencyValue(): string {
  return frecencyCookie;
}

export function loadFrecency(): Promise<void> {
  if (frecencyCounts) {
    return Promise.resolve();
  }

  if (!loadFrecencyPromise) {
    loadFrecencyPromise = (async () => {
      try {
        const db = await openDB();
        const tx = db.transaction("settings", "readonly");
        const store = tx.objectStore("settings");
        const result = await idbWrap<{ value?: string } | undefined>(
          store.get("frecency")
        );
        const raw = result?.value ? JSON.parse(result.value) : {};

        // Migration: old format is plain counts, new format has {c, t}
        if (raw.c && typeof raw.t === "number") {
          frecencyCounts = raw.c;
          lastDecayTs = raw.t;
        } else {
          frecencyCounts = raw;
          lastDecayTs = Date.now();
        }

        applyDecay();
        pruneFrecency();
        regenerateFrecencyValue();
        schedulePersistFrecency();
      } catch {
        frecencyCounts = {};
        lastDecayTs = Date.now();
      }
    })().finally(() => {
      loadFrecencyPromise = null;
    });
  }

  return loadFrecencyPromise;
}

export function trackBangUsage(trigger: string) {
  if (!frecencyCounts) {
    frecencyCounts = {};
  }
  frecencyCounts[trigger] = (frecencyCounts[trigger] || 0) + 1;
  regenerateFrecencyValue();
  schedulePersistFrecency();
}
