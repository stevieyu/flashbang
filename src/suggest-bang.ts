import {
  EDGES,
  LABELS,
  NODES,
  ROOT,
  TERM_D,
  TERM_K,
  TERM_R,
  TERM_S,
} from "./generated/bangs-trie.js";
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
  score: number;
}

const NODE_EDGE_START = 0;
const NODE_EDGE_COUNT = 1;
const NODE_TERMINAL_INDEX = 2;
const NODE_MAX_RELEVANCE = 3;
const NODE_STRIDE = 4;

const EDGE_LABEL_START = 0;
const EDGE_LABEL_LENGTH = 1;
const EDGE_CHILD_INDEX = 2;
const EDGE_STRIDE = 3;

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

function walkPrefix(partial: string): [number, string] | null {
  let node = ROOT;
  let pos = 0;

  while (pos < partial.length) {
    let found = false;
    const nodeOff = node * NODE_STRIDE;
    const edgeStart = NODES[nodeOff + NODE_EDGE_START];
    const edgeCount = NODES[nodeOff + NODE_EDGE_COUNT];

    for (let i = 0; i < edgeCount; i++) {
      const edgeOff = (edgeStart + i) * EDGE_STRIDE;
      const edgeLabelStart = EDGES[edgeOff + EDGE_LABEL_START];
      const edgeLabelLen = EDGES[edgeOff + EDGE_LABEL_LENGTH];
      const child = EDGES[edgeOff + EDGE_CHILD_INDEX];
      const limit = Math.min(partial.length - pos, edgeLabelLen);
      let match = 0;
      while (
        match < limit &&
        partial.charCodeAt(pos + match) ===
          LABELS.charCodeAt(edgeLabelStart + match)
      ) {
        match++;
      }

      if (match === 0) {
        continue;
      }

      if (match < edgeLabelLen) {
        if (match < partial.length - pos) {
          return null;
        }
        return [
          child,
          LABELS.substring(
            edgeLabelStart + match,
            edgeLabelStart + edgeLabelLen
          ),
        ];
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
  subtree: number,
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

  function dfs(node: number): void {
    const nodeOff = node * NODE_STRIDE;
    const terminalIndex = NODES[nodeOff + NODE_TERMINAL_INDEX];
    if (terminalIndex >= 0) {
      const trigger = TERM_K[terminalIndex];
      const score = effectiveScore(TERM_R[terminalIndex], frecent, trigger);
      if (results.length < TOP_K || score > threshold) {
        addCandidate({
          trigger,
          name: TERM_S[terminalIndex],
          domain: TERM_D[terminalIndex],
          score,
        });
      }
    }

    const edgeStart = NODES[nodeOff + NODE_EDGE_START];
    const edgeCount = NODES[nodeOff + NODE_EDGE_COUNT];
    for (let i = 0; i < edgeCount; i++) {
      const edgeOff = (edgeStart + i) * EDGE_STRIDE;
      const child = EDGES[edgeOff + EDGE_CHILD_INDEX];
      const childMaxRelevance = NODES[child * NODE_STRIDE + NODE_MAX_RELEVANCE];
      if (
        results.length >= TOP_K &&
        childMaxRelevance + FRECENCY_BOOST_CAP <= threshold
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

function responseFromCandidates(
  query: string,
  prefix: string,
  candidates: Candidate[]
): Response {
  const len = candidates.length;
  const completions = new Array<string>(len);
  const descriptions = new Array<string>(len);
  const urls = new Array<string>(len);
  const details = new Array<Record<string, string>>(len);

  for (let i = 0; i < len; i++) {
    const c = candidates[i];
    completions[i] = `${prefix}!${c.trigger}`;
    if (c.domain) {
      const label = `${c.name} \u2014 ${c.domain}`;
      const base = `https://${c.domain}`;
      descriptions[i] = label;
      urls[i] = base;
      details[i] = { a: label, i: `${base}/favicon.ico` };
    } else {
      descriptions[i] = "";
      urls[i] = "";
      details[i] = {};
    }
  }

  return new Response(
    JSON.stringify([
      query,
      completions,
      descriptions,
      urls,
      { "google:suggestdetail": details },
    ]),
    { headers: JSON_HEADERS }
  );
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
    if (customMatches.length > TOP_K) {
      customMatches.length = TOP_K;
    }
    return responseFromCandidates(query, prefix, customMatches);
  }

  const [subtree] = result;
  const candidates = topK(subtree, frecent, customMatches);
  return responseFromCandidates(query, prefix, candidates);
}
