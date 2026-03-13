/**
 * Comprehensive profiling for flashbang's core data structures and hot paths.
 * Measures what actually matters before optimizing.
 *
 * Run: bun scripts/profile.ts
 */

import { readPathname } from "../src/shared/raw-url";
import { ensureGeneratedBangData, GENERATED_BANG_DATA_FILES } from "./codegen";

const [minPath, metaPath, triePath] = GENERATED_BANG_DATA_FILES;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function median(arr: number[]): number {
  const s = arr.slice().sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)];
}

function percentile(arr: number[], p: number): number {
  const s = arr.slice().sort((a, b) => a - b);
  const idx = (s.length - 1) * p;
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  if (lo === hi) {
    return s[lo];
  }
  const frac = idx - lo;
  return s[lo] * (1 - frac) + s[hi] * frac;
}

function mean(arr: number[]): number {
  if (arr.length === 0) {
    return 0;
  }
  let sum = 0;
  for (const n of arr) {
    sum += n;
  }
  return sum / arr.length;
}

interface RunStats {
  p50: number;
  p90: number;
  min: number;
  max: number;
  mean: number;
  cvPct: number;
}

function summarizeRuns(arr: number[]): RunStats {
  const avg = mean(arr);
  let variance = 0;
  for (const n of arr) {
    const d = n - avg;
    variance += d * d;
  }
  const stdev = arr.length > 0 ? Math.sqrt(variance / arr.length) : 0;
  const sorted = arr.slice().sort((a, b) => a - b);
  return {
    p50: percentile(sorted, 0.5),
    p90: percentile(sorted, 0.9),
    min: sorted[0] ?? 0,
    max: sorted[sorted.length - 1] ?? 0,
    mean: avg,
    cvPct: avg > 0 ? (stdev / avg) * 100 : 0,
  };
}

function fmt(ns: number): string {
  if (ns < 1_000) {
    return `${ns.toFixed(0)}ns`;
  }
  if (ns < 1_000_000) {
    return `${(ns / 1_000).toFixed(2)}µs`;
  }
  return `${(ns / 1_000_000).toFixed(2)}ms`;
}

function fmtBytes(b: number): string {
  if (b < 1024) {
    return `${b}B`;
  }
  if (b < 1024 * 1024) {
    return `${(b / 1024).toFixed(1)}KB`;
  }
  return `${(b / (1024 * 1024)).toFixed(2)}MB`;
}

function separator(title: string) {
  console.log(`\n${"=".repeat(70)}`);
  console.log(`  ${title}`);
  console.log("=".repeat(70));
}

function fmtBytesExact(b: number): string {
  return `${fmtBytes(b)} (${b.toLocaleString()}B)`;
}

await ensureGeneratedBangData(true);

const [
  { BANG_COUNT, lookupBang },
  { EDGES, LABELS, NODES, ROOT },
  { handleSuggestRequest },
  { bangSuggestions },
  { parseCookie, parseSettingsFromRawUrl },
  { buildTopFrecency, serializeTopFrecency, updateTopFrecencyOnIncrement },
  { readQueryParam, readTwoQueryParams },
] = await Promise.all([
  import("../src/generated/bangs-min.js"),
  import("../src/generated/bangs-trie.js"),
  import("../src/server/handlers"),
  import("../src/suggest-bang"),
  import("../src/suggest"),
  import("../src/sw/frecency"),
  import("../src/shared/raw-query"),
]);

const NODE_EDGE_START = 0;
const NODE_EDGE_COUNT = 1;
const NODE_TERMINAL_INDEX = 2;
const NODE_MAX_RELEVANCE = 3;
const NODE_STRIDE = 4;

const EDGE_LABEL_START = 0;
const EDGE_LABEL_LENGTH = 1;
const EDGE_CHILD_INDEX = 2;
const EDGE_STRIDE = 3;

const RUNS = 12;
const COLD_RUNS = 5;

console.log(
  `\nMethod: per-iteration means across ${RUNS} runs (p90/spread are run-level).`
);
console.log(
  "Low single-digit nanosecond results should be treated as directional only."
);

// ---------------------------------------------------------------------------
// 1. FILE SIZES & DATA STATS
// ---------------------------------------------------------------------------

separator("1. DATA SIZE & STRUCTURE ANALYSIS");

const minBytes = Bun.file(minPath).size;
const metaBytes = Bun.file(metaPath).size;
const trieBytes = Bun.file(triePath).size;
const totalGeneratedBytes = minBytes + metaBytes + trieBytes;

console.log(`\nBang count: ${BANG_COUNT.toLocaleString()}`);
console.log(
  `bangs-min.js:  ${fmtBytesExact(minBytes)}  (trigger→URL parts, used by SW)`
);
console.log(
  `bangs-meta.js: ${fmtBytesExact(metaBytes)}  (trigger→{s,d}, used by UI)`
);

const trieFile = await Bun.file(triePath).text();
console.log(
  `bangs-trie.js: ${fmtBytesExact(trieBytes)}  (radix trie, used by suggest)`
);
console.log(`Total generated: ${fmtBytesExact(totalGeneratedBytes)}`);
console.log(
  `Avg bytes per bang: ${Math.round(totalGeneratedBytes / BANG_COUNT).toLocaleString()}B`
);

// ---------------------------------------------------------------------------
// 2. TRIE STRUCTURE ANALYSIS
// ---------------------------------------------------------------------------

separator("2. TRIE STRUCTURE ANALYSIS");

