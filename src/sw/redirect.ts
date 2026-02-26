import { BANGS } from "../generated/bangs-min.js";

export interface RedirectSettings {
  custom: Record<string, string>;
  defaultUrl: string;
  luckyUrl: string | null;
}

const CH_PLUS = 43; // +
const CH_EXCL = 33; // !
const CH_BSLASH = 92; // \
const CH_PERCENT = 37; // %
const CH_2 = 50; // '2'
const CH_0 = 48; // '0'

function isRawSpaceAt(s: string, i: number): number {
  if (s.charCodeAt(i) === CH_PLUS) {
    return 1;
  }
  if (
    s.charCodeAt(i) === CH_PERCENT &&
    s.charCodeAt(i + 1) === CH_2 &&
    s.charCodeAt(i + 2) === CH_0
  ) {
    return 3;
  }
  return 0;
}

function findRawSpace(s: string, from: number): [number, number] {
  for (let i = from; i < s.length; i++) {
    const n = isRawSpaceAt(s, i);
    if (n) {
      return [i, n];
    }
  }
  return [-1, 0];
}

const RE_PLUS = /\+/g;
const RE_ENCODED_SLASH = /%2[Ff]/g;
const RE_ENCODED_EXCL = /%21/g;

function rawFixup(raw: string): string {
  return raw.replace(RE_PLUS, "%20").replace(RE_ENCODED_SLASH, "/");
}

function trimRaw(rawQuery: string): string {
  let start = 0;
  while (start < rawQuery.length) {
    const n = isRawSpaceAt(rawQuery, start);
    if (!n) {
      break;
    }
    start += n;
  }

  let end = rawQuery.length;
  while (end > start) {
    if (rawQuery.charCodeAt(end - 1) === CH_PLUS) {
      end--;
      continue;
    }
    if (
      end >= start + 3 &&
      rawQuery.charCodeAt(end - 3) === CH_PERCENT &&
      rawQuery.charCodeAt(end - 2) === CH_2 &&
      rawQuery.charCodeAt(end - 1) === CH_0
    ) {
      end -= 3;
      continue;
    }
    break;
  }

  return start === 0 && end === rawQuery.length
    ? rawQuery
    : rawQuery.substring(start, end);
}

interface RawParsed {
  bang: string | null;
  rawTerm: string;
  rawFull: string;
  lucky: boolean;
}

function parseRaw(s: string): RawParsed {
  // "\query" — feeling lucky
  if (s.charCodeAt(0) === CH_BSLASH && s.length > 1) {
    return { bang: null, rawTerm: s.substring(1), rawFull: s, lucky: true };
  }

  // All "!" prefix patterns
  if (s.charCodeAt(0) === CH_EXCL) {
    // "!+query" or "!%20query" — feeling lucky (bare bang)
    const sp1 = isRawSpaceAt(s, 1);
    if (sp1) {
      return {
        bang: null,
        rawTerm: s.substring(1 + sp1),
        rawFull: s,
        lucky: true,
      };
    }
    // "!g+cats" or "!g"
    const [sp, spLen] = findRawSpace(s, 1);
    if (sp === -1) {
      return {
        bang: s.substring(1).toLowerCase(),
        rawTerm: "",
        rawFull: s,
        lucky: false,
      };
    }
    return {
      bang: s.substring(1, sp).toLowerCase(),
      rawTerm: s.substring(sp + spLen),
      rawFull: s,
      lucky: false,
    };
  }

  // "query+!" or "query%20!" — trailing bare bang lucky
  if (s.charCodeAt(s.length - 1) === CH_EXCL) {
    if (s.charCodeAt(s.length - 2) === CH_PLUS) {
      return {
        bang: null,
        rawTerm: s.substring(0, s.length - 2),
        rawFull: s,
        lucky: true,
      };
    }
    if (
      s.length >= 4 &&
      s.charCodeAt(s.length - 4) === CH_PERCENT &&
      s.charCodeAt(s.length - 3) === CH_2 &&
      s.charCodeAt(s.length - 2) === CH_0
    ) {
      return {
        bang: null,
        rawTerm: s.substring(0, s.length - 4),
        rawFull: s,
        lucky: true,
      };
    }
  }

  return parseRawSuffix(s);
}

function findLastRawSpace(s: string, before: number): [number, number] {
  for (let i = before; i >= 0; i--) {
    if (s.charCodeAt(i) === CH_PLUS) {
      return [i, 1];
    }
    if (
      s.charCodeAt(i) === CH_PERCENT &&
      i + 2 < s.length &&
      s.charCodeAt(i + 1) === CH_2 &&
      s.charCodeAt(i + 2) === CH_0
    ) {
      return [i, 3];
    }
  }
  return [-1, 0];
}

