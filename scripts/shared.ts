import { minify } from "@minify-html/node";
import { $ } from "bun";

export async function bundleUI() {
  const builds = await Promise.all([
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
      entrypoints: ["src/ui/bench/index.ts"],
      outdir: "dist",
      naming: "bench.js",
      minify: true,
      target: "browser",
      format: "esm",
    }),
  ]);
  const failed = builds.filter((build) => !build.success);
  if (failed.length > 0) {
    throw new AggregateError(
      failed.flatMap((build) => build.logs),
      "Failed to bundle UI"
    );
  }
  return builds.flatMap((build) => build.outputs);
}

export async function generateCSS(quiet = false): Promise<void> {
  const command = $`bunx unocss "src/ui/home/index.html" "src/ui/bench/index.html" "src/ui/**/*.ts" -o dist/styles.css --minify`;
  if (quiet) {
    await command.quiet();
  } else {
    await command;
  }
}

export async function buildHTMLAssets(css: string): Promise<void> {
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

  for (const [name, source] of [
    ["home", "src/ui/home/index.html"],
    ["bench", "src/ui/bench/index.html"],
  ] as const) {
    const html = await Bun.file(source).text();
    await Bun.write(
      `dist/${name}.html`,
      minify(Buffer.from(inlineCSS(html)), {
        minify_css: true,
        minify_js: true,
      })
    );
  }
}

export async function assembleUIAssets(): Promise<void> {
  const css = await Bun.file("dist/styles.css").text();
  await buildHTMLAssets(css);
  await copyStaticAssets();
}

export async function copyStaticAssets(): Promise<void> {
  await Promise.all([
    Bun.write("dist/robots.txt", "User-agent: *\nAllow: /\n"),
    Bun.write("dist/manifest.json", Bun.file("src/ui/manifest.json")),
    Bun.write("dist/icon.svg", Bun.file("src/ui/icon.svg")),
  ]);
}
