import {
  CH_CR,
  CH_EXCL,
  CH_FF,
  CH_NL,
  CH_SPACE,
  CH_TAB,
  CH_VTAB,
} from "./shared/chars";
import { SUGGEST_URLS } from "./shared/constants";
import { readQueryParam } from "./shared/raw-query";
import { resolveTemplateParts } from "./shared/template";
import { bangSuggestions } from "./suggest-bang";

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

function isTrimWs(code: number): boolean {
  return (
    code === CH_SPACE ||
    code === CH_TAB ||
    code === CH_NL ||
    code === CH_VTAB ||
    code === CH_FF ||
    code === CH_CR
  );
}

function fillTemplate(url: string, encodedQuery: string): string {
  const parts = resolveTemplateParts(url);
  if (!parts) {
    return url;
  }
  return parts[0] + encodedQuery + parts[1];
}

function empty(query: string): Response {
  return new Response(JSON.stringify([query, []]), { headers: JSON_HEADERS });
}

function parsePartialBang(
  q: string
): { prefix: string; partial: string } | null {
  let start = 0;
  let end = q.length;

  while (start < end && isTrimWs(q.charCodeAt(start))) {
    start++;
  }
  while (end > start && isTrimWs(q.charCodeAt(end - 1))) {
    end--;
  }
  if (start === end) {
    return null;
  }

  if (q.charCodeAt(start) === CH_EXCL) {
    for (let i = start; i < end; i++) {
      if (q.charCodeAt(i) === CH_SPACE) {
        return null;
      }
    }
    return { prefix: "", partial: q.substring(start + 1, end).toLowerCase() };
  }

  for (let i = end - 2; i >= start; i--) {
    if (q.charCodeAt(i) !== CH_SPACE || q.charCodeAt(i + 1) !== CH_EXCL) {
      continue;
    }
    const bangStart = i + 2;
    for (let j = bangStart; j < end; j++) {
      if (q.charCodeAt(j) === CH_SPACE) {
        return null;
      }
    }
    return {
      prefix: q.substring(start, i + 1),
      partial: q.substring(bangStart, end).toLowerCase(),
    };
  }

  return null;
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
    const res = await fetch(fillTemplate(endpoint, encodeURIComponent(query)));
    return new Response(res.body, { headers: JSON_HEADERS });
  } catch {
    return empty(query);
  }
}
