/**
 * The RPC contract between the ID platform and the games
 * (docs/ID_DESIGN.md「ゲームとの RPC」). This file imports nothing, so a game
 * can copy it to type its `ID` binding (`Service<IdRpc>`) and to implement
 * `GameService`.
 */

export type RegisterNameResult =
  | { result: "ok"; name: string }
  | { result: "already_named"; name: string }
  | { result: "name_taken" }
  | { result: "invalid" }
  | { result: "no_id" };

/** What the ID platform provides to each game through its `ID` binding. */
export interface IdRpc {
  /** The ID's name, or null when it has none or the ID does not exist. */
  getName(id: string): Promise<string | null>;
  /**
   * Registers the ID's name. Names are unique across kan-game.app and cannot
   * be changed. Registering the ID's current name again returns `ok`, so a
   * game can retry after failing to store it.
   */
  registerName(id: string, name: string): Promise<RegisterNameResult>;
}

/** What each game provides to the ID platform through its `GAME_<NAME>` binding. */
export interface GameService {
  /**
   * Records the ID as deleted and deletes all its records. Calling it again
   * gives the same result.
   */
  deleteAccount(id: string): Promise<unknown>;
}
