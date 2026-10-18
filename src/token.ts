/**
 * ES256 JWTs carried in the kan-game.app ID cookie (docs/ID_DESIGN.md「ID と Cookie」).
 *
 * Each game copies this file to verify the cookie, so it depends on nothing but
 * Web Crypto. Copy it unchanged, and check the copy against
 * test-vectors/id-token.json the way test/vectors.test.ts does
 * (docs/ID_DESIGN.md「鍵の管理」).
 */

/** 400 days: the longest cookie lifetime browsers accept. */
export const ID_TOKEN_LIFETIME_SECONDS = 400 * 24 * 60 * 60;

export interface IdTokenClaims {
  sub: string;
  iss: string;
  iat: number;
  exp: number;
}

/** A signing (private) or verification (public) key with its `kid`. */
export interface IdKey {
  kid: string;
  key: CryptoKey;
}

const ALGORITHM = { name: "ECDSA", namedCurve: "P-256" } as const;
const SIGNATURE = { name: "ECDSA", hash: "SHA-256" } as const;
const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const encoder = new TextEncoder();
const decoder = new TextDecoder();

/** Parses `ID_PUBLIC_KEYS` (a JSON array of public JWKs, each with `kid`). */
export async function importVerificationKeys(json: string): Promise<IdKey[]> {
  const jwks: unknown = JSON.parse(json);
  if (!Array.isArray(jwks)) throw new Error("ID_PUBLIC_KEYS must be an array");
  return Promise.all(jwks.map((jwk) => importJwk(jwk, "verify")));
}

/** Parses `ID_SIGNING_KEY` (a private JWK with `kid`). */
export function importSigningKey(json: string): Promise<IdKey> {
  return importJwk(JSON.parse(json), "sign");
}

async function importJwk(
  jwk: JsonWebKey & { kid?: unknown },
  usage: "sign" | "verify",
): Promise<IdKey> {
  if (typeof jwk.kid !== "string" || jwk.kid === "")
    throw new Error("every ID key needs a kid");
  // Pass only the key members; `kid` is not part of Web Crypto's JWK.
  const { kty, crv, x, y, d } = jwk;
  const key = await crypto.subtle.importKey(
    "jwk",
    usage === "sign" ? { kty, crv, x, y, d } : { kty, crv, x, y },
    ALGORITHM,
    false,
    [usage],
  );
  return { kid: jwk.kid, key };
}

export async function signIdToken(
  signingKey: IdKey,
  claims: { sub: string; iss: string },
  nowMs: number,
): Promise<string> {
  const iat = Math.floor(nowMs / 1000);
  const header = { alg: "ES256", typ: "JWT", kid: signingKey.kid };
  const payload: IdTokenClaims = {
    sub: claims.sub,
    iss: claims.iss,
    iat,
    exp: iat + ID_TOKEN_LIFETIME_SECONDS,
  };
  const input = `${encodeJson(header)}.${encodeJson(payload)}`;
  const signature = await crypto.subtle.sign(
    SIGNATURE,
    signingKey.key,
    encoder.encode(input),
  );
  return `${input}.${encodeBase64Url(new Uint8Array(signature))}`;
}

/** How far in the future `iat` may be, for clocks that are slightly apart. */
const CLOCK_SKEW_SECONDS = 5 * 60;

/**
 * Returns the claims of a valid token, or null. Checks the signature, `alg`,
 * `typ`, that `kid` names a known key, `iss`, `exp`, that `iat` is at most
 * 5 minutes in the future and at most the lifetime before `exp`, that both
 * are whole seconds, and that `sub` is a UUID v4.
 */
export async function verifyIdToken(
  token: string,
  keys: readonly IdKey[],
  issuer: string,
  nowMs: number,
): Promise<IdTokenClaims | null> {
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  const [encodedHeader, encodedPayload, encodedSignature] = parts;
  const header = decodeJson(encodedHeader);
  if (
    header?.alg !== "ES256" ||
    header.typ !== "JWT" ||
    typeof header.kid !== "string"
  )
    return null;
  const verificationKey = keys.find((key) => key.kid === header.kid);
  if (!verificationKey) return null;
  const signature = decodeBase64Url(encodedSignature);
  // ES256 signatures are r || s, 32 bytes each.
  if (!signature || signature.length !== 64) return null;
  const valid = await crypto.subtle.verify(
    SIGNATURE,
    verificationKey.key,
    signature,
    encoder.encode(`${encodedHeader}.${encodedPayload}`),
  );
  if (!valid) return null;
  const payload = decodeJson(encodedPayload);
  const now = Math.floor(nowMs / 1000);
  if (
    !payload ||
    typeof payload.sub !== "string" ||
    !UUID.test(payload.sub) ||
    payload.iss !== issuer ||
    !Number.isSafeInteger(payload.iat) ||
    !Number.isSafeInteger(payload.exp) ||
    typeof payload.iat !== "number" ||
    typeof payload.exp !== "number" ||
    payload.exp <= now ||
    payload.iat > now + CLOCK_SKEW_SECONDS ||
    payload.exp - payload.iat > ID_TOKEN_LIFETIME_SECONDS
  )
    return null;
  return {
    sub: payload.sub,
    iss: payload.iss,
    iat: payload.iat,
    exp: payload.exp,
  };
}

/**
 * The claims of the first valid ID cookie in a `Cookie` header, or null.
 * Every cookie with the name is tried: a browser can hold both a host-only and
 * a `Domain=kan-game.app` copy, and an invalid one must not hide a valid one.
 *
 * There is deliberately no limit on how many are tried. With one, invalid
 * copies sent first (a script on any subdomain can add some with a longer
 * Path) would hide the real cookie, a new ID would be issued over it, and the
 * player would lose theirs. The 128 KB request header limit bounds the work
 * to a few hundred signature checks.
 */
export async function verifyIdCookie(
  header: string | null,
  name: string,
  keys: readonly IdKey[],
  issuer: string,
  nowMs: number,
): Promise<IdTokenClaims | null> {
  for (const token of readCookies(header, name)) {
    const claims = await verifyIdToken(token, keys, issuer, nowMs);
    if (claims) return claims;
  }
  return null;
}

/** The values of every cookie named `name` in a `Cookie` header. */
export function readCookies(header: string | null, name: string): string[] {
  if (!header) return [];
  const values: string[] = [];
  for (const part of header.split(";")) {
    const separator = part.indexOf("=");
    if (separator < 0) continue;
    if (part.slice(0, separator).trim() === name)
      values.push(part.slice(separator + 1).trim());
  }
  return values;
}

function encodeJson(value: unknown): string {
  return encodeBase64Url(encoder.encode(JSON.stringify(value)));
}

function decodeJson(value: string): Record<string, unknown> | null {
  const bytes = decodeBase64Url(value);
  if (!bytes) return null;
  try {
    const parsed: unknown = JSON.parse(decoder.decode(bytes));
    return typeof parsed === "object" &&
      parsed !== null &&
      !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

function encodeBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

function decodeBase64Url(value: string): Uint8Array<ArrayBuffer> | null {
  if (!/^[A-Za-z0-9_-]*$/.test(value)) return null;
  try {
    const binary = atob(value.replace(/-/g, "+").replace(/_/g, "/"));
    return Uint8Array.from(binary, (char) => char.charCodeAt(0));
  } catch {
    return null;
  }
}
