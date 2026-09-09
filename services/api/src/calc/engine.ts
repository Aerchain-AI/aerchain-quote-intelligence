import type { ComparisonDataset, DatasetQuote } from "./dataset.js";
import { quoteKey } from "./dataset.js";

/**
 * Deterministic calculation engine — the single source of truth for every number
 * shown to the buyer. No LLM touches any arithmetic in this file.
 *
 * Two rules run through all of it:
 *  1. A missing quote is never treated as zero. It is excluded and reported.
 *  2. Vendors are only ranked against each other on a basket they ALL priced,
 *     because totals over different item sets are not comparable.
 */

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/** A quote counts toward a total only if it has a usable comparable cost. */
function usable(quote: DatasetQuote | undefined): quote is DatasetQuote {
  return !!quote && quote.status !== "not_quoted" && quote.evaluatedValue != null;
}

export function getQuote(dataset: ComparisonDataset, vendorId: string, lineItemId: number): DatasetQuote | undefined {
  return dataset.quotes.get(quoteKey(vendorId, lineItemId));
}

// ---------------------------------------------------------------- eligibility

export interface EligibilityConstraints {
  /** Exclude vendors that failed any gating quality question. */
  requireQualityPass?: boolean;
  /** Exclude vendors that did not price every RFx line item. */
  requireCompleteResponse?: boolean;
  /** Restrict to these vendor ids before applying any other rule. */
  vendorIds?: string[];
}

export interface EligibilityResult {
  eligibleVendorIds: string[];
  excluded: Array<{ vendorId: string; vendorName: string; reason: string }>;
  /** Eligible, but carrying unresolved quality answers the buyer should settle. */
  flagged: Array<{ vendorId: string; vendorName: string; reason: string }>;
}

export function resolveEligibleVendors(
  dataset: ComparisonDataset,
  constraints: EligibilityConstraints = {},
): EligibilityResult {
  const candidates = constraints.vendorIds
    ? dataset.vendors.filter((v) => constraints.vendorIds!.includes(v.id))
    : dataset.vendors;

  const eligibleVendorIds: string[] = [];
  const excluded: EligibilityResult["excluded"] = [];
  const flagged: EligibilityResult["flagged"] = [];

  for (const vendor of candidates) {
    // Only an explicit "no" disqualifies. An unresolved answer is surfaced for
    // the buyer to settle, not used to quietly drop the vendor.
    if (constraints.requireQualityPass && vendor.quality.status === "failed") {
      excluded.push({
        vendorId: vendor.id,
        vendorName: vendor.name,
        reason: `Answered no to ${vendor.quality.hardFailures.length} quality criterion(s): ${vendor.quality.hardFailures.join("; ")}`,
      });
      continue;
    }
    if (constraints.requireQualityPass && vendor.quality.status === "unresolved") {
      flagged.push({
        vendorId: vendor.id,
        vendorName: vendor.name,
        reason: `${vendor.quality.unresolved.length} quality question(s) left blank or answered ambiguously: ${vendor.quality.unresolved.join("; ")}`,
      });
    }
    const missing = dataset.lineItems.filter((li) => !usable(getQuote(dataset, vendor.id, li.id))).length;
    if (constraints.requireCompleteResponse && missing > 0) {
      excluded.push({
        vendorId: vendor.id,
        vendorName: vendor.name,
        reason: `Incomplete response — ${missing} of ${dataset.lineItems.length} items have no usable price`,
      });
      continue;
    }
    eligibleVendorIds.push(vendor.id);
  }

  return { eligibleVendorIds, excluded, flagged };
}

// -------------------------------------------------------------------- totals

export interface VendorTotal {
  vendorId: string;
  vendorName: string;
  itemsQuoted: number;
  itemsMissing: number;
  /** Total over the items THIS vendor priced. Not comparable across vendors. */
  ownBasketTotal: number;
  /** Total over the shared comparable basket. null if the vendor misses part of it. */
  comparableTotal: number | null;
}

export interface ComparableBasket {
  /** Line items every compared vendor priced — the only fair ranking basis. */
  lineItemIds: number[];
  /** Line items dropped from the comparison, and why. */
  excludedLineItems: Array<{ lineItemId: number; name: string; reason: string }>;
  totals: VendorTotal[];
}

