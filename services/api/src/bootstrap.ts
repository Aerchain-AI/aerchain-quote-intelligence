import fs from "node:fs";
import path from "node:path";
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
 * If a working database already exists, it is left alone.
 */

const WORKING_DB = path.join(API_ROOT, "prisma", "dev.db");
const DEMO_SNAPSHOT = path.join(API_ROOT, "prisma", "demo.db");


export async function bootstrapDatabase(): Promise<void> {
  if (fs.existsSync(WORKING_DB) && fs.statSync(WORKING_DB).size > 0) {
    return;
  }
  if (fs.existsSync(DEMO_SNAPSHOT)) {
    fs.copyFileSync(DEMO_SNAPSHOT, WORKING_DB);
    const mb = (fs.statSync(WORKING_DB).size / 1024 / 1024).toFixed(2);
    console.log(`[bootstrap] Restored the pre-processed demo database (${mb} MB).`);
    return;
  }

  console.log("[bootstrap] No demo snapshot found. Running initial seed...");
  await runSeed().catch((err) => console.error("[bootstrap] Auto-seed failed:", err));
}
