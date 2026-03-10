import {
  afterAll,
  beforeEach,
  describe,
  expect,
  mock,
  spyOn,
  test,
} from "bun:test";
import { type BuildNode, buildRadixTrie } from "./shared/trie";

interface TestBang {
  k: string;
  s: string;
  d: string;
  r: number;
}

interface FlatTrieFixture {
  EDGES: Int32Array;
  LABELS: string;
  NODES: Int32Array;
  ROOT: number;
  TERM_D_BLOB: string;
  TERM_D_OFF: Int32Array;
  TERM_K_BLOB: string;
  TERM_K_OFF: Int32Array;
  TERM_R: Int32Array;
  TERM_S_BLOB: string;
  TERM_S_OFF: Int32Array;
}

const NODE_EDGE_START = 0;
const NODE_EDGE_COUNT = 1;
const NODE_TERMINAL_INDEX = 2;
const NODE_MAX_RELEVANCE = 3;
const NODE_STRIDE = 4;

const EDGE_CHILD_INDEX = 2;
const EDGE_STRIDE = 3;

function buildTestTrie(bangs: TestBang[]): FlatTrieFixture {
  const root = buildRadixTrie(
    bangs,
    (b) => b.k,
    (b) => b.r
  );

  const nodes: number[] = [];
  const edges: number[] = [];
  let labels = "";
  const termK: string[] = [];
  const termS: string[] = [];
  const termD: string[] = [];
  const termR: number[] = [];

  function allocNode(): number {
    const idx = nodes.length / NODE_STRIDE;
    nodes.push(0, 0, -1, 0);
    return idx;
  }

  function visit(node: BuildNode<TestBang>): number {
    const idx = allocNode();
    const sorted = [...node.children.entries()].sort(
      (a, b) => b[1].maxRelevance - a[1].maxRelevance
    );
    const edgeStart = edges.length / EDGE_STRIDE;

    for (const [label] of sorted) {
      const labelStart = labels.length;
      labels += label;
      edges.push(labelStart, label.length, -1);
    }

    for (let i = 0; i < sorted.length; i++) {
      const [, child] = sorted[i];
      const childIdx = visit(child);
      edges[(edgeStart + i) * EDGE_STRIDE + EDGE_CHILD_INDEX] = childIdx;
    }

    let terminalIndex = -1;
    if (node.terminal) {
      const t = node.terminal;
      terminalIndex = termR.length;
      termK.push(t.k);
      termS.push(t.s);
      termD.push(t.d);
      termR.push(t.r);
    }

    const off = idx * NODE_STRIDE;
    nodes[off + NODE_EDGE_START] = edgeStart;
    nodes[off + NODE_EDGE_COUNT] = sorted.length;
    nodes[off + NODE_TERMINAL_INDEX] = terminalIndex;
    nodes[off + NODE_MAX_RELEVANCE] = node.maxRelevance;
    return idx;
  }

  const rootIdx = visit(root);
  if (rootIdx !== 0) {
    throw new Error(`Unexpected test trie root index ${rootIdx}`);
  }

  function packStrings(items: string[]): {
    blob: string;
    offsets: Int32Array;
  } {
    const parts = new Array<string>(items.length);
    const offsets = new Int32Array(items.length + 1);
    let cursor = 0;
    for (let i = 0; i < items.length; i++) {
      const value = items[i];
      parts[i] = value;
      cursor += value.length;
      offsets[i + 1] = cursor;
    }
    return { blob: parts.join(""), offsets };
  }

  const packedK = packStrings(termK);
  const packedS = packStrings(termS);
  const packedD = packStrings(termD);

  return {
    LABELS: labels,
    NODES: Int32Array.from(nodes),
    EDGES: Int32Array.from(edges),
    TERM_K_BLOB: packedK.blob,
    TERM_K_OFF: packedK.offsets,
    TERM_S_BLOB: packedS.blob,
    TERM_S_OFF: packedS.offsets,
    TERM_D_BLOB: packedD.blob,
    TERM_D_OFF: packedD.offsets,
    TERM_R: Int32Array.from(termR),
    ROOT: rootIdx,
  };
}

