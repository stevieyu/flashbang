import { normalize } from "node:path";
import {
  handleOpenSearchRequest,
  handleSuggestRequest,
} from "../src/server/handlers";
import { pageHeaders, SW_HEADERS } from "../src/server/headers";
import { readPathname } from "../src/shared/raw-url";

const SECURITY_HEADERS = pageHeaders("'unsafe-inline'");
const SECURITY_HEADER_ENTRIES: ReadonlyArray<readonly [string, string]> =
  Object.entries(SECURITY_HEADERS);
const IMMUTABLE_CACHE_CONTROL = "public, max-age=31536000, immutable";
const REVALIDATE_CACHE_CONTROL = "public, max-age=0, must-revalidate";
const HASHED_CHUNK_RE = /^\/chunk-[a-z0-9_-]{8,}\.js$/i;

interface StaticAsset {
  br: Bun.BunFile | null;
  file: Bun.BunFile;
  type: string;
}

export function acceptsBrotli(header: string | null): boolean {
  if (!header) {
    return false;
  }

  let explicitQuality: number | undefined;
  let wildcardQuality: number | undefined;
  for (const item of header.split(",")) {
    const [rawCoding, ...parameters] = item.split(";");
    const coding = rawCoding.trim().toLowerCase();
    let quality = 1;
    for (const parameter of parameters) {
      const [rawName, rawValue] = parameter.split("=", 2);
      if (rawName.trim().toLowerCase() === "q") {
        const parsed = Number(rawValue?.trim());
        quality =
          Number.isFinite(parsed) && parsed >= 0 && parsed <= 1 ? parsed : 0;
      }
    }

    if (coding === "br") {
      explicitQuality = Math.max(explicitQuality ?? 0, quality);
    } else if (coding === "*") {
      wildcardQuality = Math.max(wildcardQuality ?? 0, quality);
    }
  }

  return (explicitQuality ?? wildcardQuality ?? 0) > 0;
}

export function cacheControlForAsset(assetPath: string): string {
  if (assetPath === "/sw.js" || assetPath.endsWith(".html")) {
    return "no-cache";
  }
  return HASHED_CHUNK_RE.test(assetPath)
    ? IMMUTABLE_CACHE_CONTROL
    : REVALIDATE_CACHE_CONTROL;
}

export function staticAssetHeaders(
  assetPath: string,
  contentType: string,
  compressed: boolean,
  extraHeaders?: Record<string, string>
): Record<string, string> {
  return {
    "Content-Type": contentType,
    "Cache-Control": cacheControlForAsset(assetPath),
    Vary: "Accept-Encoding",
    ...(compressed ? { "Content-Encoding": "br" } : {}),
    ...SECURITY_HEADERS,
    ...extraHeaders,
  };
}

function buildStaticManifest(): Map<string, StaticAsset> {
  const files = [...new Bun.Glob("**/*").scanSync("dist")];
  const byName = new Set(files);
  const map = new Map<string, StaticAsset>();

  for (const name of files) {
    if (name.endsWith(".br")) {
      continue;
    }
    const file = Bun.file(`dist/${name}`);
    const br = byName.has(`${name}.br`) ? Bun.file(`dist/${name}.br`) : null;
    map.set(`/${name}`, { file, br, type: file.type });
  }

  return map;
}

function serveCompressed(
  manifest: ReadonlyMap<string, StaticAsset>,
  req: Request,
  assetPath: string,
  extraHeaders?: Record<string, string>
): Response | null {
  const asset = manifest.get(assetPath);
  if (!asset) {
    return null;
  }

  const compressed =
    asset.br !== null && acceptsBrotli(req.headers.get("accept-encoding"));
  return new Response(compressed ? asset.br : asset.file, {
    headers: staticAssetHeaders(
      assetPath,
      asset.type,
      compressed,
      extraHeaders
    ),
  });
}

async function main(): Promise<void> {
  const distIndex = Bun.file("dist/index.html");
  if (!(await distIndex.exists())) {
    console.error("dist/index.html not found. Run `bun run build` first.");
    process.exit(1);
  }

  const staticManifest = buildStaticManifest();
  const port = Number(process.env.PORT) || 3000;
  console.log(`Production server: http://localhost:${port}`);

  Bun.serve({
    port,
    async fetch(req) {
      const pathname = readPathname(req.url);

      if (pathname === "/health") {
        return new Response("ok");
      }

      if (pathname === "/suggest") {
        const res = await handleSuggestRequest(req);
        for (const [k, v] of SECURITY_HEADER_ENTRIES) {
          res.headers.set(k, v);
        }
        return res;
      }

      if (pathname === "/opensearch.xml") {
        const res = handleOpenSearchRequest(req);
        for (const [k, v] of SECURITY_HEADER_ENTRIES) {
          res.headers.set(k, v);
        }
        return res;
      }

      if (pathname === "/sw.js") {
        return serveCompressed(staticManifest, req, "/sw.js", SW_HEADERS)!;
      }

      if (pathname === "/bench") {
        return serveCompressed(staticManifest, req, "/bench.html", {
          "Cross-Origin-Opener-Policy": "same-origin",
          "Cross-Origin-Embedder-Policy": "credentialless",
        })!;
      }

      const path = pathname === "/" ? "/index.html" : pathname;
      const normalized = normalize(`dist${path}`);
      if (!normalized.startsWith("dist/")) {
        return new Response("Not found", {
          status: 404,
          headers: SECURITY_HEADERS,
        });
      }
      const fromDist = serveCompressed(
        staticManifest,
        req,
        `/${normalized.substring(5)}`
      );
      if (fromDist) {
        return fromDist;
      }

      const htmlNormalized = normalize(`dist${path}.html`);
      if (htmlNormalized.startsWith("dist/")) {
        const fromHtml = serveCompressed(
          staticManifest,
          req,
          `/${htmlNormalized.substring(5)}`
        );
        if (fromHtml) {
          return fromHtml;
        }
      }

      return serveCompressed(staticManifest, req, "/index.html")!;
    },
  });
}

if (import.meta.main) {
  await main();
}
