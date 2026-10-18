import { importSigningKey, importVerificationKeys, type IdKey } from "./token";

export interface IdKeys {
  signing: IdKey;
  verification: IdKey[];
}

// Imported once per isolate (TAKO-SEN docs/PERFORMANCE.md). Keyed by the raw
// values so tests that pass a different env get their own keys.
let cached: { source: string; keys: Promise<IdKeys> } | undefined;

export function loadKeys(env: Env): Promise<IdKeys> {
  const signingKey = env.ID_SIGNING_KEY;
  if (!signingKey)
    return Promise.reject(new Error("ID_SIGNING_KEY is not set"));
  const source = `${signingKey}\n${env.ID_PUBLIC_KEYS}`;
  if (cached?.source !== source) {
    const keys = Promise.all([
      importSigningKey(signingKey),
      importVerificationKeys(env.ID_PUBLIC_KEYS),
    ]).then(([signing, verification]) => {
      // Otherwise every issued cookie fails verification and each call
      // issues a new ID (docs/ID_DESIGN.md「鍵の管理」, rotation step 1).
      if (!verification.some((key) => key.kid === signing.kid))
        throw new Error(
          `ID_PUBLIC_KEYS lacks the signing key (kid ${signing.kid})`,
        );
      return { signing, verification };
    });
    // Do not keep a failed import; the next request retries.
    keys.catch(() => {
      if (cached?.keys === keys) cached = undefined;
    });
    cached = { source, keys };
  }
  return cached.keys;
}
