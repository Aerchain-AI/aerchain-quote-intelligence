import { Router } from "express";
import { prisma } from "../db.js";

export const comparisonRouter = Router();

// PRD §16 — Screen 4 comparison workspace: every RFx line item against every vendor.
comparisonRouter.get("/rfx/:id/comparison", async (req, res) => {
  const rfxId = req.params.id;
  const [lineItems, vendors, quotes, exceptions] = await Promise.all([
    prisma.lineItem.findMany({ where: { rfxId }, orderBy: { id: "asc" } }),
    prisma.vendor.findMany({ where: { rfxId }, orderBy: { name: "asc" } }),
    prisma.vendorQuote.findMany({ where: { vendor: { rfxId } } }),
    prisma.quoteException.findMany({ where: { vendor: { rfxId } } }),
  ]);

  const quoteKey = (vendorId: string, lineItemId: number) => `${vendorId}:${lineItemId}`;
  const quoteMap = new Map(quotes.map((q) => [quoteKey(q.vendorId, q.lineItemId), q]));

  const exceptionsByLine = new Map<string, typeof exceptions>();
  for (const ex of exceptions) {
    if (ex.lineItemId == null) continue;
    const key = quoteKey(ex.vendorId, ex.lineItemId);
    if (!exceptionsByLine.has(key)) exceptionsByLine.set(key, []);
    exceptionsByLine.get(key)!.push(ex);
  }

  const rows = lineItems.map((li) => ({
    lineItem: li,
    cells: vendors.map((v) => {
      const q = quoteMap.get(quoteKey(v.id, li.id));
      return {
        vendorId: v.id,
        vendorName: v.name,
        quote: q ?? null,
        exceptions: exceptionsByLine.get(quoteKey(v.id, li.id)) ?? [],
      };
    }),
  }));

  const vendorLevelExceptions = exceptions.filter((e) => e.lineItemId == null);

  res.json({ vendors, rows, vendorLevelExceptions });
});
