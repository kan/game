/**
 * ID cookies for games' tests: a key pair, the `ID_PUBLIC_KEYS` value that
 * accepts it, and cookies signed for any ID, as the ID platform signs them
 * (kan/game src/token.ts signIdToken).
 *
 * Copy this file unchanged from kan/game testing/. It imports nothing and
 * needs only Web Crypto. kan/game test/testing-kit.test.ts checks that the
 * real verifyIdCookie accepts what it makes.
 */

/** 400 days, as the ID platform signs (kan/game src/token.ts). */
const LIFETIME_SECONDS = 400 * 24 * 60 * 60;

export interface TestIdIssuerOptions {
  /** The `iss` claim and the issuer the game expects. Default: dev's. */
  issuer?: string;
  /** The cookie name the game reads. Default: dev's. */
  cookieName?: string;
  /** The key's `kid`. Default: "test-key". */
  kid?: string;
}

export interface TestTokenOptions {
  /** Overrides the issuer for this token, e.g. to test another issuer. */
  iss?: string;
  /** Signing time in ms; exp is 400 days later. Default: now. */
  nowMs?: number;
}

export interface TestIdIssuer {
  issuer: string;
  cookieName: string;
  kid: string;
  /** The value for the game's `ID_PUBLIC_KEYS`: a JSON array with this key. */
  publicKeys: string;
  /** The public JWK with `kid`, to combine several issuers' keys. */
  publicJwk: JsonWebKey & { kid: string };
  /**
   * A signed token for `sub`. The real verifier accepts only a UUID v4 `sub`
   * (use `crypto.randomUUID()`); any other value is signed as given, for
   * tests of refusal.
   */
  token(sub: string, options?: TestTokenOptions): Promise<string>;
  /** A `Cookie` header value carrying a signed token for `sub` (see token). */
  cookie(sub: string, options?: TestTokenOptions): Promise<string>;
}

/**
 * A fresh P-256 key pair and helpers that sign with it. For a cookie the game
 * must refuse because of an unknown key, make a second issuer and do not add
 * its key to `ID_PUBLIC_KEYS`.
 */
export async function createTestIdIssuer(
  options: TestIdIssuerOptions = {},
): Promise<TestIdIssuer> {
  const issuer = options.issuer ?? "dev.kan-game.app";
  const cookieName = options.cookieName ?? "__Secure-kgdev_id";
  const kid = options.kid ?? "test-key";
  const pair = (await crypto.subtle.generateKey(
    { name: "ECDSA", namedCurve: "P-256" },
    true,
    ["sign", "verify"],
  )) as CryptoKeyPair;
  const { kty, crv, x, y } = (await crypto.subtle.exportKey(
    "jwk",
    pair.publicKey,
  )) as JsonWebKey;
  const publicJwk = { kid, kty, crv, x, y };

  const token = async (sub: string, tokenOptions: TestTokenOptions = {}) => {
    const iat = Math.floor((tokenOptions.nowMs ?? Date.now()) / 1000);
    const header = { alg: "ES256", typ: "JWT", kid };
    const payload = {
      sub,
      iss: tokenOptions.iss ?? issuer,
      iat,
      exp: iat + LIFETIME_SECONDS,
    };
    const input = `${encodeJson(header)}.${encodeJson(payload)}`;
    const signature = await crypto.subtle.sign(
      { name: "ECDSA", hash: "SHA-256" },
      pair.privateKey,
      new TextEncoder().encode(input),
    );
    return `${input}.${encodeBase64Url(new Uint8Array(signature))}`;
  };

  return {
    issuer,
    cookieName,
    kid,
    publicKeys: JSON.stringify([publicJwk]),
    publicJwk,
    token,
    cookie: async (sub, tokenOptions) =>
      `${cookieName}=${await token(sub, tokenOptions)}`,
  };
}

function encodeJson(value: unknown): string {
  return encodeBase64Url(new TextEncoder().encode(JSON.stringify(value)));
}

function encodeBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}
