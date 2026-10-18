import { describe, expect, it } from "vitest";
import {
  importVerificationKeys,
  verifyIdCookie,
  verifyIdToken,
  type IdTokenClaims,
} from "../src/token";
import vectors from "../test-vectors/id-token.json";

/*
 * src/token.ts against test-vectors/id-token.json. Each game runs the same
 * checks against its copy of src/token.ts (docs/ID_DESIGN.md「鍵の管理」).
 */
const keys = await importVerificationKeys(JSON.stringify(vectors.keys));

describe("test vectors: tokens", () => {
  it.each(vectors.tokens)("$name", async ({ token, expected }) => {
    const claims: IdTokenClaims | null = await verifyIdToken(
      token,
      keys,
      vectors.issuer,
      vectors.now,
    );
    expect(claims).toEqual(expected);
  });
});

describe("test vectors: cookie headers", () => {
  it.each(vectors.cookies)("$name", async ({ header, expected }) => {
    const claims = await verifyIdCookie(
      header,
      vectors.cookieName,
      keys,
      vectors.issuer,
      vectors.now,
    );
    expect(claims?.sub ?? null).toBe(expected);
  });
});

it("the valid token stays valid for its whole lifetime from now", () => {
  const valid = vectors.tokens.find((vector) => vector.name === "valid");
  expect(valid?.expected?.exp).toBeGreaterThan(vectors.now / 1000);
});
