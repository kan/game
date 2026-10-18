#!/usr/bin/env node
// Generates a P-256 key pair for the ID cookie (docs/ID_DESIGN.md「鍵の管理」).
//
//   npm run generate-key                 Print the private and public JWK.
//   npm run generate-key -- --dev-vars   Write .dev.vars for `wrangler dev`.
//
// The private JWK goes to the ID_SIGNING_KEY secret
// (`wrangler secret put ID_SIGNING_KEY --env dev`); the public JWK is added to
// ID_PUBLIC_KEYS of the ID platform and of every game.
import { existsSync, writeFileSync } from "node:fs";

const writeDevVars = process.argv.includes("--dev-vars");
const date = new Date().toISOString().slice(0, 10);
const suffix = crypto.getRandomValues(new Uint8Array(3));
const kid = `${date}-${Buffer.from(suffix).toString("hex")}`;

const pair = await crypto.subtle.generateKey(
  { name: "ECDSA", namedCurve: "P-256" },
  true,
  ["sign", "verify"],
);
const { kty, crv, x, y, d } = await crypto.subtle.exportKey(
  "jwk",
  pair.privateKey,
);
const privateJwk = { kid, kty, crv, x, y, d };
const publicJwk = { kid, kty, crv, x, y };

if (writeDevVars) {
  if (existsSync(".dev.vars")) {
    console.error(
      ".dev.vars already exists; remove it first to replace the local key.",
    );
    process.exit(1);
  }
  writeFileSync(
    ".dev.vars",
    `ID_SIGNING_KEY='${JSON.stringify(privateJwk)}'\nID_PUBLIC_KEYS='${JSON.stringify([publicJwk])}'\n`,
    { mode: 0o600 },
  );
  console.log(`Wrote .dev.vars (kid ${kid}).`);
} else {
  console.log("ID_SIGNING_KEY (secret):");
  console.log(JSON.stringify(privateJwk));
  console.log("\nAdd to ID_PUBLIC_KEYS:");
  console.log(JSON.stringify(publicJwk));
}
