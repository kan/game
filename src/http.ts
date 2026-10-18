import { ID_TOKEN_LIFETIME_SECONDS } from "./token";

export function json(
  body: unknown,
  status = 200,
  headers?: HeadersInit,
): Response {
  const response = Response.json(body, { status, headers });
  response.headers.set("Cache-Control", "no-store");
  return response;
}

export function error(
  status: number,
  code: string,
  headers?: HeadersInit,
): Response {
  return json({ error: code }, status, headers);
}

/** Whether `Origin` is the portal's (`PORTAL_ORIGIN`). */
export function isPortalOrigin(request: Request, env: Env): boolean {
  return request.headers.get("Origin") === env.PORTAL_ORIGIN.trim();
}

/**
 * Whether `Origin` is `PORTAL_ORIGIN` or one of `ALLOWED_ORIGINS` (comma
 * separated; the games' origins).
 */
export function isAllowedOrigin(request: Request, env: Env): boolean {
  const origin = request.headers.get("Origin");
  if (!origin) return false;
  if (isPortalOrigin(request, env)) return true;
  return env.ALLOWED_ORIGINS.split(",").some(
    (allowed) => allowed.trim() === origin,
  );
}

export function idCookie(env: Env, token: string): string {
  return cookie(env, token, ID_TOKEN_LIFETIME_SECONDS);
}

export function clearIdCookie(env: Env): string {
  return cookie(env, "", 0);
}

function cookie(env: Env, value: string, maxAge: number): string {
  const domain = env.COOKIE_DOMAIN ? `; Domain=${env.COOKIE_DOMAIN}` : "";
  return `${env.COOKIE_NAME}=${value}${domain}; Path=/; Max-Age=${maxAge}; Secure; HttpOnly; SameSite=Lax`;
}

/** The request body as a JSON object, or null when it is not one. */
export async function readJsonObject(
  request: Request,
): Promise<Record<string, unknown> | null> {
  try {
    const body: unknown = await request.json();
    return typeof body === "object" && body !== null && !Array.isArray(body)
      ? (body as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

export function clientIp(request: Request): string {
  return request.headers.get("CF-Connecting-IP") ?? "unknown";
}
