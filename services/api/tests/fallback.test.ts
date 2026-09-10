import { describe, expect, it } from "vitest";
import { describeCalculation, fallbackPlan } from "../src/copilot/fallback.js";

const VENDORS = ["Deccan Packaging Solutions", "GreenWrap Packaging", "SouthBox Industries"];

describe("fallbackPlan", () => {
  it("routes a decision question to the award recommendation", () => {
    expect(fallbackPlan("Who should we award this RFX to and why?", VENDORS).analysisType).toBe(
      "award_recommendation",
    );
  });

  it("routes a comparability question ahead of the word 'compare'", () => {
    expect(fallbackPlan("Are all vendor prices directly comparable?", VENDORS).analysisType).toBe(
      "comparability",
    );
  });

  it("routes a coverage question to incomplete responses", () => {
    expect(fallbackPlan("Which vendors have incomplete quotations?", VENDORS).analysisType).toBe(
      "incomplete_responses",
    );
  });

  it("picks up a vendor named in the question", () => {
    const plan = fallbackPlan("What is SouthBox quoting in dollars?", VENDORS);
    expect(plan.vendorName).toBe("SouthBox Industries");
  });

  it("falls back to the ranking rather than refusing", () => {
    expect(fallbackPlan("give me something", VENDORS).analysisType).toBe("cheapest_overall");
  });

  it("says in its interpretation that no model was involved", () => {
    expect(fallbackPlan("who is cheapest", VENDORS).interpretation).toMatch(/without the language model/i);
  });
});

describe("describeCalculation", () => {
  const plan = fallbackPlan("who is cheapest overall", VENDORS);

  it("names the cheapest vendor and the basket it was ranked on", () => {
    const text = describeCalculation(plan, {
      basketSize: 23,
      totalLineItems: 30,
      ranking: [
        { vendorName: "Deccan Packaging Solutions", comparableTotal: 4317740 },
        { vendorName: "GreenWrap Packaging", comparableTotal: 4540155 },
      ],
    });
    expect(text).toContain("Deccan Packaging Solutions is cheapest");
    expect(text).toContain("23 of 30 line items");
    expect(text).toContain("₹43,17,740");
  });

  it("keeps not-quoted and not-comparable apart without the model", () => {
    const gaps = fallbackPlan("which vendors have incomplete quotations", VENDORS);
    const text = describeCalculation(gaps, {
      vendorsWithIncompleteResponses: [
        { vendorName: "Deccan Packaging Solutions", itemsNotQuoted: 3, itemsNotComparable: 0 },
        { vendorName: "SouthBox Industries", itemsNotQuoted: 0, itemsNotComparable: 2 },
      ],
    });
    expect(text).toContain("Deccan Packaging Solutions: 3 item(s) not quoted");
    expect(text).toContain("SouthBox Industries: 0 item(s) not quoted, 2 item(s) quoted on a basis");
  });

  it("carries the provisional warning into the plain award summary", () => {
    const award = fallbackPlan("who should we award to", VENDORS);
    const text = describeCalculation(award, {
      headline: "Split the award across 2 vendors.",
      allocations: [{ vendorName: "Deccan Packaging Solutions", itemCount: 27, total: 5544965 }],
      totalEvaluatedCost: 6276685,
      savings: 497335,
      savingsBaselineLabel: "vs. single-vendor award",
      provisional: true,
    });
    expect(text).toContain("₹62,76,685");
    expect(text).toMatch(/provisional/i);
  });

  it("never invents a number when it does not recognise the shape", () => {
    const scenario = { ...plan, analysisType: "scenario_discount" as const };
    const text = describeCalculation(scenario, { anything: 1 });
    expect(text).toMatch(/numbers are unaffected/i);
    expect(text).not.toMatch(/₹/);
  });
});
