import { loadComparisonDataset } from "../calc/dataset.js";
import { answerQuestion } from "../copilot/answer.js";
import { prisma } from "../db.js";

/**
 * Runs the demo's guaranteed questions once so their answers are cached before a
 * live walkthrough. Each answer is genuinely computed from the extracted data;
 * this just means the demo doesn't depend on an API round-trip at the moment
 * someone is watching.
 */

const DEMO_QUESTIONS = [
  "Who is cheapest overall?",
  "Who is cheapest for each item?",
  "What if we split the order by the cheapest vendor for each line?",
  "Only consider vendors who passed the quality questionnaire. Who should we award to?",
  "What are the biggest risks with Vendor B?",
  "Which vendors didn't quote all items?",
  "Which vendor has the best payment terms?",
  "If Vendor B gives us a 5% additional discount, does it become the cheapest overall?",
  "Which vendor has the lowest carbon footprint?",
];

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function main() {
  const rfx = await prisma.rfx.findFirst({ orderBy: { createdAt: "desc" } });
  if (!rfx) {
    console.error("No RFx found. Run the seed first.");
    process.exitCode = 1;
    return;
  }
  const dataset = await loadComparisonDataset(rfx.id);

  for (const [index, question] of DEMO_QUESTIONS.entries()) {
    if (index > 0) await sleep(3000);
    process.stdout.write(`\n[${index + 1}/${DEMO_QUESTIONS.length}] ${question}\n`);
    try {
      const answer = await answerQuestion(dataset, question);
      console.log(`  routed to: ${answer.analysisType}${answer.cached ? " (cached)" : ""}`);
      console.log(`  supported: ${answer.supported}`);
      console.log(`  ${answer.answer.split("\n").join("\n  ").slice(0, 700)}`);
      if (answer.caveats.length) {
        console.log(`  caveats: ${answer.caveats.length}`);
      }
    } catch (err) {
      console.log(`  FAILED: ${(err as Error).message.slice(0, 300)}`);
    }
  }
}

main()
  .catch((err) => {
    console.error("Warm-up failed:", err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
