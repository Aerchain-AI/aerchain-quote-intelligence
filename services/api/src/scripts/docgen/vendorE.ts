import fs from "node:fs/promises";
import { QUESTIONNAIRE_QUESTIONS } from "@aerchain/shared";
import { VENDOR_E_LINES, VENDOR_E_QUESTIONNAIRE } from "../data/groundTruth.js";

export async function generateVendorE(outPath: string): Promise<void> {
  const quotedLines = VENDOR_E_LINES.filter((l) => l.quoted);
  const lastYearLines = VENDOR_E_LINES.filter((l) => l.lastYearReference);

  const priceBlock = quotedLines
    .map((l) => `- ${l.labelAsQuoted}: Rs.${l.price} ${l.unitBasis}`)
    .join("\n");

  const lastYearNames = lastYearLines.map((l) => l.labelAsQuoted).join(", ");

  const questionnaireBlock = VENDOR_E_QUESTIONNAIRE.map((a) => {
    const q = QUESTIONNAIRE_QUESTIONS.find((qq) => qq.id === a.questionId)!;
    return `> ${q.text}\n${a.answerText}`;
  }).join("\n\n");

  const body = `From: sales@vendore-packaging.example
To: procurement@buyer.example
Subject: RE: Corrugated Packaging FY27 - our pricing

Hi,

thanks for sending over the list, here's what we can do. prices below are per
unit like you asked, most items are same as our current supply agreement.

${priceBlock}

for ${lastYearNames} - rest same as last year, no change on our side.

freight extra, will confirm once we know the delivery pincode(s). we didn't
add anything for tax, assume that's handled on your end as usual.

re: your questionnaire -

${questionnaireBlock}

let me know if you need anything else, happy to hop on a call this week.

thanks,
Vendor E Packaging Solutions
`;

  await fs.writeFile(outPath, body, "utf-8");
}
