import { handleOpenSearchRequest } from "../src/server/handlers";

interface RequestContext {
  env: { PUBLIC_ORIGIN?: string };
  request: Request;
}

export const onRequestGet = ({ env, request }: RequestContext) => {
  return handleOpenSearchRequest(request, env);
};
