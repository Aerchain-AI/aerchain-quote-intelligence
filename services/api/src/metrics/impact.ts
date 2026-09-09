import type { ComparisonDataset } from "../calc/dataset.js";
import { getQuote, splitAward, summarizeExceptions } from "../calc/engine.js";
import { measureExtractionAccuracy } from "./accuracy.js";

/**
 * Every metric carries an explicit basis so nothing on this panel can be mistaken
 * for a performance claim it hasn't earned:
 *   measured — computed from this system's own run
 *   target   — an assignment assumption, not a measured result
 */
export type MetricBasis = "measured" | "target";

export interface ImpactMetric {
  label: string;
  value: string;
  basis: MetricBasis;
  detail: string;
}

export interface ImpactReport {
  metrics: ImpactMetric[];
  generatedAt: string;
}

function formatDuration(ms: number): string {
  const seconds = Math.round(ms / 1000);
  if (seconds < 90) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  return `${minutes}m ${seconds % 60}s`;
}

function formatInr(n: number): string {
  return `₹${Math.round(n).toLocaleString("en-IN")}`;
}

export function buildImpactReport(dataset: ComparisonDataset): ImpactReport {
  const exceptions = summarizeExceptions(dataset);
  const accuracy = measureExtractionAccuracy(dataset);
  const split = splitAward(dataset, { requireQualityPass: true });

  const totalCells = dataset.vendors.length * dataset.lineItems.length;
  let normalizedCells = 0;
  let confidenceSum = 0;
  let confidenceCount = 0;
  for (const vendor of dataset.vendors) {
    for (const li of dataset.lineItems) {
      const q = getQuote(dataset, vendor.id, li.id);
      if (q?.normalizedValue != null) normalizedCells += 1;
      if (q?.confidence != null && q.status !== "not_quoted") {
        confidenceSum += q.confidence;
        confidenceCount += 1;
      }
    }
  }

  const processedVendors = dataset.vendors.filter((v) => v.status === "processed" || v.status === "review_required");
  const durations = dataset.vendors.map((v) => v.processingMs).filter((d): d is number => d != null);
  const totalProcessingMs = durations.length > 0 ? durations.reduce((a, b) => a + b, 0) : null;
  const itemsNeedingReview =
    (exceptions.byType.find((t) => t.type === "missing_item")?.count ?? 0) +
    (exceptions.byType.find((t) => t.type === "low_confidence")?.count ?? 0);

  const metrics: ImpactMetric[] = [
    {
      label: "Responses processed",
      value: `${processedVendors.length} / ${dataset.vendors.length}`,
      basis: "measured",
      detail: "Vendor documents that completed the extraction pipeline in this run.",
    },
    {
      label: "Line items normalized",
      value: `${normalizedCells} / ${totalCells}`,
      basis: "measured",
      detail: `Vendor × item cells with a comparable INR per-unit value. The remainder are genuinely unpriced, not failures.`,
    },
    {
      label: "Extraction accuracy",
      value: accuracy.overallPriceAccuracy == null ? "n/a" : `${(accuracy.overallPriceAccuracy * 100).toFixed(1)}%`,
      basis: "measured",
      detail: `${accuracy.totalCorrect} of ${accuracy.totalPricedFields} normalized prices match the known ground truth of the generated documents.`,
    },
    {
      label: "Missing-item detection",
      value:
        accuracy.omissionDetectionAccuracy == null ? "n/a" : `${(accuracy.omissionDetectionAccuracy * 100).toFixed(1)}%`,
      basis: "measured",
      detail: "Share of genuinely unquoted items the pipeline correctly reported as not quoted rather than inventing a price.",
    },
    {
      label: "Model-reported confidence",
      value: confidenceCount === 0 ? "n/a" : `${Math.round((confidenceSum / confidenceCount) * 100)}%`,
      basis: "measured",
      detail: "Average confidence the extraction model assigned to its own reads. This is self-reported certainty, not verified accuracy.",
    },
    {
      label: "Exceptions detected",
      value: String(exceptions.total),
      basis: "measured",
      detail: "Missing items, unit and currency differences, low-confidence reads, commercial gaps and quality failures.",
    },
    {
      label: "Items requiring review",
      value: String(itemsNeedingReview),
      basis: "measured",
      detail: "Line items a buyer must resolve before award — unpriced or low-confidence.",
    },
    {
      label: "Estimated savings",
      value: split.savingsVsBestSingleVendor == null ? "Not enough information" : formatInr(split.savingsVsBestSingleVendor),
      basis: "measured",
      detail:
        split.bestSingleVendorName == null
          ? "No single-vendor baseline covers the awarded items."
          : `Split award vs. a single-vendor award to ${split.bestSingleVendorName}, over the ${split.awardedItemCount} awardable items only.`,
    },
    {
      label: "Time to comparison",
      value: totalProcessingMs == null ? "n/a" : formatDuration(totalProcessingMs),
      basis: "measured",
      detail:
        totalProcessingMs == null
          ? "No processing durations recorded yet — re-run the pipeline."
          : `Total pipeline time across all ${processedVendors.length} vendor documents in this run (one extraction call each), from file to comparable dataset.`,
    },
    {
      label: "Manual baseline",
      value: "~3 days",
      basis: "target",
      detail: "Assignment assumption for the spreadsheet workflow this replaces. Not measured by this system.",
    },
    {
      label: "Human correction rate",
      value: "≤ 10%",
      basis: "target",
      detail: "Design target for buyer edits to extracted fields. Measuring it requires real buyer usage, which this prototype has not had.",
    },
  ];

  return { metrics, generatedAt: new Date().toISOString() };
}
