import { idCookie, json } from "./http";
import type { IdKeys } from "./keys";
import { signIdToken, verifyIdCookie, type IdTokenClaims } from "./token";

export type IdStatus = "active" | "deleting";

/** The body of every API that sets the ID cookie (session and the redeem APIs). */
export interface IdBody {
  id: string;
  name: string | null;
  status: IdStatus;
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

/** Signs a fresh cookie for `body.id` and returns it with the body. */
export async function idResponse(
  env: Env,
  keys: IdKeys,
  body: IdBody,
  now: number,
): Promise<Response> {
  const token = await signIdToken(
    keys.signing,
    { sub: body.id, iss: env.ISSUER },
    now,
  );
  return json(body, 200, { "Set-Cookie": idCookie(env, token) });
}
