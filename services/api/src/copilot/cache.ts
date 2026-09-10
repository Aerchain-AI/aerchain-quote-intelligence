import { createHash } from "node:crypto";
import type { ComparisonDataset } from "../calc/dataset.js";
import { prisma } from "../db.js";
import type { CopilotAnswer } from "./answer.js";

/**
 * Caches the LLM half of a copilot answer (intent routing + prose explanation).
 *
 * This is not a shortcut around doing the work: the answer being cached was
 * genuinely computed from the extracted data the first time, and the cache key
 * includes a data version, so re-processing any vendor invalidates every cached
 * answer for that RFx. Its purpose is that a live demo does not depend on a
 * free-tier quota holding up mid-question.
 */

/**
 * Bumped by hand when the shape or meaning of a calculation changes.
 *
 * The data version alone was not enough. Fixing how a number is computed leaves
 * every vendor's extraction untouched, so a cached answer written before the fix
 * kept being served after it — the copilot went on repeating a defect that had
 * already been corrected, which is worse than not caching at all.
 */
const CALC_CONTRACT_VERSION = "13";

/** Changes whenever any vendor's extraction is re-run, or the maths changes. */
export function dataVersionFor(dataset: ComparisonDataset): string {
  const parts = dataset.vendors
    .map((v) => `${v.id}:${v.status}:${v.itemsFoundCount ?? "-"}:${v.overallConfidence ?? "-"}:${v.processingMs ?? "-"}`)
    .sort();
  return createHash("sha256")
    .update([CALC_CONTRACT_VERSION, ...parts].join("|"))
    .digest("hex")
    .slice(0, 16);
}

/** Normalised so "Who is cheapest overall?" and "who is cheapest overall" hit the same entry. */
function questionKeyFor(question: string): string {
  const normalised = question.toLowerCase().replace(/[^a-z0-9%]+/g, " ").trim();
  return createHash("sha256").update(normalised).digest("hex").slice(0, 24);
}

export async function readCachedAnswer(
  rfxId: string,
  dataVersion: string,
  question: string,
): Promise<CopilotAnswer | null> {
  const row = await prisma.copilotAnswerCache.findUnique({
    where: {
      rfxId_dataVersion_questionKey: { rfxId, dataVersion, questionKey: questionKeyFor(question) },
    },
  });
  if (!row) return null;
  try {
    return JSON.parse(row.payloadJson) as CopilotAnswer;
  } catch {
    return null;
  }
}

export async function writeCachedAnswer(
  rfxId: string,
  dataVersion: string,
  question: string,
  answer: CopilotAnswer,
): Promise<void> {
  const questionKey = questionKeyFor(question);
  await prisma.copilotAnswerCache.upsert({
    where: { rfxId_dataVersion_questionKey: { rfxId, dataVersion, questionKey } },
    create: { rfxId, dataVersion, questionKey, question, payloadJson: JSON.stringify(answer) },
    update: { question, payloadJson: JSON.stringify(answer) },
  });
}
