import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import { hashSecret } from "../src/codes";
import { GAME_ORIGIN, PORTAL_ORIGIN, apiRequest, call, issue } from "./helpers";

function deleteRequest(cookie?: string, origin: string = PORTAL_ORIGIN) {
  return apiRequest("/api/id/delete", { cookie, origin });
}

/** A fake game binding that records the IDs it was asked to delete. */
function fakeGame(options: { fail?: boolean } = {}) {
  const deleted: string[] = [];
  return {
    deleted,
    async deleteAccount(id: string) {
      if (options.fail) throw new Error("game unavailable");
      deleted.push(id);
    },
  };
}

async function count(table: string, id: string): Promise<number> {
  const row = await env.DB.prepare(
    `SELECT COUNT(*) AS n FROM ${table} WHERE id = ?`,
  )
    .bind(id)
    .first<{ n: number }>();
  return row!.n;
}

/** An ID with a name, a transfer code, a recovery code and a migration token. */
async function populatedId() {
  const account = await issue();
  const now = Date.now();
  await env.DB.batch([
    env.DB.prepare(
      "INSERT INTO names (id, display_name, created_at) VALUES (?, ?, ?)",
    ).bind(account.id, `退会-${account.id.slice(0, 8)}`, now),
    env.DB.prepare(
      "INSERT INTO transfer_codes (code, id, expires_at) VALUES (?, ?, ?)",
    ).bind(account.id.slice(0, 8).toUpperCase(), account.id, now + 60_000),
    env.DB.prepare(
      "INSERT INTO recovery_codes (id, code_hash, created_at) VALUES (?, ?, ?)",
    ).bind(account.id, await hashSecret(account.id), now),
    env.DB.prepare(
      "INSERT INTO migration_tokens (token_hash, id, expires_at) VALUES (?, ?, ?)",
    ).bind(await hashSecret(`m-${account.id}`), account.id, now + 60_000),
  ]);
  return account;
}

describe("POST /api/id/delete", () => {
  it("asks every game to delete, then deletes the ID and everything tied to it", async () => {
    const account = await populatedId();
    const tako = fakeGame();
    const veg = fakeGame();
    const response = await call(deleteRequest(account.cookie), {
      GAMES: "GAME_TAKO, GAME_VEG",
      GAME_TAKO: tako,
      GAME_VEG: veg,
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ status: "deleted" });
    expect(response.headers.get("Set-Cookie")).toMatch(/Max-Age=0/);
    expect(tako.deleted).toEqual([account.id]);
    expect(veg.deleted).toEqual([account.id]);
    for (const table of [
      "ids",
      "names",
      "transfer_codes",
      "recovery_codes",
      "migration_tokens",
    ])
      expect(await count(table, account.id)).toBe(0);
  });

  it("leaves the ID deleting with 503 when a game fails, and can be retried", async () => {
    const account = await populatedId();
    const response = await call(deleteRequest(account.cookie), {
      GAMES: "GAME_TAKO",
      GAME_TAKO: fakeGame({ fail: true }),
    });
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ error: "deletion_incomplete" });
    expect(response.headers.get("Set-Cookie")).toBeNull();
    const row = await env.DB.prepare("SELECT status FROM ids WHERE id = ?")
      .bind(account.id)
      .first();
    expect(row).toEqual({ status: "deleting" });
    expect(await count("names", account.id)).toBe(1);

    const session = await call(
      apiRequest("/api/id/session", { cookie: account.cookie }),
    );
    expect(await session.json()).toMatchObject({ status: "deleting" });

    const tako = fakeGame();
    const retry = await call(deleteRequest(account.cookie), {
      GAMES: "GAME_TAKO",
      GAME_TAKO: tako,
    });
    expect(retry.status).toBe(200);
    expect(tako.deleted).toEqual([account.id]);
    expect(await count("ids", account.id)).toBe(0);
  });

  it("calls games in the order GAMES lists and stops at the first failure", async () => {
    const account = await issue();
    const later = fakeGame();
    const response = await call(deleteRequest(account.cookie), {
      GAMES: "GAME_B,GAME_A",
      GAME_A: later,
      GAME_B: fakeGame({ fail: true }),
    });
    expect(response.status).toBe(503);
    expect(later.deleted).toEqual([]);
  });

  it("asks only the listed games", async () => {
    const account = await issue();
    const unlisted = fakeGame();
    const response = await call(deleteRequest(account.cookie), {
      GAME_UNLISTED: unlisted,
    });
    expect(response.status).toBe(200);
    expect(unlisted.deleted).toEqual([]);
  });

  it("fails before touching the ID when a listed game has no binding", async () => {
    const account = await issue();
    const response = await call(deleteRequest(account.cookie), {
      GAMES: "GAME_MISSING",
    });
    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ error: "deletion_misconfigured" });
    const row = await env.DB.prepare("SELECT status FROM ids WHERE id = ?")
      .bind(account.id)
      .first();
    expect(row).toEqual({ status: "active" });
  });

  it("makes the old cookie a deleted ID everywhere", async () => {
    const account = await issue();
    await call(deleteRequest(account.cookie));
    const session = await call(
      apiRequest("/api/id/session", { cookie: account.cookie }),
    );
    expect(session.status).toBe(410);
    const again = await call(deleteRequest(account.cookie));
    expect(again.status).toBe(410);
  });

  it("is refused outside the portal", async () => {
    const account = await issue();
    const game = fakeGame();
    const response = await call(deleteRequest(account.cookie, GAME_ORIGIN), {
      GAMES: "GAME_TAKO",
      GAME_TAKO: game,
    });
    expect(response.status).toBe(403);
    expect(game.deleted).toEqual([]);
    expect(await count("ids", account.id)).toBe(1);
  });

  it("requires an ID", async () => {
    const response = await call(deleteRequest());
    expect(response.status).toBe(401);
  });
});
