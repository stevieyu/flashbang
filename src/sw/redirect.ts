import { BANGS } from "../generated/bangs-min.js";
import {
  CH_0,
  CH_1,
  CH_2,
  CH_BSLASH,
  CH_EXCL,
  CH_PERCENT,
  CH_PLUS,
} from "../shared/chars";
import { resolveTemplateParts } from "../shared/template";

export interface RedirectSettings {
  custom: Record<string, string>;
  defaultUrl: string;
  luckyUrl: string | null;
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

function findExcl(s: string, start: number, end: number): [number, number] {
  for (let i = start; i < end; i++) {
    if (s.charCodeAt(i) === CH_EXCL) {
      return [i, 1];
    }
    if (i + 2 < end && isEncodedExclAt(s, i)) {
      return [i, 3];
    }
  }
  return [-1, 0];
}

function findSpace(s: string, from: number, end: number): [number, number] {
  for (let i = from; i < end; i++) {
    const n = spaceAt(s, i);
    if (n) {
      return [i, n];
    }
  }
  return [-1, 0];
}

function findLastSpaceExcl(
  s: string,
  start: number,
  end: number
): [number, number, number] {
  for (let i = end - 1; i >= start; i--) {
    const c = s.charCodeAt(i);
    let exclLen = 0;
    if (c === CH_EXCL) {
      exclLen = 1;
    } else if (i + 2 < end && isEncodedExclAt(s, i)) {
      exclLen = 3;
    } else {
      continue;
    }
    if (i >= start + 1 && s.charCodeAt(i - 1) === CH_PLUS) {
      return [i - 1, 1, exclLen];
    }
    if (
      i >= start + 3 &&
      s.charCodeAt(i - 3) === CH_PERCENT &&
      s.charCodeAt(i - 2) === CH_2 &&
      s.charCodeAt(i - 1) === CH_0
    ) {
      return [i - 3, 3, exclLen];
    }
  }
  return [-1, 0, 0];
}

function findLastSpace(
  s: string,
  start: number,
  before: number
): [number, number] {
  for (let i = before; i >= start; i--) {
    if (s.charCodeAt(i) === CH_PLUS) {
      return [i, 1];
    }
    if (
      s.charCodeAt(i) === CH_PERCENT &&
      i + 2 <= before &&
      s.charCodeAt(i + 1) === CH_2 &&
      s.charCodeAt(i + 2) === CH_0
    ) {
      return [i, 3];
    }
  }
  return [-1, 0];
}

function rawFixup(s: string, from: number, to: number): string {
  const raw = from === 0 && to === s.length ? s : s.substring(from, to);
  const plusPos = raw.indexOf("+");
  if (plusPos === -1) {
    if (raw.indexOf("%2F") === -1 && raw.indexOf("%2f") === -1) {
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
        if (c2 === 70 || c2 === 102) {
          out += `${raw.substring(seg, i)}/`;
          seg = i + 3;
          i += 2;
        }
      }
    }
    return out + raw.substring(seg);
  }
  const hasSlash = raw.indexOf("%2F") !== -1 || raw.indexOf("%2f") !== -1;
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

function fillTemplate(
  url: string,
  s: string,
  termStart: number,
  termEnd: number
): string {
  const parts = resolveTemplateParts(url);
  if (!parts) {
    return url;
  }
  return parts[0] + rawFixup(s, termStart, termEnd) + parts[1];
}

function originOf(url: string): string {
  const protoEnd = url.indexOf("://");
  if (protoEnd === -1) {
    const parts = resolveTemplateParts(url);
    return parts ? parts[0] + parts[1] : url;
  }
  const pathStart = url.indexOf("/", protoEnd + 3);
  return pathStart !== -1 ? url.substring(0, pathStart) : url;
}

function redir(url: string): Response {
  // NOTE: Response.redirect(url, 302) benchmarks faster than constructing
  // new Response(null, { status: 302, headers: { Location: url } }) here.
  return Response.redirect(url, 302);
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
    const termStart = start + 1;
    if (luckyUrl) {
      return [fillTemplate(luckyUrl, rawQuery, termStart, end), null];
    }
    return [fillTemplate(defaultUrl, rawQuery, termStart, end), null];
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
    const sp1 = spaceAt(rawQuery, afterExcl);
    if (sp1) {
      const termStart = afterExcl + sp1;
      if (termStart >= end) {
        return ["/", null];
      }
      if (luckyUrl) {
        return [fillTemplate(luckyUrl, rawQuery, termStart, end), null];
      }
      return [fillTemplate(defaultUrl, rawQuery, termStart, end), null];
    }

    // "!g+cats" or "!g" — prefix bang
    const [sp, spLen] = findSpace(rawQuery, afterExcl, end);
    const bangEnd = sp === -1 ? end : sp;
    const bang = rawQuery.substring(afterExcl, bangEnd).toLowerCase();

    const url = custom[bang] || BANGS[bang];
    if (!url) {
      return [fillTemplate(defaultUrl, rawQuery, start, end), null];
    }

    if (sp === -1 || sp + spLen >= end) {
      return [originOf(url), bang];
    }

    return [fillTemplate(url, rawQuery, sp + spLen, end), bang];
  }

