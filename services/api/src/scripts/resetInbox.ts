import { prisma } from "../db.js";

/**
 * Puts the inbox back to "no mail read yet".
 *
 * Clears every stored inbound message, deletes the vendor rows those messages
 * created, and resets each invitation to "sent". Running a sync afterwards
 * re-files the samples from scratch, which is what you want before rehearsing
 * the demo or after experimenting.
 *
 * Vendor rows that came from an upload are untouched — only ones an inbound
 * message created are removed, plus any orphan left behind by a failed copy.
 */
async function main() {
  const messages = await prisma.inboundMessage.findMany({ select: { vendorId: true } });
  const fromMail = messages.map((m) => m.vendorId).filter((v): v is string => !!v);

  // An empty filePath means the row was created but its document never landed.
  const orphans = await prisma.vendor.findMany({ where: { filePath: "" }, select: { id: true } });
  const vendorIds = [...new Set([...fromMail, ...orphans.map((o) => o.id)])];

  if (vendorIds.length > 0) {
    await prisma.questionnaireResponse.deleteMany({ where: { vendorId: { in: vendorIds } } });
    await prisma.quoteException.deleteMany({ where: { vendorId: { in: vendorIds } } });
    await prisma.vendorQuote.deleteMany({ where: { vendorId: { in: vendorIds } } });
    await prisma.vendor.deleteMany({ where: { id: { in: vendorIds } } });
  }

  const { count } = await prisma.inboundMessage.deleteMany({});
  await prisma.rfxInvitation.updateMany({
    data: { status: "sent", respondedAt: null, responseSubject: null, responseMessageId: null },
  });

  console.log(`Cleared ${count} inbound message(s).`);
  console.log(`Removed ${vendorIds.length} vendor row(s) created from mail (${orphans.length} of them orphaned).`);
  console.log("Every invitation is back to awaiting. Run a sync to re-file the samples.");
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
