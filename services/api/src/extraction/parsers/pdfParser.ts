import fs from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
import { REPO_ROOT } from "../../paths.js";

// pdf-parse bundles a very old (2017-era) pdf.js that fails to read PDFs
// produced by current pdfkit versions ("bad XRef entry") — using the
// actively-maintained pdfjs-dist package directly avoids that entirely.
const STANDARD_FONT_DATA_URL = pathToFileURL(
  path.join(REPO_ROOT, "node_modules", "pdfjs-dist", "standard_fonts") + path.sep,
).href;

/** Extracts text page-by-page with explicit "--- Page N ---" markers so the
 * extraction prompt can cite a real page number, matching PRD §15's example
 * ("Vendor B Quote.pdf, Page 2"). */
export async function parsePdf(filePath: string): Promise<string> {
  const buffer = await fs.readFile(filePath);
  const doc = await getDocument({
    data: new Uint8Array(buffer),
    standardFontDataUrl: STANDARD_FONT_DATA_URL,
    useWorkerFetch: false,
  }).promise;

  const parts: string[] = [];
  for (let pageNumber = 1; pageNumber <= doc.numPages; pageNumber++) {
    const page = await doc.getPage(pageNumber);
    const textContent = await page.getTextContent();
    const text = textContent.items.map((item) => ("str" in item ? item.str : "")).join(" ");
    parts.push(`--- Page ${pageNumber} ---\n${text}`);
  }
  return parts.join("\n\n");
}
