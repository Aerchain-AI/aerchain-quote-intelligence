import { buildAwardRecommendation } from "../award/recommend.js";
import type { ComparisonDataset, DatasetQuote } from "./dataset.js";
import { cheapestPerLine, getQuote, resolveEligibleVendors, splitAward } from "./engine.js";

/**
 * Derivations — "show me why this number is what it is".
 *
 * Every figure the buyer sees on screen can be opened up here into the exact
 * arithmetic that produced it: the rule that was applied, the inputs it consumed,
 * the row-by-row contributions, what was deliberately left out, and an independent
 * recomputation that has to agree.
 *
 * NO LANGUAGE MODEL IS INVOLVED IN THIS FILE, by design. A number a buyer is
 * about to award a contract on cannot be explained by something that might
 * paraphrase it wrongly. The explanation is produced by the same deterministic
 * code path that produced the number, so it cannot drift from it — and the
 * `checks` array proves it, by recomputing the result a second, different way
 * and comparing. If a check fails, the UI says so rather than hiding it.
 */

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function usable(quote: DatasetQuote | undefined): quote is DatasetQuote {
  return !!quote && quote.status !== "not_quoted" && quote.evaluatedValue != null;
}

// ------------------------------------------------------------------- shapes

/** One line of the arithmetic. Rendered as a ledger. */
export interface DerivationTerm {
  role: "input" | "operator" | "result";
  label: string;
  /** Money or count. null means genuinely absent — never rendered as zero. */
  value: number | null;
  /** Used when the term is not numeric. */
  valueText?: string;
  /** Overrides the derivation's own kind — a currency derivation still has
   * count terms (how many lines were won, how many items went unpriced). */
  kind?: "currency" | "count";
  note?: string;
}

export interface DerivationColumn {
  key: string;
  label: string;
  align: "left" | "right";
  kind?: "currency" | "number" | "text";
}

export interface DerivationTable {
  caption: string;
  note?: string;
  columns: DerivationColumn[];
  rows: Array<Record<string, string | number | null>>;
  footer?: Record<string, string | number | null>;
}

/** An independent recomputation. This is the proof, not a restatement. */
export interface DerivationCheck {
  label: string;
  expected: number;
  actual: number;
  ok: boolean;
  method: string;
}

export interface Derivation {
  figure: string;
  title: string;
  value: number | null;
  valueKind: "currency" | "count";
  /** The formula in symbols — short enough to read in one glance. */
  formula: string;
  /** The policy behind the formula, in a sentence a buyer would defend in a review. */
  rule: string;
  terms: DerivationTerm[];
  tables: DerivationTable[];
  /** What this number counts. */
  inclusions: string[];
  /** What it deliberately does not count, and why. Omissions are what make a
   * savings figure indefensible, so they are stated rather than implied. */
  exclusions: string[];
  checks: DerivationCheck[];
  provenance: string;
}

const PROVENANCE =
  "Computed by the deterministic calculation engine from extracted quote data. No language model participated in this arithmetic or in this explanation.";

function check(label: string, expected: number, actual: number, method: string): DerivationCheck {
  // Tolerance is one paisa — these are all sums of two-decimal money values.
  return { label, expected: round2(expected), actual: round2(actual), ok: Math.abs(expected - actual) < 0.01, method };
}

// ------------------------------------------------------------------ figures

export const EXPLAINABLE_FIGURES = [
  "savings",
  "total_evaluated_cost",
  "awarded_items",
  "quality_qualified_vendors",
  "vendor_total",
  "allocation",
] as const;

export type ExplainableFigure = (typeof EXPLAINABLE_FIGURES)[number];

const CONSTRAINTS = { requireQualityPass: true };

