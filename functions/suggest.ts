import { parseSettings, suggest } from "../src/suggest";

export const onRequestGet: PagesFunction = ({ request }) => {
  const url = new URL(request.url);
  const q = url.searchParams.get("q");
  if (!q) {
    return new Response("Missing q parameter", { status: 400 });
  }
  return suggest(q, parseSettings(url, request));
};
