import { describe, expect, it } from "vitest";
import type { ComparisonDataset, DatasetQuote, DatasetVendor } from "../src/calc/dataset.js";
import { quoteKey } from "../src/calc/dataset.js";
import {
  buildComparableBasket,
  cheapestOverall,
  cheapestPerLine,
  resolveEligibleVendors,
  scenarioAdditionalDiscount,
  splitAward,
} from "../src/calc/engine.js";
import { buildAwardRecommendation } from "../src/award/recommend.js";

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

/** Two line items, three vendors. A is cheap on item 1, B is cheap on item 2,
 * C fails quality and hasn't priced item 2. */
function makeDataset(): ComparisonDataset {
  const vendors = [
    vendor("a", "Vendor A"),
    vendor("b", "Vendor B"),
    vendor("c", "Vendor C", {
      quality: { status: "failed", hardFailures: ["Is the vendor ISO 9001 certified?"], unresolved: [] },
    }),
  ];
  const quotes = new Map<string, DatasetQuote>();
  // item 1 (qty 100): A=10, B=12, C=8
  quotes.set(quoteKey("a", 1), quote("a", 1, 10));
  quotes.set(quoteKey("b", 1), quote("b", 1, 12));
  quotes.set(quoteKey("c", 1), quote("c", 1, 8));
  // item 2 (qty 200): A=20, B=15, C not quoted
  quotes.set(quoteKey("a", 2), quote("a", 2, 20));
  quotes.set(quoteKey("b", 2), quote("b", 2, 15));
  quotes.set(quoteKey("c", 2), quote("c", 2, null));

  return {
    rfxId: "rfx1",
    rfxName: "Test event",
    baseCurrency: "INR",
    lineItems: [
      { id: 1, name: "Item One", specification: "spec", quantity: 100, unit: "pcs" },
      { id: 2, name: "Item Two", specification: "spec", quantity: 200, unit: "pcs" },
    ],
    vendors,
    quotes,
    exceptions: [],
  };
}

describe("resolveEligibleVendors", () => {
  it("returns everyone when no constraints are applied", () => {
    const result = resolveEligibleVendors(makeDataset());
    expect(result.eligibleVendorIds).toHaveLength(3);
    expect(result.excluded).toHaveLength(0);
  });

  it("excludes vendors that answered no to a quality criterion, with a reason", () => {
    const result = resolveEligibleVendors(makeDataset(), { requireQualityPass: true });
    expect(result.eligibleVendorIds).toEqual(["a", "b"]);
    expect(result.excluded[0].vendorName).toBe("Vendor C");
    expect(result.excluded[0].reason).toContain("Answered no");
  });

  it("keeps a vendor with unresolved answers eligible, but flags it", () => {
    const dataset = makeDataset();
    const b = dataset.vendors.find((v) => v.id === "b")!;
    b.quality = { status: "unresolved", hardFailures: [], unresolved: ["Can the vendor support emergency orders?"] };
    const result = resolveEligibleVendors(dataset, { requireQualityPass: true });
    // An unanswered question is not a "no" — the buyer decides, not the system.
    expect(result.eligibleVendorIds).toContain("b");
    expect(result.excluded.map((e) => e.vendorId)).not.toContain("b");
    expect(result.flagged[0].vendorName).toBe("Vendor B");
    expect(result.flagged[0].reason).toContain("emergency orders");
  });

  it("excludes vendors with incomplete responses when asked", () => {
    const result = resolveEligibleVendors(makeDataset(), { requireCompleteResponse: true });
    expect(result.eligibleVendorIds).toEqual(["a", "b"]);
    expect(result.excluded[0].reason).toContain("Incomplete response");
  });
});

describe("buildComparableBasket", () => {
  it("only includes line items every compared vendor priced", () => {
    const basket = buildComparableBasket(makeDataset(), ["a", "b", "c"]);
    expect(basket.lineItemIds).toEqual([1]);
    expect(basket.excludedLineItems[0].reason).toContain("Vendor C");
  });

  it("never treats a missing price as zero", () => {
    const basket = buildComparableBasket(makeDataset(), ["a", "b", "c"]);
    const c = basket.totals.find((t) => t.vendorId === "c")!;
    // C priced item 1 only: 8 × 100 = 800. Item 2 must not contribute 0.
    expect(c.ownBasketTotal).toBe(800);
    expect(c.itemsWithoutComparablePrice).toBe(1);
  });

  it("gives a comparable total only to vendors covering the whole basket", () => {
    const basket = buildComparableBasket(makeDataset(), ["a", "b"]);
    expect(basket.lineItemIds).toEqual([1, 2]);
    const a = basket.totals.find((t) => t.vendorId === "a")!;
    const b = basket.totals.find((t) => t.vendorId === "b")!;
    expect(a.comparableTotal).toBe(10 * 100 + 20 * 200); // 5000
    expect(b.comparableTotal).toBe(12 * 100 + 15 * 200); // 4200
  });
});

describe("cheapestOverall", () => {
  it("ranks on the shared basket and names the winner", () => {
    const result = cheapestOverall(makeDataset(), { requireQualityPass: true });
    expect(result.ranking[0].vendorName).toBe("Vendor B");
    expect(result.winnerVendorId).toBe("b");
  });

  it("explains when items were dropped from the comparison", () => {
    const result = cheapestOverall(makeDataset());
    expect(result.basketSize).toBe(1);
    expect(result.caveats.join(" ")).toContain("excluded from this comparison");
  });
});

