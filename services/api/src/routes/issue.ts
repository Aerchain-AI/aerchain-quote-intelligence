import { Router } from "express";
import { prisma } from "../db.js";
import { composeRfxEmail } from "../rfx/rfxEmail.js";
import { buildPricingTemplateXlsx, buildRfqPdf, packetFileNames } from "../rfx/rfxPacket.js";

export const issueRouter = Router();

/**
 * Issuing an RFx to suppliers.
 *
 * No real email is sent — PRD §34 rules out email infrastructure. What is real
 * is the record: which suppliers were invited, on what date, and the exact text
 * they were sent. That record is what the rest of the workflow and the audit
 * trail depend on, so it is stored rather than simulated.
 */

/** The draft email a buyer reviews before sending. */
issueRouter.get("/rfx/:id/email-preview", async (req, res) => {
  try {
    res.json(await composeRfxEmail(req.params.id));
  } catch (err) {
    res.status(404).json({ error: "Could not compose an email for this event.", detail: (err as Error).message });
  }
});

/**
 * The two attachments that go out with the invitation. Generated on demand from
 * the stored event so they can never drift from what the RFx actually says.
 */
issueRouter.get("/rfx/:id/packet/rfq.pdf", async (req, res) => {
  try {
    const rfx = await prisma.rfx.findUniqueOrThrow({ where: { id: req.params.id }, select: { name: true } });
    const pdf = await buildRfqPdf(req.params.id);
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `inline; filename="${packetFileNames(rfx.name).pdf}"`);
    res.send(pdf);
  } catch (err) {
    res.status(404).json({ error: "Could not build the RFQ document.", detail: (err as Error).message });
  }
});

issueRouter.get("/rfx/:id/packet/pricing-template.xlsx", async (req, res) => {
  try {
    const rfx = await prisma.rfx.findUniqueOrThrow({ where: { id: req.params.id }, select: { name: true } });
    const xlsx = await buildPricingTemplateXlsx(req.params.id);
    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    res.setHeader("Content-Disposition", `attachment; filename="${packetFileNames(rfx.name).xlsx}"`);
    res.send(xlsx);
  } catch (err) {
    res.status(404).json({ error: "Could not build the pricing template.", detail: (err as Error).message });
  }
});

/**
 * Suppliers worth inviting for this event's category, with the record that
 * justifies picking one over another.
 */
issueRouter.get("/rfx/:id/suppliers", async (req, res) => {
  const rfx = await prisma.rfx.findUnique({ where: { id: req.params.id } });
  if (!rfx) return res.status(404).json({ error: "RFx not found" });

  const [inCategory, alreadyInvited] = await Promise.all([
    prisma.supplier.findMany({ where: { category: rfx.category }, orderBy: { name: "asc" } }),
    prisma.rfxInvitation.findMany({ where: { rfxId: rfx.id }, select: { supplierId: true } }),
  ]);
  const invitedIds = new Set(alreadyInvited.map((i) => i.supplierId));

  // Sort by track record, so the strongest candidates surface first — but the
  // numbers are shown so the buyer can disagree.
  const scored = inCategory
    .map((s) => {
      const quoteRate = s.eventsInvited > 0 ? s.eventsQuoted / s.eventsInvited : null;
      const winRate = s.eventsQuoted > 0 ? s.eventsAwarded / s.eventsQuoted : null;
      return {
        ...s,
        quoteRate,
        winRate,
        alreadyInvited: invitedIds.has(s.id),
        // A blend of responsiveness, delivery and quality. Only used for ordering.
        rank: (s.qualityScore ?? 0) * 0.5 + ((s.onTimeDeliveryPct ?? 0) / 100) * 0.3 + (quoteRate ?? 0) * 0.2,
      };
    })
    .sort((a, b) => b.rank - a.rank);

  res.json({
    category: rfx.category,
    suppliers: scored,
    note:
      scored.length === 0
        ? `No suppliers are on record for "${rfx.category}". Add one by email below.`
        : `${scored.length} supplier(s) previously engaged in ${rfx.category}.`,
  });
});

