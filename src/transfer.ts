import { normalizeCode, randomCode } from "./codes";
import { clientIp, error, json, readJsonObject } from "./http";
import { findId, idResponse, type AuthedIdContext, type IdContext } from "./id";

export const TRANSFER_CODE_LENGTH = 8;
export const TRANSFER_CODE_LIFETIME_MS = 10 * 60 * 1000;

/**
 * POST /api/id/transfer-codes: issues a one-time code for moving this ID to
 * another device. Issuing replaces the ID's earlier codes
 * (docs/ID_DESIGN.md「引き継ぎコード」).
 */
export async function handleIssueTransferCode(
  _request: Request,
  env: Env,
  context: AuthedIdContext,
): Promise<Response> {
  // An ID being deleted must not spread to more devices.
  if (context.account.status === "deleting") return error(409, "id_deleting");
  const code = randomCode(TRANSFER_CODE_LENGTH);
  const expiresAt = context.now + TRANSFER_CODE_LIFETIME_MS;
  await env.DB.batch([
    // Expired codes of any ID go too, so a new code cannot collide with one
    // that the daily cleanup has not reached yet.
    env.DB.prepare(
      "DELETE FROM transfer_codes WHERE id = ? OR expires_at <= ?",
    ).bind(context.account.id, context.now),
    env.DB.prepare(
      "INSERT INTO transfer_codes (code, id, expires_at) VALUES (?, ?, ?)",
    ).bind(code, context.account.id, expiresAt),
  ]);
  return json({ code, expiresAt });
}

/**
 * POST /api/id/transfer-codes/redeem: switches this device's cookie to the ID
 * that issued the code. The device's previous ID is left as it is; records
 * are not merged.
 */
export async function handleRedeemTransferCode(
  request: Request,
  env: Env,
  context: IdContext,
): Promise<Response> {
  const { success } = await env.REDEEM_RATE_LIMITER.limit({
    key: `transfer:${clientIp(request)}`,
  });
  if (!success) return error(429, "rate_limited");
  const body = await readJsonObject(request);
  if (!body) return error(400, "invalid_request");
  const code = normalizeCode(body.code, TRANSFER_CODE_LENGTH);
  // Unknown, expired, used and malformed codes, and codes of an ID being
  // deleted, all get the same answer.
  if (!code) return error(400, "invalid_code");

  // Finding and using the code is one statement, so a code works only once.
  // A code of an ID being deleted (issued before deletion began) is left
  // unused; deleting the ID removes it.
  const used = await env.DB.prepare(
    `DELETE FROM transfer_codes
      WHERE code = ? AND expires_at > ?
        AND id IN (SELECT id FROM ids WHERE status = 'active')
      RETURNING id`,
  )
    .bind(code, context.now)
    .first<{ id: string }>();
  if (!used) return error(400, "invalid_code");
  // Deleting an ID cascades to its codes, so the ID exists unless deletion
  // began or finished between the two statements.
  const account = await findId(env.DB, used.id);
  if (account?.status !== "active") return error(400, "invalid_code");
  return idResponse(env, context, account);
}
