import { clearIdCookie, clientIp, error } from "./http";
import { idResponse, readIdClaims, type IdStatus } from "./id";
import { loadKeys } from "./keys";

/** `last_seen_at` is written at most once a day. */
export const LAST_SEEN_INTERVAL_MS = 24 * 60 * 60 * 1000;

/**
 * POST /api/id/session: issues an ID, or extends the cookie of a known one
 * (docs/ID_DESIGN.md「ID の発行と延長」).
 */
export async function handleSession(
  request: Request,
  env: Env,
): Promise<Response> {
  const keys = await loadKeys(env);
  const now = Date.now();
  const claims = await readIdClaims(request, env, keys, now);

  if (claims) {
    const row = await env.DB.prepare(
      `SELECT ids.status, ids.last_seen_at, names.display_name
         FROM ids LEFT JOIN names ON names.id = ids.id
        WHERE ids.id = ?`,
    )
      .bind(claims.sub)
      .first<{
        status: IdStatus;
        last_seen_at: number;
        display_name: string | null;
      }>();
    // A valid signature for a missing ID means the ID was deleted. Do not
    // issue a new one here; the next call does, since the cookie is gone.
    if (!row) {
      return error(410, "id_deleted", { "Set-Cookie": clearIdCookie(env) });
    }
    if (now - row.last_seen_at >= LAST_SEEN_INTERVAL_MS) {
      await env.DB.prepare("UPDATE ids SET last_seen_at = ? WHERE id = ?")
        .bind(now, claims.sub)
        .run();
    }
    return idResponse(
      env,
      keys,
      { id: claims.sub, name: row.display_name, status: row.status },
      now,
    );
  }

  const { success } = await env.ISSUE_RATE_LIMITER.limit({
    key: clientIp(request),
  });
  if (!success) return error(429, "rate_limited");
  const id = crypto.randomUUID();
  await env.DB.prepare(
    "INSERT INTO ids (id, status, created_at, last_seen_at) VALUES (?, 'active', ?, ?)",
  )
    .bind(id, now, now)
    .run();
  return idResponse(env, keys, { id, name: null, status: "active" }, now);
}
