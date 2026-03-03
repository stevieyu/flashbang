FROM oven/bun:latest AS builder

WORKDIR /app
COPY package.json bun.lock bunfig.toml ./
RUN bun install --frozen-lockfile

COPY . .
RUN bun run codegen --from-merged && bun run build

FROM oven/bun:latest

WORKDIR /app
COPY --from=builder /app/dist dist
COPY --from=builder /app/scripts/start.ts scripts/start.ts
COPY --from=builder /app/src/suggest.ts src/suggest.ts
COPY --from=builder /app/src/suggest-bang.ts src/suggest-bang.ts
COPY --from=builder /app/src/opensearch.ts src/opensearch.ts
COPY --from=builder /app/src/server/handlers.ts src/server/handlers.ts
COPY --from=builder /app/src/shared/chars.ts src/shared/chars.ts
COPY --from=builder /app/src/shared/constants.ts src/shared/constants.ts
COPY --from=builder /app/src/shared/raw-query.ts src/shared/raw-query.ts
COPY --from=builder /app/src/shared/raw-url.ts src/shared/raw-url.ts
COPY --from=builder /app/src/shared/template.ts src/shared/template.ts
COPY --from=builder /app/src/generated/bangs-trie.js src/generated/bangs-trie.js

ENV PORT=3000
EXPOSE 3000

CMD ["bun", "scripts/start.ts"]
