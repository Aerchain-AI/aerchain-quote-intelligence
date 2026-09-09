// Structured data model shared across the API and (later) the web app.
// Mirrors PRD §25's concept: every extracted value keeps its original form,
// its normalized form, its confidence, and where it came from. Nothing here
// defaults an unknown value to zero — "not quoted" / null is a first-class state.

export type Currency = "INR" | "USD";

export interface LineItem {
  id: number; // 1-30, matches the RFx item number
  name: string;
  specification: string;
  quantity: number;
  unit: string; // pcs | sheets | kg | rolls
}

export interface Rfx {
  id: string;
  name: string;
  category: string;
  requiredByDate: string; // ISO date
  currency: Currency; // base comparison currency for the event (INR)
  description: string;
  createdAt: string;
}

export type VendorResponseFormat = "xlsx" | "pdf" | "docx" | "jpg" | "txt";

export type VendorStatus =
  | "pending"
  | "processing"
  | "processed"
  | "review_required"
  | "failed";

export interface Vendor {
  id: string;
  rfxId: string;
  name: string; // "Vendor A" .. "Vendor E"
  responseFormat: VendorResponseFormat;
  filePath: string;
  status: VendorStatus;
  itemsFoundCount: number | null;
  itemsMissingCount: number | null;
  overallConfidence: number | null; // 0-1, mean of line-level confidences
}

export type ConfidenceLevel = "high" | "medium" | "low";

export type QuoteStatus = "verified" | "flagged" | "not_quoted";

/** A discount, freight, or tax adjustment. Deliberately has no default of
 * zero — if a vendor didn't specify one, the field is `null`, not an amount. */
export interface MoneyAdjustment {
  amount: number;
  unit: string; // e.g. "per piece", "per kg", "% of line value"
  basis?: string; // e.g. "footnote", "separate line item", "email text"
  notes?: string;
}

export interface SourceReference {
  document: string; // filename the value came from
  location: string; // e.g. "Sheet1!B12", "Page 2", "Line 14"
  excerpt?: string; // raw source text/context, shown in the traceability drill-down
}

export interface FxRateInfo {
  from: Currency;
  to: Currency;
  rate: number;
  asOf: string; // ISO date the rate is quoted "as of"
  source: string; // e.g. "Fixed reference rate used for this prototype"
}

export interface VendorQuote {
  id: string;
  vendorId: string;
  lineItemId: number;

  sourceValue: number | null; // null when the item was not quoted at all
  sourceCurrency: Currency | null;
  sourceUnit: string | null;

  normalizedValue: number | null; // in the RFx's unit & base currency; null if not derivable
  normalizedCurrency: Currency;
  normalizedUnit: string;

  discount: MoneyAdjustment | null;
  freight: MoneyAdjustment | null;
  tax: MoneyAdjustment | null;

  /** normalizedValue plus whatever of freight/tax/discount can be confidently
   * applied. Null means "not enough information" — never assume zero. */
  evaluatedValue: number | null;

  confidence: number | null; // 0-1
  confidenceLevel: ConfidenceLevel | null;
  status: QuoteStatus;

  sourceReference: SourceReference | null;
  fxRateUsed: FxRateInfo | null;
  notes: string | null;
}

export type ExceptionType =
  | "missing_item"
  | "different_unit"
  | "different_currency"
  | "low_confidence"
  | "missing_freight"
  | "missing_tax"
  | "discount"
  | "moq"
  | "lead_time_concern"
  | "quality_failure"
  | "ambiguous_value";

export type ExceptionSeverity = "info" | "warning" | "critical";

export interface QuoteException {
  id: string;
  vendorId: string;
  lineItemId: number | null; // null for vendor-level exceptions (e.g. quality_failure)
  type: ExceptionType;
  message: string;
  severity: ExceptionSeverity;
}

export interface QuestionnaireQuestion {
  id: number; // 1-10
  text: string;
}

export interface QuestionnaireResponse {
  id: string;
  vendorId: string;
  questionId: number;
  questionText: string;
  answerText: string;
  passFail: boolean | null; // null when not determinable from the response
  confidence: number | null;
}
