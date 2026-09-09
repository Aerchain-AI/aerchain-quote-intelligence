import { prisma } from "../db.js";

/**
 * Re-applies the deterministic validation rules to already-extracted rows.
 *
 * This exists because validation rules can change after extraction has run, and
 * re-extracting to pick up a rule change would be wasteful (and, on a rate-limited
 * key, sometimes impossible). Nothing here re-reads a document or invents a value:
 * it only recomputes status from data already stored.
 */
async function main() {
  const quotes = await prisma.vendorQuote.findMany();
  const exceptions = await prisma.quoteException.findMany({ where: { type: "ambiguous_value" } });

  const ambiguousKeys = new Set(exceptions.filter((e) => e.lineItemId != null).map((e) => `${e.vendorId}:${e.lineItemId}`));

  let updated = 0;
  for (const q of quotes) {
    if (q.status === "not_quoted") continue;
    const isAmbiguous = ambiguousKeys.has(`${q.vendorId}:${q.lineItemId}`);
    const isLowConfidence = q.confidenceLevel === "low";
    const expected = isLowConfidence || isAmbiguous ? "flagged" : "verified";
    if (q.status !== expected) {
      await prisma.vendorQuote.update({ where: { id: q.id }, data: { status: expected } });
      updated += 1;
    }
  }
  console.log(updated === 0 ? "All quote statuses already consistent." : `Updated ${updated} quote status(es).`);
}

main()
  .catch((err) => {
    console.error("Re-validation failed:", err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