export function buildComparableBasket(dataset: ComparisonDataset, vendorIds: string[]): ComparableBasket {
  const vendors = dataset.vendors.filter((v) => vendorIds.includes(v.id));
  const lineItemIds: number[] = [];
  const excludedLineItems: ComparableBasket["excludedLineItems"] = [];

  for (const li of dataset.lineItems) {
    const missingFor = vendors.filter((v) => !usable(getQuote(dataset, v.id, li.id)));
    if (missingFor.length === 0) {
      lineItemIds.push(li.id);
    } else {
      excludedLineItems.push({
        lineItemId: li.id,
        name: li.name,
        reason: `No usable price from ${missingFor.map((v) => v.name).join(", ")}`,
      });
    }
  }

  const totals: VendorTotal[] = vendors.map((vendor) => {
    let ownBasketTotal = 0;
    let itemsQuoted = 0;
    for (const li of dataset.lineItems) {
      const q = getQuote(dataset, vendor.id, li.id);
      if (usable(q)) {
        ownBasketTotal += q.evaluatedValue! * li.quantity;
        itemsQuoted += 1;
      }
    }
    let comparableTotal: number | null = 0;
    for (const id of lineItemIds) {
      const li = dataset.lineItems.find((l) => l.id === id)!;
      const q = getQuote(dataset, vendor.id, id);
      if (!usable(q)) {
        comparableTotal = null;
        break;
      }
      comparableTotal += q.evaluatedValue! * li.quantity;
    }
    return {
      vendorId: vendor.id,
      vendorName: vendor.name,
      itemsQuoted,
      itemsMissing: dataset.lineItems.length - itemsQuoted,
      ownBasketTotal: round2(ownBasketTotal),
      comparableTotal: comparableTotal == null ? null : round2(comparableTotal),
    };
  });

  return { lineItemIds, excludedLineItems, totals };
}

// ---------------------------------------------------------- cheapest overall

export interface CheapestOverallResult {
  ranking: VendorTotal[];
  winnerVendorId: string | null;
  basketSize: number;
  totalLineItems: number;
  excludedLineItems: ComparableBasket["excludedLineItems"];
  excludedVendors: EligibilityResult["excluded"];
  caveats: string[];
}

export function cheapestOverall(
  dataset: ComparisonDataset,
  constraints: EligibilityConstraints = {},
): CheapestOverallResult {
  const { eligibleVendorIds, excluded } = resolveEligibleVendors(dataset, constraints);
  const basket = buildComparableBasket(dataset, eligibleVendorIds);

  const ranking = [...basket.totals].sort((a, b) => {
    if (a.comparableTotal == null) return 1;
    if (b.comparableTotal == null) return -1;
    return a.comparableTotal - b.comparableTotal;
  });

  const caveats: string[] = [];
  if (basket.excludedLineItems.length > 0) {
    caveats.push(
      `${basket.excludedLineItems.length} of ${dataset.lineItems.length} line items are excluded from this comparison because at least one vendor did not price them. Ranking is over the ${basket.lineItemIds.length} items every compared vendor quoted.`,
    );
  }
  for (const total of basket.totals) {
    if (total.itemsMissing > 0) {
      caveats.push(
        `${total.vendorName} did not quote ${total.itemsMissing} item(s); its full-basket total is not comparable to vendors with full coverage.`,
      );
    }
  }

  return {
    ranking,
    winnerVendorId: ranking[0]?.comparableTotal != null ? ranking[0].vendorId : null,
    basketSize: basket.lineItemIds.length,
    totalLineItems: dataset.lineItems.length,
    excludedLineItems: basket.excludedLineItems,
    excludedVendors: excluded,
    caveats,
  };
}

// --------------------------------------------------------- cheapest per line

export interface LineWinner {
  lineItemId: number;
  lineItemName: string;
  quantity: number;
  unit: string;
  winnerVendorId: string | null;
  winnerVendorName: string | null;
  winnerUnitPrice: number | null;
  winnerLineTotal: number | null;
  runnerUpVendorName: string | null;
  runnerUpUnitPrice: number | null;
  /** How much cheaper the winner is than the next vendor, per line total. */
  marginOverRunnerUp: number | null;
  vendorsWithoutPrice: string[];
  note: string | null;
}

