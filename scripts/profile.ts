/**
 * Comprehensive profiling for flashbang's core data structures and hot paths.
 * Measures what actually matters before optimizing.
 *
 * Run: bun scripts/profile.ts
 */

import { BANGS } from "../src/generated/bangs-min.js";
import type { TrieNode } from "../src/generated/bangs-trie.js";
import { TRIE } from "../src/generated/bangs-trie.js";
import { handleSuggestRequest } from "../src/server/handlers";
import { readPathname } from "../src/shared/raw-url";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function median(arr: number[]): number {
  const s = arr.slice().sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)];
}

function p99(arr: number[]): number {
  const s = arr.slice().sort((a, b) => a - b);
  return s[Math.floor(s.length * 0.99)];
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

// ---------------------------------------------------------------------------
// 1. FILE SIZES & DATA STATS
// ---------------------------------------------------------------------------

separator("1. DATA SIZE & STRUCTURE ANALYSIS");

const keys = Object.keys(BANGS);
const minPath = "src/generated/bangs-min.js";
const metaPath = "src/generated/bangs-meta.js";
const triePath = "src/generated/bangs-trie.js";

const minBytes = Bun.file(minPath).size;
const metaBytes = Bun.file(metaPath).size;
const trieBytes = Bun.file(triePath).size;
const totalGeneratedBytes = minBytes + metaBytes + trieBytes;

console.log(`\nBang count: ${keys.length.toLocaleString()}`);
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
  `Avg bytes per bang: ${Math.round(totalGeneratedBytes / keys.length).toLocaleString()}B`
);

// ---------------------------------------------------------------------------
// 2. TRIE STRUCTURE ANALYSIS
// ---------------------------------------------------------------------------

separator("2. TRIE STRUCTURE ANALYSIS");

function trieStats(node: TrieNode): {
  nodes: number;
  terminals: number;
  edges: number;
  maxDepth: number;
} {
  let nodes = 0;
  let terminals = 0;
  let edges = 0;
  let maxDepth = 0;

  function walk(n: TrieNode, depth: number) {
    nodes++;
    if (n.t) {
      terminals++;
    }
    edges += n.c.length;
    if (depth > maxDepth) {
      maxDepth = depth;
    }
    for (const [, child] of n.c) {
      walk(child, depth + 1);
    }
  }

  walk(node, 0);
  return { nodes, terminals, edges, maxDepth };
}

const ts = trieStats(TRIE);
console.log("\nRadix trie structure:");
console.log(`  Nodes:     ${ts.nodes.toLocaleString()}`);
console.log(`  Terminals: ${ts.terminals.toLocaleString()}`);
console.log(`  Edges:     ${ts.edges.toLocaleString()}`);
console.log(`  Max depth: ${ts.maxDepth}`);
console.log(`  Root children: ${TRIE.c.length}`);
console.log(`  Max relevance: ${TRIE.m}`);

// ---------------------------------------------------------------------------
// 3. BANG LOOKUP PERFORMANCE (Object property access)
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
    void BANGS[k];
  }
}

const LOOKUP_ITERS = 1_000_000;
const lookupBaselineTimes: number[] = [];
const lookupTimes: number[] = [];
const lookupHitCounts: number[] = [];

