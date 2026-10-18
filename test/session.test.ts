import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import { LAST_SEEN_INTERVAL_MS } from "../src/session";
import {
  ID_TOKEN_LIFETIME_SECONDS,
  importSigningKey,
  signIdToken,
} from "../src/token";
import {
  COOKIE,
  call,
  cookieToken,
  issue,
  sessionRequest,
  uniqueIp,
  verifyToken as verify,
} from "./helpers";

/** Decoded independently of src/token.ts, so the test checks its encoding. */
function decodeHeader(token: string): { alg: string; kid: string } {
  const encoded = token.split(".")[0].replace(/-/g, "+").replace(/_/g, "/");
  return JSON.parse(atob(encoded));
}

async function idRow(id: string) {
  return env.DB.prepare("SELECT * FROM ids WHERE id = ?")
    .bind(id)
    .first<{ status: string; created_at: number; last_seen_at: number }>();
}

describe("POST /api/id/session: issuing", () => {
  it("issues a new ID with a signed cookie when there is no cookie", async () => {
    const response = await call(sessionRequest());
    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    const body = await response.json<{
      id: string;
      name: null;
      status: string;
    }>();
    expect(body).toEqual({
      id: expect.any(String),
      name: null,
      status: "active",
    });
    expect(body.id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );

    const setCookie = response.headers.get("Set-Cookie")!;
    expect(setCookie).toMatch(new RegExp(`^${COOKIE}=`));
    expect(setCookie).toContain(
      "; Domain=kan-game.app; Path=/; Max-Age=34560000; Secure; HttpOnly; SameSite=Lax",
    );

    const token = cookieToken(response)!;
    expect(decodeHeader(token)).toMatchObject({
      alg: "ES256",
      kid: "test-current",
    });
    const claims = await verify(token);
    expect(claims).toMatchObject({ sub: body.id, iss: "dev.kan-game.app" });
    expect(claims!.exp - claims!.iat).toBe(ID_TOKEN_LIFETIME_SECONDS);

    const row = await idRow(body.id);
    expect(row).toMatchObject({ status: "active" });
    expect(row!.last_seen_at).toBe(row!.created_at);
  });

  it("omits Domain when COOKIE_DOMAIN is empty (local)", async () => {
    const response = await call(sessionRequest(), { COOKIE_DOMAIN: "" });
    expect(response.headers.get("Set-Cookie")).not.toContain("Domain=");
  });

  it.each([
    ["a malformed token", async () => "not-a-jwt"],
    [
      "a token signed by an unknown key",
      async () =>
        signIdToken(
          await importSigningKey(env.TEST_UNKNOWN_SIGNING_KEY),
          { sub: crypto.randomUUID(), iss: env.ISSUER },
          Date.now(),
        ),
    ],
    [
      "a token from another issuer",
      async () =>
        signIdToken(
          await importSigningKey(env.ID_SIGNING_KEY!),
          { sub: crypto.randomUUID(), iss: "kan-game.app" },
          Date.now(),
        ),
    ],
    [
      "an expired token",
      async () =>
        signIdToken(
          await importSigningKey(env.ID_SIGNING_KEY!),
          { sub: crypto.randomUUID(), iss: env.ISSUER },
          Date.now() - (ID_TOKEN_LIFETIME_SECONDS + 1) * 1000,
        ),
    ],
  ])("issues a new ID for %s", async (_, makeToken) => {
    const token = await makeToken();
    const response = await call(
      sessionRequest({ cookie: `${COOKIE}=${token}` }),
    );
    expect(response.status).toBe(200);
    const body = await response.json<{ id: string }>();
    expect(await idRow(body.id)).not.toBeNull();
    expect(cookieToken(response)).not.toBe(token);
  });

  it("rejects a token whose signature was tampered with", async () => {
    const { id, token } = await issue();
    const [header, payload, signature] = token.split(".");
    const flipped = signature[0] === "A" ? "B" : "A";
    const tampered = `${header}.${payload}.${flipped}${signature.slice(1)}`;
    const response = await call(
      sessionRequest({ cookie: `${COOKIE}=${tampered}` }),
    );
    const body = await response.json<{ id: string }>();
    expect(body.id).not.toBe(id);
  });

  it("limits issuing to 10 per minute per IP", async () => {
    const ip = uniqueIp();
    for (let i = 0; i < 10; i++) {
      expect((await call(sessionRequest({ ip }))).status).toBe(200);
    }
    const limited = await call(sessionRequest({ ip }));
    expect(limited.status).toBe(429);
    expect(await limited.json()).toEqual({ error: "rate_limited" });
    expect(limited.headers.get("Set-Cookie")).toBeNull();
  });
});