function trieStats(root: number): {
  nodes: number;
  terminals: number;
  edges: number;
  maxDepth: number;
} {
  const nodeCount = Math.floor(NODES.length / NODE_STRIDE);
  let terminals = 0;
  let maxDepth = 0;

  for (let i = 0; i < nodeCount; i++) {
    if (NODES[i * NODE_STRIDE + NODE_TERMINAL_INDEX] >= 0) {
      terminals++;
    }
  }

  function walkDepth(node: number, depth: number) {
    if (depth > maxDepth) {
      maxDepth = depth;
    }
    const nodeOff = node * NODE_STRIDE;
    const edgeStart = NODES[nodeOff + NODE_EDGE_START];
    const edgeCount = NODES[nodeOff + NODE_EDGE_COUNT];
    for (let i = 0; i < edgeCount; i++) {
      const edgeOff = (edgeStart + i) * EDGE_STRIDE;
      walkDepth(EDGES[edgeOff + EDGE_CHILD_INDEX], depth + 1);
    }
  }

  walkDepth(root, 0);

  return {
    nodes: nodeCount,
    terminals,
    edges: Math.floor(EDGES.length / EDGE_STRIDE),
    maxDepth,
  };
}

const ts = trieStats(ROOT);
console.log("\nFlat radix trie structure:");
console.log(`  Nodes:     ${ts.nodes.toLocaleString()}`);
console.log(`  Terminals: ${ts.terminals.toLocaleString()}`);
console.log(`  Edges:     ${ts.edges.toLocaleString()}`);
console.log(`  Max depth: ${ts.maxDepth}`);
console.log(`  Root children: ${NODES[ROOT * NODE_STRIDE + NODE_EDGE_COUNT]}`);
console.log(
  `  Max relevance: ${NODES[ROOT * NODE_STRIDE + NODE_MAX_RELEVANCE]}`
);

// ---------------------------------------------------------------------------
// 3. BANG LOOKUP PERFORMANCE
// ---------------------------------------------------------------------------

separator("3. BANG LOOKUP PERFORMANCE");

const sampleHits = ["g", "gh", "yt", "w", "a", "ddg", "so", "mdn", "npm"];
const sampleMisses = [
  "zzzzz",
  "notabang",
  "xyz123",
  "fakebang",
  "qqqq",
  "!!!!!",
];
const allSamples = [...sampleHits, ...sampleMisses];

for (let i = 0; i < 10_000; i++) {
  for (const k of allSamples) {
    void lookupBang(k);
  }
}

const LOOKUP_ITERS = 1_000_000;
const lookupBaselineTimes: number[] = [];
const lookupTimes: number[] = [];
const lookupHitCounts: number[] = [];

for (let run = 0; run < RUNS; run++) {
  const offset = run % allSamples.length;

  let t0 = Bun.nanoseconds();
  let baselineLen = 0;
  for (let i = 0; i < LOOKUP_ITERS; i++) {
    baselineLen += allSamples[(i + offset) % allSamples.length].length;
  }
  lookupBaselineTimes.push((Bun.nanoseconds() - t0) / LOOKUP_ITERS);

  t0 = Bun.nanoseconds();
  let hitCount = 0;
  for (let i = 0; i < LOOKUP_ITERS; i++) {
    if (
      lookupBang(allSamples[(i + offset + baselineLen) % allSamples.length])
    ) {
      hitCount++;
    }
  }
  lookupHitCounts.push(hitCount);
  const elapsed = Bun.nanoseconds() - t0;
  lookupTimes.push(elapsed / LOOKUP_ITERS);
}

const lookupRawMedian = median(lookupTimes);
const lookupBaselineMedian = median(lookupBaselineTimes);
const lookupNetMedian = Math.max(0, lookupRawMedian - lookupBaselineMedian);
const lookupHitRatioPct = (median(lookupHitCounts) / LOOKUP_ITERS) * 100;
const lookupStats = summarizeRuns(lookupTimes);

console.log("\nPacked lookup (lookupBang):");
console.log(`  ${LOOKUP_ITERS.toLocaleString()} iterations × ${RUNS} runs`);
console.log(`  Median (raw):      ${fmt(lookupRawMedian)}/lookup`);
console.log(`  p90 (run):         ${fmt(lookupStats.p90)}/lookup`);
console.log(`  Loop baseline:     ${fmt(lookupBaselineMedian)}/iter`);
console.log(`  Estimated lookup:  ${fmt(lookupNetMedian)}/lookup`);
console.log(
  `  Run spread:        ${fmt(lookupStats.min)}..${fmt(lookupStats.max)} (cv ${lookupStats.cvPct.toFixed(1)}%)`
);
console.log(`  Sample hit ratio:  ${lookupHitRatioPct.toFixed(1)}%`);

// ---------------------------------------------------------------------------
// 4. TRIE-BASED SUGGESTION PERFORMANCE
// ---------------------------------------------------------------------------

separator("4. TRIE-BASED SUGGESTION PERFORMANCE");

function walkPrefix(partial: string): [number, string] | null {
  let node = ROOT;
  let pos = 0;

  while (pos < partial.length) {
    let found = false;
    const nodeOff = node * NODE_STRIDE;
    const edgeStart = NODES[nodeOff + NODE_EDGE_START];
    const edgeCount = NODES[nodeOff + NODE_EDGE_COUNT];
    for (let i = 0; i < edgeCount; i++) {
      const edgeOff = (edgeStart + i) * EDGE_STRIDE;
      const edgeLabelStart = EDGES[edgeOff + EDGE_LABEL_START];
      const edgeLabelLen = EDGES[edgeOff + EDGE_LABEL_LENGTH];
      const child = EDGES[edgeOff + EDGE_CHILD_INDEX];
      const limit = Math.min(partial.length - pos, edgeLabelLen);
      let match = 0;
      while (
        match < limit &&
        partial.charCodeAt(pos + match) ===
          LABELS.charCodeAt(edgeLabelStart + match)
      ) {
        match++;
      }
      if (match === 0) {
        continue;
      }
      if (match < edgeLabelLen) {
        if (match < partial.length - pos) {
          return null;
        }
        return [
          child,
          LABELS.substring(
            edgeLabelStart + match,
            edgeLabelStart + edgeLabelLen
          ),
        ];
      }
      node = child;
      pos += match;
      found = true;
      break;
    }
    if (!found) {
      return null;
    }
  }

  return [node, ""];
}

