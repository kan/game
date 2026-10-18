import { error, isAllowedOrigin } from "./http";
import { readIdClaims, requireId, type IdHandler } from "./id";
import { loadKeys } from "./keys";
import { deleteExpiredRows } from "./maintenance";
import { handleSession } from "./session";
import { handleIssueTransferCode, handleRedeemTransferCode } from "./transfer";

/** APIs that need an ID are wrapped in `requireId`. */
const ID_ROUTES: Record<string, IdHandler> = {
  "/api/id/session": handleSession,
  "/api/id/transfer-codes": requireId(handleIssueTransferCode),
  "/api/id/transfer-codes/redeem": handleRedeemTransferCode,
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

    const keys = await loadKeys(env);
    const now = Date.now();
    const claims = await readIdClaims(request, env, keys, now);
    return handler(request, env, { keys, now, claims });
  },

  async scheduled(_controller, env): Promise<void> {
    await deleteExpiredRows(env.DB, Date.now());
  },
} satisfies ExportedHandler<Env>;
