import {
  handleOpenSearchRequest,
  handleSuggestRequest,
} from "../src/server/handlers";

const SECURITY_HEADERS: Record<string, string> = {
  "Content-Security-Policy":
    "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; connect-src 'self'; img-src 'self' data:; font-src 'self'; worker-src 'self'; manifest-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'",
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY",
  "Referrer-Policy": "strict-origin-when-cross-origin",
};

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
    const url = new URL(req.url);

    if (url.pathname === "/suggest") {
      const res = await handleSuggestRequest(req);
      for (const [k, v] of Object.entries(SECURITY_HEADERS)) {
        res.headers.set(k, v);
      }
      return res;
    }

    if (url.pathname === "/opensearch.xml") {
      const res = handleOpenSearchRequest(req, url);
      for (const [k, v] of Object.entries(SECURITY_HEADERS)) {
        res.headers.set(k, v);
      }
      return res;
    }

    if (url.pathname === "/bench") {
      return (await serveCompressed(req, "dist/bench.html", {
        "Cross-Origin-Opener-Policy": "same-origin",
        "Cross-Origin-Embedder-Policy": "credentialless",
      }))!;
    }

    const path = url.pathname === "/" ? "/index.html" : url.pathname;
    const fromDist = await serveCompressed(req, `dist${path}`);
    if (fromDist) {
      return fromDist;
    }

    const fromHtml = await serveCompressed(req, `dist${path}.html`);
    if (fromHtml) {
      return fromHtml;
    }

    return (await serveCompressed(req, "dist/index.html"))!;
  },
});
