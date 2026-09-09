import { loadComparisonDataset } from "../calc/dataset.js";
import { cheapestOverall, getQuote, resolveEligibleVendors, summarizeExceptions } from "../calc/engine.js";
import { answerQuestion } from "../copilot/answer.js";
import { prisma } from "../db.js";

/**
 * The deliberate break-tests: the behaviours that separate a trustworthy
 * procurement tool from a plausible-looking dashboard. These run against the
 * real extracted dataset, not fixtures — if extraction changes, these tell you
 * whether the trust guarantees still hold.
 */

interface TestResult {
  name: string;
  passed: boolean;
  detail: string;
}

const results: TestResult[] = [];

function check(name: string, passed: boolean, detail: string) {
  results.push({ name, passed, detail });
}

async function main() {
  const rfx = await prisma.rfx.findFirst({ orderBy: { createdAt: "desc" } });
  if (!rfx) {
    console.error("No RFx found. Seed and run the pipeline first.");
    process.exitCode = 1;
    return;
  }
  const dataset = await loadComparisonDataset(rfx.id);

  // 1 — A vendor that didn't quote an item must read "not quoted", never zero.
  const notQuoted = [...dataset.quotes.values()].filter((q) => q.status === "not_quoted");
  const anyZeroed = notQuoted.some((q) => q.evaluatedValue === 0 || q.normalizedValue === 0);
  check(
    "1. Missing item is not treated as zero",
    notQuoted.length > 0 && !anyZeroed,
    `${notQuoted.length} unquoted cells found; ${anyZeroed ? "SOME WERE ZEROED" : "all carry null, not 0"}`,
  );

  // 2 — A USD quote is converted, and the original currency survives.
  const usdQuotes = [...dataset.quotes.values()].filter((q) => q.sourceCurrency === "USD");
  const usdConverted = usdQuotes.filter((q) => q.normalizedValue != null && q.fxRate != null);
  check(
    "2. USD quotes are normalized with the rate disclosed",
    usdQuotes.length > 0 && usdConverted.length === usdQuotes.length,
    `${usdConverted.length}/${usdQuotes.length} USD quotes converted with an attached FX rate`,
  );

  // 3 — A per-100 unit basis is divided down, not taken at face value.
  const per100 = [...dataset.quotes.values()].filter((q) => /per\s+\d{2,}/i.test(q.sourceUnit ?? ""));
  const per100Converted = per100.filter(
    (q) => q.normalizedValue != null && q.sourceValue != null && q.normalizedValue < q.sourceValue,
  );
  check(
    "3. Bulk unit basis is converted to per-unit",
    per100.length > 0 && per100Converted.length === per100.length,
    `${per100Converted.length}/${per100.length} bulk-priced quotes normalized below their quoted figure`,
  );

  // 4 — Values the model was unsure about are visibly flagged.
  const flaggedQuotes = [...dataset.quotes.values()].filter((q) => q.status === "flagged");
  const ambiguityExceptions = dataset.exceptions.filter(
    (e) => e.type === "low_confidence" || e.type === "ambiguous_value",
  );
  check(
    "4. Low-confidence / ambiguous reads are flagged",
    ambiguityExceptions.length > 0,
    `${ambiguityExceptions.length} ambiguity exceptions raised across ${flaggedQuotes.length} flagged cells`,
  );

  // 5 — Unknown freight is stated as unknown, never assumed to be zero.
  const freightExceptions = dataset.exceptions.filter((e) => e.type === "missing_freight");
  const anyFreightZero = [...dataset.quotes.values()].some((q) => q.freight?.amount === 0);
  check(
    "5. Unspecified freight is reported, not assumed zero",
    freightExceptions.length > 0 && !anyFreightZero,
    `${freightExceptions.length} freight gaps reported; ${anyFreightZero ? "A ZERO FREIGHT WAS INVENTED" : "no zero-value freight invented"}`,
  );

  // 6 — A vendor that answered "no" to a quality criterion is excluded under the constraint.
  const unconstrained = resolveEligibleVendors(dataset, {});
  const constrained = resolveEligibleVendors(dataset, { requireQualityPass: true });
  const droppedByQuality = unconstrained.eligibleVendorIds.length - constrained.eligibleVendorIds.length;
  check(
    "6. Quality constraint actually excludes failing vendors",
    droppedByQuality > 0 && constrained.excluded.every((e) => e.reason.includes("Answered no")),
    `${droppedByQuality} vendor(s) excluded: ${constrained.excluded.map((e) => e.vendorName).join(", ") || "none"}`,
  );

  // 6b — ...but a merely unanswered question does not silently disqualify anyone.
  const unresolvedVendors = dataset.vendors.filter((v) => v.quality.status === "unresolved");
  const unresolvedStillEligible = unresolvedVendors.every((v) => constrained.eligibleVendorIds.includes(v.id));
  check(
    "6b. Unanswered quality questions flag, not disqualify",
    unresolvedVendors.length === 0 || unresolvedStillEligible,
    unresolvedVendors.length === 0
      ? "no vendors had unresolved answers in this run"
      : `${unresolvedVendors.map((v) => v.name).join(", ")} kept eligible and flagged for buyer review`,
  );

  // 7 — Ranking never compares totals across different item coverage.
  const overall = cheapestOverall(dataset, {});
  const coversFewerItems = overall.basketSize < overall.totalLineItems;
  check(
    "7. Vendors are ranked only on a shared basket",
    !coversFewerItems || overall.caveats.length > 0,
    `basket = ${overall.basketSize}/${overall.totalLineItems} items, ${overall.caveats.length} caveat(s) stated`,
  );

  // 8 — A question the data cannot answer gets refused, not improvised.
  try {
    const answer = await answerQuestion(dataset, "Which vendor has the lowest carbon footprint?");
    check(
      "8. Unanswerable question is refused",
      !answer.supported && /don't have enough information/i.test(answer.answer),
      answer.answer.slice(0, 140),
    );
  } catch (err) {
    check("8. Unanswerable question is refused", false, `copilot call failed: ${(err as Error).message.slice(0, 120)}`);
  }

  const exceptionSummary = summarizeExceptions(dataset);
  console.log(`\nBreak-tests against live extracted data — ${dataset.rfxName}`);
  console.log(`${dataset.vendors.length} vendors, ${dataset.lineItems.length} line items, ${exceptionSummary.total} exceptions\n`);
  for (const r of results) {
    console.log(`${r.passed ? "PASS" : "FAIL"}  ${r.name}`);
    console.log(`      ${r.detail}`);
  }
  const failed = results.filter((r) => !r.passed);
  console.log(`\n${results.length - failed.length}/${results.length} passed`);
  if (failed.length > 0) process.exitCode = 1;
}

main()
  .catch((err) => {
    console.error("Break-tests failed to run:", err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
