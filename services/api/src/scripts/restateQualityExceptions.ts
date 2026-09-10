import { QUALITY_GATING_QUESTION_IDS, QUESTIONNAIRE_QUESTIONS } from "@aerchain/shared";
import { prisma } from "../db.js";

/**
 * Rewrite stored quality exceptions under the current rule.
 *
 * The rule changed: an unanswered gating question used to be recorded as a
 * failure, in those words, and it is now recorded as unresolved. The rule lives
 * in code, but the sentences it produced live in rows, and those rows were
 * written before the change. Re-extracting five documents would rewrite them,
 * at the cost of ten model calls and a set of numbers that might not come back
 * identical. This restates the questionnaire verdict from the questionnaire
 * answers already stored, which is the same deterministic step the pipeline
 * runs, so nothing extracted is touched and no model is involved.
 */
async function main() {
  const vendors = await prisma.vendor.findMany({
    include: { questionnaire: true },
    orderBy: { name: "asc" },
  });

  for (const vendor of vendors) {
    const failed: string[] = [];
    const unanswered: string[] = [];

    for (const qid of QUALITY_GATING_QUESTION_IDS) {
      const response = vendor.questionnaire.find((r) => r.questionId === qid);
      const question = QUESTIONNAIRE_QUESTIONS.find((q) => q.id === qid)!;
      if (!response || !response.answerText?.trim()) unanswered.push(`"${question.text}"`);
      else if (response.passFail === false) failed.push(`"${question.text}" — answered "${response.answerText}"`);
    }

    const removed = await prisma.quoteException.deleteMany({
      where: { vendorId: vendor.id, type: { in: ["quality_failure", "quality_unresolved"] } },
    });

    const created: string[] = [];
    if (failed.length > 0) {
      await prisma.quoteException.create({
        data: {
          vendorId: vendor.id,
          lineItemId: null,
          type: "quality_failure",
          message: `Answered no to ${failed.length} gating quality criterion(s): ${failed.join("; ")}.`,
          severity: "warning",
        },
      });
      created.push("quality_failure");
    }
    if (unanswered.length > 0) {
      await prisma.quoteException.create({
        data: {
          vendorId: vendor.id,
          lineItemId: null,
          type: "quality_unresolved",
          message:
            `${unanswered.length} gating quality criterion(s) left unanswered: ${unanswered.join("; ")}. ` +
            `Unknown, not failed — ask the vendor before treating this as a disqualification.`,
          severity: "warning",
        },
      });
      created.push("quality_unresolved");
    }

    console.log(
      `${vendor.name.padEnd(30)} removed ${removed.count} -> ${created.length ? created.join(", ") : "nothing to raise"}`,
    );
  }

  await prisma.$disconnect();
}

main().catch(async (err) => {
  console.error(err);
  await prisma.$disconnect();
  process.exit(1);
});
