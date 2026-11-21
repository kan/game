import { env, exports } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import { normalizeName as realNormalizeName } from "../src/name-rules";
import type { IdRpc } from "../src/rpc";
import {
  ID_TOKEN_LIFETIME_SECONDS,
  importVerificationKeys,
  verifyIdCookie,
  verifyIdToken,
} from "../src/token";
import {
  createFakeIdPlatform,
  normalizeName as fakeNormalizeName,
} from "../testing/fake-id-platform";
import {
  createTestIdIssuer,
  type TestIdIssuer,
} from "../testing/test-id-cookie";
import { issue } from "./helpers";

/*
 * kan/game testing/ holds files games import for their tests. These tests
 * keep them true to the real platform.
 */

/** What a contract case can do to a platform, real or fake. */
interface Driver {
  rpc: IdRpc;
  /** An ID that exists. */
  createId(): Promise<string>;
  setName(id: string, name: string): Promise<void>;
  markDeleting(id: string): Promise<void>;
  deleteId(id: string): Promise<void>;
}

const realDriver = (): Driver => ({
  rpc: exports.default,
  createId: async () => (await issue()).id,
  setName: async (id, name) => {
    const result = await exports.default.registerName(id, name);
    if (result.result !== "ok") throw new Error(`setName: ${result.result}`);
  },
  markDeleting: async (id) => {
    await env.DB.prepare("UPDATE ids SET status = 'deleting' WHERE id = ?")
      .bind(id)
      .run();
  },
  deleteId: async (id) => {
    await env.DB.prepare("DELETE FROM ids WHERE id = ?").bind(id).run();
  },
});

const fakeDriver = (): Driver => {
  const fake = createFakeIdPlatform({ ids: [] });
  // The fake's rpc must fit the real contract type.
  const rpc: IdRpc = fake.rpc;
  return {
    rpc,
    createId: async () => {
      const id = crypto.randomUUID();
      fake.addId(id);
      return id;
    },
    setName: async (id, name) => fake.setName(id, name),
    markDeleting: async (id) => fake.markDeleting(id),
    deleteId: async (id) => fake.deleteId(id),
  };
};

/** Names unique per run, since the real platform's D1 is shared by tests. */
const unique = () => `契約${crypto.randomUUID().slice(0, 8)}`;

type Case = [name: string, run: (d: Driver) => Promise<unknown>];

const cases: Case[] = [
  [
    "registers a name and returns it normalized",
    async (d) => {
      const id = await d.createId();
      const name = unique();
      return [
        await d.rpc.getName(id),
        await d.rpc.registerName(id, `  ${name}  `),
        await d.rpc.getName(id),
      ].map((r) => (r === null ? null : JSON.stringify(r).replace(name, "N")));
    },
  ],
  [
    "same name again is ok",
    async (d) => {
      const id = await d.createId();
      const name = unique();
      await d.rpc.registerName(id, name);
      return (await d.rpc.registerName(id, name)).result;
    },
  ],
  [
    "an ID with a name keeps it",
    async (d) => {
      const id = await d.createId();
      const name = unique();
      await d.setName(id, name);
      const result = await d.rpc.registerName(id, unique());
      return [result.result, "name" in result ? result.name === name : null];
    },
  ],
  [
    "a name another ID has is taken",
    async (d) => {
      const first = await d.createId();
      const second = await d.createId();
      const name = unique();
      await d.setName(first, name);
      return [
        (await d.rpc.registerName(second, name)).result,
        await d.rpc.getName(second),
      ];
    },
  ],
  [
    "names are compared after normalizing",
    async (d) => {
      const first = await d.createId();
      const second = await d.createId();
      const tail = crypto.randomUUID().slice(0, 6);
      await d.setName(first, `が${tail}`);
      return (await d.rpc.registerName(second, ` か\u{3099}${tail} `)).result;
    },
  ],
  [
    "an invalid name",
    async (d) => {
      const id = await d.createId();
      return Promise.all(
        ["x", "たこ!", "a".repeat(21), "<b>名前</b>"].map(
          async (name) => (await d.rpc.registerName(id, name)).result,
        ),
      );
    },
  ],
  [
    "an invalid name for an unknown, deleting or named ID (which check wins)",
    async (d) => {
      const deleting = await d.createId();
      await d.markDeleting(deleting);
      const named = await d.createId();
      await d.setName(named, unique());
      return Promise.all(
        [crypto.randomUUID(), deleting, named].map(
          async (id) => (await d.rpc.registerName(id, "x")).result,
        ),
      );
    },
  ],
  [
    "an unknown ID",
    async (d) => {
      const id = crypto.randomUUID();
      return [
        (await d.rpc.registerName(id, unique())).result,
        await d.rpc.getName(id),
      ];
    },
  ],
  [
    "an ID being deleted keeps its name but gets no new one",
    async (d) => {
      const named = await d.createId();
      const name = unique();
      await d.setName(named, name);
      await d.markDeleting(named);
      const unnamed = await d.createId();
      await d.markDeleting(unnamed);
      return [
        (await d.rpc.getName(named)) === name,
        (await d.rpc.registerName(unnamed, unique())).result,
      ];
    },
  ],
  [
    "a deleted ID's name is freed",
    async (d) => {
      const first = await d.createId();
      const name = unique();
      await d.setName(first, name);
      await d.deleteId(first);
      const second = await d.createId();
      return [
        await d.rpc.getName(first),
        (await d.rpc.registerName(second, name)).result,
      ];
    },
  ],
];

