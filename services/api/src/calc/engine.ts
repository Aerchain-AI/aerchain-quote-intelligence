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

/**
 * A price the vendor did give that this system will not compare.
 *
 * "Did not quote" and "quoted on a basis we cannot convert" are different facts
 * and they send a buyer to do different work: one is a call asking for a price,
 * the other is a question about what the price covers. Counting them together
 * reports that a vendor left items unpriced when it priced every one of them.
 */
function quotedButUncomparable(quote: DatasetQuote | undefined): boolean {
  return !!quote && quote.status !== "not_quoted" && quote.evaluatedValue == null;
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
  /**
   * Items with no comparable price, whether the vendor gave none or gave one
   * this system would not convert. Named for what it is, because "missing" sent
   * buyers to chase prices that had in fact been quoted.
   */
  itemsWithoutComparablePrice: number;
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
      itemsWithoutComparablePrice: dataset.lineItems.length - itemsQuoted,
      ownBasketTotal: round2(ownBasketTotal),
      comparableTotal: comparableTotal == null ? null : round2(comparableTotal),
    };
  });

  return { lineItemIds, excludedLineItems, totals };
}

// ---------------------------------------------------------- cheapest overall

/**
 * What had to be assumed before these totals could be added up.
 *
 * Two kinds of assumption change a total: a price in another currency, which was
 * converted at a stated rate, and a price on a unit basis that could not be
 * converted, which was left out. Both are already recorded per line. This states
 * them once more at the level a buyer actually compares at.
 */
function conversionCaveats(dataset: ComparisonDataset, eligibleVendorIds: string[]): string[] {
  const eligible = new Set(eligibleVendorIds);
  const converted = new Map<string, { count: number; currencies: Set<string>; rate: string | null }>();
  const refused = new Map<string, { count: number; units: Set<string> }>();

  for (const vendor of dataset.vendors) {
    if (!eligible.has(vendor.id)) continue;
    for (const li of dataset.lineItems) {
      const q = getQuote(dataset, vendor.id, li.id);
      if (!q) continue;

      if (q.sourceCurrency && q.normalizedCurrency && q.sourceCurrency !== q.normalizedCurrency) {
        const entry = converted.get(vendor.name) ?? { count: 0, currencies: new Set<string>(), rate: null };
        entry.count += 1;
        entry.currencies.add(q.sourceCurrency);
        if (!entry.rate && q.fxRate) {
          const fx = q.fxRate;
          entry.rate = `${fx.rate}${fx.asOf ? ` as of ${fx.asOf}` : ""}${fx.source ? ` (${fx.source})` : ""}`;
        }
        converted.set(vendor.name, entry);
      }

      if (q.evaluatedValue == null && q.status !== "not_quoted" && q.sourceUnit) {
        const entry = refused.get(vendor.name) ?? { count: 0, units: new Set<string>() };
        entry.count += 1;
        entry.units.add(q.sourceUnit);
        refused.set(vendor.name, entry);
      }
    }
  }

  const notes: string[] = [];
  for (const [vendorName, entry] of converted) {
    notes.push(
      `${vendorName} priced ${entry.count} line(s) in ${[...entry.currencies].join("/")}. ` +
        `Those lines were converted to ${dataset.baseCurrency} at ${entry.rate ?? "the reference rate on file"}, ` +
        `so its position in this ranking moves with that rate.`,
    );
  }
  for (const [vendorName, entry] of refused) {
    notes.push(
      `${vendorName} priced ${entry.count} line(s) per "${[...entry.units].join('", "')}", which was not converted to the ` +
        `requested unit. Those lines carry no comparable value and are excluded rather than guessed.`,
    );
  }
  return notes;
}

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
    if (total.itemsWithoutComparablePrice > 0) {
      caveats.push(
        `${total.vendorName} has no comparable price for ${total.itemsWithoutComparablePrice} item(s); its full-basket total is not comparable to vendors with full coverage.`,
      );
    }
  }

  // A ranking that rests on a conversion has to say so on the ranking, not only
  // on the line. A reader comparing two totals is looking at this answer, and a
  // disclosure they have to go and find is a disclosure they will not read.
  for (const note of conversionCaveats(dataset, eligibleVendorIds)) caveats.push(note);

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

