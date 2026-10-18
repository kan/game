import type { D1Migration } from "cloudflare:test";

declare global {
  namespace Cloudflare {
    interface Env {
      TEST_PREVIOUS_SIGNING_KEY: string;
      TEST_UNKNOWN_SIGNING_KEY: string;
      TEST_MIGRATIONS: D1Migration[];
    }
  }
}
