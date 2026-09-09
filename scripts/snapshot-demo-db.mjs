import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Freeze the current working database as the shipped demo state.
 *
 * Run this after the extraction pipeline has populated an event you are happy
 * to demo. The snapshot is what a deployed instance restores on a cold start,
 * so it is the difference between an interviewer seeing a populated comparison
 * grid immediately and watching ten API calls run before anything appears.
 *
 * Committed on purpose: the working database is gitignored because it is
 * scratch state, but this snapshot is a build artefact of the demo itself.
 */

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const WORKING = path.join(REPO_ROOT, "services", "api", "prisma", "dev.db");
const SNAPSHOT = path.join(REPO_ROOT, "services", "api", "prisma", "demo.db");

if (!fs.existsSync(WORKING)) {
  console.error("No working database at services/api/prisma/dev.db — nothing to snapshot.");
  process.exit(1);
}

// SQLite keeps recent writes in a side journal. Copying the main file while one
// is outstanding captures a database that is missing its newest rows.
for (const sidecar of ["-wal", "-journal"]) {
  if (fs.existsSync(WORKING + sidecar)) {
    console.error(
      `A ${sidecar} file is present, so there are uncommitted writes.\n` +
        "Stop the API server and run this again.",
    );
    process.exit(1);
  }
}

fs.copyFileSync(WORKING, SNAPSHOT);
const mb = (fs.statSync(SNAPSHOT).size / 1024 / 1024).toFixed(2);
console.log(`Snapshotted services/api/prisma/demo.db (${mb} MB).`);
console.log("Commit it — a deployed instance restores from this on every cold start.");