// ---------------------------------------------------------------- outliers

export interface PriceOutlier {
  vendorId: string;
  vendorName: string;
  lineItemId: number;
  lineItemName: string;
  evaluatedValue: number;
  /** What the rest of the market said for the same line. */
  peerMedian: number;
  /** How many times the peer median this price is. */
  multiple: number;
  reason: string;
}

/**
 * Prices that the rest of the responses contradict.
 *
 * Conversion can be faithful and the result still absurd. A vendor whose sheet
 * says "USD 86" for a box every other supplier quotes at ₹83 produces a
 * correctly converted ₹7,181, a correctly computed total, and a comparison that
 * ranks them last without ever saying why. The arithmetic is right and the
 * screen is misleading.
 *
 * So each price is checked against the median of what everyone else quoted for
 * the same line. An order-of-magnitude gap is not a competitive position, it is
 * a currency or unit basis that needs a human eye, and it is named as such
 * rather than silently ranked.
 *
 * Deterministic, and it never changes a value — it only says which ones not to
 * trust.
 */
const OUTLIER_MULTIPLE = 5;

export function detectPriceOutliers(dataset: ComparisonDataset): PriceOutlier[] {
  const outliers: PriceOutlier[] = [];

  for (const li of dataset.lineItems) {
    const priced = dataset.vendors
      .map((v) => ({ vendor: v, quote: getQuote(dataset, v.id, li.id) }))
      .filter((e): e is { vendor: (typeof dataset.vendors)[number]; quote: DatasetQuote } => usable(e.quote));

    // Two quotes cannot establish a norm; one of them would always be the outlier.
    if (priced.length < 3) continue;

    for (const entry of priced) {
      const peers = priced.filter((p) => p.vendor.id !== entry.vendor.id).map((p) => p.quote.evaluatedValue!);
      peers.sort((a, b) => a - b);
      const mid = Math.floor(peers.length / 2);
      const peerMedian = peers.length % 2 === 0 ? (peers[mid - 1] + peers[mid]) / 2 : peers[mid];
      if (peerMedian <= 0) continue;

      const value = entry.quote.evaluatedValue!;
      const multiple = value / peerMedian;
      if (multiple < OUTLIER_MULTIPLE && multiple > 1 / OUTLIER_MULTIPLE) continue;

      const dearer = multiple >= OUTLIER_MULTIPLE;
      const converted = entry.quote.sourceCurrency && entry.quote.sourceCurrency !== dataset.baseCurrency;
      outliers.push({
        vendorId: entry.vendor.id,
        vendorName: entry.vendor.name,
        lineItemId: li.id,
        lineItemName: li.name,
        evaluatedValue: round2(value),
        peerMedian: round2(peerMedian),
        multiple: Math.round(multiple * 10) / 10,
        reason: dearer
          ? `${Math.round(multiple)}x the median of the other quotes for this line` +
            (converted
              ? `. It was quoted in ${entry.quote.sourceCurrency} and converted — check whether the currency on the document is right.`
              : `. Check the unit basis on the source document before comparing it.`)
          : `A fraction of what every other vendor quoted for this line. Check the unit basis on the source document.`,
      });
    }
  }

  return outliers;
}

// ------------------------------------------------------------------- risks

