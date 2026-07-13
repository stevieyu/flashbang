import {
  type CustomBangRecord,
  isCaptureEncoding,
  validateCaptureBang,
  validateSimpleBangUrl,
} from "../shared/capture-template";
import { idbWrap, openDB } from "../shared/idb";
import { validateSnapTarget } from "../shared/snap-target";

const VALID_SETTING_KEYS: Record<string, string> = {
  defaultBang: "default-bang",
  suggestProvider: "suggest-provider",
  suggestUrl: "suggest-url",
  luckyProvider: "lucky-provider",
  luckyUrl: "lucky-url",
};

export class DB {
  private readonly dbp: Promise<IDBDatabase> = openDB();

  private async store(name: string, mode: IDBTransactionMode = "readonly") {
    const db = await this.dbp;
    return db.transaction(name, mode).objectStore(name);
  }

  async getMultipleSettings(keys: string[]): Promise<(string | null)[]> {
    const db = await this.dbp;
    const tx = db.transaction("settings", "readonly");
    const store = tx.objectStore("settings");
    const results = await Promise.all(
      keys.map((key) =>
        idbWrap<{ key: string; value: string } | undefined>(store.get(key))
      )
    );
    return results.map((r) => r?.value ?? null);
  }

  async getSetting(key: string): Promise<string | null> {
    const s = await this.store("settings");
    const r = await idbWrap<{ key: string; value: string } | undefined>(
      s.get(key)
    );
    return r?.value ?? null;
  }

  async setSetting(key: string, value: string) {
    const s = await this.store("settings", "readwrite");
    await idbWrap(s.put({ key, value }));
  }

  async getAllCustomBangs(): Promise<CustomBangRecord[]> {
    const s = await this.store("custom-bangs");
    return idbWrap<CustomBangRecord[]>(s.getAll());
  }

  async addCustomBang(bang: CustomBangRecord) {
    const s = await this.store("custom-bangs", "readwrite");
    await idbWrap(s.put(bang));
  }

  async removeCustomBang(trigger: string) {
    const s = await this.store("custom-bangs", "readwrite");
    await idbWrap(s.delete(trigger));
  }

  async exportAll() {
    const db = await this.dbp;
    const tx = db.transaction(["settings", "custom-bangs"], "readonly");
    const settingsStore = tx.objectStore("settings");
    const [
      defaultBang,
      suggestProvider,
      suggestUrl,
      luckyProvider,
      luckyUrl,
      customBangs,
    ] = await Promise.all([
      idbWrap<{ key: string; value: string } | undefined>(
        settingsStore.get("default-bang")
      ),
      idbWrap<{ key: string; value: string } | undefined>(
        settingsStore.get("suggest-provider")
      ),
      idbWrap<{ key: string; value: string } | undefined>(
        settingsStore.get("suggest-url")
      ),
      idbWrap<{ key: string; value: string } | undefined>(
        settingsStore.get("lucky-provider")
      ),
      idbWrap<{ key: string; value: string } | undefined>(
        settingsStore.get("lucky-url")
      ),
      idbWrap<CustomBangRecord[]>(tx.objectStore("custom-bangs").getAll()),
    ]);
    return {
      settings: {
        defaultBang: defaultBang?.value ?? null,
        suggestProvider: suggestProvider?.value ?? null,
        suggestUrl: suggestUrl?.value ?? null,
        luckyProvider: luckyProvider?.value ?? null,
        luckyUrl: luckyUrl?.value ?? null,
      },
      customBangs,
      exported: new Date().toISOString(),
    };
  }

  async importAll(data: unknown) {
    if (!data || typeof data !== "object") {
      throw new Error("Invalid import data");
    }
    const obj = data as Record<string, unknown>;

    const db = await this.dbp;
    const tx = db.transaction(["settings", "custom-bangs"], "readwrite");
    const settingsStore = tx.objectStore("settings");
    const customStore = tx.objectStore("custom-bangs");
    const ops: Promise<unknown>[] = [
      idbWrap(settingsStore.clear()),
      idbWrap(customStore.clear()),
    ];

    if (obj.settings && typeof obj.settings === "object") {
      const settings = obj.settings as Record<string, unknown>;
      for (const [exportKey, idbKey] of Object.entries(VALID_SETTING_KEYS)) {
        const value = settings[exportKey];
        if (typeof value === "string" && value) {
          ops.push(idbWrap(settingsStore.put({ key: idbKey, value })));
        }
      }
    }

    if (Array.isArray(obj.customBangs)) {
      for (const item of obj.customBangs) {
        if (!item || typeof item !== "object") {
          continue;
        }
        const b = item as Record<string, unknown>;
        if (
          typeof b.trigger !== "string" ||
          typeof b.name !== "string" ||
          typeof b.url !== "string"
        ) {
          continue;
        }
        const regex = typeof b.regex === "string" ? b.regex : undefined;
        const snap = typeof b.snap === "string" ? b.snap : undefined;
        const encoding = isCaptureEncoding(b.encoding) ? b.encoding : undefined;
        const urlError = regex
          ? validateCaptureBang(b.url, regex)
          : validateSimpleBangUrl(b.url);
        const validationError =
          urlError ?? (snap ? validateSnapTarget(snap) : null);
        if (validationError) {
          continue;
        }
        ops.push(
          idbWrap(
            customStore.put({
              trigger: b.trigger,
              name: b.name,
              url: b.url,
              ...(regex ? { regex, encoding: encoding ?? "percent" } : {}),
              ...(snap ? { snap } : {}),
            })
          )
        );
      }
    }

    await Promise.all(ops);
  }
}

export async function readCustomBangs(db: DB): Promise<string[]> {
  const customBangs = await db.getAllCustomBangs();
  return customBangs.map((b) => b.trigger);
}
