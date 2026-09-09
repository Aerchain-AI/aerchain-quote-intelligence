import fs from "node:fs/promises";
import path from "node:path";
import { Router } from "express";
import { prisma } from "../db.js";
import { VENDOR_DOCS_DIR } from "../paths.js";
import { runPipelineForVendor } from "../pipeline/runPipeline.js";

export const vendorsRouter = Router();

vendorsRouter.get("/vendors", async (_req, res) => {
  try {
    const suppliers = await prisma.supplier.findMany({
      orderBy: { name: "asc" },
    });
    if (suppliers.length > 0) {
      return res.json(
        suppliers.map((s) => ({
          id: s.id,
          name: s.name,
          format: s.category || "Excel / PDF",
          qualityScore: s.qualityScore ? `${Math.round(s.qualityScore * 100)}%` : "100%",
          status: s.qualityScore && s.qualityScore > 0.8 ? "Qualified" : "Requires Review",
          categories: s.category,
        })),
      );
    }

    const vendors = await prisma.vendor.findMany({
      orderBy: { name: "asc" },
    });
    const formatMap: Record<string, string> = {
      xlsx: "Excel (.xlsx)",
      pdf: "PDF (.pdf)",
      docx: "Word (.docx)",
      jpg: "Photo/JPG (.jpg)",
      txt: "Email Text (.txt)",
    };
    res.json(
      vendors.map((v) => ({
        id: v.id,
        name: v.name,
        format: formatMap[v.responseFormat] || v.responseFormat,
        qualityScore: v.overallConfidence ? `${Math.round(v.overallConfidence * 100)}%` : "100%",
        status: v.status === "processed" || v.status === "completed" || v.status === "pending" ? "Qualified" : "Requires Review",
        categories: "Corrugated Packaging",
      })),
    );
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

// PRD §13 — Screen 2 vendor response status list.
vendorsRouter.get("/rfx/:id/vendors", async (req, res) => {
  const vendors = await prisma.vendor.findMany({
    where: { rfxId: req.params.id },
    orderBy: { name: "asc" },
  });
  res.json(
    vendors.map((v) => ({
      id: v.id,
      name: v.name,
      responseFormat: v.responseFormat,
      status: v.status,
      itemsFoundCount: v.itemsFoundCount,
      itemsMissingCount: v.itemsMissingCount,
      overallConfidence: v.overallConfidence,
      processedAt: v.processedAt,
    })),
  );
});

// Create a new vendor from uploaded file or pasted text
vendorsRouter.post("/rfx/:id/vendors", async (req, res) => {
  const { name, responseFormat, textContent, fileBase64 } = req.body;
  
  if (!name || !responseFormat) {
    return res.status(400).json({ error: "name and responseFormat are required" });
  }
  // A response has to be attributable to a supplier. Placeholder names like
  // "Vendor" or a screenshot filename make the comparison unreadable and put
  // nonsense into the award recommendation, so they are rejected at the door.
  const trimmedName = String(name).trim();
  const PLACEHOLDER = /^(vendor|supplier|untitled|document|file|new vendor)$/i;
  if (trimmedName.length < 2 || PLACEHOLDER.test(trimmedName)) {
    return res.status(400).json({
      error: `"${trimmedName}" is not a usable supplier name. Enter the supplier's actual name — it labels their column in the comparison and appears in the award recommendation.`,
    });
  }

  // We rely on Prisma to generate the ID, so we create the record first to get the ID,
  // or generate one manually. Let's create the record first with a temp path, then update it.
  const tempVendor = await prisma.vendor.create({
    data: {
      rfxId: req.params.id,
      name: trimmedName,
      responseFormat: String(responseFormat),
      filePath: "", // placeholder
      status: "pending",
    },
  });

  const ext = responseFormat === "txt" ? "txt" : responseFormat;
  const filename = `vendor-${tempVendor.id}.${ext}`;
  const filePath = path.join(VENDOR_DOCS_DIR, filename);

  try {
    if (textContent) {
      await fs.writeFile(filePath, String(textContent), "utf8");
    } else if (fileBase64) {
      const buffer = Buffer.from(fileBase64, "base64");
      await fs.writeFile(filePath, buffer);
    } else {
      throw new Error("Either textContent or fileBase64 is required");
    }

    const vendor = await prisma.vendor.update({
      where: { id: tempVendor.id },
      data: { filePath },
    });

    res.status(201).json(vendor);
  } catch (err) {
    // Rollback DB record if file write fails
    await prisma.vendor.delete({ where: { id: tempVendor.id } }).catch(() => {});
    res.status(500).json({ error: "Failed to save vendor document", detail: (err as Error).message });
  }
});

// Triggers the staged extraction pipeline for one vendor. Kept synchronous for
// this prototype (a single LLM call per vendor) — PRD §9's fault-isolation intent
// is honored by scoping failures to this one vendor, never to the whole RFx.
vendorsRouter.post("/rfx/:id/vendors/:vendorId/process", async (req, res) => {
  try {
    const summary = await runPipelineForVendor(req.params.vendorId);
    res.json(summary);
  } catch (err) {
    // Extraction runs before anything is deleted, so a failed re-process leaves the
    // vendor's previous results intact. Only mark the vendor failed if there is
    // genuinely nothing there — otherwise the UI would show "Failed" over data that
    // is still perfectly good.
    const existingQuotes = await prisma.vendorQuote.count({ where: { vendorId: req.params.vendorId } });
    if (existingQuotes === 0) {
      await prisma.vendor.update({ where: { id: req.params.vendorId }, data: { status: "failed" } }).catch(() => {});
    } else {
      await prisma.vendor
        .update({ where: { id: req.params.vendorId }, data: { status: "review_required" } })
        .catch(() => {});
    }
    res.status(502).json({
      error: "Extraction pipeline failed",
      detail: (err as Error).message,
      previousResultsRetained: existingQuotes > 0,
    });
  }
});

// PRD §14 — Screen 3 extraction & validation detail for one vendor.
vendorsRouter.get("/vendors/:vendorId/extraction", async (req, res) => {
  const vendor = await prisma.vendor.findUnique({ where: { id: req.params.vendorId } });
  if (!vendor) return res.status(404).json({ error: "Vendor not found" });

  const [quotes, exceptions, questionnaire] = await Promise.all([
    prisma.vendorQuote.findMany({ where: { vendorId: vendor.id }, orderBy: { lineItemId: "asc" }, include: { lineItem: true } }),
    prisma.quoteException.findMany({ where: { vendorId: vendor.id } }),
    prisma.questionnaireResponse.findMany({ where: { vendorId: vendor.id }, orderBy: { questionId: "asc" } }),
  ]);

  res.json({ vendor, quotes, exceptions, questionnaire });
});

// PRD §30 — Human-in-the-loop review.
vendorsRouter.patch("/rfx/:id/vendors/:vendorId/quotes/:quoteId", async (req, res) => {
  const { quoteId, vendorId } = req.params;
  const { status, value, currency, unit } = req.body;

  const quote = await prisma.vendorQuote.findUnique({
    where: { id: quoteId },
    include: { lineItem: true },
  });

  if (!quote || quote.vendorId !== vendorId) {
    return res.status(404).json({ error: "Quote not found" });
  }

  // Calculate new evaluatedValue if value changed
  let evaluatedValue = quote.evaluatedValue;
  if (value !== undefined) {
    const freight = quote.freightJson ? JSON.parse(quote.freightJson) : null;
    const tax = quote.taxJson ? JSON.parse(quote.taxJson) : null;
    const discount = quote.discountJson ? JSON.parse(quote.discountJson) : null;

    let evalBase = Number(value);
    
    // Applying the same logic as normalizeQuote (simplified)
    const isPercent = (adj: any) => adj?.unit?.includes("%");
    const matchesRfxUnit = (adj: any, rfxUnit: string) => {
       const UNIT_WORDS: Record<string, string[]> = {
         pcs: ["piece", "pieces", "pc", "pcs", "unit", "units"],
         sheets: ["sheet", "sheets"],
         rolls: ["roll", "rolls"],
         kg: ["kg", "kgs", "kilogram", "kilograms"],
       };
       const words = UNIT_WORDS[rfxUnit] ?? [];
       return words.some((w) => adj.unit.toLowerCase().includes(w));
    };

    if (freight && !isPercent(freight) && matchesRfxUnit(freight, quote.lineItem.unit)) {
      evalBase += freight.amount;
    }
    if (tax) {
      evalBase += isPercent(tax) ? evalBase * (tax.amount / 100) : matchesRfxUnit(tax, quote.lineItem.unit) ? tax.amount : 0;
    }
    if (discount) {
      evalBase -= isPercent(discount) ? evalBase * (discount.amount / 100) : matchesRfxUnit(discount, quote.lineItem.unit) ? discount.amount : 0;
    }

    evaluatedValue = Math.round(evalBase * 100) / 100;
  }

  const updated = await prisma.$transaction(async (tx) => {
    // Delete any exceptions for this line item since it's now verified
    await tx.quoteException.deleteMany({
      where: { vendorId, lineItemId: quote.lineItemId },
    });

    return await tx.vendorQuote.update({
      where: { id: quoteId },
      data: {
        status: status || quote.status,
        normalizedValue: value !== undefined ? Number(value) : quote.normalizedValue,
        normalizedCurrency: currency !== undefined ? currency : quote.normalizedCurrency,
        normalizedUnit: unit !== undefined ? unit : quote.normalizedUnit,
        evaluatedValue: evaluatedValue,
      },
    });
  });

  res.json(updated);
});

// PRD §40 - Source Traceability (Document Viewer endpoint)
vendorsRouter.get("/vendors/:vendorId/file", async (req, res) => {
  try {
    const vendor = await prisma.vendor.findUnique({
      where: { id: req.params.vendorId },
    });
    
    if (!vendor || !vendor.filePath) {
      return res.status(404).json({ error: "Document not found" });
    }

    // Attempt to stat the file to see if it exists on disk
    await fs.stat(vendor.filePath);
    res.sendFile(vendor.filePath);
  } catch (err) {
    res.status(404).json({ error: "Document file not found on disk" });
  }
});

/**
 * Removes a vendor response from an event.
 *
 * Ingestion is a real workflow step, so undoing it has to be one too — a
 * mis-uploaded document otherwise sits in the comparison forever, dragging the
 * award recommendation along with it. Deletes the quotes, exceptions and
 * questionnaire that were derived from it, since they have no meaning without
 * the response they came from.
 */
vendorsRouter.delete("/rfx/:id/vendors/:vendorId", async (req, res) => {
  const { vendorId } = req.params;
  const vendor = await prisma.vendor.findUnique({ where: { id: vendorId } });
  if (!vendor) return res.status(404).json({ error: "Vendor response not found" });

  await prisma.$transaction(async (tx) => {
    await tx.vendorQuote.deleteMany({ where: { vendorId } });
    await tx.quoteException.deleteMany({ where: { vendorId } });
    await tx.questionnaireResponse.deleteMany({ where: { vendorId } });
    await tx.vendor.delete({ where: { id: vendorId } });
  });

  res.json({ deleted: vendorId, name: vendor.name });
});
