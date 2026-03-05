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

function normalizeUrl(u: string, base: string): string {
  let url = u.replaceAll("{{{s}}}", "{}");
  if (!url.startsWith("http")) {
    url = `${base}${url.startsWith("/") ? "" : "/"}${url}`;
  }
  return url;
}

function parseDdg(raw: string): Bang[] {
  const entries: RawDdgEntry[] = JSON.parse(raw);
  const bangs: Bang[] = [];

  for (const entry of entries) {
    const url = normalizeUrl(entry.u, "https://duckduckgo.com");
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
    const url = normalizeUrl(entry.u, "https://kagi.com");

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

// NOTE: Custom escape functions produce smaller output than JSON.stringify,
// which emits \uXXXX for characters that don't need escaping in practice.
// Using single-quoted JS strings in generateMin also avoids the double-escape
// problem where JSON.stringify(jsonString) escapes every " to \", nearly
// doubling the output size.

/** Escape for embedding in a single-quoted JS string literal. */
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

/** Escape for embedding in a double-quoted JSON string. */
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

function splitTemplate(url: string): [string, string | null] {
  const idx = url.indexOf("{}");
  if (idx === -1) {
    return [url, null];
  }
  return [url.substring(0, idx), url.substring(idx + 2)];
}

function generateMin(bangs: Bang[]): string {
  let json = "{";
  for (let i = 0; i < bangs.length; i++) {
    if (i > 0) {
      json += ",";
    }
    const [prefix, suffix] = splitTemplate(bangs[i].url);
    const val =
      suffix === null
        ? `["${jsonEscape(prefix)}",null]`
        : `["${jsonEscape(prefix)}","${jsonEscape(suffix)}"]`;
    json += `"${jsonEscape(bangs[i].trigger)}":${val}`;
  }
  json += "}";

  return (
    // NOTE: 'let' prevents the bundler from inlining _d into both ternary
    // branches, which would duplicate the ~900KB string and double output size.
    `let _d='${jsEscape(json)}';` +
    // NOTE: InternalError is SpiderMonkey-only; everything else gets Function().
    `export const BANGS=typeof InternalError!=='undefined'` +
    // NOTE: SpiderMonkey JSON.parse (Function() is 3.5x slower there)
    "?JSON.parse(_d)" +
    // NOTE: V8/JSC → Function() (~4x faster on V8, ~2x faster on JSC)
    `:(0,Function)('return '+_d)();` +
    // NOTE: Null prototype: -40% miss improvement on V8, -15% SM, -6% JSC
    // Hit cost is tiny (+3-5%) and benefit outweighs the cons.
    // Extremely important when using Function() in JSC without it huge slow down
    "Object.setPrototypeOf(BANGS,null);"
  );
}

function generateMeta(bangs: Bang[]): string {
  let json = "{";
  for (let i = 0; i < bangs.length; i++) {
    if (i > 0) {
      json += ",";
    }
    const b = bangs[i];
    json += `"${jsonEscape(b.trigger)}":{"s":"${jsonEscape(b.name)}","d":"${jsonEscape(b.domain)}"}`;
  }
  json += "}";
  // NOTE: Null prototype as mentioned above improves miss performance why not
  // add it for meta bangs
  return `export const BANGS=${json};Object.setPrototypeOf(BANGS,null);`;
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
      `t:{k:'${jsEscape(t.trigger)}',s:'${jsEscape(t.name)}',d:'${jsEscape(t.domain)}',r:${t.relevance}}`
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

  const customData = await Bun.file("data/custom-bangs.json").json();
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

const metaJs = generateMeta(valid);
await Bun.write(`${outDir}/bangs-meta.js`, metaJs);
console.log(`  bangs-meta.js: ${metaJs.length} bytes`);

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
    "export declare const BANGS: Record<string, [string, string | null]>;\n"
  ),
  Bun.write(
    `${outDir}/bangs-meta.d.ts`,
    "export declare const BANGS: Record<string, { s: string; d: string }>;\n"
  ),
  Bun.write(
    `${outDir}/bangs-trie.d.ts`,
    [
      "export interface TrieNode {",
      "  c: [string, TrieNode][];",
      "  m: number;",
      "  t: { k: string; s: string; d: string; r: number } | null;",
      "}",
      "export declare const TRIE: TrieNode;",
      "",
    ].join("\n")
  ),
]);

console.log(`Generated ${valid.length} bangs in ${outDir}/`);