describe("testing/fake-id-platform.ts against the real RPC", () => {
  it.each(cases)("%s", async (_, run) => {
    const real = await run(realDriver());
    const fake = await run(fakeDriver());
    expect(fake).toEqual(real);
  });

  it("treats every ID as existing when no ids are given", async () => {
    const fake = createFakeIdPlatform();
    expect(
      (await fake.rpc.registerName(crypto.randomUUID(), "誰でも")).result,
    ).toBe("ok");
  });

  it("exports the real name rules", () => {
    expect(fakeNormalizeName).toBe(realNormalizeName);
  });

  it("refuses setName for states the real platform cannot reach", () => {
    const fake = createFakeIdPlatform();
    const id = crypto.randomUUID();
    fake.setName(id, "たこ");
    expect(() => fake.setName(id, "たこ")).not.toThrow();
    expect(() => fake.setName(id, "いか")).toThrow("cannot change");
    expect(() => fake.setName(crypto.randomUUID(), "たこ")).toThrow("taken");
    expect(() => fake.setName(crypto.randomUUID(), "x")).toThrow("invalid");
    const deleting = crypto.randomUUID();
    fake.markDeleting(deleting);
    expect(() => fake.setName(deleting, "削除中")).toThrow("being deleted");
    fake.deleteId(id);
    expect(() => fake.setName(id, "たこ")).toThrow("deleted");
  });

  it("brings a deleted or deleting ID back active with addId", async () => {
    const fake = createFakeIdPlatform({ ids: [] });
    const id = crypto.randomUUID();
    fake.addId(id);
    fake.markDeleting(id);
    fake.addId(id);
    expect((await fake.rpc.registerName(id, "戻った")).result).toBe("ok");
    fake.deleteId(id);
    fake.addId(id);
    expect(await fake.rpc.getName(id)).toBeNull();
  });

  it("hands out a snapshot of names, not its own map", () => {
    const fake = createFakeIdPlatform();
    const id = crypto.randomUUID();
    fake.setName(id, "たこ");
    (fake.names as Map<string, string>).set(id, "いか");
    expect(fake.names.get(id)).toBe("たこ");
  });
});

describe("testing/test-id-cookie.ts", () => {
  it("makes cookies the real verifier accepts, for the issuer and name given", async () => {
    // Not the defaults, so the options are known to be applied.
    const issuer = await createTestIdIssuer({
      issuer: "kan-game.app",
      cookieName: "__Secure-kg_id",
    });
    const keys = await importVerificationKeys(issuer.publicKeys);
    const sub = crypto.randomUUID();
    const claims = await verifyIdCookie(
      await issuer.cookie(sub),
      "__Secure-kg_id",
      keys,
      "kan-game.app",
      Date.now(),
    );
    expect(claims?.sub).toBe(sub);
  });

  /** The real verifier, trusting only `issuer`'s key and `iss`. */
  async function verifierFor(issuer: TestIdIssuer) {
    const keys = await importVerificationKeys(issuer.publicKeys);
    return (token: string) =>
      verifyIdToken(token, keys, issuer.issuer, Date.now());
  }

  it("signs for the platform's token lifetime", async () => {
    const issuer = await createTestIdIssuer();
    const verify = await verifierFor(issuer);
    const claims = await verify(await issuer.token(crypto.randomUUID()));
    expect(claims!.exp - claims!.iat).toBe(ID_TOKEN_LIFETIME_SECONDS);
  });

  it("makes tokens the real verifier refuses when they should be", async () => {
    const issuer = await createTestIdIssuer();
    const other = await createTestIdIssuer({ kid: "other-key" });
    const verify = await verifierFor(issuer);
    const sub = crypto.randomUUID();
    const expired = Date.now() - (ID_TOKEN_LIFETIME_SECONDS + 1) * 1000;
    for (const token of [
      await issuer.token(sub, { iss: "kan-game.app" }),
      await other.token(sub),
      await issuer.token(sub, { nowMs: expired }),
      // Signed as given, but the verifier takes only a UUID v4.
      await issuer.token("player1"),
    ]) {
      expect(await verify(token)).toBeNull();
    }
  });

  it("defaults to the dev environment and exposes its public key", async () => {
    const issuer = await createTestIdIssuer({ kid: "kit-key" });
    const other = await createTestIdIssuer({ kid: "other-key" });
    // Several issuers' public keys combined, as a game might list them.
    const keys = await importVerificationKeys(
      JSON.stringify([other.publicJwk, issuer.publicJwk]),
    );
    const sub = crypto.randomUUID();
    const claims = await verifyIdToken(
      await issuer.token(sub),
      keys,
      issuer.issuer,
      Date.now(),
    );
    expect(claims?.sub).toBe(sub);
    expect(issuer.cookieName).toBe("__Secure-kgdev_id");
    expect(issuer.issuer).toBe("dev.kan-game.app");
  });
});