export function cheapestPerLine(
  dataset: ComparisonDataset,
  constraints: EligibilityConstraints = {},
): { lines: LineWinner[]; excludedVendors: EligibilityResult["excluded"] } {
  const { eligibleVendorIds, excluded } = resolveEligibleVendors(dataset, constraints);
  const vendors = dataset.vendors.filter((v) => eligibleVendorIds.includes(v.id));

  const lines: LineWinner[] = dataset.lineItems.map((li) => {
    const priced = vendors
      .map((v) => ({ vendor: v, quote: getQuote(dataset, v.id, li.id) }))
      .filter((entry): entry is { vendor: (typeof vendors)[number]; quote: DatasetQuote } => usable(entry.quote))
      .sort((a, b) => a.quote.evaluatedValue! - b.quote.evaluatedValue!);

    const withoutPrice = vendors.filter((v) => !usable(getQuote(dataset, v.id, li.id))).map((v) => v.name);

    if (priced.length === 0) {
      return {
        lineItemId: li.id,
        lineItemName: li.name,
        quantity: li.quantity,
        unit: li.unit,
        winnerVendorId: null,
        winnerVendorName: null,
        winnerUnitPrice: null,
        winnerLineTotal: null,
        runnerUpVendorName: null,
        runnerUpUnitPrice: null,
        marginOverRunnerUp: null,
        vendorsWithoutPrice: withoutPrice,
        note: "No eligible vendor provided a usable price for this item.",
      };
    }

    const winner = priced[0];
    const runnerUp = priced[1];
    return {
      lineItemId: li.id,
      lineItemName: li.name,
      quantity: li.quantity,
      unit: li.unit,
      winnerVendorId: winner.vendor.id,
      winnerVendorName: winner.vendor.name,
      winnerUnitPrice: winner.quote.evaluatedValue,
      winnerLineTotal: round2(winner.quote.evaluatedValue! * li.quantity),
      runnerUpVendorName: runnerUp?.vendor.name ?? null,
      runnerUpUnitPrice: runnerUp?.quote.evaluatedValue ?? null,
      marginOverRunnerUp: runnerUp
        ? round2((runnerUp.quote.evaluatedValue! - winner.quote.evaluatedValue!) * li.quantity)
        : null,
      vendorsWithoutPrice: withoutPrice,
      note: withoutPrice.length > 0 ? `${withoutPrice.join(", ")} did not price this item.` : null,
    };
  });

  return { lines, excludedVendors: excluded };
}

// ------------------------------------------------------------- split award

export interface SplitAwardAllocation {
  vendorId: string;
  vendorName: string;
  itemCount: number;
  lineItemIds: number[];
  total: number;
}

export interface SplitAwardResult {
  allocations: SplitAwardAllocation[];
  awardedItemCount: number;
  unawardedItems: Array<{ lineItemId: number; name: string; reason: string }>;
  splitTotal: number;
  /** Cheapest single vendor able to cover the same awarded items, for a like-for-like saving. */
  bestSingleVendorId: string | null;
  bestSingleVendorName: string | null;
  bestSingleVendorTotal: number | null;
  savingsVsBestSingleVendor: number | null;
  excludedVendors: EligibilityResult["excluded"];
  caveats: string[];
}

