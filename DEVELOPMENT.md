# Development

## Prerequisites

- [Bun](https://bun.sh) (runtime and bundler)

## Commands

```sh
bun install        # install dependencies
bun run check      # format + lint check (fails on issues)
bun run fix        # auto-fix format + lint issues
bun run codegen    # fetch DDG/Kagi sources + generate bang maps
bun run build      # bundle, minify + pre-compress with Brotli (requires codegen first)
bun run dev        # bundle + dev server with file watching & live reload (auto-runs codegen if needed)
bun run start      # serve pre-built dist/ (run `bun run build` first)
bun test           # run tests
bun run clean      # remove dist/
```

## Project structure

```
flashbang/
├── functions/
│   └── suggest.ts          # Cloudflare Pages Function for /suggest
├── config/
│   └── custom.toml         # Custom bang definitions
├── scripts/
│   ├── codegen.ts          # Fetch sources, parse, merge, generate bang maps
│   ├── build.ts            # Bundle + minify pipeline
│   ├── dev.ts              # Dev server with file watching, rebuild & live reload
│   └── start.ts            # Production server (serves pre-built dist/)
├── src/
│   ├── generated/          # Output of codegen (gitignored)
│   │   ├── bangs-min.js    # trigger→URL map for Service Worker
│   │   ├── bangs-full.js   # trigger→{name, domain, url, relevance} for UI & suggestions
│   │   └── bangs-meta.json # bang count & timestamp
│   ├── sw/
│   │   ├── sw.ts           # Service Worker lifecycle & fetch handler
│   │   ├── redirect.ts     # Bang parsing & redirect logic
│   │   ├── suggest.ts      # Bang autocomplete & search suggestions
│   │   └── idb.ts          # IndexedDB access & settings cache
│   └── ui/
│       ├── index.html       # HTML template
│       ├── app.ts           # Settings UI & initialization
│       ├── db.ts            # IndexedDB wrapper
│       ├── liquid-metal.ts  # WebGL2 shader effect
│       ├── manifest.json    # PWA manifest
│       └── opensearch.xml   # OpenSearch descriptor
├── .dockerignore           # Files excluded from Docker build context
├── Dockerfile              # Multi-stage Docker build
├── package.json
├── uno.config.ts           # UnoCSS theme
└── LICENSE
```

## Tests

```sh
bun test           # run all tests
```

Tests live alongside the source files they cover:

- `src/sw/redirect.test.ts` — Bang parsing, routing logic, and URL encoding
- `src/suggest.test.ts` — Cookie parsing, bang suggestions, and provider proxying

## Bang codegen

`bun run codegen` fetches bang sources and generates the JavaScript bang maps that `build` and `dev` depend on:

1. **Fetch sources** — Downloads bang definitions from DuckDuckGo (`bang.js`) and Kagi (`bangs.json`) into `data/`
2. **Generate** — Parses DDG, Kagi, and custom TOML sources. Merges by trigger (deduplicates), validates URLs, and generates three files in `src/generated/`:
   - `bangs-min.js` — trigger→URL map for the Service Worker (~847 KB)
   - `bangs-full.js` — trigger→{name, domain, url, relevance} for the UI and suggestions
   - `bangs-meta.json` — bang count and timestamp

The bang data is split into two tiers so the Service Worker loads only what it needs for fast redirects, while the UI gets the full metadata for searching and display.

## Build pipeline

`bun run build` bundles the app (requires `bun run codegen` first):

1. **Bundle Service Worker** — Bun bundles `src/sw/sw.ts` with `bangs-min.js` into `dist/sw.js`. Code splitting lazy-loads `suggest.ts` on first suggestion request
2. **Bundle UI** — Bun bundles `src/ui/app.ts` with `bangs-full.js` into `dist/app.js`
3. **Generate CSS** — UnoCSS scans source files and emits atomic utility classes
4. **Inline & minify HTML** — CSS is inlined into `<style>`, HTML is minified with `@minify-html/node`
5. **Pre-compress** — All static assets are compressed with Brotli (max quality) and written as `.br` files alongside the originals. The production server serves these automatically when the client supports it, falling back to uncompressed

## Dev server

`bun run dev` runs the dev server with `bun --hot` for soft module reloading:

- **Codegen guard** — If `src/generated/bangs-min.js` is missing, automatically runs `bun run codegen` before the first build so `bun run dev` works out of the box on a fresh clone
- **Inline builds** — Uses `Bun.build()` API directly instead of shelling out to build scripts
- **File watching** — Watches `src/` recursively via `fs.watch` with 200ms debounce. Any source change triggers a full rebuild
- **Live reload** — SSE endpoint at `/__dev/events` pushes reload events to the browser. A small script is injected into HTML responses that unregisters the Service Worker, clears all caches, and reloads the page on each rebuild
- **Hot reload** — `bun --hot` enables Bun's native hot module reloading for `Bun.serve()`, so the server's fetch handler updates without process restart

## Production server

`bun run start` serves the pre-built `dist/` directory with no build step, file watching, or live reload injection. Useful for testing the production build locally. Requires `bun run build` to have been run first.

## Docker

The Dockerfile uses a multi-stage build to produce a minimal runtime image:

1. **Build stage** — Installs dependencies, runs `codegen` to fetch bang sources, and runs `build` to bundle and pre-compress all assets
2. **Runtime stage** — Copies only the built `dist/`, the production server script, and the modules it imports (suggestions, OpenSearch, bang data). No source code or dev dependencies in the final image

```sh
docker build -t flashbang .
docker run -p 3000:3000 flashbang
```

The port is configurable via the `PORT` environment variable:

```sh
docker run -p 8080:8080 -e PORT=8080 flashbang
```

Static assets are served with Brotli pre-compression when the client supports it, falling back to uncompressed. No runtime compression overhead.

## CI

A CI workflow (`.github/workflows/ci.yaml`) runs on every push and pull request to `master`. It runs lint checks, tests, codegen, and a full build to catch issues before merge.

## Releasing

1. Update `version` in `package.json`
2. Commit: `chore: release vX.Y.Z`
3. Tag: `git tag -a vX.Y.Z -m "vX.Y.Z"`
4. Push: `git push && git push --tags`

The release workflow (`.github/workflows/release.yaml`) handles the rest:
runs tests, builds the project, and creates a GitHub Release. Release notes
are maintained on GitHub Releases directly.
