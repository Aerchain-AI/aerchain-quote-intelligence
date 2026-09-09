import { FunctionCallingConfigMode } from "@google/genai";
import type { ComparisonDataset } from "../calc/dataset.js";
import {
  cheapestOverall,
  cheapestPerLine,
  resolveEligibleVendors,
  scenarioAdditionalDiscount,
  splitAward,
  summarizeExceptions,
  vendorRiskProfile,
  type EligibilityConstraints,
} from "../calc/engine.js";
import { GEMINI_COPILOT_MODEL, getKeyPool } from "../llm/client.js";
import {
  dataVersionFor,
  readCachedAnswer,
  writeCachedAnswer,
} from "./cache.js";
import {
  PLAN_SYSTEM_PROMPT,
  PLAN_TOOL,
  PLAN_TOOL_NAME,
  type AnalysisPlan,
} from "./intent.js";

export interface CopilotAnswer {
  question: string;
  /** True when the LLM stages were served from cache; the calculation is always fresh. */
  cached?: boolean;
  interpretation: string;
  analysisType: string;
  /** The exact deterministic output the answer is based on — shown as "view calculation". */
  calculation: unknown;
  answer: string;
  caveats: string[];
  supported: boolean;
}

// ------------------------------------------------------- stage 1: parse intent

async function planAnalysis(
  question: string,
  vendorNames: string[],
): Promise<AnalysisPlan> {
  const response = await getKeyPool().runWithFailover({
    model: GEMINI_COPILOT_MODEL,
    run: (client) =>
      client.models.generateContent({
        model: GEMINI_COPILOT_MODEL,
        contents: [
          {
            role: "user",
            parts: [
              {
                text: `Vendors in this event: ${vendorNames.join(", ")}.\n\nBuyer's question: "${question}"`,
              },
            ],
          },
        ],
        config: {
          systemInstruction: PLAN_SYSTEM_PROMPT,
          maxOutputTokens: 2048,
          httpOptions: { timeout: 25_000 },
          tools: [{ functionDeclarations: [PLAN_TOOL] }],
          toolConfig: {
            functionCallingConfig: {
              mode: FunctionCallingConfigMode.ANY,
              allowedFunctionNames: [PLAN_TOOL_NAME],
            },
          },
        },
      }),
    },
    // A buyer waiting on an answer should hear "unavailable" in under a minute.
    { transientAttemptsPerKey: 2, deadlineMs: 45_000 },
  );

  const call = response.functionCalls?.[0];
  if (!call?.args)
    throw new Error("The copilot could not interpret that question.");
  const args = call.args as Record<string, unknown>;
  return {
    analysisType:
      (args.analysisType as AnalysisPlan["analysisType"]) ?? "unsupported",
    requireQualityPass: Boolean(args.requireQualityPass),
    requireCompleteResponse: Boolean(args.requireCompleteResponse),
    vendorName: (args.vendorName as string | null) ?? null,
    discountPercent: (args.discountPercent as number | null) ?? null,
    interpretation: (args.interpretation as string) ?? question,
    unsupportedReason: (args.unsupportedReason as string | null) ?? null,
  };
}

// ------------------------------------------- stage 2: deterministic execution

function commercialTerms(
  dataset: ComparisonDataset,
  constraints: EligibilityConstraints,
) {
  const { eligibleVendorIds, excluded } = resolveEligibleVendors(
    dataset,
    constraints,
  );
  const vendors = dataset.vendors.filter((v) =>
    eligibleVendorIds.includes(v.id),
  );
  return {
    vendors: vendors.map((v) => ({
      vendorName: v.name,
      paymentTerms:
        v.questionnaire.find((a) => a.questionId === 9)?.answerText?.trim() ||
        null,
      leadTime:
        v.questionnaire.find((a) => a.questionId === 4)?.answerText?.trim() ||
        null,
      emergencyOrders:
        v.questionnaire.find((a) => a.questionId === 8)?.answerText?.trim() ||
        null,
      qualityStatus: v.quality.status,
    })),
    excludedVendors: excluded,
    note: "Payment terms and lead times are reproduced as the vendors stated them; they are not scored or ranked by the system.",
  };
}

function resolveVendorId(
  dataset: ComparisonDataset,
  vendorName: string | null,
): string | null {
  if (!vendorName) return null;
  const needle = vendorName.trim().toLowerCase();
  return (
    dataset.vendors.find((v) => v.name.toLowerCase() === needle)?.id ??
    dataset.vendors.find(
      (v) =>
        v.name.toLowerCase().includes(needle) ||
        needle.includes(v.name.toLowerCase()),
    )?.id ??
    null
  );
}

