import { TRIE, type TrieNode } from "./generated/bangs-trie.js";
import {
  CH_EXCL,
  FRECENCY_BOOST_CAP,
  FRECENCY_BOOST_MULTIPLIER,
  SUGGEST_URLS,
  TOP_K,
} from "./shared/constants";
import { readQueryParam } from "./shared/raw-query";

export interface SuggestSettings {
  customUrl: string | null;
  provider: string;
  trigger: string;
  frecent: Record<string, number>;
  custom: string[];
}

const JSON_HEADERS = { "Content-Type": "application/json" };
const COOKIE_RE = /(?:^|;\s*)suggest=([^;]*)/;
const SF_RE = /(?:^|;\s*)sf=([^;]*)/;

function empty(query: string): Response {
  return new Response(JSON.stringify([query, []]), { headers: JSON_HEADERS });
}

function parsePartialBang(
  q: string
): { prefix: string; partial: string } | null {
  const s = q.trim();
  if (s.charCodeAt(0) === CH_EXCL) {
    return s.indexOf(" ") === -1
      ? { prefix: "", partial: s.substring(1).toLowerCase() }
      : null;
  }
  const trailing = s.lastIndexOf(" !");
  if (trailing === -1) {
    return null;
  }
  const rest = s.substring(trailing + 2);
  return rest.indexOf(" ") === -1
    ? { prefix: s.substring(0, trailing + 1), partial: rest.toLowerCase() }
    : null;
}

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

interface Candidate {
  trigger: string;
  name: string;
  domain: string;
  url: string;
  score: number;
}

function effectiveScore(
  relevance: number,
  frecent: Record<string, number>,
  trigger: string
): number {
  const count = frecent[trigger];
  if (!count) {
    return relevance;
  }
  return (
    relevance + Math.min(count * FRECENCY_BOOST_MULTIPLIER, FRECENCY_BOOST_CAP)
  );
}

