/**
 * A fake of the ID platform's RPC (`IdRpc` in kan/game src/rpc.ts) for games'
 * tests. It follows the real rules (kan/game src/names.ts): names are unique
 * across kan-game.app after normalizing, cannot change, registering the ID's
 * current name again is `ok`, registerName gives `no_id` for an unknown ID
 * or one being deleted (checked before the name), and a name breaking the
 * rules is `invalid`. getName still returns the name of an ID being deleted,
 * as the real platform does, and null for an unknown or deleted ID.
 *
 * Copy this file unchanged from kan/game testing/. It imports nothing; the
 * returned `rpc` fits `IdRpc` structurally. kan/game test/testing-kit.test.ts
 * runs the same cases against this fake and the real platform.
 *
 * `normalizeName` is exported too: the name rules, for tests that need them.
 */

type RegisterNameResult =
  | { result: "ok"; name: string }
  | { result: "already_named"; name: string }
  | { result: "name_taken" }
  | { result: "invalid" }
  | { result: "no_id" };

export interface FakeIdPlatformOptions {
  /**
   * The IDs that exist. Leave it out to treat every ID as existing; pass it
   * (even empty) to get `no_id` for any ID not listed or added later.
   */
  ids?: Iterable<string>;
}

export interface FakeIdPlatform {
  /** Pass this where a game expects its `ID` binding (`Service<IdRpc>`). */
  rpc: {
    getName(id: string): Promise<string | null>;
    registerName(id: string, name: string): Promise<RegisterNameResult>;
  };
  /**
   * Makes an ID exist and active (only matters when `ids` was given, or after
   * deleteId). A deleted ID comes back without a name.
   */
  addId(id: string): void;
  /**
   * Gives an ID a name directly, as if it had been registered in another
   * game. The name is normalized. Throws for what the real platform could
   * never reach: a name breaking the rules or held by another ID, a different
   * name for an ID that has one, or an ID that is deleted or being deleted.
   * With `ids` given, an ID not yet known is added first.
   */
  setName(id: string, name: string): void;
  /** Marks an ID as in the middle of deletion: registerName gets `no_id`. */
  markDeleting(id: string): void;
  /** Deletes an ID and frees its name. */
  deleteId(id: string): void;
  /** A snapshot of the names registered so far, by ID. */
  readonly names: ReadonlyMap<string, string>;
}

export function createFakeIdPlatform(
  options: FakeIdPlatformOptions = {},
): FakeIdPlatform {
  const names = new Map<string, string>();
  const known = options.ids === undefined ? null : new Set(options.ids);
  const deleting = new Set<string>();
  const deleted = new Set<string>();

  const exists = (id: string) =>
    !deleted.has(id) && (known === null || known.has(id));
  const holder = (name: string) => {
    for (const [id, taken] of names) if (taken === name) return id;
    return null;
  };

  const rpc: FakeIdPlatform["rpc"] = {
    async getName(id) {
      return exists(id) ? (names.get(id) ?? null) : null;
    },
    async registerName(id, value) {
      if (!exists(id) || deleting.has(id)) return { result: "no_id" };
      const name = normalizeName(value);
      if (name === null) return { result: "invalid" };
      const current = names.get(id);
      if (current !== undefined) {
        return current === name
          ? { result: "ok", name }
          : { result: "already_named", name: current };
      }
      if (holder(name) !== null) return { result: "name_taken" };
      names.set(id, name);
      return { result: "ok", name };
    },
  };

  return {
    rpc,
    get names() {
      return new Map(names);
    },
    addId(id) {
      known?.add(id);
      deleted.delete(id);
      deleting.delete(id);
    },
    setName(id, value) {
      if (deleted.has(id)) throw new Error(`deleted ID: ${id}`);
      if (deleting.has(id)) throw new Error(`ID being deleted: ${id}`);
      const name = normalizeName(value);
      if (name === null) throw new Error(`invalid name: ${value}`);
      const current = names.get(id);
      if (current !== undefined && current !== name)
        throw new Error(`names cannot change: ${id} is ${current}`);
      const taken = holder(name);
      if (taken !== null && taken !== id)
        throw new Error(`name taken: ${name}`);
      known?.add(id);
      names.set(id, name);
    },
    markDeleting(id) {
      deleting.add(id);
    },
    deleteId(id) {
      names.delete(id);
      deleting.delete(id);
      deleted.add(id);
    },
  };
}

// The name rules, the same as kan/game src/names.ts (and TAKO-SEN's
// src/core/account-profile.ts). kan/game's tests compare the two.

const NAME_MIN = 2;
const NAME_MAX = 20;
const NAME_MAX_UNITS = 256;
const segmenter = new Intl.Segmenter("ja", { granularity: "grapheme" });
const emojiPattern =
  /^(?:\p{Regional_Indicator}{2}|[0-9#*]\u{FE0F}?\u{20E3}|\p{Extended_Pictographic}\u{FE0F}?\p{Emoji_Modifier}?(?:\u{200D}\p{Extended_Pictographic}\u{FE0F}?\p{Emoji_Modifier}?)*)$/u;

/** The name in canonical form (NFC, trimmed), or null when it breaks the rules. */
export function normalizeName(value: unknown): string | null {
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