export function executeAnalysis(
  dataset: ComparisonDataset,
  plan: AnalysisPlan,
): {
  calculation: unknown;
  caveats: string[];
  supported: boolean;
  missingReason?: string;
} {
  const constraints: EligibilityConstraints = {
    requireQualityPass: plan.requireQualityPass,
    requireCompleteResponse: plan.requireCompleteResponse,
  };

  switch (plan.analysisType) {
    case "cheapest_overall": {
      const result = cheapestOverall(dataset, constraints);
      return { calculation: result, caveats: result.caveats, supported: true };
    }
    case "cheapest_per_line": {
      const result = cheapestPerLine(dataset, constraints);
      const unpriced = result.lines.filter((l) => !l.winnerVendorId);
      return {
        calculation: result,
        caveats: unpriced.length
          ? [
              `${unpriced.length} item(s) have no usable price from any eligible vendor and have no winner.`,
            ]
          : [],
        supported: true,
      };
    }
    case "split_award": {
      const result = splitAward(dataset, constraints);
      return { calculation: result, caveats: result.caveats, supported: true };
    }
    case "vendor_risks": {
      const vendorId = resolveVendorId(dataset, plan.vendorName);
      if (!vendorId) {
        return {
          calculation: null,
          caveats: [],
          supported: false,
          missingReason: `No vendor matching "${plan.vendorName ?? "(unnamed)"}" exists in this sourcing event.`,
        };
      }
      const result = vendorRiskProfile(dataset, vendorId);
      return { calculation: result, caveats: [], supported: true };
    }
    case "incomplete_responses": {
      const result = summarizeExceptions(dataset);
      return { calculation: result, caveats: [], supported: true };
    }
    case "commercial_terms": {
      return {
        calculation: commercialTerms(dataset, constraints),
        caveats: [],
        supported: true,
      };
    }
    case "scenario_discount": {
      const vendorId = resolveVendorId(dataset, plan.vendorName);
      if (!vendorId || plan.discountPercent == null) {
        return {
          calculation: null,
          caveats: [],
          supported: false,
          missingReason:
            "A scenario needs both a vendor and a discount percentage to model.",
        };
      }
      const result = scenarioAdditionalDiscount(
        dataset,
        { vendorId, discountPercent: plan.discountPercent },
        constraints,
      );
      return {
        calculation: result,
        caveats: result?.caveats ?? [],
        supported: result != null,
      };
    }
    case "unsupported":
    default:
      return {
        calculation: null,
        caveats: [],
        supported: false,
        missingReason:
          plan.unsupportedReason ??
          "That question needs data this system does not hold.",
      };
  }
}

// ----------------------------------------------------- stage 3: explain result

const EXPLAIN_SYSTEM_PROMPT = `You explain a completed procurement calculation to a category buyer.

The calculation has already been performed by a deterministic engine. Your job is to put its result into clear
prose. Absolute rules:
- Use ONLY numbers that appear in the calculation result. Never compute, estimate, adjust or round a new figure.
- Never introduce a vendor, item or fact that is not in the result.
- State the relevant caveats plainly — especially excluded items, missing prices and unspecified freight or tax.
- If any value is unquoted or missing (freight, taxes, discounts), explicitly state the vendor did not specify it.
  NEVER assume ₹0 or fill in missing data. Say "not specified" or "not quoted".
- Never describe a low-confidence or flagged value as certain.
- Be concise and specific: lead with the answer, then the reasoning, then what the buyer should still check.
- Format money as it appears in the data, in INR.
- Do not use markdown headings. Short paragraphs and simple dashes for lists are fine.
- Keep the whole response under about 200 words. Summarise rather than reproducing every row of the
  calculation — the buyer can open the full calculation alongside your answer.
- Write for a buyer, not a developer: never surface raw field names from the JSON (say "failed the quality
  questionnaire", not "qualityStatus is failed"), and never mention the calculation's internal structure.`;

async function explainResult(
  question: string,
  plan: AnalysisPlan,
  calculation: unknown,
): Promise<string> {
  const response = await getKeyPool().runWithFailover({
    model: GEMINI_COPILOT_MODEL,
    run: (client) =>
      client.models.generateContent({
        model: GEMINI_COPILOT_MODEL,
        contents: [
          {
            role: "user",
            parts: [
              {
                text:
                  `Buyer's question: "${question}"\n\n` +
                  `Interpreted as: ${plan.interpretation}\n\n` +
                  `Calculation result (JSON, this is the only source of truth):\n${JSON.stringify(calculation, null, 2)}`,
              },
            ],
          },
        ],
        config: {
          systemInstruction: EXPLAIN_SYSTEM_PROMPT,
          maxOutputTokens: 4096,
          httpOptions: { timeout: 25_000 },
        },
      }),
    },
    // A buyer waiting on an answer should hear "unavailable" in under a minute.
    { transientAttemptsPerKey: 2, deadlineMs: 45_000 },
  );

  const text = response.text?.trim() ?? "";
  // A truncated explanation can read as a confident but half-stated answer, which
  // is exactly the failure mode this product exists to avoid. Say so instead.
  const finishReason = response.candidates?.[0]?.finishReason;
  if (finishReason === "MAX_TOKENS") {
    return `${text}

[This explanation was cut short. Open the full calculation for the complete result.]`;
  }
  return text;
}

// ------------------------------------------------------------- orchestration

export async function answerQuestion(
  dataset: ComparisonDataset,
  question: string,
): Promise<CopilotAnswer> {
  const dataVersion = dataVersionFor(dataset);
  const cached = await readCachedAnswer(dataset.rfxId, dataVersion, question);
  if (cached) {
    // Safe to return as-is: dataVersion is part of the cache key, so a hit means
    // no vendor has been re-extracted since these numbers were computed.
    return { ...cached, cached: true };
  }

  const plan = await planAnalysis(
    question,
    dataset.vendors.map((v) => v.name),
  );
  const executed = executeAnalysis(dataset, plan);

  if (!executed.supported) {
    const unsupported: CopilotAnswer = {
      question,
      interpretation: plan.interpretation,
      analysisType: plan.analysisType,
      calculation: null,
      answer:
        executed.missingReason ??
        "I can only answer questions grounded in this sourcing event's ingested quotes, vendor qualifications, and verified Aerchain data.",
      caveats: [],
      supported: false,
    };
    await writeCachedAnswer(dataset.rfxId, dataVersion, question, unsupported);
    return unsupported;
  }

  const answer = await explainResult(question, plan, executed.calculation);
  const result: CopilotAnswer = {
    question,
    interpretation: plan.interpretation,
    analysisType: plan.analysisType,
    calculation: executed.calculation,
    answer,
    caveats: executed.caveats,
    supported: true,
  };
  await writeCachedAnswer(dataset.rfxId, dataVersion, question, result);
  return result;
}
