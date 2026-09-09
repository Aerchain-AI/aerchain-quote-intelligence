import fs from "node:fs";
import { Document, HeadingLevel, Packer, Paragraph, Table, TableCell, TableRow, TextRun } from "docx";
import { QUESTIONNAIRE_QUESTIONS } from "@aerchain/shared";
import { VENDOR_C_LINES, VENDOR_C_QUESTIONNAIRE } from "../data/groundTruth.js";

function headerCell(text: string): TableCell {
  return new TableCell({ children: [new Paragraph({ children: [new TextRun({ text, bold: true })] })] });
}
function cell(text: string): TableCell {
  return new TableCell({ children: [new Paragraph({ text })] });
}

export async function generateVendorC(outPath: string): Promise<void> {
  const tableRows = [
    new TableRow({ children: [headerCell("Item #"), headerCell("Item"), headerCell("Unit Price (USD)"), headerCell("Basis")] }),
    ...VENDOR_C_LINES.map(
      (line) =>
        new TableRow({
          children: [
            cell(String(line.lineItemId)),
            cell(line.labelAsQuoted),
            cell(`$${line.price}`),
            cell(line.unitBasis),
          ],
        }),
    ),
  ];

  const questionnaireParagraphs = VENDOR_C_QUESTIONNAIRE.flatMap((a) => {
    const q = QUESTIONNAIRE_QUESTIONS.find((qq) => qq.id === a.questionId)!;
    return [
      new Paragraph({ children: [new TextRun({ text: `${a.questionId}. ${q.text}`, bold: true })] }),
      new Paragraph({ text: a.answerText }),
    ];
  });

  const doc = new Document({
    sections: [
      {
        children: [
          new Paragraph({ text: "Vendor C International Packaging LLC", heading: HeadingLevel.HEADING_1 }),
          new Paragraph({ text: "Quotation — Corrugated Packaging FY27 Sourcing Event" }),
          new Paragraph({
            children: [
              new TextRun({
                text: "All prices quoted in USD. Freight is not included in the prices below and will be quoted separately once the order is confirmed.",
                italics: true,
              }),
            ],
          }),
          new Paragraph({ text: "" }),
          new Table({ rows: tableRows }),
          new Paragraph({ text: "" }),
          new Paragraph({ text: "Vendor Questionnaire", heading: HeadingLevel.HEADING_2 }),
          ...questionnaireParagraphs,
        ],
      },
    ],
  });

  const buffer = await Packer.toBuffer(doc);
  fs.writeFileSync(outPath, buffer);
}
