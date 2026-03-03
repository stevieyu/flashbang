import { opensearch } from "../opensearch";
import { readQueryParam } from "../shared/raw-query";
import { parseSettingsFromRawUrl, suggest } from "../suggest";

const MISSING_Q = "Missing q parameter";

export function handleSuggestRequest(
  request: Request
): Response | Promise<Response> {
  const rawUrl = request.url;
  const q = readQueryParam(rawUrl, "q");
  if (!q) {
    return new Response(MISSING_Q, { status: 400 });
  }
  return suggest(q, parseSettingsFromRawUrl(rawUrl, request));
}

export function handleOpenSearchRequest(
  request: Request,
  url: URL = new URL(request.url)
): Response {
  return opensearch(url.origin);
}
