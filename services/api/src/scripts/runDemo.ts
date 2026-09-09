import { prisma } from "../db.js";
import { runPipelineForVendor } from "../pipeline/runPipeline.js";

function pct(n: number | null): string {
  return n == null ? "n/a" : `${Math.round(n * 100)}%`;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function main() {
  const rfx = await prisma.rfx.findFirst({ orderBy: { createdAt: "desc" } });
  if (!rfx) {
    console.error('No RFx found. Run "npm run seed --workspace=services/api" first.');
    process.exitCode = 1;
    return;
  }

  console.log(`\n${rfx.name}`);
  const vendors = await prisma.vendor.findMany({ where: { rfxId: rfx.id }, orderBy: { name: "asc" } });
  console.log(`${vendors.length} Vendors\n`);

  for (const [index, vendor] of vendors.entries()) {
    // A small gap between calls to stay clear of the free-tier per-minute rate
    // limit — without it, back-to-back calls can trigger slow internal SDK
    // retry/backoff that looks like a hang.
    if (index > 0) await sleep(4000);
    process.stdout.write(`Processing ${vendor.name} (${vendor.responseFormat})... `);
    try {
      const summary = await runPipelineForVendor(vendor.id);
      const icon = summary.status === "processed" ? "✓ Processed" : "⚠ Review Required";
      console.log(icon);
      console.log(
        `  ${summary.itemsFoundCount} / 30 items found` +
          (summary.itemsMissingCount > 0 ? `  ⚠ ${summary.itemsMissingCount} items missing` : ""),
      );
      console.log(`  Overall confidence: ${pct(summary.overallConfidence)}`);
      console.log(`  ${summary.exceptionCount} exception(s) flagged\n`);
    } catch (err) {
      console.log("✗ FAILED");
      console.log(`  ${(err as Error).message}\n`);
    }
  }

  console.log("--- Exception detail (first 8 shown per vendor) ---\n");
  for (const vendor of vendors) {
    const exceptions = await prisma.quoteException.findMany({ where: { vendorId: vendor.id }, take: 8 });
    if (exceptions.length === 0) continue;
    console.log(`${vendor.name}:`);
    for (const ex of exceptions) {
      const scope = ex.lineItemId ? `Item #${ex.lineItemId}` : "Document-level";
      console.log(`  [${ex.severity}] ${scope} — ${ex.type}: ${ex.message}`);
    }
    console.log("");
  }

  console.log("Run complete. Use GET /api/rfx/:id/comparison (with rfx id " + rfx.id + ") to see the full matrix.");
}

main()
  .catch((err) => {
    console.error("Demo run failed:", err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
