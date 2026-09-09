import type { VendorResponseFormat } from "@aerchain/shared";

export type DocumentKind = "spreadsheet" | "pdf" | "word_document" | "photographed_document" | "plain_text";

const FORMAT_TO_KIND: Record<VendorResponseFormat, DocumentKind> = {
  xlsx: "spreadsheet",
  pdf: "pdf",
  docx: "word_document",
  jpg: "photographed_document",
  txt: "plain_text",
};

const KIND_DESCRIPTION: Record<DocumentKind, string> = {
  spreadsheet: "an Excel spreadsheet export of a vendor's pricing",
  pdf: "a PDF quotation document",
  word_document: "a Word document quotation",
  photographed_document: "a photograph of a printed quotation sheet — expect imperfect image quality, possible skew, and handwritten annotations",
  plain_text: "an informal email/plain-text quotation",
};

/** First pipeline stage — classifies the document so the extraction prompt can
 * be tuned to the format (PRD §24: staged pipeline, not one giant prompt). For
 * this prototype the format is authoritative from how the vendor submitted the
 * file; a production system would sniff MIME/content instead of trusting the extension. */
export function classifyDocument(responseFormat: VendorResponseFormat): { kind: DocumentKind; description: string } {
  const kind = FORMAT_TO_KIND[responseFormat];
  return { kind, description: KIND_DESCRIPTION[kind] };
}
