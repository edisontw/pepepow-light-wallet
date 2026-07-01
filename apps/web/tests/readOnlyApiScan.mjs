import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const distRoot = path.join(root, "apps/web/dist");

if (!fs.existsSync(distRoot)) {
  console.error("apps/web/dist not found. Run `npm run build` before readOnlyApiScan.");
  process.exit(1);
}

const forbidden = [
  "api.pepepow.net",
  "/wallet/utxos",
  "/wallet/price",
  "/wallet/tx/broadcast",
  "/wallet/tx/raw",
  "/v1/history",
  "/v1/profile",
  "/v1/address/default",
  "/v1/requests",
  "/auth/telegram",
  "/api/paylink",
];

const textExts = new Set([
  ".css",
  ".html",
  ".js",
  ".json",
  ".mjs",
  ".txt",
]);

function* walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      yield* walk(full);
    } else if (textExts.has(path.extname(entry.name))) {
      yield full;
    }
  }
}

const hits = [];
for (const file of walk(distRoot)) {
  const rel = path.relative(root, file);
  const text = fs.readFileSync(file, "utf8");
  for (const term of forbidden) {
    if (text.includes(term)) {
      hits.push({ file: rel, term });
    }
  }
}

if (hits.length) {
  console.error("Forbidden legacy API references found in built wallet runtime:");
  for (const hit of hits) {
    console.error(`- ${hit.file}: ${hit.term}`);
  }
  process.exit(1);
}

console.log("Read-only API scan passed. No legacy wallet API references found in apps/web/dist.");