export function explainFigure(
  dataset: ComparisonDataset,
  figure: string,
  params: { vendorId?: string } = {},
): Derivation | null {
  switch (figure) {
    case "savings":
      return explainSavings(dataset);
    case "total_evaluated_cost":
      return explainTotalEvaluatedCost(dataset);
    case "awarded_items":
      return explainAwardedItems(dataset);
    case "quality_qualified_vendors":
      return explainQualityQualifiedVendors(dataset);
    case "vendor_total":
      return params.vendorId ? explainVendorTotal(dataset, params.vendorId) : null;
    case "allocation":
      return params.vendorId ? explainAllocation(dataset, params.vendorId) : null;
    default:
      return null;
  }
}

// ------------------------------------------------------------------ savings

function explainSavings(dataset: ComparisonDataset): Derivation {
  const split = splitAward(dataset, CONSTRAINTS);
  const { lines } = cheapestPerLine(dataset, CONSTRAINTS);
  const recommendation = buildAwardRecommendation(dataset);

  const baselineId = split.bestSingleVendorId;
  const baselineName = split.bestSingleVendorName;

  if (baselineId == null || split.bestSingleVendorTotal == null) {
    return {
      figure: "savings",
      title: "Estimated savings",
      value: null,
      valueKind: "currency",
      formula: "savings = baseline − split total",
      rule:
        "A saving is only claimed against a baseline the buyer could actually have chosen instead — one supplier able to deliver every awarded item on its own.",
      terms: [
        { role: "input", label: "Split award total", value: split.splitTotal },
        {
          role: "result",
          label: "No baseline exists",
          value: null,
          valueText: "Not enough information",
          note: "No single quality-qualified vendor priced every awarded item, so there is nothing honest to compare the split against.",
        },
      ],
      tables: [],
      inclusions: [],
      exclusions: [
        "No figure is shown, rather than comparing against a cheaper vendor that covers only part of the order — that comparison would overstate the saving.",
      ],
      checks: [],
      provenance: PROVENANCE,
    };
  }

  const inclusions: string[] = [];
  const exclusions: string[] = [];
  const terms: DerivationTerm[] = [];
  const tables: DerivationTable[] = [];
  const checks: DerivationCheck[] = [];

  // Row by row: what the split pays, against what the single-vendor baseline would pay.
  const rows: DerivationTable["rows"] = [];
  let splitSum = 0;
  let baselineSum = 0;
  let diffSum = 0;
  let baselineCoverage = 0;

  for (const line of lines) {
    if (!line.winnerVendorId || line.winnerLineTotal == null) continue;
    const baselineQuote = getQuote(dataset, baselineId, line.lineItemId);
    if (!usable(baselineQuote)) continue;
    baselineCoverage += 1;

    const baselineLineTotal = round2(baselineQuote.evaluatedValue! * line.quantity);
    const diff = round2(baselineLineTotal - line.winnerLineTotal);
    splitSum = round2(splitSum + line.winnerLineTotal);
    baselineSum = round2(baselineSum + baselineLineTotal);
    diffSum = round2(diffSum + diff);

    rows.push({
      item: `#${line.lineItemId} ${line.lineItemName}`,
      qty: `${line.quantity.toLocaleString("en-IN")} ${line.unit}`,
      winner: line.winnerVendorName,
      winnerUnit: line.winnerUnitPrice,
      winnerTotal: line.winnerLineTotal,
      baselineUnit: baselineQuote.evaluatedValue,
      baselineTotal: baselineLineTotal,
      diff,
    });
  }

  // Biggest contributors first — the order a buyer defends the number in.
  rows.sort((a, b) => (Number(b.diff) || 0) - (Number(a.diff) || 0));

  tables.push({
    caption: `Line-by-line contribution (${rows.length} awarded items)`,
    note: `Each row is the same item bought two ways: from the cheapest qualified supplier for that item, against buying everything from ${baselineName}. The last column is what the split saves on that row.`,
    columns: [
      { key: "item", label: "Item", align: "left", kind: "text" },
      { key: "qty", label: "Qty", align: "right", kind: "text" },
      { key: "winner", label: "Awarded to", align: "left", kind: "text" },
      { key: "winnerUnit", label: "Unit", align: "right", kind: "currency" },
      { key: "winnerTotal", label: "Line total", align: "right", kind: "currency" },
      { key: "baselineUnit", label: `${baselineName} unit`, align: "right", kind: "currency" },
      { key: "baselineTotal", label: `${baselineName} total`, align: "right", kind: "currency" },
      { key: "diff", label: "Saved", align: "right", kind: "currency" },
    ],
    rows,
    footer: { item: "Total", winnerTotal: splitSum, baselineTotal: baselineSum, diff: diffSum },
  });

  if (split.unawardedItems.length > 0) {
    tables.push({
      caption: `Excluded from this figure (${split.unawardedItems.length} items)`,
      note: "No quality-qualified vendor supplied a usable price for these, so they contribute nothing to either side of the comparison. They are not counted as ₹0.",
      columns: [
        { key: "item", label: "Item", align: "left", kind: "text" },
        { key: "reason", label: "Why it is excluded", align: "left", kind: "text" },
      ],
      rows: split.unawardedItems.map((u) => ({ item: `#${u.lineItemId} ${u.name}`, reason: u.reason })),
    });
    exclusions.push(
      `${split.unawardedItems.length} line item(s) sit outside this figure entirely because no eligible vendor priced them. They are excluded from both totals, not counted as zero.`,
    );
  }

  const eligibility = resolveEligibleVendors(dataset, CONSTRAINTS);
  if (eligibility.excluded.length > 0) {
    tables.push({
      caption: `Vendors not considered (${eligibility.excluded.length})`,
      note: "Removed before any price was compared, so their prices could not lower either total.",
      columns: [
        { key: "vendor", label: "Vendor", align: "left", kind: "text" },
        { key: "reason", label: "Reason", align: "left", kind: "text" },
      ],
      rows: eligibility.excluded.map((v) => ({ vendor: v.vendorName, reason: v.reason })),
    });
    exclusions.push(
      `${eligibility.excluded.length} vendor(s) were excluded on quality grounds before pricing was compared.`,
    );
  }

  terms.push({
    role: "input",
    label: `Baseline — buy all ${rows.length} items from ${baselineName}`,
    value: split.bestSingleVendorTotal,
    note: "The cheapest single vendor able to cover every awarded item on its own.",
  });
  terms.push({
    role: "operator",
    label: "less the recommended split award",
    value: split.splitTotal,
    note: `Each item bought from whichever qualified vendor priced it lowest, across ${split.allocations.length} vendors.`,
  });
  terms.push({ role: "result", label: "Estimated savings", value: split.savingsVsBestSingleVendor });

  inclusions.push(
    `${rows.length} line items that a quality-qualified vendor priced and that ${baselineName} also priced.`,
  );
  inclusions.push("Evaluated unit cost — currency-normalised, unit-normalised, net of stated discounts — times the RFx quantity.");
  exclusions.push("Tax is excluded where a vendor did not state it. Evaluated costs are pre-tax and comparable only on that basis.");

  if (recommendation.strategy === "single_vendor") {
    exclusions.push(
      "The recommendation is a single-vendor award, so this saving is shown as context rather than claimed: it falls under the 0.5% materiality threshold that would justify managing multiple suppliers.",
    );
  }

  // ---- proof: recompute the same number two independent ways.
  checks.push(
    check(
      "Per-line savings sum to the headline figure",
      split.savingsVsBestSingleVendor ?? 0,
      diffSum,
      "Summed the per-row difference between the baseline line total and the awarded line total, then compared it to (baseline total − split total), which is accumulated separately.",
    ),
  );
  checks.push(
    check(
      "Split total equals the sum of vendor allocations",
      split.splitTotal,
      split.allocations.reduce((s, a) => s + a.total, 0),
      "Added each vendor's allocated total, which is built by a different grouping than the per-line pass.",
    ),
  );
  checks.push(
    check(
      "Baseline vendor covers every awarded item",
      split.awardedItemCount,
      baselineCoverage,
      `Counted the awarded items ${baselineName} also priced. If this falls short, the baseline is not a like-for-like alternative.`,
    ),
  );

  return {
    figure: "savings",
    title: "Estimated savings",
    value: split.savingsVsBestSingleVendor,
    valueKind: "currency",
    formula: "savings = (baseline single-vendor total) − (split award total)",
    rule:
      "Savings are measured against the best alternative the buyer could actually have chosen: the cheapest single quality-qualified supplier able to deliver every awarded item. Never against a budget, a list price, or the most expensive quote received.",
    terms,
    tables,
    inclusions,
    exclusions,
    checks,
    provenance: PROVENANCE,
  };
}

