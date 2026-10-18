import { clientIp, error } from "./http";
import { idResponse, resolveAccount, type IdContext } from "./id";

/** `last_seen_at` is written at most once a day. */
export const LAST_SEEN_INTERVAL_MS = 24 * 60 * 60 * 1000;

/**
 * POST /api/id/session: issues an ID, or extends the cookie of a known one
 * (docs/ID_DESIGN.md「ID の発行と延長」).
 */
export async function handleSession(
  request: Request,
  env: Env,
  context: IdContext,
): Promise<Response> {
  const { claims, now } = context;
  if (claims) {
    // For a deleted ID, do not issue a new one here; the next call does,
    // since the response clears the cookie.
    const account = await resolveAccount(env, claims);
    if (account instanceof Response) return account;
    if (now - account.lastSeenAt >= LAST_SEEN_INTERVAL_MS) {
      await env.DB.prepare("UPDATE ids SET last_seen_at = ? WHERE id = ?")
        .bind(now, account.id)
        .run();
    }
    return idResponse(env, context, account);
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
  return idResponse(env, context, { id, name: null, status: "active" });
}
