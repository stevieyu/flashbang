import type { DB } from "./db";

export async function readCustomBangs(db: DB): Promise<string[]> {
  const customBangs = await db.getAllCustomBangs();
  return customBangs.map((b) => b.trigger);
}

export function setSuggestCookie(
  provider: string,
  trigger: string,
  customUrl: string,
  custom?: string[]
) {
  let value = `${provider},${trigger},${encodeURIComponent(customUrl)}`;
  if (custom?.length) {
    value += `||${custom.join(".")}`;
  }
  document.cookie = `suggest=${value};path=/;max-age=31536000;SameSite=Lax;Secure`;
}