  // "query+!" / "query%20!" — trailing bare bang lucky
  const lastChar = rawQuery.charCodeAt(end - 1);
  if (lastChar === CH_EXCL) {
    // "query+!"
    if (rawQuery.charCodeAt(end - 2) === CH_PLUS) {
      const termEnd = end - 2;
      if (termEnd <= start) {
        return ["/", null];
      }
      if (luckyUrl) {
        return [fillTemplate(luckyUrl, rawQuery, start, termEnd), null];
      }
      return [fillTemplate(defaultUrl, rawQuery, start, termEnd), null];
    }
    // "query%20!"
    if (
      end - start >= 4 &&
      rawQuery.charCodeAt(end - 4) === CH_PERCENT &&
      rawQuery.charCodeAt(end - 3) === CH_2 &&
      rawQuery.charCodeAt(end - 2) === CH_0
    ) {
      const termEnd = end - 4;
      if (termEnd <= start) {
        return ["/", null];
      }
      if (luckyUrl) {
        return [fillTemplate(luckyUrl, rawQuery, start, termEnd), null];
      }
      return [fillTemplate(defaultUrl, rawQuery, start, termEnd), null];
    }
  }
  // "query+%21" / "query%20%21"
  if (end - start >= 3 && isEncodedExclAt(rawQuery, end - 3)) {
    const beforeExcl = end - 3;
    if (rawQuery.charCodeAt(beforeExcl - 1) === CH_PLUS) {
      const termEnd = beforeExcl - 1;
      if (termEnd <= start) {
        return ["/", null];
      }
      if (luckyUrl) {
        return [fillTemplate(luckyUrl, rawQuery, start, termEnd), null];
      }
      return [fillTemplate(defaultUrl, rawQuery, start, termEnd), null];
    }
    if (
      beforeExcl >= start + 3 &&
      rawQuery.charCodeAt(beforeExcl - 3) === CH_PERCENT &&
      rawQuery.charCodeAt(beforeExcl - 2) === CH_2 &&
      rawQuery.charCodeAt(beforeExcl - 1) === CH_0
    ) {
      const termEnd = beforeExcl - 3;
      if (termEnd <= start) {
        return ["/", null];
      }
      if (luckyUrl) {
        return [fillTemplate(luckyUrl, rawQuery, start, termEnd), null];
      }
      return [fillTemplate(defaultUrl, rawQuery, start, termEnd), null];
    }
  }

  const [exclPos, eWidth] = findExcl(rawQuery, start, end);
  if (exclPos === -1) {
    return [fillTemplate(defaultUrl, rawQuery, start, end), null];
  }

  // "g!+cats"
  const afterE = exclPos + eWidth;
  if (afterE < end) {
    const spAfter = spaceAt(rawQuery, afterE);
    if (spAfter) {
      const bang = rawQuery.substring(start, exclPos).toLowerCase();
      const url = custom[bang] || BANGS[bang];
      if (url) {
        const termStart = afterE + spAfter;
        if (termStart >= end) {
          return [originOf(url), bang];
        }
        return [fillTemplate(url, rawQuery, termStart, end), bang];
      }
      return [fillTemplate(defaultUrl, rawQuery, start, end), null];
    }
  }

  // "g!"
  if (afterE >= end || (lastChar === CH_EXCL && afterE === end)) {
    const [hasSpace] = findSpace(rawQuery, start, end);
    if (hasSpace === -1) {
      const bang = rawQuery.substring(start, exclPos).toLowerCase();
      const url = custom[bang] || BANGS[bang];
      if (url) {
        return [originOf(url), bang];
      }
      return [fillTemplate(defaultUrl, rawQuery, start, end), null];
    }
  }

  // "cats+!g"
  const [spExclPos, spExclLen, seWidth] = findLastSpaceExcl(
    rawQuery,
    start,
    end
  );
  if (spExclPos !== -1) {
    const bangStart = spExclPos + spExclLen + seWidth;
    if (bangStart < end) {
      const bangStr = rawQuery.substring(bangStart, end);
      if (bangStr.indexOf("+") === -1 && !bangStr.includes("%20")) {
        const bang = bangStr.toLowerCase();
        const url = custom[bang] || BANGS[bang];
        if (url) {
          return [fillTemplate(url, rawQuery, start, spExclPos), bang];
        }
        return [fillTemplate(defaultUrl, rawQuery, start, end), null];
      }
    }
  }

  // "cats+g!"
  if (
    lastChar === CH_EXCL ||
    (end >= 3 && isEncodedExclAt(rawQuery, end - eWidth))
  ) {
    const bangExclEnd = lastChar === CH_EXCL ? end - 1 : end - 3;
    const [lastSpPos, lastSpLen] = findLastSpace(
      rawQuery,
      start,
      bangExclEnd - 1
    );
    if (lastSpPos !== -1) {
      const bangStart2 = lastSpPos + lastSpLen;
      if (bangStart2 < bangExclEnd) {
        const bang = rawQuery.substring(bangStart2, bangExclEnd).toLowerCase();
        const url = custom[bang] || BANGS[bang];
        if (url) {
          return [fillTemplate(url, rawQuery, start, lastSpPos), bang];
        }
        return [fillTemplate(defaultUrl, rawQuery, start, end), null];
      }
    }
  }

  return [fillTemplate(defaultUrl, rawQuery, start, end), null];
}

export function redirectRaw(
  rawQuery: string,
  settings: RedirectSettings
): [Response, string | null] {
  const [url, bang] = resolveRaw(rawQuery, settings);
  return [redir(url), bang];
}

export function redirect(query: string, settings: RedirectSettings): Response {
  return redirectRaw(
    encodeURIComponent(query).replace(/%5C/g, "\\"),
    settings
  )[0];
}
