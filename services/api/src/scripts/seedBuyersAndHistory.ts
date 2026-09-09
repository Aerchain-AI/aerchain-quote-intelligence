import { prisma } from "../db.js";

/**
 * Seeds the buyer roster and a back-catalogue of past sourcing events.
 *
 * The history exists so "have we bought this before?" has something real to
 * answer against. These are past events only — none of them carry vendor
 * responses; they are precedent, not live data.
 */

const BUYERS = [
  { name: "Priya Raghavan", email: "priya.raghavan@buyer.example", team: "Packaging & Consumables" },
  { name: "Arjun Mehta", email: "arjun.mehta@buyer.example", team: "IT & Digital" },
  { name: "Sneha Kulkarni", email: "sneha.kulkarni@buyer.example", team: "Facilities & MRO" },
];

interface HistoricalRfx {
  name: string;
  category: string;
  status: "awarded" | "draft";
  buyerEmail: string;
  monthsAgo: number;
  sourceRequest: string;
  description: string;
  currency: string;
  lineItems: Array<{ name: string; specification: string; quantity: number; unit: string }>;
}

const HISTORY: HistoricalRfx[] = [
  {
    name: "Corrugated Packaging — FY26 Sourcing Event",
    category: "Corrugated Packaging",
    status: "awarded",
    buyerEmail: "priya.raghavan@buyer.example",
    monthsAgo: 13,
    sourceRequest: "corrugated boxes and packaging consumables for the Hyderabad warehouse",
    description:
      "Prior-year corrugated packaging event covering boxes, sheets, tapes and protective packaging for fulfillment operations. Awarded across two suppliers.",
    currency: "INR",
    lineItems: [
      { name: "5-Ply Corrugated Box – Small", specification: "300×200×150 mm", quantity: 9000, unit: "pcs" },
      { name: "5-Ply Corrugated Box – Medium", specification: "400×300×250 mm", quantity: 7500, unit: "pcs" },
      { name: "3-Ply Corrugated Box – Small", specification: "250×180×120 mm", quantity: 11000, unit: "pcs" },
      { name: "BOPP Packaging Tape", specification: "48 mm", quantity: 9000, unit: "rolls" },
      { name: "Stretch Film", specification: "500 mm", quantity: 1800, unit: "rolls" },
    ],
  },
  {
    name: "Protective Packaging & Void Fill — H1 FY27",
    category: "Corrugated Packaging",
    status: "draft",
    buyerEmail: "priya.raghavan@buyer.example",
    monthsAgo: 1,
    sourceRequest: "bubble wrap, void fill and edge protectors for fragile SKUs",
    description:
      "Draft event for protective packaging consumables, raised after breakage rates rose on fragile SKUs. Not yet issued to vendors.",
    currency: "INR",
    lineItems: [
      { name: "Bubble Wrap", specification: "1 m width", quantity: 1200, unit: "rolls" },
      { name: "Paper Void Fill", specification: "Recyclable", quantity: 1500, unit: "kg" },
      { name: "Edge Protectors – Small", specification: "Standard", quantity: 8000, unit: "pcs" },
    ],
  },
  {
    name: "IT Hardware Refresh — FY26",
    category: "IT Hardware",
    status: "awarded",
    buyerEmail: "arjun.mehta@buyer.example",
    monthsAgo: 8,
    sourceRequest: "laptops, monitors and docking stations for office staff refresh",
    description:
      "Annual end-user computing refresh covering laptops, monitors, docking stations and peripherals. Awarded to a single reseller.",
    currency: "INR",
    lineItems: [
      { name: "Business Laptop – 14 inch", specification: "i5 / 16GB / 512GB SSD", quantity: 120, unit: "pcs" },
      { name: "Monitor – 24 inch", specification: "1080p, height adjustable", quantity: 140, unit: "pcs" },
      { name: "USB-C Docking Station", specification: "Dual display, 65W PD", quantity: 120, unit: "pcs" },
      { name: "Wireless Keyboard & Mouse Combo", specification: "2.4GHz receiver", quantity: 130, unit: "sets" },
    ],
  },
  {
    name: "Networking & Peripherals — Q3 FY26",
    category: "IT Hardware",
    status: "awarded",
    buyerEmail: "arjun.mehta@buyer.example",
    monthsAgo: 5,
    sourceRequest: "network switches, patch cables and headsets for the new floor",
    description: "Fit-out of the new office floor: access switches, structured cabling consumables and headsets.",
    currency: "INR",
    lineItems: [
      { name: "Cat6 UTP Patch Cable – 2m", specification: "RJ45, snagless", quantity: 400, unit: "pcs" },
      { name: "Enterprise Wireless Headset", specification: "Dual connectivity, noise cancelling", quantity: 90, unit: "pcs" },
      { name: "24-Port Gigabit Switch", specification: "Managed, PoE+", quantity: 12, unit: "pcs" },
    ],
  },
  {
    name: "Housekeeping & Sanitation Supplies — FY26",
    category: "Facilities",
    status: "awarded",
    buyerEmail: "sneha.kulkarni@buyer.example",
    monthsAgo: 10,
    sourceRequest: "housekeeping consumables and sanitation supplies across all sites",
    description: "Site-wide housekeeping consumables, cleaning chemicals and washroom supplies.",
    currency: "INR",
    lineItems: [
      { name: "Floor Cleaning Concentrate", specification: "5 L", quantity: 600, unit: "cans" },
      { name: "Hand Wash Refill", specification: "5 L", quantity: 400, unit: "cans" },
      { name: "Microfibre Cloth", specification: "40×40 cm", quantity: 3000, unit: "pcs" },
    ],
  },
];

