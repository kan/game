import { cloudflareTest, readD1Migrations } from "@cloudflare/vitest-plugin";
import { defineConfig } from "vitest/config";

/** A fresh P-256 key pair per run, so no private key lives in the repository. */
async function generateKeyPair(kid: string) {
  const pair = (await crypto.subtle.generateKey(
    { name: "ECDSA", namedCurve: "P-256" },
    true,
    ["sign", "verify"],
  )) as CryptoKeyPair;
  const { kty, crv, x, y, d } = (await crypto.subtle.exportKey(
    "jwk",
    pair.privateKey,
  )) as JsonWebKey;
  return {
    privateJwk: { kid, kty, crv, x, y, d },
    publicJwk: { kid, kty, crv, x, y },
  };
}

export default defineConfig(async () => {
  const current = await generateKeyPair("test-current");
  // Retired from signing but still accepted, as during a key rotation.
  const previous = await generateKeyPair("test-previous");
  // Not in ID_PUBLIC_KEYS: a cookie signed with it must be rejected.
  const unknown = await generateKeyPair("test-unknown");
  const migrations = await readD1Migrations("./migrations");

  return {
    plugins: [
      cloudflareTest({
        wrangler: { configPath: "./wrangler.jsonc" },
        miniflare: {
          bindings: {
            ID_SIGNING_KEY: JSON.stringify(current.privateJwk),
            ID_PUBLIC_KEYS: JSON.stringify([
              current.publicJwk,
              previous.publicJwk,
            ]),
            ALLOWED_ORIGINS:
              "https://dev.kan-game.app,https://tako-dev.kan-game.app",
            COOKIE_DOMAIN: "kan-game.app",
            ISSUER: "dev.kan-game.app",
            TEST_PREVIOUS_SIGNING_KEY: JSON.stringify(previous.privateJwk),
            TEST_UNKNOWN_SIGNING_KEY: JSON.stringify(unknown.privateJwk),
            TEST_MIGRATIONS: migrations,
          },
        },
      }),
    ],
    test: {
      setupFiles: ["./test/apply-migrations.ts"],
    },
  };
});
