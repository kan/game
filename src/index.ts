import { error, isAllowedOrigin } from "./http";
import { handleSession } from "./session";

const ID_ROUTES: Record<
  string,
  (request: Request, env: Env) => Promise<Response>
> = {
  "/api/id/session": handleSession,
};

export default {
  async fetch(request, env): Promise<Response> {
    const handler = ID_ROUTES[new URL(request.url).pathname];
    if (!handler) return error(404, "not_found");
    if (request.method !== "POST") {
      return error(405, "method_not_allowed", { Allow: "POST" });
    }
    // Every ID API changes state and is authenticated by a cookie, so
    // requests from other sites are refused (docs/ID_DESIGN.md「HTTP の API」).
    if (!isAllowedOrigin(request, env)) return error(403, "origin_not_allowed");
    return handler(request, env);
  },
} satisfies ExportedHandler<Env>;
