import { describe, expect, mock, test } from "bun:test";

mock.module("../generated/bangs-min.js", () => {
  const BANGS: Record<string, [string, string | null]> = Object.create(null);
  BANGS.g = ["https://www.google.com/search?q=", ""];
  BANGS.ddg = ["https://duckduckgo.com/?q=", ""];
  BANGS.gh = ["https://github.com/search?q=", "&type=repositories"];
  BANGS.w = ["https://en.wikipedia.org/wiki/Special:Search?search=", ""];
  BANGS.yt = ["https://www.youtube.com/results?search_query=", ""];
  BANGS.b = ["https://www.bing.com/search?q=", ""];
  BANGS.mdn = [
    "https://developer.mozilla.org/en-US/search?q=",
    "&topic=api&topic=js",
  ];
  return { BANGS };
});

import {
  type RedirectSettings,
  redirect,
  redirectRaw as redirectRawTuple,
  redirectUrl,
} from "./redirect";

function redirectRaw(rawQuery: string, settings: RedirectSettings): Response {
  return redirectRawTuple(rawQuery, settings)[0];
}

import type { UrlParts } from "./redirect";

const DEFAULT_URL: UrlParts = ["https://www.google.com/search?q=", ""];
const LUCKY_URL: UrlParts = ["https://www.google.com/search?btnI&q=", ""];

function splitUrl(url: string): UrlParts {
  const idx = url.indexOf("{}");
  return idx === -1
    ? [url, null]
    : [url.substring(0, idx), url.substring(idx + 2)];
}

function settings(overrides: Partial<RedirectSettings> = {}): RedirectSettings {
  return {
    defaultUrl: DEFAULT_URL,
    custom: Object.create(null),
    luckyUrl: LUCKY_URL,
    ...overrides,
  };
}

function loc(r: Response): string {
  return r.headers.get("Location")!;
}

describe("parse — bang syntax patterns", () => {
  test('"!g cats" → prefix bang with term', () => {
    const r = redirect("!g cats", settings());
    expect(r.status).toBe(302);
    expect(loc(r)).toBe("https://www.google.com/search?q=cats");
  });

  test('"!G CATS" → case-insensitive bang', () => {
    const r = redirect("!G CATS", settings());
    expect(r.status).toBe(302);
    expect(loc(r)).toBe("https://www.google.com/search?q=CATS");
  });

  test('"!g" → prefix bang, no term → google.com origin', () => {
    const r = redirect("!g", settings());
    expect(r.status).toBe(302);
    expect(loc(r)).toBe("https://www.google.com");
  });

  test('"g! cats" → prefix suffix-bang', () => {
    const r = redirect("g! cats", settings());
    expect(r.status).toBe(302);
    expect(loc(r)).toBe("https://www.google.com/search?q=cats");
  });

  test('"g!" → suffix-bang alone → google.com origin', () => {
    const r = redirect("g!", settings());
    expect(r.status).toBe(302);
    expect(loc(r)).toBe("https://www.google.com");
  });

  test('"cats !g" → trailing prefix-bang', () => {
    const r = redirect("cats !g", settings());
    expect(r.status).toBe(302);
    expect(loc(r)).toBe("https://www.google.com/search?q=cats");
  });

  test('"cats g!" → trailing suffix-bang', () => {
    const r = redirect("cats g!", settings());
    expect(r.status).toBe(302);
    expect(loc(r)).toBe("https://www.google.com/search?q=cats");
  });

  test('"\\cats" → backslash lucky', () => {
    const r = redirect("\\cats", settings());
    expect(r.status).toBe(302);
    expect(loc(r)).toBe("https://www.google.com/search?btnI&q=cats");
  });

  test('"! cats" → leading bare bang lucky', () => {
    const r = redirect("! cats", settings());
    expect(r.status).toBe(302);
    expect(loc(r)).toBe("https://www.google.com/search?btnI&q=cats");
  });

  test('"cats !" → trailing bare bang lucky', () => {
    const r = redirect("cats !", settings());
    expect(r.status).toBe(302);
    expect(loc(r)).toBe("https://www.google.com/search?btnI&q=cats");
  });

  test('"cats" → no bang → default URL', () => {
    const r = redirect("cats", settings());
    expect(r.status).toBe(302);
    expect(loc(r)).toBe("https://www.google.com/search?q=cats");
  });
});