for (let run = 0; run < 10; run++) {
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
    if (BANGS[allSamples[(i + offset + baselineLen) % allSamples.length]]) {
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

console.log("\nObject property lookup (BANGS[key]):");
console.log(`  ${LOOKUP_ITERS.toLocaleString()} iterations × 10 runs`);
console.log(`  Median (raw):      ${fmt(lookupRawMedian)}/lookup`);
console.log(`  p99 (raw):         ${fmt(p99(lookupTimes))}/lookup`);
console.log(`  Loop baseline:     ${fmt(lookupBaselineMedian)}/iter`);
console.log(`  Estimated lookup:  ${fmt(lookupNetMedian)}/lookup`);
console.log(`  Sample hit ratio:  ${lookupHitRatioPct.toFixed(1)}%`);

// ---------------------------------------------------------------------------
// 4. TRIE-BASED SUGGESTION PERFORMANCE
// ---------------------------------------------------------------------------

separator("4. TRIE-BASED SUGGESTION PERFORMANCE");

const TOP_K = 8;

function walkPrefix(partial: string): [TrieNode, string] | null {
  let node: TrieNode = TRIE;
  let pos = 0;

  while (pos < partial.length) {
    let found = false;
    for (const [edge, child] of node.c) {
      const limit = Math.min(partial.length - pos, edge.length);
      let match = 0;
      while (
        match < limit &&
        partial.charCodeAt(pos + match) === edge.charCodeAt(match)
      ) {
        match++;
      }
      if (match === 0) {
        continue;
      }
      if (match < edge.length) {
        if (match < partial.length - pos) {
          return null;
        }
        return [child, edge.substring(match)];
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

function trieSuggestion(partial: string): string[] {
  const result = walkPrefix(partial);
  if (!result) {
    return [];
  }

  const [subtree] = result;
  const results: { k: string; score: number }[] = [];
  let threshold = -1;

  function dfs(node: TrieNode) {
    if (node.t) {
      const score = node.t.r;
      if (results.length < TOP_K) {
        results.push({ k: node.t.k, score });
        if (results.length === TOP_K) {
          results.sort((a, b) => b.score - a.score);
          threshold = results[TOP_K - 1].score;
        }
      } else if (score > threshold) {
        results.sort((a, b) => b.score - a.score);
        results[TOP_K - 1] = { k: node.t.k, score };
        results.sort((a, b) => b.score - a.score);
        threshold = results[TOP_K - 1].score;
      }
    }
    for (const [, child] of node.c) {
      if (results.length >= TOP_K && child.m <= threshold) {
        continue;
      }
      dfs(child);
    }
  }

  dfs(subtree);
  results.sort((a, b) => b.score - a.score);
  return results.slice(0, TOP_K).map((r) => r.k);
}

const suggestPartials = ["g", "gh", "gi", "yt", "a", "s"];
const SUGGEST_ITERS = 100_000;

// Warm up
for (let i = 0; i < 1_000; i++) {
  trieSuggestion(suggestPartials[i % suggestPartials.length]);
}

const trieSuggestTimes: number[] = [];
for (let run = 0; run < 10; run++) {
  const t0 = Bun.nanoseconds();
  for (let i = 0; i < SUGGEST_ITERS; i++) {
    trieSuggestion(suggestPartials[i % suggestPartials.length]);
  }
  const elapsed = Bun.nanoseconds() - t0;
  trieSuggestTimes.push(elapsed / SUGGEST_ITERS);
}

console.log("\nTrie suggestion pipeline (walkPrefix + topK with pruning):");
console.log(`  ${SUGGEST_ITERS.toLocaleString()} iterations × 10 runs`);
console.log(`  Median: ${fmt(median(trieSuggestTimes))}/suggest`);
console.log(`  p99:    ${fmt(p99(trieSuggestTimes))}/suggest`);

// Per-prefix breakdown
console.log("\n  Per-prefix timings:");
for (const p of suggestPartials) {
  const times: number[] = [];
  for (let run = 0; run < 10; run++) {
    const t0 = Bun.nanoseconds();
    for (let i = 0; i < SUGGEST_ITERS; i++) {
      trieSuggestion(p);
    }
    const elapsed = Bun.nanoseconds() - t0;
    times.push(elapsed / SUGGEST_ITERS);
  }

  const result = walkPrefix(p);
  let matchCount = 0;
  if (result) {
    function count(n: TrieNode): number {
      let c = n.t ? 1 : 0;
      for (const [, child] of n.c) {
        c += count(child);
      }
      return c;
    }
    matchCount = count(result[0]);
  }
  console.log(
    `    "${p}": ${fmt(median(times))} median (${matchCount} matches in subtree)`
  );
}

// ---------------------------------------------------------------------------
// 5. REDIRECT PIPELINE PERFORMANCE
// ---------------------------------------------------------------------------

separator("5. FULL REDIRECT PIPELINE");

const { redirectRaw } = await import("../src/sw/redirect");

const settings = {
  defaultUrl: ["https://www.google.com/search?q=", ""] as const,
  luckyUrl: ["https://duckduckgo.com/?q=\\", ""] as const,
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
const redirectStats = new Map<string, { medianNs: number; p99Ns: number }>();

for (let i = 0; i < 10_000; i++) {
  redirectRaw(queries[i % queries.length].raw, settings);
}

console.log(
  `\nredirectRaw() — ${REDIRECT_ITERS.toLocaleString()} iterations × 10 runs:`
);
console.log(
  `${"Query type".padEnd(24)} ${"Median".padStart(10)} ${"p99".padStart(10)}`
);
console.log("-".repeat(46));

for (const q of queries) {
  const times: number[] = [];
  for (let run = 0; run < 10; run++) {
    const t0 = Bun.nanoseconds();
    for (let i = 0; i < REDIRECT_ITERS; i++) {
      redirectRaw(q.raw, settings);
    }
    const elapsed = Bun.nanoseconds() - t0;
    times.push(elapsed / REDIRECT_ITERS);
  }
  const med = median(times);
  const tail = p99(times);
  redirectStats.set(q.label, { medianNs: med, p99Ns: tail });
  console.log(
    `  ${q.label.padEnd(22)} ${fmt(med).padStart(10)} ${fmt(tail).padStart(10)}`
  );
}

const bangRedirect = redirectStats.get("Prefix bang");
const nonBangRedirect = redirectStats.get("No bang (default)");
if (!(bangRedirect && nonBangRedirect)) {
  throw new Error(
    "redirect profile samples missing expected labels: Prefix bang / No bang (default)"
  );
}

// ---------------------------------------------------------------------------
// 6. SERVER ROUTE PATH PARSE PERFORMANCE
// ---------------------------------------------------------------------------

separator("6. SERVER ROUTE PATH PARSE PERFORMANCE");

const RAW_URL = "https://flashbang.local/suggest?q=%21g&sp=none#x";
const PATH_ITERS = 1_000_000;
const pathViaUrlTimes: number[] = [];
const pathViaRawTimes: number[] = [];

for (let i = 0; i < 10_000; i++) {
  void new URL(RAW_URL).pathname;
  void readPathname(RAW_URL);
}

for (let run = 0; run < 10; run++) {
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

console.log(
  `\nPath parse benchmark — ${PATH_ITERS.toLocaleString()} iterations × 10 runs:`
);
console.log(`  new URL(url).pathname: ${fmt(median(pathViaUrlTimes))} median`);
console.log(`  readPathname(url):      ${fmt(median(pathViaRawTimes))} median`);

// ---------------------------------------------------------------------------
// 7. SUGGEST HANDLER PERFORMANCE
// ---------------------------------------------------------------------------

separator("7. SUGGEST HANDLER PERFORMANCE");

const reqBang = new Request("http://localhost/suggest?q=!gh", {
  headers: { Cookie: "suggest=default,g," },
});
const reqPlain = new Request("http://localhost/suggest?q=flashbang&sp=none", {
  headers: { Cookie: "suggest=none,g," },
});

const HANDLER_ITERS = 100_000;
for (let i = 0; i < 1_000; i++) {
  await handleSuggestRequest(reqBang);
  await handleSuggestRequest(reqPlain);
}

const handlerBangTimes: number[] = [];
const handlerPlainTimes: number[] = [];
for (let run = 0; run < 10; run++) {
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
}

console.log(
  `\nhandleSuggestRequest() — ${HANDLER_ITERS.toLocaleString()} iterations × 10 runs:`
);
console.log(`  Bang query path:      ${fmt(median(handlerBangTimes))} median`);
console.log(`  Plain query path:     ${fmt(median(handlerPlainTimes))} median`);

// ---------------------------------------------------------------------------
// 8. FIRST-HIT SUGGEST (ISOLATED PROCESS)
// ---------------------------------------------------------------------------

separator("8. FIRST-HIT SUGGEST (ISOLATED PROCESS)");

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
  const proc = Bun.spawnSync({
    cmd: ["bun", "-e", script],
    stdout: "pipe",
    stderr: "pipe",
  });
  if (proc.exitCode !== 0) {
    const err = new TextDecoder().decode(proc.stderr).trim();
    throw new Error(`isolatedFirstHitNs failed: ${err}`);
  }
  const out = new TextDecoder().decode(proc.stdout).trim();
  return Number(out);
}

const coldPlainNs = isolatedFirstHitNs(
  "http://localhost/suggest?q=flashbang&sp=none",
  "suggest=none,g,"
);
const coldBangNs = isolatedFirstHitNs(
  "http://localhost/suggest?q=!gh",
  "suggest=default,g,"
);
console.log(`\nFirst plain suggest request: ${fmt(coldPlainNs)}`);
console.log(`First bang suggest request:  ${fmt(coldBangNs)}`);

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
  const proc = Bun.spawnSync({
    cmd: ["bun", "-e", script],
    stdout: "pipe",
    stderr: "pipe",
  });
  if (proc.exitCode !== 0) {
    const err = new TextDecoder().decode(proc.stderr).trim();
    throw new Error(`isolatedWarmThenBangNs failed: ${err}`);
  }
  return Number(new TextDecoder().decode(proc.stdout).trim());
}

const warmThenBangNs = isolatedWarmThenBangNs();
console.log(`Warm plain-then-bang request: ${fmt(warmThenBangNs)}`);

// ---------------------------------------------------------------------------
// 9. MODULE PARSE/EVAL TIME
// ---------------------------------------------------------------------------

separator("9. MODULE PARSE/EVAL TIME");

const minFile = await Bun.file(minPath).text();
const fullFile = await Bun.file(metaPath).text();

const EVAL_RUNS = 20;

const evalMinTimes: number[] = [];
for (let i = 0; i < EVAL_RUNS; i++) {
  const code = minFile
    .replace("export const BANGS=", "var __BANGS=")
    .replace(
      "Object.setPrototypeOf(BANGS,null)",
      "Object.setPrototypeOf(__BANGS,null)"
    );
  const t0 = Bun.nanoseconds();
  // Intentional: eval-equivalent to benchmark JS parse+eval time
  new Function(code)();
  const elapsed = Bun.nanoseconds() - t0;
  evalMinTimes.push(elapsed);
}

console.log(`\nbangs-min.js eval time (${fmtBytesExact(minBytes)}):`);
console.log(`  Median: ${fmt(median(evalMinTimes))}`);
console.log(`  p99:    ${fmt(p99(evalMinTimes))}`);

const evalFullTimes: number[] = [];
for (let i = 0; i < EVAL_RUNS; i++) {
  const code = fullFile
    .replace("export const BANGS=", "var __BANGS=")
    .replace(
      "Object.setPrototypeOf(BANGS,null)",
      "Object.setPrototypeOf(__BANGS,null)"
    );
  const t0 = Bun.nanoseconds();
  // Intentional: eval-equivalent to benchmark JS parse+eval time
  new Function(code)();
  const elapsed = Bun.nanoseconds() - t0;
  evalFullTimes.push(elapsed);
}

console.log(`\nbangs-meta.js eval time (${fmtBytesExact(metaBytes)}):`);
console.log(`  Median: ${fmt(median(evalFullTimes))}`);
console.log(`  p99:    ${fmt(p99(evalFullTimes))}`);

const evalTrieTimes: number[] = [];
for (let i = 0; i < EVAL_RUNS; i++) {
  const code = trieFile.replace("export const TRIE=", "var __TRIE=");
  const t0 = Bun.nanoseconds();
  // Intentional: eval-equivalent to benchmark JS parse+eval time
  new Function(code)();
  const elapsed = Bun.nanoseconds() - t0;
  evalTrieTimes.push(elapsed);
}

console.log(`\nbangs-trie.js eval time (${fmtBytesExact(trieBytes)}):`);
console.log(`  Median: ${fmt(median(evalTrieTimes))}`);
console.log(`  p99:    ${fmt(p99(evalTrieTimes))}`);

// ---------------------------------------------------------------------------
// SUMMARY
// ---------------------------------------------------------------------------

separator("SUMMARY");

console.log(`
┌─────────────────────────────────────┬────────────┬──────────────┐
│ Component                           │ Time       │ Category     │
├─────────────────────────────────────┼────────────┼──────────────┤
│ Module eval (bangs-min.js)          │ ${fmt(median(evalMinTimes)).padStart(10)} │ Cold start   │
│ Module eval (bangs-meta.js)         │ ${fmt(median(evalFullTimes)).padStart(10)} │ Cold start   │
│ Module eval (bangs-trie.js)         │ ${fmt(median(evalTrieTimes)).padStart(10)} │ Cold start   │
├─────────────────────────────────────┼────────────┼──────────────┤
│ Object lookup (BANGS[key])          │ ${fmt(median(lookupTimes)).padStart(10)} │ Per redirect │
│ Trie suggestion pipeline            │ ${fmt(median(trieSuggestTimes)).padStart(10)} │ Per suggest  │
│ Route parse (raw pathname)          │ ${fmt(median(pathViaRawTimes)).padStart(10)} │ Per request  │
│ Suggest handler (bang)              │ ${fmt(median(handlerBangTimes)).padStart(10)} │ Per suggest  │
│ First-hit suggest (plain)           │ ${fmt(coldPlainNs).padStart(10)} │ Cold start   │
│ First-hit suggest (bang)            │ ${fmt(coldBangNs).padStart(10)} │ Cold start   │
│ Warm plain-then-bang                │ ${fmt(warmThenBangNs).padStart(10)} │ Cold start   │
├─────────────────────────────────────┼────────────┼──────────────┤
│ Full redirect (bang query)          │ ${fmt(bangRedirect.medianNs).padStart(10)} │ Per redirect │
│ Full redirect (non-bang query)      │ ${fmt(nonBangRedirect.medianNs).padStart(10)} │ Per redirect │
└─────────────────────────────────────┴────────────┴──────────────┘
`);
