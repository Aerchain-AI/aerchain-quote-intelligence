import sharp from "sharp";
import { QUESTIONNAIRE_QUESTIONS } from "@aerchain/shared";
import { VENDOR_D_LINES, VENDOR_D_QUESTIONNAIRE } from "../data/groundTruth.js";

function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

const WIDTH = 1000;

export async function generateVendorD(outPath: string): Promise<void> {
  const lines: string[] = [];
  let y = 70;

  lines.push(`<text x="${WIDTH / 2}" y="${y}" font-size="26" font-family="Arial, sans-serif" font-weight="bold" text-anchor="middle" fill="#111">Vendor D Packaging Works</text>`);
  y += 32;
  lines.push(`<text x="${WIDTH / 2}" y="${y}" font-size="15" font-family="Arial, sans-serif" text-anchor="middle" fill="#222">Quotation - Corrugated Packaging FY27 Sourcing Event</text>`);
  y += 20;
  lines.push(`<line x1="60" y1="${y}" x2="${WIDTH - 60}" y2="${y}" stroke="#333" stroke-width="1.5" />`);
  y += 34;

  lines.push(`<text x="60" y="${y}" font-size="16" font-family="Arial, sans-serif" font-weight="bold" fill="#111">Item Pricing (Rs., per unit as specified)</text>`);
  y += 28;

  for (const line of VENDOR_D_LINES) {
    const color = line.lowContrast ? "#b8b8b8" : "#151515";
    const baseText = `${line.lineItemId}. ${esc(line.labelAsQuoted)} - Rs. ${line.price} ${esc(line.unitBasis)}`;

    if (line.handwrittenOverride) {
      const printedText = `${line.lineItemId}. ${esc(line.labelAsQuoted)} - Rs. ${line.handwrittenOverride.printedPrice} ${esc(line.unitBasis)}`;
      lines.push(`<text x="60" y="${y}" font-size="15" font-family="Arial, sans-serif" fill="${color}">${printedText}</text>`);
      // strike-through the printed price to simulate a manual correction
      lines.push(`<line x1="330" y1="${y - 5}" x2="470" y2="${y - 5}" stroke="#b91c1c" stroke-width="1.6" />`);
      lines.push(`<text x="480" y="${y}" font-size="16" font-family="Segoe Script, Comic Sans MS, cursive" font-style="italic" fill="#1d4ed8">-&gt; Rs. ${line.handwrittenOverride.handwrittenPrice}</text>`);
    } else {
      lines.push(`<text x="60" y="${y}" font-size="15" font-family="Arial, sans-serif" fill="${color}">${baseText}</text>`);
    }
    y += 24;
  }

  y += 20;
  lines.push(`<line x1="60" y1="${y}" x2="${WIDTH - 60}" y2="${y}" stroke="#333" stroke-width="1.5" />`);
  y += 30;
  lines.push(`<text x="60" y="${y}" font-size="16" font-family="Arial, sans-serif" font-weight="bold" fill="#111">Vendor Questionnaire</text>`);
  y += 24;

  for (const a of VENDOR_D_QUESTIONNAIRE) {
    const q = QUESTIONNAIRE_QUESTIONS.find((qq) => qq.id === a.questionId)!;
    lines.push(`<text x="60" y="${y}" font-size="12" font-family="Arial, sans-serif" font-weight="bold" fill="#111">${a.questionId}. ${esc(q.text)}</text>`);
    y += 17;
    const answer = a.answerText.trim() ? esc(a.answerText) : "(left blank)";
    lines.push(`<text x="75" y="${y}" font-size="12" font-family="Arial, sans-serif" fill="#333">${answer}</text>`);
    y += 21;
  }

  const height = y + 60;
  const svg = `<svg width="${WIDTH}" height="${height}" viewBox="0 0 ${WIDTH} ${height}" xmlns="http://www.w3.org/2000/svg">
    <rect x="0" y="0" width="${WIDTH}" height="${height}" fill="#fbfaf7" />
    <rect x="20" y="20" width="${WIDTH - 40}" height="${height - 40}" fill="none" stroke="#cfcac0" stroke-width="2" />
    ${lines.join("\n    ")}
  </svg>`;

  await sharp(Buffer.from(svg))
    .rotate(2.2, { background: "#fbfaf7" })
    .modulate({ brightness: 0.97, saturation: 0.9 })
    .jpeg({ quality: 74 })
    .toFile(outPath);
}
