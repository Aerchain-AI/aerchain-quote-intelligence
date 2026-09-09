import path from "node:path";
import { RFX_BASE_CURRENCY, RFX_CATEGORY, RFX_LINE_ITEMS, RFX_NAME } from "@aerchain/shared";
import { prisma } from "../db.js";
import { VENDOR_DOCS_DIR } from "../paths.js";

const VENDORS: Array<{ name: string; responseFormat: string; file: string }> = [
  { name: "Vendor A", responseFormat: "xlsx", file: "vendor-a-quote.xlsx" },
  { name: "Vendor B", responseFormat: "pdf", file: "vendor-b-quote.pdf" },
  { name: "Vendor C", responseFormat: "docx", file: "vendor-c-quote.docx" },
  { name: "Vendor D", responseFormat: "jpg", file: "vendor-d-quote.jpg" },
  { name: "Vendor E", responseFormat: "txt", file: "vendor-e-quote.txt" },
];

async function main() {
  // Idempotent: wipe any prior seed data so this script can be re-run freely.
  await prisma.questionnaireResponse.deleteMany({});
  await prisma.quoteException.deleteMany({});
  await prisma.vendorQuote.deleteMany({});
  await prisma.vendor.deleteMany({});
  await prisma.lineItem.deleteMany({});
  await prisma.rfx.deleteMany({});

  const rfx = await prisma.rfx.create({
    data: {
      name: RFX_NAME,
      category: RFX_CATEGORY,
      requiredByDate: new Date("2027-01-15"),
      currency: RFX_BASE_CURRENCY,
      description:
        "Sourcing event for corrugated packaging materials (boxes, sheets, rolls, tapes, labels, " +
        "protective packaging, and pallets) supporting FY27 fulfillment operations.",
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

  for (const v of VENDORS) {
    await prisma.vendor.create({
      data: {
        rfxId: rfx.id,
        name: v.name,
        responseFormat: v.responseFormat,
        filePath: path.join(VENDOR_DOCS_DIR, v.file),
        status: "pending",
      },
    });
  }

  console.log(`Seeded RFx "${rfx.name}" (${rfx.id}) with ${RFX_LINE_ITEMS.length} line items and ${VENDORS.length} vendors.`);
}

main()
  .catch((err) => {
    console.error("Seed failed:", err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
