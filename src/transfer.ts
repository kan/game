import { normalizeCode, randomCode } from "./codes";
import { json } from "./http";
import type { AuthedIdContext } from "./id";
import { redeemHandler } from "./redeem";

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

/** POST /api/id/transfer-codes/redeem: body `{ code }`. */
export const handleRedeemTransferCode = redeemHandler({
  name: "transfer",
  field: "code",
  parse: (value) => normalizeCode(value, TRANSFER_CODE_LENGTH),
  // Finding and using the code is one statement, so a code works only once.
  // A code of an ID being deleted (issued before deletion began) is left
  // unused; deleting the ID removes it.
  resolve: async (db, code, now) => {
    const row = await db
      .prepare(
        `DELETE FROM transfer_codes
          WHERE code = ? AND expires_at > ?
            AND id IN (SELECT id FROM ids WHERE status = 'active')
          RETURNING id`,
      )
      .bind(code, now)
      .first<{ id: string }>();
    return row?.id ?? null;
  },
});