function countTerminals(node: number): number {
  const nodeOff = node * NODE_STRIDE;
  let c = NODES[nodeOff + NODE_TERMINAL_INDEX] >= 0 ? 1 : 0;
  const edgeStart = NODES[nodeOff + NODE_EDGE_START];
  const edgeCount = NODES[nodeOff + NODE_EDGE_COUNT];
  for (let i = 0; i < edgeCount; i++) {
    const edgeOff = (edgeStart + i) * EDGE_STRIDE;
    c += countTerminals(EDGES[edgeOff + EDGE_CHILD_INDEX]);
  }
  return c;
}

const suggestPartials = ["g", "gh", "gi", "yt", "a", "s"];
const SUGGEST_ITERS = 100_000;
const SUGGEST_PREFIX_ITERS = 20_000;
const emptyFrecency: Record<string, number> = Object.create(null);
const emptyCustom: string[] = [];

// Warm up
for (let i = 0; i < 1_000; i++) {
  const p = suggestPartials[i % suggestPartials.length];
  void bangSuggestions(`!${p}`, "", p, emptyFrecency, emptyCustom);
}

const trieSuggestTimes: number[] = [];
for (let run = 0; run < RUNS; run++) {
  const t0 = Bun.nanoseconds();
  for (let i = 0; i < SUGGEST_ITERS; i++) {
    const p = suggestPartials[i % suggestPartials.length];
    void bangSuggestions(`!${p}`, "", p, emptyFrecency, emptyCustom);
  }
  const elapsed = Bun.nanoseconds() - t0;
  trieSuggestTimes.push(elapsed / SUGGEST_ITERS);
}

const trieSuggestRunStats = summarizeRuns(trieSuggestTimes);

console.log("\nbangSuggestions() pipeline (production function):");
console.log(`  ${SUGGEST_ITERS.toLocaleString()} iterations × ${RUNS} runs`);
console.log(`  Median: ${fmt(trieSuggestRunStats.p50)}/suggest`);
console.log(`  p90:    ${fmt(trieSuggestRunStats.p90)}/suggest`);
console.log(
  `  Spread: ${fmt(trieSuggestRunStats.min)}..${fmt(trieSuggestRunStats.max)} (cv ${trieSuggestRunStats.cvPct.toFixed(1)}%)`
);

// Per-prefix breakdown
console.log("\n  Per-prefix timings:");
for (const p of suggestPartials) {
  const times: number[] = [];
  for (let run = 0; run < RUNS; run++) {
    const t0 = Bun.nanoseconds();
    for (let i = 0; i < SUGGEST_PREFIX_ITERS; i++) {
      void bangSuggestions(`!${p}`, "", p, emptyFrecency, emptyCustom);
    }
    const elapsed = Bun.nanoseconds() - t0;
    times.push(elapsed / SUGGEST_PREFIX_ITERS);
  }

  const result = walkPrefix(p);
  const matchCount = result ? countTerminals(result[0]) : 0;
  const payloadBytes = (
    await bangSuggestions(`!${p}`, "", p, emptyFrecency, emptyCustom).text()
  ).length;
  const prefixStats = summarizeRuns(times);
  console.log(
    `    "${p}": ${fmt(prefixStats.p50)} median, ${fmt(prefixStats.p90)} p90 (${matchCount} subtree matches, ${payloadBytes}B payload)`
  );
}

// ---------------------------------------------------------------------------
// 5. REDIRECT PIPELINE PERFORMANCE
// ---------------------------------------------------------------------------

separator("5. FULL REDIRECT PIPELINE");

const { redirect, redirectRaw, redirectUrl } = await import(
  "../src/sw/redirect"
);

const settings = {
  defaultUrl: ["https://www.google.com/search?q=", ""] as const,
  luckyUrl: ["https://duckduckgo.com/?q=\\", ""] as const,
  hasCustom: false,
  custom: Object.create(null) as Record<
    string,
    readonly [string, string | null]
  >,
};

const queries = [
  { label: "Prefix bang", raw: "!g+kittens" },
  { label: "Suffix bang", raw: "kittens+g!" },
  { label: "Trailing !bang", raw: "kittens+!g" },
  { label: "Prefix suffix-bang", raw: "g!+kittens" },
  { label: "No bang (default)", raw: "kittens" },
  { label: "Feeling lucky (\\)", raw: "\\kittens" },
  { label: "Bang only", raw: "!g" },
  { label: "Lucky bare (! q)", raw: "!+kittens" },
  { label: "Unknown bang", raw: "!zzzzz+cats" },
  { label: "Long query", raw: `!g+${"a".repeat(200)}` },
  { label: "Encoded spaces", raw: "!g%20kittens%20are%20cute" },
];

const REDIRECT_ITERS = 500_000;
const redirectStats = new Map<string, RunStats>();

for (let i = 0; i < 10_000; i++) {
  redirectRaw(queries[i % queries.length].raw, settings);
}

console.log(
  `\nredirectRaw() — ${REDIRECT_ITERS.toLocaleString()} iterations × ${RUNS} runs:`
);
console.log(
  `${"Query type".padEnd(24)} ${"Median".padStart(10)} ${"p90".padStart(10)}`
);
console.log("-".repeat(46));

for (const q of queries) {
  const times: number[] = [];
  for (let run = 0; run < RUNS; run++) {
    const t0 = Bun.nanoseconds();
    for (let i = 0; i < REDIRECT_ITERS; i++) {
      redirectRaw(q.raw, settings);
    }
    const elapsed = Bun.nanoseconds() - t0;
    times.push(elapsed / REDIRECT_ITERS);
  }
  const stats = summarizeRuns(times);
  redirectStats.set(q.label, stats);
  console.log(
    `  ${q.label.padEnd(22)} ${fmt(stats.p50).padStart(10)} ${fmt(stats.p90).padStart(10)}`
  );
}