// ------------------------------------------------------- total evaluated cost

function explainTotalEvaluatedCost(dataset: ComparisonDataset): Derivation {
  const split = splitAward(dataset, CONSTRAINTS);
  const { lines } = cheapestPerLine(dataset, CONSTRAINTS);
  const recommendation = buildAwardRecommendation(dataset);
  const singleVendor = recommendation.strategy === "single_vendor";

  const awarded = lines.filter((l) => l.winnerVendorId && l.winnerLineTotal != null);
  const rows = awarded.map((l) => ({
    item: `#${l.lineItemId} ${l.lineItemName}`,
    vendor: l.winnerVendorName,
    qty: `${l.quantity.toLocaleString("en-IN")} ${l.unit}`,
    unit: l.winnerUnitPrice,
    total: l.winnerLineTotal,
  }));
  const rowSum = rows.reduce((s, r) => s + (Number(r.total) || 0), 0);

  const terms: DerivationTerm[] = split.allocations.map((a) => ({
    role: "input" as const,
    label: `${a.vendorName} — ${a.itemCount} item(s)`,
    value: a.total,
  }));
  terms.push({
    role: "result",
    label: singleVendor
      ? `Single-vendor award to ${recommendation.singleVendorOption?.vendorName ?? "the recommended vendor"}`
      : "Total evaluated cost",
    value: recommendation.totalEvaluatedCost,
  });

  return {
    figure: "total_evaluated_cost",
    title: "Total evaluated cost",
    value: recommendation.totalEvaluatedCost,
    valueKind: "currency",
    formula: "total = Σ (evaluated unit cost × quantity) over every awarded line item",
    rule:
      "Evaluated cost is the landed per-unit cost after currency conversion, unit normalisation, discounts and any stated freight — not the headline price on the quotation. Each line is priced at whichever qualified vendor quoted it lowest.",
    terms,
    tables: [
      {
        caption: `Awarded lines (${rows.length})`,
        note: "Every row that contributes to the total, at the price used to compute it.",
        columns: [
          { key: "item", label: "Item", align: "left", kind: "text" },
          { key: "vendor", label: "Awarded to", align: "left", kind: "text" },
          { key: "qty", label: "Qty", align: "right", kind: "text" },
          { key: "unit", label: "Evaluated unit", align: "right", kind: "currency" },
          { key: "total", label: "Line total", align: "right", kind: "currency" },
        ],
        rows,
        footer: { item: "Total", total: round2(rowSum) },
      },
    ],
    inclusions: [`${rows.length} of ${dataset.lineItems.length} line items — the ones a quality-qualified vendor priced.`],
    exclusions: [
      split.unawardedItems.length > 0
        ? `${split.unawardedItems.length} item(s) with no usable price from any eligible vendor. Omitted, not valued at ₹0 — pretending an unpriced item is free would understate this total.`
        : "Nothing was omitted — every line item was priced by at least one eligible vendor.",
      "Tax is excluded where the vendor did not state it.",
    ],
    checks: [
      check(
        "Line totals sum to the reported total",
        split.splitTotal,
        rowSum,
        "Re-added every awarded line total from the per-line pass and compared it to the split total accumulated separately.",
      ),
      check(
        "Vendor allocations sum to the same total",
        split.splitTotal,
        split.allocations.reduce((s, a) => s + a.total, 0),
        "Added the per-vendor allocations, which are built by a different grouping than the per-line list.",
      ),
    ],
    provenance: PROVENANCE,
  };
}

