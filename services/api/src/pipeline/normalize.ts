import type { Currency, FxRateInfo, LineItem, MoneyAdjustment } from "@aerchain/shared";
import { USD_TO_INR_RATE } from "@aerchain/shared";
import type { ExtractedLineItem } from "../extraction/tool.js";

const UNIT_WORDS: Record<string, string[]> = {
  pcs: ["piece", "pieces", "pc", "pcs", "unit", "units"],
  sheets: ["sheet", "sheets"],
  rolls: ["roll", "rolls"],
  kg: ["kg", "kgs", "kilogram", "kilograms"],
};

/** Phrases that name no unit of their own and so inherit the RFx's. */
const GENERIC_UNIT = /^\s*(?:per\s+)?(?:unit|units|each|ea|no\.?|nos\.?|item)\s*$|^\s*\/\s*(?:unit|each)\s*$/;

export interface UnitParseResult {
  /** number of source-units per 1 RFx-unit price, e.g. 100 for "per 100 pieces" */
  factor: number;
  /** false when the source unit text couldn't be confidently matched to the RFx unit family */
  recognized: boolean;
  /** true when no unit was stated and the RFx's own unit was taken as the basis */
  assumed?: boolean;
}

/** Deterministic unit-quantity parsing — PRD §29: normalize automatically when the
 * conversion is clear ("per 100 pieces" -> divide by 100); never invent a factor. */
export function parseSourceUnit(sourceUnit: string | null, rfxUnit: string): UnitParseResult {
  // No unit stated at all. That is not the same as a unit we cannot reconcile:
  // the rate sits against an RFx line whose quantity the vendor copied, so the
  // only available reading is "per one of what was asked for". Discarding it
  // instead threw away every price on a rate card that omits the word "each" —
  // a complete, usable response reduced to nothing.
  //
  // So the price is used and the assumption is disclosed, rather than the price
  // being dropped or the assumption being made silently. A vendor who states a
  // unit we genuinely cannot convert is still flagged and excluded below.
  if (!sourceUnit || !sourceUnit.trim()) return { factor: 1, recognized: true, assumed: true };
  const normalized = sourceUnit.toLowerCase();

  const perNMatch = normalized.match(/per\s+(\d+)/);
  if (perNMatch) return { factor: Number(perNMatch[1]), recognized: true };

  const words = UNIT_WORDS[rfxUnit] ?? [];
  if (words.some((w) => normalized.includes(w))) return { factor: 1, recognized: true };

  // Unit-agnostic phrasing: "per unit", "each", "per no." all mean one of
  // whatever the RFx asked for, whichever unit that is. The factor of 1 is the
  // literal meaning of the words, not a factor invented to make the row
  // comparable — which is the thing this function refuses to do. Flagging these
  // buried the genuinely ambiguous cases, like a basis mismatch on "per 100
  // pieces", under dozens of warnings about a phrase that is not ambiguous.
  if (GENERIC_UNIT.test(normalized)) return { factor: 1, recognized: true };

  return { factor: 1, recognized: false };
}

export interface CurrencyConversionResult {
  value: number;
  fxRateUsed: FxRateInfo | null;
}

/** Deterministic currency conversion using a fixed, disclosed reference rate
 * (PRD §28) — never a silent/hidden conversion. */
export function convertToBaseCurrency(value: number, from: Currency, to: Currency): CurrencyConversionResult {
  if (from === to) return { value, fxRateUsed: null };
  if (from === "USD" && to === "INR") {
    return { value: value * USD_TO_INR_RATE.rate, fxRateUsed: USD_TO_INR_RATE };
  }
  throw new Error(`Unsupported currency conversion: ${from} -> ${to}`);
}

/** Parses a freight/discount/tax phrase into a numeric adjustment only when it is
 * unambiguous ("₹1.20 per kg", "5%"). Anything else is left null — the caller
 * surfaces the raw text as an exception instead of guessing a number (PRD §29). */