const bangRedirect = redirectStats.get("Prefix bang");
const nonBangRedirect = redirectStats.get("No bang (default)");
if (!(bangRedirect && nonBangRedirect)) {
  throw new Error(
    "redirect profile samples missing expected labels: Prefix bang / No bang (default)"
  );
}

const redirectMixedTimes: number[] = [];
for (let run = 0; run < RUNS; run++) {
  const t0 = Bun.nanoseconds();
  for (let i = 0; i < REDIRECT_ITERS; i++) {
    redirectRaw(queries[(i + run) % queries.length].raw, settings);
  }
  redirectMixedTimes.push((Bun.nanoseconds() - t0) / REDIRECT_ITERS);
}
const redirectMixedStats = summarizeRuns(redirectMixedTimes);

console.log(
  `\nMixed redirect workload (${queries.length} query shapes): ${fmt(redirectMixedStats.p50)} median, ${fmt(redirectMixedStats.p90)} p90`
);

const messageQueries = [
  "!g kittens",
  "kittens",
  "\\kittens",
  "cats g!",
  "!zzzzz cats",
];
const MESSAGE_ITERS = 500_000;
const messageOldTimes: number[] = [];
const messageNewTimes: number[] = [];
let messageSink = 0;

for (let i = 0; i < 20_000; i++) {
  const q = messageQueries[i % messageQueries.length];
  messageSink += redirect(q, settings).headers.get("Location")?.length ?? 0;
  messageSink += redirectUrl(q, settings).length;
}

for (let run = 0; run < RUNS; run++) {
  let t0 = Bun.nanoseconds();
  for (let i = 0; i < MESSAGE_ITERS; i++) {
    const q = messageQueries[(i + run) % messageQueries.length];
    messageSink += redirect(q, settings).headers.get("Location")?.length ?? 0;
  }
  messageOldTimes.push((Bun.nanoseconds() - t0) / MESSAGE_ITERS);

  t0 = Bun.nanoseconds();
  for (let i = 0; i < MESSAGE_ITERS; i++) {
    const q = messageQueries[(i + run) % messageQueries.length];
    messageSink += redirectUrl(q, settings).length;
  }
  messageNewTimes.push((Bun.nanoseconds() - t0) / MESSAGE_ITERS);
}

const messageOldStats = summarizeRuns(messageOldTimes);
const messageNewStats = summarizeRuns(messageNewTimes);
const messageSavings = messageOldStats.p50 - messageNewStats.p50;
if (messageSink === -1) {
  console.log("");
}

console.log(
  `SW message redirect path: old ${fmt(messageOldStats.p50)} vs new ${fmt(messageNewStats.p50)} (save ${fmt(messageSavings)}/call)`
);

// ---------------------------------------------------------------------------
// 6. SERVER ROUTE PATH PARSE PERFORMANCE
// ---------------------------------------------------------------------------

separator("6. SERVER ROUTE PATH PARSE PERFORMANCE");

const RAW_URL = "https://flashbang.local/suggest?q=%21g&sp=none#x";
const PATH_ITERS = 500_000;
const pathViaUrlTimes: number[] = [];
const pathViaRawTimes: number[] = [];

for (let i = 0; i < 10_000; i++) {
  void new URL(RAW_URL).pathname;
  void readPathname(RAW_URL);
}

for (let run = 0; run < RUNS; run++) {
  let t0 = Bun.nanoseconds();
  for (let i = 0; i < PATH_ITERS; i++) {
    void new URL(RAW_URL).pathname;
  }
  pathViaUrlTimes.push((Bun.nanoseconds() - t0) / PATH_ITERS);

  t0 = Bun.nanoseconds();
  for (let i = 0; i < PATH_ITERS; i++) {
    void readPathname(RAW_URL);
  }
  pathViaRawTimes.push((Bun.nanoseconds() - t0) / PATH_ITERS);
}

const pathViaUrlStats = summarizeRuns(pathViaUrlTimes);
const pathViaRawStats = summarizeRuns(pathViaRawTimes);

console.log(
  `\nPath parse benchmark — ${PATH_ITERS.toLocaleString()} iterations × ${RUNS} runs:`
);
console.log(
  `  new URL(url).pathname: ${fmt(pathViaUrlStats.p50)} median, ${fmt(pathViaUrlStats.p90)} p90`
);
console.log(
  `  readPathname(url):      ${fmt(pathViaRawStats.p50)} median, ${fmt(pathViaRawStats.p90)} p90`
);

// ---------------------------------------------------------------------------
// 7. QUERY & COOKIE PARSING PERFORMANCE
// ---------------------------------------------------------------------------

separator("7. QUERY & COOKIE PARSING PERFORMANCE");

const PARAM_URL =
  "https://flashbang.local/suggest?x=1&q=%21g%20kittens%20and%20cats&sp=none&src=prof#x";
const PARAM_ITERS = 500_000;
const queryDualScanTimes: number[] = [];
const querySingleScanTimes: number[] = [];
let parseSink = 0;

for (let i = 0; i < 20_000; i++) {
  const q = readQueryParam(PARAM_URL, "q");
  const sp = readQueryParam(PARAM_URL, "sp");
  parseSink += (q?.length ?? 0) + (sp?.length ?? 0);
  const both = readTwoQueryParams(PARAM_URL, "q", "sp");
  parseSink += (both[0]?.length ?? 0) + (both[1]?.length ?? 0);
}

