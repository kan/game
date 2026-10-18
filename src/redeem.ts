import { clientIp, error, readJsonObject } from "./http";
import { findId, idResponse, type IdHandler } from "./id";

interface RedeemOptions {
  /** Counts attempts per IP under `<name>:<ip>` in REDEEM_RATE_LIMITER. */
  name: string;
  /** The body field that carries the secret. */
  field: string;
  /** The canonical form of the secret, or null when it cannot be valid. */
  parse: (value: unknown) => string | null;
  /**
   * The ID the secret belongs to, or null. A one-time secret must be used up
   * in the same statement that finds it, and only when its ID is active, so
   * a code of an ID being deleted is not wasted. The handler then refuses
   * any ID that is not active.
   */
  resolve: (
    db: D1Database,
    secret: string,
    now: number,
  ) => Promise<string | null>;
}

/**
 * A redeem API: switches this device's cookie to the ID a secret belongs to
 * (docs/ID_DESIGN.md「HTTP の API」). The device's previous ID is left as it
 * is; records are not merged. Malformed, unknown, expired and used secrets,
 * and secrets of an ID being deleted, all get `400 invalid_code`.
 */
export function redeemHandler(options: RedeemOptions): IdHandler {
  return async (request, env, context) => {
    // Checked before the body is read, so wrong guesses count too.
    const { success } = await env.REDEEM_RATE_LIMITER.limit({
      key: `${options.name}:${clientIp(request)}`,
    });
    if (!success) return error(429, "rate_limited");
    const body = await readJsonObject(request);
    if (!body) return error(400, "invalid_request");
    const secret = options.parse(body[options.field]);
    if (!secret) return error(400, "invalid_code");

    const id = await options.resolve(env.DB, secret, context.now);
    if (!id) return error(400, "invalid_code");
    // Deletion may have begun or finished since `resolve`.
    const account = await findId(env.DB, id);
    if (account?.status !== "active") return error(400, "invalid_code");
    return idResponse(env, context, account);
  };
}
