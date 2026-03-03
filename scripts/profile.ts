/**
 * Comprehensive profiling for flashbang's core data structures and hot paths.
 * Measures what actually matters before optimizing.
 *
 * Run: bun scripts/profile.ts
 */

import { BANGS } from "../src/generated/bangs-min.js";
import type { TrieNode } from "../src/generated/bangs-trie.js";
import { TRIE } from "../src/generated/bangs-trie.js";

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

// ---------------------------------------------------------------------------
// 1. FILE SIZES & DATA STATS
// ---------------------------------------------------------------------------

separator("1. DATA SIZE & STRUCTURE ANALYSIS");

const keys = Object.keys(BANGS);
const _urls = Object.values(BANGS) as string[];

console.log(`\nBang count: ${keys.length.toLocaleString()}`);
console.log(
  `bangs-min.js:  ${fmtBytes(866_773)}  (trigger→URL only, used by SW)`
);
console.log(
  `bangs-full.js: ${fmtBytes(1_575_411)}  (trigger→{name,domain,url,r}, used by UI)`
);

const trieFile = await Bun.file("src/generated/bangs-trie.js").text();
console.log(
  `bangs-trie.js: ${fmtBytes(trieFile.length)}  (radix trie, used by suggest)`
);
console.log(
  `Total generated: ${fmtBytes(866_773 + 1_575_411 + trieFile.length)}`
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
const lookupTimes: number[] = [];

for (let run = 0; run < 10; run++) {
  const t0 = Bun.nanoseconds();
  for (let i = 0; i < LOOKUP_ITERS; i++) {
    void BANGS[allSamples[i % allSamples.length]];
  }
  const elapsed = Bun.nanoseconds() - t0;
  lookupTimes.push(elapsed / LOOKUP_ITERS);
}

console.log("\nObject property lookup (BANGS[key]):");
console.log(`  ${LOOKUP_ITERS.toLocaleString()} iterations × 10 runs`);
console.log(`  Median: ${fmt(median(lookupTimes))}/lookup`);
console.log(`  p99:    ${fmt(p99(lookupTimes))}/lookup`);

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
  defaultUrl: "https://www.google.com/search?q={}",
  luckyUrl: "https://duckduckgo.com/?q=\\{}",
  custom: {} as Record<string, string>,
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
  console.log(
    `  ${q.label.padEnd(22)} ${fmt(median(times)).padStart(10)} ${fmt(p99(times)).padStart(10)}`
  );
}

// ---------------------------------------------------------------------------
// 6. MODULE PARSE/EVAL TIME
// ---------------------------------------------------------------------------

separator("6. MODULE PARSE/EVAL TIME");

const minFile = await Bun.file("src/generated/bangs-min.js").text();
const fullFile = await Bun.file("src/generated/bangs-full.js").text();

const EVAL_RUNS = 20;

const evalMinTimes: number[] = [];
for (let i = 0; i < EVAL_RUNS; i++) {
  const code = minFile.replace("export const BANGS=", "var __BANGS=");
  const t0 = Bun.nanoseconds();
  // Intentional: eval-equivalent to benchmark JS parse+eval time
  new Function(code)();
  const elapsed = Bun.nanoseconds() - t0;
  evalMinTimes.push(elapsed);
}

console.log(`\nbangs-min.js eval time (${fmtBytes(minFile.length)}):`);
console.log(`  Median: ${fmt(median(evalMinTimes))}`);
console.log(`  p99:    ${fmt(p99(evalMinTimes))}`);

const evalFullTimes: number[] = [];
for (let i = 0; i < EVAL_RUNS; i++) {
  const code = fullFile.replace("export const BANGS=", "var __BANGS=");
  const t0 = Bun.nanoseconds();
  // Intentional: eval-equivalent to benchmark JS parse+eval time
  new Function(code)();
  const elapsed = Bun.nanoseconds() - t0;
  evalFullTimes.push(elapsed);
}

console.log(`\nbangs-full.js eval time (${fmtBytes(fullFile.length)}):`);
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

console.log(`\nbangs-trie.js eval time (${fmtBytes(trieFile.length)}):`);
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
│ Module eval (bangs-full.js)         │ ${fmt(median(evalFullTimes)).padStart(10)} │ Cold start   │
│ Module eval (bangs-trie.js)         │ ${fmt(median(evalTrieTimes)).padStart(10)} │ Cold start   │
├─────────────────────────────────────┼────────────┼──────────────┤
│ Object lookup (BANGS[key])          │ ${fmt(median(lookupTimes)).padStart(10)} │ Per redirect │
│ Trie suggestion pipeline            │ ${fmt(median(trieSuggestTimes)).padStart(10)} │ Per suggest  │
├─────────────────────────────────────┼────────────┼──────────────┤
│ Full redirect (bang query)          │  see above │ Per redirect │
│ Full redirect (non-bang query)      │  see above │ Per redirect │
└─────────────────────────────────────┴────────────┴──────────────┘
`);