for (let run = 0; run < RUNS; run++) {
  let t0 = Bun.nanoseconds();
  for (let i = 0; i < PARAM_ITERS; i++) {
    const q = readQueryParam(PARAM_URL, "q");
    const sp = readQueryParam(PARAM_URL, "sp");
    parseSink += (q?.length ?? 0) + (sp?.length ?? 0);
  }
  queryDualScanTimes.push((Bun.nanoseconds() - t0) / PARAM_ITERS);

  t0 = Bun.nanoseconds();
  for (let i = 0; i < PARAM_ITERS; i++) {
    const [q, sp] = readTwoQueryParams(PARAM_URL, "q", "sp");
    parseSink += (q?.length ?? 0) + (sp?.length ?? 0);
  }
  querySingleScanTimes.push((Bun.nanoseconds() - t0) / PARAM_ITERS);
}

const queryDualStats = summarizeRuns(queryDualScanTimes);
const querySingleStats = summarizeRuns(querySingleScanTimes);
const queryScanSpeedup = queryDualStats.p50 / querySingleStats.p50;

console.log(
  `\nQuery param extraction — ${PARAM_ITERS.toLocaleString()} iterations × ${RUNS} runs:`
);
console.log(
  `  readQueryParam(q)+readQueryParam(sp): ${fmt(queryDualStats.p50)} median, ${fmt(queryDualStats.p90)} p90`
);
console.log(
  `  readTwoQueryParams(q,sp):            ${fmt(querySingleStats.p50)} median, ${fmt(querySingleStats.p90)} p90`
);
console.log(`  Single-scan speedup: ${queryScanSpeedup.toFixed(2)}x`);

const reqNoCookie = new Request("http://localhost/suggest?q=x");
const reqLightCookie = new Request("http://localhost/suggest?q=x", {
  headers: {
    Cookie: "suggest=default,g,|meta|gh.mdn; sf=g:10.yt:4",
  },
});
const reqHeavyCookie = new Request("http://localhost/suggest?q=x", {
  headers: {
    Cookie:
      "session=abc123; theme=dark; lang=en-US; exp=beta-on; tracking=xyz;" +
      " suggest=custom,g,https%3A%2F%2Fexample.com%2Fsearch%3Fq%3D%7B%7D,|meta|gh.mdn.npm.rs.w;" +
      " sf=g:50.yt:30.w:20.ddg:10.gh:8.npm:6.rs:4;" +
      " misc1=1; misc2=2; misc3=3; misc4=4",
  },
});
const SETTINGS_PARSE_URL = "http://localhost/suggest?q=flashbang";

const COOKIE_ITERS = 300_000;
const cookieNoneTimes: number[] = [];
const cookieLightTimes: number[] = [];
const cookieHeavyTimes: number[] = [];
const settingsFullContextTimes: number[] = [];
const settingsPlainContextTimes: number[] = [];

for (let i = 0; i < 10_000; i++) {
  parseSink += parseCookie(reqNoCookie).provider.length;
  parseSink += parseCookie(reqLightCookie).provider.length;
  parseSink += parseCookie(reqHeavyCookie).provider.length;
  parseSink += parseSettingsFromRawUrl(
    SETTINGS_PARSE_URL,
    reqHeavyCookie,
    "none",
    true
  ).provider.length;
  parseSink += parseSettingsFromRawUrl(
    SETTINGS_PARSE_URL,
    reqHeavyCookie,
    "none",
    false
  ).provider.length;
}

for (let run = 0; run < RUNS; run++) {
  let t0 = Bun.nanoseconds();
  for (let i = 0; i < COOKIE_ITERS; i++) {
    const s = parseCookie(reqNoCookie);
    parseSink += s.provider.length + s.trigger.length + s.custom.length;
  }
  cookieNoneTimes.push((Bun.nanoseconds() - t0) / COOKIE_ITERS);

  t0 = Bun.nanoseconds();
  for (let i = 0; i < COOKIE_ITERS; i++) {
    const s = parseCookie(reqLightCookie);
    parseSink += s.provider.length + s.trigger.length + s.custom.length;
  }
  cookieLightTimes.push((Bun.nanoseconds() - t0) / COOKIE_ITERS);

  t0 = Bun.nanoseconds();
  for (let i = 0; i < COOKIE_ITERS; i++) {
    const s = parseCookie(reqHeavyCookie);
    parseSink += s.provider.length + s.trigger.length + s.custom.length;
  }
  cookieHeavyTimes.push((Bun.nanoseconds() - t0) / COOKIE_ITERS);

  t0 = Bun.nanoseconds();
  for (let i = 0; i < COOKIE_ITERS; i++) {
    const s = parseSettingsFromRawUrl(
      SETTINGS_PARSE_URL,
      reqHeavyCookie,
      "none",
      true
    );
    parseSink += s.provider.length + s.trigger.length + s.custom.length;
  }
  settingsFullContextTimes.push((Bun.nanoseconds() - t0) / COOKIE_ITERS);

  t0 = Bun.nanoseconds();
  for (let i = 0; i < COOKIE_ITERS; i++) {
    const s = parseSettingsFromRawUrl(
      SETTINGS_PARSE_URL,
      reqHeavyCookie,
      "none",
      false
    );
    parseSink += s.provider.length + s.trigger.length + s.custom.length;
  }
  settingsPlainContextTimes.push((Bun.nanoseconds() - t0) / COOKIE_ITERS);
}

const cookieNoneStats = summarizeRuns(cookieNoneTimes);
const cookieLightStats = summarizeRuns(cookieLightTimes);
const cookieHeavyStats = summarizeRuns(cookieHeavyTimes);
const settingsFullContextStats = summarizeRuns(settingsFullContextTimes);
const settingsPlainContextStats = summarizeRuns(settingsPlainContextTimes);
const settingsPlainSpeedup =
  settingsFullContextStats.p50 / settingsPlainContextStats.p50;
if (parseSink === -1) {
  console.log("");
}

