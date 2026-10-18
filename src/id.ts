import { clearIdCookie, error, idCookie, isPortalOrigin, json } from "./http";
import type { IdKeys } from "./keys";
import { signIdToken, verifyIdCookie, type IdTokenClaims } from "./token";

export type IdStatus = "active" | "deleting";

/** The body of every API that sets the ID cookie (session and the redeem APIs). */
export interface IdBody {
  id: string;
  name: string | null;
  status: IdStatus;
}

export interface IdRecord extends IdBody {
  lastSeenAt: number;
}

/** What the router has worked out about a request before the handler runs. */
export interface IdContext {
  keys: IdKeys;
  now: number;
  /** The claims of a valid ID cookie, or null. The ID may since be deleted. */
  claims: IdTokenClaims | null;
}

/** The context of an API that requires an ID: the cookie's ID exists. */
export interface AuthedIdContext extends IdContext {
  account: IdRecord;
}

/** The claims of the request's ID cookie, or null when it is missing or invalid. */
export function readIdClaims(
  request: Request,
  env: Env,
  keys: IdKeys,
  now: number,
): Promise<IdTokenClaims | null> {
  return verifyIdCookie(
    request.headers.get("Cookie"),
    env.COOKIE_NAME,
    keys.verification,
    env.ISSUER,
    now,
  );
}

export async function findId(
  db: D1Database,
  id: string,
): Promise<IdRecord | null> {
  const row = await db
    .prepare(
      `SELECT ids.status, ids.last_seen_at, names.display_name
         FROM ids LEFT JOIN names ON names.id = ids.id
        WHERE ids.id = ?`,
    )
    .bind(id)
    .first<{
      status: IdStatus;
      last_seen_at: number;
      display_name: string | null;
    }>();
  return row
    ? {
        id,
        name: row.display_name,
        status: row.status,
        lastSeenAt: row.last_seen_at,
      }
    : null;
}

/**
 * The ID of verified claims, or `410 id_deleted` when the ID no longer exists.
 * The response clears the cookie; the next POST /api/id/session issues a new ID.
 */
export async function resolveAccount(
  env: Env,
  claims: IdTokenClaims,
): Promise<IdRecord | Response> {
  const account = await findId(env.DB, claims.sub);
  return (
    account ?? error(410, "id_deleted", { "Set-Cookie": clearIdCookie(env) })
  );
}

export type IdHandler<C extends IdContext = IdContext> = (
  request: Request,
  env: Env,
  context: C,
) => Promise<Response>;

/** Wraps a handler that needs an ID: `401 no_id` without a valid cookie, `410` for a deleted ID. */
export function requireId(handler: IdHandler<AuthedIdContext>): IdHandler {
  return async (request, env, context) => {
    if (!context.claims) return error(401, "no_id");
    const account = await resolveAccount(env, context.claims);
    if (account instanceof Response) return account;
    return handler(request, env, { ...context, account });
  };
}

/**
 * Like `requireId`, and also `409 id_deleting` for an ID in the middle of
 * deletion: an ID being deleted must not spread to more devices.
 */
export function requireActiveId(
  handler: IdHandler<AuthedIdContext>,
): IdHandler {
  return requireId((request, env, context) =>
    context.account.status === "active"
      ? handler(request, env, context)
      : Promise.resolve(error(409, "id_deleting")),
  );
}

/**
 * Wraps a handler only the portal may call (the recovery code and deletion
 * screens live only there): `403 origin_not_allowed` for any other origin.
 */
export function portalOnly<C extends IdContext>(
  handler: IdHandler<C>,
): IdHandler<C> {
  return (request, env, context) =>
    isPortalOrigin(request, env)
      ? handler(request, env, context)
      : Promise.resolve(error(403, "origin_not_allowed"));
}

/** Signs a fresh cookie for `account.id` and returns it with `{ id, name, status }`. */
export async function idResponse(
  env: Env,
  context: IdContext,
  account: IdBody,
): Promise<Response> {
  // Callers often pass an IdRecord; copy only the public fields.
  const { id, name, status } = account;
  const token = await signIdToken(
    context.keys.signing,
    { sub: id, iss: env.ISSUER },
    context.now,
  );
  const body: IdBody = { id, name, status };
  return json(body, 200, { "Set-Cookie": idCookie(env, token) });
}
