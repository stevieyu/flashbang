import { opensearch } from "../opensearch";
import { COOKIE_MAX_AGE_S } from "../shared/constants";
import { readTwoQueryParams } from "../shared/raw-query";
import { readOrigin } from "../shared/raw-url";
import {
  parsePartialBang,
  parseSettingsFromRawUrlWithCleanup,
  suggest,
} from "../suggest";

const MISSING_Q = "Missing q parameter";

export function handleSuggestRequest(request: Request): Promise<Response> {
  const rawUrl = request.url;
  const [q, sp] = readTwoQueryParams(rawUrl, "q", "sp");
  if (!q) {
    return Promise.resolve(new Response(MISSING_Q, { status: 400 }));
  }
  const bang = parsePartialBang(q);
  const { settings, rewrittenSuggestCookie } =
    parseSettingsFromRawUrlWithCleanup(rawUrl, request, sp, bang !== null);
  return suggest(q, settings, bang).then((response) => {
    if (!rewrittenSuggestCookie) {
      return response;
    }

    const headers = new Headers(response.headers);
    headers.append(
      "Set-Cookie",
      `suggest=${rewrittenSuggestCookie};path=/;max-age=${COOKIE_MAX_AGE_S};SameSite=Lax;Secure`
    );
    return new Response(response.body, {
      headers,
      status: response.status,
      statusText: response.statusText,
    });
  });
}

export function handleOpenSearchRequest(request: Request): Response {
  return opensearch(readOrigin(request.url));
}