console.log(
  `\nCookie parsing — ${COOKIE_ITERS.toLocaleString()} iterations × ${RUNS} runs:`
);
console.log(
  `  No cookie:    ${fmt(cookieNoneStats.p50)} median, ${fmt(cookieNoneStats.p90)} p90`
);
console.log(
  `  Light cookie: ${fmt(cookieLightStats.p50)} median, ${fmt(cookieLightStats.p90)} p90`
);
console.log(
  `  Heavy cookie: ${fmt(cookieHeavyStats.p50)} median, ${fmt(cookieHeavyStats.p90)} p90`
);
console.log(
  `  parseSettings heavy (full bang context):  ${fmt(settingsFullContextStats.p50)} median, ${fmt(settingsFullContextStats.p90)} p90`
);
console.log(
  `  parseSettings heavy (plain only context): ${fmt(settingsPlainContextStats.p50)} median, ${fmt(settingsPlainContextStats.p90)} p90`
);
console.log(`  Plain-only parse speedup: ${settingsPlainSpeedup.toFixed(2)}x`);

// ---------------------------------------------------------------------------
// 8. FRECENCY HOT-PATH PERFORMANCE
// ---------------------------------------------------------------------------

separator("8. FRECENCY HOT-PATH PERFORMANCE");

const FRECENCY_ITERS = 200_000;
const FREQUENCY_TRIGGERS = [
  "g",
  "yt",
  "ddg",
  "gh",
  "w",
  "mdn",
  "npm",
  "rs",
  "so",
];
const FRECENCY_LIMIT = 8;

function legacyFrecencyCookie(counts: Record<string, number>): string {
  const keys = Object.keys(counts);
  if (keys.length === 0) {
    return "";
  }
  keys.sort((a, b) => counts[b] - counts[a] || a.localeCompare(b));
  const n = keys.length < FRECENCY_LIMIT ? keys.length : FRECENCY_LIMIT;
  let out = `${keys[0]}:${counts[keys[0]]}`;
  for (let i = 1; i < n; i++) {
    out += `.${keys[i]}:${counts[keys[i]]}`;
  }
  return out;
}

const legacyFrecencyTimes: number[] = [];
const incrementalFrecencyTimes: number[] = [];
let frecencySink = 0;

for (let run = 0; run < RUNS; run++) {
  const legacyCounts: Record<string, number> = {};
  const incrementalCounts: Record<string, number> = {};
  for (let i = 0; i < 64; i++) {
    const key = `seed-${i}`;
    const value = ((i * 17) % 23) + 1;
    legacyCounts[key] = value;
    incrementalCounts[key] = value;
  }

  let t0 = Bun.nanoseconds();
  for (let i = 0; i < FRECENCY_ITERS; i++) {
    const trigger = FREQUENCY_TRIGGERS[(i + run) % FREQUENCY_TRIGGERS.length];
    legacyCounts[trigger] = (legacyCounts[trigger] || 0) + 1;
    frecencySink += legacyFrecencyCookie(legacyCounts).length;
  }
  legacyFrecencyTimes.push((Bun.nanoseconds() - t0) / FRECENCY_ITERS);

  const top = buildTopFrecency(incrementalCounts, FRECENCY_LIMIT);
  t0 = Bun.nanoseconds();
  for (let i = 0; i < FRECENCY_ITERS; i++) {
    const trigger = FREQUENCY_TRIGGERS[(i + run) % FREQUENCY_TRIGGERS.length];
    const next = (incrementalCounts[trigger] || 0) + 1;
    incrementalCounts[trigger] = next;
    updateTopFrecencyOnIncrement(top, trigger, next, FRECENCY_LIMIT);
    frecencySink += serializeTopFrecency(top).length;
  }
  incrementalFrecencyTimes.push((Bun.nanoseconds() - t0) / FRECENCY_ITERS);
}

if (frecencySink === -1) {
  console.log("");
}

const legacyFrecencyStats = summarizeRuns(legacyFrecencyTimes);
const incrementalFrecencyStats = summarizeRuns(incrementalFrecencyTimes);
const frecencySpeedup = legacyFrecencyStats.p50 / incrementalFrecencyStats.p50;

console.log(
  `\nFrecency update benchmark — ${FRECENCY_ITERS.toLocaleString()} iterations × ${RUNS} runs:`
);
console.log(
  `  Legacy full-sort cookie rebuild: ${fmt(legacyFrecencyStats.p50)} median, ${fmt(legacyFrecencyStats.p90)} p90`
);
console.log(
  `  Incremental top-k update:        ${fmt(incrementalFrecencyStats.p50)} median, ${fmt(incrementalFrecencyStats.p90)} p90`
);
console.log(`  Incremental speedup: ${frecencySpeedup.toFixed(2)}x`);

// ---------------------------------------------------------------------------
// 9. SUGGEST HANDLER PERFORMANCE
// ---------------------------------------------------------------------------

separator("9. SUGGEST HANDLER PERFORMANCE");

const reqBang = new Request("http://localhost/suggest?q=!gh", {
  headers: { Cookie: "suggest=default,g," },
});
const reqPlain = new Request("http://localhost/suggest?q=flashbang&sp=none", {
  headers: { Cookie: "suggest=none,g," },
});
const reqPlainHeavy = new Request(
  "http://localhost/suggest?q=flashbang&sp=none",
  {
    headers: {
      Cookie:
        "session=abc123; theme=dark; lang=en-US; exp=beta-on; tracking=xyz;" +
        " suggest=custom,g,https%3A%2F%2Fexample.com%2Fsearch%3Fq%3D%7B%7D,|meta|gh.mdn.npm.rs.w;" +
        " sf=g:50.yt:30.w:20.ddg:10.gh:8.npm:6.rs:4;" +
        " misc1=1; misc2=2; misc3=3; misc4=4",
    },
  }
);

