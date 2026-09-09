import fs from "node:fs/promises";
import path from "node:path";
import { prisma } from "../db.js";
import { API_ROOT } from "../paths.js";

/**
 * Empties every table.
 *
 * Deleting the SQLite file by hand is not enough on its own: the server restores
 * `prisma/demo.db` on a cold start when no working database is present, so the
 * data comes straight back. This clears the tables in place and leaves the
 * schema intact, which is what you want before importing a fresh dataset.
 *
 * A copy of the working file is written beside it first. It costs nothing and
 * the extraction output in there took an API call per vendor to produce.
 */
async function main() {
  const workingDb = path.join(API_ROOT, "prisma", "dev.db");
  const backupDir = path.join(API_ROOT, "..", "..", "backup");

  try {
    await fs.mkdir(backupDir, { recursive: true });
    const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
    const target = path.join(backupDir, `dev-${stamp}.db`);
    await fs.copyFile(workingDb, target);
    console.log(`Backed up to backup/${path.basename(target)}`);
  } catch {
    console.log("No working database to back up — continuing.");
  }

  // Children before parents: SQLite will not let a referenced row go first.
  const cleared = {
    inboundMessage: (await prisma.inboundMessage.deleteMany({})).count,
    copilotAnswerCache: (await prisma.copilotAnswerCache.deleteMany({})).count,
    questionnaireResponse: (await prisma.questionnaireResponse.deleteMany({})).count,
    quoteException: (await prisma.quoteException.deleteMany({})).count,
    vendorQuote: (await prisma.vendorQuote.deleteMany({})).count,
    vendor: (await prisma.vendor.deleteMany({})).count,
    rfxInvitation: (await prisma.rfxInvitation.deleteMany({})).count,
    rfxEvent: (await prisma.rfxEvent.deleteMany({})).count,
    lineItem: (await prisma.lineItem.deleteMany({})).count,
    rfx: (await prisma.rfx.deleteMany({})).count,
    supplier: (await prisma.supplier.deleteMany({})).count,
    buyer: (await prisma.buyer.deleteMany({})).count,
  };

  const total = Object.values(cleared).reduce((s, n) => s + n, 0);
  for (const [table, count] of Object.entries(cleared)) {
    if (count > 0) console.log(`  ${String(count).padStart(5)} ${table}`);
  }
  console.log(`\n${total} row(s) deleted. Every table is empty.`);
  console.log("Next: fill data/import, then run  npm run import:data");
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
