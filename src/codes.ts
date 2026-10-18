/**
 * Codes people type: 32 symbols, upper-case letters and digits without the
 * confusable 0, O, 1 and I (docs/ID_DESIGN.md「引き継ぎコード」「復旧コード」).
 */
export const CODE_ALPHABET = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ";

/** A random code of `length` symbols, 5 bits each. */
export function randomCode(length: number): string {
  const bytes = crypto.getRandomValues(new Uint8Array(length));
  // 256 is a multiple of 32, so masking keeps every symbol equally likely.
  return Array.from(bytes, (byte) => CODE_ALPHABET[byte & 31]).join("");
}

/**
 * Folds full-width characters (typed with a Japanese IME) to ASCII, drops the
 * spaces and hyphens people add when copying a grouped code, and upper-cases.
 * Returns null unless exactly `length` alphabet symbols remain.
 */
export function normalizeCode(input: unknown, length: number): string | null {
  if (typeof input !== "string") return null;
  const code = input
    .normalize("NFKC")
    .replace(/[\s\-‐‑‒–—―ー]/g, "")
    .toUpperCase();
  if (code.length !== length) return null;
  for (const char of code) if (!CODE_ALPHABET.includes(char)) return null;
  return code;
}
