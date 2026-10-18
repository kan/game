import { exports } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import { apiRequest, cookieToken, verifyToken } from "./helpers";

/*
 * The other tests call the router directly; these go through the Worker's
 * default export, as a browser request or a game's `ID` binding does.
 */
describe("the IdPlatform entrypoint", () => {
  it("serves the HTTP APIs through fetch", async () => {
    const response = await exports.default.fetch(apiRequest("/api/id/session"));
    expect(response.status).toBe(200);
    const body = await response.json<{ id: string }>();
    expect((await verifyToken(cookieToken(response)!))?.sub).toBe(body.id);
  });

  it("refuses a very long name over RPC without processing it", async () => {
    const response = await exports.default.fetch(apiRequest("/api/id/session"));
    const { id } = await response.json<{ id: string }>();
    expect(
      await exports.default.registerName(id, "あ".repeat(100_000)),
    ).toEqual({ result: "invalid" });
  });
});