describe("redirect — routing logic", () => {
  test('"!" alone → redirect to "/"', () => {
    const r = redirect("!", settings());
    expect(r.status).toBe(302);
    expect(loc(r)).toBe("/");
  });

  test("lucky + luckyUrl + term → lucky redirect", () => {
    const r = redirect("\\hello world", settings());
    expect(r.status).toBe(302);
    expect(loc(r)).toBe("https://www.google.com/search?btnI&q=hello%20world");
  });

  test("lucky without luckyUrl → falls through to default", () => {
    const r = redirect("\\cats", settings({ luckyUrl: null }));
    expect(r.status).toBe(302);
    expect(loc(r)).toBe("https://www.google.com/search?q=cats");
  });

  test("custom bang overrides built-in", () => {
    const r = redirect(
      "!g cats",
      settings({ custom: { g: splitUrl("https://custom.search/?q={}") } })
    );
    expect(r.status).toBe(302);
    expect(loc(r)).toBe("https://custom.search/?q=cats");
  });

  test('"!zzz cats" → unknown bang → default URL with full raw query', () => {
    const r = redirect("!zzz cats", settings());
    expect(r.status).toBe(302);
    expect(loc(r)).toBe("https://www.google.com/search?q=!zzz%20cats");
  });

  test("empty term → origin extraction via new URL().origin", () => {
    const r = redirect("!gh", settings());
    expect(r.status).toBe(302);
    expect(loc(r)).toBe("https://github.com");
  });

  test("empty term with unparseable URL → fallback to replace", () => {
    const r = redirect(
      "!g",
      settings({ custom: { g: splitUrl("not-a-url/{}") } })
    );
    expect(r.status).toBe(302);
    expect(loc(r)).toBe("not-a-url/");
  });
});

describe("encode — URL encoding", () => {
  test("slashes preserved (not %2F)", () => {
    const r = redirect("!g a/b/c", settings());
    expect(loc(r)).toBe("https://www.google.com/search?q=a/b/c");
  });

  test("spaces encoded as %20", () => {
    const r = redirect("!g hello world", settings());
    expect(loc(r)).toBe("https://www.google.com/search?q=hello%20world");
  });

  test("special chars (& = ?) encoded", () => {
    const r = redirect("!g a&b=c?d", settings());
    expect(loc(r)).toBe("https://www.google.com/search?q=a%26b%3Dc%3Fd");
  });
});

describe("redirectRaw — bang syntax patterns (+ as space)", () => {
  test('"!g+cats" → prefix bang with term', () => {
    const r = redirectRaw("!g+cats", settings());
    expect(r.status).toBe(302);
    expect(loc(r)).toBe("https://www.google.com/search?q=cats");
  });

  test('"!G+CATS" → case-insensitive bang', () => {
    const r = redirectRaw("!G+CATS", settings());
    expect(r.status).toBe(302);
    expect(loc(r)).toBe("https://www.google.com/search?q=CATS");
  });

  test('"!g" → prefix bang, no term → google.com origin', () => {
    const r = redirectRaw("!g", settings());
    expect(r.status).toBe(302);
    expect(loc(r)).toBe("https://www.google.com");
  });

  test('"g!+cats" → prefix suffix-bang', () => {
    const r = redirectRaw("g!+cats", settings());
    expect(r.status).toBe(302);
    expect(loc(r)).toBe("https://www.google.com/search?q=cats");
  });

  test('"g!" → suffix-bang alone → google.com origin', () => {
    const r = redirectRaw("g!", settings());
    expect(r.status).toBe(302);
    expect(loc(r)).toBe("https://www.google.com");
  });

  test('"cats+!g" → trailing prefix-bang', () => {
    const r = redirectRaw("cats+!g", settings());
    expect(r.status).toBe(302);
    expect(loc(r)).toBe("https://www.google.com/search?q=cats");
  });

  test('"cats+g!" → trailing suffix-bang', () => {
    const r = redirectRaw("cats+g!", settings());
    expect(r.status).toBe(302);
    expect(loc(r)).toBe("https://www.google.com/search?q=cats");
  });

  test('"\\cats" → backslash lucky', () => {
    const r = redirectRaw("\\cats", settings());
    expect(r.status).toBe(302);
    expect(loc(r)).toBe("https://www.google.com/search?btnI&q=cats");
  });

  test('"!+cats" → leading bare bang lucky', () => {
    const r = redirectRaw("!+cats", settings());
    expect(r.status).toBe(302);
    expect(loc(r)).toBe("https://www.google.com/search?btnI&q=cats");
  });

  test('"cats+!" → trailing bare bang lucky', () => {
    const r = redirectRaw("cats+!", settings());
    expect(r.status).toBe(302);
    expect(loc(r)).toBe("https://www.google.com/search?btnI&q=cats");
  });

  test('"cats" → no bang → default URL', () => {
    const r = redirectRaw("cats", settings());
    expect(r.status).toBe(302);
    expect(loc(r)).toBe("https://www.google.com/search?q=cats");
  });
});

