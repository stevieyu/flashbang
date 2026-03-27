import {
  parseFrecencyCompact,
  serializeFrecencyCompact,
} from "./frecency-serial";

const SECTION_SEPARATOR = "|";
const FREQUENCY_PREFIX = "f:";
const CUSTOM_PREFIX = "c:";

interface ParsedSuggestCookieCore {
  provider: string;
  trigger: string;
  customUrl: string | null;
}

interface ParsedSuggestCookieContext {
  custom: string[];
  frecent: Record<string, number>;
}

export interface ParsedSuggestCookie
  extends ParsedSuggestCookieCore,
    ParsedSuggestCookieContext {}

const DEFAULT_PROVIDER = "default";
const DEFAULT_TRIGGER = "g";

interface ParsedSuggestCookieWithValidation {
  settings: ParsedSuggestCookie;
  hasInvalidContext: boolean;
}

function safeDecodeURIComponent(value: string): string | null {
  if (value.indexOf("%") === -1) {
    return value;
  }
  try {
    return decodeURIComponent(value);
  } catch {
    return null;
  }
}

function parseFrecencyCompactSection(
  raw: string,
  forCleanup: boolean
): { value: Record<string, number>; valid: boolean } {
  const value = parseFrecencyCompact(raw);
  const valid = Object.keys(value).length > 0 || !forCleanup;
  return { value, valid };
}

function parseCustomModern(
  raw: string,
  forCleanup: boolean
): { value: string[]; valid: boolean } {
  const decoded = safeDecodeURIComponent(raw);
  if (!decoded) {
    return { value: [], valid: !forCleanup };
  }

  try {
    const parsed = JSON.parse(decoded);
    if (!Array.isArray(parsed)) {
      return { value: [], valid: false };
    }

    const out: string[] = [];
    for (const item of parsed) {
      if (typeof item === "string") {
        out.push(item);
        continue;
      }
      if (forCleanup) {
        return { value: out, valid: false };
      }
    }

    return { value: out, valid: true };
  } catch {
    return { value: [], valid: false };
  }
}

export function parseSuggestCookieValue(
  raw: string,
  includeBangContext: boolean
): ParsedSuggestCookie {
  return parseSuggestCookieValueWithValidation(raw, includeBangContext, false)
    .settings;
}

export function parseSuggestCookieValueWithValidation(
  raw: string,
  includeBangContext: boolean,
  forCleanup: boolean
): ParsedSuggestCookieWithValidation {
  const firstPipe = raw.indexOf(SECTION_SEPARATOR);
  const firstSection = firstPipe === -1 ? raw : raw.substring(0, firstPipe);

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
      customUrl = firstSection.substring(comma2 + 1);
    }
  }

  let custom: string[] = [];
  let frecent: Record<string, number> = {};
  let hasInvalidContext = false;

  if (includeBangContext && firstPipe !== -1) {
    let sectionStart = firstPipe + 1;

    while (sectionStart <= raw.length) {
      let sectionEnd = raw.indexOf(SECTION_SEPARATOR, sectionStart);
      if (sectionEnd === -1) {
        sectionEnd = raw.length;
      }

      if (sectionEnd > sectionStart) {
        const section = raw.substring(sectionStart, sectionEnd);
        if (section.startsWith(FREQUENCY_PREFIX)) {
          const sectionVal = section.substring(2);
          const result = parseFrecencyCompactSection(sectionVal, forCleanup);
          frecent = result.value;
          if (forCleanup && !result.valid) {
            hasInvalidContext = true;
            break;
          }
        } else if (section.startsWith(CUSTOM_PREFIX)) {
          const result = parseCustomModern(section.substring(2), forCleanup);
          custom = result.value;
          if (forCleanup && !result.valid) {
            hasInvalidContext = true;
            break;
          }
        } else if (forCleanup) {
          hasInvalidContext = true;
          break;
        }
      }

      if (sectionEnd === raw.length) {
        break;
      }

      sectionStart = sectionEnd + 1;
    }
  }

  const settings: ParsedSuggestCookie = {
    provider: provider || DEFAULT_PROVIDER,
    trigger: trigger || DEFAULT_TRIGGER,
    customUrl: customUrl ? safeDecodeURIComponent(customUrl) : null,
    frecent,
    custom,
  };

  return {
    settings,
    hasInvalidContext,
  };
}

export function encodeSuggestCookieValue(
  provider: string,
  trigger: string,
  customUrl: string,
  custom: string[] = [],
  frecent: Record<string, number> | null = null
): string {
  let value = `${provider},${trigger},${encodeURIComponent(customUrl)}`;

  const compact = serializeFrecencyCompact(frecent);
  if (compact) {
    value += `${SECTION_SEPARATOR}${FREQUENCY_PREFIX}${compact}`;
  }

  if (custom.length > 0) {
    value += `${SECTION_SEPARATOR}${CUSTOM_PREFIX}${encodeURIComponent(
      JSON.stringify(custom)
    )}`;
  }

  return value;
}
