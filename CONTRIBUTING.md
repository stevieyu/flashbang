# Contributing

Thanks for your interest in Flashbang! This guide covers what you need to know to contribute.

## Quick start

See [DEVELOPMENT.md](DEVELOPMENT.md) for setup instructions and available commands.

## Ways to contribute

- **Bug reports** — Open an issue with steps to reproduce, expected vs actual behavior, and your browser/OS.
- **Feature requests** — Open an issue describing the use case, not just the solution.
- **Bang additions** — Add new bang shortcuts (see below).
- **Code** — Fix bugs, improve performance, or add features.

## Adding bangs

Repository-provided bangs that are not available from DuckDuckGo or Kagi live in [`data/custom-bangs.json`](data/custom-bangs.json). User-created bangs belong in the settings UI and are stored locally in IndexedDB; do not add personal bangs to this file.

Each repository entry looks like:

```json
"mdn": {
  "name": "MDN Web Docs",
  "url": "https://developer.mozilla.org/en-US/search?q={}",
  "domain": "developer.mozilla.org"
}
```

- The key is the trigger (e.g. `!mdn`)
- `url` must contain `{}` as the query placeholder
- `domain` is shown in the UI for display

After editing, run:

```sh
bun run codegen
```

This fetches the current DuckDuckGo and Kagi sources, merges all sources, updates the committed `data/bangs.json`, and regenerates the ignored `src/generated/` artifacts. Commit both `data/custom-bangs.json` and `data/bangs.json`; do not commit `data/ddg.json`, `data/kagi.json`, or `src/generated/`.

The repository custom-bang file supports the simple `{}` template above. Regex capture templates and alternate snap targets are user-facing advanced settings and upstream Kagi metadata; see [DEVELOPMENT.md](DEVELOPMENT.md#advanced-bangs-and-snap-targets) before changing their parser or generated representation.

## Pull requests

- Branch from `master`
- Run `bun run typecheck`, `bun run check`, `bun test`, and `bun run build` before submitting
- Run `bun run test:e2e` for UI, Service Worker, settings, or other browser-visible changes
- Use [conventional commits](https://www.conventionalcommits.org/), including the repository's common `feat:`, `fix:`, `perf:`, `docs:`, `test:`, `refactor:`, and `chore:` types
- Keep PRs focused — one concern per PR

## Releases

We use **GitHub Releases** as the canonical place for release notes and version history.

- Version tags use `vX.Y.Z` (for example `v1.4.1`)
- Pushing a release tag triggers `.github/workflows/release.yaml`
- The workflow validates the release, creates or updates its GitHub Release, health-checks a container, and publishes `linux/amd64` and `linux/arm64` images to GHCR

For the full maintainer release procedure (version bump, notes, tag, and workflow verification), see [DEVELOPMENT.md](DEVELOPMENT.md#releasing).

## Tests

All tests live in `tests/`. Run the unit and performance suite with:

```sh
bun test
```

End-to-end tests live in `tests/e2e/`. Run them with:

```sh
bun run test:e2e
```

If this is your first Playwright run on a machine, install browsers once:

```sh
bunx playwright install
```

Add tests for new logic and user-facing behavior. Look at existing tests for patterns:

- `tests/redirect.test.ts` — redirect, capture bang, and snap routing logic
- `tests/suggest.test.ts` — suggestions, providers, and cookie parsing
- `tests/capture-template.test.ts` and `tests/snap-target.test.ts` — advanced custom-bang validation
- `tests/codegen-roundtrip.test.ts` — generated regular, capture, and snap lookups
- `tests/ui-db.test.ts` and `tests/sw-idb.test.ts` — custom-bang persistence and Service Worker compilation
- `tests/e2e/flashbang.e2e.ts` — settings, suggestion endpoints, warm/cold redirects, and custom bang browser flows

## Code style

Formatting and linting are handled by [Biome](https://biomejs.dev). Run `bun run check` to verify and `bun run fix` to auto-fix.

- Strict TypeScript (`strict: true`)
- ESNext target
- Prefer named exports in application code

## License

Contributions are licensed under [AGPL-3.0](LICENSE), the same license as the project. This is intentional — AGPL ensures that modified versions served over a network remain open source, protecting user privacy.