describe("redirectRaw — bang syntax patterns (%20 as space)", () => {
  test('"!g%20cats" → prefix bang with term', () => {
    const r = redirectRaw("!g%20cats", settings());
    expect(r.status).toBe(302);
    expect(loc(r)).toBe("https://www.google.com/search?q=cats");
  });

  test('"g!%20cats" → prefix suffix-bang', () => {
    const r = redirectRaw("g!%20cats", settings());
    expect(r.status).toBe(302);
    expect(loc(r)).toBe("https://www.google.com/search?q=cats");
  });

  test('"cats%20!g" → trailing prefix-bang', () => {
    const r = redirectRaw("cats%20!g", settings());
    expect(r.status).toBe(302);
    expect(loc(r)).toBe("https://www.google.com/search?q=cats");
  });

  test('"cats%20g!" → trailing suffix-bang', () => {
    const r = redirectRaw("cats%20g!", settings());
    expect(r.status).toBe(302);
    expect(loc(r)).toBe("https://www.google.com/search?q=cats");
  });

  test('"!%20cats" → leading bare bang lucky', () => {
    const r = redirectRaw("!%20cats", settings());
    expect(r.status).toBe(302);
    expect(loc(r)).toBe("https://www.google.com/search?btnI&q=cats");
  });

  test('"cats%20!" → trailing bare bang lucky', () => {
    const r = redirectRaw("cats%20!", settings());
    expect(r.status).toBe(302);
    expect(loc(r)).toBe("https://www.google.com/search?btnI&q=cats");
  });
});

describe("redirectRaw — routing logic", () => {
  test('"!" alone → redirect to "/"', () => {
    const r = redirectRaw("!", settings());
    expect(r.status).toBe(302);
    expect(loc(r)).toBe("/");
  });

  test("empty string → redirect to /", () => {
    const r = redirectRaw("", settings());
    expect(r.status).toBe(302);
    expect(loc(r)).toBe("/");
  });

  test("only spaces → redirect to /", () => {
    const r = redirectRaw("+++", settings());
    expect(r.status).toBe(302);
    expect(loc(r)).toBe("/");
  });

  test("lucky + luckyUrl + term → lucky redirect", () => {
    const r = redirectRaw("\\hello+world", settings());
    expect(r.status).toBe(302);
    expect(loc(r)).toBe("https://www.google.com/search?btnI&q=hello%20world");
  });

  test("lucky without luckyUrl → falls through to default", () => {
    const r = redirectRaw("\\cats", settings({ luckyUrl: null }));
    expect(r.status).toBe(302);
    expect(loc(r)).toBe("https://www.google.com/search?q=cats");
  });

  test("custom bang overrides built-in", () => {
    const r = redirectRaw(
      "!g+cats",
      settings({ custom: { g: splitUrl("https://custom.search/?q={}") } })
    );
    expect(r.status).toBe(302);
    expect(loc(r)).toBe("https://custom.search/?q=cats");
  });

  test('"!zzz+cats" → unknown bang → default URL with full query', () => {
    const r = redirectRaw("!zzz+cats", settings());
    expect(r.status).toBe(302);
    expect(loc(r)).toBe("https://www.google.com/search?q=!zzz%20cats");
  });

  test("empty term → origin extraction via new URL().origin", () => {
    const r = redirectRaw("!gh", settings());
    expect(r.status).toBe(302);
    expect(loc(r)).toBe("https://github.com");
  });

  test("empty term with unparseable URL → fallback to replace", () => {
    const r = redirectRaw(
      "!g",
      settings({ custom: { g: splitUrl("not-a-url/{}") } })
    );
    expect(r.status).toBe(302);
    expect(loc(r)).toBe("not-a-url/");
  });
});

describe("redirectRaw — rawFixup encoding", () => {
  test("+ converted to %20 in term", () => {
    const r = redirectRaw("!g+hello+world", settings());
    expect(loc(r)).toBe("https://www.google.com/search?q=hello%20world");
  });

  test("%2F preserved as / in term", () => {
    const r = redirectRaw("!g+a%2Fb%2Fc", settings());
    expect(loc(r)).toBe("https://www.google.com/search?q=a/b/c");
  });

  test("%2f (lowercase) preserved as / in term", () => {
    const r = redirectRaw("!g+a%2fb", settings());
    expect(loc(r)).toBe("https://www.google.com/search?q=a/b");
  });

  test("special chars stay percent-encoded", () => {
    const r = redirectRaw("!g+a%26b%3Dc%3Fd", settings());
    expect(loc(r)).toBe("https://www.google.com/search?q=a%26b%3Dc%3Fd");
  });

  test("multi-byte encoded chars pass through", () => {
    const r = redirectRaw("!g+%E4%B8%AD%E6%96%87", settings());
    expect(loc(r)).toBe("https://www.google.com/search?q=%E4%B8%AD%E6%96%87");
  });
});

