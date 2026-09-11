import type { FunctionDeclaration } from "@google/genai";

/** Raw shape of what the model hands back via the forced function call. This is
 * an unverified *candidate* — normalize.ts and validate.ts are what turn it into
 * a trustworthy VendorQuote. Nothing here is persisted as-is. */
export interface ExtractedLineItem {
  rfxLineItemId: number | null;
  quoted: boolean;
  vendorLabelAsWritten: string;
  sourceValue: number | null;
  sourceCurrency: "INR" | "USD" | null;
  sourceUnit: string | null;
  discountText: string | null;
  freightText: string | null;
  taxText: string | null;
  confidence: number;
  sourceLocation: string;
  sourceExcerpt: string;
  notes: string | null;
}

export interface ExtractedQuestionnaireResponse {
  questionId: number;
  answerText: string;
  passFail: boolean | null;
  confidence: number;
}

export interface ExtractionResult {
  vendorName: string | null;
  lineItems: ExtractedLineItem[];
  questionnaireResponses: ExtractedQuestionnaireResponse[];
  documentLevelNotes: string;
  /**
   * Priced rows in the document that match nothing in this RFx.
   *
   * Normally short, or empty. When it holds everything the document priced and
   * no RFx item was matched, the response almost certainly belongs to a
   * different event, which is a very different problem from a vendor who
   * declined to quote.
   */
  unmatchedDocumentRows?: string[];
  /** Set by the pipeline, not the model: which model actually read the file. */
  readByModel?: string;
  /** Set when the preferred model was unavailable and a weaker one was used. */
  downgradedFromModel?: string;
}

export const EXTRACTION_TOOL_NAME = "record_extraction";

export const EXTRACTION_TOOL: FunctionDeclaration = {
  name: EXTRACTION_TOOL_NAME,
  description:
    "Record every RFx line item quote and every questionnaire answer actually present in this vendor " +
    "document. Only include what is genuinely there — never invent a price, a line-item match, or an " +
    "answer. If a value is unclear, illegible, or not stated, reflect that with low confidence and a note " +
    "instead of guessing a number.",
  parametersJsonSchema: {
    type: "object",
    properties: {
      vendorName: {
        type: ["string", "null"],
        description: "The actual company/supplier name of the vendor submitting this document. Null if genuinely absent.",
      },
      lineItems: {
        type: "array",
        description:
          "One entry per row/line the vendor actually wrote, whether or not it matches an RFx item.",
        items: {
          type: "object",
          properties: {
            rfxLineItemId: {
              type: ["integer", "null"],
              description: "The matching RFx line item number (1-30), or null if it doesn't clearly match any RFx item.",
            },
            quoted: {
              type: "boolean",
              description: "true if a usable price was actually given for this item in the document.",
            },
            vendorLabelAsWritten: {
              type: "string",
              description: "The item name/description exactly as the vendor wrote it.",
            },
            sourceValue: { type: ["number", "null"], description: "The numeric price as written, before any conversion." },
            sourceCurrency: { type: ["string", "null"], enum: ["INR", "USD", null] },
            sourceUnit: {
              type: ["string", "null"],
              description: "The unit basis as the vendor expressed it, e.g. 'per piece', 'per 100 pieces', 'per kg'.",
            },
            discountText: { type: ["string", "null"], description: "Verbatim discount language tied to this item or the order overall, if any." },
            freightText: { type: ["string", "null"], description: "Verbatim freight/shipping language relevant to this item, if any." },
            taxText: { type: ["string", "null"], description: "Verbatim tax language relevant to this item, if any." },
            confidence: {
              type: "number",
              description: "0-1 confidence that sourceValue/sourceUnit/sourceCurrency were read correctly.",
            },
            sourceLocation: {
              type: "string",
              description: "Where this was read from, e.g. 'Row 12', 'Page 2', or a short locator into the text.",
            },
            sourceExcerpt: { type: "string", description: "The exact text/phrase the value was read from." },
            notes: { type: ["string", "null"], description: "Anything ambiguous, illegible, or worth flagging for buyer review." },
          },
          required: [
            "rfxLineItemId",
            "quoted",
            "vendorLabelAsWritten",
            "sourceValue",
            "sourceCurrency",
            "sourceUnit",
            "confidence",
            "sourceLocation",
            "sourceExcerpt",
          ],
        },
      },
      questionnaireResponses: {
        type: "array",
        description: "One entry per one of the 10 fixed questionnaire questions, if the document answers it.",
        items: {
          type: "object",
          properties: {
            questionId: { type: "integer", minimum: 1, maximum: 10 },
            answerText: { type: "string", description: "The vendor's answer, verbatim or closely paraphrased. Empty string if not answered." },
            passFail: {
              type: ["boolean", "null"],
              description: "true/false only for a clear yes/no on an objective capability question; null when informational or ambiguous.",
            },
            confidence: { type: "number" },
          },
          required: ["questionId", "answerText", "passFail", "confidence"],
        },
      },
      documentLevelNotes: {
        type: "string",
        description: "Overall commercial terms, freight/discount statements, or caveats that apply broadly rather than to one line item.",
      },
      unmatchedDocumentRows: {
        type: "array",
        description:
          "Rows this document prices that correspond to no RFx line item, as they appear in the document. " +
          "Leave empty when every priced row was matched. Never force a match to empty this list.",
        items: { type: "string" },
      },
    },
    required: ["vendorName", "lineItems", "questionnaireResponses", "documentLevelNotes"],
  },
};
