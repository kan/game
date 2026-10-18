import { hashSecret, normalizeCode, randomCode } from "./codes";
import { json } from "./http";
import type { AuthedIdContext } from "./id";
import { redeemHandler } from "./redeem";

/** 20 symbols of 5 bits: 100 bits (docs/ID_DESIGN.md「復旧コード」). */
export const RECOVERY_CODE_LENGTH = 20;

/**
 * POST /api/id/recovery-code: issues the ID's recovery code, replacing the
 * previous one. The code is returned only here; only its hash is stored.
 * The portal shows it in groups of four.
 */
export async function handleIssueRecoveryCode(
  _request: Request,
  env: Env,
  context: AuthedIdContext,
): Promise<Response> {
  const code = randomCode(RECOVERY_CODE_LENGTH);
  await env.DB.prepare(
    `INSERT INTO recovery_codes (id, code_hash, created_at) VALUES (?, ?, ?)
     ON CONFLICT (id) DO UPDATE
       SET code_hash = excluded.code_hash, created_at = excluded.created_at`,
  )
    .bind(context.account.id, await hashSecret(code), context.now)
    .run();
  return json({ code });
}

/**
 * POST /api/id/recovery-code/redeem: body `{ code }`. The code stays valid
 * until it is reissued.
 */
export const handleRedeemRecoveryCode = redeemHandler({
  name: "recovery",
  field: "code",
  parse: (value) => normalizeCode(value, RECOVERY_CODE_LENGTH),
  resolve: async (db, code) => {
    const row = await db
      .prepare("SELECT id FROM recovery_codes WHERE code_hash = ?")
      .bind(await hashSecret(code))
      .first<{ id: string }>();
    return row?.id ?? null;
  },
});
