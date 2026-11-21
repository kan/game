import { findId } from "./id";
import { normalizeName } from "./name-rules";
import type { RegisterNameResult } from "./rpc";

/** See `IdRpc.getName` in src/rpc.ts. */
export async function getName(
  db: D1Database,
  id: string,
): Promise<string | null> {
  return (await findId(db, id))?.name ?? null;
}

/** See `IdRpc.registerName` in src/rpc.ts and docs/ID_DESIGN.md「名前」. */
export async function registerName(
  db: D1Database,
  id: string,
  value: unknown,
  now: number,
): Promise<RegisterNameResult> {
  const account = await findId(db, id);
  // A deleted ID, or one being deleted, gets no new name.
  if (account?.status !== "active") return { result: "no_id" };
  const name = normalizeName(value);
  if (!name) return { result: "invalid" };
  if (account.name !== null) return named(account.name, name);

  // ON CONFLICT covers both a taken name and a name this ID just registered
  // in a concurrent call; the second read tells them apart.
  let inserted: unknown;
  try {
    inserted = await db
      .prepare(
        `INSERT INTO names (id, display_name, created_at) VALUES (?, ?, ?)
         ON CONFLICT DO NOTHING RETURNING display_name`,
      )
      .bind(id, name, now)
      .first();
  } catch (cause) {
    // The ID was deleted since it was read (a foreign key failure).
    if (!(await findId(db, id))) return { result: "no_id" };
    throw cause;
  }
  if (inserted) return { result: "ok", name };
  const current = await findId(db, id);
  if (!current) return { result: "no_id" };
  return current.name ? named(current.name, name) : { result: "name_taken" };
}

function named(current: string, requested: string): RegisterNameResult {
  return current === requested
    ? { result: "ok", name: current }
    : { result: "already_named", name: current };
}
