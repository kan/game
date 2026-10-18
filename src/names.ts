import { findId } from "./id";
import type { RegisterNameResult } from "./rpc";

/*
 * The name rules are TAKO-SEN's (src/core/account-profile.ts at ed29775),
 * now the rules for all of kan-game.app (docs/ID_DESIGN.md「名前」).
 */

/** A name's length in graphemes, as the player sees it. */
const NAME_MIN = 2;
const NAME_MAX = 20;
/** UTF-16 code units; only a very long name of many-unit graphemes reaches it. */
const NAME_MAX_UNITS = 256;

const segmenter = new Intl.Segmenter("ja", { granularity: "grapheme" });
const emojiPattern =
  /^(?:\p{Regional_Indicator}{2}|[0-9#*]\u{FE0F}?\u{20E3}|\p{Extended_Pictographic}\u{FE0F}?\p{Emoji_Modifier}?(?:\u{200D}\p{Extended_Pictographic}\u{FE0F}?\p{Emoji_Modifier}?)*)$/u;

/**
 * The name in canonical form (NFC, trimmed), or null when it breaks the
 * rules: 2 to 20 graphemes, at most 256 UTF-16 units, and only letters,
 * digits, combining marks, spaces, `_`, `-` and emoji. A variation selector
 * (U+FE0E, U+FE0F) is allowed only as part of an emoji.
 */
export function normalizeName(value: unknown): string | null {
  // A cheap bound before normalizing and segmenting an arbitrarily long input.
  if (typeof value !== "string" || value.length > NAME_MAX_UNITS * 4)
    return null;
  const name = value.normalize("NFC").trim();
  const parts = Array.from(segmenter.segment(name), ({ segment }) => segment);
  if (
    name.length > NAME_MAX_UNITS ||
    parts.length < NAME_MIN ||
    parts.length > NAME_MAX
  )
    return null;
  const allowed = parts.every(
    (part) =>
      emojiPattern.test(part) ||
      (/^[\p{L}\p{N}\p{M} _-]+$/u.test(part) &&
        !/[\u{FE0E}\u{FE0F}]/u.test(part)),
  );
  return allowed ? name : null;
}

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
