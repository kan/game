#!/usr/bin/env node
// Generates test-vectors/id-token.json: fixed tokens and the result each game's
// copy of src/token.ts must give (docs/ID_DESIGN.md「鍵の管理」).
//
//   npm run generate-vectors
//
// Imports src/token.ts directly, which needs Node's type stripping (22.18+).
//
// The private keys exist only while this runs; the file holds public keys.
// ECDSA signatures are randomized, so running it again changes every token,
// and adding a case means regenerating the whole file. See AGENTS.md for when
// to regenerate.
import { writeFileSync } from "node:fs";
import { ID_TOKEN_LIFETIME_SECONDS, signIdToken } from "../src/token.ts";

const ISSUER = "dev.kan-game.app";
// Fixed "now" for verifying the vectors: 2026-10-18T00:00:00Z.
const NOW = Date.UTC(2026, 9, 18);
const DAY = 24 * 60 * 60 * 1000;
const SUB = "3f8e2a4c-1b7d-4e9a-9c2f-6d5b8a1e0f34";

async function keyPair(kid) {
  const pair = await crypto.subtle.generateKey(
    { name: "ECDSA", namedCurve: "P-256" },
    true,
    ["sign", "verify"],
  );
  const { kty, crv, x, y } = await crypto.subtle.exportKey(
    "jwk",
    pair.publicKey,
  );
  return {
    signing: { kid, key: pair.privateKey },
    publicJwk: { kid, kty, crv, x, y },
  };
}

function base64Url(text) {
  return Buffer.from(text).toString("base64url");
}

/** Replaces a signed token's header, keeping payload and signature. */
function withHeader(token, header) {
  const [, payload, signature] = token.split(".");
  return `${base64Url(JSON.stringify(header))}.${payload}.${signature}`;
}

/** Signs any header and payload, for tokens signIdToken would not make. */
async function signRaw(signing, header, payload) {
  const input = `${base64Url(JSON.stringify(header))}.${base64Url(JSON.stringify(payload))}`;
  const signature = await crypto.subtle.sign(
    { name: "ECDSA", hash: "SHA-256" },
    signing.key,
    new TextEncoder().encode(input),
  );
  return `${input}.${Buffer.from(signature).toString("base64url")}`;
}

function claimsOf(token) {
  return JSON.parse(Buffer.from(token.split(".")[1], "base64url").toString());
}

const known = await keyPair("vector-key");
// Listed in keys too, as a retired key is during a key rotation.
const previous = await keyPair("vector-previous");
const unknown = await keyPair("vector-unknown");
const sign = (key, claims, at) => signIdToken(key, claims, at);
const claims = { sub: SUB, iss: ISSUER };
const header = { alg: "ES256", typ: "JWT", kid: "vector-key" };

const valid = await sign(known.signing, claims, NOW - DAY);
const [validHeader, validPayload, validSignature] = valid.split(".");
const flipped = validSignature[0] === "A" ? "B" : "A";
const byPrevious = await sign(previous.signing, claims, NOW - DAY);
// signIdToken sets exp to iat + 400 days, so these expire exactly at now and
// one second after it.
const lifetimeMs = ID_TOKEN_LIFETIME_SECONDS * 1000;
const expiresAtNow = await sign(known.signing, claims, NOW - lifetimeMs);
const expiresAfterNow = await sign(
  known.signing,
  claims,
  NOW - lifetimeMs + 1000,
);

