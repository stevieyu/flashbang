import { idbWrap, openDB } from "../shared/idb";

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

  async importAll(data: {
    settings: {
      defaultBang?: string;
      suggestProvider?: string;
      suggestUrl?: string;
      luckyProvider?: string;
      luckyUrl?: string;
    };
    customBangs?: Array<{ trigger: string; name: string; url: string }>;
  }) {
    const db = await this.dbp;
    const tx = db.transaction(["settings", "custom-bangs"], "readwrite");
    const settingsStore = tx.objectStore("settings");
    const customStore = tx.objectStore("custom-bangs");
    const ops: Promise<unknown>[] = [];

    const map: Record<string, string | undefined> = {
      "default-bang": data.settings?.defaultBang,
      "suggest-provider": data.settings?.suggestProvider,
      "suggest-url": data.settings?.suggestUrl,
      "lucky-provider": data.settings?.luckyProvider,
      "lucky-url": data.settings?.luckyUrl,
    };
    for (const [key, value] of Object.entries(map)) {
      if (value) {
        ops.push(idbWrap(settingsStore.put({ key, value })));
      }
    }
    if (Array.isArray(data.customBangs)) {
      for (const b of data.customBangs) {
        ops.push(idbWrap(customStore.put(b)));
      }
    }
    await Promise.all(ops);
  }
}
