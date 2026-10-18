import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import { deleteExpiredRows } from "../src/maintenance";
import { CODE_ALPHABET } from "../src/codes";
import { TRANSFER_CODE_LIFETIME_MS } from "../src/transfer";
import {
  COOKIE,
  apiRequest,
  call,
  cookieToken,
  issue,
  uniqueIp,
  verifyToken,
  type ApiRequestOptions,
} from "./helpers";

function issueCodeRequest(cookie?: string) {
  return apiRequest("/api/id/transfer-codes", { cookie });
}

function redeemRequest(
  body: unknown,
  options: Omit<ApiRequestOptions, "body"> = {},
) {
  return apiRequest("/api/id/transfer-codes/redeem", { ...options, body });
}

async function issueCode(cookie: string): Promise<string> {
  const response = await call(issueCodeRequest(cookie));
  expect(response.status).toBe(200);
  return (await response.json<{ code: string }>()).code;
}

async function tokenSubject(response: Response): Promise<string | undefined> {
  return (await verifyToken(cookieToken(response)!))?.sub;
}

describe("POST /api/id/transfer-codes", () => {
  it("issues an 8-symbol code valid for 10 minutes", async () => {
    const { id, cookie } = await issue();
    const before = Date.now();
    const response = await call(issueCodeRequest(cookie));
    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    const body = await response.json<{ code: string; expiresAt: number }>();
    expect(body.code).toHaveLength(8);
    for (const char of body.code) expect(CODE_ALPHABET).toContain(char);
    expect(body.expiresAt).toBeGreaterThanOrEqual(
      before + TRANSFER_CODE_LIFETIME_MS,
    );
    expect(body.expiresAt).toBeLessThanOrEqual(
      Date.now() + TRANSFER_CODE_LIFETIME_MS,
    );
    const row = await env.DB.prepare(
      "SELECT id, expires_at FROM transfer_codes WHERE code = ?",
    )
      .bind(body.code)
      .first();
    expect(row).toEqual({ id, expires_at: body.expiresAt });
  });

  it("refuses a request without a valid cookie with 401 no_id", async () => {
    for (const cookie of [undefined, `${COOKIE}=not-a-jwt`]) {
      const response = await call(issueCodeRequest(cookie));
      expect(response.status).toBe(401);
      expect(await response.json()).toEqual({ error: "no_id" });
    }
  });

  it("refuses a deleted ID with 410 and clears its cookie", async () => {
    const { id, cookie } = await issue();
    await env.DB.prepare("DELETE FROM ids WHERE id = ?").bind(id).run();
    const response = await call(issueCodeRequest(cookie));
    expect(response.status).toBe(410);
    expect(await response.json()).toEqual({ error: "id_deleted" });
    expect(response.headers.get("Set-Cookie")).toMatch(/Max-Age=0/);
  });

  it("replaces the ID's earlier code", async () => {
    const { id, cookie } = await issue();
    const first = await issueCode(cookie);
    const second = await issueCode(cookie);
    const codes = await env.DB.prepare(
      "SELECT code FROM transfer_codes WHERE id = ?",
    )
      .bind(id)
      .all<{ code: string }>();
    expect(codes.results).toEqual([{ code: second }]);
    const response = await call(redeemRequest({ code: first }));
    expect(response.status).toBe(400);
  });

  it("refuses an ID in the middle of deletion with 409", async () => {
    const { id, cookie } = await issue();
    await env.DB.prepare("UPDATE ids SET status = 'deleting' WHERE id = ?")
      .bind(id)
      .run();
    const response = await call(issueCodeRequest(cookie));
    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({ error: "id_deleting" });
    const codes = await env.DB.prepare(
      "SELECT COUNT(*) AS n FROM transfer_codes WHERE id = ?",
    )
      .bind(id)
      .first<{ n: number }>();
    expect(codes!.n).toBe(0);
  });

  it("clears expired codes of other IDs so a new code cannot collide with them", async () => {
    const other = await issue();
    await env.DB.prepare(
      "INSERT INTO transfer_codes (code, id, expires_at) VALUES (?, ?, ?)",
    )
      .bind("STALE234", other.id, Date.now() - 1)
      .run();
    const { cookie } = await issue();
    await issueCode(cookie);
    const stale = await env.DB.prepare(
      "SELECT code FROM transfer_codes WHERE code = ?",
    )
      .bind("STALE234")
      .first();
    expect(stale).toBeNull();
  });

  it("refuses other sites", async () => {
    const { cookie } = await issue();
    const response = await call(
      apiRequest("/api/id/transfer-codes", {
        cookie,
        origin: "https://example.com",
      }),
    );
    expect(response.status).toBe(403);
  });
});

