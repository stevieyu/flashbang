import { mkdir } from "node:fs/promises";

interface Bang {
  domain: string;
  name: string;
  relevance: number;
  trigger: string;
  url: string;
}

interface RawDdgEntry {
  d: string;
  r?: number;
  s: string;
  t: string;
  ts?: string[];
  u: string;
}

interface RawKagiEntry {
  d: string;
  s: string;
  t: string;
  ts?: string[];
  u: string;
}

function normalizeUrl(u: string): string {
  return u.replaceAll("{{{s}}}", "{}");
}

function parseDdg(raw: string): Bang[] {
  const entries: RawDdgEntry[] = JSON.parse(raw);
  const bangs: Bang[] = [];

  for (const entry of entries) {
    const url = normalizeUrl(entry.u);
    const relevance = entry.r ?? 0;

    bangs.push({
      trigger: entry.t.toLowerCase(),
      name: entry.s,
      domain: entry.d,
      url,
      relevance,
    });

    if (entry.ts) {
      for (const alias of entry.ts) {
        bangs.push({
          trigger: alias.toLowerCase(),
          name: entry.s,
          domain: entry.d,
          url,
          relevance,
        });
      }
    }
  }

  return bangs;
}

function parseKagi(raw: string): Bang[] {
  const entries: RawKagiEntry[] = JSON.parse(raw);
  const bangs: Bang[] = [];

  for (const entry of entries) {
    const url = normalizeUrl(entry.u);

    bangs.push({
      trigger: entry.t.toLowerCase(),
      name: entry.s,
      domain: entry.d,
      url,
      relevance: 0,
    });

    if (entry.ts) {
      for (const alias of entry.ts) {
        bangs.push({
          trigger: alias.toLowerCase(),
          name: entry.s,
          domain: entry.d,
          url,
          relevance: 0,
        });
      }
    }
  }

  return bangs;
}

function parseCustom(
  data: Record<string, { name: string; url: string; domain: string }>
): Bang[] {
  return Object.entries(data).map(([trigger, b]) => ({
    trigger: trigger.toLowerCase(),
    name: b.name,
    domain: b.domain,
    url: b.url,
    relevance: 0,
  }));
}

function merge(sources: [string, Bang[]][]): Bang[] {
  const map = new Map<string, Bang>();

  for (const [, bangs] of sources) {
    for (const bang of bangs) {
      const existing = map.get(bang.trigger);
      if (existing) {
        map.set(bang.trigger, {
          ...bang,
          relevance: Math.max(existing.relevance, bang.relevance),
        });
      } else {
        map.set(bang.trigger, bang);
      }
    }
  }

  return [...map.values()].sort((a, b) => a.trigger.localeCompare(b.trigger));
}

function validate(bangs: Bang[]): Bang[] {
  return bangs.filter((b) => {
    if (!b.trigger) {
      return false;
    }
    if (!b.url.includes("{}")) {
      console.error(`Warning: bang !${b.trigger} has no {} placeholder in URL`);
    }
    return true;
  });
}

function jsEscape(s: string): string {
  let out = "";
  for (const c of s) {
    switch (c) {
      case "\\":
        out += "\\\\";
        break;
      case "'":
        out += "\\'";
        break;
      case "\n":
        out += "\\n";
        break;
      case "\r":
        out += "\\r";
        break;
      default:
        out += c;
    }
  }
  return out;
}

function jsonEscape(s: string): string {
  let out = "";
  for (const c of s) {
    switch (c) {
      case '"':
        out += '\\"';
        break;
      case "\\":
        out += "\\\\";
        break;
      case "\n":
        out += "\\n";
        break;
      case "\r":
        out += "\\r";
        break;
      default:
        out += c;
    }
  }
  return out;
}

// NOTE: JSON.parse is ~2x faster than a JS object literal for large objects
// because V8 uses a dedicated C++ fast path that skips the full parser/compiler.
// See https://v8.dev/blog/cost-of-javascript-2019#json
//
// Object.setPrototypeOf(BANGS, null) replaces the old {__proto__:null} literal
// approach. A null prototype eliminates the prototype chain walk on lookups,
// so BANGS[trigger] resolves in a single step.
function wrapJsonParse(json: string): string {
  const escaped = json.replaceAll("\\", "\\\\").replaceAll("'", "\\'");
  return `JSON.parse('${escaped}')`;
}

function generateMin(bangs: Bang[]): string {
  let json = "{";
  for (let i = 0; i < bangs.length; i++) {
    if (i > 0) {
      json += ",";
    }
    json += `"${jsonEscape(bangs[i].trigger)}":"${jsonEscape(bangs[i].url)}"`;
  }
  json += "}";
  return `export const BANGS=${wrapJsonParse(json)};Object.setPrototypeOf(BANGS,null);`;
}

function generateFull(bangs: Bang[]): string {
  let json = "{";
  for (let i = 0; i < bangs.length; i++) {
    if (i > 0) {
      json += ",";
    }
    const b = bangs[i];
    const val = `{"s":${JSON.stringify(b.name)},"d":${JSON.stringify(b.domain)},"u":${JSON.stringify(b.url)},"r":${b.relevance}}`;
    json += `"${jsonEscape(b.trigger)}":${val}`;
  }
  json += "}";
  return `export const BANGS=${wrapJsonParse(json)};Object.setPrototypeOf(BANGS,null);`;
}

