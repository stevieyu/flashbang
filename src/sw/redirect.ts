import { lookupBang } from "../generated/bangs-min.js";
import {
  CH_0,
  CH_1,
  CH_2,
  CH_BSLASH,
  CH_EXCL,
  CH_F,
  CH_f,
  CH_PERCENT,
  CH_PLUS,
} from "../shared/chars";

export type UrlParts = readonly [string, string | null];

export interface RedirectSettings {
  custom: Record<string, UrlParts>;
  defaultUrl: UrlParts;
  luckyUrl: UrlParts | null;
}

function spaceAt(s: string, i: number): number {
  const c = s.charCodeAt(i);
  if (c === CH_PLUS) {
    return 1;
  }
  if (
    c === CH_PERCENT &&
    s.charCodeAt(i + 1) === CH_2 &&
    s.charCodeAt(i + 2) === CH_0
  ) {
    return 3;
  }
  return 0;
}

function isEncodedExclAt(s: string, i: number): boolean {
  return (
    s.charCodeAt(i) === CH_PERCENT &&
    s.charCodeAt(i + 1) === CH_2 &&
    s.charCodeAt(i + 2) === CH_1
  );
}

function findExcl(s: string, start: number, end: number): number {
  for (let i = start; i < end; i++) {
    const c = s.charCodeAt(i);
    if (c === CH_EXCL) {
      return (i << 2) | 1;
    }
    if (
      c === CH_PERCENT &&
      i + 2 < end &&
      s.charCodeAt(i + 1) === CH_2 &&
      s.charCodeAt(i + 2) === CH_1
    ) {
      return (i << 2) | 3;
    }
  }
  return -1;
}

function findSpace(s: string, from: number, end: number): number {
  for (let i = from; i < end; i++) {
    const n = spaceAt(s, i);
    if (n) {
      return (i << 2) | n;
    }
  }
  return -1;
}

function findLastSpaceExcl(s: string, start: number, end: number): number {
  for (let i = end - 1; i >= start; i--) {
    const c = s.charCodeAt(i);
    let exclWidth = 0;
    if (c === CH_EXCL) {
      exclWidth = 1;
    } else if (
      c === CH_PERCENT &&
      i + 2 < end &&
      s.charCodeAt(i + 1) === CH_2 &&
      s.charCodeAt(i + 2) === CH_1
    ) {
      exclWidth = 3;
    }
    if (!exclWidth) {
      continue;
    }
    if (i >= start + 1 && s.charCodeAt(i - 1) === CH_PLUS) {
      return ((i - 1) << 4) | (1 << 2) | exclWidth;
    }
    if (
      i >= start + 3 &&
      s.charCodeAt(i - 3) === CH_PERCENT &&
      s.charCodeAt(i - 2) === CH_2 &&
      s.charCodeAt(i - 1) === CH_0
    ) {
      return ((i - 3) << 4) | (3 << 2) | exclWidth;
    }
  }
  return -1;
}

function findLastSpace(s: string, start: number, before: number): number {
  for (let i = before; i >= start; i--) {
    if (s.charCodeAt(i) === CH_PLUS) {
      return (i << 2) | 1;
    }
    if (
      s.charCodeAt(i) === CH_PERCENT &&
      i + 2 <= before &&
      s.charCodeAt(i + 1) === CH_2 &&
      s.charCodeAt(i + 2) === CH_0
    ) {
      return (i << 2) | 3;
    }
  }
  return -1;
}