export function splitAward(dataset: ComparisonDataset, constraints: EligibilityConstraints = {}): SplitAwardResult {
  const { eligibleVendorIds, excluded } = resolveEligibleVendors(dataset, constraints);
  const { lines } = cheapestPerLine(dataset, constraints);

  const byVendor = new Map<string, SplitAwardAllocation>();
  const unawardedItems: SplitAwardResult["unawardedItems"] = [];
  let splitTotal = 0;

  for (const line of lines) {
    if (!line.winnerVendorId || line.winnerLineTotal == null) {
      unawardedItems.push({
        lineItemId: line.lineItemId,
        name: line.lineItemName,
        reason: line.note ?? "No usable price available.",
      });
      continue;
    }
    const existing = byVendor.get(line.winnerVendorId) ?? {
      vendorId: line.winnerVendorId,
      vendorName: line.winnerVendorName!,
      itemCount: 0,
      lineItemIds: [],
      total: 0,
    };
    existing.itemCount += 1;
    existing.lineItemIds.push(line.lineItemId);
    existing.total = round2(existing.total + line.winnerLineTotal);
    byVendor.set(line.winnerVendorId, existing);
    splitTotal = round2(splitTotal + line.winnerLineTotal);
  }

  // Like-for-like baseline: cheapest single vendor that can cover every awarded item.
  const awardedLineItemIds = lines.filter((l) => l.winnerVendorId).map((l) => l.lineItemId);
  let bestSingleVendorId: string | null = null;
  let bestSingleVendorName: string | null = null;
  let bestSingleVendorTotal: number | null = null;
  for (const vendorId of eligibleVendorIds) {
    let total = 0;
    let coversAll = true;
    for (const id of awardedLineItemIds) {
      const li = dataset.lineItems.find((l) => l.id === id)!;
      const q = getQuote(dataset, vendorId, id);
      if (!usable(q)) {
        coversAll = false;
        break;
      }
      total += q.evaluatedValue! * li.quantity;
    }
    if (coversAll && (bestSingleVendorTotal == null || total < bestSingleVendorTotal)) {
      bestSingleVendorTotal = round2(total);
      bestSingleVendorId = vendorId;
      bestSingleVendorName = dataset.vendors.find((v) => v.id === vendorId)!.name;
    }
  }

  const caveats: string[] = [];
  if (unawardedItems.length > 0) {
    caveats.push(
      `${unawardedItems.length} item(s) could not be awarded because no eligible vendor supplied a usable price. They are excluded from the total and from the savings figure.`,
    );
  }
  if (bestSingleVendorTotal == null) {
    caveats.push(
      "No single eligible vendor covers every awarded item, so no single-vendor savings baseline could be calculated.",
    );
  }

  return {
    allocations: [...byVendor.values()].sort((a, b) => b.itemCount - a.itemCount),
    awardedItemCount: awardedLineItemIds.length,
    unawardedItems,
    splitTotal,
    bestSingleVendorId,
    bestSingleVendorName,
    bestSingleVendorTotal,
    savingsVsBestSingleVendor: bestSingleVendorTotal == null ? null : round2(bestSingleVendorTotal - splitTotal),
    excludedVendors: excluded,
    caveats,
  };
}

// ------------------------------------------------------------------- risks

export interface VendorRiskProfile {
  vendorId: string;
  vendorName: string;
  responseFormat: string;
  itemsQuoted: number;
  itemsMissing: number;
  overallConfidence: number | null;
  qualityStatus: string;
  qualityHardFailures: string[];
  qualityUnresolved: string[];
  exceptionsByType: Array<{ type: string; count: number; severity: string; examples: string[] }>;
  lowConfidenceLineItems: Array<{ lineItemId: number; name: string; confidence: number }>;
  commercialGaps: string[];
  paymentTerms: string | null;
  leadTime: string | null;
}

export function vendorRiskProfile(dataset: ComparisonDataset, vendorId: string): VendorRiskProfile | null {
  const vendor = dataset.vendors.find((v) => v.id === vendorId);
  if (!vendor) return null;

  const vendorExceptions = dataset.exceptions.filter((e) => e.vendorId === vendorId);
  const grouped = new Map<string, { type: string; count: number; severity: string; examples: string[] }>();
  for (const ex of vendorExceptions) {
    const entry = grouped.get(ex.type) ?? { type: ex.type, count: 0, severity: ex.severity, examples: [] };
    entry.count += 1;
    if (entry.examples.length < 3) entry.examples.push(ex.message);
    grouped.set(ex.type, entry);
  }

  const lowConfidenceLineItems: VendorRiskProfile["lowConfidenceLineItems"] = [];
  let itemsQuoted = 0;
  for (const li of dataset.lineItems) {
    const q = getQuote(dataset, vendorId, li.id);
    if (usable(q)) {
      itemsQuoted += 1;
      if (q.confidence != null && q.confidence < 0.9) {
        lowConfidenceLineItems.push({ lineItemId: li.id, name: li.name, confidence: q.confidence });
      }
    }
  }

  const commercialGaps: string[] = [];
  if (vendorExceptions.some((e) => e.type === "missing_freight")) {
    commercialGaps.push("Freight terms are not fully specified");
  }
  if (vendorExceptions.some((e) => e.type === "missing_tax")) commercialGaps.push("Tax is not specified");
  if (vendorExceptions.some((e) => e.type === "discount")) {
    commercialGaps.push("A discount is stated but not itemised per line");
  }

  const answerFor = (qid: number) => vendor.questionnaire.find((a) => a.questionId === qid)?.answerText?.trim() || null;

  return {
    vendorId: vendor.id,
    vendorName: vendor.name,
    responseFormat: vendor.responseFormat,
    itemsQuoted,
    itemsMissing: dataset.lineItems.length - itemsQuoted,
    overallConfidence: vendor.overallConfidence,
    qualityStatus: vendor.quality.status,
    qualityHardFailures: vendor.quality.hardFailures,
    qualityUnresolved: vendor.quality.unresolved,
    exceptionsByType: [...grouped.values()].sort((a, b) => b.count - a.count),
    lowConfidenceLineItems,
    commercialGaps,
    paymentTerms: answerFor(9),
    leadTime: answerFor(4),
  };
}

