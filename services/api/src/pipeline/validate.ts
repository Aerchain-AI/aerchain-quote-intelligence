import type { ConfidenceLevel, ExceptionSeverity, ExceptionType, QuoteStatus } from "@aerchain/shared";
import { confidenceLevel, QUALITY_GATING_QUESTION_IDS, QUESTIONNAIRE_QUESTIONS } from "@aerchain/shared";
import type { ExtractedLineItem, ExtractedQuestionnaireResponse } from "../extraction/tool.js";
import type { NormalizedQuote } from "./normalize.js";

export interface ExceptionDraft {
  lineItemId: number | null;
  type: ExceptionType;
  message: string;
  severity: ExceptionSeverity;
}

export interface LineValidationResult {
  status: QuoteStatus;
  confidenceLevel: ConfidenceLevel | null;
  exceptions: ExceptionDraft[];
}

/** Per-line validation — deterministic rules over the extraction + normalization
 * output. This is what turns an unverified LLM read into a trust-scored quote. */
export function validateLine(extracted: ExtractedLineItem, normalized: NormalizedQuote): LineValidationResult {
  const exceptions: ExceptionDraft[] = [];
  const lineItemId = extracted.rfxLineItemId;

  if (!extracted.quoted) {
    exceptions.push({
      lineItemId,
      type: "missing_item",
      message: extracted.notes?.trim() || "Item not quoted by this vendor.",
      severity: "critical",
    });
    return { status: "not_quoted", confidenceLevel: null, exceptions };
  }

  // The basis was assumed rather than read. The price is usable, but the buyer
  // is told on which footing, because an assumption nobody can see is the same
  // as a guess.
  if (normalized.unitAssumed) {
    exceptions.push({
      lineItemId,
      type: "different_unit",
      message: `No unit stated against this line. Read as a rate per ${normalized.normalizedUnit}, matching the RFx — confirm if the vendor priced on another basis.`,
      severity: "info",
    });
  }

  // A basis we did convert. The arithmetic is exact, but the buyer is comparing
  // a number that is not the one on the vendor's page, and a hundredfold change
  // reads as a hundredfold discount unless it is stated.
  if (normalized.unitRecognized && normalized.unitFactor !== 1) {
    exceptions.push({
      lineItemId,
      type: "different_unit",
      message:
        `Quoted per "${extracted.sourceUnit ?? "unspecified"}" and converted to a rate per ` +
        `${normalized.normalizedUnit} by dividing by ${normalized.unitFactor}. ` +
        `Confirm the basis before reading this line as cheaper than the others.`,
      severity: "warning",
    });
  }

  if (!normalized.unitRecognized) {
    // Quoted, but the unit couldn't be confidently reconciled with the RFx unit —
    // distinct from "not quoted at all": we know a price exists, just not how to
    // compare it, so this is flagged rather than treated as missing (PRD §29).
    exceptions.push({
      lineItemId,
      type: "different_unit",
      message: `Vendor's unit ("${extracted.sourceUnit ?? "unspecified"}") could not be confidently converted to the RFx unit — flagged instead of assuming a conversion factor.`,
      severity: "warning",
    });
    if (extracted.sourceCurrency && extracted.sourceCurrency !== "INR") {
      exceptions.push({
        lineItemId,
        type: "different_currency",
        message: `Quoted in ${extracted.sourceCurrency}; converted to INR using the prototype's fixed reference rate.`,
        severity: "info",
      });
    }
    if (extracted.notes?.trim()) {
      exceptions.push({ lineItemId, type: "ambiguous_value", message: extracted.notes.trim(), severity: "warning" });
    }
    return { status: "flagged", confidenceLevel: null, exceptions };
  }

  const level = confidenceLevel(extracted.confidence);
  if (level === "low") {
    exceptions.push({
      lineItemId,
      type: "low_confidence",
      message: `Extraction confidence is only ${Math.round(extracted.confidence * 100)}% for this value — verify against "${extracted.sourceExcerpt}".`,
      severity: "warning",
    });
  }

  if (extracted.sourceCurrency && extracted.sourceCurrency !== "INR") {
    exceptions.push({
      lineItemId,
      type: "different_currency",
      message: `Quoted in ${extracted.sourceCurrency}; converted to INR using the prototype's fixed reference rate.`,
      severity: "info",
    });
  }

  if (extracted.notes?.trim()) {
    exceptions.push({
      lineItemId,
      type: "ambiguous_value",
      message: extracted.notes.trim(),
      severity: "warning",
    });
  }

  // A value the model annotated with a caveat of its own ("handwritten correction",
  // "printed faintly") is not a verified value, however confident the model was
  // about the digits it read.
  const hasAmbiguityNote = exceptions.some((e) => e.type === "ambiguous_value");
  const status: QuoteStatus = level === "low" || hasAmbiguityNote ? "flagged" : "verified";
  return { status, confidenceLevel: level, exceptions };
}

