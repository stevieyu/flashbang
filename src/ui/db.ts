import { idbWrap, openDB } from "../shared/idb";

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

  async getAllCustomBangs(): Promise<
    Array<{ trigger: string; name: string; url: string }>
  > {
    const s = await this.store("custom-bangs");
    return idbWrap<Array<{ trigger: string; name: string; url: string }>>(
      s.getAll()
    );
  }

  async addCustomBang(bang: { trigger: string; name: string; url: string }) {
    const s = await this.store("custom-bangs", "readwrite");
    await idbWrap(s.put(bang));
  }

  async removeCustomBang(trigger: string) {
    const s = await this.store("custom-bangs", "readwrite");
    await idbWrap(s.delete(trigger));
  }

  async exportAll() {
    return {
      settings: {
        defaultBang: await this.getSetting("default-bang"),
        suggestProvider: await this.getSetting("suggest-provider"),
        suggestUrl: await this.getSetting("suggest-url"),
        luckyProvider: await this.getSetting("lucky-provider"),
        luckyUrl: await this.getSetting("lucky-url"),
      },
      customBangs: await this.getAllCustomBangs(),
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
    const ops: Promise<unknown>[] = [];

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
        if (!b.url.includes("{}")) {
          continue;
        }
        ops.push(
          idbWrap(
            customStore.put({
              trigger: b.trigger,
              name: b.name,
              url: b.url,
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
