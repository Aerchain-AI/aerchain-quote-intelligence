import type { LineItem } from "@aerchain/shared";
import { describe, expect, it } from "vitest";
import type { ExtractedLineItem } from "../src/extraction/tool.js";
import { convertToBaseCurrency, normalizeQuote, parseMoneyAdjustmentText, parseSourceUnit } from "../src/pipeline/normalize.js";

const pcsItem: LineItem = { id: 1, name: "Box", specification: "spec", quantity: 100, unit: "pcs" };
const kgItem: LineItem = { id: 11, name: "Roll", specification: "spec", quantity: 100, unit: "kg" };

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

describe("parseSourceUnit", () => {
  it("recognizes a direct per-unit match", () => {
    expect(parseSourceUnit("per piece", "pcs")).toEqual({ factor: 1, recognized: true });
  });

  it("extracts a per-N factor", () => {
    expect(parseSourceUnit("per 100 pieces", "pcs")).toEqual({ factor: 100, recognized: true });
  });

  it("flags an unrecognized unit rather than assuming 1:1", () => {
    expect(parseSourceUnit("per dozen", "pcs")).toEqual({ factor: 1, recognized: false });
  });

  it("treats a missing unit as unrecognized", () => {
    expect(parseSourceUnit(null, "pcs")).toEqual({ factor: 1, recognized: false });
  });
});

describe("convertToBaseCurrency", () => {
  it("passes INR through unchanged", () => {
    expect(convertToBaseCurrency(100, "INR", "INR")).toEqual({ value: 100, fxRateUsed: null });
  });

  it("converts USD to INR using the documented reference rate", () => {
    const result = convertToBaseCurrency(1, "USD", "INR");
    expect(result.value).toBeGreaterThan(1);
    expect(result.fxRateUsed).not.toBeNull();
    expect(result.fxRateUsed?.from).toBe("USD");
  });
});

describe("parseMoneyAdjustmentText", () => {
  it("returns null for empty/absent text", () => {
    expect(parseMoneyAdjustmentText(null)).toBeNull();
    expect(parseMoneyAdjustmentText("")).toBeNull();
  });

  it("parses a percentage discount", () => {
    expect(parseMoneyAdjustmentText("5% discount on orders above 10L")).toMatchObject({ amount: 5, unit: "% of value" });
  });

  it("parses a per-unit amount", () => {
    expect(parseMoneyAdjustmentText("Rs. 1.20 per kg")).toMatchObject({ amount: 1.2, unit: "per kg" });
  });

  it("returns null when nothing numeric/parseable is present", () => {
    expect(parseMoneyAdjustmentText("freight will be confirmed later")).toBeNull();
  });
});

describe("normalizeQuote", () => {
  it("passes through a clean direct match", () => {
    const result = normalizeQuote(extracted(), pcsItem);
    expect(result.normalizedValue).toBe(40);
    expect(result.evaluatedValue).toBe(40);
    expect(result.unitRecognized).toBe(true);
  });

  it("divides a per-100 price down to a per-unit price", () => {
    const result = normalizeQuote(extracted({ sourceValue: 4000, sourceUnit: "per 100 pieces" }), pcsItem);
    expect(result.normalizedValue).toBe(40);
  });

  it("returns nulls for an item that wasn't quoted", () => {
    const result = normalizeQuote(
      extracted({ quoted: false, sourceValue: null, sourceCurrency: null, sourceUnit: null }),
      pcsItem,
    );
    expect(result.normalizedValue).toBeNull();
    expect(result.evaluatedValue).toBeNull();
  });

  it("converts USD to INR", () => {
    const result = normalizeQuote(extracted({ sourceValue: 1, sourceCurrency: "USD" }), pcsItem);
    expect(result.normalizedValue).toBeGreaterThan(50); // 1 USD is well over 50 INR at any realistic rate
    expect(result.fxRateUsed).not.toBeNull();
  });

  it("never invents a conversion factor for an unrecognized unit", () => {
    const result = normalizeQuote(extracted({ sourceUnit: "per dozen" }), pcsItem);
    expect(result.normalizedValue).toBeNull();
    expect(result.unitRecognized).toBe(false);
  });

  it("applies a derivable per-kg freight onto a kg-unit line item", () => {
    const result = normalizeQuote(
      extracted({ rfxLineItemId: 11, sourceUnit: "per kg", freightText: "Rs. 1.20 per kg" }),
      kgItem,
    );
    expect(result.evaluatedValue).toBeCloseTo(41.2, 5);
  });

  it("does not apply a freight adjustment whose unit doesn't match the line item", () => {
    const result = normalizeQuote(extracted({ freightText: "Rs. 1.20 per kg" }), pcsItem);
    expect(result.evaluatedValue).toBe(result.normalizedValue);
  });
});