const HANDLER_ITERS = 60_000;
for (let i = 0; i < 1_000; i++) {
  await handleSuggestRequest(reqBang);
  await handleSuggestRequest(reqPlain);
  await handleSuggestRequest(reqPlainHeavy);
}

const handlerBangTimes: number[] = [];
const handlerPlainTimes: number[] = [];
const handlerPlainHeavyTimes: number[] = [];
for (let run = 0; run < RUNS; run++) {
  let t0 = Bun.nanoseconds();
  for (let i = 0; i < HANDLER_ITERS; i++) {
    await handleSuggestRequest(reqBang);
  }
  handlerBangTimes.push((Bun.nanoseconds() - t0) / HANDLER_ITERS);

  t0 = Bun.nanoseconds();
  for (let i = 0; i < HANDLER_ITERS; i++) {
    await handleSuggestRequest(reqPlain);
  }
  handlerPlainTimes.push((Bun.nanoseconds() - t0) / HANDLER_ITERS);

  t0 = Bun.nanoseconds();
  for (let i = 0; i < HANDLER_ITERS; i++) {
    await handleSuggestRequest(reqPlainHeavy);
  }
  handlerPlainHeavyTimes.push((Bun.nanoseconds() - t0) / HANDLER_ITERS);
}

const handlerBangStats = summarizeRuns(handlerBangTimes);
const handlerPlainStats = summarizeRuns(handlerPlainTimes);
const handlerPlainHeavyStats = summarizeRuns(handlerPlainHeavyTimes);

console.log(
  `\nhandleSuggestRequest() — ${HANDLER_ITERS.toLocaleString()} iterations × ${RUNS} runs:`
);
console.log(
  `  Bang query path:      ${fmt(handlerBangStats.p50)} median, ${fmt(handlerBangStats.p90)} p90`
);
console.log(
  `  Plain query path:     ${fmt(handlerPlainStats.p50)} median, ${fmt(handlerPlainStats.p90)} p90`
);
console.log(
  `  Plain heavy-cookie:   ${fmt(handlerPlainHeavyStats.p50)} median, ${fmt(handlerPlainHeavyStats.p90)} p90`
);

// ---------------------------------------------------------------------------
// 10. FIRST-HIT SUGGEST (ISOLATED PROCESS)
// ---------------------------------------------------------------------------

separator("10. FIRST-HIT SUGGEST (ISOLATED PROCESS)");

function runIsolatedNs(script: string, label: string): number {
  const proc = Bun.spawnSync({
    cmd: ["bun", "-e", script],
    stdout: "pipe",
    stderr: "pipe",
  });
  if (proc.exitCode !== 0) {
    const err = new TextDecoder().decode(proc.stderr).trim();
    throw new Error(`${label} failed: ${err}`);
  }
  return Number(new TextDecoder().decode(proc.stdout).trim());
}

function isolatedFirstHitNs(url: string, cookie: string): number {
  const script = `
import { handleSuggestRequest } from "./src/server/handlers";
const req = new Request(${JSON.stringify(url)}, {
  headers: { Cookie: ${JSON.stringify(cookie)} }
});
const t0 = Bun.nanoseconds();
await handleSuggestRequest(req);
console.log(Bun.nanoseconds() - t0);
`;
  return runIsolatedNs(script, "isolatedFirstHitNs");
}

function isolatedWarmThenBangNs(): number {
  const script = `
import { handleSuggestRequest } from "./src/server/handlers";
await handleSuggestRequest(new Request("http://localhost/suggest?q=flashbang&sp=none", {
  headers: { Cookie: "suggest=none,g," }
}));
await new Promise((resolve) => setTimeout(resolve, 5));
const t0 = Bun.nanoseconds();
await handleSuggestRequest(new Request("http://localhost/suggest?q=!gh", {
  headers: { Cookie: "suggest=default,g," }
}));
console.log(Bun.nanoseconds() - t0);
`;
  return runIsolatedNs(script, "isolatedWarmThenBangNs");
}

const coldPlainSamples: number[] = [];
const coldBangSamples: number[] = [];
const warmThenBangSamples: number[] = [];
for (let i = 0; i < COLD_RUNS; i++) {
  coldPlainSamples.push(
    isolatedFirstHitNs(
      "http://localhost/suggest?q=flashbang&sp=none",
      "suggest=none,g,"
    )
  );
  coldBangSamples.push(
    isolatedFirstHitNs("http://localhost/suggest?q=!gh", "suggest=default,g,")
  );
  warmThenBangSamples.push(isolatedWarmThenBangNs());
}

const coldPlainStats = summarizeRuns(coldPlainSamples);
const coldBangStats = summarizeRuns(coldBangSamples);
const warmThenBangStats = summarizeRuns(warmThenBangSamples);

const coldPlainNs = coldPlainStats.p50;
const coldBangNs = coldBangStats.p50;
const warmThenBangNs = warmThenBangStats.p50;

console.log(`\nFirst plain suggest request: ${fmt(coldPlainNs)} median`);
console.log(
  `  spread ${fmt(coldPlainStats.min)}..${fmt(coldPlainStats.max)} (${COLD_RUNS} isolated runs)`
);
console.log(`First bang suggest request:  ${fmt(coldBangNs)} median`);
console.log(
  `  spread ${fmt(coldBangStats.min)}..${fmt(coldBangStats.max)} (${COLD_RUNS} isolated runs)`
);
console.log(`Warm plain-then-bang request: ${fmt(warmThenBangNs)} median`);
console.log(
  `  spread ${fmt(warmThenBangStats.min)}..${fmt(warmThenBangStats.max)} (${COLD_RUNS} isolated runs)`
);

// ---------------------------------------------------------------------------
// 11. MODULE PARSE/EVAL TIME
// ---------------------------------------------------------------------------