import { type BuildNode, buildRadixTrie } from "../src/shared/trie";

type TrieNode = BuildNode<Bang>;

function serializeNode(node: TrieNode): string {
  const parts: string[] = [];

  const sorted = [...node.children.entries()].sort(
    (a, b) => b[1].maxRelevance - a[1].maxRelevance
  );
  let childrenStr = "[";
  for (let i = 0; i < sorted.length; i++) {
    if (i > 0) {
      childrenStr += ",";
    }
    childrenStr += `['${jsEscape(sorted[i][0])}',${serializeNode(sorted[i][1])}]`;
  }
  childrenStr += "]";
  parts.push(`c:${childrenStr}`);

  parts.push(`m:${node.maxRelevance}`);

  if (node.terminal) {
    const t = node.terminal;
    parts.push(
      `t:{k:'${jsEscape(t.trigger)}',s:'${jsEscape(t.name)}',d:'${jsEscape(t.domain)}',u:'${jsEscape(t.url)}',r:${t.relevance}}`
    );
  } else {
    parts.push("t:null");
  }

  return `{${parts.join(",")}}`;
}

function generateTrie(root: TrieNode): string {
  return `export const TRIE=${serializeNode(root)};`;
}

const MERGED_PATH = "data/bangs.json";
const noFetch = process.argv.includes("--no-fetch");
const fromMerged = process.argv.includes("--from-merged");

let valid: Bang[];

if (fromMerged) {
  console.log("=== Read merged bangs ===");
  valid = await Bun.file(MERGED_PATH).json();
  console.log(`Loaded ${valid.length} bangs from ${MERGED_PATH}`);
} else {
  if (!noFetch) {
    console.log("=== Fetch bang sources ===");
    await mkdir("data", { recursive: true });
    const [kagiRes, ddgRes] = await Promise.all([
      fetch(
        "https://raw.githubusercontent.com/kagisearch/bangs/main/data/bangs.json"
      ),
      fetch("https://duckduckgo.com/bang.js"),
    ]);
    await Promise.all([
      Bun.write("data/kagi.json", kagiRes),
      Bun.write("data/ddg.json", ddgRes),
    ]);
  }

  console.log("=== Parse sources ===");

  const allSources: [string, Bang[]][] = [];

  const ddgRaw = await Bun.file("data/ddg.json").text();
  const ddgBangs = parseDdg(ddgRaw);
  console.log(`DDG: ${ddgBangs.length} bangs parsed`);
  allSources.push(["ddg", ddgBangs]);

  const kagiRaw = await Bun.file("data/kagi.json").text();
  const kagiBangs = parseKagi(kagiRaw);
  console.log(`Kagi: ${kagiBangs.length} bangs parsed`);
  allSources.push(["kagi", kagiBangs]);

  const customData = await Bun.file("config/custom.json").json();
  const customBangs = parseCustom(customData);
  console.log(`Custom: ${customBangs.length} bangs parsed`);
  allSources.push(["custom", customBangs]);

  console.log("=== Merge + validate ===");
  const merged = merge(allSources);
  console.log(`Merged: ${merged.length} unique bangs`);

  valid = validate(merged);
  console.log(`Valid: ${valid.length} bangs after validation`);

  console.log("=== Save merged bangs ===");
  await Bun.write(MERGED_PATH, JSON.stringify(valid));
  console.log(`  ${MERGED_PATH}: ${valid.length} bangs`);
}

console.log("=== Generate ===");
const outDir = "src/generated";
await mkdir(outDir, { recursive: true });

const minJs = generateMin(valid);
await Bun.write(`${outDir}/bangs-min.js`, minJs);
console.log(`  bangs-min.js: ${minJs.length} bytes`);

const fullJs = generateFull(valid);
await Bun.write(`${outDir}/bangs-full.js`, fullJs);
console.log(`  bangs-full.js: ${fullJs.length} bytes`);

const trieRoot = buildRadixTrie(
  valid,
  (b) => b.trigger,
  (b) => b.relevance
);
const trieJs = generateTrie(trieRoot);
await Bun.write(`${outDir}/bangs-trie.js`, trieJs);
console.log(`  bangs-trie.js: ${trieJs.length} bytes`);

await Promise.all([
  Bun.write(
    `${outDir}/bangs-min.d.ts`,
    "export declare const BANGS: Record<string, string>;\n"
  ),
  Bun.write(
    `${outDir}/bangs-full.d.ts`,
    "export declare const BANGS: Record<string, { s: string; d: string; u: string; r: number }>;\n"
  ),
  Bun.write(
    `${outDir}/bangs-trie.d.ts`,
    [
      "export interface TrieNode {",
      "  c: [string, TrieNode][];",
      "  m: number;",
      "  t: { k: string; s: string; d: string; u: string; r: number } | null;",
      "}",
      "export declare const TRIE: TrieNode;",
      "",
    ].join("\n")
  ),
]);

console.log(`Generated ${valid.length} bangs in ${outDir}/`);
