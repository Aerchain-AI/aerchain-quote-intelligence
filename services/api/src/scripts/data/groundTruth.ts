// Internal ground truth used ONLY to author the 5 mock vendor documents.
// The extraction pipeline never reads this file at runtime — it must parse the
// generated .xlsx/.pdf/.docx/.jpg/.txt files for real. This module exists so the
// generated documents are internally consistent and so dev/demo output can be
// sanity-checked against a known-correct answer.

import { RFX_LINE_ITEMS } from "@aerchain/shared";

export type VendorKey = "A" | "B" | "C" | "D" | "E";

// Vendor A's baseline unit price in INR, per RFx unit, for all 30 line items.
// This is the single ground-truth anchor every vendor's price is derived from.
export const BASE_PRICE_INR: Record<number, number> = {
  1: 38, 2: 52, 3: 78, 4: 19, 5: 29, 6: 46, 7: 58, 8: 68, 9: 13, 10: 29,
  11: 59, 12: 49, 13: 34, 14: 27, 15: 43, 16: 0.85, 17: 0.34, 18: 0.52,
  19: 8.5, 20: 14.5, 21: 23, 22: 33, 23: 64, 24: 9.2, 25: 215, 26: 345,
  27: 182, 28: 262, 29: 650, 30: 185,
};

export interface GroundTruthLine {
  lineItemId: number;
  quoted: boolean;
  /** Label as printed by this vendor — may differ from the RFx wording. */
  labelAsQuoted: string;
  price: number | null; // in the vendor's own currency/unit basis below
  currency: "INR" | "USD";
  /** How the vendor expresses the unit, e.g. "per piece", "per 100 pieces", "per kg" */
  unitBasis: string;
  /** Multiply price by this many source-units to get one RFx-unit price
   * (e.g. "per 100 pieces" => 100). 1 for a direct per-RFx-unit price. */
  perQuantity: number;
  lowContrast?: boolean; // Vendor D only — render faint/hard to read
  handwrittenOverride?: { printedPrice: number; handwrittenPrice: number }; // Vendor D only
  lastYearReference?: boolean; // Vendor E only — "same as last year", not resolvable
  notes?: string;
}

// Deterministic per-item variance so each vendor's pricing looks organic
// without hand-typing 30 numbers per vendor.
function variance(id: number, salt: number): number {
  return 1 + 0.06 * Math.sin(id * salt);
}

const NAME_BY_ID = new Map(RFX_LINE_ITEMS.map((li) => [li.id, li.name]));

// ---------- Vendor A — clean baseline, 30/30, INR ----------
export const VENDOR_A_LINES: GroundTruthLine[] = RFX_LINE_ITEMS.map((li) => ({
  lineItemId: li.id,
  quoted: true,
  labelAsQuoted: li.name,
  price: Math.round(BASE_PRICE_INR[li.id] * 100) / 100,
  currency: "INR",
  unitBasis: `per ${li.unit === "pcs" ? "piece" : li.unit.replace(/s$/, "")}`,
  perQuantity: 1,
}));

// ---------- Vendor B — PDF, 30/30, INR, unit + terminology quirks,
// footnote discount, freight quoted separately (per kg) ----------
const VENDOR_B_RENAMES: Record<number, string> = {
  2: "Medium Box (5 Ply)",
  16: "Adhesive Paper Label",
  25: "LLDPE Stretch Wrap Film",
};
const VENDOR_B_PER_100: number[] = [16, 17, 18]; // labels — priced per 100 pcs

export const VENDOR_B_LINES: GroundTruthLine[] = RFX_LINE_ITEMS.map((li) => {
  const mult = variance(li.id, 1.7);
  const per100 = VENDOR_B_PER_100.includes(li.id);
  const unitPrice = Math.round(BASE_PRICE_INR[li.id] * mult * 100) / 100;
  return {
    lineItemId: li.id,
    quoted: true,
    labelAsQuoted: VENDOR_B_RENAMES[li.id] ?? li.name,
    price: per100 ? Math.round(unitPrice * 100 * 100) / 100 : unitPrice,
    currency: "INR",
    unitBasis: per100 ? "per 100 pieces" : `per ${li.unit === "pcs" ? "piece" : li.unit.replace(/s$/, "")}`,
    perQuantity: per100 ? 100 : 1,
  };
});
export const VENDOR_B_FOOTNOTE_DISCOUNT =
  "* 5% discount applies to total order value above ₹10,00,000. Not itemized per line.";
export const VENDOR_B_FREIGHT_NOTE =
  "Freight: ₹1.20 per kg, billed separately based on actual shipment weight. Not applicable to per-piece/per-roll/per-sheet items.";
export const VENDOR_B_FREIGHT_PER_KG = 1.2;

