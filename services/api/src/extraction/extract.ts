import path from "node:path";
import { FunctionCallingConfigMode, type Part } from "@google/genai";
import type { LineItem, VendorResponseFormat } from "@aerchain/shared";
import { extractionModelsFor, getKeyPool } from "../llm/client.js";
import { classifyDocument } from "./classify.js";
import { parseDocx } from "./parsers/docxParser.js";
import { parseImage } from "./parsers/imageParser.js";
import { parsePdf } from "./parsers/pdfParser.js";
import { parseText } from "./parsers/textParser.js";
import { parseXlsx } from "./parsers/xlsxParser.js";
import {
  EXTRACTION_TOOL,
  EXTRACTION_TOOL_NAME,
  type ExtractionResult,
} from "./tool.js";

/**
 * How long one document may take before the queue gives up on it.
 *
 * Long enough for a slow photographed quotation plus one retry; short enough
 * that four other responses are not left waiting on it.
 */
const EXTRACTION_DEADLINE_MS = 240_000;

function rfxItemsBlock(lineItems: LineItem[]): string {
  return lineItems
    .map(
      (li) =>
        `${li.id}. ${li.name} (${li.specification}) — Qty ${li.quantity} ${li.unit}`,
    )
    .join("\n");
}

const SYSTEM_PROMPT = `You are the extraction stage of a procurement quote-analysis pipeline. You read one
vendor's quotation document and map it against a fixed list of RFx line items.

Rules you must follow:
- Extract the actual company/supplier name of the vendor submitting this document into the vendorName field.
- Only report a line item as "quoted" if the document actually gives it a usable price.
- Never invent, estimate, or infer a price, discount, freight, or tax figure that isn't actually written
  in the document. If it's not there, say so (quoted: false, or a null field) rather than guessing.
- If text is illegible, ambiguous, or a handwritten correction overrides a printed value, describe exactly
  what you see (both values if relevant) and lower your confidence — do not silently pick one.
- Match vendor line items to the RFx list by meaning, not by exact wording — vendors often use their own
  terminology (e.g. "Medium Box (5 Ply)" for RFx item "5-Ply Corrugated Box – Medium").
- Each row in the document maps to AT MOST ONE RFx line item. Never reuse one row's price for a second
  RFx item. Beware near-identical names: "PP Strapping" and "PET Strapping", or "Edge Protectors – Small"
  and "Edge Protectors – Large", are different items. If the document contains only one of a similar pair,
  the other one is simply not quoted.
- Vendors routinely skip items. If an RFx item has no row of its own in the document, report it with
  quoted: false. Do not fill the gap from a neighbouring row. An unquoted item is a normal, expected
  outcome — an invented price is a serious error.
- Every value you report must be traceable: give a real, checkable sourceLocation and sourceExcerpt.
- If the document prices rows that correspond to nothing in the RFx list, name them in unmatchedDocumentRows.
  A document whose every row is unmatched is usually a response to a different RFx; say so there rather than
  forcing matches to make the list look complete.
- Call the record_extraction function exactly once with everything you found. This is the only output you produce.`;

async function loadDocumentContent(
  filePath: string,
  format: VendorResponseFormat,
): Promise<{
  text?: string;
  image?: { mediaType: "image/jpeg" | "image/png"; base64: string };
}> {
  switch (format) {
    case "xlsx":
      return { text: await parseXlsx(filePath) };
    case "pdf":
      return { text: await parsePdf(filePath) };
    case "docx":
      return { text: await parseDocx(filePath) };
    case "txt":
      return { text: await parseText(filePath) };
    case "jpg":
      return { image: await parseImage(filePath) };
    default:
      throw new Error(
        `Unsupported vendor response format: ${format satisfies never}`,
      );
  }
}

