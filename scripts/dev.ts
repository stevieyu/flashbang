import { watch } from "node:fs";
import { minify } from "@minify-html/node";
import { $ } from "bun";
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

interface SSEClient {
  close: () => void;
  enqueue: (data: string) => void;
}
const clients = new Set<SSEClient>();

function broadcast() {
  const dead: SSEClient[] = [];
  for (const client of clients) {
    try {
      client.enqueue("data: reload\n\n");
    } catch {
      dead.push(client);
    }
  }
  for (const c of dead) {
    clients.delete(c);
  }
}

const LIVE_RELOAD_SCRIPT = `<script>
const __es = new EventSource("/__dev/events");
__es.onmessage = async () => {
  __es.close();
  const regs = await navigator.serviceWorker.getRegistrations();
  await Promise.all(regs.map(r => r.unregister()));
  const keys = await caches.keys();
  await Promise.all(keys.map(k => caches.delete(k)));
  location.reload();
};
addEventListener("beforeunload", () => __es.close());
</script>`;

async function build() {
  const t = performance.now();
  await $`mkdir -p dist`;

  await Promise.all([
    Bun.build({
      entrypoints: ["src/sw/sw.ts"],
      outdir: "dist",
      naming: "sw.js",
      minify: true,
      target: "browser",
      format: "esm",
      define: {
        __CACHE_VERSION__: '"flashbang-dev"',
        __EXTRA_ASSETS__: "[]",
      },
    }),
    Bun.build({
      entrypoints: ["src/ui/app.ts"],
      outdir: "dist",
      naming: "app.js",
      splitting: true,
      minify: true,
      target: "browser",
      format: "esm",
    }),
    Bun.build({
      entrypoints: ["src/ui/bench.ts"],
      outdir: "dist",
      naming: "bench.js",
      minify: true,
      target: "browser",
      format: "esm",
    }),
  ]);

  await $`bunx unocss "src/ui/home.html" "src/ui/bench.html" "src/ui/**/*.ts" -o dist/styles.css --minify`.quiet();

  const css = await Bun.file("dist/styles.css").text();
  const inlineCSS = (src: string) =>
    src.replace(
      '<link rel="stylesheet" href="/styles.css" />',
      `<style>${css}</style>`
    );

  const indexHtml = await Bun.file("src/ui/index.html").text();
  await Bun.write(
    "dist/index.html",
    minify(Buffer.from(indexHtml), { minify_css: true, minify_js: true })
  );

  const homeHtml = await Bun.file("src/ui/home.html").text();
  await Bun.write(
    "dist/home.html",
    minify(Buffer.from(inlineCSS(homeHtml)), {
      minify_css: true,
      minify_js: true,
    })
  );

  const benchHtml = await Bun.file("src/ui/bench.html").text();
  await Bun.write(
    "dist/bench.html",
    minify(Buffer.from(inlineCSS(benchHtml)), {
      minify_css: true,
      minify_js: true,
    })
  );

  await Bun.write("dist/robots.txt", "User-agent: *\nAllow: /\n");

  console.log(`Build done in ${(performance.now() - t).toFixed(0)}ms`);
}

const generated = Bun.file("src/generated/bangs-min.js");
if (!(await generated.exists())) {
  console.warn("Generated bang data not found. Running codegen...");
  await $`bun run codegen`;
}

await build();

let timeout: Timer;
watch("src", { recursive: true }, (_event, filename) => {
  if (
    filename &&
    (filename.endsWith(".test.ts") || filename.endsWith(".test.js"))
  ) {
    return;
  }
  clearTimeout(timeout);
  timeout = setTimeout(async () => {
    console.log("File change detected, rebuilding...");
    try {
      await build();
      broadcast();
    } catch (e) {
      console.error("Build failed:", e);
    }
  }, 200);
});

function injectLiveReload(html: string): string {
  const idx = html.lastIndexOf("</body>");
  if (idx !== -1) {
    return html.slice(0, idx) + LIVE_RELOAD_SCRIPT + html.slice(idx);
  }
  return html + LIVE_RELOAD_SCRIPT;
}

function htmlResponse(
  file: string,
  headers?: Record<string, string>
): Response {
  const content = injectLiveReload(file);
  return new Response(content, {
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      ...SECURITY_HEADERS,
      ...headers,
    },
  });
}

const port = Number(process.env.PORT) || 3000;
console.log(`Dev server: http://localhost:${port}`);

Bun.serve({
  port,
  idleTimeout: 255,
  async fetch(req) {
    const url = new URL(req.url);

    if (url.pathname === "/__dev/events") {
      const stream = new ReadableStream({
        start(controller) {
          const encoder = new TextEncoder();
          const client: SSEClient = {
            enqueue: (data: string) => controller.enqueue(encoder.encode(data)),
            close: () => controller.close(),
          };
          clients.add(client);
          client.enqueue(": connected\n\n");
          req.signal.addEventListener("abort", () => {
            clients.delete(client);
          });
        },
      });
      return new Response(stream, {
        headers: {
          "Content-Type": "text/event-stream",
          "Cache-Control": "no-cache",
          Connection: "keep-alive",
        },
      });
    }

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
      const text = await Bun.file("dist/bench.html").text();
      return htmlResponse(text, {
        "Cross-Origin-Opener-Policy": "same-origin",
        "Cross-Origin-Embedder-Policy": "credentialless",
      });
    }

    const path = url.pathname === "/" ? "/index.html" : url.pathname;
    const file = Bun.file(`dist${path}`);
    if (await file.exists()) {
      if (path.endsWith(".html")) {
        return htmlResponse(await file.text());
      }
      return new Response(file, { headers: SECURITY_HEADERS });
    }
    const htmlFile = Bun.file(`dist${path}.html`);
    if (await htmlFile.exists()) {
      return htmlResponse(await htmlFile.text());
    }
    return htmlResponse(await Bun.file("dist/index.html").text());
  },
});