const tokenCases = [
  { name: "valid", token: valid, expected: claimsOf(valid) },
  {
    name: "valid, signed by the second key (a key rotation)",
    token: byPrevious,
    expected: claimsOf(byPrevious),
  },
  {
    name: "exp is one second after now",
    token: expiresAfterNow,
    expected: claimsOf(expiresAfterNow),
  },
  { name: "exp is exactly now", token: expiresAtNow, expected: null },
  {
    name: "expired (signed 401 days before now)",
    token: await sign(
      known.signing,
      { sub: SUB, iss: ISSUER },
      NOW - 401 * DAY,
    ),
    expected: null,
  },
  {
    name: "another issuer",
    token: await sign(
      known.signing,
      { sub: SUB, iss: "kan-game.app" },
      NOW - DAY,
    ),
    expected: null,
  },
  {
    name: "unknown kid",
    token: await sign(unknown.signing, { sub: SUB, iss: ISSUER }, NOW - DAY),
    expected: null,
  },
  {
    name: "known kid, signed by another key",
    token: withHeader(
      await sign(unknown.signing, { sub: SUB, iss: ISSUER }, NOW - DAY),
      { alg: "ES256", typ: "JWT", kid: "vector-key" },
    ),
    expected: null,
  },
  {
    name: "tampered signature",
    token: `${validHeader}.${validPayload}.${flipped}${validSignature.slice(1)}`,
    expected: null,
  },
  {
    name: "tampered payload",
    token: `${validHeader}.${base64Url(
      JSON.stringify({
        ...JSON.parse(Buffer.from(validPayload, "base64url").toString()),
        sub: "00000000-0000-4000-8000-000000000000",
      }),
    )}.${validSignature}`,
    expected: null,
  },
  {
    name: "alg none",
    token: withHeader(valid, { alg: "none", typ: "JWT", kid: "vector-key" }),
    expected: null,
  },
  {
    name: "alg HS256",
    token: withHeader(valid, { alg: "HS256", typ: "JWT", kid: "vector-key" }),
    expected: null,
  },
  {
    name: "subject is not a UUID v4",
    token: await sign(
      known.signing,
      { sub: "not-a-uuid", iss: ISSUER },
      NOW - DAY,
    ),
    expected: null,
  },
  {
    name: "kid is not a string",
    token: withHeader(valid, { ...header, kid: 1 }),
    expected: null,
  },
  {
    name: "no iat",
    token: await signRaw(known.signing, header, {
      sub: SUB,
      iss: ISSUER,
      exp: NOW / 1000 + DAY / 1000,
    }),
    expected: null,
  },
  {
    name: "signature one byte short",
    token: `${validHeader}.${validPayload}.${Buffer.from(validSignature, "base64url").subarray(0, 63).toString("base64url")}`,
    expected: null,
  },
  {
    name: "two parts",
    token: `${validHeader}.${validPayload}`,
    expected: null,
  },
  { name: "empty", token: "", expected: null },
];

const COOKIE = "__Secure-kgdev_id";
const cookieCases = [
  {
    name: "the only cookie",
    header: `${COOKIE}=${valid}`,
    expected: SUB,
  },
  {
    name: "among other cookies",
    header: `theme=dark; ${COOKIE}=${valid}; lang=ja`,
    expected: SUB,
  },
  {
    name: "an invalid copy before the valid one",
    header: `${COOKIE}=stale; ${COOKIE}=${valid}`,
    expected: SUB,
  },
  {
    name: "the valid copy before an invalid one",
    header: `${COOKIE}=${valid}; ${COOKIE}=stale`,
    expected: SUB,
  },
  {
    name: "a cookie whose name only ends with the ID cookie's name",
    header: `x${COOKIE}=${valid}`,
    expected: null,
  },
  {
    name: "a cookie whose name only starts with the ID cookie's name",
    header: `${COOKIE}_old=${valid}`,
    expected: null,
  },
  { name: "no cookie header", header: null, expected: null },
];

const vectors = {
  description:
    "Test vectors for copies of src/token.ts. Verify each token with the keys, issuer and now given here; each cookie header with cookieName.",
  issuer: ISSUER,
  now: NOW,
  cookieName: COOKIE,
  keys: [known.publicJwk, previous.publicJwk],
  tokens: tokenCases,
  cookies: cookieCases,
};

writeFileSync(
  new URL("../test-vectors/id-token.json", import.meta.url),
  `${JSON.stringify(vectors, null, 2)}\n`,
);
console.log(
  `Wrote test-vectors/id-token.json (${tokenCases.length} tokens, ${cookieCases.length} cookie headers).`,
);
