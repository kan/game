import { hashSecret } from "./codes";
import { redeemHandler } from "./redeem";

/** 32 random bytes in base64url without padding (docs/ID_DESIGN.md「引き継ぎ用トークン」). */
const MIGRATION_TOKEN = /^[A-Za-z0-9_-]{43}$/;

/**
 * POST /api/id/migration/redeem: body `{ token }`. Moves records from the
 * TAKO-SEN development environment to production. Tokens are registered by
 * the migration work with `wrangler d1 execute`, not by an API, and stay
 * valid on any number of devices until they expire.
 */
export const handleRedeemMigrationToken = redeemHandler({
  name: "migration",
  field: "token",
  parse: (value) =>
    typeof value === "string" && MIGRATION_TOKEN.test(value) ? value : null,
  resolve: async (db, token, now) => {
    const row = await db
      .prepare(
        "SELECT id FROM migration_tokens WHERE token_hash = ? AND expires_at > ?",
      )
      .bind(await hashSecret(token), now)
      .first<{ id: string }>();
    return row?.id ?? null;
  },
});
