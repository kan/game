import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import { hashSecret } from "../src/codes";
import {
  apiRequest,
  call,
  cookieToken,
  issue,
  uniqueIp,
  verifyToken,
  type ApiRequestOptions,
} from "./helpers";

/** A token as the migration script makes it: 32 random bytes in base64url. */
function newToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

async function register(
  id: string,
  expiresAt = Date.now() + 60_000,
): Promise<string> {
  const token = newToken();
  await env.DB.prepare(
    "INSERT INTO migration_tokens (token_hash, id, expires_at) VALUES (?, ?, ?)",
  )
    .bind(await hashSecret(token), id, expiresAt)
    .run();
  return token;
}

function redeemRequest(
  body: unknown,
  options: Omit<ApiRequestOptions, "body"> = {},
) {
  return apiRequest("/api/id/migration/redeem", { ...options, body });
}

describe("POST /api/id/migration/redeem", () => {
  it("switches the device's cookie, from a game's origin, on any number of devices", async () => {
    const source = await issue();
    const token = await register(source.id);
    const target = await issue();
    for (const cookie of [target.cookie, undefined]) {
      const response = await call(redeemRequest({ token }, { cookie }));
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({
        id: source.id,
        name: null,
        status: "active",
      });
      expect((await verifyToken(cookieToken(response)!))?.sub).toBe(source.id);
    }
  });

  it("refuses an expired token", async () => {
    const source = await issue();
    const token = await register(source.id, Date.now() - 1);
    const response = await call(redeemRequest({ token }));
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "invalid_code" });
  });

  it("refuses the token of an ID in the middle of deletion", async () => {
    const source = await issue();
    const token = await register(source.id);
    await env.DB.prepare("UPDATE ids SET status = 'deleting' WHERE id = ?")
      .bind(source.id)
      .run();
    expect((await call(redeemRequest({ token }))).status).toBe(400);
  });

  it.each([
    ["an unregistered token", { token: newToken() }, "invalid_code"],
    ["a token with padding", { token: `${newToken()}=` }, "invalid_code"],
    ["a token of the wrong length", { token: "abc" }, "invalid_code"],
    ["a code instead of a token", { code: newToken() }, "invalid_code"],
    ["a body that is not JSON", "nope", "invalid_request"],
  ])("refuses %s with 400", async (_, body, code) => {
    const response = await call(redeemRequest(body));
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: code });
  });

  it("limits attempts to 5 per minute per IP", async () => {
    const ip = uniqueIp();
    for (let i = 0; i < 5; i++) {
      await call(redeemRequest({ token: newToken() }, { ip }));
    }
    const limited = await call(redeemRequest({ token: newToken() }, { ip }));
    expect(limited.status).toBe(429);
  });
});