// ------------------------------------------------------------- awarded items

function explainAwardedItems(dataset: ComparisonDataset): Derivation {
  const split = splitAward(dataset, CONSTRAINTS);

  const tables: DerivationTable[] = [
    {
      caption: `Awarded (${split.awardedItemCount})`,
      columns: [
        { key: "vendor", label: "Vendor", align: "left", kind: "text" },
        { key: "count", label: "Items", align: "right", kind: "number" },
        { key: "items", label: "Line item numbers", align: "left", kind: "text" },
      ],
      rows: split.allocations.map((a) => ({
        vendor: a.vendorName,
        count: a.itemCount,
        items: a.lineItemIds.map((id) => `#${id}`).join(", "),
      })),
      footer: { vendor: "Total", count: split.awardedItemCount },
    },
  ];
  if (split.unawardedItems.length > 0) {
    tables.push({
      caption: `Not awarded (${split.unawardedItems.length})`,
      columns: [
        { key: "item", label: "Item", align: "left", kind: "text" },
        { key: "reason", label: "Reason", align: "left", kind: "text" },
      ],
      rows: split.unawardedItems.map((u) => ({ item: `#${u.lineItemId} ${u.name}`, reason: u.reason })),
    });
  }

  return {
    figure: "awarded_items",
    title: "Awarded items",
    value: split.awardedItemCount,
    valueKind: "count",
    formula: "awarded = line items with at least one usable price from a quality-qualified vendor",
    rule:
      "An item is awardable only if a vendor that passed the quality gate gave it a price the engine could evaluate. A blank, a dash, or a value the extractor could not resolve is not a price.",
    terms: [
      { role: "input", label: "Line items in the RFx", value: dataset.lineItems.length },
      { role: "operator", label: "less items no eligible vendor priced", value: split.unawardedItems.length },
      { role: "result", label: "Awarded", value: split.awardedItemCount },
    ],
    tables,
    inclusions: ["Items priced by at least one vendor that passed the quality gate."],
    exclusions: [
      "Items priced only by a vendor that failed a gating quality question — that price cannot be awarded, so the item does not count as covered.",
    ],
    checks: [
      check(
        "Awarded plus unawarded equals the RFx line count",
        dataset.lineItems.length,
        split.awardedItemCount + split.unawardedItems.length,
        "Counted both partitions independently and compared to the stored line item count.",
      ),
      check(
        "Allocation item counts sum to the awarded count",
        split.awardedItemCount,
        split.allocations.reduce((s, a) => s + a.itemCount, 0),
        "Summed each vendor's allocated item count.",
      ),
    ],
    provenance: PROVENANCE,
  };
}

