import { describe, expect, it } from "vitest";
import type { ComparisonDataset, DatasetQuote, DatasetVendor } from "../src/calc/dataset.js";
import { quoteKey } from "../src/calc/dataset.js";
import { EXPLAINABLE_FIGURES, explainFigure } from "../src/calc/derivation.js";
import { splitAward } from "../src/calc/engine.js";

/**
 * The derivations exist so a buyer can defend a number. These tests hold them to
 * that: every figure has to reconcile against an independently computed value,
 * and the derivation has to agree with the engine output the screen displays.
 */

function vendor(id: string, name: string, overrides: Partial<DatasetVendor> = {}): DatasetVendor {
  return {
    id,
    name,
    responseFormat: "xlsx",
    status: "processed",
    itemsFoundCount: null,
    itemsMissingCount: null,
    overallConfidence: 0.95,
    processingMs: 1000,
    questionnaire: [],
    quality: { status: "passed", hardFailures: [], unresolved: [] },
    ...overrides,
  };
}

function quote(vendorId: string, lineItemId: number, evaluatedValue: number | null): DatasetQuote {
  return {
    vendorId,
    lineItemId,
    status: evaluatedValue == null ? "not_quoted" : "verified",
    sourceValue: evaluatedValue,
    sourceCurrency: "INR",
    sourceUnit: "per piece",
    normalizedValue: evaluatedValue,
    normalizedUnit: "pcs",
    normalizedCurrency: "INR",
    evaluatedValue,
    confidence: evaluatedValue == null ? null : 0.95,
    confidenceLevel: evaluatedValue == null ? null : "high",
    discount: null,
    freight: null,
    tax: null,
    sourceDocument: "doc.xlsx",
    sourceLocation: "Row 1",
    sourceExcerpt: "…",
    fxRate: null,
    notes: null,
  };
}

/** Three line items, three vendors. A wins item 1, B wins items 2 and 3, and C
 * is disqualified on quality. Both A and B cover everything, so a single-vendor
 * baseline exists and a savings figure is computable. */
function makeDataset(): ComparisonDataset {
  const vendors = [
    vendor("a", "Vendor A"),
    vendor("b", "Vendor B"),
    vendor("c", "Vendor C", {
      quality: { status: "failed", hardFailures: ["Is the vendor ISO 9001 certified?"], unresolved: [] },
    }),
  ];
  const quotes = new Map<string, DatasetQuote>();
  // item 1, qty 100: A=10 (wins), B=12, C=1 (disqualified, must not lower anything)
  quotes.set(quoteKey("a", 1), quote("a", 1, 10));
  quotes.set(quoteKey("b", 1), quote("b", 1, 12));
  quotes.set(quoteKey("c", 1), quote("c", 1, 1));
  // item 2, qty 200: A=20, B=15 (wins)
  quotes.set(quoteKey("a", 2), quote("a", 2, 20));
  quotes.set(quoteKey("b", 2), quote("b", 2, 15));
  quotes.set(quoteKey("c", 2), quote("c", 2, null));
  // item 3, qty 50: A=40, B=30 (wins)
  quotes.set(quoteKey("a", 3), quote("a", 3, 40));
  quotes.set(quoteKey("b", 3), quote("b", 3, 30));
  quotes.set(quoteKey("c", 3), quote("c", 3, null));

  return {
    rfxId: "rfx1",
    rfxName: "Test event",
    baseCurrency: "INR",
    lineItems: [
      { id: 1, name: "Item One", specification: "spec", quantity: 100, unit: "pcs" },
      { id: 2, name: "Item Two", specification: "spec", quantity: 200, unit: "pcs" },
      { id: 3, name: "Item Three", specification: "spec", quantity: 50, unit: "pcs" },
    ],
    vendors,
    quotes,
    exceptions: [],
  };
}

/** An item nobody eligible priced — it must be excluded, never valued at zero. */
function datasetWithUnpricedItem(): ComparisonDataset {
  const dataset = makeDataset();
  dataset.lineItems.push({ id: 4, name: "Item Four", specification: "spec", quantity: 10, unit: "pcs" });
  dataset.quotes.set(quoteKey("a", 4), quote("a", 4, null));
  dataset.quotes.set(quoteKey("b", 4), quote("b", 4, null));
  return dataset;
}

describe("explainFigure", () => {
  it("returns a derivation for every advertised figure", () => {
    const dataset = makeDataset();
    for (const figure of EXPLAINABLE_FIGURES) {
      const needsVendor = figure === "vendor_total" || figure === "allocation";
      const derivation = explainFigure(dataset, figure, needsVendor ? { vendorId: "b" } : {});
      expect(derivation, figure).not.toBeNull();
      expect(derivation!.formula, figure).toBeTruthy();
      expect(derivation!.rule, figure).toBeTruthy();
    }
  });

  it("refuses an unknown figure rather than inventing one", () => {
    expect(explainFigure(makeDataset(), "profit_margin")).toBeNull();
  });

  it("requires a vendor for the per-vendor figures", () => {
    expect(explainFigure(makeDataset(), "vendor_total")).toBeNull();
    expect(explainFigure(makeDataset(), "allocation")).toBeNull();
    expect(explainFigure(makeDataset(), "allocation", { vendorId: "nobody" })).toBeNull();
  });
});

