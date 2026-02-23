import type { DB } from "./db";

let dnsPrefetchLink: HTMLLinkElement | null = null;

export function setDnsPrefetch(bangUrl: string) {
  try {
    const origin = new URL(bangUrl.replace("{}", "")).origin;
    if (!dnsPrefetchLink) {
      dnsPrefetchLink = document.createElement("link");
      dnsPrefetchLink.rel = "dns-prefetch";
      document.head.appendChild(dnsPrefetchLink);
    }
    dnsPrefetchLink.href = origin;
  } catch {
    //
  }
}

export async function initDnsPrefetch(db: DB) {
  const defaultBang = (await db.getSetting("default-bang")) || "g";
  const mod = await import("../generated/bangs-full.js");
  const full = mod.BANGS;
  const entry = full[defaultBang];
  if (entry) {
    setDnsPrefetch(entry.u);
  }
}
