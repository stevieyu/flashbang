import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { installFakeIndexedDb, reqToPromise } from "./helpers/fake-indexeddb";

let restoreIndexedDb: (() => void) | null = null;

function loadSharedIdb() {
  return import("../src/shared/idb");
}

function loadSwIdb() {
  return import("../src/sw/idb");
}

async function seedDb(data: {
  customBangs?: Array<{ trigger: string; url: string }>;
  settings?: Array<{ key: string; value: string }>;
}): Promise<void> {
  const shared = await loadSharedIdb();
  shared.resetDB();
  const db = await shared.openDB();
  const tx = db.transaction(["settings", "custom-bangs"], "readwrite");
  const settingsStore = tx.objectStore("settings");
  const customStore = tx.objectStore("custom-bangs");

  if (data.settings) {
    for (const row of data.settings) {
      await reqToPromise(settingsStore.put(row));
    }
  }

  if (data.customBangs) {
    for (const row of data.customBangs) {
      await reqToPromise(customStore.put(row));
    }
  }
}

beforeEach(async () => {
  restoreIndexedDb = installFakeIndexedDb();
  const shared = await loadSharedIdb();
  shared.resetDB();
  const swIdb = await loadSwIdb();
  swIdb.invalidateCache();
});

afterEach(() => {
  restoreIndexedDb?.();
  restoreIndexedDb = null;
});

describe("sw/idb redirect settings", () => {
  test("reads default/lucky/custom settings from IndexedDB", async () => {
    await seedDb({
      settings: [
        { key: "default-bang", value: "ddg" },
        { key: "lucky-provider", value: "custom" },
        { key: "lucky-url", value: "https://lucky.example/?q={}" },
      ],
      customBangs: [
        { trigger: "mydocs", url: "https://docs.example/search?q={}" },
      ],
    });

    const mod = await loadSwIdb();
    const settings = await mod.readRedirectSettings();

    expect(settings.defaultUrl[0]).toContain("duckduckgo.com");
    expect(settings.luckyUrl).toEqual(["https://lucky.example/?q=", ""]);
    expect(settings.custom.mydocs).toEqual([
      "https://docs.example/search?q=",
      "",
    ]);
  });

  test("returns safe defaults when IndexedDB is unavailable", async () => {
    (globalThis as { indexedDB?: unknown }).indexedDB = {
      open() {
        throw new Error("boom");
      },
    };

    const shared = await loadSharedIdb();
    shared.resetDB();

    const mod = await loadSwIdb();
    const settings = await mod.readRedirectSettings();

    expect(settings.defaultUrl[0]).toContain("google.com/search?q=");
    expect(settings.luckyUrl?.[0]).toContain("duckduckgo.com/?q=");
    expect(settings.custom).toEqual(Object.create(null));
  });
});

describe("sw/idb frecency", () => {
  test("loads compact frecency format and exposes top entries", async () => {
    await seedDb({
      settings: [{ key: "frecency", value: `${Date.now()}|g:5,ddg:2` }],
    });

    const mod = await loadSwIdb();
    await mod.loadFrecency();
    expect(mod.hasTopFrecency()).toBe(true);
    expect(mod.getTopFrecencyRecord()).toEqual({ g: 5, ddg: 2 });
  });

  test("migrates legacy JSON frecency format", async () => {
    await seedDb({
      settings: [
        {
          key: "frecency",
          value: JSON.stringify({ c: { g: 2, yt: 1 }, t: Date.now() }),
        },
      ],
    });

    const mod = await loadSwIdb();
    await mod.loadFrecency();
    expect(mod.getTopFrecencyRecord()).toEqual({ g: 2, yt: 1 });
  });

  test("tracks usage and clears caches on invalidate", async () => {
    await seedDb({
      settings: [{ key: "frecency", value: `${Date.now()}|` }],
    });

    const mod = await loadSwIdb();
    await mod.loadFrecency();

    mod.trackBangUsage("yt");
    mod.trackBangUsage("yt");
    mod.trackBangUsage("g");
    expect(mod.getTopFrecencyRecord()).toEqual({ yt: 2, g: 1 });

    mod.invalidateCache();
    expect(mod.hasTopFrecency()).toBe(false);
  });
});
