import { Buffer } from "node:buffer";
import { mkdir } from "node:fs/promises";
import { $ } from "bun";

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

export const GENERATED_BANG_DATA_FILES = [
  "src/generated/bangs-min.js",
  "src/generated/bangs-meta.js",
  "src/generated/bangs-trie.js",
] as const;

export async function ensureGeneratedBangData(
  fromMerged = true
): Promise<void> {
  const missing: string[] = [];
  for (const file of GENERATED_BANG_DATA_FILES) {
    if (!(await Bun.file(file).exists())) {
      missing.push(file);
    }
  }

  if (missing.length === 0) {
    return;
  }

  const mode = fromMerged ? " --from-merged" : "";
  console.warn(
    `Generated bang data missing (${missing.join(", ")}). Running codegen${mode}...`
  );

  if (fromMerged) {
    await $`bun run codegen --from-merged`;
  } else {
    await $`bun run codegen`;
  }

  for (const file of GENERATED_BANG_DATA_FILES) {
    if (!(await Bun.file(file).exists())) {
      throw new Error(
        `Missing generated bang data after codegen: ${GENERATED_BANG_DATA_FILES.join(", ")}`
      );
    }
  }
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

interface PackedBlob {
  blob: string;
  lengths: number[];
}

function packBlob(values: readonly string[]): PackedBlob {
  let blob = "";
  const lengths = new Array<number>(values.length);
  for (let i = 0; i < values.length; i++) {
    const v = values[i];
    blob += v;
    lengths[i] = v.length;
  }
  return { blob, lengths };
}

function dedupeStrings(values: readonly string[]): {
  ids: number[];
  unique: string[];
} {
  const unique: string[] = [];
  const ids = new Array<number>(values.length);
  const map = new Map<string, number>();

  for (let i = 0; i < values.length; i++) {
    const value = values[i];
    const existing = map.get(value);
    if (existing !== undefined) {
      ids[i] = existing;
      continue;
    }
    const id = unique.length;
    unique.push(value);
    map.set(value, id);
    ids[i] = id;
  }

  return { ids, unique };
}

function hashFNV1a(s: string): number {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function toBase64U8(values: readonly number[]): string {
  return Buffer.from(Uint8Array.from(values)).toString("base64");
}

function toBase64U16(values: readonly number[]): string {
  const arr = Uint16Array.from(values);
  return Buffer.from(arr.buffer, arr.byteOffset, arr.byteLength).toString(
    "base64"
  );
}

function nextPow2(n: number): number {
  let p = 1;
  while (p < n) {
    p <<= 1;
  }
  return p;
}

function generateMin(bangs: Bang[]): string {
  const entryCount = bangs.length;
  if (entryCount > 0xffff) {
    throw new Error(
      `bangs-min packed format requires <= 65535 entries, got ${entryCount}`
    );
  }

  const triggers = new Array<string>(entryCount);
  const prefixes = new Array<string>(entryCount);
  const rawSuffixes = new Array<string | null>(entryCount);

  for (let i = 0; i < entryCount; i++) {
    const bang = bangs[i];
    const [prefix, suffix] = splitTemplate(bang.url);
    triggers[i] = bang.trigger;
    prefixes[i] = prefix;
    rawSuffixes[i] = suffix;
  }

  const { ids: prefixIds, unique: uniquePrefixes } = dedupeStrings(prefixes);
  if (uniquePrefixes.length > 0xffff) {
    throw new Error(
      `bangs-min packed format requires <= 65535 unique prefixes, got ${uniquePrefixes.length}`
    );
  }

  const uniqueSuffixes: string[] = [];
  const suffixIdsPlusOne = new Array<number>(entryCount);
  const suffixMap = new Map<string, number>();
  for (let i = 0; i < entryCount; i++) {
    const suffix = rawSuffixes[i];
    if (suffix === null) {
      suffixIdsPlusOne[i] = 0;
      continue;
    }
    const existing = suffixMap.get(suffix);
    if (existing !== undefined) {
      suffixIdsPlusOne[i] = existing + 1;
      continue;
    }
    const id = uniqueSuffixes.length;
    if (id >= 0xffff) {
      throw new Error(
        `bangs-min packed format requires <= 65535 unique suffixes, got ${id + 1}`
      );
    }
    uniqueSuffixes.push(suffix);
    suffixMap.set(suffix, id);
    suffixIdsPlusOne[i] = id + 1;
  }

  const triggerBlob = packBlob(triggers);
  const prefixBlob = packBlob(uniquePrefixes);
  const suffixBlob = packBlob(uniqueSuffixes);

  const triggerMaxLen = triggerBlob.lengths.reduce(
    (max, len) => (len > max ? len : max),
    0
  );
  const triggerLensKind = triggerMaxLen <= 0xff ? "u8" : "u16";
  for (const len of prefixBlob.lengths) {
    if (len > 0xffff) {
      throw new Error(
        `bangs-min packed format requires prefix length <= 65535, got ${len}`
      );
    }
  }
  for (const len of suffixBlob.lengths) {
    if (len > 0xffff) {
      throw new Error(
        `bangs-min packed format requires suffix length <= 65535, got ${len}`
      );
    }
  }

  const HASH_TARGET_LOAD = 0.55;
  const hashSize = nextPow2(
    Math.max(2, Math.ceil(entryCount / HASH_TARGET_LOAD))
  );
  if (hashSize > 0xffff) {
    throw new Error(
      `bangs-min packed format requires hash table size <= 65535, got ${hashSize}`
    );
  }

  const hashTable = new Uint16Array(hashSize);
  const hashMask = hashSize - 1;
  for (let idx = 0; idx < entryCount; idx++) {
    let slot = hashFNV1a(triggers[idx]) & hashMask;
    while (hashTable[slot] !== 0) {
      slot = (slot + 1) & hashMask;
    }
    hashTable[slot] = idx + 1;
  }

  const triggerLensB64 =
    triggerLensKind === "u8"
      ? toBase64U8(triggerBlob.lengths)
      : toBase64U16(triggerBlob.lengths);
  const prefixLensB64 = toBase64U16(prefixBlob.lengths);
  const suffixLensB64 = toBase64U16(suffixBlob.lengths);
  const prefixIdsB64 = toBase64U16(prefixIds);
  const suffixIdsB64 = toBase64U16(suffixIdsPlusOne);
  const hashTableB64 = Buffer.from(hashTable.buffer).toString("base64");

  const runtimeHelpers =
    "function _b64bytes(s){if(typeof atob==='function'){const b=atob(s);const n=b.length;const o=new Uint8Array(n);for(let i=0;i<n;i++){o[i]=b.charCodeAt(i)}return o}if(typeof Buffer!=='undefined'){const b=Buffer.from(s,'base64');return new Uint8Array(b.buffer,b.byteOffset,b.byteLength)}throw new Error('No base64 decoder available')}" +
    "function _b64u8(s){return _b64bytes(s)}" +
    "function _b64u16(s){const b=_b64bytes(s);if((b.byteOffset&1)===0){return new Uint16Array(b.buffer,b.byteOffset,b.byteLength>>>1)}const c=new Uint8Array(b.byteLength);c.set(b);return new Uint16Array(c.buffer)}" +
    "function _off(lengths){const n=lengths.length;const o=new Uint32Array(n+1);let p=0;for(let i=0;i<n;i++){o[i]=p;p+=lengths[i]}o[n]=p;return o}" +
    "function _hash(s){let h=2166136261>>>0;for(let i=0;i<s.length;i++){h^=s.charCodeAt(i);h=Math.imul(h,16777619)}return h>>>0}";

  return (
    runtimeHelpers +
    `const _TB='${jsEscape(triggerBlob.blob)}';` +
    `const _TL=${triggerLensKind === "u8" ? `_b64u8('${triggerLensB64}')` : `_b64u16('${triggerLensB64}')`};` +
    "const _TO=_off(_TL);" +
    `const _PB='${jsEscape(prefixBlob.blob)}';` +
    `const _PL=_b64u16('${prefixLensB64}');` +
    "const _PO=_off(_PL);" +
    `const _SB='${jsEscape(suffixBlob.blob)}';` +
    `const _SL=_b64u16('${suffixLensB64}');` +
    "const _SO=_off(_SL);" +
    `const _EP=_b64u16('${prefixIdsB64}');` +
    `const _ES=_b64u16('${suffixIdsB64}');` +
    `const _HT=_b64u16('${hashTableB64}');` +
    `const _HM=${hashMask};` +
    `const _PC=new Array(${uniquePrefixes.length});` +
    `const _PR=new Uint8Array(${uniquePrefixes.length});` +
    `const _SC=new Array(${uniqueSuffixes.length});` +
    `const _SR=new Uint8Array(${uniqueSuffixes.length});` +
    `const _TC=new Array(${entryCount});` +
    "function _eq(i,s){const a=_TO[i];const b=_TO[i+1];const n=b-a;if(s.length!==n){return false}for(let j=0;j<n;j++){if(_TB.charCodeAt(a+j)!==s.charCodeAt(j)){return false}}return true}" +
    "function _prefix(id){if(_PR[id]){return _PC[id]}const s=_PB.substring(_PO[id],_PO[id+1]);_PC[id]=s;_PR[id]=1;return s}" +
    "function _suffix(id){if(_SR[id]){return _SC[id]}const s=_SB.substring(_SO[id],_SO[id+1]);_SC[id]=s;_SR[id]=1;return s}" +
    `export const BANG_COUNT=${entryCount};` +
    "export function lookupBang(trigger){let slot=_hash(trigger)&_HM;for(let i=0;i<_HT.length;i++){const ep=_HT[slot];if(ep===0){return null}const idx=ep-1;if(_eq(idx,trigger)){let t=_TC[idx];if(t!==undefined){return t}const pid=_EP[idx];const sid=_ES[idx];t=sid===0?[_prefix(pid),null]:[_prefix(pid),_suffix(sid-1)];_TC[idx]=t;return t}slot=(slot+1)&_HM}return null}"
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

const NODE_EDGE_START = 0;
const NODE_EDGE_COUNT = 1;
const NODE_TERMINAL_INDEX = 2;
const NODE_MAX_RELEVANCE = 3;
const NODE_STRIDE = 4;

const EDGE_CHILD_INDEX = 2;
const EDGE_STRIDE = 3;

interface FlatTrieData {
  edges: number[];
  labels: string;
  nodes: number[];
  termD: string[];
  termK: string[];
  termR: number[];
  termS: string[];
}

interface PackedStringData {
  blob: string;
  offsets: number[];
}

interface PackedI32Data {
  base64: string;
  offsets: number[];
}

const TRIE_RUNTIME_HELPERS_SOURCE = `
function _b64bytes(s: string): Uint8Array {
  if (typeof atob === "function") {
    const bin = atob(s);
    const len = bin.length;
    const out = new Uint8Array(len);
    for (let i = 0; i < len; i++) {
      out[i] = bin.charCodeAt(i);
    }
    return out;
  }
  if (typeof Buffer !== "undefined") {
    const b = Buffer.from(s, "base64");
    return new Uint8Array(b.buffer, b.byteOffset, b.byteLength);
  }
  throw new Error("No base64 decoder available");
}

function _b64i32(s: string): Int32Array {
  const b = _b64bytes(s);
  if ((b.byteOffset & 3) === 0) {
    return new Int32Array(b.buffer, b.byteOffset, b.byteLength >>> 2);
  }
  const a = new Uint8Array(b.byteLength);
  a.set(b);
  return new Int32Array(a.buffer);
}
`;

function flattenTrie(root: TrieNode): FlatTrieData {
  const nodes: number[] = [];
  const edges: number[] = [];
  let labels = "";
  const termK: string[] = [];
  const termS: string[] = [];
  const termD: string[] = [];
  const termR: number[] = [];

  function allocNode(): number {
    const idx = nodes.length / NODE_STRIDE;
    nodes.push(0, 0, -1, 0);
    return idx;
  }

  function visit(node: TrieNode): number {
    const idx = allocNode();
    const sortedChildren = [...node.children.entries()].sort(
      (a, b) => b[1].maxRelevance - a[1].maxRelevance
    );
    const edgeStart = edges.length / EDGE_STRIDE;
    const edgeCount = sortedChildren.length;

    // Reserve this node's edge block contiguously.
    for (const [label] of sortedChildren) {
      const labelStart = labels.length;
      labels += label;
      edges.push(labelStart, label.length, -1);
    }

    for (let i = 0; i < sortedChildren.length; i++) {
      const [, child] = sortedChildren[i];
      const childIdx = visit(child);
      edges[(edgeStart + i) * EDGE_STRIDE + EDGE_CHILD_INDEX] = childIdx;
    }

    let terminalIndex = -1;
    if (node.terminal) {
      const t = node.terminal;
      terminalIndex = termR.length;
      termK.push(t.trigger);
      termS.push(t.name);
      termD.push(t.domain);
      termR.push(t.relevance);
    }

    const nodeOff = idx * NODE_STRIDE;
    nodes[nodeOff + NODE_EDGE_START] = edgeStart;
    nodes[nodeOff + NODE_EDGE_COUNT] = edgeCount;
    nodes[nodeOff + NODE_TERMINAL_INDEX] = terminalIndex;
    nodes[nodeOff + NODE_MAX_RELEVANCE] = node.maxRelevance;

    return idx;
  }

  const rootIdx = visit(root);
  if (rootIdx !== 0) {
    throw new Error(`Unexpected root index ${rootIdx} (expected 0)`);
  }

  return { labels, nodes, edges, termK, termS, termD, termR };
}

function packStrings(items: string[]): PackedStringData {
  const offsets = new Array<number>(items.length + 1);
  offsets[0] = 0;
  let cursor = 0;
  for (let i = 0; i < items.length; i++) {
    cursor += items[i].length;
    offsets[i + 1] = cursor;
  }
  return { blob: items.join(""), offsets };
}

function packI32Sections(sections: number[][]): PackedI32Data {
  const offsets = new Array<number>(sections.length + 1);
  offsets[0] = 0;
  for (let i = 0; i < sections.length; i++) {
    offsets[i + 1] = offsets[i] + sections[i].length;
  }

  const merged = new Int32Array(offsets[offsets.length - 1]);
  for (let i = 0; i < sections.length; i++) {
    merged.set(sections[i], offsets[i]);
  }

  return {
    base64: Buffer.from(new Uint8Array(merged.buffer)).toString("base64"),
    offsets,
  };
}

function buildMinifiedTrieRuntimeHelpers(): string {
  // Keep this path in-memory for Docker/CI and Bun 1.2.x compatibility.
  const transpiler = new Bun.Transpiler({
    loader: "ts",
    target: "browser",
    minifyWhitespace: true,
  });
  const minified = transpiler.transformSync(TRIE_RUNTIME_HELPERS_SOURCE).trim();
  if (!minified.includes("function _b64i32(")) {
    throw new Error("Failed to build trie runtime helpers");
  }
  return minified;
}

function generateTrie(data: FlatTrieData, trieRuntimeHelpers: string): string {
  const termK = packStrings(data.termK);
  const termS = packStrings(data.termS);
  const termD = packStrings(data.termD);
  const i32 = packI32Sections([
    data.nodes,
    data.edges,
    data.termR,
    termK.offsets,
    termS.offsets,
    termD.offsets,
  ]);
  const [nodesStart, nodesEnd, edgesEnd, termREnd, termKOffEnd, termSOffEnd] =
    i32.offsets;

  return (
    // NOTE: base64-decoded typed arrays avoid tokenizing huge numeric literals.
    // All numeric arrays share one backing buffer to minimize decode overhead.
    trieRuntimeHelpers +
    `export const LABELS='${jsEscape(data.labels)}';` +
    `const _I32=_b64i32('${i32.base64}');` +
    `export const NODES=_I32.subarray(${nodesStart},${nodesEnd});` +
    `export const EDGES=_I32.subarray(${nodesEnd},${edgesEnd});` +
    `export const TERM_R=_I32.subarray(${edgesEnd},${termREnd});` +
    `export const TERM_K_BLOB='${jsEscape(termK.blob)}';` +
    `export const TERM_K_OFF=_I32.subarray(${termREnd},${termKOffEnd});` +
    `export const TERM_S_BLOB='${jsEscape(termS.blob)}';` +
    `export const TERM_S_OFF=_I32.subarray(${termKOffEnd},${termSOffEnd});` +
    `export const TERM_D_BLOB='${jsEscape(termD.blob)}';` +
    `export const TERM_D_OFF=_I32.subarray(${termSOffEnd},${i32.offsets[6]});` +
    "export const ROOT=0;"
  );
}

const MERGED_PATH = "data/bangs.json";
interface CodegenOptions {
  fromMerged?: boolean;
  noFetch?: boolean;
}

export async function runCodegen(options: CodegenOptions = {}): Promise<void> {
  const { fromMerged = false, noFetch = false } = options;

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
  const trieData = flattenTrie(trieRoot);
  const trieRuntimeHelpers = buildMinifiedTrieRuntimeHelpers();
  const trieJs = generateTrie(trieData, trieRuntimeHelpers);
  await Bun.write(`${outDir}/bangs-trie.js`, trieJs);
  console.log(`  bangs-trie.js: ${trieJs.length} bytes`);

  await Promise.all([
    Bun.write(
      `${outDir}/bangs-min.d.ts`,
      [
        "export declare const BANG_COUNT: number;",
        "export declare function lookupBang(trigger: string): readonly [string, string | null] | null;",
        "",
      ].join("\n")
    ),
    Bun.write(
      `${outDir}/bangs-meta.d.ts`,
      "export declare const BANGS: Record<string, { s: string; d: string }>;\n"
    ),
    Bun.write(
      `${outDir}/bangs-trie.d.ts`,
      [
        "export declare const LABELS: string;",
        "export declare const NODES: Int32Array;",
        "export declare const EDGES: Int32Array;",
        "export declare const TERM_R: Int32Array;",
        "export declare const TERM_K_BLOB: string;",
        "export declare const TERM_K_OFF: Int32Array;",
        "export declare const TERM_S_BLOB: string;",
        "export declare const TERM_S_OFF: Int32Array;",
        "export declare const TERM_D_BLOB: string;",
        "export declare const TERM_D_OFF: Int32Array;",
        "export declare const ROOT: number;",
        "",
      ].join("\n")
    ),
  ]);

  console.log(`Generated ${valid.length} bangs in ${outDir}/`);
}

async function main(): Promise<void> {
  const noFetch = process.argv.includes("--no-fetch");
  const fromMerged = process.argv.includes("--from-merged");
  await runCodegen({ fromMerged, noFetch });
}

if (import.meta.main) {
  await main();
}
