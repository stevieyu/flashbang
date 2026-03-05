import { createHash } from "node:crypto";
import { mkdir, rm } from "node:fs/promises";
import { brotliCompressSync, constants } from "node:zlib";
import { minify } from "@minify-html/node";
import { $ } from "bun";

await mkdir("dist", { recursive: true });
for (const f of new Bun.Glob("*.js").scanSync("dist")) {
  await rm(`dist/${f}`);
}

console.log("=== Bundle app + bench (to discover chunks) ===");
const [appBuild, benchBuild] = await Promise.all([
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

const SIZE_THRESHOLD = 50 * 1024; // 50 KB
const allOutputs = [...appBuild.outputs, ...benchBuild.outputs];
const outputFingerprints: string[] = [];
for (const out of allOutputs) {
  const contentHash = createHash("sha256")
    .update(await Bun.file(out.path).bytes())
    .digest("hex");
  outputFingerprints.push(`${out.path}:${contentHash}`);
}
outputFingerprints.sort();
const cacheVersion =
  "fb-" +
  createHash("sha256")
    .update(outputFingerprints.join(","))
    .digest("hex")
    .slice(0, 8);

const extraAssets = allOutputs
  .filter(
    (o) =>
      !(o.path.endsWith("/app.js") || o.path.endsWith("/bench.js")) &&
      o.size < SIZE_THRESHOLD
  )
  .map((o) => `/${o.path.split("/").pop()!}`);

console.log(`Cache version: ${cacheVersion}`);
if (extraAssets.length) {
  console.log(`Extra assets: ${extraAssets.join(", ")}`);
}

console.log("=== Bundle service worker ===");
await Bun.build({
  entrypoints: ["src/sw/sw.ts"],
  outdir: "dist",
  naming: "sw.js",
  minify: true,
  target: "browser",
  format: "esm",
  define: {
    __CACHE_VERSION__: JSON.stringify(cacheVersion),
    __EXTRA_ASSETS__: JSON.stringify(extraAssets),
  },
});

console.log("=== Generate CSS ===");
await $`bunx unocss "src/ui/home.html" "src/ui/bench.html" "src/ui/**/*.ts" -o dist/styles.css --minify`;

console.log("=== Inline CSS + minify HTML ===");
const css = await Bun.file("dist/styles.css").text();
const inlineCSS = (src: string) =>
  src.replace(
    /<link rel="stylesheet" href="\/styles\.css"\s*\/?>/,
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

await rm("dist/styles.css");
await Bun.write("dist/manifest.json", Bun.file("src/ui/manifest.json"));
await Bun.write("dist/icon.svg", Bun.file("src/ui/icon.svg"));
await Bun.write("dist/robots.txt", "User-agent: *\nAllow: /\n");

console.log("=== Generate _headers with CSP ===");
function extractScriptHashes(html: string): string[] {
  const hashes: string[] = [];
  const re = /<script>([\s\S]*?)<\/script>/g;
  for (const match of html.matchAll(re)) {
    const hash = createHash("sha256").update(match[1]).digest("base64");
    hashes.push(`'sha256-${hash}'`);
  }
  return hashes;
}
const distIndex = await Bun.file("dist/index.html").text();
const distHome = await Bun.file("dist/home.html").text();
const distBench = await Bun.file("dist/bench.html").text();
const scriptHashes = [
  ...extractScriptHashes(distIndex),
  ...extractScriptHashes(distHome),
  ...extractScriptHashes(distBench),
];
const pageCsp = [
  "default-src 'self'",
  `script-src 'self' ${scriptHashes.join(" ")}`,
  "style-src 'self' 'unsafe-inline'",
  "connect-src 'self'",
  "img-src 'self' data:",
  "font-src 'self'",
  "worker-src 'self'",
  "manifest-src 'self'",
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'self'",
].join("; ");
// SW needs unsafe-eval for Function() (engine-detected fast parse in bangs-min.js).
// /sw.js MUST come after /* so it overrides — CF Pages _headers last match wins.
const swCsp =
  "default-src 'self'; script-src 'self' 'unsafe-eval'; connect-src 'self'";
await Bun.write(
  "dist/_headers",
  `/*\n  Content-Security-Policy: ${pageCsp}\n  X-Content-Type-Options: nosniff\n  X-Frame-Options: DENY\n  Referrer-Policy: strict-origin-when-cross-origin\n\n/sw.js\n  Content-Security-Policy: ${swCsp}\n\n/opensearch.xml\n  Content-Type: application/opensearchdescription+xml\n`
);

console.log("=== Pre-compress static assets ===");
for (const file of new Bun.Glob("*.{html,js,svg,json,txt}").scanSync("dist")) {
  const content = await Bun.file(`dist/${file}`).bytes();

  const br = brotliCompressSync(content, {
    params: { [constants.BROTLI_PARAM_QUALITY]: constants.BROTLI_MAX_QUALITY },
  });
  await Bun.write(`dist/${file}.br`, br);
}

console.log("=== Done ===");
for (const f of new Bun.Glob("*").scanSync("dist")) {
  const size = Bun.file(`dist/${f}`).size;
  const kb = (size / 1024).toFixed(1);
  console.log(`  ${f.padEnd(30)} ${kb} KB`);
}