const TEST_BANGS: TestBang[] = [
  { k: "b", s: "Bing", d: "www.bing.com", r: 300 },
  { k: "brave", s: "Brave", d: "search.brave.com", r: 200 },
  { k: "ddg", s: "DuckDuckGo", d: "duckduckgo.com", r: 800 },
  { k: "g", s: "Google", d: "www.google.com", r: 1000 },
  { k: "gh", s: "GitHub", d: "github.com", r: 500 },
  { k: "ghi", s: "GitHub Issues", d: "github.com", r: 100 },
  { k: "ghp", s: "GitHub PRs", d: "github.com", r: 50 },
  { k: "mdn", s: "MDN", d: "developer.mozilla.org", r: 400 },
  { k: "w", s: "Wikipedia", d: "en.wikipedia.org", r: 900 },
  { k: "yt", s: "YouTube", d: "www.youtube.com", r: 700 },
];

const TEST_TRIE = buildTestTrie(TEST_BANGS);

mock.module("./generated/bangs-trie.js", () => TEST_TRIE);

import { readQueryParam, readTwoQueryParams } from "./shared/raw-query";
import {
  parseCookie,
  parseSettings,
  parseSettingsFromRawUrl,
  suggest,
} from "./suggest";

const fetchSpy = spyOn(globalThis, "fetch");

beforeEach(() => {
  fetchSpy.mockReset();
});

afterAll(() => {
  fetchSpy.mockRestore();
});

function req(cookie?: string): Request {
  const headers = new Headers();
  if (cookie) {
    headers.set("Cookie", cookie);
  }
  return new Request("http://localhost", { headers });
}

const defaultSettings = {
  provider: "default",
  trigger: "g",
  customUrl: null,
  frecent: {},
  custom: [],
};

describe("parseCookie", () => {
  test("no cookie → defaults", () => {
    const s = parseCookie(req());
    expect(s).toEqual({
      provider: "default",
      trigger: "g",
      customUrl: null,
      frecent: {},
      custom: [],
    });
  });

  test("all three fields parsed", () => {
    const s = parseCookie(req("suggest=google,ddg,https%3A%2F%2Fexample.com"));
    expect(s).toEqual({
      provider: "google",
      trigger: "ddg",
      customUrl: "https://example.com",
      frecent: {},
      custom: [],
    });
  });

  test("only provider and trigger, no customUrl", () => {
    const s = parseCookie(req("suggest=brave,g"));
    expect(s).toEqual({
      provider: "brave",
      trigger: "g",
      customUrl: null,
      frecent: {},
      custom: [],
    });
  });

  test("URL-encoded customUrl decoded correctly", () => {
    const s = parseCookie(
      req(
        "suggest=custom,g,https%3A%2F%2Fapi.example.com%2Fsuggest%3Fq%3D%7B%7D"
      )
    );
    expect(s.customUrl).toBe("https://api.example.com/suggest?q={}");
  });

  test("malformed customUrl encoding does not throw", () => {
    const s = parseCookie(req("suggest=custom,g,%E0%A4%A"));
    expect(s.customUrl).toBeNull();
    expect(s.provider).toBe("custom");
    expect(s.trigger).toBe("g");
  });

  test("suggest cookie extracted among other cookies", () => {
    const s = parseCookie(req("theme=dark; suggest=bing,b; lang=en"));
    expect(s).toEqual({
      provider: "bing",
      trigger: "b",
      customUrl: null,
      frecent: {},
      custom: [],
    });
  });

  test("empty cookie value → defaults for missing fields", () => {
    const s = parseCookie(req("suggest="));
    expect(s).toEqual({
      provider: "default",
      trigger: "g",
      customUrl: null,
      frecent: {},
      custom: [],
    });
  });

  test("cookie with frecency section ignored (sf cookie is sole source)", () => {
    const s = parseCookie(req("suggest=google,g,|gh:50.yt:30.w:12"));
    expect(s.frecent).toEqual({});
    expect(s.custom).toEqual([]);
  });

  test("cookie with frecency and custom sections — frecency ignored, custom works", () => {
    const s = parseCookie(
      req("suggest=google,g,|gh:50.yt:30|test8.mysite.proj")
    );
    expect(s.frecent).toEqual({});
    expect(s.custom).toEqual(["test8", "mysite", "proj"]);
  });

  test("backward compat: old cookie format without | parses identically", () => {
    const s = parseCookie(req("suggest=google,ddg,https%3A%2F%2Fexample.com"));
    expect(s.provider).toBe("google");
    expect(s.trigger).toBe("ddg");
    expect(s.customUrl).toBe("https://example.com");
    expect(s.frecent).toEqual({});
    expect(s.custom).toEqual([]);
  });

  test("empty frecency and custom sections", () => {
    const s = parseCookie(req("suggest=google,g,||"));
    expect(s.frecent).toEqual({});
    expect(s.custom).toEqual([]);
  });

  test("sf cookie is the sole source of frecency", () => {
    const s = parseCookie(req("suggest=google,g,|gh:10.yt:5; sf=w:50.b:30"));
    expect(s.frecent).toEqual({ w: 50, b: 30 });
    expect(s.provider).toBe("google");
    expect(s.trigger).toBe("g");
  });

  test("sf cookie with suggest= cookie together", () => {
    const s = parseCookie(
      req("sf=ddg:100.g:80; suggest=brave,b,|mdn:20|mysite")
    );
    expect(s.frecent).toEqual({ ddg: 100, g: 80 });
    expect(s.provider).toBe("brave");
    expect(s.trigger).toBe("b");
    expect(s.custom).toEqual(["mysite"]);
  });
});