// ---------------------------------------------------------------- scenarios

export interface ScenarioDiscountResult {
  vendorId: string;
  vendorName: string;
  discountPercent: number;
  before: CheapestOverallResult;
  after: CheapestOverallResult;
  becomesCheapest: boolean;
  previousWinnerName: string | null;
  newWinnerName: string | null;
  caveats: string[];
}

/** Re-runs the ranking with one vendor's comparable prices reduced by a percentage.
 * The dataset is cloned — the stored extraction is never mutated. */
export function scenarioAdditionalDiscount(
  dataset: ComparisonDataset,
  params: { vendorId: string; discountPercent: number },
  constraints: EligibilityConstraints = {},
): ScenarioDiscountResult | null {
  const vendor = dataset.vendors.find((v) => v.id === params.vendorId);
  if (!vendor) return null;

  const before = cheapestOverall(dataset, constraints);

  const adjustedQuotes = new Map(dataset.quotes);
  const factor = 1 - params.discountPercent / 100;
  for (const li of dataset.lineItems) {
    const key = quoteKey(params.vendorId, li.id);
    const q = adjustedQuotes.get(key);
    if (q && q.evaluatedValue != null) {
      adjustedQuotes.set(key, { ...q, evaluatedValue: round2(q.evaluatedValue * factor) });
    }
  }
  const adjustedDataset: ComparisonDataset = { ...dataset, quotes: adjustedQuotes };
  const after = cheapestOverall(adjustedDataset, constraints);

  const previousWinner = before.ranking[0];
  const newWinner = after.ranking[0];

  return {
    vendorId: vendor.id,
    vendorName: vendor.name,
    discountPercent: params.discountPercent,
    before,
    after,
    becomesCheapest: newWinner?.vendorId === params.vendorId,
    previousWinnerName: previousWinner?.vendorName ?? null,
    newWinnerName: newWinner?.vendorName ?? null,
    caveats: [
      `The discount is applied uniformly to every ${vendor.name} line item on the comparable basket. If the vendor intends it to apply only to part of the order, this figure will overstate the benefit.`,
      ...after.caveats,
    ],
  };
}

// -------------------------------------------------------- exception summary

export interface ExceptionSummary {
  total: number;
  byType: Array<{ type: string; count: number; severity: string }>;
  bySeverity: Array<{ severity: string; count: number }>;
  vendorsWithIncompleteResponses: Array<{ vendorId: string; vendorName: string; itemsMissing: number }>;
}

export function summarizeExceptions(dataset: ComparisonDataset): ExceptionSummary {
  const byType = new Map<string, { type: string; count: number; severity: string }>();
  const bySeverity = new Map<string, number>();
  for (const ex of dataset.exceptions) {
    const t = byType.get(ex.type) ?? { type: ex.type, count: 0, severity: ex.severity };
    t.count += 1;
    byType.set(ex.type, t);
    bySeverity.set(ex.severity, (bySeverity.get(ex.severity) ?? 0) + 1);
  }

  const vendorsWithIncompleteResponses = dataset.vendors
    .map((v) => {
      const itemsMissing = dataset.lineItems.filter((li) => !usable(getQuote(dataset, v.id, li.id))).length;
      return { vendorId: v.id, vendorName: v.name, itemsMissing };
    })
    .filter((v) => v.itemsMissing > 0);

  return {
    total: dataset.exceptions.length,
    byType: [...byType.values()].sort((a, b) => b.count - a.count),
    bySeverity: [...bySeverity.entries()].map(([severity, count]) => ({ severity, count })),
    vendorsWithIncompleteResponses,
  };
}
