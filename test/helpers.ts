import { env } from "cloudflare:workers";
import { expect } from "vitest";
import { handleFetch } from "../src/router";
import { importVerificationKeys, verifyIdToken } from "../src/token";

/** A game's origin: allowed for every API except the portal-only ones. */
export const GAME_ORIGIN = "https://tako-dev.kan-game.app";
export const PORTAL_ORIGIN = env.PORTAL_ORIGIN;
export const COOKIE = env.COOKIE_NAME;

/**
 * A client IP no other request uses. Rate-limit counts are shared across test
 * files and outlive a run by up to 60 seconds, so IPs must be unique per run.
 * The limiter treats the header as an opaque key, so it need not look like an IP.
 */
export function uniqueIp(): string {
  return `test-${crypto.randomUUID()}`;
}

export interface ApiRequestOptions {
  cookie?: string;
  origin?: string | null;
  ip?: string;
  method?: string;
  body?: unknown;
}

/**
 * A request to an ID API. Each call gets its own IP unless given one, so tests
 * do not share a rate limit.
 */
export function apiRequest(
  path: string,
  options: ApiRequestOptions = {},
): Request {
  const headers = new Headers({
    "CF-Connecting-IP": options.ip ?? uniqueIp(),
  });
  if (options.origin !== null)
    headers.set("Origin", options.origin ?? GAME_ORIGIN);
  if (options.cookie) headers.set("Cookie", options.cookie);
  let body: string | undefined;
  if (options.body !== undefined) {
    headers.set("Content-Type", "application/json");
    body =
      typeof options.body === "string"
        ? options.body
        : JSON.stringify(options.body);
  }
  return new Request(`${GAME_ORIGIN}${path}`, {
    method: options.method ?? "POST",
    headers,
    body,
  });
}

export function sessionRequest(options: ApiRequestOptions = {}): Request {
  return apiRequest("/api/id/session", options);
}

/**
 * Calls the Worker's HTTP handler with the test env. `overrides` replaces
 * variables or adds bindings, such as fake `GAME_<NAME>` services.
 */
export function call(
  request: Request,
  // Not Partial<Env>: a fake GAME_<NAME> is a plain object, not a Service.
  overrides: Record<string, unknown> = {},
): Promise<Response> {
  return handleFetch(request, { ...env, ...overrides } as Env);
}

/** The ID token in a response's Set-Cookie, or null. */
export function cookieToken(response: Response): string | null {
  const header = response.headers.get("Set-Cookie");
  const match = header?.match(new RegExp(`^${COOKIE}=([^;]*)`));
  return match ? match[1] : null;
}

/** The claims of a token, verified with the test environment's keys. */
export async function verifyToken(token: string) {
  return verifyIdToken(
    token,
    await importVerificationKeys(env.ID_PUBLIC_KEYS),
    env.ISSUER,
    Date.now(),
  );
}

/** Issues a new ID and returns it with its cookie header value. */
export async function issue(): Promise<{
  id: string;
  token: string;
  cookie: string;
}> {
  const response = await call(sessionRequest());
  expect(response.status).toBe(200);
  const body = await response.json<{ id: string }>();
  const token = cookieToken(response)!;
  return { id: body.id, token, cookie: `${COOKIE}=${token}` };
}