export async function extractVendorDocument(params: {
  filePath: string;
  responseFormat: VendorResponseFormat;
  rfxLineItems: LineItem[];
}): Promise<ExtractionResult> {
  const { filePath, responseFormat, rfxLineItems } = params;
  const { description } = classifyDocument(responseFormat);
  const content = await loadDocumentContent(filePath, responseFormat);

  const instructions =
    `The document below is ${description}.\n\n` +
    `Here is the fixed RFx line-item list (id. name (specification) — Qty quantity unit):\n${rfxItemsBlock(
      rfxLineItems,
    )}\n\n` +
    `There are also 10 fixed questionnaire questions (ids 1-10) that this document may answer, in any order ` +
    `and possibly embedded in prose. Extract whatever is present.\n\n` +
    (content.text
      ? `Document content follows:\n\n${content.text}`
      : "The document is attached as an image below.");

  const parts: Part[] = content.image
    ? [
        {
          inlineData: {
            mimeType: content.image.mediaType,
            data: content.image.base64,
          },
        },
        { text: instructions },
      ]
    : [{ text: instructions }];

  // The models that can read this format, best first. The pool fails over
  // between keys; this fails over between models, which is a different outage.
  //
  // The deadline matters as much as the fallback. Without one the pool would
  // work through three keys at two attempts each, every attempt allowed 150
  // seconds: a quarter of an hour of silence with nothing on screen but a
  // spinner, and a queue of other responses stuck behind it. Four minutes is
  // room for one slow read and a retry, and short enough that the queue moves
  // on while the buyer is still watching.
  const pool = getKeyPool();
  const candidates = extractionModelsFor(responseFormat);

  // Skip a model the pool already knows is parked rather than spending the
  // deadline rediscovering it. If every candidate is parked, the first is still
  // attempted, so the error the buyer reads is the real one from the service.
  const withCapacity = candidates.filter((m: string) => pool.hasCapacityFor(m));
  const order = withCapacity.length > 0 ? withCapacity : candidates.slice(0, 1);

  const runWith = (model: string) =>
    pool.runWithFailover(
      {
        model,
        run: (client) =>
          client.models.generateContent({
            model,
            contents: [{ role: "user", parts }],
            config: {
              systemInstruction: SYSTEM_PROMPT,
              // A full 30-item extraction plus 10 questionnaire answers is a large
              // structured payload. Too low a cap truncates the function call mid-JSON
              // and the SDK then surfaces no call at all.
              maxOutputTokens: 32768,
              httpOptions: { timeout: 150_000 },
              tools: [{ functionDeclarations: [EXTRACTION_TOOL] }],
              toolConfig: {
                functionCallingConfig: {
                  mode: FunctionCallingConfigMode.ANY,
                  allowedFunctionNames: [EXTRACTION_TOOL_NAME],
                },
              },
            },
          }),
      },
      { deadlineMs: EXTRACTION_DEADLINE_MS },
    );

  let response: Awaited<ReturnType<typeof runWith>> | null = null;
  let model = order[0];
  let downgradedFrom: string | null = null;
  const failures: string[] = [];

  for (const candidate of order) {
    try {
      response = await runWith(candidate);
      model = candidate;
      if (candidate !== candidates[0]) downgradedFrom = candidates[0];
      break;
    } catch (err) {
      failures.push(`${candidate}: ${(err as Error).message}`);
    }
  }

  if (!response) throw new Error(failures.join(" | "));

  const call = response.functionCalls?.[0];
  if (!call || call.name !== EXTRACTION_TOOL_NAME || !call.args) {
    // Name the actual cause rather than reporting a generic miss — a truncated
    // response and a refused one need very different responses from an operator.
    const finishReason = response.candidates?.[0]?.finishReason;
    const textPart = response.candidates?.[0]?.content?.parts?.find(
      (p) => p.text,
    )?.text;
    const detail =
      finishReason === "MAX_TOKENS"
        ? "the response hit the output token cap before the function call was complete"
        : finishReason
          ? `the model stopped with finishReason=${finishReason}`
          : "the model returned no function call and no finish reason";
    throw new Error(
      `Extraction failed for ${path.basename(filePath)} using ${model}: ${detail}.` +
        (textPart ? ` Model said: "${textPart.slice(0, 200)}"` : ""),
    );
  }
  const result = call.args as unknown as ExtractionResult;

  // Which model actually read it. A photograph read by the smaller model is a
  // weaker read, and the buyer is owed that fact next to the figures rather than
  // a silently worse result that looks identical to a good one. Recorded as its
  // own field: folding it into documentLevelNotes put it inside the freight and
  // tax findings, which are about the vendor's terms, not about our plumbing.
  result.readByModel = model;
  if (downgradedFrom) result.downgradedFromModel = downgradedFrom;
  return result;
}
