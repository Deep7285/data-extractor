// tools/write-user.mjs
// Writes a user directly to Cloudflare KV via REST API.
// This bypasses wrangler + PowerShell quoting issues completely.
//
// Usage:
//   node tools/write-user.mjs <username> <password>
//
// Requires these env vars (or set them at the top of this file):
//   CLOUDFLARE_API_TOKEN   — your API token (Edit Workers permission)
//   CLOUDFLARE_ACCOUNT_ID  — your account ID (visible in Cloudflare dashboard URL)
//   KV_NAMESPACE_ID        — the production KV namespace ID from wrangler.toml
//
// To avoid typing them every time, just fill in the three constants below.
// -----------------------------------------------------------------

import { randomBytes, pbkdf2Sync } from "crypto";

// ── Fill these in once ─────────────────────────────────────────────
const API_TOKEN      = process.env.CLOUDFLARE_API_TOKEN  || "PASTE_YOUR_API_TOKEN_HERE";
const ACCOUNT_ID     = process.env.CLOUDFLARE_ACCOUNT_ID || "PASTE_YOUR_ACCOUNT_ID_HERE";
const KV_NAMESPACE   = process.env.KV_NAMESPACE_ID       || "28062621848241e19ad5c5c3bb42d60c"; // from wrangler.toml
// ──────────────────────────────────────────────────────────────────

const username = process.argv[2];
const password = process.argv[3];

if (!username || !password) {
  console.error("Usage: node tools/write-user.mjs <username> <password>");
  process.exit(1);
}

// PBKDF2 hash — same algorithm the worker uses to verify
const salt       = randomBytes(16);
const iterations = 100000;
const keyLen     = 32;
const digest     = "sha256";
const derived    = pbkdf2Sync(password, salt, iterations, keyLen, digest);

const hashString = `pbkdf2$sha256$${iterations}$${salt.toString("base64")}$${derived.toString("base64")}`;

const userRecord = {
  username,
  role:    "user",
  quota:   { max_pages: 10, max_files: 100 },
  expires: "2099-12-31",
  status:  "active",
  hash:    hashString
};

// Serialize to JSON ourselves — no PowerShell involved
const jsonValue = JSON.stringify(userRecord);

console.log("\nUser record:");
console.log(jsonValue);
console.log("\nWriting to Cloudflare KV...");

// PUT directly to Cloudflare KV REST API
const url = `https://api.cloudflare.com/client/v4/accounts/${ACCOUNT_ID}/storage/kv/namespaces/${KV_NAMESPACE}/values/user%3A${encodeURIComponent(username)}`;

const response = await fetch(url, {
  method:  "PUT",
  headers: {
    "Authorization": `Bearer ${API_TOKEN}`,
    "Content-Type":  "application/json"
  },
  body: jsonValue   // the raw JSON string — no shell involved
});

const result = await response.json();

if (result.success) {
  console.log(`\n✅ User "${username}" written successfully.`);
  console.log(`   They can log in immediately with the password you provided.\n`);
} else {
  console.error("\n❌ Failed to write user:");
  console.error(JSON.stringify(result.errors, null, 2));
  console.error("\nCheck that your API token has 'Workers KV Storage: Edit' permission.");
  process.exit(1);
}
