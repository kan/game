#!/usr/bin/env node
// Generates a P-256 key pair for the ID cookie (docs/ID_DESIGN.md「鍵の管理」).
//
//   npm run generate-key                              Print the private and public JWK.
//   npm run generate-key -- --dev-vars                Write .dev.vars for `wrangler dev`.
//   npm run generate-key -- --secrets-file <path>     Write the private JWK as a
//                                                     secrets file and print only the
//                                                     public JWK.
//
// The private JWK is the ID_SIGNING_KEY secret. Prefer --secrets-file for a
// deployed environment, so the private key never appears in terminal output:
//   wrangler deploy --env dev --secrets-file <path>
// The public JWK is added to ID_PUBLIC_KEYS of the ID platform and of every game.
import { existsSync, writeFileSync } from "node:fs";

const writeDevVars = process.argv.includes("--dev-vars");
const secretsFlag = process.argv.indexOf("--secrets-file");
const secretsFile = secretsFlag >= 0 ? process.argv[secretsFlag + 1] : null;
if (secretsFlag >= 0 && !secretsFile) {
  console.error("--secrets-file needs a path.");
  process.exit(1);
}

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

function refuseToOverwrite(path) {
  if (existsSync(path)) {
    console.error(`${path} already exists; remove it first to replace it.`);
    process.exit(1);
  }
}

if (writeDevVars) {
  refuseToOverwrite(".dev.vars");
  writeFileSync(
    ".dev.vars",
    `ID_SIGNING_KEY='${JSON.stringify(privateJwk)}'\nID_PUBLIC_KEYS='${JSON.stringify([publicJwk])}'\n`,
    { mode: 0o600 },
  );
  console.log(`Wrote .dev.vars (kid ${kid}).`);
} else if (secretsFile) {
  refuseToOverwrite(secretsFile);
  writeFileSync(
    secretsFile,
    `${JSON.stringify({ ID_SIGNING_KEY: JSON.stringify(privateJwk) })}\n`,
    { mode: 0o600 },
  );
  console.log(`Wrote ID_SIGNING_KEY to ${secretsFile} (kid ${kid}).`);
  console.log("\nAdd to ID_PUBLIC_KEYS:");
  console.log(JSON.stringify(publicJwk));
} else {
  console.log("ID_SIGNING_KEY (secret):");
  console.log(JSON.stringify(privateJwk));
  console.log("\nAdd to ID_PUBLIC_KEYS:");
  console.log(JSON.stringify(publicJwk));
}
