// The top page: keeps this device's ID alive and links to the games.
import { startSession, takoSenUrl } from "./lib.js";

const tako = /** @type {HTMLAnchorElement | null} */ (
  document.querySelector("[data-game=tako-sen]")
);
if (tako) tako.href = takoSenUrl(location.hostname);

// Issues or extends the ID. Failing is fine: the next visit retries.
startSession();
addEventListener("online", () => startSession());
