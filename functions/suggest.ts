import { handleSuggestRequest } from "../src/server/handlers";
import { preloadBangSuggest } from "../src/suggest";

interface RequestContext {
  request: Request;
  waitUntil?: (promise: Promise<unknown>) => void;
}

export const onRequestGet = ({ request, waitUntil }: RequestContext) => {
  waitUntil?.(preloadBangSuggest());
  return handleSuggestRequest(request);
};