describe("derivation self-verification", () => {
  it("reconciles every check on every figure", () => {
    for (const dataset of [makeDataset(), datasetWithUnpricedItem()]) {
      for (const figure of EXPLAINABLE_FIGURES) {
        const needsVendor = figure === "vendor_total" || figure === "allocation";
        const d = explainFigure(dataset, figure, needsVendor ? { vendorId: "b" } : {})!;
        for (const c of d.checks) {
          expect(c.ok, `${figure} — ${c.label} (${c.expected} vs ${c.actual})`).toBe(true);
        }
      }
    }
  });

  it("never asserts a check it did not actually perform", () => {
    const d = explainFigure(makeDataset(), "savings")!;
    for (const c of d.checks) {
      expect(c.method.length).toBeGreaterThan(20);
      expect(c.expected).toBeTypeOf("number");
      expect(c.actual).toBeTypeOf("number");
    }
  });
});

describe("savings derivation", () => {
  it("matches the engine's own savings figure", () => {
    const dataset = makeDataset();
    const split = splitAward(dataset, { requireQualityPass: true });
    const d = explainFigure(dataset, "savings")!;
    expect(d.value).toBe(split.savingsVsBestSingleVendor);
  });

  it("breaks the figure down into rows that sum to it", () => {
    const d = explainFigure(makeDataset(), "savings")!;
    const table = d.tables[0];
    const summed = table.rows.reduce((s, r) => s + Number(r.diff), 0);
    expect(summed).toBeCloseTo(d.value!, 2);
    expect(table.footer!.diff).toBeCloseTo(d.value!, 2);
  });

  it("measures against the cheapest vendor that covers everything, not the cheapest vendor", () => {
    // Vendor B covers all three items at 12/15/30 = 1200+3000+1500 = 5700.
    // Vendor A covers all three at 10/20/40 = 1000+4000+2000 = 7000.
    // The split takes 10/15/30 = 1000+3000+1500 = 5500, so the saving is 200.
    const d = explainFigure(makeDataset(), "savings")!;
    expect(d.terms.find((t) => t.role === "input")!.value).toBe(5700);
    expect(d.value).toBe(200);
  });

  it("ignores a disqualified vendor's cheaper price entirely", () => {
    // Vendor C quoted item 1 at 1, far below anyone. It failed quality, so it
    // must not appear in the arithmetic and must be named as excluded instead.
    const d = explainFigure(makeDataset(), "savings")!;
    const rowText = JSON.stringify(d.tables[0].rows);
    expect(rowText).not.toContain("Vendor C");
    const excludedTable = d.tables.find((t) => t.caption.startsWith("Vendors not considered"));
    expect(excludedTable!.rows.map((r) => r.vendor)).toContain("Vendor C");
  });

  it("excludes an item nobody priced instead of valuing it at zero", () => {
    const d = explainFigure(datasetWithUnpricedItem(), "savings")!;
    const excluded = d.tables.find((t) => t.caption.startsWith("Excluded from this figure"));
    expect(excluded!.rows).toHaveLength(1);
    expect(excluded!.rows[0].item).toContain("Item Four");
    // The saving is unchanged by the unpriceable item — it contributes to neither side.
    expect(d.value).toBe(200);
    expect(d.exclusions.join(" ")).toContain("not counted as zero");
  });

  it("reports not-enough-information rather than a number when no baseline exists", () => {
    // Neither eligible vendor covers everything, so there is no single supplier
    // to compare a split against.
    const dataset = makeDataset();
    dataset.quotes.set(quoteKey("a", 3), quote("a", 3, null));
    dataset.quotes.set(quoteKey("b", 1), quote("b", 1, null));
    const d = explainFigure(dataset, "savings")!;
    expect(d.value).toBeNull();
    expect(d.terms.some((t) => t.valueText === "Not enough information")).toBe(true);
    expect(d.checks).toHaveLength(0);
  });
});

describe("vendor total derivation", () => {
  it("counts only what the vendor priced, and names what it did not", () => {
    const dataset = datasetWithUnpricedItem();
    const d = explainFigure(dataset, "vendor_total", { vendorId: "a" })!;
    // A priced items 1-3 at 10x100 + 20x200 + 40x50 = 7000, and left item 4 unpriced.
    expect(d.value).toBe(7000);
    const notPriced = d.tables.find((t) => t.caption.startsWith("Not priced"));
    expect(notPriced!.rows).toHaveLength(1);
    expect(d.exclusions.join(" ")).toContain("did not price");
  });
});

describe("provenance", () => {
  it("states on every figure that no model produced the number", () => {
    for (const figure of EXPLAINABLE_FIGURES) {
      const needsVendor = figure === "vendor_total" || figure === "allocation";
      const d = explainFigure(makeDataset(), figure, needsVendor ? { vendorId: "b" } : {})!;
      expect(d.provenance, figure).toContain("No language model");
    }
  });
});