separator("11. MODULE PARSE/EVAL TIME");

const minFile = await Bun.file(minPath).text();
const fullFile = await Bun.file(metaPath).text();
const minEvalCode = minFile
  .replaceAll("export const ", "const ")
  .replaceAll("export function ", "function ");
const fullEvalCode = fullFile
  .replace("export const BANGS=", "var __BANGS=")
  .replace(
    "Object.setPrototypeOf(BANGS,null)",
    "Object.setPrototypeOf(__BANGS,null)"
  );
const trieEvalCode = trieFile.replace(/export const /g, "var ");

const EVAL_RUNS = 20;

const evalMinTimes: number[] = [];
for (let i = 0; i < EVAL_RUNS; i++) {
  const t0 = Bun.nanoseconds();
  // Intentional: eval-equivalent to benchmark JS parse+eval time
  new Function(minEvalCode)();
  const elapsed = Bun.nanoseconds() - t0;
  evalMinTimes.push(elapsed);
}

const evalMinStats = summarizeRuns(evalMinTimes);

console.log(`\nbangs-min.js eval time (${fmtBytesExact(minBytes)}):`);
console.log(`  Median: ${fmt(evalMinStats.p50)}`);
console.log(`  p90:    ${fmt(evalMinStats.p90)}`);
console.log(
  `  Spread: ${fmt(evalMinStats.min)}..${fmt(evalMinStats.max)} (cv ${evalMinStats.cvPct.toFixed(1)}%)`
);

const evalFullTimes: number[] = [];
for (let i = 0; i < EVAL_RUNS; i++) {
  const t0 = Bun.nanoseconds();
  // Intentional: eval-equivalent to benchmark JS parse+eval time
  new Function(fullEvalCode)();
  const elapsed = Bun.nanoseconds() - t0;
  evalFullTimes.push(elapsed);
}

const evalFullStats = summarizeRuns(evalFullTimes);

console.log(`\nbangs-meta.js eval time (${fmtBytesExact(metaBytes)}):`);
console.log(`  Median: ${fmt(evalFullStats.p50)}`);
console.log(`  p90:    ${fmt(evalFullStats.p90)}`);
console.log(
  `  Spread: ${fmt(evalFullStats.min)}..${fmt(evalFullStats.max)} (cv ${evalFullStats.cvPct.toFixed(1)}%)`
);

const evalTrieTimes: number[] = [];
for (let i = 0; i < EVAL_RUNS; i++) {
  const t0 = Bun.nanoseconds();
  // Intentional: eval-equivalent to benchmark JS parse+eval time
  new Function(trieEvalCode)();
  const elapsed = Bun.nanoseconds() - t0;
  evalTrieTimes.push(elapsed);
}

const evalTrieStats = summarizeRuns(evalTrieTimes);

console.log(`\nbangs-trie.js eval time (${fmtBytesExact(trieBytes)}):`);
console.log(`  Median: ${fmt(evalTrieStats.p50)}`);
console.log(`  p90:    ${fmt(evalTrieStats.p90)}`);
console.log(
  `  Spread: ${fmt(evalTrieStats.min)}..${fmt(evalTrieStats.max)} (cv ${evalTrieStats.cvPct.toFixed(1)}%)`
);

// ---------------------------------------------------------------------------
// SUMMARY
// ---------------------------------------------------------------------------

separator("SUMMARY");

console.log(`
┌─────────────────────────────────────┬────────────┬──────────────┐
│ Component                           │ Time       │ Category     │
├─────────────────────────────────────┼────────────┼──────────────┤
│ Module eval (bangs-min.js)          │ ${fmt(evalMinStats.p50).padStart(10)} │ Cold start   │
│ Module eval (bangs-meta.js)         │ ${fmt(evalFullStats.p50).padStart(10)} │ Cold start   │
│ Module eval (bangs-trie.js)         │ ${fmt(evalTrieStats.p50).padStart(10)} │ Cold start   │
├─────────────────────────────────────┼────────────┼──────────────┤
│ Packed lookup (est. net)            │ ${fmt(lookupNetMedian).padStart(10)} │ Per redirect │
│ bangSuggestions pipeline            │ ${fmt(trieSuggestRunStats.p50).padStart(10)} │ Per suggest  │
│ Route parse (raw pathname)          │ ${fmt(pathViaRawStats.p50).padStart(10)} │ Per request  │
│ Query parse (two params, 1 scan)    │ ${fmt(querySingleStats.p50).padStart(10)} │ Per request  │
│ Cookie parse (heavy header)         │ ${fmt(cookieHeavyStats.p50).padStart(10)} │ Per request  │
│ Frecency update (incremental)       │ ${fmt(incrementalFrecencyStats.p50).padStart(10)} │ Per redirect │
│ Suggest handler (bang)              │ ${fmt(handlerBangStats.p50).padStart(10)} │ Per suggest  │
│ Suggest handler (plain heavy)       │ ${fmt(handlerPlainHeavyStats.p50).padStart(10)} │ Per suggest  │
│ First-hit suggest (plain)           │ ${fmt(coldPlainNs).padStart(10)} │ Cold start   │
│ First-hit suggest (bang)            │ ${fmt(coldBangNs).padStart(10)} │ Cold start   │
│ Warm plain-then-bang                │ ${fmt(warmThenBangNs).padStart(10)} │ Cold start   │
├─────────────────────────────────────┼────────────┼──────────────┤
│ Full redirect (bang query)          │ ${fmt(bangRedirect.p50).padStart(10)} │ Per redirect │
│ Full redirect (non-bang query)      │ ${fmt(nonBangRedirect.p50).padStart(10)} │ Per redirect │
│ SW message redirect (new path)      │ ${fmt(messageNewStats.p50).padStart(10)} │ Per message  │
└─────────────────────────────────────┴────────────┴──────────────┘
`);