function findLastSpaceExcl(s: string): [number, number] {
  for (let i = s.length - 1; i >= 1; i--) {
    if (s.charCodeAt(i) !== CH_EXCL) {
      continue;
    }
    if (s.charCodeAt(i - 1) === CH_PLUS) {
      return [i - 1, 1];
    }
    if (
      i >= 3 &&
      s.charCodeAt(i - 3) === CH_PERCENT &&
      s.charCodeAt(i - 2) === CH_2 &&
      s.charCodeAt(i - 1) === CH_0
    ) {
      return [i - 3, 3];
    }
  }
  return [-1, 0];
}

function parseRawSuffix(s: string): RawParsed {
  // All remaining patterns require "!" — find it once, bail if absent
  const excl = s.indexOf("!");
  if (excl === -1) {
    return { bang: null, rawTerm: s, rawFull: s, lucky: false };
  }

  // "g!+cats" — prefix suffix-bang
  if (excl < s.length - 1) {
    const spAfter = isRawSpaceAt(s, excl + 1);
    if (spAfter) {
      return {
        bang: s.substring(0, excl).toLowerCase(),
        rawTerm: s.substring(excl + 1 + spAfter),
        rawFull: s,
        lucky: false,
      };
    }
  }

  // "g!" — suffix-bang alone (no spaces anywhere)
  if (s.charCodeAt(s.length - 1) === CH_EXCL) {
    const [hasSpace] = findRawSpace(s, 0);
    if (hasSpace === -1) {
      return {
        bang: s.substring(0, s.length - 1).toLowerCase(),
        rawTerm: "",
        rawFull: s,
        lucky: false,
      };
    }
  }

  // "cats+!g" — trailing prefix-bang
  const [spExclPos, spExclLen] = findLastSpaceExcl(s);
  if (spExclPos !== -1) {
    const bangStart = spExclPos + spExclLen + 1;
    if (bangStart < s.length) {
      const b = s.substring(bangStart);
      if (b.indexOf("+") === -1 && !b.includes("%20")) {
        return {
          bang: b.toLowerCase(),
          rawTerm: s.substring(0, spExclPos),
          rawFull: s,
          lucky: false,
        };
      }
    }
  }

  // "cats+g!" — trailing suffix-bang
  if (s.charCodeAt(s.length - 1) === CH_EXCL) {
    const [lastSpPos, lastSpLen] = findLastRawSpace(s, s.length - 2);
    if (lastSpPos !== -1) {
      const b = s.substring(lastSpPos + lastSpLen, s.length - 1);
      if (b.length > 0) {
        return {
          bang: b.toLowerCase(),
          rawTerm: s.substring(0, lastSpPos),
          rawFull: s,
          lucky: false,
        };
      }
    }
  }

  return { bang: null, rawTerm: s, rawFull: s, lucky: false };
}

function redir(url: string): Response {
  return new Response(null, { status: 302, headers: { Location: url } });
}

function resolve(
  { bang, rawTerm, rawFull, lucky }: RawParsed,
  { defaultUrl, custom, luckyUrl }: RedirectSettings
): [Response, string | null] {
  if (lucky && luckyUrl && rawTerm) {
    return [redir(luckyUrl.replace("{}", rawFixup(rawTerm))), null];
  }

  let url: string | undefined;

  if (bang) {
    url = custom[bang] || BANGS[bang];
    if (!url) {
      return [redir(defaultUrl.replace("{}", rawFixup(rawFull))), null];
    }
  } else {
    url = defaultUrl;
  }

  if (!rawTerm) {
    const protoEnd = url.indexOf("://");
    if (protoEnd === -1) {
      return [redir(url.replace("{}", "")), bang];
    }
    const pathStart = url.indexOf("/", protoEnd + 3);
    const origin = pathStart !== -1 ? url.substring(0, pathStart) : url;
    return [redir(origin), bang];
  }

  return [redir(url.replace("{}", rawFixup(rawTerm))), bang];
}

export function redirectRaw(
  rawQuery: string,
  settings: RedirectSettings
): [Response, string | null] {
  const s = trimRaw(rawQuery).replace(RE_ENCODED_EXCL, "!");
  if (!s || s === "!") {
    return [redir("/"), null];
  }
  return resolve(parseRaw(s), settings);
}

export function redirect(query: string, settings: RedirectSettings): Response {
  return redirectRaw(
    encodeURIComponent(query).replace(/%5C/g, "\\"),
    settings
  )[0];
}
