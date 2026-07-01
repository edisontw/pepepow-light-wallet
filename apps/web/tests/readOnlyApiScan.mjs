import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const scanRoots = [
  path.join(root, "apps/web/dist"),
  path.join(root, "apps/web/src"),
].filter((p) => fs.existsSync(p));

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

const allowedTextFiles = new Set([
  path.normalize("apps/web/tests/readOnlyApiScan.mjs"),
]);

const textExts = new Set([
  ".cjs",
  ".css",
  ".html",
  ".js",
  ".json",
  ".jsx",
  ".mjs",
  ".ts",
  ".tsx",
  ".txt",
]);

function* walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === "node_modules" || entry.name === ".git") continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      yield* walk(full);
    } else if (textExts.has(path.extname(entry.name))) {
      yield full;
    }
  }
}

const hits = [];
for (const dir of scanRoots) {
  for (const file of walk(dir)) {
    const rel = path.relative(root, file);
    if (allowedTextFiles.has(path.normalize(rel))) continue;
    const text = fs.readFileSync(file, "utf8");
    for (const term of forbidden) {
      if (text.includes(term)) {
        hits.push({ file: rel, term });
      }
    }
  }
}

if (hits.length) {
  console.error("Forbidden legacy API references found:");
  for (const hit of hits) {
    console.error(`- ${hit.file}: ${hit.term}`);
  }
  process.exit(1);
}

console.log("Read-only API scan passed. No legacy wallet API references found in scanned public runtime files.");
