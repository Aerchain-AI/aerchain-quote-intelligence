import type {
  ConfidenceLevel,
  ExceptionType,
  FxRateInfo,
  LineItem,
  QuestionnaireQuestion,
} from "./types.js";

// PRD §8/§9 — Corrugated Packaging FY27 Sourcing Event, 30 line items.
export const RFX_NAME = "Corrugated Packaging — FY27 Sourcing Event";
export const RFX_CATEGORY = "Corrugated Packaging";
export const RFX_BASE_CURRENCY = "INR" as const;

export const RFX_LINE_ITEMS: LineItem[] = [
  { id: 1, name: "5-Ply Corrugated Box – Small", specification: "300×200×150 mm", quantity: 10000, unit: "pcs" },
  { id: 2, name: "5-Ply Corrugated Box – Medium", specification: "400×300×250 mm", quantity: 8000, unit: "pcs" },
  { id: 3, name: "5-Ply Corrugated Box – Large", specification: "600×400×400 mm", quantity: 5000, unit: "pcs" },
  { id: 4, name: "3-Ply Corrugated Box – Small", specification: "250×180×120 mm", quantity: 12000, unit: "pcs" },
  { id: 5, name: "3-Ply Corrugated Box – Medium", specification: "350×250×200 mm", quantity: 10000, unit: "pcs" },
  { id: 6, name: "3-Ply Corrugated Box – Large", specification: "500×350×300 mm", quantity: 6000, unit: "pcs" },
  { id: 7, name: "Die-Cut Box – Type A", specification: "Custom die-cut", quantity: 4000, unit: "pcs" },
  { id: 8, name: "Die-Cut Box – Type B", specification: "Custom die-cut", quantity: 3500, unit: "pcs" },
  { id: 9, name: "Corrugated Sheet – Small", specification: "500×400 mm", quantity: 5000, unit: "sheets" },
  { id: 10, name: "Corrugated Sheet – Large", specification: "1000×800 mm", quantity: 3000, unit: "sheets" },
  { id: 11, name: "5-Ply Corrugated Roll", specification: "1200 mm width", quantity: 1500, unit: "kg" },
  { id: 12, name: "3-Ply Corrugated Roll", specification: "1000 mm width", quantity: 1000, unit: "kg" },
  { id: 13, name: "Kraft Paper Tape", specification: "48 mm", quantity: 5000, unit: "rolls" },
  { id: 14, name: "BOPP Packaging Tape", specification: "48 mm", quantity: 10000, unit: "rolls" },
  { id: 15, name: "Printed Packaging Tape", specification: "Custom print", quantity: 3000, unit: "rolls" },
  { id: 16, name: "Paper Labels", specification: "100×50 mm", quantity: 50000, unit: "pcs" },
  { id: 17, name: "Fragile Labels", specification: "Standard", quantity: 25000, unit: "pcs" },
  { id: 18, name: "Barcode Labels", specification: "Custom barcode", quantity: 30000, unit: "pcs" },
  { id: 19, name: "Edge Protectors – Small", specification: "Standard", quantity: 10000, unit: "pcs" },
  { id: 20, name: "Edge Protectors – Large", specification: "Standard", quantity: 8000, unit: "pcs" },
  { id: 21, name: "Corrugated Partition – 6 Cell", specification: "Custom", quantity: 5000, unit: "pcs" },
  { id: 22, name: "Corrugated Partition – 12 Cell", specification: "Custom", quantity: 4000, unit: "pcs" },
  { id: 23, name: "Paper Void Fill", specification: "Recyclable", quantity: 2000, unit: "kg" },
  { id: 24, name: "Kraft Paper Sheets", specification: "500×500 mm", quantity: 5000, unit: "sheets" },
  { id: 25, name: "Stretch Film", specification: "500 mm", quantity: 2000, unit: "rolls" },
  { id: 26, name: "Bubble Wrap", specification: "1 m width", quantity: 1500, unit: "rolls" },
  { id: 27, name: "PP Strapping", specification: "12 mm", quantity: 3000, unit: "rolls" },
  { id: 28, name: "PET Strapping", specification: "16 mm", quantity: 2000, unit: "rolls" },
  { id: 29, name: "Wooden Pallet", specification: "1200×1000 mm", quantity: 1000, unit: "pcs" },
  { id: 30, name: "Corrugated Pallet", specification: "1200×1000 mm", quantity: 1500, unit: "pcs" },
];

// PRD §11 — the 10 fixed questionnaire questions, usable as AI-copilot constraints.
export const QUESTIONNAIRE_QUESTIONS: QuestionnaireQuestion[] = [
  { id: 1, text: "Is the vendor ISO 9001 certified?" },
  { id: 2, text: "Does the vendor have at least 3 years of packaging experience?" },
  { id: 3, text: "Can the vendor provide samples before production?" },
  { id: 4, text: "What is the maximum standard lead time?" },
  { id: 5, text: "Can the vendor support the required monthly volume?" },
  { id: 6, text: "Does the supplied material meet the required GSM/specification?" },
  { id: 7, text: "Can the vendor provide batch-level quality documentation?" },
  { id: 8, text: "Can the vendor support emergency orders?" },
  { id: 9, text: "What payment terms does the vendor require?" },
  { id: 10, text: "Has the vendor supplied similar enterprise customers?" },
];

// Questions with an objective pass/fail bearing on the copilot's quality-constraint
// filter (PRD §21: "Vendor B — failed quality criterion"). Questions 4, 9, 10 are
// informational (lead time / payment terms / references) and don't gate pass/fail.
export const QUALITY_GATING_QUESTION_IDS = [1, 2, 3, 5, 6, 7, 8];

// PRD §28 — fixed reference FX rate for this prototype. Real deployments would
// call a live FX source; here the rate, its date, and its method are always
// shown alongside any converted value so the assumption is never hidden.
export const USD_TO_INR_RATE: FxRateInfo = {
  from: "USD",
  to: "INR",
  rate: 83.5,
  asOf: "2026-09-01",
  source: "Fixed reference rate used for this prototype (not a live FX feed)",
};

// PRD §26 — confidence bucketing. Deterministic, not left to the LLM.
export function confidenceLevel(confidence: number): ConfidenceLevel {
  if (confidence >= 0.9) return "high";
  if (confidence >= 0.7) return "medium";
  return "low";
}

export const EXCEPTION_LABELS: Record<ExceptionType, string> = {
  missing_item: "Item not quoted",
  different_unit: "Vendor quoted a different unit",
  different_currency: "Vendor quoted a different currency",
  low_confidence: "Low-confidence extraction",
  missing_freight: "Freight not specified",
  missing_tax: "Tax not specified",
  discount: "Discount applies",
  moq: "Minimum order quantity concern",
  lead_time_concern: "Lead-time concern",
  quality_failure: "Answered no to a quality questionnaire criterion",
  quality_unresolved: "Quality questionnaire left unanswered — unknown, not failed",
  ambiguous_value: "Ambiguous or illegible value",
};
