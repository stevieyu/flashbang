import {
  afterAll,
  beforeEach,
  describe,
  expect,
  mock,
  spyOn,
  test,
} from "bun:test";

// Build a mini trie from test data
interface TrieNode {
  c: [string, TrieNode][];
  m: number;
  t: { k: string; s: string; d: string; u: string; r: number } | null;
}

interface TestBang {
  k: string;
  s: string;
  d: string;
  u: string;
  r: number;
}

function buildTestTrie(bangs: TestBang[]): TrieNode {
  interface BuildNode {
    children: Map<string, BuildNode>;
    maxRelevance: number;
    terminal: TestBang | null;
  }

  const root: BuildNode = {
    children: new Map(),
    maxRelevance: 0,
    terminal: null,
  };

  for (const bang of bangs) {
    let node = root;
    let key = bang.k;
    let created = false;

    while (key.length > 0) {
      let found = false;
      for (const [edge, child] of node.children) {
        let common = 0;
        const limit = Math.min(key.length, edge.length);
        while (
          common < limit &&
          key.charCodeAt(common) === edge.charCodeAt(common)
        ) {
          common++;
        }
        if (common === 0) {
          continue;
        }

        if (common === edge.length) {
          node = child;
          key = key.substring(common);
          found = true;
          break;
        }

        const splitNode: BuildNode = {
          children: new Map(),
          maxRelevance: 0,
          terminal: null,
        };
        node.children.delete(edge);
        node.children.set(edge.substring(0, common), splitNode);
        splitNode.children.set(edge.substring(common), child);
        node = splitNode;
        key = key.substring(common);
        found = true;
        break;
      }

      if (!found) {
        const leaf: BuildNode = {
          children: new Map(),
          maxRelevance: bang.r,
          terminal: bang,
        };
        node.children.set(key, leaf);
        created = true;
        break;
      }
    }

    if (!created) {
      node.terminal = bang;
    }
  }

  function computeMax(node: BuildNode): number {
    let max = node.terminal ? node.terminal.r : 0;
    for (const child of node.children.values()) {
      max = Math.max(max, computeMax(child));
    }
    node.maxRelevance = max;
    return max;
  }
  computeMax(root);

  function serialize(node: BuildNode): TrieNode {
    const sorted = [...node.children.entries()].sort(
      (a, b) => b[1].maxRelevance - a[1].maxRelevance
    );
    return {
      c: sorted.map(([edge, child]) => [edge, serialize(child)]),
      m: node.maxRelevance,
      t: node.terminal,
    };
  }

  return serialize(root);
}

const TEST_BANGS: TestBang[] = [
  {
    k: "b",
    s: "Bing",
    d: "www.bing.com",
    u: "https://www.bing.com/search?q={}",
    r: 300,
  },
  {
    k: "brave",
    s: "Brave",
    d: "search.brave.com",
    u: "https://search.brave.com/search?q={}",
    r: 200,
  },
  {
    k: "ddg",
    s: "DuckDuckGo",
    d: "duckduckgo.com",
    u: "https://duckduckgo.com/?q={}",
    r: 800,
  },
  {
    k: "g",
    s: "Google",
    d: "www.google.com",
    u: "https://www.google.com/search?q={}",
    r: 1000,
  },
  {
    k: "gh",
    s: "GitHub",
    d: "github.com",
    u: "https://github.com/search?q={}",
    r: 500,
  },
  {
    k: "ghi",
    s: "GitHub Issues",
    d: "github.com",
    u: "https://github.com/search?q={}&type=issues",
    r: 100,
  },
  {
    k: "ghp",
    s: "GitHub PRs",
    d: "github.com",
    u: "https://github.com/search?q={}&type=pullrequests",
    r: 50,
  },
  {
    k: "mdn",
    s: "MDN",
    d: "developer.mozilla.org",
    u: "https://developer.mozilla.org/en-US/search?q={}",
    r: 400,
  },
  {
    k: "w",
    s: "Wikipedia",
    d: "en.wikipedia.org",
    u: "https://en.wikipedia.org/wiki/Special:Search?search={}",
    r: 900,
  },
  {
    k: "yt",
    s: "YouTube",
    d: "www.youtube.com",
    u: "https://www.youtube.com/results?search_query={}",
    r: 700,
  },
];

const TEST_TRIE = buildTestTrie(TEST_BANGS);

mock.module("./generated/bangs-trie.js", () => ({
  TRIE: TEST_TRIE,
}));

import { parseCookie, suggest } from "./suggest";

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

  test("cookie with frecency section", () => {
    const s = parseCookie(req("suggest=google,g,|gh:50.yt:30.w:12"));
    expect(s.frecent).toEqual({ gh: 50, yt: 30, w: 12 });
    expect(s.custom).toEqual([]);
  });

  test("cookie with frecency and custom sections", () => {
    const s = parseCookie(
      req("suggest=google,g,|gh:50.yt:30|test8.mysite.proj")
    );
    expect(s.frecent).toEqual({ gh: 50, yt: 30 });
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

  test('"!gh" descriptions are "name — domain" from BANGS', async () => {
    const r = await suggest("!gh", defaultSettings);
    const data = await r.json();
    expect(data[2]).toEqual([
      "GitHub — github.com",
      "GitHub Issues — github.com",
      "GitHub PRs — github.com",
    ]);
    expect(data[3]).toEqual([
      "https://github.com",
      "https://github.com",
      "https://github.com",
    ]);
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

  test("custom bang has empty description and URL", async () => {
    const settings = {
      ...defaultSettings,
      custom: ["ghtest"],
    };
    const r = await suggest("!ghtest", settings);
    const data = await r.json();
    expect(data[1]).toEqual(["!ghtest"]);
    expect(data[2]).toEqual([""]);
    expect(data[3]).toEqual([""]);
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
      "https://suggestqueries.google.com/complete/search?client=firefox&q=cats"
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
      "https://suggestqueries.google.com/complete/search?client=firefox&q=cats"
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
