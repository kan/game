import { handleDeleteAccount } from "./account";
import { error, isAllowedOrigin } from "./http";
import {
  portalOnly,
  readIdClaims,
  requireActiveId,
  requireId,
  type IdHandler,
} from "./id";
import { loadKeys } from "./keys";
import { handleRedeemMigrationToken } from "./migration";
import { handleIssueRecoveryCode, handleRedeemRecoveryCode } from "./recovery";
import { handleSession } from "./session";
import { handleIssueTransferCode, handleRedeemTransferCode } from "./transfer";

/**
 * APIs that need an ID are wrapped in `requireId`, or in `requireActiveId`
 * when an ID being deleted must be refused; APIs only the portal may call are
 * wrapped in `portalOnly` (docs/ID_DESIGN.md「HTTP の API」).
 */
const ID_ROUTES: Record<string, IdHandler> = {
  "/api/id/session": handleSession,
  "/api/id/transfer-codes": requireActiveId(handleIssueTransferCode),
  "/api/id/transfer-codes/redeem": handleRedeemTransferCode,
  "/api/id/recovery-code": portalOnly(requireActiveId(handleIssueRecoveryCode)),
  "/api/id/recovery-code/redeem": portalOnly(handleRedeemRecoveryCode),
  "/api/id/migration/redeem": handleRedeemMigrationToken,
  // An ID already `deleting` may retry.
  "/api/id/delete": portalOnly(requireId(handleDeleteAccount)),
};

/** Routes an HTTP request to the ID APIs. */
export async function handleFetch(
  request: Request,
  env: Env,
): Promise<Response> {
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
}