async function main() {
  for (const b of BUYERS) {
    await prisma.buyer.upsert({ where: { email: b.email }, create: b, update: { name: b.name, team: b.team } });
  }
  const buyers = await prisma.buyer.findMany();
  const buyerByEmail = new Map(buyers.map((b) => [b.email, b]));
  console.log(`Buyers: ${buyers.length}`);

  // Attribute the existing live event to the packaging buyer so it isn't orphaned.
  const live = await prisma.rfx.findFirst({ where: { name: { contains: "FY27 Sourcing Event" } } });
  if (live && !live.buyerId) {
    await prisma.rfx.update({
      where: { id: live.id },
      data: {
        buyerId: buyerByEmail.get("priya.raghavan@buyer.example")!.id,
        status: "active",
        sourceRequest: "corrugated packaging for our Hyderabad fulfillment operations",
      },
    });
    console.log(`Attributed "${live.name}" to Priya Raghavan`);
  }

  const maxLineItem = await prisma.lineItem.aggregate({ _max: { id: true } });
  let nextLineItemId = (maxLineItem._max.id ?? 0) + 1;

  for (const h of HISTORY) {
    const existing = await prisma.rfx.findFirst({ where: { name: h.name } });
    if (existing) {
      console.log(`  (exists) ${h.name}`);
      continue;
    }
    const createdAt = new Date();
    createdAt.setMonth(createdAt.getMonth() - h.monthsAgo);
    const requiredBy = new Date(createdAt);
    requiredBy.setMonth(requiredBy.getMonth() + 2);

    const rfx = await prisma.rfx.create({
      data: {
        name: h.name,
        category: h.category,
        description: h.description,
        sourceRequest: h.sourceRequest,
        status: h.status,
        currency: h.currency,
        requiredByDate: requiredBy,
        createdAt,
        buyerId: buyerByEmail.get(h.buyerEmail)!.id,
      },
    });
    for (const li of h.lineItems) {
      await prisma.lineItem.create({ data: { id: nextLineItemId++, rfxId: rfx.id, ...li } });
    }
    console.log(`  + ${h.name} (${h.status}, ${h.lineItems.length} items)`);
  }

  const total = await prisma.rfx.count();
  console.log(`Total RFx events on record: ${total}`);
}

main()
  .catch((err) => {
    console.error("Seed failed:", err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
