import { handleSuggestRequest } from "../src/server/handlers";

export const onRequestGet = ({ request }: { request: Request }) => {
  return handleSuggestRequest(request);
};
