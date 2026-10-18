import { WorkerEntrypoint } from "cloudflare:workers";
import { retryDeletions } from "./account";
import { deleteExpiredRows } from "./maintenance";
import { getName, registerName } from "./names";
import { handleFetch } from "./router";
import type { IdRpc, RegisterNameResult } from "./rpc";

/**
 * The ID platform. Games reach it through their `ID` service binding: HTTP
 * for the relayed `/api/id/*`, and the `IdRpc` methods (src/rpc.ts) as RPC
 * (docs/ID_DESIGN.md「ゲームとの RPC」). This module exports only the
 * entrypoint; the router lives in src/router.ts.
 */
export default class IdPlatform extends WorkerEntrypoint<Env> implements IdRpc {
  override fetch(request: Request): Promise<Response> {
    return handleFetch(request, this.env);
  }

  /** Daily: expired codes and tokens, and deletions a game interrupted. */
  override async scheduled(): Promise<void> {
    // Independent jobs: one failing must not skip the other.
    const results = await Promise.allSettled([
      deleteExpiredRows(this.env.DB, Date.now()),
      retryDeletions(this.env),
    ]);
    const failed = results.find((result) => result.status === "rejected");
    if (failed) throw failed.reason;
  }

  getName(id: string): Promise<string | null> {
    return getName(this.env.DB, id);
  }

  registerName(id: string, name: string): Promise<RegisterNameResult> {
    return registerName(this.env.DB, id, name, Date.now());
  }
}
