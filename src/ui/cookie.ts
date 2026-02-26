import type { DB } from "./db";

export interface CookieFrecencyData {
  frecent: string[];
  custom: string[];
}

export async function readFrecencyData(db: DB): Promise<CookieFrecencyData> {
  const [frecencyRaw, customBangs] = await Promise.all([
    db.getSetting("frecency"),
    db.getAllCustomBangs(),
  ]);

  let frecent: string[] = [];
  if (frecencyRaw) {
    try {
      const counts: Record<string, number> = JSON.parse(frecencyRaw);
      frecent = Object.entries(counts)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 8)
        .map(([t, c]) => `${t}:${c}`);
    } catch {
      /* ignore corrupt data */
    }
  }

  return { frecent, custom: customBangs.map((b) => b.trigger) };
}

export function setSuggestCookie(
  provider: string,
  trigger: string,
  customUrl: string,
  frecent?: string[],
  custom?: string[]
) {
  let value = `${provider},${trigger},${encodeURIComponent(customUrl)}`;
  if (frecent?.length || custom?.length) {
    value += `|${(frecent || []).join(".")}|${(custom || []).join(".")}`;
  }
  document.cookie = `suggest=${value};path=/;max-age=31536000;SameSite=Lax`;
}