// ---------- Vendor C — DOCX, 30/30, USD, some per-100, freight excluded ----------
const VENDOR_C_PER_100: number[] = [16, 17, 18, 24];
const USD_RATE_FOR_AUTHORING = 83.5; // matches USD_TO_INR_RATE in @aerchain/shared

export const VENDOR_C_LINES: GroundTruthLine[] = RFX_LINE_ITEMS.map((li) => {
  const mult = variance(li.id, 2.3);
  const per100 = VENDOR_C_PER_100.includes(li.id);
  const inrPrice = BASE_PRICE_INR[li.id] * mult;
  const usdUnitPrice = Math.round((inrPrice / USD_RATE_FOR_AUTHORING) * 1000) / 1000;
  return {
    lineItemId: li.id,
    quoted: true,
    labelAsQuoted: li.name,
    price: per100 ? Math.round(usdUnitPrice * 100 * 1000) / 1000 : usdUnitPrice,
    currency: "USD",
    unitBasis: per100 ? "per 100 units" : `per ${li.unit === "pcs" ? "unit" : li.unit.replace(/s$/, "")}`,
    perQuantity: per100 ? 100 : 1,
  };
});
export const VENDOR_C_FREIGHT_NOTE = null; // deliberately absent from the document

// ---------- Vendor D — photographed quotation, 27/30, INR, OCR + handwriting ----------
const VENDOR_D_OMITTED = [8, 19, 27]; // Die-Cut Type B, Edge Protectors – Small, PP Strapping
const VENDOR_D_LOW_CONTRAST = [5, 22]; // rendered faint in the image
const VENDOR_D_HANDWRITTEN: Record<number, number> = { 13: 0.9 }; // id -> multiplier for the handwritten override

export const VENDOR_D_LINES: GroundTruthLine[] = RFX_LINE_ITEMS.filter(
  (li) => !VENDOR_D_OMITTED.includes(li.id),
).map((li) => {
  const mult = variance(li.id, 0.9);
  const printedPrice = Math.round(BASE_PRICE_INR[li.id] * mult * 100) / 100;
  const line: GroundTruthLine = {
    lineItemId: li.id,
    quoted: true,
    labelAsQuoted: li.name,
    price: printedPrice,
    currency: "INR",
    unitBasis: `per ${li.unit === "pcs" ? "piece" : li.unit.replace(/s$/, "")}`,
    perQuantity: 1,
    lowContrast: VENDOR_D_LOW_CONTRAST.includes(li.id),
  };
  if (VENDOR_D_HANDWRITTEN[li.id]) {
    line.handwrittenOverride = {
      printedPrice,
      handwrittenPrice: Math.round(printedPrice * VENDOR_D_HANDWRITTEN[li.id] * 100) / 100,
    };
  }
  return line;
});
export const VENDOR_D_OMITTED_IDS = VENDOR_D_OMITTED;

// ---------- Vendor E — email/text, 27/30 clearly quoted, 3 "same as last year" ----------
const VENDOR_E_LAST_YEAR = [23, 29, 30]; // Paper Void Fill, Wooden Pallet, Corrugated Pallet

export const VENDOR_E_LINES: GroundTruthLine[] = RFX_LINE_ITEMS.map((li) => {
  if (VENDOR_E_LAST_YEAR.includes(li.id)) {
    return {
      lineItemId: li.id,
      quoted: false,
      labelAsQuoted: li.name,
      price: null,
      currency: "INR",
      unitBasis: "",
      perQuantity: 1,
      lastYearReference: true,
      notes: "Vendor referenced last year's pricing; no prior-year record exists in this system.",
    };
  }
  const mult = variance(li.id, 3.1);
  return {
    lineItemId: li.id,
    quoted: true,
    labelAsQuoted: li.name,
    price: Math.round(BASE_PRICE_INR[li.id] * mult * 100) / 100,
    currency: "INR",
    unitBasis: `per ${li.unit === "pcs" ? "pc" : li.unit.replace(/s$/, "")}`,
    perQuantity: 1,
  };
});
export const VENDOR_E_OMITTED_IDS = VENDOR_E_LAST_YEAR;

export function labelFor(id: number): string {
  return NAME_BY_ID.get(id) ?? `Item ${id}`;
}

// ---------- Questionnaire answers ----------
export interface GroundTruthAnswer {
  questionId: number;
  answerText: string;
  passFail: boolean | null;
}

