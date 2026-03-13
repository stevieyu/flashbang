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

export interface SuggestCoreSettings {
  customUrl: string | null;
  provider: string;
  trigger: string;
}

export interface SuggestBangContext {
  frecent: Record<string, number>;
  custom: string[];
}

export interface SuggestSettings
  extends SuggestCoreSettings,
    SuggestBangContext {}

export interface PartialBang {
  partial: string;
  prefix: string;
}

const JSON_HEADERS = { "Content-Type": "application/json" };

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

export function parsePartialBang(q: string): PartialBang | null {
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
  let i = 0;

  while (i <= raw.length) {
    let dot = raw.indexOf(".", i);
    if (dot === -1) {
      dot = raw.length;
    }
    const sep = raw.lastIndexOf(":", dot - 1);
    if (sep > i) {
      const count = parseInt(raw.substring(sep + 1, dot), 10);
      if (count > 0) {
        frecent[raw.substring(i, sep)] = count;
      }
    }

    if (dot === raw.length) {
      break;
    }
    i = dot + 1;
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
  return parseCookieInternal(header, true);
}

function parseCookieInternal(
  header: string,
  includeBangContext: boolean
): SuggestSettings {
  const suggestRaw = readCookieValue(header, "suggest");
  if (suggestRaw === null) {
    return defaultSettings();
  }

  let firstSectionEnd = suggestRaw.indexOf("|");
  if (firstSectionEnd === -1) {
    firstSectionEnd = suggestRaw.length;
  }
  let customSection = "";
  if (includeBangContext && firstSectionEnd !== suggestRaw.length) {
    const secondPipe = suggestRaw.indexOf("|", firstSectionEnd + 1);
    customSection =
      secondPipe === -1 ? "" : suggestRaw.substring(secondPipe + 1);
  }

  const firstSection = suggestRaw.substring(0, firstSectionEnd);
  let provider = "";
  let trigger = "";
  let customUrl = "";

  const comma1 = firstSection.indexOf(",");
  if (comma1 === -1) {
    provider = firstSection;
  } else {
    provider = firstSection.substring(0, comma1);
    const comma2 = firstSection.indexOf(",", comma1 + 1);
    if (comma2 === -1) {
      trigger = firstSection.substring(comma1 + 1);
    } else {
      trigger = firstSection.substring(comma1 + 1, comma2);
      const comma3 = firstSection.indexOf(",", comma2 + 1);
      customUrl =
        comma3 === -1
          ? firstSection.substring(comma2 + 1)
          : firstSection.substring(comma2 + 1, comma3);
    }
  }

  const sfRaw = includeBangContext ? readCookieValue(header, "sf") : null;
  const frecent: Record<string, number> =
    includeBangContext && sfRaw ? parseFrecency(sfRaw) : {};
  const custom = includeBangContext ? parseCustomTriggers(customSection) : [];

  return {
    provider: provider || "default",
    trigger: trigger || "g",
    customUrl: customUrl ? safeDecodeURIComponent(customUrl) : null,
    frecent,
    custom,
  };
}

function defaultSettings(): SuggestSettings {
  return {
    provider: "default",
    trigger: "g",
    customUrl: null,
    frecent: {},
    custom: [],
  };
}

function readCookieValue(header: string, name: string): string | null {
  const nameLen = name.length;
  const len = header.length;
  let i = 0;

  while (i < len) {
    while (i < len) {
      const c = header.charCodeAt(i);
      if (c === 59 || isTrimWs(c)) {
        i++;
        continue;
      }
      break;
    }

    if (i >= len) {
      break;
    }

    let end = header.indexOf(";", i);
    if (end === -1) {
      end = len;
    }
    const eq = header.indexOf("=", i);

    if (eq !== -1 && eq < end) {
      let keyEnd = eq;
      while (keyEnd > i && isTrimWs(header.charCodeAt(keyEnd - 1))) {
        keyEnd--;
      }
      if (keyEnd - i === nameLen && header.startsWith(name, i)) {
        return header.substring(eq + 1, end);
      }
    }

    i = end + 1;
  }

  return null;
}

function parseCustomTriggers(raw: string): string[] {
  if (!raw) {
    return [];
  }

  const out: string[] = [];
  let i = 0;

  while (i <= raw.length) {
    let dot = raw.indexOf(".", i);
    if (dot === -1) {
      dot = raw.length;
    }
    if (dot > i) {
      out.push(raw.substring(i, dot));
    }
    if (dot === raw.length) {
      break;
    }
    i = dot + 1;
  }

  return out;
}

export function parseSettings(url: URL, request: Request): SuggestSettings {
  return parseSettingsFromRawUrl(url.href, request);
}

export function parseSettingsFromRawUrl(
  rawUrl: string,
  request: Request,
  spOverride?: string | null,
  includeBangContext = true
): SuggestSettings {
  const settings = parseCookieInternal(
    request.headers.get("Cookie") || "",
    includeBangContext
  );
  const sp = spOverride ?? readQueryParam(rawUrl, "sp");
  if (sp) {
    settings.provider = sp;
  }

  return settings;
}

export async function suggest(
  query: string,
  settings: SuggestSettings,
  bangOverride?: PartialBang | null
): Promise<Response> {
  const bang = bangOverride ?? parsePartialBang(query);
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
