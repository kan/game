// The account screen (TAKO-SEN docs/NEXT_PHASE.md「ポータルの最小構成」):
// the name, transfer codes, recovery codes and account deletion.
import {
  callApi,
  errorMessage,
  formatRemaining,
  groupCode,
  redeemPath,
  startSession,
  TRANSFER_CODE_LIFETIME_MS,
} from "./lib.js";

/** @typedef {import("./lib.js").IdBody} IdBody */

/**
 * The element with `id`, checked to be of `type`.
 * @template {HTMLElement} T
 * @param {string} id
 * @param {new () => T} type
 * @returns {T}
 */
function element(id, type) {
  const found = document.getElementById(id);
  if (!(found instanceof type)) throw new Error(`#${id} is missing`);
  return found;
}

const loading = element("loading", HTMLElement);
const fatal = element("fatal", HTMLElement);
const account = element("account", HTMLElement);
const nameLine = element("name-line", HTMLElement);
const deletingNotice = element("deleting-notice", HTMLElement);
const message = element("message", HTMLElement);
const deleted = element("deleted", HTMLElement);

/** @type {IdBody | null} The ID as last shown. */
let current = null;

/**
 * @param {string} text
 * @param {"info" | "error"} [kind]
 */
function showMessage(text, kind = "info") {
  message.textContent = text;
  message.classList.toggle("error", kind === "error");
  message.hidden = false;
  // The message sits below the sections; bring it into view on a phone.
  message.scrollIntoView({ block: "nearest", behavior: "smooth" });
}

function clearMessage() {
  message.hidden = true;
  message.textContent = "";
}

/**
 * Disables a button while its request runs.
 * @param {HTMLButtonElement} button
 * @param {() => Promise<void>} action
 */
async function busy(button, action) {
  button.disabled = true;
  try {
    await action();
  } finally {
    button.disabled = false;
  }
}

/** @param {IdBody} body */
function render(body) {
  // Codes shown belong to the ID they were issued for.
  if (current?.id !== body.id || body.status !== "active") resetCodes();
  current = body;
  nameLine.textContent = body.name
    ? `名前: ${body.name}`
    : "名前はまだありません。名前は各ゲームのランキングに参加するときに決めます。";
  const isDeleting = body.status === "deleting";
  deletingNotice.hidden = !isDeleting;
  for (const section of document.querySelectorAll("[data-active-only]")) {
    if (section instanceof HTMLElement) section.hidden = isDeleting;
  }
  loading.hidden = true;
  account.hidden = false;
}

/** Issues or extends the ID and shows it. */
async function load() {
  const result = await startSession();
  if (result.ok) {
    fatal.hidden = true;
    render(result.body);
    return;
  }
  // Already showing the account (back online, say): keep it and tell.
  if (current) return showMessage(errorMessage(result.error), "error");
  loading.hidden = true;
  fatal.textContent = errorMessage(result.error);
  fatal.hidden = false;
}

// Transfer codes ------------------------------------------------------------

const issueTransfer = element("issue-transfer", HTMLButtonElement);
const transferResult = element("transfer-result", HTMLElement);
const transferCode = element("transfer-code", HTMLElement);
const transferRemaining = element("transfer-remaining", HTMLElement);
/** @type {ReturnType<typeof setInterval> | undefined} */
let transferTimer;

/** Hides any shown transfer or recovery code and stops the countdown. */
function resetCodes() {
  clearInterval(transferTimer);
  transferResult.hidden = true;
  recoveryResult.hidden = true;
}