export interface VendorRiskProfile {
  vendorId: string;
  vendorName: string;
  responseFormat: string;
  /** Line items with a price this system can compare. */
  itemsQuoted: number;
  /** Line items the vendor gave no price for. */
  itemsNotQuoted: number;
  /** Line items it priced on a basis that could not be converted. */
  itemsNotComparable: number;
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
  let itemsNotQuoted = 0;
  let itemsNotComparable = 0;
  for (const li of dataset.lineItems) {
    const q = getQuote(dataset, vendorId, li.id);
    if (usable(q)) {
      itemsQuoted += 1;
      if (q.confidence != null && q.confidence < 0.9) {
        lowConfidenceLineItems.push({ lineItemId: li.id, name: li.name, confidence: q.confidence });
      }
      continue;
    }
    // A vendor that priced an item on a basis we refused to convert has not
    // left it unpriced, and saying so sends the buyer chasing the wrong thing.
    if (quotedButUncomparable(q)) itemsNotComparable += 1;
    else itemsNotQuoted += 1;
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
    itemsNotQuoted,
    itemsNotComparable,
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

// ------------------------------------------------------------ comparability

export interface ComparabilityReport {
  baseCurrency: string;
  totalLineItems: number;
  comparableLineItems: number;
  excludedLineItems: Array<{ lineItemId: number; name: string; reason: string }>;
  /** Every place a number on screen is not the number on the vendor's page. */
  adjustments: Array<{
    vendorName: string;
    kind: "currency" | "unit_converted" | "unit_assumed" | "unit_refused";
    lineCount: number;
    detail: string;
  }>;
  /** Commercial elements nobody stated, which sit outside every total. */
  unstatedCommercials: Array<{ vendorName: string; element: string }>;
  directlyComparable: boolean;
}

/**
 * Whether these prices can be put side by side, and what had to happen first.
 *
 * The honest answer is almost never a plain yes. Vendors quote in their own
 * currency, on their own unit basis, and leave freight and tax to be settled
 * later. Each of those is a step between what the vendor wrote and what the
 * buyer reads, and this lists every one of them rather than presenting the
 * adjusted number as if it were the quote.
 */
export function comparabilityReport(
  dataset: ComparisonDataset,
  constraints: EligibilityConstraints = {},
): ComparabilityReport {
  const { eligibleVendorIds } = resolveEligibleVendors(dataset, constraints);
  const basket = buildComparableBasket(dataset, eligibleVendorIds);

  type Bucket = { lineCount: number; details: Set<string> };
  const buckets = new Map<string, Bucket>();
  const key = (vendorName: string, kind: string) => `${vendorName}||${kind}`;
  const add = (vendorName: string, kind: string, detail: string) => {
    const k = key(vendorName, kind);
    const b = buckets.get(k) ?? { lineCount: 0, details: new Set<string>() };
    b.lineCount += 1;
    b.details.add(detail);
    buckets.set(k, b);
  };

  for (const vendor of dataset.vendors) {
    for (const li of dataset.lineItems) {
      const q = getQuote(dataset, vendor.id, li.id);
      if (!q || q.status === "not_quoted") continue;

      if (q.sourceCurrency && q.sourceCurrency !== dataset.baseCurrency) {
        const rate = q.fxRate ? `${q.fxRate.rate} as of ${q.fxRate.asOf}` : "the reference rate on file";
        add(vendor.name, "currency", `${q.sourceCurrency} converted at ${rate}`);
      }

      if (q.evaluatedValue == null && q.sourceValue != null) {
        add(vendor.name, "unit_refused", `priced per "${q.sourceUnit ?? "an unstated basis"}", not converted`);
        continue;
      }

      if (!q.sourceUnit || !q.sourceUnit.trim()) {
        add(vendor.name, "unit_assumed", `no unit stated, read as a rate per ${li.unit}`);
      } else if (q.sourceValue != null && q.normalizedValue != null) {
        // The factor is not stored, so it is recovered from the two numbers.
        // Currency is divided out first so an FX conversion is not read as one.
        const inBase = q.sourceCurrency && q.fxRate ? q.sourceValue * q.fxRate.rate : q.sourceValue;
        const raw = q.normalizedValue === 0 ? 1 : inBase / q.normalizedValue;
        // The stored numbers are rounded to paise, so dividing them back gives
        // 99.82 where the vendor plainly wrote "per 100". Report the divisor the
        // vendor used, not the rounding error in our own two decimal places.
        const nearest = Math.round(raw);
        const factor = nearest > 0 && Math.abs(raw - nearest) / nearest < 0.01 ? nearest : Math.round(raw * 100) / 100;
        if (Math.abs(factor - 1) > 0.01) {
          add(
            vendor.name,
            "unit_converted",
            `priced per "${q.sourceUnit}", divided by ${factor} to reach a rate per ${li.unit}`,
          );
        }
      }
    }
  }

  const adjustments: ComparabilityReport["adjustments"] = [];
  for (const [k, b] of buckets) {
    const [vendorName, kind] = k.split("||");
    adjustments.push({
      vendorName,
      kind: kind as ComparabilityReport["adjustments"][number]["kind"],
      lineCount: b.lineCount,
      detail: [...b.details].join("; "),
    });
  }
  adjustments.sort((a, b) => b.lineCount - a.lineCount);

  const unstatedCommercials: ComparabilityReport["unstatedCommercials"] = [];
  for (const ex of dataset.exceptions) {
    if (ex.type !== "missing_freight" && ex.type !== "missing_tax") continue;
    const vendorName = dataset.vendors.find((v) => v.id === ex.vendorId)?.name ?? "A vendor";
    unstatedCommercials.push({ vendorName, element: ex.type === "missing_freight" ? "freight" : "tax" });
  }

  return {
    baseCurrency: dataset.baseCurrency,
    totalLineItems: dataset.lineItems.length,
    comparableLineItems: basket.lineItemIds.length,
    excludedLineItems: basket.excludedLineItems,
    adjustments,
    unstatedCommercials,
    directlyComparable: adjustments.length === 0 && basket.excludedLineItems.length === 0,
  };
}

// ------------------------------------------------------------ quality status

export interface QualityStandingReport {
  gatingQuestionCount: number;
  vendors: Array<{
    vendorId: string;
    vendorName: string;
    /** "passed" | "failed" | "unresolved" — failed means the vendor said no. */
    status: string;
    /** Criteria the vendor answered no to. These disqualify. */
    answeredNo: string[];
    /** Criteria the vendor left blank. These are unknown, not no. */
    unanswered: string[];
    verdict: string;
  }>;
  disqualified: string[];
  requiresVerification: string[];
  clear: string[];
}

/**
 * Where each vendor stands on the quality questionnaire.
 *
 * The whole point of this analysis is the distinction the summary line has to
 * carry: a vendor that answered no has ruled itself out, and a vendor that left
 * the question blank has told the buyer nothing. Both need action, but only one
 * of them is a reason to drop a supplier, and collapsing them into a single
 * "failed" count rejects companies on grounds nobody ever checked.
 */
export function qualityStanding(dataset: ComparisonDataset): QualityStandingReport {
  const disqualified: string[] = [];
  const requiresVerification: string[] = [];
  const clear: string[] = [];

  const vendors = dataset.vendors.map((v) => {
    const answeredNo = v.quality.hardFailures;
    const unanswered = v.quality.unresolved;

    let verdict: string;
    if (answeredNo.length > 0) {
      verdict =
        `Disqualified on ${answeredNo.length} criterion(s) the vendor answered no to` +
        (unanswered.length > 0 ? `, with ${unanswered.length} more left unanswered.` : ".");
      disqualified.push(v.name);
    } else if (unanswered.length > 0) {
      verdict =
        `Unknown — ${unanswered.length} gating criterion(s) were left unanswered. ` +
        `This is not a failure and not a pass; it requires verification with the vendor before award.`;
      requiresVerification.push(v.name);
    } else {
      verdict = "Answered every gating criterion, with no failures.";
      clear.push(v.name);
    }

    return {
      vendorId: v.id,
      vendorName: v.name,
      status: v.quality.status,
      answeredNo,
      unanswered,
      verdict,
    };
  });

  const gatingQuestionCount =
    vendors.length > 0
      ? Math.max(...vendors.map((v) => v.answeredNo.length + v.unanswered.length), 0)
      : 0;

  return { gatingQuestionCount, vendors, disqualified, requiresVerification, clear };
}

// -------------------------------------------------------------- vendor history

export interface VendorHistoryReport {
  /** Set when the question named one vendor. */
  focusVendorName: string | null;
  vendors: Array<{
    vendorId: string;
    vendorName: string;
    knownToUs: boolean;
    verificationStatus: string | null;
    verificationNote: string | null;
    city: string | null;
    onTimeDeliveryPct: number | null;
    awardsOnRecord: number;
    bidsOnRecord: number;
    qualityIncidents: number;
    records: Array<{
      reference: string;
      title: string;
      category: string;
      completedOn: string;
      outcome: string;
      performance: string | null;
      qualityIncidents: number;
      awardValueInr: number;
      wonBy: string;
    }>;
    summary: string;
  }>;
  source: string;
}

/**
 * What our own records say about the companies that responded.
 *
 * This reads the supplier registry and the closed procurements it is linked to.
 * Nothing here is inferred from the quotes in front of us: a vendor with no rows
 * is reported as absent from our records, which is not the same as new, and not
 * the same as bad. The distinction matters because "we have never bought from
 * them" is a reason to check, while "they performed badly" is a reason to stop.
 */
export function vendorHistory(dataset: ComparisonDataset, focusVendorName?: string | null): VendorHistoryReport {
  const wanted = focusVendorName?.trim().toLowerCase() ?? null;

  const vendors = dataset.vendors
    .filter((v) => !wanted || v.name.trim().toLowerCase().includes(wanted) || wanted.includes(v.name.trim().toLowerCase()))
    .map((v) => {
      const s = v.supplier;
      const records = (s?.history ?? []).map((h) => ({
        reference: h.externalId,
        title: h.title,
        category: h.category,
        completedOn: h.completedAt,
        outcome: h.result,
        performance: h.performance,
        qualityIncidents: h.qualityIncidents,
        awardValueInr: h.awardValueInr,
        wonBy: h.awardedVendorName,
      }));
      const awards = records.filter((r) => r.outcome === "awarded").length;
      const incidents = records.reduce((sum, r) => sum + r.qualityIncidents, 0);

      let summary: string;
      if (!s) {
        summary = `${v.name} does not match any supplier in our registry, so we hold no history for it.`;
      } else if (records.length === 0) {
        summary =
          `${v.name} is in the registry (${s.verificationStatus}) but appears in no closed procurement we hold. ` +
          `No prior work on record.`;
      } else {
        summary =
          `${v.name} appears in ${records.length} closed procurement(s), winning ${awards}. ` +
          `Delivery performance on record: ${records.map((r) => r.performance ?? "not recorded").join(", ")}. ` +
          `Quality incidents recorded: ${incidents}.`;
      }

      return {
        vendorId: v.id,
        vendorName: v.name,
        knownToUs: records.length > 0,
        verificationStatus: s?.verificationStatus ?? null,
        verificationNote: s?.verificationNote ?? null,
        city: s?.city ?? null,
        onTimeDeliveryPct: s?.onTimeDeliveryPct ?? null,
        awardsOnRecord: awards,
        bidsOnRecord: records.length,
        qualityIncidents: incidents,
        records,
        summary,
      };
    });

  return {
    focusVendorName: focusVendorName ?? null,
    vendors,
    source: "Supplier registry and closed procurement records held by this system. Not inferred from the current quotes.",
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
  vendorsWithIncompleteResponses: Array<{
    vendorId: string;
    vendorName: string;
    /** Line items this vendor gave no price for at all. */
    itemsNotQuoted: number;
    /** Line items it priced on a basis that could not be converted. */
    itemsNotComparable: number;
  }>;
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
      let itemsNotQuoted = 0;
      let itemsNotComparable = 0;
      for (const li of dataset.lineItems) {
        const quote = getQuote(dataset, v.id, li.id);
        if (usable(quote)) continue;
        if (quotedButUncomparable(quote)) itemsNotComparable += 1;
        else itemsNotQuoted += 1;
      }
      return { vendorId: v.id, vendorName: v.name, itemsNotQuoted, itemsNotComparable };
    })
    .filter((v) => v.itemsNotQuoted > 0 || v.itemsNotComparable > 0);

  return {
    total: dataset.exceptions.length,
    byType: [...byType.values()].sort((a, b) => b.count - a.count),
    bySeverity: [...bySeverity.entries()].map(([severity, count]) => ({ severity, count })),
    vendorsWithIncompleteResponses,
  };
}
