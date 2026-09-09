import type { LineItem } from "@aerchain/shared";
import { describe, expect, it } from "vitest";
import type { ExtractedLineItem, ExtractedQuestionnaireResponse } from "../src/extraction/tool.js";
import { normalizeQuote } from "../src/pipeline/normalize.js";
import {
  buildDocumentLevelExceptions,
  buildImplicitMissingTaxException,
  buildQualityException,
  summarizeVendor,
  validateLine,
} from "../src/pipeline/validate.js";

const pcsItem: LineItem = { id: 1, name: "Box", specification: "spec", quantity: 100, unit: "pcs" };

function extracted(overrides: Partial<ExtractedLineItem> = {}): ExtractedLineItem {
  return {
    rfxLineItemId: 1,
    quoted: true,
    vendorLabelAsWritten: "Box",
    sourceValue: 40,
    sourceCurrency: "INR",
    sourceUnit: "per piece",
    discountText: null,
    freightText: null,
    taxText: null,
    confidence: 0.95,
    sourceLocation: "Row 1",
    sourceExcerpt: "40",
    notes: null,
    ...overrides,
  };
}

describe("validateLine", () => {
  it("flags a missing item as critical and not_quoted", () => {
    const ex = extracted({ quoted: false, sourceValue: null, sourceCurrency: null, sourceUnit: null });
    const result = validateLine(ex, normalizeQuote(ex, pcsItem));
    expect(result.status).toBe("not_quoted");
    expect(result.exceptions).toContainEqual(
      expect.objectContaining({ type: "missing_item", severity: "critical" }),
    );
  });

  it("flags low confidence and marks the quote as flagged", () => {
    const ex = extracted({ confidence: 0.55 });
    const result = validateLine(ex, normalizeQuote(ex, pcsItem));
    expect(result.status).toBe("flagged");
    expect(result.exceptions.some((e) => e.type === "low_confidence")).toBe(true);
  });

  it("does not flag a high-confidence, recognized, same-currency quote", () => {
    const ex = extracted();
    const result = validateLine(ex, normalizeQuote(ex, pcsItem));
    expect(result.status).toBe("verified");
    expect(result.exceptions).toHaveLength(0);
  });

  it("flags different_unit when the unit can't be reconciled", () => {
    const ex = extracted({ sourceUnit: "per dozen" });
    const result = validateLine(ex, normalizeQuote(ex, pcsItem));
    expect(result.exceptions.some((e) => e.type === "different_unit")).toBe(true);
  });

  it("flags different_currency for a non-INR quote", () => {
    const ex = extracted({ sourceCurrency: "USD", sourceValue: 0.5 });
    const result = validateLine(ex, normalizeQuote(ex, pcsItem));
    expect(result.exceptions.some((e) => e.type === "different_currency")).toBe(true);
  });

  it("surfaces extraction notes as an ambiguous_value exception", () => {
    const ex = extracted({ notes: "Handwritten correction next to the printed price." });
    const result = validateLine(ex, normalizeQuote(ex, pcsItem));
    expect(result.exceptions.some((e) => e.type === "ambiguous_value")).toBe(true);
  });

  it("does not call a value verified when the model itself flagged it as ambiguous", () => {
    // High confidence in the digits read, but the model noted a handwritten override.
    const ex = extracted({ confidence: 0.98, notes: "Printed price struck through, handwritten value beside it." });
    const result = validateLine(ex, normalizeQuote(ex, pcsItem));
    expect(result.status).toBe("flagged");
  });
});

describe("buildDocumentLevelExceptions", () => {
  it("returns nothing for empty notes", () => {
    expect(buildDocumentLevelExceptions("")).toHaveLength(0);
  });

  it("detects a discount mention", () => {
    expect(buildDocumentLevelExceptions("5% discount above 10L").some((e) => e.type === "discount")).toBe(true);
  });

  it("detects a freight mention", () => {
    expect(buildDocumentLevelExceptions("Freight billed separately").some((e) => e.type === "missing_freight")).toBe(
      true,
    );
  });
});

describe("buildImplicitMissingTaxException", () => {
  it("flags when tax is never mentioned anywhere", () => {
    expect(buildImplicitMissingTaxException(false, "no relevant terms here")).not.toBeNull();
  });

  it("does not flag when a line item carried a tax adjustment", () => {
    expect(buildImplicitMissingTaxException(true, "")).toBeNull();
  });

  it("does not flag when the document notes mention tax", () => {
    expect(buildImplicitMissingTaxException(false, "GST included in price")).toBeNull();
  });
});

describe("buildQualityException", () => {
  const allPass: ExtractedQuestionnaireResponse[] = [1, 2, 3, 5, 6, 7, 8].map((id) => ({
    questionId: id,
    answerText: "Yes",
    passFail: true,
    confidence: 0.9,
  }));

  it("returns null when every gating question passes", () => {
    expect(buildQualityException(allPass)).toBeNull();
  });

  it("flags a vendor that failed a gating question", () => {
    const withFailure = allPass.map((r) => (r.questionId === 1 ? { ...r, passFail: false, answerText: "No" } : r));
    const result = buildQualityException(withFailure);
    expect(result).not.toBeNull();
    expect(result?.type).toBe("quality_failure");
  });

  it("treats an unanswered gating question as a failure", () => {
    const withBlank = allPass.filter((r) => r.questionId !== 7);
    const result = buildQualityException(withBlank);
    expect(result).not.toBeNull();
  });
});

describe("summarizeVendor", () => {
  it("marks a vendor with all items found and high confidence as processed", () => {
    const lineStatuses = Array.from({ length: 30 }, () => ({ status: "verified" as const, confidence: 0.95 }));
    const summary = summarizeVendor(lineStatuses, false);
    expect(summary.status).toBe("processed");
    expect(summary.itemsFoundCount).toBe(30);
    expect(summary.itemsMissingCount).toBe(0);
  });

  it("marks a vendor with missing items as review_required", () => {
    const lineStatuses = [
      ...Array.from({ length: 27 }, () => ({ status: "verified" as const, confidence: 0.9 })),
      ...Array.from({ length: 3 }, () => ({ status: "not_quoted" as const, confidence: null })),
    ];
    const summary = summarizeVendor(lineStatuses, false);
    expect(summary.status).toBe("review_required");
    expect(summary.itemsFoundCount).toBe(27);
    expect(summary.itemsMissingCount).toBe(3);
  });
});