describe("cheapestPerLine", () => {
  it("picks the cheapest vendor per item and reports the runner-up margin", () => {
    const { lines } = cheapestPerLine(makeDataset(), { requireQualityPass: true });
    expect(lines[0].winnerVendorName).toBe("Vendor A"); // 10 vs 12
    expect(lines[1].winnerVendorName).toBe("Vendor B"); // 15 vs 20
    expect(lines[1].marginOverRunnerUp).toBe((20 - 15) * 200);
  });

  it("reports no winner rather than inventing one when nobody priced an item", () => {
    const dataset = makeDataset();
    dataset.quotes.set(quoteKey("a", 2), quote("a", 2, null));
    dataset.quotes.set(quoteKey("b", 2), quote("b", 2, null));
    const { lines } = cheapestPerLine(dataset);
    expect(lines[1].winnerVendorId).toBeNull();
    expect(lines[1].note).toContain("No eligible vendor");
  });
});

describe("splitAward", () => {
  it("allocates each line to its cheapest eligible vendor", () => {
    const result = splitAward(makeDataset(), { requireQualityPass: true });
    const byName = Object.fromEntries(result.allocations.map((a) => [a.vendorName, a.itemCount]));
    expect(byName).toEqual({ "Vendor A": 1, "Vendor B": 1 });
    expect(result.splitTotal).toBe(10 * 100 + 15 * 200); // 4000
  });

  it("computes savings against a like-for-like single-vendor baseline", () => {
    const result = splitAward(makeDataset(), { requireQualityPass: true });
    // Best single vendor over the same two items is B at 4200; split is 4000.
    expect(result.bestSingleVendorName).toBe("Vendor B");
    expect(result.savingsVsBestSingleVendor).toBe(200);
  });

  it("excludes unawardable items from the total and says so", () => {
    const dataset = makeDataset();
    dataset.quotes.set(quoteKey("a", 2), quote("a", 2, null));
    dataset.quotes.set(quoteKey("b", 2), quote("b", 2, null));
    const result = splitAward(dataset, { requireQualityPass: true });
    expect(result.awardedItemCount).toBe(1);
    expect(result.unawardedItems).toHaveLength(1);
    expect(result.caveats.join(" ")).toContain("excluded from the total");
  });
});

describe("scenarioAdditionalDiscount", () => {
  it("flips the ranking when the discount is large enough", () => {
    // A is 5000, B is 4200 over the shared basket. A needs >16% to win.
    const result = scenarioAdditionalDiscount(makeDataset(), { vendorId: "a", discountPercent: 20 }, { requireQualityPass: true });
    expect(result?.previousWinnerName).toBe("Vendor B");
    expect(result?.becomesCheapest).toBe(true);
    expect(result?.newWinnerName).toBe("Vendor A");
  });

  it("leaves the ranking alone when the discount is too small", () => {
    const result = scenarioAdditionalDiscount(makeDataset(), { vendorId: "a", discountPercent: 5 }, { requireQualityPass: true });
    expect(result?.becomesCheapest).toBe(false);
    expect(result?.newWinnerName).toBe("Vendor B");
  });

  it("does not mutate the stored dataset", () => {
    const dataset = makeDataset();
    scenarioAdditionalDiscount(dataset, { vendorId: "a", discountPercent: 50 }, {});
    expect(dataset.quotes.get(quoteKey("a", 1))!.evaluatedValue).toBe(10);
  });

  it("states the assumption it made about how the discount applies", () => {
    const result = scenarioAdditionalDiscount(makeDataset(), { vendorId: "a", discountPercent: 10 }, {});
    expect(result?.caveats.join(" ")).toContain("applied uniformly");
  });
});

describe("buildAwardRecommendation", () => {
  it("recommends a split when it materially beats the best single vendor", () => {
    const recommendation = buildAwardRecommendation(makeDataset());
    expect(recommendation.strategy).toBe("split_award");
    expect(recommendation.qualityQualifiedVendorCount).toBe(2);
    expect(recommendation.evidence.join(" ")).toContain("Vendor C was excluded");
  });

  it("falls back to a single vendor when the split saving is immaterial", () => {
    const dataset = makeDataset();
    // Make B cheapest on both lines by a hair, so splitting buys almost nothing.
    dataset.quotes.set(quoteKey("b", 1), quote("b", 1, 9.99));
    const recommendation = buildAwardRecommendation(dataset);
    expect(recommendation.strategy).toBe("single_vendor");
  });

  it("surfaces unresolved quality answers instead of silently excluding the vendor", () => {
    const dataset = makeDataset();
    const b = dataset.vendors.find((v) => v.id === "b")!;
    b.quality = { status: "unresolved", hardFailures: [], unresolved: ["Can the vendor provide samples before production?"] };
    const recommendation = buildAwardRecommendation(dataset);
    expect(recommendation.vendorsWithUnresolvedQuality.map((v) => v.vendorName)).toContain("Vendor B");
    expect(recommendation.reviewBeforeAward.join(" ")).toContain("did not decide this for you");
  });

  it("always tells the buyer what to verify before awarding", () => {
    const recommendation = buildAwardRecommendation(makeDataset());
    expect(recommendation.confidenceNote).toContain("calculation engine");
  });
});