describe("POST /api/id/session: extending", () => {
  it("re-signs the cookie of a known ID without issuing a new one", async () => {
    const { id, token } = await issue();
    const before = await env.DB.prepare("SELECT COUNT(*) AS n FROM ids").first<{
      n: number;
    }>();
    const response = await call(
      sessionRequest({ cookie: `other=1; ${COOKIE}=${token}` }),
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ id, name: null, status: "active" });
    const renewed = cookieToken(response)!;
    expect((await verify(renewed))!.sub).toBe(id);
    const after = await env.DB.prepare("SELECT COUNT(*) AS n FROM ids").first<{
      n: number;
    }>();
    expect(after!.n).toBe(before!.n);
  });

  it("extends even when the issuing rate limit is used up", async () => {
    const ip = uniqueIp();
    const { token } = await issue();
    for (let i = 0; i < 10; i++) await call(sessionRequest({ ip }));
    const response = await call(
      sessionRequest({ ip, cookie: `${COOKIE}=${token}` }),
    );
    expect(response.status).toBe(200);
  });

  it("returns the registered name", async () => {
    const { id, token } = await issue();
    await env.DB.prepare(
      "INSERT INTO names (id, display_name, created_at) VALUES (?, ?, ?)",
    )
      .bind(id, "たこ", Date.now())
      .run();
    const response = await call(
      sessionRequest({ cookie: `${COOKIE}=${token}` }),
    );
    expect(await response.json()).toEqual({
      id,
      name: "たこ",
      status: "active",
    });
  });

  it("returns status deleting for an ID in the middle of deletion", async () => {
    const { id, token } = await issue();
    await env.DB.prepare("UPDATE ids SET status = 'deleting' WHERE id = ?")
      .bind(id)
      .run();
    const response = await call(
      sessionRequest({ cookie: `${COOKIE}=${token}` }),
    );
    expect(await response.json()).toEqual({
      id,
      name: null,
      status: "deleting",
    });
  });

  it("updates last_seen_at at most once a day", async () => {
    const { id, token } = await issue();
    const recent = Date.now() - LAST_SEEN_INTERVAL_MS + 60_000;
    await env.DB.prepare("UPDATE ids SET last_seen_at = ? WHERE id = ?")
      .bind(recent, id)
      .run();
    await call(sessionRequest({ cookie: `${COOKIE}=${token}` }));
    expect((await idRow(id))!.last_seen_at).toBe(recent);

    const stale = Date.now() - LAST_SEEN_INTERVAL_MS;
    await env.DB.prepare("UPDATE ids SET last_seen_at = ? WHERE id = ?")
      .bind(stale, id)
      .run();
    await call(sessionRequest({ cookie: `${COOKIE}=${token}` }));
    expect((await idRow(id))!.last_seen_at).toBeGreaterThan(stale);
  });

  it("accepts a cookie signed by a retired key and re-signs it with the current key", async () => {
    const id = crypto.randomUUID();
    await env.DB.prepare(
      "INSERT INTO ids (id, created_at, last_seen_at) VALUES (?, ?, ?)",
    )
      .bind(id, Date.now(), Date.now())
      .run();
    const old = await signIdToken(
      await importSigningKey(env.TEST_PREVIOUS_SIGNING_KEY),
      { sub: id, iss: env.ISSUER },
      Date.now(),
    );
    const response = await call(sessionRequest({ cookie: `${COOKIE}=${old}` }));
    expect((await response.json<{ id: string }>()).id).toBe(id);
    expect(decodeHeader(cookieToken(response)!)).toMatchObject({
      kid: "test-current",
    });
  });
});

describe("POST /api/id/session: several cookies with the ID name", () => {
  it("uses the valid one even when an invalid one comes first", async () => {
    const { id, token } = await issue();
    const response = await call(
      sessionRequest({ cookie: `${COOKIE}=stale; ${COOKIE}=${token}` }),
    );
    expect((await response.json<{ id: string }>()).id).toBe(id);
  });
});

describe("POST /api/id/session: deleted IDs", () => {
  it("clears the cookie and issues nothing for a validly signed but deleted ID", async () => {
    const { id, token } = await issue();
    await env.DB.prepare("DELETE FROM ids WHERE id = ?").bind(id).run();
    const before = await env.DB.prepare("SELECT COUNT(*) AS n FROM ids").first<{
      n: number;
    }>();

    const response = await call(
      sessionRequest({ cookie: `${COOKIE}=${token}` }),
    );
    expect(response.status).toBe(410);
    expect(await response.json()).toEqual({ error: "id_deleted" });
    expect(response.headers.get("Set-Cookie")).toBe(
      `${COOKIE}=; Domain=kan-game.app; Path=/; Max-Age=0; Secure; HttpOnly; SameSite=Lax`,
    );
    const after = await env.DB.prepare("SELECT COUNT(*) AS n FROM ids").first<{
      n: number;
    }>();
    expect(after!.n).toBe(before!.n);

    // Without the cookie, the next call issues a new ID.
    const next = await call(sessionRequest());
    expect((await next.json<{ id: string }>()).id).not.toBe(id);
  });
});

describe("/api/id/* routing", () => {
  it.each([
    ["no Origin", null],
    ["another site's Origin", "https://example.com"],
    ["the production Origin on dev", "https://kan-game.app"],
  ])("refuses %s with 403", async (_, origin) => {
    const response = await call(sessionRequest({ origin }));
    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ error: "origin_not_allowed" });
    expect(response.headers.get("Set-Cookie")).toBeNull();
  });

  it("refuses methods other than POST", async () => {
    const response = await call(sessionRequest({ method: "GET" }));
    expect(response.status).toBe(405);
    expect(response.headers.get("Allow")).toBe("POST");
  });

  it("fails instead of signing cookies that ID_PUBLIC_KEYS cannot verify", async () => {
    const withoutCurrent = JSON.stringify(
      (JSON.parse(env.ID_PUBLIC_KEYS) as { kid: string }[]).filter(
        (key) => key.kid !== "test-current",
      ),
    );
    await expect(
      call(sessionRequest(), { ID_PUBLIC_KEYS: withoutCurrent }),
    ).rejects.toThrow("ID_PUBLIC_KEYS lacks the signing key");
  });

  it("returns 404 for unknown paths", async () => {
    const response = await call(
      new Request("https://dev.kan-game.app/api/id/unknown", {
        method: "POST",
      }),
    );
    expect(response.status).toBe(404);
  });
});
