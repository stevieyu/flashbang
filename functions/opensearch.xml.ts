import { handleOpenSearchRequest } from "../src/server/handlers";

export const onRequestGet = ({ request }: { request: Request }) => {
  return handleOpenSearchRequest(request);
};