function rawFixup(s: string, from: number, to: number): string {
  const raw = from === 0 && to === s.length ? s : s.substring(from, to);
  const plusPos = raw.indexOf("+");
  if (plusPos === -1) {
    if (
      raw.indexOf("%") === -1 ||
      (raw.indexOf("%2F") === -1 && raw.indexOf("%2f") === -1)
    ) {
      return raw;
    }
    let out = "";
    let seg = 0;
    for (let i = 0; i < raw.length; i++) {
      if (
        raw.charCodeAt(i) === CH_PERCENT &&
        i + 2 < raw.length &&
        raw.charCodeAt(i + 1) === CH_2
      ) {
        const c2 = raw.charCodeAt(i + 2);
        if (c2 === CH_F || c2 === CH_f) {
          out += `${raw.substring(seg, i)}/`;
          seg = i + 3;
          i += 2;
        }
      }
    }
    return out + raw.substring(seg);
  }
  const hasSlash =
    raw.indexOf("%") !== -1 &&
    (raw.indexOf("%2F") !== -1 || raw.indexOf("%2f") !== -1);
  let out = `${raw.substring(0, plusPos)}%20`;
  let seg = plusPos + 1;
  for (let i = seg; i < raw.length; i++) {
    const c = raw.charCodeAt(i);
    if (c === CH_PLUS) {
      out += `${raw.substring(seg, i)}%20`;
      seg = i + 1;
    } else if (
      hasSlash &&
      c === CH_PERCENT &&
      i + 2 < raw.length &&
      raw.charCodeAt(i + 1) === CH_2
    ) {
      const c2 = raw.charCodeAt(i + 2);
      if (c2 === 70 || c2 === 102) {
        out += `${raw.substring(seg, i)}/`;
        seg = i + 3;
        i += 2;
      }
    }
  }
  return out + raw.substring(seg);
}

function fillParts(
  parts: UrlParts,
  s: string,
  termStart: number,
  termEnd: number
): string {
  if (parts[1] === null) {
    return parts[0];
  }
  return parts[0] + rawFixup(s, termStart, termEnd) + parts[1];
}

function luckyOrDefault(
  luckyUrl: UrlParts | null,
  defaultUrl: UrlParts,
  rawQuery: string,
  termStart: number,
  termEnd: number
): string {
  return fillParts(luckyUrl ?? defaultUrl, rawQuery, termStart, termEnd);
}

function originOfPrefix(prefix: string): string {
  const protoEnd = prefix.indexOf("://");
  if (protoEnd === -1) {
    return prefix;
  }
  const pathStart = prefix.indexOf("/", protoEnd + 3);
  return pathStart !== -1 ? prefix.substring(0, pathStart) : prefix;
}

const builtInOriginCache: Record<string, string> = Object.create(null);
const customOriginCache = new WeakMap<
  Record<string, UrlParts>,
  Record<string, string>
>();

function getCustomOriginCache(
  custom: Record<string, UrlParts>
): Record<string, string> {
  const existing = customOriginCache.get(custom);
  if (existing !== undefined) {
    return existing;
  }
  const fresh: Record<string, string> = Object.create(null);
  customOriginCache.set(custom, fresh);
  return fresh;
}

function redir(url: string): Response {
  // NOTE: Response.redirect(url, 302) benchmarks faster than constructing
  // new Response(null, { status: 302, headers: { Location: url } }) here.
  return Response.redirect(url, 302);
}

function resolveBangFill(
  bang: string,
  custom: Record<string, UrlParts>,
  rawQuery: string,
  termStart: number,
  termEnd: number
): string | null {
  const entry = custom[bang] || lookupBang(bang);
  if (!entry) {
    return null;
  }
  if (entry[1] === null) {
    return entry[0];
  }
  return entry[0] + rawFixup(rawQuery, termStart, termEnd) + entry[1];
}

function resolveBangOrigin(
  bang: string,
  custom: Record<string, UrlParts>
): string | null {
  const customEntry = custom[bang];
  if (customEntry) {
    const cached = getCustomOriginCache(custom);
    const origin = cached[bang];
    if (origin !== undefined) {
      return origin;
    }
    const computed = originOfPrefix(customEntry[0]);
    cached[bang] = computed;
    return computed;
  }

  const builtIn = builtInOriginCache[bang];
  if (builtIn !== undefined) {
    return builtIn;
  }
  const entry = lookupBang(bang);
  if (!entry) {
    return null;
  }
  const origin = originOfPrefix(entry[0]);
  builtInOriginCache[bang] = origin;
  return origin;
}