describe("redirectRaw — leading/trailing space trimming", () => {
  test("leading + trimmed", () => {
    const r = redirectRaw("+!g+cats", settings());
    expect(loc(r)).toBe("https://www.google.com/search?q=cats");
  });

  test("trailing + trimmed", () => {
    const r = redirectRaw("!g+cats+", settings());
    expect(loc(r)).toBe("https://www.google.com/search?q=cats");
  });

  test("leading %20 trimmed", () => {
    const r = redirectRaw("%20!g+cats", settings());
    expect(loc(r)).toBe("https://www.google.com/search?q=cats");
  });

  test("trailing %20 trimmed", () => {
    const r = redirectRaw("!g+cats%20", settings());
    expect(loc(r)).toBe("https://www.google.com/search?q=cats");
  });
});

describe("redirectRaw — %21 encoded bang", () => {
  test('"%21gh" → prefix bang → github.com', () => {
    const r = redirectRaw("%21gh", settings());
    expect(r.status).toBe(302);
    expect(loc(r)).toBe("https://github.com");
  });

  test('"%21g+cats" → prefix bang with term', () => {
    const r = redirectRaw("%21g+cats", settings());
    expect(r.status).toBe(302);
    expect(loc(r)).toBe("https://www.google.com/search?q=cats");
  });

  test('"g%21+cats" → prefix suffix-bang', () => {
    const r = redirectRaw("g%21+cats", settings());
    expect(r.status).toBe(302);
    expect(loc(r)).toBe("https://www.google.com/search?q=cats");
  });

  test('"cats+%21g" → trailing prefix-bang', () => {
    const r = redirectRaw("cats+%21g", settings());
    expect(r.status).toBe(302);
    expect(loc(r)).toBe("https://www.google.com/search?q=cats");
  });

  test('"cats+g%21" → trailing suffix-bang', () => {
    const r = redirectRaw("cats+g%21", settings());
    expect(r.status).toBe(302);
    expect(loc(r)).toBe("https://www.google.com/search?q=cats");
  });

  test('"%21+cats" → leading bare bang lucky', () => {
    const r = redirectRaw("%21+cats", settings());
    expect(r.status).toBe(302);
    expect(loc(r)).toBe("https://www.google.com/search?btnI&q=cats");
  });

  test('"cats+%21" → trailing bare bang lucky', () => {
    const r = redirectRaw("cats+%21", settings());
    expect(r.status).toBe(302);
    expect(loc(r)).toBe("https://www.google.com/search?btnI&q=cats");
  });

  test('"%21" alone → redirect to "/"', () => {
    const r = redirectRaw("%21", settings());
    expect(r.status).toBe(302);
    expect(loc(r)).toBe("/");
  });
});

describe("redirectRaw ↔ redirect cross-validation", () => {
  const queries: [string, string][] = [
    ["!g cats", "!g+cats"],
    ["!G CATS", "!G+CATS"],
    ["!g", "!g"],
    ["g! cats", "g!+cats"],
    ["g!", "g!"],
    ["cats !g", "cats+!g"],
    ["cats g!", "cats+g!"],
    ["\\cats", "\\cats"],
    ["! cats", "!+cats"],
    ["cats !", "cats+!"],
    ["cats", "cats"],
    ["!g hello world", "!g+hello+world"],
    ["!g a/b/c", "!g+a%2Fb%2Fc"],
    ["!", "!"],
    ["!gh", "!gh"],
    ["!gh", "%21gh"],
    ["!zzz cats", "!zzz+cats"],
  ];

  for (const [decoded, raw] of queries) {
    test(`"${decoded}" ↔ "${raw}" produce identical Location`, () => {
      const s = settings();
      expect(loc(redirectRaw(raw, s))).toBe(loc(redirect(decoded, s)));
    });
  }
});

describe("redirectUrl ↔ redirect parity", () => {
  const queries = [
    "!g cats",
    "!G CATS",
    "!g",
    "g! cats",
    "g!",
    "cats !g",
    "cats g!",
    "\\cats",
    "! cats",
    "cats !",
    "cats",
    "!g hello world",
    "!g a/b/c",
    "!",
    "!gh",
    "!zzz cats",
  ];

  for (const query of queries) {
    test(`"${query}" returns same Location as redirect()`, () => {
      const s = settings();
      expect(redirectUrl(query, s)).toBe(loc(redirect(query, s)));
    });
  }
});
