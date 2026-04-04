import { createHash } from "node:crypto";
import { mkdir, rm } from "node:fs/promises";
import { brotliCompressSync, constants } from "node:zlib";
import { $ } from "bun";
import { ensureGeneratedBangData } from "./codegen";
import { buildHTMLAssets, copyStaticAssets } from "./shared";

await ensureGeneratedBangData(true);

// Start from a clean dist to avoid stale artifacts (e.g. orphaned .br chunks).
await rm("dist", { recursive: true, force: true });
await mkdir("dist", { recursive: true });

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
    __IS_DEV__: JSON.stringify(false),
  },
});

console.log("=== Generate CSS ===");
await $`bunx unocss "src/ui/home.html" "src/ui/bench.html" "src/ui/**/*.ts" -o dist/styles.css --minify`;

console.log("=== Inline CSS + minify HTML ===");
const css = await Bun.file("dist/styles.css").text();
await buildHTMLAssets(css);
await rm("dist/styles.css");
await copyStaticAssets();

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
const { pageHeaders, SW_CSP } = await import("../src/server/headers");
const { "Content-Security-Policy": pageCsp, ...baseHeaders } = pageHeaders(
  scriptHashes.join(" ")
);
// CSP is set per-path (not /*) to avoid CF Pages additive header merging.
const securityHeaders = Object.entries(baseHeaders)
  .map(([k, v]) => `${k}: ${v}`)
  .join("\n  ");
const pageCspHeader = `Content-Security-Policy: ${pageCsp}`;
const swCspHeader = `Content-Security-Policy: ${SW_CSP}`;
await Bun.write(
  "dist/_headers",
  [
    "/*",
    `  ${securityHeaders}`,
    "",
    "/",
    `  ${pageCspHeader}`,
    "",
    "/index.html",
    `  ${pageCspHeader}`,
    "",
    "/home.html",
    `  ${pageCspHeader}`,
    "",
    "/bench.html",
    `  ${pageCspHeader}`,
    "",
    "/sw.js",
    `  ${swCspHeader}`,
    "",
    "/opensearch.xml",
    "  Content-Type: application/opensearchdescription+xml",
    "",
  ].join("\n")
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
