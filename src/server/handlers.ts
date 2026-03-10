import { opensearch } from "../opensearch";
import { readTwoQueryParams } from "../shared/raw-query";
import { readOrigin } from "../shared/raw-url";
import { parseSettingsFromRawUrl, suggest } from "../suggest";

const MISSING_Q = "Missing q parameter";

export function handleSuggestRequest(
  request: Request
): Response | Promise<Response> {
  const rawUrl = request.url;
  const [q, sp] = readTwoQueryParams(rawUrl, "q", "sp");
  if (!q) {
    return new Response(MISSING_Q, { status: 400 });
  }
  return suggest(q, parseSettingsFromRawUrl(rawUrl, request, sp));
}

export function handleOpenSearchRequest(request: Request): Response {
  return opensearch(readOrigin(request.url));
}
