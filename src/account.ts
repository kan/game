import { clearIdCookie, error, json, splitList } from "./http";
import type { AuthedIdContext } from "./id";
import type { GameService } from "./rpc";

/** IDs left `deleting` that one scheduled run retries, at most. */
const RETRY_BATCH = 50;

/**
 * The games listed in `GAMES` (comma-separated binding names), in that order,
 * or the names of the listed bindings that are missing. A game left out of an
 * environment's config must not quietly keep a deleted ID's records.
 */
function gameServices(
  env: Env,
): { games: [string, GameService][] } | { missing: string[] } {
  const bindings = env as unknown as Record<string, GameService | undefined>;
  const names = splitList(env.GAMES);
  const missing = names.filter((name) => !bindings[name]);
  if (missing.length > 0) return { missing };
  return { games: names.map((name) => [name, bindings[name]!]) };
}

type DeletionResult = "deleted" | "incomplete" | "misconfigured";

/**
 * Deletes the ID across kan-game.app (docs/ID_DESIGN.md「退会」): marks it
 * `deleting`, asks every game to delete its records, then deletes the ID with
 * its name, codes and tokens. Stops at the first game that fails and leaves
 * the ID `deleting`. Safe to call again for the same ID.
 */
async function deleteId(env: Env, id: string): Promise<DeletionResult> {
  const services = gameServices(env);
  if ("missing" in services) {
    console.error(
      `GAMES lists missing bindings: ${services.missing.join(", ")}`,
    );
    return "misconfigured";
  }
  await env.DB.prepare(
    "UPDATE ids SET status = 'deleting' WHERE id = ? AND status = 'active'",
  )
    .bind(id)
    .run();
  for (const [binding, game] of services.games) {
    try {
      await game.deleteAccount(id);
    } catch (cause) {
      console.error(`deleteAccount failed on ${binding}`, cause);
      return "incomplete";
    }
  }
  // Names, codes and tokens go with the ID (ON DELETE CASCADE).
  await env.DB.prepare("DELETE FROM ids WHERE id = ?").bind(id).run();
  return "deleted";
}

/**
 * POST /api/id/delete. When a game fails, answers `503 deletion_incomplete`;
 * the portal can offer to retry, and the daily run retries too.
 */
export async function handleDeleteAccount(
  _request: Request,
  env: Env,
  context: AuthedIdContext,
): Promise<Response> {
  switch (await deleteId(env, context.account.id)) {
    case "deleted":
      return json({ status: "deleted" }, 200, {
        "Set-Cookie": clearIdCookie(env),
      });
    case "incomplete":
      return error(503, "deletion_incomplete");
    case "misconfigured":
      return error(500, "deletion_misconfigured");
  }
}

/**
 * Retries the deletion of IDs left `deleting`, so a deletion that a game
 * outage interrupted completes without the user coming back. Runs daily.
 *
 * Each run takes at most `RETRY_BATCH` IDs in random order, so IDs that keep
 * failing cannot hold the batch, and stops at the first failure: a game that
 * is still down would otherwise make every remaining ID wait for a timeout.
 */
export async function retryDeletions(env: Env): Promise<void> {
  const { results } = await env.DB.prepare(
    "SELECT id FROM ids WHERE status = 'deleting' ORDER BY RANDOM() LIMIT ?",
  )
    .bind(RETRY_BATCH)
    .all<{ id: string }>();
  for (const { id } of results) {
    let result: DeletionResult;
    try {
      result = await deleteId(env, id);
    } catch (cause) {
      console.error(`retrying the deletion of ${id} failed`, cause);
      return;
    }
    if (result !== "deleted") return;
  }
}
