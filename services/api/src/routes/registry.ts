import { Router } from "express";
import { prisma } from "../db.js";

export const registryRouter = Router();

/**
 * The supplier registry and the procurement that happened before this system.
 *
 * The history is kept apart from the events this system ran, and it is labelled
 * that way everywhere it appears. Its award values and savings arrived as a
 * record; nothing here computed them and nothing here can show its working for
 * them. Letting them sit in the same list as a figure with a derivation behind
 * it would make the derivation meaningless, because a reader could no longer
 * tell which numbers had one.
 */

/** Every supplier on the master, with registration status and track record. */
registryRouter.get("/suppliers", async (_req, res) => {
  const suppliers = await prisma.supplier.findMany({
    orderBy: { name: "asc" },
    include: {
      participation: { include: { procurement: true } },
      invitations: { include: { rfx: { select: { id: true, name: true, status: true } } } },
    },
  });

  res.json(
    suppliers.map((s) => {
      const awarded = s.participation.filter((p) => p.result === "awarded");
      return {
        id: s.id,
        name: s.name,
        email: s.email,
        category: s.category,
        city: s.city,
        gstin: s.gstin,
        verificationStatus: s.verificationStatus,
        verificationNote: s.verificationNote,
        paymentTerms: s.paymentTerms,
        pastWork: s.pastWork,
        onTimeDeliveryPct: s.onTimeDeliveryPct,
        qualityScore: s.qualityScore,
        // Counted from the records held, not carried as an assertion.
        historyCount: s.participation.length,
        awardedCount: awarded.length,
        qualityIncidents: s.participation.reduce((sum, p) => sum + p.qualityIncidents, 0),
        recordedAwardValue: awarded.reduce((sum, p) => sum + p.procurement.awardValueInr, 0),
        history: s.participation
          .map((p) => ({
            externalId: p.procurement.externalId,
            title: p.procurement.title,
            category: p.procurement.category,
            completedAt: p.procurement.completedAt,
            result: p.result,
            performance: p.performance,
            qualityIncidents: p.qualityIncidents,
            awardValueInr: p.result === "awarded" ? p.procurement.awardValueInr : null,
          }))
          .sort((a, b) => b.completedAt.getTime() - a.completedAt.getTime()),
        // Events this system is running that they were invited to.
        currentInvitations: s.invitations.map((i) => ({
          rfxId: i.rfx.id,
          rfxName: i.rfx.name,
          status: i.status,
          respondedAt: i.respondedAt,
        })),
      };
    }),
  );
});

/** Procurement completed before this system existed. */
registryRouter.get("/procurement-history", async (_req, res) => {
  const records = await prisma.pastProcurement.findMany({
    orderBy: { completedAt: "desc" },
    include: { participation: { include: { supplier: { select: { id: true, name: true } } } } },
  });

  const recordedSavings = records.reduce((sum, r) => sum + (r.savingsInr ?? 0), 0);
  const recordedValue = records.reduce((sum, r) => sum + r.awardValueInr, 0);

  res.json({
    // Stated on the payload, not only in the UI, so an export or an API consumer
    // cannot pick these numbers up without the caveat attached.
    basis:
      "Imported historical records. These award values and savings were supplied with the dataset, not computed by this system, and no derivation can be shown for them.",
    recordedValue,
    recordedSavings,
    records: records.map((r) => ({
      id: r.id,
      externalId: r.externalId,
      title: r.title,
      category: r.category,
      completedAt: r.completedAt,
      awardedVendorName: r.awardedVendorName,
      awardedSupplierId: r.awardedSupplierId,
      awardValueInr: r.awardValueInr,
      baselineInr: r.baselineInr,
      savingsInr: r.savingsInr,
      savingsPct: r.savingsPct,
      source: r.source,
      participants: r.participation.map((p) => ({
        supplierId: p.supplier.id,
        name: p.supplier.name,
        result: p.result,
        performance: p.performance,
        qualityIncidents: p.qualityIncidents,
      })),
    })),
  });
});
