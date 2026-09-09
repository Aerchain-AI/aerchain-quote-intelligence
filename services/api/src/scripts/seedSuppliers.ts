import { prisma } from "../db.js";

/**
 * The supplier registry — who we can invite, and how they have performed.
 *
 * Seeded per category so that when a buyer raises a packaging event, the invite
 * screen can answer "who have we used for this before, and were they any good?"
 * without the buyer going to look it up.
 *
 * The five packaging suppliers deliberately match the vendors in the live FY27
 * event (Vendor A..E) so their record lines up with the extraction results the
 * rest of the app already shows.
 */

interface SupplierSeed {
  name: string;
  email: string;
  category: string;
  pastWork: string;
  eventsInvited: number;
  eventsQuoted: number;
  eventsAwarded: number;
  avgResponseDays: number;
  onTimeDeliveryPct: number;
  qualityScore: number;
  monthsSinceEngaged: number;
}

const SUPPLIERS: SupplierSeed[] = [
  // ---- Corrugated Packaging ----
  {
    name: "Vendor A Pvt. Ltd.",
    email: "sales@vendor-a-packaging.example",
    category: "Corrugated Packaging",
    pastWork: "Corrugated boxes, tapes and stretch film across FY26–FY27. Consistently complete submissions.",
    eventsInvited: 6, eventsQuoted: 6, eventsAwarded: 3,
    avgResponseDays: 3, onTimeDeliveryPct: 97, qualityScore: 0.96, monthsSinceEngaged: 1,
  },
  {
    name: "Vendor B Packaging Co.",
    email: "sales@vendor-b-packaging.example",
    category: "Corrugated Packaging",
    pastWork: "Boxes and protective packaging. Competitive pricing, but ISO 9001 certification still pending.",
    eventsInvited: 6, eventsQuoted: 5, eventsAwarded: 1,
    avgResponseDays: 5, onTimeDeliveryPct: 88, qualityScore: 0.71, monthsSinceEngaged: 1,
  },
  {
    name: "Vendor C International Packaging LLC",
    email: "exports@vendor-c-intl.example",
    category: "Corrugated Packaging",
    pastWork: "Imported corrugated and kraft materials, quoted in USD. Strong quality record, longer lead times.",
    eventsInvited: 4, eventsQuoted: 4, eventsAwarded: 2,
    avgResponseDays: 6, onTimeDeliveryPct: 92, qualityScore: 0.94, monthsSinceEngaged: 1,
  },
  {
    name: "Vendor D Packaging Works",
    email: "contact@vendor-d-works.example",
    category: "Corrugated Packaging",
    pastWork: "Regional supplier. Submissions often incomplete or handwritten; needs chasing.",
    eventsInvited: 5, eventsQuoted: 4, eventsAwarded: 1,
    avgResponseDays: 9, onTimeDeliveryPct: 79, qualityScore: 0.68, monthsSinceEngaged: 1,
  },
  {
    name: "Vendor E Packaging Solutions",
    email: "sales@vendore-packaging.example",
    category: "Corrugated Packaging",
    pastWork: "Long-standing supplier, informal quoting. Cannot currently support emergency orders.",
    eventsInvited: 7, eventsQuoted: 6, eventsAwarded: 2,
    avgResponseDays: 4, onTimeDeliveryPct: 85, qualityScore: 0.74, monthsSinceEngaged: 1,
  },
  {
    name: "Shakti Corrugators",
    email: "bids@shakticorrugators.example",
    category: "Corrugated Packaging",
    pastWork: "Bulk corrugated sheets for the FY26 event. Did not win, pricing was mid-pack.",
    eventsInvited: 3, eventsQuoted: 2, eventsAwarded: 0,
    avgResponseDays: 7, onTimeDeliveryPct: 90, qualityScore: 0.82, monthsSinceEngaged: 11,
  },

  // ---- IT Hardware ----
  {
    name: "Northline Technologies",
    email: "corporate@northlinetech.example",
    category: "IT Hardware",
    pastWork: "Awarded the FY26 laptop and monitor refresh. Reliable on volume commitments.",
    eventsInvited: 5, eventsQuoted: 5, eventsAwarded: 3,
    avgResponseDays: 2, onTimeDeliveryPct: 96, qualityScore: 0.93, monthsSinceEngaged: 5,
  },
  {
    name: "Cygnus Infotech Distributors",
    email: "sales@cygnusinfotech.example",
    category: "IT Hardware",
    pastWork: "Networking and peripherals for the Q3 FY26 floor fit-out.",
    eventsInvited: 4, eventsQuoted: 4, eventsAwarded: 1,
    avgResponseDays: 4, onTimeDeliveryPct: 91, qualityScore: 0.88, monthsSinceEngaged: 5,
  },
  {
    name: "Meridian Systems Supply",
    email: "tenders@meridiansystems.example",
    category: "IT Hardware",
    pastWork: "Quoted on peripherals twice. Competitive on accessories, weaker on laptops.",
    eventsInvited: 3, eventsQuoted: 2, eventsAwarded: 0,
    avgResponseDays: 8, onTimeDeliveryPct: 84, qualityScore: 0.79, monthsSinceEngaged: 8,
  },

  // ---- Facilities ----
  {
    name: "Ravi Facility Supplies",
    email: "orders@ravifacility.example",
    category: "Facilities",
    pastWork: "Housekeeping and sanitation consumables, FY26. Awarded and delivered in full.",
    eventsInvited: 4, eventsQuoted: 4, eventsAwarded: 2,
    avgResponseDays: 3, onTimeDeliveryPct: 94, qualityScore: 0.9, monthsSinceEngaged: 10,
  },
  {
    name: "CleanEdge Industrial",
    email: "sales@cleanedgeind.example",
    category: "Facilities",
    pastWork: "Cleaning chemicals. Priced well but missed two delivery windows.",
    eventsInvited: 3, eventsQuoted: 3, eventsAwarded: 1,
    avgResponseDays: 5, onTimeDeliveryPct: 76, qualityScore: 0.72, monthsSinceEngaged: 10,
  },

  // ---- Office Furniture ----
  {
    name: "Formline Workspace",
    email: "projects@formlineworkspace.example",
    category: "Office Furniture",
    pastWork: "Workstations and seating for two prior office fit-outs.",
    eventsInvited: 2, eventsQuoted: 2, eventsAwarded: 1,
    avgResponseDays: 6, onTimeDeliveryPct: 89, qualityScore: 0.87, monthsSinceEngaged: 14,
  },
];

async function main() {
  for (const s of SUPPLIERS) {
    const lastEngagedAt = new Date();
    lastEngagedAt.setMonth(lastEngagedAt.getMonth() - s.monthsSinceEngaged);
    const { monthsSinceEngaged: _ignored, ...rest } = s;
    await prisma.supplier.upsert({
      where: { email: s.email },
      create: { ...rest, lastEngagedAt },
      update: { ...rest, lastEngagedAt },
    });
  }

  const byCategory = await prisma.supplier.groupBy({ by: ["category"], _count: true });
  console.log(`Seeded ${SUPPLIERS.length} suppliers:`);
  for (const c of byCategory) console.log(`  ${c.category}: ${c._count}`);
}

main()
  .catch((err) => {
    console.error("Supplier seed failed:", err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
