import fs from "node:fs";
import path from "node:path";
import { prisma } from "./db.js";
import { API_ROOT } from "./paths.js";
import { runSeed } from "./seed.js";

/**
 * Demo database bootstrap.
 *
 * The comparison grid, the award recommendation and every derivation read from
 * SQLite and the deterministic engine — no model call is involved in any of it.
 * But *producing* that data means running ten extractions against the vendor
 * documents, which needs live API keys and free-tier quota, takes about a
 * minute, and is the single most likely thing to fail in front of an audience.
 *
 * So the extracted state ships. `demo.db` is committed; on a cold start with no
 * working database, it is copied into place. A host with an ephemeral disk
 * therefore returns to a pristine, fully populated demo on every restart, and
 * anything a viewer changes during a session is discarded on the next one.
 *
 * A working database that exists but holds no sourcing event is treated as no
 * database at all. This is not hypothetical: the build step runs `prisma db
 * push`, which creates the file with the schema and nothing in it, so by the
 * time the server starts there is always a working database and the snapshot
 * was never restored. The deployed site came up empty while every check said it
 * had a database. Presence of a file is not presence of data.
 */

const WORKING_DB = path.join(API_ROOT, "prisma", "dev.db");
const DEMO_SNAPSHOT = path.join(API_ROOT, "prisma", "demo.db");


export async function bootstrapDatabase(): Promise<void> {
  if (await hasSourcingEvents()) return;

  if (fs.existsSync(DEMO_SNAPSHOT)) {
    // Prisma may hold the empty file open from the count above, and SQLite keeps
    // sidecar files that would outlive the database they belong to.
    await prisma.$disconnect().catch(() => undefined);
    for (const sidecar of ["", "-journal", "-wal", "-shm"]) {
      const f = `${WORKING_DB}${sidecar}`;
      if (fs.existsSync(f)) fs.rmSync(f, { force: true });
    }

    fs.copyFileSync(DEMO_SNAPSHOT, WORKING_DB);
    const mb = (fs.statSync(WORKING_DB).size / 1024 / 1024).toFixed(2);
    console.log(`[bootstrap] Restored the pre-processed demo database (${mb} MB).`);
    return;
  }

  console.log("[bootstrap] No demo snapshot found. Running initial seed...");
  await runSeed().catch((err) => console.error("[bootstrap] Auto-seed failed:", err));
}

/**
 * Whether the working database holds anything worth keeping.
 *
 * A missing file, a zero-byte file, a file with no schema and a file with the
 * schema but no rows all mean the same thing to a viewer: an empty site. They
 * are answered the same way here.
 */
async function hasSourcingEvents(): Promise<boolean> {
  if (!fs.existsSync(WORKING_DB) || fs.statSync(WORKING_DB).size === 0) return false;
  try {
    return (await prisma.rfx.count()) > 0;
  } catch {
    // No schema yet, or a file that is not a database. Either way, nothing to keep.
    return false;
  }
}