export function parseMoneyAdjustmentText(text: string | null): MoneyAdjustment | null {
  if (!text || !text.trim()) return null;

  const pctMatch = text.match(/([\d.]+)\s*%/);
  if (pctMatch) {
    return { amount: Number(pctMatch[1]), unit: "% of value", basis: "document text", notes: text };
  }

  const perMatch = text.match(/(?:rs\.?|₹|\$|usd)?\s*([\d,]+(?:\.\d+)?)\s*(?:per|\/)\s*([a-zA-Z]+)/i);
  if (perMatch) {
    return {
      amount: Number(perMatch[1].replace(/,/g, "")),
      unit: `per ${perMatch[2].toLowerCase()}`,
      basis: "document text",
      notes: text,
    };
  }

  return null;
}

function isPercent(adj: MoneyAdjustment): boolean {
  return adj.unit.includes("%");
}

function matchesRfxUnit(adj: MoneyAdjustment, rfxUnit: string): boolean {
  const words = UNIT_WORDS[rfxUnit] ?? [];
  return words.some((w) => adj.unit.toLowerCase().includes(w));
}

export interface NormalizedQuote {
  normalizedValue: number | null;
  normalizedCurrency: Currency;
  normalizedUnit: string;
  evaluatedValue: number | null;
  fxRateUsed: FxRateInfo | null;
  discount: MoneyAdjustment | null;
  freight: MoneyAdjustment | null;
  tax: MoneyAdjustment | null;
  unitRecognized: boolean;
  /** True when no unit was stated and the RFx unit was taken as the basis. */
  unitAssumed: boolean;
}

const BASE_CURRENCY: Currency = "INR";

/** Turns one extracted line-item candidate into a normalized, evaluated quote.
 * All math here is plain arithmetic — nothing is delegated to the LLM. */
export function normalizeQuote(extracted: ExtractedLineItem, rfxLineItem: LineItem): NormalizedQuote {
  const discount = parseMoneyAdjustmentText(extracted.discountText);
  const freight = parseMoneyAdjustmentText(extracted.freightText);
  const tax = parseMoneyAdjustmentText(extracted.taxText);

  if (!extracted.quoted || extracted.sourceValue == null || !extracted.sourceCurrency) {
    return {
      normalizedValue: null,
      normalizedCurrency: BASE_CURRENCY,
      normalizedUnit: rfxLineItem.unit,
      evaluatedValue: null,
      fxRateUsed: null,
      discount,
      freight,
      tax,
      unitRecognized: false,
      unitAssumed: false,
    };
  }

  const { factor, recognized, assumed } = parseSourceUnit(extracted.sourceUnit, rfxLineItem.unit);
  const { value: inBaseCurrency, fxRateUsed } = convertToBaseCurrency(
    extracted.sourceValue,
    extracted.sourceCurrency,
    BASE_CURRENCY,
  );

  if (!recognized) {
    // A unit we can't confidently reconcile with the RFx unit — flag, don't guess.
    return {
      normalizedValue: null,
      normalizedCurrency: BASE_CURRENCY,
      normalizedUnit: rfxLineItem.unit,
      evaluatedValue: null,
      fxRateUsed,
      discount,
      freight,
      tax,
      unitRecognized: false,
      unitAssumed: false,
    };
  }

  const normalizedValue = Math.round((inBaseCurrency / factor) * 100) / 100;

  let evaluated = normalizedValue;
  if (freight && !isPercent(freight) && matchesRfxUnit(freight, rfxLineItem.unit)) {
    evaluated += freight.amount;
  }
  if (tax) {
    evaluated += isPercent(tax) ? evaluated * (tax.amount / 100) : matchesRfxUnit(tax, rfxLineItem.unit) ? tax.amount : 0;
  }
  if (discount) {
    evaluated -= isPercent(discount)
      ? evaluated * (discount.amount / 100)
      : matchesRfxUnit(discount, rfxLineItem.unit)
        ? discount.amount
        : 0;
  }

  return {
    normalizedValue,
    normalizedCurrency: BASE_CURRENCY,
    normalizedUnit: rfxLineItem.unit,
    evaluatedValue: Math.round(evaluated * 100) / 100,
    fxRateUsed,
    discount,
    freight,
    tax,
    unitRecognized: true,
    unitAssumed: assumed === true,
  };
}
