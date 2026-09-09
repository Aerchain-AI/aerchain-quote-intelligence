import PDFDocument from "pdfkit";
import * as XLSX from "xlsx";
import { QUESTIONNAIRE_QUESTIONS } from "@aerchain/shared";
import { prisma } from "../db.js";

/**
 * The RFx packet a supplier actually receives.
 *
 * Real sourcing events are not issued as an email body. They go out as a cover
 * email plus two attachments:
 *
 *   rfq.pdf                 the formal, fixed record of what was asked — the
 *                           document you point at if a supplier later disputes
 *                           the scope
 *   pricing-template.xlsx   line items pre-filled, price columns blank, so
 *                           responses come back comparable
 *
 * The template exists to reduce the mess this product otherwise has to clean up.
 * It does not eliminate it — suppliers still reply with their own PDFs, scans and
 * plain-text emails, which is exactly why the extraction pipeline exists. Sending
 * a template makes compliance easy; the pipeline handles the ones who ignore it.
 */

interface PacketSource {
  name: string;
  category: string;
  currency: string;
  description: string;
  requiredByDate: Date;
  buyerName: string;
  buyerTeam: string;
  lineItems: Array<{ id: number; name: string; specification: string; quantity: number; unit: string }>;
  terms: Array<{ question: string; answer: string }>;
}

async function loadPacketSource(rfxId: string): Promise<PacketSource> {
  const rfx = await prisma.rfx.findUniqueOrThrow({
    where: { id: rfxId },
    include: { lineItems: { orderBy: { id: "asc" } }, buyer: true },
  });

  let terms: Array<{ question: string; answer: string }> = [];
  if (rfx.clarificationsJson) {
    try {
      terms = JSON.parse(rfx.clarificationsJson);
    } catch {
      terms = [];
    }
  }

  return {
    name: rfx.name,
    category: rfx.category,
    currency: rfx.currency,
    description: rfx.description,
    requiredByDate: rfx.requiredByDate,
    buyerName: rfx.buyer?.name ?? "Procurement",
    buyerTeam: rfx.buyer?.team ?? "Procurement Team",
    lineItems: rfx.lineItems,
    // Only terms the buyer actually settled — an RFQ should not publish
    // "Not specified" as though it were a condition.
    terms: terms.filter((t) => t.answer?.trim() && t.answer.trim().toLowerCase() !== "not specified"),
  };
}

function formatDate(d: Date): string {
  return d.toLocaleDateString("en-IN", { day: "numeric", month: "long", year: "numeric" });
}

// ------------------------------------------------------------------ RFQ PDF

export async function buildRfqPdf(rfxId: string): Promise<Buffer> {
  const src = await loadPacketSource(rfxId);
  const doc = new PDFDocument({ margin: 50, size: "A4" });
  const chunks: Buffer[] = [];
  doc.on("data", (c: Buffer) => chunks.push(c));
  const done = new Promise<Buffer>((resolve) => doc.on("end", () => resolve(Buffer.concat(chunks))));

  // Header
  doc.font("Helvetica-Bold").fontSize(18).text("REQUEST FOR QUOTATION", { align: "center" });
  doc.moveDown(0.3);
  doc.font("Helvetica").fontSize(11).text(src.name, { align: "center" });
  doc.moveDown(1.2);

  const field = (label: string, value: string) => {
    doc.font("Helvetica-Bold").fontSize(9).text(label, { continued: true });
    doc.font("Helvetica").text(`  ${value}`);
  };
  field("Category:", src.category);
  field("Quotation currency:", src.currency);
  field("Required by:", formatDate(src.requiredByDate));
  field("Issued by:", `${src.buyerName}, ${src.buyerTeam}`);
  field("Issue date:", formatDate(new Date()));
  doc.moveDown(1);

  doc.font("Helvetica-Bold").fontSize(12).text("1. SCOPE");
  doc.moveDown(0.3).font("Helvetica").fontSize(10).text(src.description, { align: "justify" });
  doc.moveDown(1);

  doc.font("Helvetica-Bold").fontSize(12).text(`2. LINE ITEMS (${src.lineItems.length})`);
  doc.moveDown(0.4);
  doc.font("Helvetica-Bold").fontSize(8);
  doc.text("#", 50, doc.y, { continued: true, width: 25 });
  doc.text("ITEM", { continued: true, width: 190 });
  doc.text("SPECIFICATION", { continued: true, width: 150 });
  doc.text("QTY", { continued: true, width: 60 });
  doc.text("UNIT");
  doc.moveDown(0.2);
  doc.moveTo(50, doc.y).lineTo(545, doc.y).stroke();
  doc.moveDown(0.3);

  doc.font("Helvetica").fontSize(8);
  src.lineItems.forEach((li, i) => {
    if (doc.y > 720) doc.addPage();
    const y = doc.y;
    doc.text(String(i + 1), 50, y, { width: 25 });
    doc.text(li.name, 75, y, { width: 190 });
    doc.text(li.specification || "—", 265, y, { width: 150 });
    doc.text(li.quantity.toLocaleString("en-IN"), 415, y, { width: 60 });
    doc.text(li.unit, 475, y);
    doc.moveDown(0.6);
  });

  doc.moveDown(1);
  if (doc.y > 640) doc.addPage();
  doc.font("Helvetica-Bold").fontSize(12).text("3. COMMERCIAL CONDITIONS");
  doc.moveDown(0.3).font("Helvetica").fontSize(9);
  if (src.terms.length === 0) {
    doc.text("No additional commercial conditions beyond those stated above.");
  } else {
    for (const t of src.terms) {
      doc.font("Helvetica-Bold").text(t.question);
      doc.font("Helvetica").text(t.answer);
      doc.moveDown(0.3);
    }
  }

  doc.moveDown(0.8);
  if (doc.y > 600) doc.addPage();
  doc.font("Helvetica-Bold").fontSize(12).text("4. INSTRUCTIONS TO BIDDERS");
  doc.moveDown(0.3).font("Helvetica").fontSize(9);
  const instructions = [
    `Quote a unit price for every line item, in ${src.currency}, using the attached pricing template.`,
    "If you cannot supply an item, mark it “not quoted”. Do not delete the row or leave it blank — an omitted line is treated as no quote, not as zero cost.",
    "State clearly whether freight and taxes are included in your unit prices or charged separately. Prices with unstated freight cannot be compared fairly against those that include it.",
    "Declare any minimum order quantity, lead time or price-validity period that applies.",
    "Complete the supplier questionnaire on the second sheet of the pricing template.",
    "Return the completed template by the required-by date. Responses in another format are accepted, but the template gives the fastest and most accurate evaluation.",
  ];
  instructions.forEach((line, i) => {
    doc.text(`${i + 1}. ${line}`, { align: "justify" });
    doc.moveDown(0.25);
  });

  doc.moveDown(0.8);
  doc.font("Helvetica-Bold").fontSize(12).text("5. EVALUATION BASIS");
  doc.moveDown(0.3).font("Helvetica").fontSize(9);
  doc.text(
    "Quotations are evaluated on total evaluated cost — unit price normalised to the units and currency stated " +
      "above, plus any applicable freight and tax. Suppliers are compared only across line items every compared " +
      "supplier has priced. Questionnaire responses are used to confirm quality eligibility. Incomplete or " +
      "ambiguous submissions are flagged for clarification rather than discarded.",
    { align: "justify" },
  );

  doc.moveDown(1.5);
  doc.font("Helvetica").fontSize(8).fillColor("#666");
  doc.text(`${src.buyerName} · ${src.buyerTeam}`, { align: "center" });

  doc.end();
  return done;
}

