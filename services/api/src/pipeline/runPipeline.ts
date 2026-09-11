import path from "node:path";
import type { LineItem, VendorResponseFormat } from "@aerchain/shared";
import { confidenceLevel, QUESTIONNAIRE_QUESTIONS } from "@aerchain/shared";
import { prisma } from "../db.js";
import { extractVendorDocument } from "../extraction/extract.js";
import type { ExtractedLineItem } from "../extraction/tool.js";
import { normalizeQuote } from "./normalize.js";
import {
  buildDocumentLevelExceptions,
  buildImplicitMissingTaxException,
  buildQualityExceptions,
  buildUnmatchedDocumentException,
  summarizeVendor,
  validateLine,
  type ExceptionDraft,
} from "./validate.js";

function pickExtractedFor(lineItemId: number, extracted: ExtractedLineItem[]): ExtractedLineItem {
  const matches = extracted.filter((e) => e.rfxLineItemId === lineItemId);
  if (matches.length === 0) {
    return {
      rfxLineItemId: lineItemId,
      quoted: false,
      vendorLabelAsWritten: "",
      sourceValue: null,
      sourceCurrency: null,
      sourceUnit: null,
      discountText: null,
      freightText: null,
      taxText: null,
      confidence: 0,
      sourceLocation: "",
      sourceExcerpt: "",
      notes: null,
    };
  }
  // If several rows matched the same RFx item (shouldn't normally happen), prefer
  // the one that's actually quoted, then the higher-confidence one.
  return matches.sort((a, b) => Number(b.quoted) - Number(a.quoted) || b.confidence - a.confidence)[0];
}

export interface PipelineRunSummary {
  vendorId: string;
  vendorName: string;
  status: "processed" | "review_required";
  itemsFoundCount: number;
  itemsMissingCount: number;
  overallConfidence: number | null;
  exceptionCount: number;
}