function findTrailingBareBang(
  s: string,
  start: number,
  end: number,
  lastChar: number
): number {
  if (lastChar === CH_EXCL) {
    // "query+!"
    if (s.charCodeAt(end - 2) === CH_PLUS) {
      return end - 2;
    }
    // "query%20!"
    if (
      end - start >= 4 &&
      s.charCodeAt(end - 4) === CH_PERCENT &&
      s.charCodeAt(end - 3) === CH_2 &&
      s.charCodeAt(end - 2) === CH_0
    ) {
      return end - 4;
    }
  }
  // "query+%21" / "query%20%21"
  if (end - start >= 3 && isEncodedExclAt(s, end - 3)) {
    const beforeExcl = end - 3;
    if (s.charCodeAt(beforeExcl - 1) === CH_PLUS) {
      return beforeExcl - 1;
    }
    if (
      beforeExcl >= start + 3 &&
      s.charCodeAt(beforeExcl - 3) === CH_PERCENT &&
      s.charCodeAt(beforeExcl - 2) === CH_2 &&
      s.charCodeAt(beforeExcl - 1) === CH_0
    ) {
      return beforeExcl - 3;
    }
  }
  return -1;
}

function toLowerIfNeeded(s: string, from: number, to: number): string {
  for (let i = from; i < to; i++) {
    const c = s.charCodeAt(i);
    if (c >= 65 && c <= 90) {
      return s.substring(from, to).toLowerCase();
    }
  }
  return from === 0 && to === s.length ? s : s.substring(from, to);
}

