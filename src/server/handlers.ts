import { opensearch } from "../opensearch";
import { readQueryParam } from "../shared/raw-query";
import { readOrigin } from "../shared/raw-url";
import {
  parseSettingsFromRawUrl,
  scheduleBangSuggestWarmup,
  suggest,
} from "../suggest";

const MISSING_Q = "Missing q parameter";

export function handleSuggestRequest(
  request: Request
): Response | Promise<Response> {
  const rawUrl = request.url;
  const q = readQueryParam(rawUrl, "q");
  if (!q) {
    return new Response(MISSING_Q, { status: 400 });
  }
  scheduleBangSuggestWarmup();
  return suggest(q, parseSettingsFromRawUrl(rawUrl, request));
}

export function handleOpenSearchRequest(request: Request): Response {
  return opensearch(readOrigin(request.url));
}
