declare const self: ServiceWorkerGlobalScope;

import { COOKIE_MAX_AGE_S } from "../shared/constants";
import {
  getCachedSettings,
  getFrecencyValue,
  invalidateCache,
  loadFrecency,
  readRedirectSettings,
  trackBangUsage,
} from "./idb";
import { type RedirectSettings, redirectRaw, redirectUrl } from "./redirect";

declare const __CACHE_VERSION__: string;
declare const __EXTRA_ASSETS__: string[];

const CACHE_NAME = __CACHE_VERSION__;
const ASSETS = [
  "/home",
  "/bench",
  "/bench.js",
  "/app.js",
  "/icon.svg",
  "/manifest.json",
  ...__EXTRA_ASSETS__,
];

const CRITICAL_ASSETS: string[] = [];
const OPTIONAL_ASSETS = [...new Set(ASSETS)];
const PRECACHE_CONCURRENCY = 4;
let optionalPrecachePromise: Promise<void> | null = null;

async function precacheAssets(
  cacheName: string,
  assetPaths: readonly string[]
): Promise<void> {
  if (assetPaths.length === 0) {
    return;
  }
  const cache = await caches.open(cacheName);
  let nextIndex = 0;

  async function work(): Promise<void> {
    while (true) {
      const idx = nextIndex++;
      if (idx >= assetPaths.length) {
        return;
      }
      const assetPath = assetPaths[idx];
      const req = new Request(assetPath);
      const res = await fetch(req);
      if (!res.ok) {
        throw new Error(
          `Failed to precache ${assetPath}: ${res.status} ${res.statusText}`
        );
      }
      await cache.put(req, res);
    }
  }

  const workers = Math.min(PRECACHE_CONCURRENCY, assetPaths.length);
  await Promise.all(Array.from({ length: workers }, () => work()));
}

async function deleteOldCaches(cacheName: string): Promise<void> {
  const keys = await caches.keys();
  await Promise.all(
    keys.filter((k) => k !== cacheName).map((k) => caches.delete(k))
  );
}

function ensureOptionalPrecache(): Promise<void> {
  if (optionalPrecachePromise) {
    return optionalPrecachePromise;
  }
  optionalPrecachePromise = precacheAssets(CACHE_NAME, OPTIONAL_ASSETS).catch(
    () => {
      /* best-effort */
    }
  );
  return optionalPrecachePromise;
}

self.addEventListener("install", (e: ExtendableEvent) => {
  e.waitUntil(
    Promise.all([
      self.skipWaiting(),
      precacheAssets(CACHE_NAME, CRITICAL_ASSETS),
    ]).then(() => {
      /* no-op */
    })
  );
});

self.addEventListener("activate", (e: ExtendableEvent) => {
  void readRedirectSettings();
  void loadFrecency();
  e.waitUntil(
    Promise.all([deleteOldCaches(CACHE_NAME), self.clients.claim()]).then(
      () => {
        /* no-op */
      }
    )
  );
});

self.addEventListener("message", (e: ExtendableMessageEvent) => {
  if (e.data?.type === "invalidate") {
    invalidateCache();
  }
  if (e.data?.type === "claim") {
    e.waitUntil(self.clients.claim());
  }
  if (e.data?.type === "redirect" && e.data.query) {
    const q = e.data.query as string;
    const resolve = (s: RedirectSettings) => {
      (e.source as Client)?.postMessage({
        url: redirectUrl(q, s),
      });
    };
    const cached = getCachedSettings();
    if (cached) {
      resolve(cached);
    } else {
      readRedirectSettings().then(resolve);
    }
  }
});

self.addEventListener("fetch", (e: FetchEvent) => {
  const raw = e.request.url;

  if (raw.includes("/__dev/")) {
    return;
  }

  const qIdx = raw.indexOf("?q=");
  if (qIdx !== -1) {
    const vStart = qIdx + 3;
    const vEnd = raw.indexOf("&", vStart);
    const rawQ =
      vEnd === -1 ? raw.substring(vStart) : raw.substring(vStart, vEnd);
    if (rawQ) {
      const cached = getCachedSettings();
      const respond = (s: RedirectSettings): Response => {
        const [resp, trigger] = redirectRaw(rawQ, s);
        if (trigger) {
          trackBangUsage(trigger);
          const val = getFrecencyValue();
          if (val && typeof cookieStore !== "undefined") {
            cookieStore.set({
              name: "sf",
              value: val,
              path: "/",
              expires: Date.now() + COOKIE_MAX_AGE_S * 1000,
              sameSite: "lax",
            });
          }
        }
        return resp;
      };
      if (cached) {
        e.respondWith(respond(cached));
      } else {
        e.respondWith(readRedirectSettings().then(respond));
      }
      return;
    }
  }

  if (
    raw.endsWith("/") ||
    raw.endsWith("/settings") ||
    raw.endsWith("/home") ||
    raw.endsWith("/bench")
  ) {
    e.waitUntil(ensureOptionalPrecache());
  }

  if (raw.endsWith("/bench")) {
    e.respondWith(
      caches
        .match(new Request("/bench"))
        .then(
          (r) =>
            r ||
            fetch("/bench").catch(
              () => new Response("Offline", { status: 503 })
            )
        )
        .then((r) => {
          const h = new Headers(r.headers);
          h.set("Cross-Origin-Opener-Policy", "same-origin");
          h.set("Cross-Origin-Embedder-Policy", "credentialless");
          return new Response(r.body, { status: r.status, headers: h });
        })
    );
    return;
  }

  if (
    raw.endsWith("/") ||
    raw.endsWith("/index.html") ||
    raw.endsWith("/settings")
  ) {
    e.respondWith(
      caches
        .match(new Request("/home"))
        .then(
          (r) =>
            r ||
            fetch("/home").catch(() => new Response("Offline", { status: 503 }))
        )
    );
    return;
  }

  e.respondWith(
    caches
      .match(e.request)
      .then(
        (r) =>
          r ||
          fetch(e.request).catch(() => new Response("Offline", { status: 503 }))
      )
      .catch(() => new Response("Offline", { status: 503 }))
  );
});
