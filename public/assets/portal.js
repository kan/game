// The top page: keeps this device's ID alive and links to the games.
import { gameUrl, startSession } from "./lib.js";

for (const link of document.querySelectorAll("a[data-game]")) {
  const game = /** @type {Parameters<typeof gameUrl>[0]} */ (
    /** @type {HTMLAnchorElement} */ (link).dataset.game
  );
  /** @type {HTMLAnchorElement} */ (link).href = gameUrl(
    game,
    location.hostname,
  );
}

// Issues or extends the ID. Failing is fine: the next visit retries.
startSession();
addEventListener("online", () => startSession());
