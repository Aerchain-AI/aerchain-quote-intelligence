import { prisma } from "../db.js";

/**
 * Records milestones for the seeded historical events.
 *
 * These are fixtures — the same authored demo data as the vendor documents —
 * so their history is authored too. The live event's timeline is NOT seeded:
 * it comes from real pipeline activity, so it stays honest.
 */

interface Milestone {
  type: string;
  title: string;
  detail: string;
  dayOffset: number; // days after the RFx was created
}

const AWARDED_FLOW: Milestone[] = [
  { type: "issued", title: "Issued to vendors", detail: "Invitations sent to the shortlisted supplier panel", dayOffset: 3 },
  { type: "response_received", title: "Vendor responses received", detail: "All invited vendors responded before the deadline", dayOffset: 18 },
  { type: "extraction_complete", title: "Responses normalized and compared", detail: "Quotes converted to a common basis and exceptions reviewed", dayOffset: 21 },
  { type: "shortlisted", title: "Commercial shortlist agreed", detail: "Shortlist reviewed with the category lead", dayOffset: 27 },
  { type: "awarded", title: "Awarded", detail: "Award approved and communicated to the successful supplier(s)", dayOffset: 34 },
];

const DRAFT_FLOW: Milestone[] = [
  { type: "note", title: "Scope under review", detail: "Line items still being confirmed with the requesting team", dayOffset: 2 },
];

async function main() {
  const rfxs = await prisma.rfx.findMany({ include: { buyer: true, _count: { select: { vendors: true } } } });
  let added = 0;

  for (const rfx of rfxs) {
    // The live event earns its timeline from real activity — never seeded.
    if (rfx._count.vendors > 0) {
      console.log(`  (skipped, live) ${rfx.name}`);
      continue;
    }
    const existing = await prisma.rfxEvent.count({ where: { rfxId: rfx.id } });
    if (existing > 0) {
      console.log(`  (has timeline) ${rfx.name}`);
      continue;
    }

    const flow = rfx.status === "awarded" ? AWARDED_FLOW : DRAFT_FLOW;
    for (const m of flow) {
      const occurredAt = new Date(rfx.createdAt);
      occurredAt.setDate(occurredAt.getDate() + m.dayOffset);
      // Never record a milestone in the future.
      if (occurredAt > new Date()) continue;
      await prisma.rfxEvent.create({
        data: {
          rfxId: rfx.id,
          type: m.type,
          title: m.title,
          detail: m.detail,
          actor: rfx.buyer?.name ?? null,
          occurredAt,
        },
      });
      added += 1;
    }
    console.log(`  + ${flow.length} milestones for ${rfx.name}`);
  }
  console.log(`Recorded ${added} milestone(s).`);
}

main()
  .catch((err) => {
    console.error("Timeline seed failed:", err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