describe("parseSettings", () => {
  test("sp query param overrides cookie provider", () => {
    const url = new URL("http://localhost/suggest?q=cats&sp=ddg");
    const r = req("suggest=google,g,");
    const s = parseSettings(url, r);
    expect(s.provider).toBe("ddg");
    expect(s.trigger).toBe("g");
  });

  test("no query params falls back to cookie", () => {
    const url = new URL("http://localhost/suggest?q=cats");
    const r = req("suggest=brave,b,");
    const s = parseSettings(url, r);
    expect(s.provider).toBe("brave");
    expect(s.trigger).toBe("b");
  });

  test("no query params and no cookie returns defaults", () => {
    const url = new URL("http://localhost/suggest?q=cats");
    const r = req();
    const s = parseSettings(url, r);
    expect(s).toEqual(defaultSettings);
  });

  test("sp does not affect other settings", () => {
    const url = new URL("http://localhost/suggest?q=cats&sp=bing");
    const r = req("suggest=google,ddg,; sf=w:10");
    const s = parseSettings(url, r);
    expect(s.provider).toBe("bing");
    expect(s.frecent).toEqual({ w: 10 });
    expect(s.trigger).toBe("ddg");
  });
});

describe("readQueryParam", () => {
  test("returns null when URL has no query string", () => {
    expect(readQueryParam("http://localhost/suggest", "q")).toBeNull();
  });

  test("finds query param in first, middle, and last position", () => {
    expect(readQueryParam("http://localhost/suggest?q=first&sp=ddg", "q")).toBe(
      "first"
    );
    expect(readQueryParam("http://localhost/suggest?a=1&q=mid&b=2", "q")).toBe(
      "mid"
    );
    expect(readQueryParam("http://localhost/suggest?sp=ddg&q=last", "q")).toBe(
      "last"
    );
  });

  test("decodes + as space", () => {
    expect(readQueryParam("http://localhost/suggest?q=hello+world", "q")).toBe(
      "hello world"
    );
  });

  test("decodes percent-encoded values", () => {
    expect(
      readQueryParam("http://localhost/suggest?q=%2Bcats%20dogs", "q")
    ).toBe("+cats dogs");
  });

  test("tolerates malformed percent-encoding like URLSearchParams", () => {
    expect(readQueryParam("http://localhost/suggest?q=%E0%A4%A", "q")).toBe(
      "�%A"
    );
    expect(readQueryParam("http://localhost/suggest?q=%ZZ", "q")).toBe("%ZZ");
  });

  test("returns empty string for key without value", () => {
    expect(readQueryParam("http://localhost/suggest?q", "q")).toBe("");
    expect(readQueryParam("http://localhost/suggest?q=&sp=ddg", "q")).toBe("");
  });

  test("returns first occurrence when repeated", () => {
    expect(readQueryParam("http://localhost/suggest?q=one&q=two", "q")).toBe(
      "one"
    );
  });

  test("ignores fragment after query", () => {
    expect(
      readQueryParam("http://localhost/suggest?q=alpha#q=beta&sp=ddg", "q")
    ).toBe("alpha");
  });
});

