import { handleSuggestRequest } from "../src/server/handlers";

interface RequestContext {
  request: Request;
}

export const onRequestGet = ({ request }: RequestContext) =>
  handleSuggestRequest(request);