// -------------------------------------------------- quality-qualified vendors

function explainQualityQualifiedVendors(dataset: ComparisonDataset): Derivation {
  const eligibility = resolveEligibleVendors(dataset, CONSTRAINTS);
  const eligible = dataset.vendors.filter((v) => eligibility.eligibleVendorIds.includes(v.id));

  const tables: DerivationTable[] = [
    {
      caption: `Qualified (${eligible.length})`,
      columns: [
        { key: "vendor", label: "Vendor", align: "left", kind: "text" },
        { key: "status", label: "Quality verdict", align: "left", kind: "text" },
        { key: "note", label: "Outstanding", align: "left", kind: "text" },
      ],
      rows: eligible.map((v) => ({
        vendor: v.name,
        status: v.quality.status === "passed" ? "Passed all gating questions" : "Unresolved answers",
        note: v.quality.unresolved.length > 0 ? v.quality.unresolved.join("; ") : "—",
      })),
    },
  ];
  if (eligibility.excluded.length > 0) {
    tables.push({
      caption: `Disqualified (${eligibility.excluded.length})`,
      columns: [
        { key: "vendor", label: "Vendor", align: "left", kind: "text" },
        { key: "reason", label: "Reason", align: "left", kind: "text" },
      ],
      rows: eligibility.excluded.map((v) => ({ vendor: v.vendorName, reason: v.reason })),
    });
  }

  return {
    figure: "quality_qualified_vendors",
    title: "Quality-qualified vendors",
    value: eligibility.eligibleVendorIds.length,
    valueKind: "count",
    formula: "qualified = vendors that responded − vendors that answered no to a gating question",
    rule:
      'Only an explicit "no" on a gating quality question disqualifies a vendor. A blank or hedged answer leaves the question unresolved for the buyer to settle — never treated as a rejection, because dropping a vendor over a question they simply did not answer is a decision the buyer never made.',
    terms: [
      { role: "input", label: "Vendors that responded", value: dataset.vendors.length },
      { role: "operator", label: "less vendors that failed a gating question", value: eligibility.excluded.length },
      { role: "result", label: "Quality-qualified", value: eligibility.eligibleVendorIds.length },
    ],
    tables,
    inclusions: [
      "Vendors that passed every gating question, plus vendors with unresolved answers pending buyer judgement.",
    ],
    exclusions: ['Vendors that answered "no" to a gating question.'],
    checks: [
      check(
        "Qualified plus disqualified equals vendors that responded",
        dataset.vendors.length,
        eligibility.eligibleVendorIds.length + eligibility.excluded.length,
        "Counted both partitions and compared to the number of vendor responses loaded for this event.",
      ),
    ],
    provenance: PROVENANCE,
  };
}