describe("readTwoQueryParams", () => {
  test("returns both values from one query string", () => {
    expect(
      readTwoQueryParams(
        "http://localhost/suggest?q=alpha&sp=ddg&x=1",
        "q",
        "sp"
      )
    ).toEqual(["alpha", "ddg"]);
  });

  test("returns empty string for valueless keys", () => {
    expect(
      readTwoQueryParams("http://localhost/suggest?q&sp=", "q", "sp")
    ).toEqual(["", ""]);
  });

  test("returns null for missing keys", () => {
    expect(
      readTwoQueryParams("http://localhost/suggest?a=1", "q", "sp")
    ).toEqual([null, null]);
  });

  test("uses first occurrence for repeated keys", () => {
    expect(
      readTwoQueryParams(
        "http://localhost/suggest?q=first&q=second&sp=ddg&sp=bing",
        "q",
        "sp"
      )
    ).toEqual(["first", "ddg"]);
  });
});

describe("parseSettingsFromRawUrl", () => {
  test("sp override applies without reading sp from URL", () => {
    const s = parseSettingsFromRawUrl(
      "http://localhost/suggest?q=cats",
      req("suggest=google,g,"),
      "bing"
    );
    expect(s.provider).toBe("bing");
    expect(s.trigger).toBe("g");
  });

  test("sp query param overrides cookie provider", () => {
    const s = parseSettingsFromRawUrl(
      "http://localhost/suggest?q=cats&sp=ddg",
      req("suggest=google,g,")
    );
    expect(s.provider).toBe("ddg");
    expect(s.trigger).toBe("g");
  });

  test("no sp query param falls back to cookie provider", () => {
    const s = parseSettingsFromRawUrl(
      "http://localhost/suggest?q=cats",
      req("suggest=brave,b,")
    );
    expect(s.provider).toBe("brave");
    expect(s.trigger).toBe("b");
  });

  test("malformed sp encoding is handled without throwing", () => {
    const s = parseSettingsFromRawUrl(
      "http://localhost/suggest?q=cats&sp=%E0%A4%A",
      req("suggest=google,g,")
    );
    expect(s.provider).toBe("�%A");
  });
});

describe("bang suggestions — via suggest()", () => {
  test('"!gh" → suggestions [gh, ghi, ghp] sorted by relevance desc', async () => {
    const r = await suggest("!gh", defaultSettings);
    const [query, completions] = await r.json();
    expect(query).toBe("!gh");
    expect(completions).toEqual(["!gh", "!ghi", "!ghp"]);
  });

  test('"!gh" completions formatted as ["!gh", "!ghi", "!ghp"]', async () => {
    const r = await suggest("!gh", defaultSettings);
    const [, completions] = await r.json();
    expect(completions).toEqual(["!gh", "!ghi", "!ghp"]);
  });

  test('"!gh" descriptions in OpenSearch positions and google:suggestdetail', async () => {
    const r = await suggest("!gh", defaultSettings);
    const data = await r.json();
    expect(data[2]).toEqual([
      "GitHub \u2014 github.com",
      "GitHub Issues \u2014 github.com",
      "GitHub PRs \u2014 github.com",
    ]);
    expect(data[3]).toEqual([
      "https://github.com",
      "https://github.com",
      "https://github.com",
    ]);
    expect(data[4]["google:suggestdetail"]).toEqual([
      { a: "GitHub \u2014 github.com", i: "https://github.com/favicon.ico" },
      {
        a: "GitHub Issues \u2014 github.com",
        i: "https://github.com/favicon.ico",
      },
      {
        a: "GitHub PRs \u2014 github.com",
        i: "https://github.com/favicon.ico",
      },
    ]);
  });

  test("google:suggestdetail length matches completions length", async () => {
    const r = await suggest("!g", defaultSettings);
    const data = await r.json();
    expect(data[4]["google:suggestdetail"]).toHaveLength(data[1].length);
  });

  test('"cats !gh" → trailing partial, prefix "cats " in completions', async () => {
    const r = await suggest("cats !gh", defaultSettings);
    const [query, completions] = await r.json();
    expect(query).toBe("cats !gh");
    expect(completions).toEqual(["cats !gh", "cats !ghi", "cats !ghp"]);
  });

  test('"!" → matches all keys, returns max 8', async () => {
    const r = await suggest("!", defaultSettings);
    const [, completions] = await r.json();
    expect(completions).toHaveLength(8);
  });

  test('"!zzz" → no matches, empty completions', async () => {
    const r = await suggest("!zzz", defaultSettings);
    const [, completions] = await r.json();
    expect(completions).toEqual([]);
  });

  test('"!g" → exact match included (g is a prefix of gh/ghi/ghp too)', async () => {
    const r = await suggest("!g", defaultSettings);
    const [, completions] = await r.json();
    expect(completions).toContain("!g");
    expect(completions).toContain("!gh");
    expect(completions).toContain("!ghi");
    expect(completions).toContain("!ghp");
  });
});