issueTransfer.addEventListener("click", () =>
  busy(issueTransfer, async () => {
    clearMessage();
    // The previous code stops working once a new one is issued.
    clearInterval(transferTimer);
    transferResult.hidden = true;
    const result = await callApi("/api/id/transfer-codes");
    if (!result.ok) return showMessage(errorMessage(result.error), "error");
    transferCode.textContent = groupCode(result.body.code);
    transferResult.hidden = false;
    // Counted on this device's clock from now, not to the server's expiresAt.
    const deadline = Date.now() + TRANSFER_CODE_LIFETIME_MS;
    const tick = () => {
      const left = deadline - Date.now();
      transferRemaining.textContent = formatRemaining(left);
      if (left <= 0) {
        clearInterval(transferTimer);
        transferResult.hidden = true;
        showMessage(
          "引き継ぎコードの有効期限が切れました。必要なら発行し直してください。",
        );
      }
    };
    tick();
    transferTimer = setInterval(tick, 1000);
  }),
);

// Recovery codes ------------------------------------------------------------

const issueRecovery = element("issue-recovery", HTMLButtonElement);
const recoveryResult = element("recovery-result", HTMLElement);
const recoveryCode = element("recovery-code", HTMLElement);
const copyRecovery = element("copy-recovery", HTMLButtonElement);

issueRecovery.addEventListener("click", () =>
  busy(issueRecovery, async () => {
    clearMessage();
    const ok = confirm(
      "復旧コードを発行します。以前に発行したコードがあれば、それは使えなくなります。",
    );
    if (!ok) return;
    recoveryResult.hidden = true;
    const result = await callApi("/api/id/recovery-code");
    if (!result.ok) return showMessage(errorMessage(result.error), "error");
    recoveryCode.textContent = groupCode(result.body.code);
    recoveryResult.hidden = false;
  }),
);

copyRecovery.addEventListener("click", async () => {
  try {
    await navigator.clipboard.writeText(recoveryCode.textContent ?? "");
    showMessage("復旧コードをコピーしました。安全な場所に保存してください。");
  } catch {
    showMessage(
      "コピーできませんでした。コードを書き写してください。",
      "error",
    );
  }
});

// Redeeming a transfer or recovery code -------------------------------------

const redeemForm = element("redeem-form", HTMLFormElement);
const redeemInput = element("redeem-code", HTMLInputElement);
const redeemSubmit = element("redeem-submit", HTMLButtonElement);

redeemForm.addEventListener("submit", (event) => {
  event.preventDefault();
  busy(redeemSubmit, async () => {
    clearMessage();
    const path = redeemPath(redeemInput.value);
    if (!path) return showMessage(errorMessage("invalid_code"), "error");
    const ok = confirm(
      "この端末の ID を、入力したコードの ID に切り替えます。今の ID の記録は切り替え先へまとめられず、復旧コードを控えていなければ今の ID には戻れません。",
    );
    if (!ok) return;
    const result = await callApi(path, { code: redeemInput.value });
    if (!result.ok) return showMessage(errorMessage(result.error), "error");
    redeemInput.value = "";
    resetCodes();
    render(result.body);
    showMessage("この端末の ID を切り替えました。");
  });
});

// Deleting the account ------------------------------------------------------

const deleteConfirm = element("delete-confirm", HTMLInputElement);
const deleteButton = element("delete-account", HTMLButtonElement);

deleteConfirm.addEventListener("change", () => {
  deleteButton.disabled = !deleteConfirm.checked;
});

deleteButton.addEventListener("click", async () => {
  const ok = confirm(
    "退会すると、ID と名前、すべてのゲームの記録が削除され、元に戻せません。退会しますか？",
  );
  if (!ok) return;
  await busy(deleteButton, async () => {
    clearMessage();
    const result = await callApi("/api/id/delete");
    if (result.ok) {
      resetCodes();
      account.hidden = true;
      deleted.hidden = false;
      return;
    }
    showMessage(errorMessage(result.error), "error");
    // A game failed and the ID is now `deleting`: show the retry notice.
    if (result.error === "deletion_incomplete" && current) {
      render({ ...current, status: "deleting" });
    }
  });
  deleteButton.disabled = !deleteConfirm.checked;
});

load();
// Back online, extend the ID and refresh what is shown: another device may
// have switched or deleted it meanwhile. Not after this device deleted it.
addEventListener("online", () => {
  if (deleted.hidden) load();
});
