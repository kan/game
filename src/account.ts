import { clearIdCookie, error, json, splitList } from "./http";
import type { AuthedIdContext } from "./id";
import type { GameService } from "./rpc";

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

/**
 * POST /api/id/delete: deletes the ID across kan-game.app
 * (docs/ID_DESIGN.md「退会」). Marks it `deleting`, asks every game to delete
 * its records, then deletes the ID with its name, codes and tokens. When a
 * game fails, answers `503 deletion_incomplete` and leaves the ID `deleting`,
 * so the portal can offer to retry.
 */
export async function handleDeleteAccount(
  _request: Request,
  env: Env,
  context: AuthedIdContext,
): Promise<Response> {
  const services = gameServices(env);
  if ("missing" in services) {
    console.error(
      `GAMES lists missing bindings: ${services.missing.join(", ")}`,
    );
    return error(500, "deletion_misconfigured");
  }
  const { games } = services;
  const { id, status } = context.account;
  if (status === "active") {
    await env.DB.prepare("UPDATE ids SET status = 'deleting' WHERE id = ?")
      .bind(id)
      .run();
  }
  for (const [binding, game] of games) {
    try {
      await game.deleteAccount(id);
    } catch (cause) {
      console.error(`deleteAccount failed on ${binding}`, cause);
      return error(503, "deletion_incomplete");
    }
  }
  // Names, codes and tokens go with the ID (ON DELETE CASCADE).
  await env.DB.prepare("DELETE FROM ids WHERE id = ?").bind(id).run();
  return json({ status: "deleted" }, 200, { "Set-Cookie": clearIdCookie(env) });
}
