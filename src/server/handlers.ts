import { opensearch } from "../opensearch";
import { readTwoQueryParams } from "../shared/raw-query";
import { readOrigin } from "../shared/raw-url";
import { parsePartialBang, parseSettingsFromRawUrl, suggest } from "../suggest";

const MISSING_Q = "Missing q parameter";

export function handleSuggestRequest(
  request: Request
): Response | Promise<Response> {
  const rawUrl = request.url;
  const [q, sp] = readTwoQueryParams(rawUrl, "q", "sp");
  if (!q) {
    return new Response(MISSING_Q, { status: 400 });
  }
  const bang = parsePartialBang(q);
  return suggest(
    q,
    parseSettingsFromRawUrl(rawUrl, request, sp, bang !== null),
    bang
  );
}

export function handleOpenSearchRequest(request: Request): Response {
  return opensearch(readOrigin(request.url));
}