const TAX_MENTION_PATTERN = /\btax\b|\bgst\b|\bvat\b/i;

/** Document-level commercial-term exceptions — a discount or freight statement
 * that applies broadly rather than to one line item still needs to be visible,
 * without repeating it 30 times. */
export function buildDocumentLevelExceptions(documentLevelNotes: string): ExceptionDraft[] {
  const exceptions: ExceptionDraft[] = [];
  const notes = documentLevelNotes?.trim();
  if (!notes) return exceptions;

  if (/discount/i.test(notes)) {
    exceptions.push({ lineItemId: null, type: "discount", message: notes, severity: "info" });
  }
  if (/freight|shipping/i.test(notes)) {
    exceptions.push({ lineItemId: null, type: "missing_freight", message: notes, severity: "info" });
  }
  if (TAX_MENTION_PATTERN.test(notes)) {
    exceptions.push({ lineItemId: null, type: "missing_tax", message: notes, severity: "info" });
  }
  return exceptions;
}

/** If nothing anywhere in the document (line-level or document-level) ever
 * mentioned tax, say so explicitly rather than silently assuming zero (PRD §27). */
export function buildImplicitMissingTaxException(
  anyLineHasTax: boolean,
  documentLevelNotes: string,
): ExceptionDraft | null {
  if (anyLineHasTax || TAX_MENTION_PATTERN.test(documentLevelNotes ?? "")) return null;
  return {
    lineItemId: null,
    type: "missing_tax",
    message: "Tax was not specified anywhere in this vendor's response. Confirm applicable tax separately before award.",
    severity: "info",
  };
}

/** Deterministic quality-gate aggregation over LLM-judged per-question pass/fail.
 * The LLM decides whether an individual answer reads as pass/fail/unclear; this
 * function only applies the fixed "any gating question failing gates the vendor"
 * rule (PRD §21's "Vendor B — failed quality criterion"). */
export function buildQualityExceptions(
  questionnaire: ExtractedQuestionnaireResponse[],
): ExceptionDraft[] {
  const failed: string[] = [];
  const unanswered: string[] = [];

  for (const qid of QUALITY_GATING_QUESTION_IDS) {
    const response = questionnaire.find((r) => r.questionId === qid);
    const question = QUESTIONNAIRE_QUESTIONS.find((q) => q.id === qid)!;
    if (!response || !response.answerText?.trim()) {
      unanswered.push(`"${question.text}"`);
    } else if (response.passFail === false) {
      failed.push(`"${question.text}" — answered "${response.answerText}"`);
    }
  }

  const drafts: ExceptionDraft[] = [];

  // A vendor that said no has ruled itself out on that criterion.
  if (failed.length > 0) {
    drafts.push({
      lineItemId: null,
      type: "quality_failure",
      message: `Answered no to ${failed.length} gating quality criterion(s): ${failed.join("; ")}.`,
      severity: "warning",
    });
  }

  // A vendor that said nothing has not. Reporting silence as a failure rejects a
  // supplier on grounds the buyer never agreed to, and it is the same mistake as
  // showing zero for an item nobody priced: an absence read as an answer.
  if (unanswered.length > 0) {
    drafts.push({
      lineItemId: null,
      type: "quality_unresolved",
      message:
        `${unanswered.length} gating quality criterion(s) left unanswered: ${unanswered.join("; ")}. ` +
        `Unknown, not failed — ask the vendor before treating this as a disqualification.`,
      severity: "warning",
    });
  }

  return drafts;
}

export interface VendorSummary {
  status: "processed" | "review_required";
  itemsFoundCount: number;
  itemsMissingCount: number;
  overallConfidence: number | null;
}

export function summarizeVendor(
  lineStatuses: Array<{ status: QuoteStatus; confidence: number | null }>,
  hasQualityFailure: boolean,
): VendorSummary {
  const itemsFoundCount = lineStatuses.filter((l) => l.status !== "not_quoted").length;
  const itemsMissingCount = lineStatuses.length - itemsFoundCount;
  const confidences = lineStatuses.map((l) => l.confidence).filter((c): c is number => c != null);
  const overallConfidence = confidences.length
    ? Math.round((confidences.reduce((a, b) => a + b, 0) / confidences.length) * 100) / 100
    : null;

  const needsReview = itemsMissingCount > 0 || (overallConfidence != null && overallConfidence < 0.85);
  // Quality failure is a copilot-time constraint, not an ingestion blocker (PRD §13's
  // demo example shows a vendor with a quality issue still marked "Processed").
  void hasQualityFailure;

  return {
    status: needsReview ? "review_required" : "processed",
    itemsFoundCount,
    itemsMissingCount,
    overallConfidence,
  };
}