// DFS with max-relevance pruning. Children are pre-sorted by m descending.
function topK(
  subtree: TrieNode,
  frecent: Record<string, number>,
  customMatches: Candidate[]
): Candidate[] {
  const results: Candidate[] = [];
  let minIdx = -1;
  let threshold = -1;

  function findMin(): void {
    minIdx = 0;
    for (let i = 1; i < TOP_K; i++) {
      if (results[i].score < results[minIdx].score) {
        minIdx = i;
      }
    }
    threshold = results[minIdx].score;
  }

  function addCandidate(c: Candidate): void {
    if (results.length < TOP_K) {
      results.push(c);
      if (results.length === TOP_K) {
        findMin();
      }
    } else if (c.score > threshold) {
      results[minIdx] = c;
      findMin();
    }
  }

  for (const c of customMatches) {
    addCandidate(c);
  }

  function dfs(node: TrieNode) {
    if (node.t) {
      const score = effectiveScore(node.t.r, frecent, node.t.k);
      if (results.length < TOP_K || score > threshold) {
        addCandidate({
          trigger: node.t.k,
          name: node.t.s,
          domain: node.t.d,
          url: node.t.u,
          score,
        });
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
  return results;
}

function bangSuggestions(
  query: string,
  prefix: string,
  partial: string,
  frecent: Record<string, number>,
  custom: string[]
): Response {
  const result = walkPrefix(partial);

  const customMatches: Candidate[] = [];
  for (const trigger of custom) {
    if (trigger.startsWith(partial)) {
      customMatches.push({
        trigger,
        name: "",
        domain: "",
        url: "",
        score: effectiveScore(0, frecent, trigger),
      });
    }
  }

  if (!result) {
    if (customMatches.length === 0) {
      return new Response(JSON.stringify([query, []]), {
        headers: JSON_HEADERS,
      });
    }
    customMatches.sort((a, b) => b.score - a.score);
    const top = customMatches.slice(0, TOP_K);
    return new Response(
      JSON.stringify([
        query,
        top.map((c) => `${prefix}!${c.trigger}`),
        top.map(() => ""),
        top.map(() => ""),
      ]),
      { headers: JSON_HEADERS }
    );
  }

  const [subtree] = result;
  const candidates = topK(subtree, frecent, customMatches);

  const completions: string[] = [];
  const descriptions: string[] = [];
  const urls: string[] = [];

  for (const c of candidates) {
    completions.push(`${prefix}!${c.trigger}`);
    if (c.url) {
      descriptions.push(`${c.name} — ${c.domain}`);
      const protoEnd = c.url.indexOf("://");
      if (protoEnd === -1) {
        urls.push(c.url);
      } else {
        const pathStart = c.url.indexOf("/", protoEnd + 3);
        urls.push(pathStart === -1 ? c.url : c.url.substring(0, pathStart));
      }
    } else {
      descriptions.push("");
      urls.push("");
    }
  }

  return new Response(
    JSON.stringify([query, completions, descriptions, urls]),
    { headers: JSON_HEADERS }
  );
}

const TRIGGER_ALIAS: Record<string, string> = {
  g: "google",
  google: "google",
  ddg: "ddg",
  duckduckgo: "ddg",
  b: "bing",
  bing: "bing",
  brave: "brave",
  y: "yahoo",
  yahoo: "yahoo",
  ec: "ecosia",
  ecosia: "ecosia",
  kagi: "kagi",
  ya: "yandex",
  yandex: "yandex",
  bd: "baidu",
  baidu: "baidu",
};

function resolveEndpoint(provider: string, trigger: string): string | null {
  return (
    SUGGEST_URLS[provider] ??
    (provider === "none"
      ? null
      : (SUGGEST_URLS[TRIGGER_ALIAS[trigger]] ?? null))
  );
}

function parseFrecency(raw: string): Record<string, number> {
  const frecent: Record<string, number> = {};
  for (const pair of raw.split(".")) {
    const sep = pair.lastIndexOf(":");
    if (sep > 0) {
      const count = parseInt(pair.substring(sep + 1), 10);
      if (count > 0) {
        frecent[pair.substring(0, sep)] = count;
      }
    }
  }
  return frecent;
}

function safeDecodeURIComponent(value: string): string | null {
  try {
    return decodeURIComponent(value);
  } catch {
    return null;
  }
}

export function parseCookie(request: Request): SuggestSettings {
  const header = request.headers.get("Cookie") || "";
  const match = header.match(COOKIE_RE);
  if (!match) {
    return {
      provider: "default",
      trigger: "g",
      customUrl: null,
      frecent: {},
      custom: [],
    };
  }

  const sections = match[1].split("|");
  const [provider, trigger, customUrl] = (sections[0] || "").split(",");

  // Prefer sf cookie (set by SW on every redirect) over suggest= frecent section
  const sfMatch = header.match(SF_RE);
  let frecent: Record<string, number> = {};
  if (sfMatch?.[1]) {
    frecent = parseFrecency(sfMatch[1]);
  } else if (sections[1]) {
    frecent = parseFrecency(sections[1]);
  }

  // Parse custom section: "test8.mysite.proj"
  const custom = sections[2]
    ? sections[2].split(".").filter((s) => s.length > 0)
    : [];

  return {
    provider: provider || "default",
    trigger: trigger || "g",
    customUrl: customUrl ? safeDecodeURIComponent(customUrl) : null,
    frecent,
    custom,
  };
}

export function parseSettings(url: URL, request: Request): SuggestSettings {
  return parseSettingsFromRawUrl(url.href, request);
}

export function parseSettingsFromRawUrl(
  rawUrl: string,
  request: Request
): SuggestSettings {
  const settings = parseCookie(request);
  const sp = readQueryParam(rawUrl, "sp");
  if (sp) {
    settings.provider = sp;
  }

  return settings;
}

export async function suggest(
  query: string,
  settings: SuggestSettings
): Promise<Response> {
  const bang = parsePartialBang(query);
  if (bang) {
    return bangSuggestions(
      query,
      bang.prefix,
      bang.partial,
      settings.frecent,
      settings.custom
    );
  }

  const { provider, trigger, customUrl } = settings;
  const endpoint =
    provider === "custom" ? customUrl : resolveEndpoint(provider, trigger);

  if (!endpoint) {
    return empty(query);
  }

  try {
    const res = await fetch(endpoint.replace("{}", encodeURIComponent(query)));
    return new Response(res.body, { headers: JSON_HEADERS });
  } catch {
    return empty(query);
  }
}
