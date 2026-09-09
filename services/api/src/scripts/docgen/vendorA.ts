import * as XLSX from "xlsx";
import { QUESTIONNAIRE_QUESTIONS, RFX_LINE_ITEMS } from "@aerchain/shared";
import { VENDOR_A_LINES, VENDOR_A_QUESTIONNAIRE } from "../data/groundTruth.js";

const lineItemById = new Map(RFX_LINE_ITEMS.map((li) => [li.id, li]));

export async function generateVendorA(outPath: string): Promise<void> {
  const rows: (string | number)[][] = [];
  rows.push(["Vendor A Pvt. Ltd. — Quotation"]);
  rows.push(["RFx: Corrugated Packaging — FY27 Sourcing Event"]);
  rows.push(["Currency: INR. All prices per unit as specified in the RFx."]);
  rows.push([]);
  rows.push(["Item #", "Item", "Specification", "Quantity", "Unit", "Unit Price (INR)"]);
  for (const line of VENDOR_A_LINES) {
    const li = lineItemById.get(line.lineItemId)!;
    rows.push([line.lineItemId, line.labelAsQuoted, li.specification, li.quantity, li.unit, line.price ?? ""]);
  }
  rows.push([]);
  rows.push(["Vendor Questionnaire"]);
  rows.push(["Q#", "Question", "Answer"]);
  for (const a of VENDOR_A_QUESTIONNAIRE) {
    const q = QUESTIONNAIRE_QUESTIONS.find((qq) => qq.id === a.questionId)!;
    rows.push([a.questionId, q.text, a.answerText]);
  }

  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.aoa_to_sheet(rows);
  ws["!cols"] = [{ wch: 8 }, { wch: 32 }, { wch: 18 }, { wch: 10 }, { wch: 8 }, { wch: 16 }];
  XLSX.utils.book_append_sheet(wb, ws, "Quotation");
  XLSX.writeFile(wb, outPath);
}
