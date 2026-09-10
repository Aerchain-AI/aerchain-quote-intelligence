import type { AnalysisPlan, AnalysisType } from "./intent.js";

/**
 * What the copilot does when the language model is unreachable.
 *
 * The model has two jobs here and neither of them is arithmetic: it routes a
 * question to one of the fixed analyses, and it writes the answer up in
 * sentences. Every number comes from the engine either way. So an upstream
 * outage should cost the buyer the prose, not the answer — and the previous
 * behaviour, a red panel reading "all 3 API keys failed", threw away figures
 * that had already been computed and were sitting in memory.
 *
 * Both fallbacks below are deliberately plain. They are not an imitation of the
 * model's writing; they are what the system can say on its own, and they say so.
 */

const KEYWORD_ROUTES: Array<{ type: AnalysisType; patterns: RegExp[] }> = [
  {
    type: "award_recommendation",
    patterns: [/\baward\b/i, /\brecommend/i, /who should we (buy|pick|choose)/i, /\bdecision\b/i, /\bwrong\b/i],
  },
  {
    type: "comparability",
    patterns: [/\bcomparab/i, /like.for.like/i, /apples/i, /\bunit basis\b/i, /same basis/i, /directly compar/i],
  },
  {
    type: "quality_standing",
    patterns: [/\bquality\b/i, /\bcompliance\b/i, /\bcertif/i, /\bqualif/i, /\bISO\b/i],
  },
  {
    type: "vendor_history",
    patterns: [/\bbefore\b/i, /\bpast\b/i, /\bprevious/i, /\bhistory\b/i, /\btrack record\b/i, /worked with us/i, /\bverified\b/i],
  },
  {
    type: "incomplete_responses",
    patterns: [/\bincomplete\b/i, /\bmissing\b/i, /did not quote/i, /\bunpriced\b/i, /\bgaps?\b/i, /\bexceptions?\b/i],
  },
  {
    type: "commercial_terms",
    patterns: [/\bpayment\b/i, /\blead time\b/i, /\bterms\b/i, /\bfreight\b/i, /\btax\b/i, /\bvalidity\b/i],
  },
  {
    type: "split_award",
    patterns: [/\bsplit\b/i, /\ballocat/i, /across vendors/i],
  },
  {
    type: "cheapest_per_line",
    patterns: [/per line/i, /each item/i, /line by line/i, /best for each/i],
  },
  {
    type: "cheapest_overall",
    patterns: [/\bcheapest\b/i, /\blowest\b/i, /\brank/i, /\bcompare\b/i, /\btotal\b/i, /\bcost\b/i, /\bprice\b/i],
  },
];

/**
 * Route a question without the model.
 *
 * Crude on purpose: first match wins, ordered so that the more specific reading
 * of a word is tried first. It exists to keep a demo answerable during an
 * outage, not to replace the router.
 */
export function fallbackPlan(question: string, vendorNames: string[]): AnalysisPlan {
  const matched = KEYWORD_ROUTES.find((route) => route.patterns.some((p) => p.test(question)));
  const named = vendorNames.find((name) => {
    const first = name.split(/\s+/)[0].toLowerCase();
    return first.length > 3 && question.toLowerCase().includes(first);
  });

  // A question naming one vendor and nothing else is about that vendor.
  const type: AnalysisType = matched?.type ?? (named ? "vendor_risks" : "cheapest_overall");

  return {
    analysisType: type,
    requireQualityPass: false,
    requireCompleteResponse: false,
    vendorName: named ?? null,
    discountPercent: null,
    interpretation: `Routed without the language model, by keyword, to the ${type.replace(/_/g, " ")} analysis.`,
    unsupportedReason: null,
  };
}

/**
 * Describe a computed result in plain sentences, with no model involved.
 *
 * Each branch reads the same object the model would have been handed. Where a
 * shape is not recognised, the honest thing is to say the figures are present
 * and let the reader open them, rather than to guess at what they mean.
 */
export function describeCalculation(plan: AnalysisPlan, calculation: unknown): string {
  const c = (calculation ?? {}) as Record<string, unknown>;
  const money = (n: unknown) =>
    typeof n === "number" ? `₹${n.toLocaleString("en-IN", { maximumFractionDigits: 2 })}` : "—";

  switch (plan.analysisType) {
    case "cheapest_overall": {
      const ranking = (c.ranking as Array<Record<string, unknown>>) ?? [];
      const priced = ranking.filter((r) => r.comparableTotal != null);
      if (priced.length === 0) return "No vendor has a comparable total on the shared basket.";
      const lines = priced.map(
        (r, i) => `${i + 1}. ${r.vendorName} — ${money(r.comparableTotal)} on the shared basket`,
      );
      return [
        `${priced[0].vendorName} is cheapest on the ${c.basketSize} of ${c.totalLineItems} line items every compared vendor priced.`,
        "",
        ...lines,
      ].join("\n");
    }

    case "award_recommendation": {
      const allocations = (c.allocations as Array<Record<string, unknown>>) ?? [];
      const lines = allocations.map((a) => `- ${a.vendorName}: ${a.itemCount} item(s), ${money(a.total)}`);
      return [
        String(c.headline ?? "Award recommendation"),
        "",
        ...lines,
        "",
        `Total evaluated cost ${money(c.totalEvaluatedCost)}. Estimated saving ${money(c.savings)} ${c.savingsBaselineLabel ?? ""}.`,
        c.provisional ? "This recommendation is provisional: values require verification before award." : "",
      ]
        .filter(Boolean)
        .join("\n");
    }

    case "incomplete_responses": {
      const gaps = (c.vendorsWithIncompleteResponses as Array<Record<string, unknown>>) ?? [];
      if (gaps.length === 0) return "Every vendor priced every line item.";
      return gaps
        .map(
          (g) =>
            `- ${g.vendorName}: ${g.itemsNotQuoted} item(s) not quoted, ${g.itemsNotComparable} item(s) quoted on a basis that could not be converted.`,
        )
        .join("\n");
    }

    case "comparability": {
      const adjustments = (c.adjustments as Array<Record<string, unknown>>) ?? [];
      const header = c.directlyComparable
        ? "These prices are directly comparable; nothing had to be converted or assumed."
        : `Not directly comparable. ${c.comparableLineItems} of ${c.totalLineItems} line items are on a shared basis, and the following adjustments were made first:`;
      return [header, "", ...adjustments.map((a) => `- ${a.vendorName}: ${a.lineCount} line(s) — ${a.detail}`)].join("\n");
    }

    case "quality_standing": {
      const vendors = (c.vendors as Array<Record<string, unknown>>) ?? [];
      return vendors.map((v) => `- ${v.vendorName}: ${v.verdict}`).join("\n");
    }

    case "vendor_history": {
      const vendors = (c.vendors as Array<Record<string, unknown>>) ?? [];
      return vendors.map((v) => `- ${v.summary}`).join("\n");
    }

    default:
      return [
        `The ${plan.analysisType.replace(/_/g, " ")} analysis ran and its figures are below.`,
        "The written explanation is unavailable because the language model could not be reached; the numbers are unaffected, since none of them come from it.",
      ].join(" ");
  }
}