describe("frecency boosts", () => {
  test("frecency boost changes result order", async () => {
    // Without frecency, "!" returns top 8 by relevance:
    // g(1000), w(900), ddg(800), yt(700), gh(500), mdn(400), b(300), brave(200)
    // With frecency boost on "ghp" (count=200 → +2000), ghp(50+2000=2050) should be #1
    const settings = {
      ...defaultSettings,
      frecent: { ghp: 200 },
    };
    const r = await suggest("!", settings);
    const [, completions] = await r.json();
    expect(completions[0]).toBe("!ghp");
  });

  test("frecency boost capped at 2000", async () => {
    // ghp has r=50. With count=9999, boost = min(9999*10, 2000) = 2000. Score = 2050.
    // g has r=1000. Without boost, score = 1000.
    // ghp should be ahead of g.
    const settings = {
      ...defaultSettings,
      frecent: { ghp: 9999 },
    };
    const r = await suggest("!", settings);
    const [, completions] = await r.json();
    expect(completions[0]).toBe("!ghp");
  });

  test("custom bang triggers appear in suggestions", async () => {
    const settings = {
      ...defaultSettings,
      custom: ["ghtest"],
    };
    const r = await suggest("!gh", settings);
    const [, completions] = await r.json();
    expect(completions).toContain("!ghtest");
  });

  test("custom bang with frecency boost ranks higher", async () => {
    const settings = {
      ...defaultSettings,
      custom: ["ghtest"],
      frecent: { ghtest: 200 },
    };
    const r = await suggest("!gh", settings);
    const [, completions] = await r.json();
    // ghtest: 0 + min(200*10, 2000) = 2000
    // gh: 500, ghi: 100, ghp: 50
    expect(completions[0]).toBe("!ghtest");
  });

  test("custom bang with no frecency has base score 0", async () => {
    const settings = {
      ...defaultSettings,
      custom: ["ghtest"],
    };
    const r = await suggest("!gh", settings);
    const [, completions] = await r.json();
    // ghtest: score 0, should be below gh(500), ghi(100), ghp(50)
    expect(completions).toEqual(["!gh", "!ghi", "!ghp", "!ghtest"]);
  });

  test("custom bang has empty suggestdetail entry", async () => {
    const settings = {
      ...defaultSettings,
      custom: ["ghtest"],
    };
    const r = await suggest("!ghtest", settings);
    const data = await r.json();
    expect(data[1]).toEqual(["!ghtest"]);
    expect(data[2]).toEqual([""]);
    expect(data[3]).toEqual([""]);
    expect(data[4]["google:suggestdetail"]).toEqual([{}]);
  });

  test("empty frecency and custom don't affect results", async () => {
    const r1 = await suggest("!gh", defaultSettings);
    const r2 = await suggest("!gh", {
      ...defaultSettings,
      frecent: {},
      custom: [],
    });
    expect(await r1.json()).toEqual(await r2.json());
  });
});

