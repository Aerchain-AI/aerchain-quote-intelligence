import { prisma } from "../db.js";

/**
 * Syncs the app's login profiles into the Buyer table.
 *
 * The web app authenticates against a fixed set of demo profiles while the API
 * kept its own separate buyer roster, so whoever you logged in as, new events
 * were attributed to whichever buyer happened to sort first. Attribution is the
 * whole point of recording a buyer, so the two rosters have to be one roster.
 *
 * Ids match apps/web/src/lib/auth.ts exactly — that is what lets the client
 * attribute an event to the signed-in user without a lookup table.
 */
const SESSION_BUYERS = [
  { id: "buyer-001", name: "Priya Sharma", email: "priya.sharma@aerchain.io", team: "Packaging Procurement" },
  { id: "buyer-002", name: "Rahul Mehta", email: "rahul.mehta@aerchain.io", team: "Indirect Procurement" },
  { id: "buyer-003", name: "Ananya Iyer", email: "ananya.iyer@aerchain.io", team: "Direct Procurement" },
  { id: "buyer-004", name: "Karthik Nair", email: "karthik.nair@aerchain.io", team: "Strategic Sourcing" },
];

async function main() {
  for (const b of SESSION_BUYERS) {
    await prisma.buyer.upsert({
      where: { id: b.id },
      create: b,
      update: { name: b.name, email: b.email, team: b.team },
    });
    console.log(`  ✓ ${b.name} (${b.id})`);
  }

  const total = await prisma.buyer.count();
  console.log(`\n${SESSION_BUYERS.length} login profiles synced. ${total} buyers on record.`);
  console.log("Historical events keep their original owners — those buyers raised them.");
}

main()
  .catch((err) => {
    console.error("Seed failed:", err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