describe("POST /api/id/transfer-codes/redeem", () => {
  it("switches the device's cookie to the issuing ID", async () => {
    const source = await issue();
    await env.DB.prepare(
      "INSERT INTO names (id, display_name, created_at) VALUES (?, ?, ?)",
    )
      .bind(source.id, "引き継ぎ元", Date.now())
      .run();
    const code = await issueCode(source.cookie);
    const target = await issue();

    const response = await call(
      redeemRequest({ code }, { cookie: target.cookie }),
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      id: source.id,
      name: "引き継ぎ元",
      status: "active",
    });
    expect(await tokenSubject(response)).toBe(source.id);
    // The device's previous ID stays; nothing is merged or deleted.
    const previous = await env.DB.prepare("SELECT id FROM ids WHERE id = ?")
      .bind(target.id)
      .first();
    expect(previous).not.toBeNull();
  });

  it("works on a device without an ID", async () => {
    const source = await issue();
    const code = await issueCode(source.cookie);
    const response = await call(redeemRequest({ code }));
    expect(response.status).toBe(200);
    expect(await tokenSubject(response)).toBe(source.id);
  });

  it("accepts lower case and the spaces and hyphens people add", async () => {
    const source = await issue();
    const code = await issueCode(source.cookie);
    const typed = `${code.slice(0, 4)}- ${code.slice(4)}`.toLowerCase();
    const response = await call(redeemRequest({ code: typed }));
    expect(response.status).toBe(200);
  });

  it("accepts full-width letters and hyphens typed with a Japanese IME", async () => {
    const source = await issue();
    const code = await issueCode(source.cookie);
    const fullWidth = (s: string) =>
      Array.from(s, (c) => String.fromCharCode(c.charCodeAt(0) + 0xfee0)).join(
        "",
      );
    const typed = `${fullWidth(code.slice(0, 4))}－${fullWidth(code.slice(4))}`;
    const response = await call(redeemRequest({ code: typed }));
    expect(response.status).toBe(200);
  });

  it("works only once", async () => {
    const source = await issue();
    const code = await issueCode(source.cookie);
    expect((await call(redeemRequest({ code }))).status).toBe(200);
    const again = await call(redeemRequest({ code }));
    expect(again.status).toBe(400);
    expect(await again.json()).toEqual({ error: "invalid_code" });
  });

  it("refuses an expired code", async () => {
    const source = await issue();
    const code = await issueCode(source.cookie);
    await env.DB.prepare(
      "UPDATE transfer_codes SET expires_at = ? WHERE code = ?",
    )
      .bind(Date.now() - 1, code)
      .run();
    const response = await call(redeemRequest({ code }));
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "invalid_code" });
  });

  it("refuses, without using up, the code of an ID whose deletion began since", async () => {
    const source = await issue();
    const code = await issueCode(source.cookie);
    await env.DB.prepare("UPDATE ids SET status = 'deleting' WHERE id = ?")
      .bind(source.id)
      .run();
    const response = await call(redeemRequest({ code }));
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "invalid_code" });
    const left = await env.DB.prepare(
      "SELECT code FROM transfer_codes WHERE code = ?",
    )
      .bind(code)
      .first();
    expect(left).toEqual({ code });
  });

  it("refuses the code of an ID deleted since", async () => {
    const source = await issue();
    const code = await issueCode(source.cookie);
    await env.DB.prepare("DELETE FROM ids WHERE id = ?").bind(source.id).run();
    const response = await call(redeemRequest({ code }));
    expect(response.status).toBe(400);
  });

  it.each([
    ["a wrong code", { code: "ZZZZZZZZ" }, "invalid_code"],
    ["a code with a confusable symbol", { code: "0OOO1III" }, "invalid_code"],
    ["a code of the wrong length", { code: "ABCDEFG" }, "invalid_code"],
    ["no code", {}, "invalid_code"],
    ["a body that is not JSON", "code=ABCDEFGH", "invalid_request"],
    ["a JSON array", ["ABCDEFGH"], "invalid_request"],
  ])("refuses %s with 400", async (_, body, code) => {
    const response = await call(redeemRequest(body));
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: code });
    expect(response.headers.get("Set-Cookie")).toBeNull();
  });

  it("limits attempts to 5 per minute per IP, separately from issuing IDs", async () => {
    const ip = uniqueIp();
    for (let i = 0; i < 5; i++) {
      const response = await call(redeemRequest({ code: "ZZZZZZZZ" }, { ip }));
      expect(response.status).toBe(400);
    }
    const source = await issue();
    const code = await issueCode(source.cookie);
    const limited = await call(redeemRequest({ code }, { ip }));
    expect(limited.status).toBe(429);
    expect(await limited.json()).toEqual({ error: "rate_limited" });
    // The code was not used up by the refused attempt.
    expect((await call(redeemRequest({ code }))).status).toBe(200);
    // Issuing an ID from the same IP has its own limit.
    expect((await call(apiRequest("/api/id/session", { ip }))).status).toBe(
      200,
    );
  });
});

describe("daily cleanup", () => {
  it("deletes expired transfer codes and migration tokens only", async () => {
    const { id } = await issue();
    const now = Date.now();
    await env.DB.batch([
      env.DB.prepare(
        "INSERT INTO transfer_codes (code, id, expires_at) VALUES (?, ?, ?), (?, ?, ?)",
      ).bind("EXP1RED2", id, now - 1, "LIVECODE", id, now + 60_000),
      env.DB.prepare(
        "INSERT INTO migration_tokens (token_hash, id, expires_at) VALUES (?, ?, ?), (?, ?, ?)",
      ).bind("expired-hash", id, now - 1, "live-hash", id, now + 60_000),
    ]);

    await deleteExpiredRows(env.DB, Date.now());

    const codes = await env.DB.prepare(
      "SELECT code FROM transfer_codes WHERE id = ?",
    )
      .bind(id)
      .all();
    expect(codes.results).toEqual([{ code: "LIVECODE" }]);
    const tokens = await env.DB.prepare(
      "SELECT token_hash FROM migration_tokens WHERE id = ?",
    )
      .bind(id)
      .all();
    expect(tokens.results).toEqual([{ token_hash: "live-hash" }]);
  });
});
