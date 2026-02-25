import type { DB } from "./db";

let dnsLinks: HTMLLinkElement[] = [];

// NOTE: using both links according to https://web.dev/articles/preconnect-and-dns-prefetch
export function setDnsLinks(bangUrl: string) {
  try {
    const origin = new URL(bangUrl.replace("{}", "")).origin;
    if (!dnsLinks.length) {
      const prefetchLink = document.createElement("link");
      const preconnectLink = document.createElement("link");
      prefetchLink.rel = "dns-prefetch";
      preconnectLink.rel = "preconnect";
      document.head.appendChild(preconnectLink);
      document.head.appendChild(prefetchLink);
      dnsLinks.push(prefetchLink);
      dnsLinks.push(preconnectLink);
    }
    dnsLinks = dnsLinks.length
      ? dnsLinks.map((el) => {
          el.href = origin;
          return el;
        })
      : [];
  } catch {
    //
  }
}

export async function initDnsLinks(db: DB) {
  const defaultBang = (await db.getSetting("default-bang")) || "g";
  const mod = await import("../generated/bangs-full.js");
  const full = mod.BANGS;
  const entry = full[defaultBang];
  if (entry) {
    setDnsLinks(entry.u);
  }
}
