import type { ConfidenceLevel, ExceptionSeverity, ExceptionType, MoneyAdjustment, QuoteStatus } from "@aerchain/shared";
import { QUALITY_GATING_QUESTION_IDS, QUESTIONNAIRE_QUESTIONS } from "@aerchain/shared";
import { prisma } from "../db.js";

/** The in-memory shape every calculation runs against. Built once from the DB,
 * then passed to pure functions in engine.ts — no calculation ever re-queries. */

export interface DatasetLineItem {
  id: number;
  name: string;
  specification: string;
  quantity: number;
  unit: string;
}

export interface DatasetQuote {
  vendorId: string;
  lineItemId: number;
  status: QuoteStatus;
  sourceValue: number | null;
  sourceCurrency: string | null;
  sourceUnit: string | null;
  normalizedValue: number | null;
  normalizedUnit: string;
  normalizedCurrency: string;
  /** Per-unit comparable cost in INR. null means "not enough information" — never 0. */
  evaluatedValue: number | null;
  confidence: number | null;
  confidenceLevel: ConfidenceLevel | null;
  discount: MoneyAdjustment | null;
  freight: MoneyAdjustment | null;
  tax: MoneyAdjustment | null;
  sourceDocument: string | null;
  sourceLocation: string | null;
  sourceExcerpt: string | null;
  fxRate: { from: string; to: string; rate: number; asOf: string; source: string } | null;
  notes: string | null;
}

export interface DatasetException {
  id: string;
  vendorId: string;
  lineItemId: number | null;
  type: ExceptionType;
  message: string;
  severity: ExceptionSeverity;
}

export interface DatasetQuestionnaireAnswer {
  questionId: number;
  questionText: string;
  answerText: string;
  passFail: boolean | null;
  confidence: number | null;
}

export interface DatasetVendor {
  id: string;
  name: string;
  responseFormat: string;
  status: string;
  itemsFoundCount: number | null;
  itemsMissingCount: number | null;
  overallConfidence: number | null;
  processingMs: number | null;
  questionnaire: DatasetQuestionnaireAnswer[];
  /** Deterministic verdict over the gating questions. An explicit "no" is a
   * disqualification; a blank or hedged answer is unresolved, not a rejection. */
  quality: QualityAssessment;
  /**
   * The registered supplier this response came from, where the name matches one.
   *
   * A response is a document; a supplier is a company with a history. Carrying
   * the second alongside the first is what lets "have we bought from them
   * before" be answered from records rather than from the quote in hand.
   */
  supplier: DatasetSupplier | null;
}

export interface DatasetSupplier {
  id: string;
  verificationStatus: string;
  verificationNote: string | null;
  city: string | null;
  gstin: string | null;
  paymentTerms: string | null;
  onTimeDeliveryPct: number | null;
  history: Array<{
    externalId: string;
    title: string;
    category: string;
    completedAt: string;
    /** "awarded" or "participated". */
    result: string;
    performance: string | null;
    qualityIncidents: number;
    awardValueInr: number;
    awardedVendorName: string;
  }>;
}

export type QualityStatus = "passed" | "failed" | "unresolved";

export interface QualityAssessment {
  status: QualityStatus;
  /** Gating questions the vendor answered with a clear no. */
  hardFailures: string[];
  /** Gating questions left blank or answered ambiguously — buyer judgement needed. */
  unresolved: string[];
}

export interface ComparisonDataset {
  rfxId: string;
  rfxName: string;
  baseCurrency: string;
  lineItems: DatasetLineItem[];
  vendors: DatasetVendor[];
  /** keyed "vendorId:lineItemId" */
  quotes: Map<string, DatasetQuote>;
  exceptions: DatasetException[];
}

export function quoteKey(vendorId: string, lineItemId: number): string {
  return `${vendorId}:${lineItemId}`;
}

