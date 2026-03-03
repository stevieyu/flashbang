import { TRIE, type TrieNode } from "./generated/bangs-trie.js";
import {
  FRECENCY_BOOST_CAP,
  FRECENCY_BOOST_MULTIPLIER,
  TOP_K,
} from "./shared/constants";

const JSON_HEADERS = { "Content-Type": "application/json" };

interface Candidate {
  trigger: string;
  name: string;
  domain: string;
  url: string;
  score: number;
}

function effectiveScore(
  relevance: number,
  frecent: Record<string, number>,
  trigger: string
): number {
  const count = frecent[trigger];
  if (!count) {
    return relevance;
  }
  return (
    relevance + Math.min(count * FRECENCY_BOOST_MULTIPLIER, FRECENCY_BOOST_CAP)
  );
}

function walkPrefix(partial: string): [TrieNode, string] | null {
  let node: TrieNode = TRIE;
  let pos = 0;

  while (pos < partial.length) {
    let found = false;
    for (const [edge, child] of node.c) {
      const limit = Math.min(partial.length - pos, edge.length);
      let match = 0;
      while (
        match < limit &&
        partial.charCodeAt(pos + match) === edge.charCodeAt(match)
      ) {
        match++;
      }

      if (match === 0) {
        continue;
      }

      if (match < edge.length) {
        if (match < partial.length - pos) {
          return null;
        }
        return [child, edge.substring(match)];
      }

      node = child;
      pos += match;
      found = true;
      break;
    }

    if (!found) {
      return null;
    }
  }

  return [node, ""];
}

// DFS with max-relevance pruning. Children are pre-sorted by m descending.
function topK(
  subtree: TrieNode,
  frecent: Record<string, number>,
  customMatches: Candidate[]
): Candidate[] {
  const results: Candidate[] = [];
  let minIdx = -1;
  let threshold = -1;

  function findMin(): void {
    minIdx = 0;
    for (let i = 1; i < TOP_K; i++) {
      if (results[i].score < results[minIdx].score) {
        minIdx = i;
      }
    }
    threshold = results[minIdx].score;
  }

  function addCandidate(c: Candidate): void {
    if (results.length < TOP_K) {
      results.push(c);
      if (results.length === TOP_K) {
        findMin();
      }
    } else if (c.score > threshold) {
      results[minIdx] = c;
      findMin();
    }
  }

  for (const c of customMatches) {
    addCandidate(c);
  }

  function dfs(node: TrieNode): void {
    if (node.t) {
      const score = effectiveScore(node.t.r, frecent, node.t.k);
      if (results.length < TOP_K || score > threshold) {
        addCandidate({
          trigger: node.t.k,
          name: node.t.s,
          domain: node.t.d,
          url: node.t.u,
          score,
        });
      }
    }

    for (const [, child] of node.c) {
      if (
        results.length >= TOP_K &&
        child.m + FRECENCY_BOOST_CAP <= threshold
      ) {
        continue;
      }
      dfs(child);
    }
  }

  dfs(subtree);
  results.sort((a, b) => b.score - a.score);
  return results;
}

export function bangSuggestions(
  query: string,
  prefix: string,
  partial: string,
  frecent: Record<string, number>,
  custom: string[]
): Response {
  const result = walkPrefix(partial);

  const customMatches: Candidate[] = [];
  for (const trigger of custom) {
    if (trigger.startsWith(partial)) {
      customMatches.push({
        trigger,
        name: "",
        domain: "",
        url: "",
        score: effectiveScore(0, frecent, trigger),
      });
    }
  }

  if (!result) {
    if (customMatches.length === 0) {
      return new Response(JSON.stringify([query, []]), {
        headers: JSON_HEADERS,
      });
    }
    customMatches.sort((a, b) => b.score - a.score);
    const top = customMatches.slice(0, TOP_K);
    return new Response(
      JSON.stringify([
        query,
        top.map((c) => `${prefix}!${c.trigger}`),
        top.map(() => ""),
        top.map(() => ""),
        {
          "google:suggestdetail": top.map(() => ({})),
        },
      ]),
      { headers: JSON_HEADERS }
    );
  }

  const [subtree] = result;
  const candidates = topK(subtree, frecent, customMatches);

  const completions: string[] = [];
  const descriptions: string[] = [];
  const urls: string[] = [];

  for (const c of candidates) {
    completions.push(`${prefix}!${c.trigger}`);
    if (c.url) {
      descriptions.push(`${c.name} \u2014 ${c.domain}`);
      const protoEnd = c.url.indexOf("://");
      if (protoEnd === -1) {
        urls.push(c.url);
      } else {
        const pathStart = c.url.indexOf("/", protoEnd + 3);
        urls.push(pathStart === -1 ? c.url : c.url.substring(0, pathStart));
      }
    } else {
      descriptions.push("");
      urls.push("");
    }
  }

  return new Response(
    JSON.stringify([
      query,
      completions,
      descriptions,
      urls,
      {
        "google:suggestdetail": candidates.map((c) =>
          c.url
            ? {
                a: `${c.name} \u2014 ${c.domain}`,
                i: `https://${c.domain}/favicon.ico`,
              }
            : {}
        ),
      },
    ]),
    { headers: JSON_HEADERS }
  );
}