// -------------------------------------------------------------- vendor total

function explainVendorTotal(dataset: ComparisonDataset, vendorId: string): Derivation | null {
  const vendor = dataset.vendors.find((v) => v.id === vendorId);
  if (!vendor) return null;

  const rows: DerivationTable["rows"] = [];
  const missing: DerivationTable["rows"] = [];
  let total = 0;

  for (const li of dataset.lineItems) {
    const q = getQuote(dataset, vendorId, li.id);
    if (usable(q)) {
      const lineTotal = round2(q.evaluatedValue! * li.quantity);
      total = round2(total + lineTotal);
      rows.push({
        item: `#${li.id} ${li.name}`,
        qty: `${li.quantity.toLocaleString("en-IN")} ${li.unit}`,
        source: q.sourceValue != null ? `${q.sourceCurrency ?? "INR"} ${q.sourceValue.toLocaleString("en-IN")}` : "—",
        unit: q.evaluatedValue,
        total: lineTotal,
      });
    } else {
      missing.push({ item: `#${li.id} ${li.name}`, reason: q ? "Marked not quoted" : "Absent from the response" });
    }
  }

  const tables: DerivationTable[] = [
    {
      caption: `Priced items (${rows.length})`,
      note: "As quoted is what appeared on the vendor's document. Evaluated unit is that value after currency conversion and unit normalisation.",
      columns: [
        { key: "item", label: "Item", align: "left", kind: "text" },
        { key: "qty", label: "Qty", align: "right", kind: "text" },
        { key: "source", label: "As quoted", align: "right", kind: "text" },
        { key: "unit", label: "Evaluated unit", align: "right", kind: "currency" },
        { key: "total", label: "Line total", align: "right", kind: "currency" },
      ],
      rows,
      footer: { item: "Total of priced items", total },
    },
  ];
  if (missing.length > 0) {
    tables.push({
      caption: `Not priced (${missing.length})`,
      note: "These contribute nothing to the total above. That is exactly why this column is not directly comparable to a vendor with full coverage.",
      columns: [
        { key: "item", label: "Item", align: "left", kind: "text" },
        { key: "reason", label: "Reason", align: "left", kind: "text" },
      ],
      rows: missing,
    });
  }

  return {
    figure: "vendor_total",
    title: `${vendor.name} — total of priced items`,
    value: total,
    valueKind: "currency",
    formula: "total = Σ (evaluated unit cost × quantity) over the items this vendor priced",
    rule:
      "This total covers only what this vendor actually quoted. Unpriced items are left out rather than valued at zero, so a vendor with gaps shows a lower total than a vendor with full coverage — which is why ranking uses a shared basket instead of this column.",
    terms: [
      { role: "input", label: "Items priced", value: rows.length, kind: "count" },
      { role: "input", label: "Items not priced", value: missing.length, kind: "count" },
      { role: "result", label: "Total of priced items", value: total },
    ],
    tables,
    inclusions: [`${rows.length} of ${dataset.lineItems.length} line items.`],
    exclusions:
      missing.length > 0
        ? [
            `${missing.length} item(s) this vendor did not price. Comparing this total against a vendor who priced everything would favour the incomplete response.`,
          ]
        : ["Nothing — this vendor priced every line item."],
    checks: [
      check(
        "Priced plus unpriced equals the RFx line count",
        dataset.lineItems.length,
        rows.length + missing.length,
        "Counted both partitions against the stored line item count.",
      ),
      check(
        "Row totals sum to the column total",
        total,
        rows.reduce((s, r) => s + (Number(r.total) || 0), 0),
        "Re-added every line total shown in the table above.",
      ),
    ],
    provenance: PROVENANCE,
  };
}

