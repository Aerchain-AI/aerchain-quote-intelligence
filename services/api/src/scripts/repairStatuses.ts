import { prisma } from "../db.js";

/**
 * Recovers vendors left stuck in "processing" by an extraction failure that
 * predates the fix in runPipeline.ts. Derives the correct status from the
 * results already stored — it does not re-extract anything.
 */
async function main() {
  const vendors = await prisma.vendor.findMany({ orderBy: { name: "asc" } });
  let repaired = 0;
  for (const v of vendors) {
    if (v.status !== "processing") continue;
    const quoteCount = await prisma.vendorQuote.count({ where: { vendorId: v.id } });
    if (quoteCount === 0) {
      await prisma.vendor.update({ where: { id: v.id }, data: { status: "pending" } });
      console.log(`  ${v.name}: processing -> pending (no stored results)`);
      repaired += 1;
      continue;
    }
    const missing = v.itemsMissingCount ?? 0;
    const status = missing > 0 || (v.overallConfidence ?? 1) < 0.85 ? "review_required" : "processed";
    await prisma.vendor.update({ where: { id: v.id }, data: { status } });
    console.log(`  ${v.name}: processing -> ${status}`);
    repaired += 1;
  }
  console.log(repaired === 0 ? "Nothing to repair." : `Repaired ${repaired} vendor(s).`);
}

main()
  .catch((err) => {
    console.error("Repair failed:", err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
