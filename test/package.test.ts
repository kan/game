import { describe, expect, it } from "vitest";
import pkg from "../package.json";

/*
 * The root package.json doubles as the `kan-game` package games install
 * (AGENTS.md「ゲームへ配るパッケージ」). A file exported but left out of
 * `files` is missing from the games' node_modules, which only their builds
 * would show.
 */
describe("the kan-game package", () => {
  it.each(Object.entries(pkg.exports))("ships %s (%s)", (_, target) => {
    const file = target.replace(/^\.\//, "");
    // npm always ships package.json, without it being in `files`.
    const shipped =
      file === "package.json" ||
      pkg.files.some((entry) =>
        entry.endsWith("/") ? file.startsWith(entry) : file === entry,
      );
    expect(shipped).toBe(true);
  });
});
