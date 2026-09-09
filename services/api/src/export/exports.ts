import PDFDocument from "pdfkit";
import * as XLSX from "xlsx";
import { buildAwardRecommendation } from "../award/recommend.js";
import { loadComparisonDataset } from "../calc/dataset.js";
import { explainFigure } from "../calc/derivation.js";
import { cheapestPerLine, getQuote, resolveEligibleVendors } from "../calc/engine.js";

/**
 * Taking the analysis out of the app.
 *
 * A buyer does not award from a browser tab. The comparison goes to a category
 * manager, the recommendation goes into an approval pack, and both get read by
 * someone who was not in the room. So the exports carry the same things the
 * screen does: what each number is, where it came from, and what it excludes.
 *
 * The spreadsheet in particular is not a screenshot of the grid. It carries the
 * source value beside the evaluated one, so a reviewer can see that ₹43.42 was
 * $0.52 before conversion, and a separate sheet lists every exception. Handing
 * someone a clean grid with the caveats stripped out would undo the point of the
 * whole product.
 */

function inr(value: number | null | undefined): string {
  if (value == null) return "";
  return value.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

// --------------------------------------------------------------- spreadsheet

export async function buildComparisonWorkbook(rfxId: string): Promise<Buffer> {
  const dataset = await loadComparisonDataset(rfxId);
  const { eligibleVendorIds } = resolveEligibleVendors(dataset, { requireQualityPass: true });
  const vendors = dataset.vendors;
  const book = XLSX.utils.book_new();

  // ---- Sheet 1: the comparison, evaluated values only.
  const header = [
    "Item #",
    "Item",
    "Specification",
    "Quantity",
    "Unit",
    ...vendors.map((v) => `${v.name} (INR/unit)`),
  ];
  const rows: (string | number)[][] = [header];

  for (const li of dataset.lineItems) {
    const row: (string | number)[] = [li.id, li.name, li.specification, li.quantity, li.unit];
    for (const v of vendors) {
      const q = getQuote(dataset, v.id, li.id);
      // "Not quoted" as a word, never a blank and never a zero. A blank cell in
      // a spreadsheet becomes a zero the moment anyone sums the column.
      row.push(!q || q.status === "not_quoted" || q.evaluatedValue == null ? "Not quoted" : q.evaluatedValue);
    }
    rows.push(row);
  }

  const totals: (string | number)[] = ["", "Total of priced items", "", "", ""];
  const coverage: (string | number)[] = ["", "Items priced", "", "", ""];
  for (const v of vendors) {
    let total = 0;
    let priced = 0;
    for (const li of dataset.lineItems) {
      const q = getQuote(dataset, v.id, li.id);
      if (q && q.status !== "not_quoted" && q.evaluatedValue != null) {
        total += q.evaluatedValue * li.quantity;
        priced += 1;
      }
    }
    totals.push(Math.round(total * 100) / 100);
    coverage.push(`${priced} of ${dataset.lineItems.length}`);
  }
  rows.push([], totals, coverage);
  rows.push([]);
  rows.push([
    "",
    "Column totals cover only what each vendor priced. They are NOT comparable where coverage differs — see the Basis sheet.",
  ]);

  const comparison = XLSX.utils.aoa_to_sheet(rows);
  comparison["!cols"] = [{ wch: 7 }, { wch: 34 }, { wch: 20 }, { wch: 10 }, { wch: 8 }, ...vendors.map(() => ({ wch: 18 }))];
  XLSX.utils.book_append_sheet(book, comparison, "Comparison");

  // ---- Sheet 2: provenance. What was on the document, before normalisation.
  const provenance: (string | number)[][] = [
    ["Item #", "Item", "Vendor", "As quoted", "Source currency", "Source unit", "Evaluated INR/unit", "Confidence", "Document", "Location"],
  ];
  for (const li of dataset.lineItems) {
    for (const v of vendors) {
      const q = getQuote(dataset, v.id, li.id);
      if (!q) continue;
      provenance.push([
        li.id,
        li.name,
        v.name,
        q.sourceValue ?? "",
        q.sourceCurrency ?? "",
        q.sourceUnit ?? "",
        q.evaluatedValue ?? "Not quoted",
        q.confidence == null ? "" : `${Math.round(q.confidence * 100)}%`,
        q.sourceDocument ?? "",
        q.sourceLocation ?? "",
      ]);
    }
  }
  const provSheet = XLSX.utils.aoa_to_sheet(provenance);
  provSheet["!cols"] = [{ wch: 7 }, { wch: 30 }, { wch: 24 }, { wch: 12 }, { wch: 9 }, { wch: 16 }, { wch: 16 }, { wch: 11 }, { wch: 26 }, { wch: 18 }];
  XLSX.utils.book_append_sheet(book, provSheet, "Provenance");

  // ---- Sheet 3: every exception, so the caveats travel with the numbers.
  const exceptions: (string | number)[][] = [["Severity", "Type", "Vendor", "Item #", "Message"]];
  for (const ex of dataset.exceptions) {
    exceptions.push([
      ex.severity,
      ex.type,
      dataset.vendors.find((v) => v.id === ex.vendorId)?.name ?? "",
      ex.lineItemId ?? "",
      ex.message,
    ]);
  }
  const exSheet = XLSX.utils.aoa_to_sheet(exceptions);
  exSheet["!cols"] = [{ wch: 10 }, { wch: 20 }, { wch: 24 }, { wch: 7 }, { wch: 80 }];
  XLSX.utils.book_append_sheet(book, exSheet, "Exceptions");

  // ---- Sheet 4: the questionnaire, beside the prices where it belongs.
  // Taken from whichever response carries the most answers, not the first one:
  // a vendor whose document answered nothing would otherwise strip the question
  // columns out of the sheet entirely.
  const richest = [...dataset.vendors].sort((a, b) => b.questionnaire.length - a.questionnaire.length)[0];
  const questions = richest?.questionnaire.map((a) => a.questionText) ?? [];
  const quality: (string | number)[][] = [["Vendor", "Quality verdict", ...questions]];
  for (const v of vendors) {
    quality.push([
      v.name,
      v.quality.status,
      // Matched by question, not by position — a vendor who answered only three
      // questions must not have those answers slide under the wrong headings.
      ...questions.map((q) => v.questionnaire.find((a) => a.questionText === q)?.answerText || "Not answered"),
    ]);
  }
  const qSheet = XLSX.utils.aoa_to_sheet(quality);
  qSheet["!cols"] = [{ wch: 26 }, { wch: 14 }, ...questions.map(() => ({ wch: 30 }))];
  XLSX.utils.book_append_sheet(book, qSheet, "Questionnaire");

  // ---- Sheet 5: how to read the rest of it.
  const basis: string[][] = [
    ["How to read this workbook"],
    [],
    ["Every figure was computed by the calculation engine, not generated by a language model."],
    ["A model read the vendor documents; it did no arithmetic that reaches these sheets."],
    [],
    ["Evaluated INR/unit", "Landed per-unit cost after currency conversion, unit normalisation and stated discounts."],
    ["Not quoted", "The vendor did not price this line. It is not zero, and it must not be summed as zero."],
    ["Column totals", `Cover only the items each vendor priced. ${vendors.filter((v) => dataset.lineItems.some((li) => { const q = getQuote(dataset, v.id, li.id); return !q || q.evaluatedValue == null; })).length} vendor(s) have gaps, so their totals are not like-for-like.`],
    ["Ranking", "Vendors are only ranked against each other on the basket they all priced. See the award memo."],
    ["Quality verdict", 'Only an explicit "no" disqualifies. A blank answer is unresolved, and is left for the buyer to settle.'],
    [],
    ["Exchange rate", "USD converted at a fixed reference rate; the rate and its date are on the Provenance sheet per line."],
    ["Quality-qualified vendors", String(eligibleVendorIds.length)],
    ["Exported", new Date().toISOString().slice(0, 19).replace("T", " ")],
    ["Event", dataset.rfxName],
  ];
  const basisSheet = XLSX.utils.aoa_to_sheet(basis);
  basisSheet["!cols"] = [{ wch: 28 }, { wch: 110 }];
  XLSX.utils.book_append_sheet(book, basisSheet, "Basis");

  return XLSX.write(book, { type: "buffer", bookType: "xlsx" }) as Buffer;
}

// ----------------------------------------------------------------- award memo

/**
 * The award memo.
 *
 * This is the document that goes to whoever signs. It states the decision, the
 * basis, the arithmetic behind the saving, and — in its own section, not a
 * footnote — what remains unverified. A recommendation memo that omits its
 * caveats is worse than no memo, because it launders uncertainty into apparent
 * fact on the way to an approver.
 */
export async function buildAwardMemoPdf(rfxId: string): Promise<Buffer> {
  const dataset = await loadComparisonDataset(rfxId);
  const award = buildAwardRecommendation(dataset);
  const savings = explainFigure(dataset, "savings");
  const { lines } = cheapestPerLine(dataset, { requireQualityPass: true });

  const doc = new PDFDocument({ size: "A4", margin: 54 });
  const chunks: Buffer[] = [];
  doc.on("data", (c: Buffer) => chunks.push(c));
  const done = new Promise<Buffer>((resolve) => doc.on("end", () => resolve(Buffer.concat(chunks))));

  const INK = "#1a1917";
  const MUTED = "#57534e";
  const RULE = "#d6d2ca";

  const rule = () => {
    doc.moveDown(0.5).strokeColor(RULE).lineWidth(0.75).moveTo(54, doc.y).lineTo(541, doc.y).stroke().moveDown(0.7);
  };
  const h = (text: string) => doc.fillColor(INK).fontSize(11).font("Helvetica-Bold").text(text).moveDown(0.35);
  const p = (text: string) => doc.fillColor(MUTED).fontSize(9.5).font("Helvetica").text(text, { lineGap: 2.5 }).moveDown(0.4);

  doc.fillColor(MUTED).fontSize(8).font("Helvetica").text("AWARD RECOMMENDATION", { characterSpacing: 1.2 });
  doc.moveDown(0.3).fillColor(INK).fontSize(17).font("Helvetica-Bold").text(dataset.rfxName, { lineGap: 1 });
  doc
    .moveDown(0.25)
    .fillColor(MUTED)
    .fontSize(9)
    .font("Helvetica")
    .text(`${dataset.lineItems.length} line items · ${dataset.vendors.length} responses · prepared ${new Date().toLocaleDateString("en-IN", { day: "numeric", month: "long", year: "numeric" })}`);
  rule();

  h("Recommendation");
  doc.fillColor(INK).fontSize(13).font("Helvetica-Bold").text(
    award.strategy === "split_award" ? "Split award" : award.strategy === "single_vendor" ? "Single vendor" : "Manual review required",
  );
  doc.moveDown(0.3);
  p(award.headline);

  if (award.provisional) {
    doc
      .fillColor("#a16207")
      .fontSize(9.5)
      .font("Helvetica-Bold")
      .text(`PROVISIONAL — ${award.blockingVerifications.length} value(s) require verification before award`)
      .moveDown(0.5);
  }

  if (award.allocations.length > 0) {
    h("Allocation");
    for (const a of award.allocations) {
      doc
        .fillColor(INK)
        .fontSize(9.5)
        .font("Helvetica")
        .text(`${a.vendorName}`, { continued: true })
        .fillColor(MUTED)
        .text(`   ${a.itemCount} line items`, { continued: true })
        .fillColor(INK)
        .font("Helvetica-Bold")
        .text(`   INR ${inr(a.total)}`, { align: "right" });
    }
    doc.moveDown(0.4);
  }

  h("Basis");
  doc.fillColor(INK).fontSize(9.5).font("Helvetica");
  doc.text(`Total evaluated cost:  INR ${inr(award.totalEvaluatedCost)}`);
  if (award.savings != null) {
    doc.text(`Estimated saving:  INR ${inr(award.savings)}  ${award.savingsBaselineLabel ?? ""}`);
  }
  doc.text(`Awarded:  ${award.awardedItemCount} of ${award.totalLineItems} line items`);
  doc.text(`Quality-qualified vendors:  ${award.qualityQualifiedVendorCount} of ${dataset.vendors.length}`);
  doc.moveDown(0.5);

  if (savings && savings.value != null) {
    p(savings.rule);
    doc.fillColor(MUTED).fontSize(9).font("Helvetica-Oblique").text(savings.formula).moveDown(0.3);
    const ok = savings.checks.every((c) => c.ok);
    doc
      .fillColor(ok ? "#047857" : "#c2185b")
      .fontSize(8.5)
      .font("Helvetica")
      .text(
        ok
          ? `Reconciled by ${savings.checks.length} independent checks: ${savings.checks.map((c) => c.label.toLowerCase()).join("; ")}.`
          : `WARNING: ${savings.checks.filter((c) => !c.ok).length} verification check(s) did not reconcile.`,
      )
      .moveDown(0.5);
  }

  rule();
  h("Why");
  for (const e of award.evidence.slice(0, 10)) {
    doc.fillColor(MUTED).fontSize(9).font("Helvetica").text(`•  ${e}`, { lineGap: 2 }).moveDown(0.15);
  }

  doc.addPage();
  h("Verify before awarding");
  p("The system did not resolve the following. A buyer has to.");
  if (award.reviewBeforeAward.length === 0) {
    p("Nothing outstanding was detected.");
  }
  for (const r of award.reviewBeforeAward) {
    doc.fillColor("#a16207").fontSize(9).font("Helvetica").text(`•  ${r}`, { lineGap: 2 }).moveDown(0.15);
  }
  doc.moveDown(0.5);

  rule();
  h("Awarded lines");
  // Absolute column positions rather than `continued`, which places the next
  // string where the previous one ended and ignores the width it was given —
  // that ran the item name into the vendor name on every short row.
  const COL = { item: 54, vendor: 268, unit: 396, total: 462 };
  const W = { item: 208, vendor: 122, unit: 60, total: 79 };
  const ROW = 11;

  const headerRow = (y: number) => {
    doc.fillColor(MUTED).fontSize(7.5).font("Helvetica-Bold");
    doc.text("ITEM", COL.item, y, { width: W.item });
    doc.text("AWARDED TO", COL.vendor, y, { width: W.vendor });
    doc.text("UNIT", COL.unit, y, { width: W.unit, align: "right" });
    doc.text("LINE TOTAL", COL.total, y, { width: W.total, align: "right" });
  };

  headerRow(doc.y);
  let y = doc.y + ROW + 3;

  for (const l of lines) {
    if (y > 748) {
      doc.addPage();
      headerRow(54);
      y = 54 + ROW + 3;
    }
    const name = l.lineItemName.length > 38 ? `${l.lineItemName.slice(0, 37)}…` : l.lineItemName;
    doc.fontSize(8).font("Helvetica");
    if (!l.winnerVendorName) {
      doc.fillColor("#a16207");
      doc.text(`#${l.lineItemId}  ${name}`, COL.item, y, { width: W.item });
      doc.text("No usable price from any qualified vendor", COL.vendor, y, { width: W.vendor + W.unit + W.total, align: "right" });
    } else {
      doc.fillColor(INK);
      doc.text(`#${l.lineItemId}  ${name}`, COL.item, y, { width: W.item, ellipsis: true });
      doc.text(l.winnerVendorName, COL.vendor, y, { width: W.vendor, ellipsis: true });
      doc.text(inr(l.winnerUnitPrice), COL.unit, y, { width: W.unit, align: "right" });
      doc.text(inr(l.winnerLineTotal), COL.total, y, { width: W.total, align: "right" });
    }
    y += ROW;
  }
  doc.y = y;

  doc.moveDown(0.8);
  rule();
  doc
    .fillColor(MUTED)
    .fontSize(7.5)
    .font("Helvetica")
    .text(
      "Every figure in this memo was computed by the deterministic calculation engine from extracted quote data. " +
        "A language model read the vendor documents; it performed no arithmetic that appears here. Unpriced line " +
        "items are excluded from totals rather than valued at zero, and vendors are ranked only on the basket they " +
        "all priced.",
      { lineGap: 2 },
    );

  doc.end();
  return done;
}

export function exportFileNames(rfxName: string): { xlsx: string; pdf: string } {
  const safe = rfxName.replace(/[^\w\s-]/g, "").replace(/\s+/g, "-").slice(0, 60);
  return { xlsx: `${safe}-comparison.xlsx`, pdf: `${safe}-award-memo.pdf` };
}