function resolveRaw(
  rawQuery: string,
  { defaultUrl, custom, luckyUrl }: RedirectSettings
): [string, string | null] {
  const len = rawQuery.length;

  let start = 0;
  while (start < len) {
    const n = spaceAt(rawQuery, start);
    if (!n) {
      break;
    }
    start += n;
  }

  let end = len;
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

  if (start >= end) {
    return ["/", null];
  }

  const c0 = rawQuery.charCodeAt(start);

  // "\" — feeling lucky
  if (c0 === CH_BSLASH && end - start > 1) {
    return [
      luckyOrDefault(luckyUrl, defaultUrl, rawQuery, start + 1, end),
      null,
    ];
  }

  let exclStart = -1;
  let exclWidth = 0;
  if (c0 === CH_EXCL) {
    exclStart = start;
    exclWidth = 1;
  } else if (end - start >= 3 && isEncodedExclAt(rawQuery, start)) {
    exclStart = start;
    exclWidth = 3;
  }

  if (exclStart !== -1) {
    const afterExcl = exclStart + exclWidth;

    if (afterExcl >= end) {
      return ["/", null];
    }

    // "!+query" / "!%20query" — bare bang lucky
    const spaceWidth = spaceAt(rawQuery, afterExcl);
    if (spaceWidth) {
      const termStart = afterExcl + spaceWidth;
      if (termStart >= end) {
        return ["/", null];
      }
      return [
        luckyOrDefault(luckyUrl, defaultUrl, rawQuery, termStart, end),
        null,
      ];
    }

    // "!g+cats" or "!g" — prefix bang
    const spPacked = findSpace(rawQuery, afterExcl, end);
    const sp = spPacked === -1 ? -1 : spPacked >> 2;
    const spLen = spPacked === -1 ? 0 : spPacked & 0b11;
    const bangEnd = sp === -1 ? end : sp;
    const bang = toLowerIfNeeded(rawQuery, afterExcl, bangEnd);

    if (sp === -1 || sp + spLen >= end) {
      const origin = resolveBangOrigin(bang, custom);
      if (!origin) {
        return [fillParts(defaultUrl, rawQuery, start, end), null];
      }
      return [origin, bang];
    }

    const filled = resolveBangFill(bang, custom, rawQuery, sp + spLen, end);
    if (filled === null) {
      return [fillParts(defaultUrl, rawQuery, start, end), null];
    }
    return [filled, bang];
  }

  // "query+!" / "query%20!" / "query+%21" / "query%20%21" — trailing bare bang lucky
  const lastChar = rawQuery.charCodeAt(end - 1);
  const trailingTermEnd = findTrailingBareBang(rawQuery, start, end, lastChar);
  if (trailingTermEnd !== -1) {
    if (trailingTermEnd <= start) {
      return ["/", null];
    }
    return [
      luckyOrDefault(luckyUrl, defaultUrl, rawQuery, start, trailingTermEnd),
      null,
    ];
  }

  const exclPacked = findExcl(rawQuery, start, end);
  if (exclPacked === -1) {
    return [fillParts(defaultUrl, rawQuery, start, end), null];
  }
  const exclPos = exclPacked >> 2;
  const exclCharWidth = exclPacked & 0b11;

  // "g!+cats"
  const afterExcl = exclPos + exclCharWidth;
  if (afterExcl < end) {
    const spAfter = spaceAt(rawQuery, afterExcl);
    if (spAfter) {
      const bang = toLowerIfNeeded(rawQuery, start, exclPos);
      const termStart = afterExcl + spAfter;
      if (termStart >= end) {
        const origin = resolveBangOrigin(bang, custom);
        if (origin) {
          return [origin, bang];
        }
      } else {
        const filled = resolveBangFill(bang, custom, rawQuery, termStart, end);
        if (filled !== null) {
          return [filled, bang];
        }
      }
      return [fillParts(defaultUrl, rawQuery, start, end), null];
    }
  }

  // "g!"
  if (afterExcl >= end || (lastChar === CH_EXCL && afterExcl === end)) {
    if (findSpace(rawQuery, start, end) === -1) {
      const bang = toLowerIfNeeded(rawQuery, start, exclPos);
      const origin = resolveBangOrigin(bang, custom);
      if (origin) {
        return [origin, bang];
      }
      return [fillParts(defaultUrl, rawQuery, start, end), null];
    }
  }

  // "cats+!g"
  const suffixPacked = findLastSpaceExcl(rawQuery, start, end);
  if (suffixPacked !== -1) {
    const spaceBeforeBangPos = suffixPacked >> 4;
    const spaceBeforeBangWidth = (suffixPacked >> 2) & 0b11;
    const suffixExclWidth = suffixPacked & 0b11;
    const bangStart =
      spaceBeforeBangPos + spaceBeforeBangWidth + suffixExclWidth;
    if (bangStart < end) {
      if (findSpace(rawQuery, bangStart, end) === -1) {
        const bang = toLowerIfNeeded(rawQuery, bangStart, end);
        const filled = resolveBangFill(
          bang,
          custom,
          rawQuery,
          start,
          spaceBeforeBangPos
        );
        if (filled !== null) {
          return [filled, bang];
        }
        return [fillParts(defaultUrl, rawQuery, start, end), null];
      }
    }
  }

  // "cats+g!"
  if (
    lastChar === CH_EXCL ||
    (end >= 3 && isEncodedExclAt(rawQuery, end - exclCharWidth))
  ) {
    const bangExclEnd = lastChar === CH_EXCL ? end - 1 : end - 3;
    const lastSpPacked = findLastSpace(rawQuery, start, bangExclEnd - 1);
    if (lastSpPacked !== -1) {
      const lastSpPos = lastSpPacked >> 2;
      const lastSpLen = lastSpPacked & 0b11;
      const suffixBangStart = lastSpPos + lastSpLen;
      if (suffixBangStart < bangExclEnd) {
        const bang = toLowerIfNeeded(rawQuery, suffixBangStart, bangExclEnd);
        const filled = resolveBangFill(
          bang,
          custom,
          rawQuery,
          start,
          lastSpPos
        );
        if (filled !== null) {
          return [filled, bang];
        }
        return [fillParts(defaultUrl, rawQuery, start, end), null];
      }
    }
  }

  return [fillParts(defaultUrl, rawQuery, start, end), null];
}

export function redirectRaw(
  rawQuery: string,
  settings: RedirectSettings
): [Response, string | null] {
  const [url, trigger] = resolveRaw(rawQuery, settings);
  return [redir(url), trigger];
}

function encodeForRedirect(query: string): string {
  return encodeURIComponent(query).replace(/%5C/g, "\\");
}

export function redirectUrl(query: string, settings: RedirectSettings): string {
  return resolveRaw(encodeForRedirect(query), settings)[0];
}

export function redirect(query: string, settings: RedirectSettings): Response {
  return redir(redirectUrl(query, settings));
}
