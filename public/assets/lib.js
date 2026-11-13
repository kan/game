// Helpers for the portal's pages that do not touch the DOM, so they can be
// tested on their own (test/portal-lib.test.ts).

/** Messages for the error codes of the ID APIs (docs/ID_DESIGN.md「HTTP の API」). */
const ERROR_MESSAGES = {
  rate_limited:
    "操作が続いたため、しばらく受け付けられません。1 分ほど待ってからもう一度試してください。",
  invalid_code: "コードが正しくないか、有効期限が切れています。",
  invalid_request:
    "送信の内容が正しくありません。ページを読み込み直してください。",
  no_id:
    "この端末の ID を確認できませんでした。ページを読み込み直してください。",
  id_deleted:
    "この ID は退会済みです。ページを読み込み直すと新しい ID が作られます。",
  id_deleting: "退会の途中のため、この操作はできません。",
  origin_not_allowed: "このページからは操作できません。",
  deletion_incomplete:
    "退会の途中で止まりました。時間をおいてもう一度「退会する」を押してください。",
  deletion_misconfigured:
    "退会を受け付けられませんでした。時間をおいてもう一度試してください。",
  network: "通信できませんでした。接続を確かめてからもう一度試してください。",
};

/**
 * The message to show for an API error code.
 * @param {string} code
 * @returns {string}
 */
export function errorMessage(code) {
  return (
    /** @type {Record<string, string>} */ (ERROR_MESSAGES)[code] ??
    "うまくいきませんでした。時間をおいてもう一度試してください。"
  );
}

/**
 * A code in groups for display, e.g. ABCD-EFGH-JKLM.
 * @param {string} code
 * @param {number} [size]
 * @returns {string}
 */
export function groupCode(code, size = 4) {
  const groups = [];
  for (let i = 0; i < code.length; i += size)
    groups.push(code.slice(i, i + size));
  return groups.join("-");
}

/**
 * Time left as m:ss, never negative.
 * @param {number} ms
 * @returns {string}
 */
export function formatRemaining(ms) {
  const seconds = Math.max(0, Math.ceil(ms / 1000));
  const minutes = Math.floor(seconds / 60);
  return `${minutes}:${String(seconds % 60).padStart(2, "0")}`;
}

/**
 * How long a transfer code lasts (src/transfer.ts; the test keeps them in
 * step). The countdown uses it instead of `expiresAt`, which is on the
 * server's clock and would be off by however far the device's clock is.
 */
export const TRANSFER_CODE_LIFETIME_MS = 10 * 60 * 1000;

/**
 * Which redeem API a typed code is for, or null when it is neither kind.
 * Recovery codes have 20 symbols and transfer codes 8, after the same folding
 * the server applies (src/codes.ts normalizeCode; the test keeps them in step).
 * @param {string} typed
 * @returns {string | null}
 */
export function redeemPath(typed) {
  const length = typed
    .normalize("NFKC")
    .replace(/[\s\-‐‑‒–—―ー]/g, "")
    .toUpperCase().length;
  if (length === 20) return "/api/id/recovery-code/redeem";
  if (length === 8) return "/api/id/transfer-codes/redeem";
  return null;
}

/** Each game's subdomains: [production, development]. */
const GAME_HOSTS = {
  "tako-sen": ["tako", "tako-dev"],
  vegtab: ["vegtab", "vegtab-dev"],
  "nyoro-rin": ["nyoro", "nyoro-dev"],
};

/**
 * A game's URL for the environment the portal runs in.
 * @param {keyof typeof GAME_HOSTS} game
 * @param {string} hostname
 * @returns {string}
 */
export function gameUrl(game, hostname) {
  const [production, development] = GAME_HOSTS[game];
  const sub = hostname === "kan-game.app" ? production : development;
  return `https://${sub}.kan-game.app/`;
}

/**
 * @typedef {{ id: string, name: string | null, status: "active" | "deleting" }} IdBody
 * @typedef {{ ok: true, status: number, body: any } | { ok: false, status: number, error: string }} ApiResult
 */

/**
 * POSTs to an ID API on this origin. Never throws: a network failure comes
 * back as the error code `network`.
 * @param {string} path
 * @param {unknown} [body]
 * @param {typeof fetch} [fetchImpl]
 * @returns {Promise<ApiResult>}
 */
export async function callApi(path, body, fetchImpl = fetch) {
  let response;
  try {
    response = await fetchImpl(path, {
      method: "POST",
      credentials: "same-origin",
      headers: body === undefined ? {} : { "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    return { ok: false, status: 0, error: "network" };
  }
  /** @type {any} */
  let data = null;
  try {
    data = await response.json();
  } catch {
    // Not JSON, e.g. the platform's error page.
  }
  if (response.ok) return { ok: true, status: response.status, body: data };
  return {
    ok: false,
    status: response.status,
    error: typeof data?.error === "string" ? data.error : "unknown",
  };
}

/**
 * POST /api/id/session, called when a page opens and when the device comes
 * back online (docs/ID_DESIGN.md「ID の発行と延長」). A deleted ID's cookie is
 * cleared by the first call, so the second issues a new ID.
 * @param {typeof fetch} [fetchImpl]
 * @returns {Promise<ApiResult>}
 */
export async function startSession(fetchImpl = fetch) {
  const result = await callApi("/api/id/session", undefined, fetchImpl);
  if (!result.ok && result.error === "id_deleted") {
    return callApi("/api/id/session", undefined, fetchImpl);
  }
  return result;
}
