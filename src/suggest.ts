import { CH_EXCL, SUGGEST_URLS } from "./shared/constants";
import { readQueryParam } from "./shared/raw-query";
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