export const VENDOR_A_QUESTIONNAIRE: GroundTruthAnswer[] = [
  { questionId: 1, answerText: "Yes, ISO 9001:2015 certified (certificate available on request).", passFail: true },
  { questionId: 2, answerText: "Yes, 12 years in packaging manufacturing.", passFail: true },
  { questionId: 3, answerText: "Yes, samples provided within 5 business days of order confirmation.", passFail: true },
  { questionId: 4, answerText: "3 weeks standard lead time.", passFail: null },
  { questionId: 5, answerText: "Yes, current capacity comfortably covers the required monthly volume.", passFail: true },
  { questionId: 6, answerText: "Yes, all material meets or exceeds the specified GSM.", passFail: true },
  { questionId: 7, answerText: "Yes, batch-level quality certificates issued with every shipment.", passFail: true },
  { questionId: 8, answerText: "Yes, emergency orders supported with a 20% expedite surcharge.", passFail: true },
  { questionId: 9, answerText: "50% advance, 50% on delivery.", passFail: null },
  { questionId: 10, answerText: "Yes, supplies three other enterprise FMCG accounts of similar scale.", passFail: true },
];

export const VENDOR_B_QUESTIONNAIRE: GroundTruthAnswer[] = [
  { questionId: 1, answerText: "No — currently mid-way through ISO 9001 certification, expected in 6 months.", passFail: false },
  { questionId: 2, answerText: "Yes, 5 years in the packaging business.", passFail: true },
  { questionId: 3, answerText: "Yes, on request.", passFail: true },
  { questionId: 4, answerText: "4 weeks standard.", passFail: null },
  { questionId: 5, answerText: "Yes, can support the required volume.", passFail: true },
  { questionId: 6, answerText: "Yes, meets specification.", passFail: true },
  { questionId: 7, answerText: "Only for orders above 5,000 units.", passFail: true },
  { questionId: 8, answerText: "Limited support, subject to current load.", passFail: true },
  { questionId: 9, answerText: "30% advance, balance against delivery challan.", passFail: null },
  { questionId: 10, answerText: "Yes, two enterprise logistics customers.", passFail: true },
];

export const VENDOR_C_QUESTIONNAIRE: GroundTruthAnswer[] = [
  { questionId: 1, answerText: "Yes, ISO 9001 certified since 2019.", passFail: true },
  { questionId: 2, answerText: "Yes, 8 years of packaging experience.", passFail: true },
  { questionId: 3, answerText: "Yes, samples available before production.", passFail: true },
  { questionId: 4, answerText: "5-6 weeks standard (import lead time factored in).", passFail: null },
  { questionId: 5, answerText: "Yes, subject to 30 days advance notice.", passFail: true },
  { questionId: 6, answerText: "Yes, GSM specification met per submitted spec sheet.", passFail: true },
  { questionId: 7, answerText: "Yes, provided per batch.", passFail: true },
  { questionId: 8, answerText: "Yes, at an additional air-freight cost.", passFail: true },
  { questionId: 9, answerText: "100% advance via wire transfer.", passFail: null },
  { questionId: 10, answerText: "Yes, exports to two enterprise customers in the region.", passFail: true },
];

// Vendor D: partially filled — several fields left blank, matching a
// deliberately incomplete response (PRD §33 edge case #7).
export const VENDOR_D_QUESTIONNAIRE: GroundTruthAnswer[] = [
  { questionId: 1, answerText: "Yes.", passFail: true },
  { questionId: 2, answerText: "Yes, since 2015.", passFail: true },
  { questionId: 3, answerText: "", passFail: null },
  { questionId: 4, answerText: "", passFail: null },
  { questionId: 5, answerText: "Yes.", passFail: true },
  { questionId: 6, answerText: "Believe so, not confirmed in writing.", passFail: null },
  { questionId: 7, answerText: "", passFail: null },
  { questionId: 8, answerText: "Sometimes, case by case.", passFail: null },
  { questionId: 9, answerText: "Advance payment preferred.", passFail: null },
  { questionId: 10, answerText: "", passFail: null },
];

// Vendor E: informal, embedded in email prose.
export const VENDOR_E_QUESTIONNAIRE: GroundTruthAnswer[] = [
  { questionId: 1, answerText: "yep we're ISO 9001, cert attached last time", passFail: true },
  { questionId: 2, answerText: "been doing this 6+ yrs now", passFail: true },
  { questionId: 3, answerText: "sure, samples no problem", passFail: true },
  { questionId: 4, answerText: "lead times are tight rn, ~5 weeks", passFail: null },
  { questionId: 5, answerText: "should be fine for the volumes you mentioned", passFail: true },
  { questionId: 6, answerText: "spec can vary slightly batch to batch, can't guarantee exact GSM every time", passFail: false },
  { questionId: 7, answerText: "yes can send docs per batch", passFail: true },
  { questionId: 8, answerText: "honestly no, not right now with lead times where they are", passFail: false },
  { questionId: 9, answerText: "(not mentioned)", passFail: null },
  { questionId: 10, answerText: "yeah couple of similar clients", passFail: true },
];