describe("provider proxying — via suggest()", () => {
  test("provider=google → fetches google suggest URL", async () => {
    fetchSpy.mockResolvedValueOnce(Response.json(["cats", ["cats and dogs"]]));
    const r = await suggest("cats", {
      ...defaultSettings,
      provider: "google",
    });
    expect(fetchSpy).toHaveBeenCalledWith(
      "https://www.google.com/complete/search?client=firefox&channel=fen&q=cats"
    );
    expect(r.headers.get("Content-Type")).toBe("application/json");
  });

  test("provider=ddg → fetches duckduckgo suggest URL", async () => {
    fetchSpy.mockResolvedValueOnce(Response.json(["cats", []]));
    await suggest("cats", { ...defaultSettings, provider: "ddg" });
    expect(fetchSpy).toHaveBeenCalledWith(
      "https://duckduckgo.com/ac/?q=cats&type=list"
    );
  });

  test("provider=bing → fetches bing suggest URL", async () => {
    fetchSpy.mockResolvedValueOnce(Response.json(["cats", []]));
    await suggest("cats", { ...defaultSettings, provider: "bing" });
    expect(fetchSpy).toHaveBeenCalledWith(
      "https://www.bing.com/osjson.aspx?query=cats"
    );
  });

  test("provider=brave → fetches brave suggest URL", async () => {
    fetchSpy.mockResolvedValueOnce(Response.json(["cats", []]));
    await suggest("cats", { ...defaultSettings, provider: "brave" });
    expect(fetchSpy).toHaveBeenCalledWith(
      "https://search.brave.com/api/suggest?q=cats&rich=false"
    );
  });

  test("provider=yahoo → fetches yahoo suggest URL", async () => {
    fetchSpy.mockResolvedValueOnce(Response.json(["cats", []]));
    await suggest("cats", { ...defaultSettings, provider: "yahoo" });
    expect(fetchSpy).toHaveBeenCalledWith(
      "https://ff.search.yahoo.com/gossip?output=fxjson&command=cats"
    );
  });

  test("provider=ecosia → fetches ecosia suggest URL", async () => {
    fetchSpy.mockResolvedValueOnce(Response.json(["cats", []]));
    await suggest("cats", { ...defaultSettings, provider: "ecosia" });
    expect(fetchSpy).toHaveBeenCalledWith(
      "https://ac.ecosia.org/autocomplete?q=cats&type=list"
    );
  });

  test("provider=kagi → fetches kagi suggest URL", async () => {
    fetchSpy.mockResolvedValueOnce(Response.json(["cats", []]));
    await suggest("cats", { ...defaultSettings, provider: "kagi" });
    expect(fetchSpy).toHaveBeenCalledWith(
      "https://kagi.com/api/autosuggest?q=cats"
    );
  });

  test("provider=yandex → fetches yandex suggest URL", async () => {
    fetchSpy.mockResolvedValueOnce(Response.json(["cats", []]));
    await suggest("cats", { ...defaultSettings, provider: "yandex" });
    expect(fetchSpy).toHaveBeenCalledWith(
      "https://suggest.yandex.com/suggest-ff.cgi?part=cats"
    );
  });

  test("provider=baidu → fetches baidu suggest URL", async () => {
    fetchSpy.mockResolvedValueOnce(Response.json(["cats", []]));
    await suggest("cats", { ...defaultSettings, provider: "baidu" });
    expect(fetchSpy).toHaveBeenCalledWith(
      "https://suggestion.baidu.com/su?wd=cats&action=opensearch"
    );
  });

  test("provider=none → empty response, no fetch", async () => {
    const r = await suggest("cats", { ...defaultSettings, provider: "none" });
    expect(fetchSpy).not.toHaveBeenCalled();
    const [query, completions] = await r.json();
    expect(query).toBe("cats");
    expect(completions).toEqual([]);
  });

  test("provider=default + trigger=g → resolves to google", async () => {
    fetchSpy.mockResolvedValueOnce(Response.json(["cats", []]));
    await suggest("cats", defaultSettings);
    expect(fetchSpy).toHaveBeenCalledWith(
      "https://www.google.com/complete/search?client=firefox&channel=fen&q=cats"
    );
  });

  test("provider=default + trigger=ddg → resolves to duckduckgo", async () => {
    fetchSpy.mockResolvedValueOnce(Response.json(["cats", []]));
    await suggest("cats", { ...defaultSettings, trigger: "ddg" });
    expect(fetchSpy).toHaveBeenCalledWith(
      "https://duckduckgo.com/ac/?q=cats&type=list"
    );
  });

  test("provider=default + trigger=brave → resolves to brave", async () => {
    fetchSpy.mockResolvedValueOnce(Response.json(["cats", []]));
    await suggest("cats", { ...defaultSettings, trigger: "brave" });
    expect(fetchSpy).toHaveBeenCalledWith(
      "https://search.brave.com/api/suggest?q=cats&rich=false"
    );
  });

  test("provider=default + trigger=yahoo → resolves to yahoo", async () => {
    fetchSpy.mockResolvedValueOnce(Response.json(["cats", []]));
    await suggest("cats", { ...defaultSettings, trigger: "yahoo" });
    expect(fetchSpy).toHaveBeenCalledWith(
      "https://ff.search.yahoo.com/gossip?output=fxjson&command=cats"
    );
  });

  test("provider=default + trigger=y → resolves to yahoo", async () => {
    fetchSpy.mockResolvedValueOnce(Response.json(["cats", []]));
    await suggest("cats", { ...defaultSettings, trigger: "y" });
    expect(fetchSpy).toHaveBeenCalledWith(
      "https://ff.search.yahoo.com/gossip?output=fxjson&command=cats"
    );
  });

  test("provider=default + trigger=ecosia → resolves to ecosia", async () => {
    fetchSpy.mockResolvedValueOnce(Response.json(["cats", []]));
    await suggest("cats", { ...defaultSettings, trigger: "ecosia" });
    expect(fetchSpy).toHaveBeenCalledWith(
      "https://ac.ecosia.org/autocomplete?q=cats&type=list"
    );
  });

  test("provider=default + trigger=kagi → resolves to kagi", async () => {
    fetchSpy.mockResolvedValueOnce(Response.json(["cats", []]));
    await suggest("cats", { ...defaultSettings, trigger: "kagi" });
    expect(fetchSpy).toHaveBeenCalledWith(
      "https://kagi.com/api/autosuggest?q=cats"
    );
  });

  test("provider=default + trigger=yandex → resolves to yandex", async () => {
    fetchSpy.mockResolvedValueOnce(Response.json(["cats", []]));
    await suggest("cats", { ...defaultSettings, trigger: "yandex" });
    expect(fetchSpy).toHaveBeenCalledWith(
      "https://suggest.yandex.com/suggest-ff.cgi?part=cats"
    );
  });

  test("provider=default + trigger=baidu → resolves to baidu", async () => {
    fetchSpy.mockResolvedValueOnce(Response.json(["cats", []]));
    await suggest("cats", { ...defaultSettings, trigger: "baidu" });
    expect(fetchSpy).toHaveBeenCalledWith(
      "https://suggestion.baidu.com/su?wd=cats&action=opensearch"
    );
  });

  test("provider=default + unknown trigger → empty", async () => {
    const r = await suggest("cats", { ...defaultSettings, trigger: "xyz" });
    expect(fetchSpy).not.toHaveBeenCalled();
    const [, completions] = await r.json();
    expect(completions).toEqual([]);
  });

  test("provider=custom + customUrl → fetches customUrl", async () => {
    fetchSpy.mockResolvedValueOnce(Response.json(["cats", ["result"]]));
    await suggest("cats", {
      ...defaultSettings,
      provider: "custom",
      customUrl: "https://my-api.com/suggest?q={}",
    });
    expect(fetchSpy).toHaveBeenCalledWith("https://my-api.com/suggest?q=cats");
  });

  test("provider=custom + null customUrl → empty", async () => {
    const r = await suggest("cats", {
      ...defaultSettings,
      provider: "custom",
      customUrl: null,
    });
    expect(fetchSpy).not.toHaveBeenCalled();
    const [, completions] = await r.json();
    expect(completions).toEqual([]);
  });

  test("fetch failure → empty response", async () => {
    fetchSpy.mockRejectedValueOnce(new Error("Network error"));
    const r = await suggest("cats", {
      ...defaultSettings,
      provider: "google",
    });
    const [query, completions] = await r.json();
    expect(query).toBe("cats");
    expect(completions).toEqual([]);
  });
});
