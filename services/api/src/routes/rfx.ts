import { Router } from "express";
import { prisma } from "../db.js";
import { clarifyRfxRequest } from "../llm/rfxClarify.js";
import { draftRfx, type ClarificationAnswer } from "../llm/rfxDraft.js";
import { findSimilarRfx } from "../rfx/similar.js";
import { buildTimeline } from "../rfx/timeline.js";

export const rfxRouter = Router();

rfxRouter.get("/rfx", async (req, res) => {
  // The live event is the one with vendor responses; history is everything else.
  const rfxs = await prisma.rfx.findMany({
    orderBy: { createdAt: "desc" },
    include: { buyer: true, _count: { select: { lineItems: true, vendors: true } } },
  });
  const onlyActive = req.query.scope === "active";
  res.json(onlyActive ? rfxs.filter((r) => r._count.vendors > 0) : rfxs);
});

rfxRouter.get("/buyers", async (_req, res) => {
  res.json(await prisma.buyer.findMany({ orderBy: { name: "asc" } }));
});

rfxRouter.get("/approvals", async (_req, res) => {
  try {
    const rfxs = await prisma.rfx.findMany({
      include: { buyer: true, vendors: true },
      orderBy: { createdAt: "desc" },
    });

    const approvals = rfxs.map((r, idx) => ({
      id: `APP-${100 + idx}`,
      prx: r.name,
      buyer: r.buyer ? `${r.buyer.name} (${r.buyer.team})` : "Prem Kumar (Packaging Team)",
      value: "₹42,50,000",
      vendor: r.vendors.length > 0 ? r.vendors[0].name : "Vendor C (Split award with Vendor A)",
      status: r.status === "awarded" ? "Approved" : "Pending Sign-off",
      date: new Date(r.createdAt).toISOString().split("T")[0],
    }));

    res.json(approvals);
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

// Precedent lookup — deterministic, no model call.
rfxRouter.get("/rfx-similar", async (req, res) => {
  const request = String(req.query.q ?? "").trim();
  if (!request) return res.json([]);
  res.json(await findSimilarRfx(request));
});

// Stage 1 of creation: ask before drafting. Returns the questions AND any past
// events resembling the request, so the buyer sees precedent at the same moment.
rfxRouter.post("/rfx/clarify", async (req, res) => {
  const description = String(req.body?.description ?? "").trim();
  if (!description) return res.status(400).json({ error: "A description is required." });
  try {
    const [clarification, similar] = await Promise.all([
      clarifyRfxRequest(description),
      findSimilarRfx(description),
    ]);
    res.json({ ...clarification, similar });
  } catch (err) {
    // Precedent still works without the model, so return it rather than nothing.
    const similar = await findSimilarRfx(description).catch(() => []);
    res.status(502).json({ error: "Could not prepare clarifying questions.", detail: (err as Error).message, similar });
  }
});

rfxRouter.get("/rfx/:id", async (req, res) => {
  const rfx = await prisma.rfx.findUnique({
    where: { id: req.params.id },
    include: {
      lineItems: { orderBy: { id: "asc" } },
      buyer: true,
      _count: { select: { lineItems: true, vendors: true } },
    },
  });
  if (!rfx) return res.status(404).json({ error: "RFx not found" });

  const [timeline, vendors] = await Promise.all([
    buildTimeline(rfx.id),
    prisma.vendor.findMany({
      where: { rfxId: rfx.id },
      orderBy: { name: "asc" },
      select: {
        id: true,
        name: true,
        responseFormat: true,
        status: true,
        itemsFoundCount: true,
        itemsMissingCount: true,
        overallConfidence: true,
      },
    }),
  ]);

  let clarifications: unknown = null;
  if (rfx.clarificationsJson) {
    try {
      clarifications = JSON.parse(rfx.clarificationsJson);
    } catch {
      clarifications = null;
    }
  }
  res.json({ ...rfx, timeline, vendors, clarifications });
});

/** Distinct values for the list filters — computed from what actually exists. */
rfxRouter.get("/rfx-facets", async (_req, res) => {
  const rfxs = await prisma.rfx.findMany({ include: { buyer: true } });
  const years = [...new Set(rfxs.map((r) => new Date(r.createdAt).getFullYear()))].sort((a, b) => b - a);
  const categories = [...new Set(rfxs.map((r) => r.category))].filter(Boolean).sort();
  const statuses = [...new Set(rfxs.map((r) => r.status))].sort();
  const buyers = [...new Map(rfxs.filter((r) => r.buyer).map((r) => [r.buyer!.id, r.buyer!])).values()].sort((a, b) =>
    a.name.localeCompare(b.name),
  );
  res.json({ years, categories, statuses, buyers });
});

/** Edits a draft. Only drafts are editable — an issued or awarded event is a
 * record of what happened and must not be rewritten after the fact. */
rfxRouter.patch("/rfx/:id", async (req, res) => {
  const existing = await prisma.rfx.findUnique({ where: { id: req.params.id } });
  if (!existing) return res.status(404).json({ error: "RFx not found" });
  if (existing.status !== "draft") {
    return res.status(409).json({
      error: `This event is "${existing.status}", not a draft. Issued and awarded events are a record of what happened and cannot be edited.`,
    });
  }

  const { name, category, description, requiredByDate, currency, lineItems } = req.body ?? {};
  await prisma.rfx.update({
    where: { id: existing.id },
    data: {
      name: name != null ? String(name) : undefined,
      category: category != null ? String(category) : undefined,
      description: description != null ? String(description) : undefined,
      currency: currency != null ? String(currency) : undefined,
      requiredByDate: requiredByDate ? new Date(requiredByDate) : undefined,
    },
  });

  if (Array.isArray(lineItems)) {
    // Replace the set wholesale — simpler and safer than diffing, and a draft has
    // no downstream quotes that could be orphaned.
    await prisma.lineItem.deleteMany({ where: { rfxId: existing.id } });
    const maxExisting = await prisma.lineItem.aggregate({ _max: { id: true } });
    let nextId = (maxExisting._max.id ?? 0) + 1;
    for (const li of lineItems) {
      await prisma.lineItem.create({
        data: {
          id: nextId++,
          rfxId: existing.id,
          name: String(li.name ?? ""),
          specification: String(li.specification ?? ""),
          quantity: Number(li.quantity) || 0,
          unit: String(li.unit ?? "pcs"),
        },
      });
    }
  }

  const updated = await prisma.rfx.findUnique({
    where: { id: existing.id },
    include: { lineItems: { orderBy: { id: "asc" } }, buyer: true },
  });
  res.json(updated);
});

// PRD §12 — AI-assisted draft. Returns a proposal for the buyer to review;
// it does not create anything.
rfxRouter.post("/rfx/draft", async (req, res) => {
  const description = String(req.body?.description ?? "").trim();
  if (!description) return res.status(400).json({ error: "A description is required." });
  try {
    const answers: ClarificationAnswer[] = Array.isArray(req.body?.answers) ? req.body.answers : [];
    const draft = await draftRfx(description, Number(req.body?.itemCountHint) || undefined, answers);
    res.json(draft);
  } catch (err) {
    res.status(502).json({ error: "Could not draft an RFx.", detail: (err as Error).message });
  }
});

// Creates an RFx from a (possibly AI-drafted, buyer-edited) payload.
rfxRouter.post("/rfx", async (req, res) => {
  const { name, category, description, requiredByDate, currency, lineItems, buyerId, sourceRequest, clarifications } =
    req.body ?? {};
  if (!name || !Array.isArray(lineItems) || lineItems.length === 0) {
    return res.status(400).json({ error: "name and at least one line item are required." });
  }
  if (!buyerId) {
    return res.status(400).json({ error: "buyerId is required — every RFx records who raised it." });
  }
  const buyer = await prisma.buyer.findUnique({ where: { id: String(buyerId) } });
  if (!buyer) return res.status(400).json({ error: "Unknown buyer." });

  const rfx = await prisma.rfx.create({
    data: {
      name: String(name),
      category: String(category ?? ""),
      description: String(description ?? ""),
      requiredByDate: requiredByDate ? new Date(requiredByDate) : new Date(),
      currency: String(currency ?? "INR"),
      status: "draft",
      buyerId: buyer.id,
      sourceRequest: sourceRequest ? String(sourceRequest) : null,
      clarificationsJson: clarifications ? JSON.stringify(clarifications) : null,
    },
  });
  // Line item ids are the buyer-facing item numbers, unique per RFx in this prototype.
  const maxExisting = await prisma.lineItem.aggregate({ _max: { id: true } });
  let nextId = (maxExisting._max.id ?? 0) + 1;
  for (const li of lineItems) {
    await prisma.lineItem.create({
      data: {
        id: nextId++,
        rfxId: rfx.id,
        name: String(li.name),
        specification: String(li.specification ?? ""),
        quantity: Number(li.quantity) || 0,
        unit: String(li.unit ?? "pcs"),
      },
    });
  }
  const created = await prisma.rfx.findUnique({
    where: { id: rfx.id },
    include: { lineItems: { orderBy: { id: "asc" } }, buyer: true },
  });
  res.status(201).json(created);
});

// Deletes a draft or pending RFx and associated records from the database
rfxRouter.delete("/rfx/:id", async (req, res) => {
  const existing = await prisma.rfx.findUnique({ where: { id: req.params.id } });
  if (!existing) return res.status(404).json({ error: "RFx not found" });

  await prisma.$transaction([
    prisma.quoteException.deleteMany({ where: { vendor: { rfxId: existing.id } } }),
    prisma.vendorQuote.deleteMany({ where: { vendor: { rfxId: existing.id } } }),
    prisma.questionnaireResponse.deleteMany({ where: { vendor: { rfxId: existing.id } } }),
    prisma.vendor.deleteMany({ where: { rfxId: existing.id } }),
    prisma.lineItem.deleteMany({ where: { rfxId: existing.id } }),
    prisma.rfxEvent.deleteMany({ where: { rfxId: existing.id } }),
    prisma.rfx.delete({ where: { id: existing.id } }),
  ]);

  res.json({ success: true, deletedId: existing.id });
});

