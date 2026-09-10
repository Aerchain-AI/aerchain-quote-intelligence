import type { ComparisonDataset } from "../calc/dataset.js";
import {
  cheapestOverall,
  detectPriceOutliers,
  resolveEligibleVendors,
  splitAward,
  summarizeExceptions,
  type SplitAwardResult,
  type VendorTotal,
} from "../calc/engine.js";

export type AwardStrategy = "split_award" | "single_vendor" | "manual_review_required";

export interface AwardRecommendation {
  strategy: AwardStrategy;
  headline: string;
  allocations: SplitAwardResult["allocations"];
  singleVendorOption: { vendorName: string; total: number } | null;
  totalEvaluatedCost: number | null;
  savings: number | null;
  savingsBaselineLabel: string | null;
  awardedItemCount: number;
  totalLineItems: number;
  qualityQualifiedVendorCount: number;
  /** True when a value the recommendation depends on is still unverified. */
  provisional: boolean;
  /** The specific values to check before awarding. */
  blockingVerifications: Array<{ lineItemId: number; vendorName: string; reason: string }>;
  vendorsWithUnresolvedQuality: Array<{ vendorId: string; vendorName: string; reason: string }>;
  itemsRequiringReview: number;
  /** Why each vendor is in or out — the "based on what?" half of the trust model. */
  evidence: string[];
  excludedVendors: Array<{ vendorId: string; vendorName: string; reason: string }>;
  /** What the buyer must verify before actually awarding. */
  reviewBeforeAward: string[];
  confidenceNote: string;
}

/** A split is only worth recommending if it beats the best single vendor by a
 * margin big enough to justify managing multiple suppliers. */
const MATERIAL_SAVINGS_FRACTION = 0.005; // 0.5% of the single-vendor baseline

