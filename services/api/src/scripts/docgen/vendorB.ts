import fs from "node:fs";
import PDFDocument from "pdfkit";
import { QUESTIONNAIRE_QUESTIONS } from "@aerchain/shared";
import {
  VENDOR_B_FOOTNOTE_DISCOUNT,
  VENDOR_B_FREIGHT_NOTE,
  VENDOR_B_LINES,
  VENDOR_B_QUESTIONNAIRE,
} from "../data/groundTruth.js";

export async function generateVendorB(outPath: string): Promise<void> {
  const doc = new PDFDocument({ margin: 50, size: "A4" });
  const stream = fs.createWriteStream(outPath);
  doc.pipe(stream);

  doc.fontSize(18).text("Vendor B Packaging Co.", { align: "center" });
  doc.fontSize(11).text("Quotation — Corrugated Packaging FY27 Sourcing Event", { align: "center" });
  doc.moveDown(1.5);

  doc.fontSize(12).text("Item Pricing (INR)", { underline: true });
  doc.moveDown(0.5);
  doc.fontSize(9);
  for (const line of VENDOR_B_LINES) {
    doc.text(`${line.lineItemId}. ${line.labelAsQuoted} — Rs. ${line.price} ${line.unitBasis}`);
  }
  doc.moveDown(1);
  doc.fontSize(8).text(VENDOR_B_FOOTNOTE_DISCOUNT);

  doc.moveDown(1.5);
  doc.fontSize(12).text("Commercial Terms", { underline: true });
  doc.fontSize(9).moveDown(0.3).text(VENDOR_B_FREIGHT_NOTE);
  doc.moveDown(0.3).text("Prices valid for 45 days from date of this quotation.");

  doc.addPage();
  doc.fontSize(14).text("Vendor Questionnaire", { underline: true });
  doc.moveDown(0.5);
  doc.fontSize(10);
  for (const a of VENDOR_B_QUESTIONNAIRE) {
    const q = QUESTIONNAIRE_QUESTIONS.find((qq) => qq.id === a.questionId)!;
    doc.moveDown(0.4);
    doc.font("Helvetica-Bold").text(`${a.questionId}. ${q.text}`);
    doc.font("Helvetica").text(`Answer: ${a.answerText}`);
  }

  doc.end();
  await new Promise<void>((resolve, reject) => {
    stream.on("finish", () => resolve());
    stream.on("error", reject);
  });
}