function parseJson<T>(raw: string | null): T | null {
  if (!raw) return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

/** Applies the fixed quality gate. The per-answer yes/no/unclear judgement came
 * from extraction; this aggregation rule is code, not model output.
 *
 * The distinction that matters: a vendor who answered "no" has disqualified
 * itself, but a vendor who left a question blank or hedged it has only left the
 * buyer without an answer. Treating those the same would silently reject vendors
 * on grounds the buyer never agreed to — the same mistake as showing zero for an
 * unquoted item. */
function evaluateQuality(answers: DatasetQuestionnaireAnswer[]): QualityAssessment {
  const hardFailures: string[] = [];
  const unresolved: string[] = [];
  for (const qid of QUALITY_GATING_QUESTION_IDS) {
    const answer = answers.find((a) => a.questionId === qid);
    // Falling back to "Question 5" told the buyer nothing about what was left
    // unanswered. The questionnaire is a fixed list, so the text is always
    // available even when the vendor said nothing against it.
    const label =
      answer?.questionText ?? QUESTIONNAIRE_QUESTIONS.find((q) => q.id === qid)?.text ?? `Question ${qid}`;
    if (answer?.passFail === false) {
      hardFailures.push(label);
    } else if (!answer || !answer.answerText.trim() || answer.passFail !== true) {
      unresolved.push(label);
    }
  }
  const status: QualityStatus = hardFailures.length > 0 ? "failed" : unresolved.length > 0 ? "unresolved" : "passed";
  return { status, hardFailures, unresolved };
}

export async function loadComparisonDataset(rfxId: string): Promise<ComparisonDataset> {
  const rfx = await prisma.rfx.findUniqueOrThrow({ where: { id: rfxId } });
  const [lineItems, vendors, quotes, exceptions, questionnaire] = await Promise.all([
    prisma.lineItem.findMany({ where: { rfxId }, orderBy: { id: "asc" } }),
    prisma.vendor.findMany({ where: { rfxId }, orderBy: { name: "asc" } }),
    prisma.vendorQuote.findMany({ where: { vendor: { rfxId } } }),
    prisma.quoteException.findMany({ where: { vendor: { rfxId } } }),
    prisma.questionnaireResponse.findMany({ where: { vendor: { rfxId } }, orderBy: { questionId: "asc" } }),
  ]);

  // Matched on name, the same rule the inbound matcher uses. A response whose
  // name matches nothing in the registry simply has no history, which is a fact
  // about our records rather than a fact about the supplier.
  const suppliers = await prisma.supplier.findMany({
    include: { participation: { include: { procurement: true } } },
  });
  const supplierByName = new Map(suppliers.map((s) => [s.name.trim().toLowerCase(), s]));

  const datasetVendors: DatasetVendor[] = vendors.map((v) => {
    const answers: DatasetQuestionnaireAnswer[] = questionnaire
      .filter((q) => q.vendorId === v.id)
      .map((q) => ({
        questionId: q.questionId,
        questionText: q.questionText,
        answerText: q.answerText,
        passFail: q.passFail,
        confidence: q.confidence,
      }));
    return {
      id: v.id,
      name: v.name,
      responseFormat: v.responseFormat,
      status: v.status,
      itemsFoundCount: v.itemsFoundCount,
      itemsMissingCount: v.itemsMissingCount,
      overallConfidence: v.overallConfidence,
      processingMs: v.processingMs,
      questionnaire: answers,
      quality: evaluateQuality(answers),
      supplier: (() => {
        const s = supplierByName.get(v.name.trim().toLowerCase());
        if (!s) return null;
        return {
          id: s.id,
          verificationStatus: s.verificationStatus,
          verificationNote: s.verificationNote,
          city: s.city,
          gstin: s.gstin,
          paymentTerms: s.paymentTerms,
          onTimeDeliveryPct: s.onTimeDeliveryPct,
          history: s.participation
            .map((p) => ({
              externalId: p.procurement.externalId,
              title: p.procurement.title,
              category: p.procurement.category,
              completedAt: p.procurement.completedAt.toISOString().slice(0, 10),
              result: p.result,
              performance: p.performance,
              qualityIncidents: p.qualityIncidents,
              awardValueInr: p.procurement.awardValueInr,
              awardedVendorName: p.procurement.awardedVendorName,
            }))
            .sort((a, b) => b.completedAt.localeCompare(a.completedAt)),
        };
      })(),
    };
  });

  const quoteMap = new Map<string, DatasetQuote>();
  for (const q of quotes) {
    quoteMap.set(quoteKey(q.vendorId, q.lineItemId), {
      vendorId: q.vendorId,
      lineItemId: q.lineItemId,
      status: q.status as QuoteStatus,
      sourceValue: q.sourceValue,
      sourceCurrency: q.sourceCurrency,
      sourceUnit: q.sourceUnit,
      normalizedValue: q.normalizedValue,
      normalizedUnit: q.normalizedUnit,
      normalizedCurrency: q.normalizedCurrency,
      evaluatedValue: q.evaluatedValue,
      confidence: q.confidence,
      confidenceLevel: q.confidenceLevel as ConfidenceLevel | null,
      discount: parseJson<MoneyAdjustment>(q.discountJson),
      freight: parseJson<MoneyAdjustment>(q.freightJson),
      tax: parseJson<MoneyAdjustment>(q.taxJson),
      sourceDocument: q.sourceDocument,
      sourceLocation: q.sourceLocation,
      sourceExcerpt: q.sourceExcerpt,
      fxRate: parseJson(q.fxRateJson),
      notes: q.notes,
    });
  }

  return {
    rfxId: rfx.id,
    rfxName: rfx.name,
    baseCurrency: rfx.currency,
    lineItems: lineItems.map((li) => ({
      id: li.id,
      name: li.name,
      specification: li.specification,
      quantity: li.quantity,
      unit: li.unit,
    })),
    vendors: datasetVendors,
    quotes: quoteMap,
    exceptions: exceptions.map((e) => ({
      id: e.id,
      vendorId: e.vendorId,
      lineItemId: e.lineItemId,
      type: e.type as ExceptionType,
      message: e.message,
      severity: e.severity as ExceptionSeverity,
    })),
  };
}