/**
 * Issues the RFx: records an invitation per supplier, creates any ad-hoc
 * suppliers, stamps the event as issued and writes the timeline entry.
 */
issueRouter.post("/rfx/:id/issue", async (req, res) => {
  const rfx = await prisma.rfx.findUnique({ where: { id: req.params.id }, include: { buyer: true } });
  if (!rfx) return res.status(404).json({ error: "RFx not found" });
  if (rfx.status !== "draft") {
    return res.status(409).json({ error: `This event is already "${rfx.status}" — it cannot be issued again.` });
  }

  const supplierIds: string[] = Array.isArray(req.body?.supplierIds) ? req.body.supplierIds : [];
  const newEmails: string[] = Array.isArray(req.body?.newEmails) ? req.body.newEmails : [];
  const subject = String(req.body?.subject ?? "").trim();
  const body = String(req.body?.body ?? "").trim();

  if (supplierIds.length === 0 && newEmails.length === 0) {
    return res.status(400).json({ error: "Select at least one supplier, or add one by email." });
  }
  if (!subject || !body) {
    return res.status(400).json({ error: "The email needs both a subject and a body." });
  }

  // Ad-hoc suppliers join the registry with no history — flagged as new rather
  // than showing zeros that would read as a bad track record.
  const adHoc = [];
  for (const rawEmail of newEmails) {
    const email = String(rawEmail).trim().toLowerCase();
    if (!email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) continue;
    const supplier = await prisma.supplier.upsert({
      where: { email },
      create: {
        email,
        name: email.split("@")[0].replace(/[._-]+/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()),
        category: rfx.category,
        isNew: true,
      },
      update: {},
    });
    adHoc.push(supplier);
  }

  const allSupplierIds = [...new Set([...supplierIds, ...adHoc.map((s) => s.id)])];
  const suppliers = await prisma.supplier.findMany({ where: { id: { in: allSupplierIds } } });
  if (suppliers.length === 0) {
    return res.status(400).json({ error: "None of the selected suppliers could be resolved." });
  }

  const issuedAt = new Date();
  await prisma.$transaction(async (tx) => {
    for (const s of suppliers) {
      await tx.rfxInvitation.upsert({
        where: { rfxId_supplierId: { rfxId: rfx.id, supplierId: s.id } },
        create: { rfxId: rfx.id, supplierId: s.id, email: s.email, emailSubject: subject, emailBody: body, sentAt: issuedAt },
        update: { emailSubject: subject, emailBody: body, sentAt: issuedAt },
      });
      await tx.supplier.update({
        where: { id: s.id },
        data: { eventsInvited: { increment: 1 }, lastEngagedAt: issuedAt },
      });
    }

    await tx.rfx.update({
      where: { id: rfx.id },
      data: { status: "active", issuedAt },
    });

    await tx.rfxEvent.create({
      data: {
        rfxId: rfx.id,
        type: "issued",
        title: `Issued to ${suppliers.length} supplier(s)`,
        detail: suppliers.map((s) => s.name).join(", "),
        actor: rfx.buyer?.name ?? null,
        occurredAt: issuedAt,
      },
    });
  });

  res.status(201).json({
    issuedAt: issuedAt.toISOString(),
    invited: suppliers.map((s) => ({ id: s.id, name: s.name, email: s.email, isNew: s.isNew })),
    status: "active",
  });
});

/** Who this event was issued to, for the overview once it is no longer a draft. */
issueRouter.get("/rfx/:id/invitations", async (req, res) => {
  const invitations = await prisma.rfxInvitation.findMany({
    where: { rfxId: req.params.id },
    include: { supplier: true },
    orderBy: { sentAt: "asc" },
  });
  res.json(invitations);
});
