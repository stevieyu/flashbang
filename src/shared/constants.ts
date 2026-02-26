export const TOP_K = 8;
export const MAX_FRECENCY_ENTRIES = 64;
export const FRECENCY_BOOST_MULTIPLIER = 10;
export const FRECENCY_BOOST_CAP = 2000;

export const DEFAULT_URL = "https://www.google.com/search?q={}";

export const LUCKY_URLS: Record<string, string> = {
  g: "https://www.google.com/search?q={}&btnI=1",
  ddg: "https://duckduckgo.com/?q=\\{}",
  kagi: "https://kagi.com/search?q=\\{}",
};
export const DEFAULT_LUCKY_URL = "https://duckduckgo.com/?q=\\{}";

export const SUGGEST_URLS: Record<string, string> = {
  google:
    "https://suggestqueries.google.com/complete/search?client=firefox&q={}",
  ddg: "https://duckduckgo.com/ac/?q={}&type=list",
  bing: "https://www.bing.com/osjson.aspx?query={}",
  brave: "https://search.brave.com/api/suggest?q={}&rich=false",
  yahoo: "https://ff.search.yahoo.com/gossip?output=fxjson&command={}",
  ecosia: "https://ac.ecosia.org/autocomplete?q={}&type=list",
  kagi: "https://kagi.com/api/autosuggest?q={}",
  yandex: "https://suggest.yandex.com/suggest-ff.cgi?part={}",
  baidu: "https://suggestion.baidu.com/su?wd={}&action=opensearch",
};
