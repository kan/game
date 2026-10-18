import { describe, expect, it } from "vitest";
import {
  callApi,
  errorMessage,
  formatRemaining,
  groupCode,
  redeemPath,
  startSession,
  takoSenUrl,
  TRANSFER_CODE_LIFETIME_MS as PORTAL_TRANSFER_LIFETIME_MS,
} from "../public/assets/lib.js";
import { normalizeCode } from "../src/codes";
import type { ErrorCode } from "../src/http";
import { RECOVERY_CODE_LENGTH } from "../src/recovery";
import {
  TRANSFER_CODE_LENGTH,
  TRANSFER_CODE_LIFETIME_MS,
} from "../src/transfer";

/** A fetch that answers each call with the next of `responses`, recording paths. */
function fakeFetch(responses: (Response | Error)[]) {
  const calls: { path: string; init: RequestInit | undefined }[] = [];
  const fetchImpl = (async (path: string, init?: RequestInit) => {
    calls.push({ path, init });
    const next = responses.shift();
    if (!next) throw new Error("no more responses");
    if (next instanceof Error) throw next;
    return next;
  }) as unknown as typeof fetch;
  return { calls, fetchImpl };
}

describe("portal helpers", () => {
  it("groups codes in fours", () => {
    expect(groupCode("ABCDEFGH")).toBe("ABCD-EFGH");
    expect(groupCode("ABCDEFGHJKLMNPQRSTUV")).toBe("ABCD-EFGH-JKLM-NPQR-STUV");
  });

  it("formats the time left, never below zero", () => {
    expect(formatRemaining(600_000)).toBe("10:00");
    expect(formatRemaining(59_001)).toBe("1:00");
    expect(formatRemaining(1)).toBe("0:01");
    expect(formatRemaining(-5_000)).toBe("0:00");
  });

  it("has a message for every error code the ID APIs return", () => {
    // Record<...> makes the type check fail when ErrorCode gains a code that
    // is not listed here. The portal never calls unknown paths or methods.
    const shown: Record<
      Exclude<ErrorCode, "not_found" | "method_not_allowed">,
      true
    > = {
      invalid_code: true,
      invalid_request: true,
      no_id: true,
      origin_not_allowed: true,
      id_deleting: true,
      id_deleted: true,
      rate_limited: true,
      deletion_misconfigured: true,
      deletion_incomplete: true,
    };
    const fallback = errorMessage("something-new");
    for (const code of [...Object.keys(shown), "network"]) {
      expect(errorMessage(code)).not.toBe(fallback);
    }
  });

  it("counts down a transfer code for as long as the server keeps it", () => {
    expect(PORTAL_TRANSFER_LIFETIME_MS).toBe(TRANSFER_CODE_LIFETIME_MS);
  });

  it.each([
    ["ABCDEFGH", "/api/id/transfer-codes/redeem"],
    // Upper-casing ß gives SS: lengths are compared after it, as on the server.
    ["ABCDEFß", "/api/id/transfer-codes/redeem"],
    ["abcd-efgh", "/api/id/transfer-codes/redeem"],
    ["ＡＢＣＤ－ＥＦＧＨ", "/api/id/transfer-codes/redeem"],
    ["ABCD EFGH JKLM NPQR STUV", "/api/id/recovery-code/redeem"],
    ["abcd-efgh-jklm-npqr-stuv", "/api/id/recovery-code/redeem"],
    ["ABCDEFG", null],
    ["", null],
  ])("sends %j to %s, as the server normalizes it", (typed, path) => {
    expect(redeemPath(typed)).toBe(path);
    // The portal and the server must agree on what each code looks like.
    expect(normalizeCode(typed, TRANSFER_CODE_LENGTH) !== null).toBe(
      path === "/api/id/transfer-codes/redeem",
    );
    expect(normalizeCode(typed, RECOVERY_CODE_LENGTH) !== null).toBe(
      path === "/api/id/recovery-code/redeem",
    );
  });

  it("links TAKO-SEN for the portal's environment", () => {
    expect(takoSenUrl("kan-game.app")).toBe("https://tako.kan-game.app/");
    expect(takoSenUrl("dev.kan-game.app")).toBe(
      "https://tako-dev.kan-game.app/",
    );
    expect(takoSenUrl("localhost")).toBe("https://tako-dev.kan-game.app/");
  });
});

describe("callApi", () => {
  it("POSTs JSON on the same origin and returns the body", async () => {
    const { calls, fetchImpl } = fakeFetch([
      Response.json({ code: "ABCDEFGH" }),
    ]);
    const result = await callApi(
      "/api/id/transfer-codes/redeem",
      { code: "x" },
      fetchImpl,
    );
    expect(result).toEqual({
      ok: true,
      status: 200,
      body: { code: "ABCDEFGH" },
    });
    expect(calls[0].init).toMatchObject({
      method: "POST",
      credentials: "same-origin",
      body: '{"code":"x"}',
    });
  });

  it("returns the error code of a refused request", async () => {
    const { fetchImpl } = fakeFetch([
      Response.json({ error: "rate_limited" }, { status: 429 }),
    ]);
    expect(await callApi("/api/id/session", undefined, fetchImpl)).toEqual({
      ok: false,
      status: 429,
      error: "rate_limited",
    });
  });

  it("does not throw on a network failure or a body that is not JSON", async () => {
    const offline = fakeFetch([new TypeError("Failed to fetch")]);
    expect(
      await callApi("/api/id/session", undefined, offline.fetchImpl),
    ).toEqual({ ok: false, status: 0, error: "network" });
    const html = fakeFetch([new Response("<h1>error</h1>", { status: 500 })]);
    expect(await callApi("/api/id/session", undefined, html.fetchImpl)).toEqual(
      { ok: false, status: 500, error: "unknown" },
    );
  });
});

describe("startSession", () => {
  it("asks again after a deleted ID's cookie is cleared", async () => {
    const { calls, fetchImpl } = fakeFetch([
      Response.json({ error: "id_deleted" }, { status: 410 }),
      Response.json({ id: "new", name: null, status: "active" }),
    ]);
    const result = await startSession(fetchImpl);
    expect(calls).toHaveLength(2);
    expect(result).toMatchObject({ ok: true, body: { id: "new" } });
  });

  it("does not repeat other failures", async () => {
    const { calls, fetchImpl } = fakeFetch([
      Response.json({ error: "rate_limited" }, { status: 429 }),
    ]);
    await startSession(fetchImpl);
    expect(calls).toHaveLength(1);
  });
});