// ------------------------------------------------------- pricing template

export async function buildPricingTemplateXlsx(rfxId: string): Promise<Buffer> {
  const src = await loadPacketSource(rfxId);

  // Sheet 1 — the pricing sheet. Items pre-filled, price columns blank.
  const rows: (string | number)[][] = [];
  rows.push([`REQUEST FOR QUOTATION — ${src.name}`]);
  rows.push([`Category: ${src.category}`, "", `Quote in: ${src.currency}`, "", `Required by: ${formatDate(src.requiredByDate)}`]);
  rows.push([]);
  rows.push(["Supplier name:", "", "", "Contact person:", "", "Email:", ""]);
  rows.push(["Quote valid until:", "", "", "Lead time (days):", "", "Payment terms:", ""]);
  rows.push([
    "Freight:",
    "(included / separate / excluded)",
    "",
    "Taxes:",
    "(included / separate)",
    "",
    "",
  ]);
  rows.push([]);
  rows.push([
    "Item #",
    "Item",
    "Specification",
    "Quantity",
    "Unit",
    `Unit Price (${src.currency})`,
    "Price Basis",
    "MOQ",
    "Lead Time (days)",
    "Remarks / Not Quoted",
  ]);
  for (const li of src.lineItems) {
    rows.push([li.id, li.name, li.specification, li.quantity, li.unit, "", "per unit", "", "", ""]);
  }
  rows.push([]);
  rows.push(["Leave a price blank and write “not quoted” in Remarks if you cannot supply that item."]);
  rows.push(["Do not delete rows — a missing row is read as no response for that item."]);

  const pricing = XLSX.utils.aoa_to_sheet(rows);
  pricing["!cols"] = [
    { wch: 8 }, { wch: 34 }, { wch: 22 }, { wch: 10 }, { wch: 8 },
    { wch: 18 }, { wch: 14 }, { wch: 10 }, { wch: 16 }, { wch: 26 },
  ];

  // Sheet 2 — the questionnaire, same ten questions the pipeline scores against.
  const qRows: string[][] = [];
  qRows.push(["SUPPLIER QUESTIONNAIRE"]);
  qRows.push(["Answer every question. A blank answer is treated as unresolved, not as a yes."]);
  qRows.push([]);
  qRows.push(["Q#", "Question", "Your answer"]);
  for (const q of QUESTIONNAIRE_QUESTIONS) qRows.push([String(q.id), q.text, ""]);
  const questionnaire = XLSX.utils.aoa_to_sheet(qRows);
  questionnaire["!cols"] = [{ wch: 6 }, { wch: 62 }, { wch: 44 }];

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, pricing, "Pricing");
  XLSX.utils.book_append_sheet(wb, questionnaire, "Questionnaire");

  return XLSX.write(wb, { type: "buffer", bookType: "xlsx" }) as Buffer;
}

export function packetFileNames(rfxName: string): { pdf: string; xlsx: string } {
  const slug = rfxName.replace(/[^a-zA-Z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 60);
  return { pdf: `RFQ-${slug}.pdf`, xlsx: `Pricing-Template-${slug}.xlsx` };
}
