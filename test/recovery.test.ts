import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import { CODE_ALPHABET, hashSecret } from "../src/codes";
import {
  GAME_ORIGIN,
  PORTAL_ORIGIN,
  apiRequest,
  call,
  cookieToken,
  issue,
  uniqueIp,
  verifyToken,
  type ApiRequestOptions,
} from "./helpers";

function issueRequest(cookie?: string, origin: string = PORTAL_ORIGIN) {
  return apiRequest("/api/id/recovery-code", { cookie, origin });
}

function redeemRequest(
  body: unknown,
  options: Omit<ApiRequestOptions, "body"> = {},
) {
  return apiRequest("/api/id/recovery-code/redeem", {
    origin: PORTAL_ORIGIN,
    ...options,
    body,
  });
}

async function issueRecoveryCode(cookie: string): Promise<string> {
  const response = await call(issueRequest(cookie));
  expect(response.status).toBe(200);
  return (await response.json<{ code: string }>()).code;
}

async function tokenSubject(response: Response): Promise<string | undefined> {
  return (await verifyToken(cookieToken(response)!))?.sub;
}

describe("POST /api/id/recovery-code", () => {
  it("issues a 20-symbol code and stores only its hash", async () => {
    const { id, cookie } = await issue();
    const response = await call(issueRequest(cookie));
    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    const { code } = await response.json<{ code: string }>();
    expect(code).toHaveLength(20);
    for (const char of code) expect(CODE_ALPHABET).toContain(char);

    const row = await env.DB.prepare(
      "SELECT code_hash FROM recovery_codes WHERE id = ?",
    )
      .bind(id)
      .first<{ code_hash: string }>();
    expect(row!.code_hash).toBe(await hashSecret(code));
    expect(row!.code_hash).not.toContain(code);
  });

  it("replaces the previous code when reissued", async () => {
    const { cookie } = await issue();
    const first = await issueRecoveryCode(cookie);
    const second = await issueRecoveryCode(cookie);
    expect(second).not.toBe(first);
    expect((await call(redeemRequest({ code: first }))).status).toBe(400);
    expect((await call(redeemRequest({ code: second }))).status).toBe(200);
  });

  it("is refused outside the portal", async () => {
    const { cookie } = await issue();
    const response = await call(issueRequest(cookie, GAME_ORIGIN));
    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ error: "origin_not_allowed" });
  });

  it("requires an ID", async () => {
    const response = await call(issueRequest());
    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: "no_id" });
  });

  it("refuses an ID in the middle of deletion with 409", async () => {
    const { id, cookie } = await issue();
    await env.DB.prepare("UPDATE ids SET status = 'deleting' WHERE id = ?")
      .bind(id)
      .run();
    const response = await call(issueRequest(cookie));
    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({ error: "id_deleting" });
  });
});

describe("POST /api/id/recovery-code/redeem", () => {
  it("switches the device's cookie to the code's ID, and keeps working", async () => {
    const source = await issue();
    await env.DB.prepare(
      "INSERT INTO names (id, display_name, created_at) VALUES (?, ?, ?)",
    )
      .bind(source.id, "復旧元", Date.now())
      .run();
    const code = await issueRecoveryCode(source.cookie);

    for (let i = 0; i < 2; i++) {
      const response = await call(redeemRequest({ code }));
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({
        id: source.id,
        name: "復旧元",
        status: "active",
      });
      expect(await tokenSubject(response)).toBe(source.id);
    }
  });

  it("accepts the code as shown, in groups of four, in lower or full width", async () => {
    const source = await issue();
    const code = await issueRecoveryCode(source.cookie);
    const grouped = code.match(/.{4}/g)!.join("-");
    expect((await call(redeemRequest({ code: grouped }))).status).toBe(200);
    const lower = code.match(/.{4}/g)!.join(" ").toLowerCase();
    expect((await call(redeemRequest({ code: lower }))).status).toBe(200);
    const fullWidth = Array.from(code, (c) =>
      String.fromCharCode(c.charCodeAt(0) + 0xfee0),
    ).join("");
    expect((await call(redeemRequest({ code: fullWidth }))).status).toBe(200);
  });

  it("is refused outside the portal", async () => {
    const source = await issue();
    const code = await issueRecoveryCode(source.cookie);
    const response = await call(
      redeemRequest({ code }, { origin: GAME_ORIGIN }),
    );
    expect(response.status).toBe(403);
  });

  it("refuses the code of an ID in the middle of deletion", async () => {
    const source = await issue();
    const code = await issueRecoveryCode(source.cookie);
    await env.DB.prepare("UPDATE ids SET status = 'deleting' WHERE id = ?")
      .bind(source.id)
      .run();
    const response = await call(redeemRequest({ code }));
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "invalid_code" });
  });

  it.each([
    ["a wrong code", { code: "Z".repeat(20) }, "invalid_code"],
    ["a transfer-code-length code", { code: "ABCDEFGH" }, "invalid_code"],
    ["no code", {}, "invalid_code"],
    ["a body that is not JSON", "nope", "invalid_request"],
  ])("refuses %s with 400", async (_, body, code) => {
    const response = await call(redeemRequest(body));
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: code });
  });

  it("limits attempts to 5 per minute per IP, separately from transfer codes", async () => {
    const ip = uniqueIp();
    for (let i = 0; i < 5; i++) {
      const response = await call(
        redeemRequest({ code: "Z".repeat(20) }, { ip }),
      );
      expect(response.status).toBe(400);
    }
    const limited = await call(redeemRequest({ code: "Z".repeat(20) }, { ip }));
    expect(limited.status).toBe(429);
    const transfer = await call(
      apiRequest("/api/id/transfer-codes/redeem", {
        ip,
        body: { code: "ZZZZZZZZ" },
      }),
    );
    expect(transfer.status).toBe(400);
  });
});
