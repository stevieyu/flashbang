import {
  EDGES,
  LABELS,
  NODES,
  ROOT,
  TERM_D_BLOB,
  TERM_D_OFF,
  TERM_K_BLOB,
  TERM_K_OFF,
  TERM_R,
  TERM_S_BLOB,
  TERM_S_OFF,
} from "./generated/bangs-trie.js";
import {
  FRECENCY_BOOST_CAP,
  FRECENCY_BOOST_MULTIPLIER,
  JSON_HEADERS,
  TOP_K,
} from "./shared/constants";

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

const TERM_K_CACHE = new Array<string | undefined>(TERM_R.length);
const TERM_S_CACHE = new Array<string | undefined>(TERM_R.length);
const TERM_D_CACHE = new Array<string | undefined>(TERM_R.length);

function readPackedStringCached(
  blob: string,
  offsets: Int32Array,
  cache: (string | undefined)[],
  index: number
): string {
  const cached = cache[index];
  if (cached !== undefined) {
    return cached;
  }
  const value = blob.slice(offsets[index], offsets[index + 1]);
  cache[index] = value;
  return value;
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

const dfsStack: number[] = [];

const RESULT_IDX = new Int32Array(TOP_K);
const RESULT_SCORE = new Float64Array(TOP_K);
const RESULT_ORDER = new Int32Array(TOP_K);

function topK(
  subtree: number,
  frecent: Record<string, number>,
  customMatches: Candidate[],
  hasFrecent: boolean
): Candidate[] {
  let minIdx = -1;
  let threshold = -1;
  let resultLen = 0;

  const boostCap = hasFrecent ? FRECENCY_BOOST_CAP : 0;

  for (let k = 0; k < customMatches.length; k++) {
    const score = customMatches[k].score;
    if (resultLen < TOP_K) {
      RESULT_IDX[resultLen] = -k - 1;
      RESULT_SCORE[resultLen] = score;
      resultLen++;
      if (resultLen === TOP_K) {
        minIdx = 0;
        for (let i = 1; i < TOP_K; i++) {
          if (RESULT_SCORE[i] < RESULT_SCORE[minIdx]) {
            minIdx = i;
          }
        }
        threshold = RESULT_SCORE[minIdx];
      }
    } else if (score > threshold) {
      RESULT_IDX[minIdx] = -k - 1;
      RESULT_SCORE[minIdx] = score;
      minIdx = 0;
      for (let i = 1; i < TOP_K; i++) {
        if (RESULT_SCORE[i] < RESULT_SCORE[minIdx]) {
          minIdx = i;
        }
      }
      threshold = RESULT_SCORE[minIdx];
    }
  }

  let stackLen = 0;
  dfsStack[stackLen++] = subtree;

  while (stackLen > 0) {
    const node = dfsStack[--stackLen];
    const nodeOff = node * NODE_STRIDE;
    const terminalIndex = NODES[nodeOff + NODE_TERMINAL_INDEX];

    if (terminalIndex >= 0) {
      const score = hasFrecent
        ? effectiveScore(
            TERM_R[terminalIndex],
            frecent,
            readPackedStringCached(
              TERM_K_BLOB,
              TERM_K_OFF,
              TERM_K_CACHE,
              terminalIndex
            )
          )
        : TERM_R[terminalIndex];
      if (resultLen < TOP_K || score > threshold) {
        if (resultLen < TOP_K) {
          RESULT_IDX[resultLen] = terminalIndex;
          RESULT_SCORE[resultLen] = score;
          resultLen++;
          if (resultLen === TOP_K) {
            minIdx = 0;
            for (let i = 1; i < TOP_K; i++) {
              if (RESULT_SCORE[i] < RESULT_SCORE[minIdx]) {
                minIdx = i;
              }
            }
            threshold = RESULT_SCORE[minIdx];
          }
        } else {
          RESULT_IDX[minIdx] = terminalIndex;
          RESULT_SCORE[minIdx] = score;
          minIdx = 0;
          for (let i = 1; i < TOP_K; i++) {
            if (RESULT_SCORE[i] < RESULT_SCORE[minIdx]) {
              minIdx = i;
            }
          }
          threshold = RESULT_SCORE[minIdx];
        }
      }
    }

    const edgeStart = NODES[nodeOff + NODE_EDGE_START];
    const edgeCount = NODES[nodeOff + NODE_EDGE_COUNT];

    for (let i = edgeCount - 1; i >= 0; i--) {
      const edgeOff = (edgeStart + i) * EDGE_STRIDE;
      const child = EDGES[edgeOff + EDGE_CHILD_INDEX];
      const childMaxRelevance = NODES[child * NODE_STRIDE + NODE_MAX_RELEVANCE];
      if (resultLen >= TOP_K && childMaxRelevance + boostCap <= threshold) {
        break;
      }
      dfsStack[stackLen++] = child;
    }
  }

  for (let i = 0; i < resultLen; i++) {
    RESULT_ORDER[i] = i;
  }
  for (let i = 1; i < resultLen; i++) {
    const pos = RESULT_ORDER[i];
    const score = RESULT_SCORE[pos];
    let j = i - 1;
    while (j >= 0 && RESULT_SCORE[RESULT_ORDER[j]] < score) {
      RESULT_ORDER[j + 1] = RESULT_ORDER[j];
      j--;
    }
    RESULT_ORDER[j + 1] = pos;
  }

  const candidates = new Array<Candidate>(resultLen);
  for (let i = 0; i < resultLen; i++) {
    const pos = RESULT_ORDER[i];
    const idx = RESULT_IDX[pos];
    if (idx < 0) {
      candidates[i] = customMatches[-idx - 1];
      continue;
    }
    candidates[i] = {
      trigger: readPackedStringCached(
        TERM_K_BLOB,
        TERM_K_OFF,
        TERM_K_CACHE,
        idx
      ),
      name: readPackedStringCached(TERM_S_BLOB, TERM_S_OFF, TERM_S_CACHE, idx),
      domain: readPackedStringCached(
        TERM_D_BLOB,
        TERM_D_OFF,
        TERM_D_CACHE,
        idx
      ),
      score: RESULT_SCORE[pos],
    };
  }

  return candidates;
}

export function profileWalkPrefix(partial: string): [number, string] | null {
  return walkPrefix(partial);
}

export function profileTopKCount(
  subtree: number,
  frecent: Record<string, number>,
  hasFrecent: boolean
): number {
  return topK(subtree, frecent, [], hasFrecent).length;
}

export function responseFromCandidates(
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
  let hasFrecent = false;
  for (const _ in frecent) {
    hasFrecent = true;
    break;
  }

  const customMatches: Candidate[] = [];
  for (const trigger of custom) {
    if (!trigger.startsWith(partial)) {
      if (trigger > `${partial}\uFFFF`) {
        break;
      }
      continue;
    }
    customMatches.push({
      trigger,
      name: "",
      domain: "",
      score: hasFrecent ? effectiveScore(0, frecent, trigger) : 0,
    });
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
  const candidates = topK(subtree, frecent, customMatches, hasFrecent);
  return responseFromCandidates(query, prefix, candidates);
}
