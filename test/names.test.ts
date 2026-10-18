import { env, exports } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import { normalizeName } from "../src/names";
import { issue } from "./helpers";

/** The Worker as a game's `ID` binding sees it: methods called over RPC. */
const id = exports.default;

/*
 * Invisible characters are written as \u{...} escapes so the source shows them:
 * U+3099 is the combining voiced sound mark, U+FE0E the text variation selector.
 */

describe("name rules", () => {
  it.each([
    ["たこ", "たこ"],
    ["  たこ  ", "たこ"],
    ["Tako_Sen-01", "Tako_Sen-01"],
    ["タコ 🐙", "タコ 🐙"],
    ["👨‍👩‍👧‍👦🇯🇵", "👨‍👩‍👧‍👦🇯🇵"],
    // NFC: か + combining voiced mark becomes が.
    ["か\u{3099}き", "がき"],
    ["a".repeat(20), "a".repeat(20)],
  ])("accepts %j as %j", (input, expected) => {
    expect(normalizeName(input)).toBe(expected);
  });

  it.each([
    ["one grapheme", "た"],
    ["21 graphemes", "a".repeat(21)],
    ["a symbol", "たこ!"],
    ["a text-style variation selector on a letter", "た\u{FE0E}こ"],
    ["only spaces", "   "],
    ["markup", "<b>たこ</b>"],
    ["not a string", 42],
  ])("refuses %s", (_, input) => {
    expect(normalizeName(input)).toBeNull();
  });
});

describe("RPC getName and registerName", () => {
  it("registers a name once and returns it", async () => {
    const { id: account } = await issue();
    expect(await id.getName(account)).toBeNull();
    expect(await id.registerName(account, " たこせん ")).toEqual({
      result: "ok",
      name: "たこせん",
    });
    expect(await id.getName(account)).toBe("たこせん");
  });

  it("returns ok again for the same name, so a game can retry", async () => {
    const { id: account } = await issue();
    await id.registerName(account, "再送テスト");
    expect(await id.registerName(account, "再送テスト")).toEqual({
      result: "ok",
      name: "再送テスト",
    });
  });

  it("keeps the first name: names cannot be changed", async () => {
    const { id: account } = await issue();
    await id.registerName(account, "最初の名前");
    expect(await id.registerName(account, "別の名前")).toEqual({
      result: "already_named",
      name: "最初の名前",
    });
  });

  it("refuses a name another ID has", async () => {
    const first = await issue();
    const second = await issue();
    await id.registerName(first.id, "重複する名前");
    expect(await id.registerName(second.id, "重複する名前")).toEqual({
      result: "name_taken",
    });
    expect(await id.getName(second.id)).toBeNull();
  });

  it("compares names after normalizing", async () => {
    const first = await issue();
    const second = await issue();
    await id.registerName(first.id, "がぎ");
    expect(await id.registerName(second.id, " か\u{3099}き\u{3099} ")).toEqual({
      result: "name_taken",
    });
  });

  it("refuses an invalid name", async () => {
    const { id: account } = await issue();
    expect(await id.registerName(account, "x")).toEqual({ result: "invalid" });
  });

  it("refuses a deleted ID and an ID being deleted", async () => {
    expect(await id.registerName(crypto.randomUUID(), "存在しない")).toEqual({
      result: "no_id",
    });
    const { id: account } = await issue();
    await env.DB.prepare("UPDATE ids SET status = 'deleting' WHERE id = ?")
      .bind(account)
      .run();
    expect(await id.registerName(account, "退会途中")).toEqual({
      result: "no_id",
    });
  });

  it("frees the name of a deleted ID", async () => {
    const first = await issue();
    await id.registerName(first.id, "空く名前");
    await env.DB.prepare("DELETE FROM ids WHERE id = ?").bind(first.id).run();
    const second = await issue();
    expect(await id.registerName(second.id, "空く名前")).toEqual({
      result: "ok",
      name: "空く名前",
    });
  });
});
