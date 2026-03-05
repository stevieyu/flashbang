import { normalize } from "node:path";
import {
  handleOpenSearchRequest,
  handleSuggestRequest,
} from "../src/server/handlers";
import { pageHeaders, SW_HEADERS } from "../src/server/headers";
import { readPathname } from "../src/shared/raw-url";

const SECURITY_HEADERS = pageHeaders("'unsafe-inline'");

const distIndex = Bun.file("dist/index.html");
if (!(await distIndex.exists())) {
  console.error("dist/index.html not found. Run `bun run build` first.");
  process.exit(1);
}

async function serveCompressed(
  req: Request,
  filePath: string,
  extraHeaders?: Record<string, string>
) {
  const file = Bun.file(filePath);
  if (!(await file.exists())) {
    return null;
  }

  const accept = req.headers.get("accept-encoding") ?? "";
  const contentType = file.type;

  if (accept.includes("br")) {
    const br = Bun.file(`${filePath}.br`);
    if (await br.exists()) {
      return new Response(br, {
        headers: {
          "Content-Encoding": "br",
          "Content-Type": contentType,
          ...SECURITY_HEADERS,
          ...extraHeaders,
        },
      });
    }
  }

  return new Response(file, {
    headers: { ...SECURITY_HEADERS, ...extraHeaders },
  });
}

const port = Number(process.env.PORT) || 3000;
console.log(`Production server: http://localhost:${port}`);

Bun.serve({
  port,
  async fetch(req) {
    const pathname = readPathname(req.url);

    if (pathname === "/suggest") {
      const res = await handleSuggestRequest(req);
      for (const [k, v] of Object.entries(SECURITY_HEADERS)) {
        res.headers.set(k, v);
      }
      return res;
    }

    if (pathname === "/opensearch.xml") {
      const res = handleOpenSearchRequest(req);
      for (const [k, v] of Object.entries(SECURITY_HEADERS)) {
        res.headers.set(k, v);
      }
      return res;
    }

    if (pathname === "/sw.js") {
      const file = Bun.file("dist/sw.js");
      return new Response(file, { headers: SW_HEADERS });
    }

    if (pathname === "/bench") {
      return (await serveCompressed(req, "dist/bench.html", {
        "Cross-Origin-Opener-Policy": "same-origin",
        "Cross-Origin-Embedder-Policy": "credentialless",
      }))!;
    }

    const path = pathname === "/" ? "/index.html" : pathname;
    const normalized = normalize(`dist${path}`);
    if (!normalized.startsWith("dist/")) {
      return new Response("Not found", {
        status: 404,
        headers: SECURITY_HEADERS,
      });
    }
    const fromDist = await serveCompressed(req, normalized);
    if (fromDist) {
      return fromDist;
    }

    const htmlNormalized = normalize(`dist${path}.html`);
    if (htmlNormalized.startsWith("dist/")) {
      const fromHtml = await serveCompressed(req, htmlNormalized);
      if (fromHtml) {
        return fromHtml;
      }
    }

    return (await serveCompressed(req, "dist/index.html"))!;
  },
});