// ---------------------------------------------------------------- allocation

function explainAllocation(dataset: ComparisonDataset, vendorId: string): Derivation | null {
  const split = splitAward(dataset, CONSTRAINTS);
  const allocation = split.allocations.find((a) => a.vendorId === vendorId);
  if (!allocation) return null;
  const { lines } = cheapestPerLine(dataset, CONSTRAINTS);

  const rows = lines
    .filter((l) => l.winnerVendorId === vendorId)
    .map((l) => ({
      item: `#${l.lineItemId} ${l.lineItemName}`,
      qty: `${l.quantity.toLocaleString("en-IN")} ${l.unit}`,
      unit: l.winnerUnitPrice,
      total: l.winnerLineTotal,
      runnerUp: l.runnerUpVendorName ?? "No other vendor priced this",
      runnerUpUnit: l.runnerUpUnitPrice,
      margin: l.marginOverRunnerUp,
    }));

  return {
    figure: "allocation",
    title: `${allocation.vendorName} — recommended allocation`,
    value: allocation.total,
    valueKind: "currency",
    formula: "allocation = Σ (evaluated unit cost × quantity) over the lines this vendor won",
    rule:
      "A vendor wins a line by having the lowest evaluated unit cost on that line among quality-qualified vendors. Nothing else enters the decision — not order size, not relationship, not the overall total.",
    terms: [
      { role: "input", label: "Lines won", value: allocation.itemCount, kind: "count" },
      { role: "result", label: "Allocated value", value: allocation.total },
    ],
    tables: [
      {
        caption: `Lines won (${rows.length})`,
        note: "Margin is how much this vendor beat the next-cheapest vendor by on that line. A thin margin is worth checking against the source document.",
        columns: [
          { key: "item", label: "Item", align: "left", kind: "text" },
          { key: "qty", label: "Qty", align: "right", kind: "text" },
          { key: "unit", label: "Winning unit", align: "right", kind: "currency" },
          { key: "total", label: "Line total", align: "right", kind: "currency" },
          { key: "runnerUp", label: "Next cheapest", align: "left", kind: "text" },
          { key: "runnerUpUnit", label: "Their unit", align: "right", kind: "currency" },
          { key: "margin", label: "Margin", align: "right", kind: "currency" },
        ],
        rows,
        footer: { item: "Total", total: allocation.total },
      },
    ],
    inclusions: [`${rows.length} line item(s) where this vendor quoted the lowest evaluated cost.`],
    exclusions: ["Lines another qualified vendor priced lower, and lines this vendor did not price."],
    checks: [
      check(
        "Line totals sum to the allocated value",
        allocation.total,
        rows.reduce((s, r) => s + (Number(r.total) || 0), 0),
        "Re-added the winning line totals for this vendor from the per-line pass.",
      ),
      check(
        "Line count matches the allocation",
        allocation.itemCount,
        rows.length,
        "Counted the lines this vendor won independently of the grouping that produced the allocation.",
      ),
    ],
    provenance: PROVENANCE,
  };
}
