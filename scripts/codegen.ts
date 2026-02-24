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

function generateMin(bangs: Bang[]): string {
  let js = "export const BANGS={__proto__:null,";
  for (let i = 0; i < bangs.length; i++) {
    if (i > 0) {
      js += ",";
    }
    js += `'${jsEscape(bangs[i].trigger)}':'${jsEscape(bangs[i].url)}'`;
  }
  js += "};";
  return js;
}

function generateFull(bangs: Bang[]): string {
  let js = "export const BANGS={__proto__:null,";
  for (let i = 0; i < bangs.length; i++) {
    if (i > 0) {
      js += ",";
    }
    const b = bangs[i];
    js += `'${jsEscape(b.trigger)}':{s:'${jsEscape(b.name)}',d:'${jsEscape(b.domain)}',u:'${jsEscape(b.url)}',r:${b.relevance}}`;
  }
  js += "};";
  return js;
}

function generateKeys(bangs: Bang[]): string {
  let js = "export const BANG_KEYS=[";
  for (let i = 0; i < bangs.length; i++) {
    if (i > 0) {
      js += ",";
    }
    js += `'${jsEscape(bangs[i].trigger)}'`;
  }
  js += "];";
  return js;
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
    await $`mkdir -p data`;
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
await $`mkdir -p ${outDir}`;

const minJs = generateMin(valid);
await Bun.write(`${outDir}/bangs-min.js`, minJs);
console.log(`  bangs-min.js: ${minJs.length} bytes`);

const fullJs = generateFull(valid);
await Bun.write(`${outDir}/bangs-full.js`, fullJs);
console.log(`  bangs-full.js: ${fullJs.length} bytes`);

const keysJs = generateKeys(valid);
await Bun.write(`${outDir}/bangs-keys.js`, keysJs);
console.log(`  bangs-keys.js: ${keysJs.length} bytes`);

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
    `${outDir}/bangs-keys.d.ts`,
    "export declare const BANG_KEYS: string[];\n"
  ),
]);

console.log(`Generated ${valid.length} bangs in ${outDir}/`);