export function buildAwardRecommendation(dataset: ComparisonDataset): AwardRecommendation {
  const constraints = { requireQualityPass: true };
  const eligibility = resolveEligibleVendors(dataset, constraints);
  const split = splitAward(dataset, constraints);
  const overall = cheapestOverall(dataset, constraints);
  const exceptionSummary = summarizeExceptions(dataset);

  /**
   * A buyer must not award on unverified numbers — but "unverified" has to mean
   * something. Blocking on any line-level exception blocked on `different_currency`
   * disclosures too, which are informational and never absent, so the award could
   * never be produced at all.
   *
   * What actually matters is a flagged value on a line that the recommendation
   * depends on: if the model was unsure about a price we are about to award, that
   * is worth stopping for. A disclosure that Vendor C quoted in USD is not.
   *
   * And even then the answer is not a blank screen. The recommendation is shown,
   * marked provisional, with exactly what to verify — the buyer decides, which
   * they cannot do if the system refuses to show its work.
   */
  const awardedLineItemIds = new Set(split.allocations.flatMap((a) => a.lineItemIds));
  const blockingFlags = dataset.exceptions.filter(
    (e) =>
      e.lineItemId != null &&
      awardedLineItemIds.has(e.lineItemId) &&
      (e.type === "low_confidence" || e.type === "ambiguous_value") &&
      // Only on a vendor actually winning that line.
      split.allocations.some((a) => a.vendorId === e.vendorId && a.lineItemIds.includes(e.lineItemId!)),
  );

  /**
   * A price the rest of the market contradicts is not a competitive position.
   *
   * Deccan's line 2 reads "39.93 INR per 100 pcs" on their document. Extraction
   * read that correctly and normalisation divided by 100 correctly, and the
   * result is 40 paise for a box every other supplier prices at ₹42. The
   * arithmetic is right and awarding on it would be indefensible.
   *
   * These are not excluded outright — a bulk price can be real, and dropping a
   * vendor's line on a heuristic is its own kind of confident wrongness. They
   * join the list the buyer must verify before awarding, which is the mechanism
   * that already exists for exactly this: compute it, show it, say what to check.
   */
  const outlierBlockers = detectPriceOutliers(dataset).filter(
    (o) =>
      awardedLineItemIds.has(o.lineItemId) &&
      split.allocations.some((a) => a.vendorId === o.vendorId && a.lineItemIds.includes(o.lineItemId)),
  );

  const bestSingle: VendorTotal | undefined = overall.ranking.find((r) => r.comparableTotal != null);
  const singleVendorOption =
    split.bestSingleVendorName != null && split.bestSingleVendorTotal != null
      ? { vendorName: split.bestSingleVendorName, total: split.bestSingleVendorTotal }
      : bestSingle
        ? { vendorName: bestSingle.vendorName, total: bestSingle.comparableTotal! }
        : null;

  const evidence: string[] = [];
  const reviewBeforeAward: string[] = [];

  for (const allocation of split.allocations) {
    evidence.push(
      `${allocation.vendorName} is recommended for ${allocation.itemCount} line item(s) because it offers the lowest evaluated cost on those items among quality-qualified vendors (₹${allocation.total.toLocaleString("en-IN")}).`,
    );
  }
  for (const excludedVendor of eligibility.excluded) {
    evidence.push(`${excludedVendor.vendorName} was excluded: ${excludedVendor.reason}.`);
  }
  for (const flaggedVendor of eligibility.flagged) {
    evidence.push(
      `${flaggedVendor.vendorName} is included but not fully quality-cleared — ${flaggedVendor.reason}. It was not disqualified, because an unanswered question is not a "no".`,
    );
  }

  // Items nobody eligible could price, plus anything flagged for human eyes.
  for (const unawarded of split.unawardedItems) {
    reviewBeforeAward.push(`Item #${unawarded.lineItemId} (${unawarded.name}) — ${unawarded.reason}`);
  }
  for (const vendorGap of exceptionSummary.vendorsWithIncompleteResponses) {
    reviewBeforeAward.push(
      `${vendorGap.vendorName} left ${vendorGap.itemsMissing} item(s) unpriced — confirm whether they can supply them before relying on this split.`,
    );
  }
  for (const flaggedVendor of eligibility.flagged) {
    reviewBeforeAward.push(
      `${flaggedVendor.vendorName}: settle ${flaggedVendor.reason.toLowerCase()} before awarding — the system did not decide this for you.`,
    );
  }
  const freightGaps = dataset.exceptions.filter((e) => e.type === "missing_freight");
  for (const gap of freightGaps) {
    const vendorName = dataset.vendors.find((v) => v.id === gap.vendorId)?.name ?? "A vendor";
    reviewBeforeAward.push(`${vendorName}: freight is not fully specified, so evaluated cost may be understated.`);
  }
  const taxGaps = dataset.exceptions.filter((e) => e.type === "missing_tax");
  if (taxGaps.length > 0) {
    reviewBeforeAward.push(
      `${taxGaps.length} vendor(s) did not state tax. Evaluated costs are pre-tax and may not be directly comparable if tax treatment differs.`,
    );
  }
  const lowConfidence = dataset.exceptions.filter((e) => e.type === "low_confidence" || e.type === "ambiguous_value");
  if (lowConfidence.length > 0) {
    reviewBeforeAward.push(
      `${lowConfidence.length} extracted value(s) are flagged as low-confidence or ambiguous — verify these against the source document before award.`,
    );
  }

  // Strategy selection — deterministic, not a model judgement.
  let strategy: AwardStrategy;
  let headline: string;

  if (split.allocations.length === 0) {
    strategy = "manual_review_required";
    headline = "No award can be recommended — no quality-qualified vendor supplied usable pricing.";
  } else if (singleVendorOption == null || split.savingsVsBestSingleVendor == null) {
    strategy = "manual_review_required";
    headline =
      "A split allocation is possible, but no single-vendor baseline exists to compare it against. Buyer judgement required.";
  } else if (split.savingsVsBestSingleVendor > singleVendorOption.total * MATERIAL_SAVINGS_FRACTION) {
    strategy = "split_award";
    headline = `Split the award across ${split.allocations.length} quality-qualified vendor(s) for a lower evaluated cost.`;
  } else {
    strategy = "single_vendor";
    headline = `Award to ${singleVendorOption.vendorName} as a single supplier — splitting saves too little to justify managing multiple vendors.`;
  }

  const totalEvaluatedCost =
    strategy === "single_vendor" ? (singleVendorOption?.total ?? null) : split.splitTotal || null;
  const savings = strategy === "single_vendor" ? null : split.savingsVsBestSingleVendor;

  const qualityQualifiedVendorCount = eligibility.eligibleVendorIds.length;
  const confidenceParts: string[] = [];
  const eligibleVendors = dataset.vendors.filter((v) => eligibility.eligibleVendorIds.includes(v.id));
  const avgConfidence =
    eligibleVendors.length > 0
      ? eligibleVendors.reduce((sum, v) => sum + (v.overallConfidence ?? 0), 0) / eligibleVendors.length
      : null;
  if (avgConfidence != null) {
    confidenceParts.push(`Average extraction confidence across recommended vendors is ${Math.round(avgConfidence * 100)}%.`);
  }
  if (split.unawardedItems.length > 0) {
    confidenceParts.push(
      `${split.unawardedItems.length} item(s) are outside this recommendation entirely and are excluded from both the total and the savings figure.`,
    );
  }
  confidenceParts.push("All figures are computed from extracted data by the calculation engine, not generated by a language model.");

  return {
    strategy,
    headline,
    allocations: split.allocations,
    singleVendorOption,
    totalEvaluatedCost,
    savings,
    savingsBaselineLabel:
      split.bestSingleVendorName != null ? `vs. single-vendor award to ${split.bestSingleVendorName}` : null,
    awardedItemCount: split.awardedItemCount,
    totalLineItems: dataset.lineItems.length,
    qualityQualifiedVendorCount,
    provisional: blockingFlags.length > 0 || outlierBlockers.length > 0,
    blockingVerifications: [
      ...blockingFlags.map((e) => ({
        lineItemId: e.lineItemId!,
        vendorName: dataset.vendors.find((v) => v.id === e.vendorId)?.name ?? "Unknown vendor",
        reason: e.message,
      })),
      ...outlierBlockers.map((o) => ({
        lineItemId: o.lineItemId,
        vendorName: o.vendorName,
        reason: `${o.lineItemName} is priced at ₹${o.evaluatedValue.toLocaleString("en-IN")} against a market median of ₹${o.peerMedian.toLocaleString("en-IN")}. ${o.reason}`,
      })),
    ],
    vendorsWithUnresolvedQuality: eligibility.flagged,
    itemsRequiringReview: split.unawardedItems.length,
    evidence,
    excludedVendors: eligibility.excluded,
    reviewBeforeAward,
    confidenceNote: confidenceParts.join(" "),
  };
}