export async function runPipelineForVendor(vendorId: string): Promise<PipelineRunSummary> {
  const startedAt = Date.now();
  const vendor = await prisma.vendor.findUniqueOrThrow({ where: { id: vendorId }, include: { rfx: true } });
  const previousStatus = vendor.status;
  await prisma.vendor.update({ where: { id: vendorId }, data: { status: "processing" } });

  const rfxLineItems: LineItem[] = await prisma.lineItem.findMany({
    where: { rfxId: vendor.rfxId },
    orderBy: { id: "asc" },
  });

  // Extraction is the only step that can fail on an external service. If it does,
  // put the vendor back where it was rather than leaving it stuck in "processing"
  // — nothing has been deleted at this point, so its previous results are intact.
  let extraction;
  try {
    extraction = await extractVendorDocument({
      filePath: vendor.filePath,
      responseFormat: vendor.responseFormat as VendorResponseFormat,
      rfxLineItems,
    });
  } catch (err) {
    const hadResults = (await prisma.vendorQuote.count({ where: { vendorId } })) > 0;
    await prisma.vendor.update({
      where: { id: vendorId },
      data: { status: hadResults ? previousStatus : "failed" },
    });
    throw err;
  }

  const quoteRows: Array<Parameters<typeof prisma.vendorQuote.create>[0]["data"]> = [];
  const exceptionDrafts: ExceptionDraft[] = [];
  const lineStatuses: Array<{ status: "verified" | "flagged" | "not_quoted"; confidence: number | null }> = [];
  let anyLineHasTax = false;

  for (const li of rfxLineItems) {
    const extracted = pickExtractedFor(li.id, extraction.lineItems);
    const normalized = normalizeQuote(extracted, li);
    const { status, confidenceLevel: level, exceptions } = validateLine(extracted, normalized);

    exceptionDrafts.push(...exceptions);
    lineStatuses.push({ status, confidence: extracted.quoted ? extracted.confidence : null });
    if (normalized.tax) anyLineHasTax = true;

    quoteRows.push({
      vendorId,
      lineItemId: li.id,
      sourceValue: extracted.quoted ? extracted.sourceValue : null,
      sourceCurrency: extracted.quoted ? extracted.sourceCurrency : null,
      sourceUnit: extracted.quoted ? extracted.sourceUnit : null,
      normalizedValue: normalized.normalizedValue,
      normalizedCurrency: normalized.normalizedCurrency,
      normalizedUnit: normalized.normalizedUnit,
      aiInterpretedValue: normalized.normalizedValue,
      aiInterpretedCurrency: normalized.normalizedCurrency,
      aiInterpretedUnit: normalized.normalizedUnit,
      discountJson: normalized.discount ? JSON.stringify(normalized.discount) : null,
      freightJson: normalized.freight ? JSON.stringify(normalized.freight) : null,
      taxJson: normalized.tax ? JSON.stringify(normalized.tax) : null,
      evaluatedValue: normalized.evaluatedValue,
      confidence: extracted.quoted ? extracted.confidence : null,
      confidenceLevel: level,
      status,
      sourceDocument: path.basename(vendor.filePath),
      sourceLocation: extracted.quoted ? extracted.sourceLocation : null,
      sourceExcerpt: extracted.quoted ? extracted.sourceExcerpt : null,
      fxRateJson: normalized.fxRateUsed ? JSON.stringify(normalized.fxRateUsed) : null,
      notes: extracted.notes,
    });
  }

  let finalVendorName = vendor.name;
  if (extraction.vendorName) {
    finalVendorName = extraction.vendorName;
    await prisma.vendor.update({
      where: { id: vendor.id },
      data: { name: finalVendorName },
    });
  }

  exceptionDrafts.push(...buildDocumentLevelExceptions(extraction.documentLevelNotes));
  const implicitTax = buildImplicitMissingTaxException(anyLineHasTax, extraction.documentLevelNotes);
  if (implicitTax) exceptionDrafts.push(implicitTax);
  const qualityExceptions = buildQualityExceptions(extraction.questionnaireResponses);
  exceptionDrafts.push(...qualityExceptions);

  // Nothing in this RFx was found in the document. Said once, plainly, rather
  // than thirty times as "the vendor did not quote this item".
  const unmatched = buildUnmatchedDocumentException(lineStatuses, extraction.unmatchedDocumentRows);
  if (unmatched) exceptionDrafts.push(unmatched);

  // An unanswered questionnaire is a reason to look, the same as a failed one.
  const summary = summarizeVendor(lineStatuses, qualityExceptions.length > 0);

  await prisma.$transaction(async (tx) => {
    await tx.vendorQuote.deleteMany({ where: { vendorId } });
    await tx.quoteException.deleteMany({ where: { vendorId } });
    await tx.questionnaireResponse.deleteMany({ where: { vendorId } });

    for (const row of quoteRows) {
      await tx.vendorQuote.create({ data: row });
    }
    for (const ex of exceptionDrafts) {
      await tx.quoteException.create({
        data: { vendorId, lineItemId: ex.lineItemId, type: ex.type, message: ex.message, severity: ex.severity },
      });
    }
    for (const qr of extraction.questionnaireResponses) {
      await tx.questionnaireResponse.create({
        data: {
          vendorId,
          questionId: qr.questionId,
          questionText: QUESTIONNAIRE_QUESTIONS.find((q) => q.id === qr.questionId)?.text ?? "",
          answerText: qr.answerText,
          passFail: qr.passFail,
          confidence: qr.confidence,
        },
      });
    }

    await tx.vendor.update({
      where: { id: vendorId },
      data: {
        status: summary.status,
        itemsFoundCount: summary.itemsFoundCount,
        itemsMissingCount: summary.itemsMissingCount,
        overallConfidence: summary.overallConfidence,
        processingMs: Date.now() - startedAt,
        processedAt: new Date(),
      },
    });
  });

  return {
    vendorId,
    vendorName: finalVendorName,
    status: summary.status,
    itemsFoundCount: summary.itemsFoundCount,
    itemsMissingCount: summary.itemsMissingCount,
    overallConfidence: summary.overallConfidence,
    exceptionCount: exceptionDrafts.length,
  };
}

// Re-export for convenience where only the confidence bucketing is needed.
export { confidenceLevel };
