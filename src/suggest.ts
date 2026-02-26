import { TRIE, type TrieNode } from "./generated/bangs-trie.js";

export interface SuggestSettings {
  customUrl: string | null;
  provider: string;
  trigger: string;
  frecent: Record<string, number>;
  custom: string[];
}

const SUGGEST_URLS: Record<string, string> = {
  google:
    "https://suggestqueries.google.com/complete/search?client=firefox&q={}",
  ddg: "https://duckduckgo.com/ac/?q={}&type=list",
  bing: "https://www.bing.com/osjson.aspx?query={}",
  brave: "https://search.brave.com/api/suggest?q={}&rich=false",
  yahoo: "https://ff.search.yahoo.com/gossip?output=fxjson&command={}",
  ecosia: "https://ac.ecosia.org/autocomplete?q={}&type=list",
  kagi: "https://kagi.com/api/autosuggest?q={}",
  yandex: "https://suggest.yandex.com/suggest-ff.cgi?part={}",
  baidu: "https://suggestion.baidu.com/su?wd={}&action=opensearch",
};

const JSON_HEADERS = { "Content-Type": "application/json" };
const COOKIE_RE = /(?:^|;\s*)suggest=([^;]*)/;
const SF_RE = /(?:^|;\s*)sf=([^;]*)/;
const TOP_K = 8;

function empty(query: string): Response {
  return new Response(JSON.stringify([query, []]), { headers: JSON_HEADERS });
}

function parsePartialBang(
  q: string
): { prefix: string; partial: string } | null {
  const s = q.trim();
  if (s.charCodeAt(0) === 33) {
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
  return relevance + Math.min(count * 10, 2000);
}

// DFS with max-relevance pruning. Children are pre-sorted by m descending.
function topK(
  subtree: TrieNode,
  _edgeRemainder: string,
  frecent: Record<string, number>,
  customMatches: Candidate[]
): Candidate[] {
  const results: Candidate[] = [];
  let threshold = -1;

  for (const c of customMatches) {
    results.push(c);
    if (results.length === TOP_K) {
      results.sort((a, b) => b.score - a.score);
      threshold = results[TOP_K - 1].score;
    }
  }

  function dfs(node: TrieNode) {
    if (node.t) {
      const score = effectiveScore(node.t.r, frecent, node.t.k);
      if (results.length < TOP_K) {
        results.push({
          trigger: node.t.k,
          name: node.t.s,
          domain: node.t.d,
          url: node.t.u,
          score,
        });
        if (results.length === TOP_K) {
          results.sort((a, b) => b.score - a.score);
          threshold = results[TOP_K - 1].score;
        }
      } else if (score > threshold) {
        // Replace the lowest scoring result
        results.sort((a, b) => b.score - a.score);
        results[TOP_K - 1] = {
          trigger: node.t.k,
          name: node.t.s,
          domain: node.t.d,
          url: node.t.u,
          score,
        };
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
  return results.slice(0, TOP_K);
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

  const [subtree, edgeRemainder] = result;
  const candidates = topK(subtree, edgeRemainder, frecent, customMatches);

  const completions: string[] = [];
  const descriptions: string[] = [];
  const urls: string[] = [];

  for (const c of candidates) {
    completions.push(`${prefix}!${c.trigger}`);
    if (c.url) {
      descriptions.push(`${c.name} — ${c.domain}`);
      urls.push(new URL(c.url).origin);
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

function resolveEndpoint(provider: string, trigger: string): string | null {
  const url = SUGGEST_URLS[provider];
  if (url) {
    return url;
  }
  if (provider === "none") {
    return null;
  }
  if (trigger === "g" || trigger === "google") {
    return SUGGEST_URLS.google;
  }
  if (trigger === "ddg" || trigger === "duckduckgo") {
    return SUGGEST_URLS.ddg;
  }
  if (trigger === "b" || trigger === "bing") {
    return SUGGEST_URLS.bing;
  }
  if (trigger === "brave") {
    return SUGGEST_URLS.brave;
  }
  if (trigger === "y" || trigger === "yahoo") {
    return SUGGEST_URLS.yahoo;
  }
  if (trigger === "ec" || trigger === "ecosia") {
    return SUGGEST_URLS.ecosia;
  }
  if (trigger === "kagi") {
    return SUGGEST_URLS.kagi;
  }
  if (trigger === "ya" || trigger === "yandex") {
    return SUGGEST_URLS.yandex;
  }
  if (trigger === "bd" || trigger === "baidu") {
    return SUGGEST_URLS.baidu;
  }
  return null;
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
    customUrl: customUrl ? decodeURIComponent(customUrl) : null,
    frecent,
    custom,
  };
}

export function parseSettings(url: URL, request: Request): SuggestSettings {
  const settings = parseCookie(request);

  const sp = url.searchParams.get("sp");
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
