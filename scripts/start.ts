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

const distIndex = Bun.file("dist/index.html");
if (!(await distIndex.exists())) {
  console.error("dist/index.html not found. Run `bun run build` first.");
  process.exit(1);
}

interface StaticAsset {
  br: Bun.BunFile | null;
  file: Bun.BunFile;
  type: string;
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

const STATIC_MANIFEST = buildStaticManifest();
const SW_FILE = STATIC_MANIFEST.get("/sw.js")?.file ?? Bun.file("dist/sw.js");

function serveCompressed(
  req: Request,
  assetPath: string,
  extraHeaders?: Record<string, string>
) {
  const asset = STATIC_MANIFEST.get(assetPath);
  if (!asset) {
    return null;
  }

  const accept = req.headers.get("accept-encoding") ?? "";

  if (asset.br && accept.includes("br")) {
    return new Response(asset.br, {
      headers: {
        "Content-Encoding": "br",
        "Content-Type": asset.type,
        ...SECURITY_HEADERS,
        ...extraHeaders,
      },
    });
  }

  return new Response(asset.file, {
    headers: { ...SECURITY_HEADERS, ...extraHeaders },
  });
}

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
      return new Response(SW_FILE, { headers: SW_HEADERS });
    }

    if (pathname === "/bench") {
      return serveCompressed(req, "/bench.html", {
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
    const fromDist = serveCompressed(req, `/${normalized.substring(5)}`);
    if (fromDist) {
      return fromDist;
    }

    const htmlNormalized = normalize(`dist${path}.html`);
    if (htmlNormalized.startsWith("dist/")) {
      const fromHtml = serveCompressed(req, `/${htmlNormalized.substring(5)}`);
      if (fromHtml) {
        return fromHtml;
      }
    }

    return serveCompressed(req, "/index.html")!;
  },
});
