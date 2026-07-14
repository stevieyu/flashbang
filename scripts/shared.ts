import { minify } from "@minify-html/node";

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
    ["bench", "src/ui/bench.html"],
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

export async function copyStaticAssets(): Promise<void> {
  await Promise.all([
    Bun.write("dist/robots.txt", "User-agent: *\nAllow: /\n"),
    Bun.write("dist/manifest.json", Bun.file("src/ui/manifest.json")),
    Bun.write("dist/icon.svg", Bun.file("src/ui/icon.svg")),
  ]);
}
