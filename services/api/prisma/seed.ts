import path from "node:path";
import { RFX_BASE_CURRENCY, RFX_CATEGORY, RFX_LINE_ITEMS, RFX_NAME } from "@aerchain/shared";
import { prisma } from "../src/db.js";
import { VENDOR_DOCS_DIR } from "../src/paths.js";

export async function runSeed() {
  console.log("[seed] Seeding database...");

  // Seed default Buyer
  const buyer = await prisma.buyer.upsert({
    where: { email: "prem.kumar@aerchain.example" },
    create: {
      name: "Prem Kumar",
      email: "prem.kumar@aerchain.example",
      team: "Packaging Sourcing",
    },
    update: {},
  });

  // Seed Suppliers
  const SUPPLIERS = [
    {
      name: "Vendor A Pvt. Ltd.",
      email: "sales@vendor-a-packaging.example",
      category: "Corrugated Packaging",
      pastWork: "Corrugated boxes, tapes and stretch film across FY26–FY27.",
      eventsInvited: 6,
      eventsQuoted: 6,
      eventsAwarded: 3,
      avgResponseDays: 3,
      onTimeDeliveryPct: 97,
      qualityScore: 0.96,
    },
    {
      name: "Vendor B Packaging Co.",
      email: "sales@vendor-b-packaging.example",
      category: "Corrugated Packaging",
      pastWork: "Boxes and protective packaging. Competitive pricing.",
      eventsInvited: 6,
      eventsQuoted: 5,
      eventsAwarded: 1,
      avgResponseDays: 5,
      onTimeDeliveryPct: 88,
      qualityScore: 0.71,
    },
    {
      name: "Vendor C International Packaging LLC",
      email: "exports@vendor-c-intl.example",
      category: "Corrugated Packaging",
      pastWork: "Imported corrugated and kraft materials, quoted in USD.",
      eventsInvited: 4,
      eventsQuoted: 4,
      eventsAwarded: 2,
      avgResponseDays: 6,
      onTimeDeliveryPct: 92,
      qualityScore: 0.94,
    },
    {
      name: "Vendor D Packaging Works",
      email: "contact@vendor-d-works.example",
      category: "Corrugated Packaging",
      pastWork: "Regional supplier. Submissions often incomplete or handwritten.",
      eventsInvited: 5,
      eventsQuoted: 4,
      eventsAwarded: 1,
      avgResponseDays: 9,
      onTimeDeliveryPct: 79,
      qualityScore: 0.68,
    },
    {
      name: "Vendor E Packaging Solutions",
      email: "sales@vendore-packaging.example",
      category: "Corrugated Packaging",
      pastWork: "Long-standing supplier, informal quoting.",
      eventsInvited: 7,
      eventsQuoted: 6,
      eventsAwarded: 2,
      avgResponseDays: 4,
      onTimeDeliveryPct: 85,
      qualityScore: 0.74,
    },
  ];

  for (const s of SUPPLIERS) {
    await prisma.supplier.upsert({
      where: { email: s.email },
      create: s,
      update: s,
    });
  }

  // Seed RFx if none exists
  const existingRfxCount = await prisma.rfx.count();
  if (existingRfxCount === 0) {
    const rfx = await prisma.rfx.create({
      data: {
        name: RFX_NAME,
        category: RFX_CATEGORY,
        requiredByDate: new Date("2027-01-15"),
        currency: RFX_BASE_CURRENCY,
        description: "Sourcing event for corrugated packaging materials.",
        buyerId: buyer.id,
      },
    });

    for (const li of RFX_LINE_ITEMS) {
      await prisma.lineItem.create({
        data: {
          id: li.id,
          rfxId: rfx.id,
          name: li.name,
          specification: li.specification,
          quantity: li.quantity,
          unit: li.unit,
        },
      });
    }

    const VENDORS = [
      { name: "Vendor A", responseFormat: "xlsx", file: "vendor-a-quote.xlsx" },
      { name: "Vendor B", responseFormat: "pdf", file: "vendor-b-quote.pdf" },
      { name: "Vendor C", responseFormat: "docx", file: "vendor-c-quote.docx" },
      { name: "Vendor D", responseFormat: "jpg", file: "vendor-d-quote.jpg" },
      { name: "Vendor E", responseFormat: "txt", file: "vendor-e-quote.txt" },
    ];

    for (const v of VENDORS) {
      await prisma.vendor.create({
        data: {
          rfxId: rfx.id,
          name: v.name,
          responseFormat: v.responseFormat,
          filePath: path.join(VENDOR_DOCS_DIR, v.file),
          status: "processed",
          itemsFoundCount: 30,
          itemsMissingCount: 0,
          overallConfidence: 0.95,
        },
      });
    }
  }

  console.log("[seed] Database seeding completed.");
}

// Execute if run directly
if (process.argv[1] && process.argv[1].endsWith("seed.ts")) {
  runSeed()
    .catch((err) => {
      console.error("Seed error:", err);
      process.exit(1);
    })
    .finally(async () => {
      await prisma.$disconnect();
    });
}
