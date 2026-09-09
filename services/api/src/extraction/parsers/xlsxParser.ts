import fs from "node:fs/promises";
import * as XLSX from "xlsx";

/** Renders every sheet as row-numbered plain text so the extraction prompt
 * can cite a precise, checkable source location (e.g. "Row 6"). */
export async function parseXlsx(filePath: string): Promise<string> {
  // XLSX.readFile isn't reliably exposed as a named ESM export in this package
  // (it only shows up on the CJS `.default` bridge) — reading the buffer
  // ourselves and using XLSX.read (a real named export) sidesteps that.
  const buffer = await fs.readFile(filePath);
  const wb = XLSX.read(buffer, { type: "buffer" });
  const parts: string[] = [];
  for (const sheetName of wb.SheetNames) {
    const sheet = wb.Sheets[sheetName];
    const rows: unknown[][] = XLSX.utils.sheet_to_json(sheet, { header: 1, blankrows: false });
    parts.push(`--- Sheet: ${sheetName} ---`);
    rows.forEach((row, i) => {
      const cells = row.map((c) => (c === undefined || c === null ? "" : String(c))).join(" | ");
      if (cells.trim()) parts.push(`Row ${i + 1}: ${cells}`);
    });
  }
  return parts.join("\n");
}
