/**
 * The name rules for all of kan-game.app (docs/ID_DESIGN.md「名前」), taken
 * from TAKO-SEN (src/core/account-profile.ts at ed29775).
 *
 * Games import this file from the `kan-game` package (`kan-game/name-rules`)
 * to check a name before registering it, so it imports nothing.
 */

/** A name's length in graphemes, as the player sees it. */
export const NAME_MIN = 2;
export const NAME_MAX = 20;
/** UTF-16 code units; only a very long name of many-unit graphemes reaches it. */
const NAME_MAX_UNITS = 256;

const segmenter = new Intl.Segmenter("ja", { granularity: "grapheme" });
const emojiPattern =
  /^(?:\p{Regional_Indicator}{2}|[0-9#*]\u{FE0F}?\u{20E3}|\p{Extended_Pictographic}\u{FE0F}?\p{Emoji_Modifier}?(?:\u{200D}\p{Extended_Pictographic}\u{FE0F}?\p{Emoji_Modifier}?)*)$/u;

export interface NamePart {
  /** One grapheme. */
  text: string;
  /** Whether the grapheme is an emoji, which the rules always allow. */
  emoji: boolean;
}

/** The name's graphemes, for a screen that draws emoji differently. */
export function nameParts(name: string): NamePart[] {
  return Array.from(segmenter.segment(name), ({ segment }) => ({
    text: segment,
    emoji: emojiPattern.test(segment),
  }));
}

/**
 * Why a name breaks the rules, or null when it keeps them: `length` unless it
 * is 2 to 20 graphemes after normalizing (or when it is more than 256 UTF-16
 * units), `chars` for anything but letters, digits, combining marks, spaces,
 * `_`, `-` and emoji.
 * A variation selector (U+FE0E, U+FE0F) is allowed only as part of an emoji.
 */
export function nameProblem(value: string): "length" | "chars" | null {
  const checked = check(value);
  return "problem" in checked ? checked.problem : null;
}

/**
 * The name in canonical form (NFC, trimmed), or null when it breaks the rules
 * (see `nameProblem`). The ID platform stores this form.
 */
export function normalizeName(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const checked = check(value);
  return "name" in checked ? checked.name : null;
}

function check(
  value: string,
): { name: string } | { problem: "length" | "chars" } {
  // A cheap bound before normalizing and segmenting an arbitrarily long input.
  if (value.length > NAME_MAX_UNITS * 4) return { problem: "length" };
  const name = value.normalize("NFC").trim();
  const parts = nameParts(name);
  if (
    name.length > NAME_MAX_UNITS ||
    parts.length < NAME_MIN ||
    parts.length > NAME_MAX
  )
    return { problem: "length" };
  const allowed = parts.every(
    (part) =>
      part.emoji ||
      (/^[\p{L}\p{N}\p{M} _-]+$/u.test(part.text) &&
        !/[\u{FE0E}\u{FE0F}]/u.test(part.text)),
  );
  return allowed ? { name } : { problem: "chars" };
}
