import type { FunctionDeclaration } from "@google/genai";

/** The fixed set of analyses the engine can actually perform. The LLM's only job
 * at this stage is to map a natural-language question onto one of these plus its
 * constraints — it never computes anything. Anything outside this list is
 * explicitly routed to "unsupported" rather than improvised. */
export type AnalysisType =
  | "cheapest_overall"
  | "cheapest_per_line"
  | "split_award"
  | "vendor_risks"
  | "incomplete_responses"
  | "commercial_terms"
  | "scenario_discount"
  | "unsupported";

export interface AnalysisPlan {
  analysisType: AnalysisType;
  requireQualityPass: boolean;
  requireCompleteResponse: boolean;
  vendorName: string | null;
  discountPercent: number | null;
  interpretation: string;
  unsupportedReason: string | null;
}

export const PLAN_TOOL_NAME = "choose_analysis";

export const PLAN_TOOL: FunctionDeclaration = {
  name: PLAN_TOOL_NAME,
  description:
    "Map the buyer's question onto exactly one supported analysis and its constraints. Choose 'unsupported' " +
    "whenever the question needs data this system does not hold (for example sustainability, carbon footprint, " +
    "supplier financials, past performance, or anything not present in the quotes and questionnaire). " +
    "Also choose 'unsupported' for general-knowledge questions, organizational policy queries, or anything " +
    "unrelated to the active sourcing event's ingested data.",
  parametersJsonSchema: {
    type: "object",
    properties: {
      analysisType: {
        type: "string",
        enum: [
          "cheapest_overall",
          "cheapest_per_line",
          "split_award",
          "vendor_risks",
          "incomplete_responses",
          "commercial_terms",
          "scenario_discount",
          "unsupported",
        ],
        description:
          "cheapest_overall: rank vendors by total evaluated cost. cheapest_per_line: best vendor for each item. " +
          "split_award: allocate each line to its cheapest vendor. vendor_risks: risk profile for one named vendor. " +
          "incomplete_responses: which vendors did not quote everything. commercial_terms: payment terms and lead times. " +
          "scenario_discount: re-rank assuming one vendor gives an extra percentage discount. unsupported: the data cannot answer this.",
      },
      requireQualityPass: {
        type: "boolean",
        description:
          "true only if the buyer asked to restrict to vendors that passed the quality questionnaire.",
      },
      requireCompleteResponse: {
        type: "boolean",
        description: "true only if the buyer asked to restrict to vendors that quoted every line item.",
      },
      vendorName: {
        type: ["string", "null"],
        description: "The vendor the question is about, exactly as named (e.g. 'Vendor B'). Null if not vendor-specific.",
      },
      discountPercent: {
        type: ["number", "null"],
        description: "For scenario_discount only: the additional discount percentage being hypothesised.",
      },
      interpretation: {
        type: "string",
        description: "One sentence restating what the buyer is asking, in procurement terms.",
      },
      unsupportedReason: {
        type: ["string", "null"],
        description:
          "For 'unsupported' only: which specific data this system does not hold that would be needed to answer.",
      },
    },
    required: ["analysisType", "requireQualityPass", "requireCompleteResponse", "interpretation"],
  },
};

export const PLAN_SYSTEM_PROMPT = `You route a procurement buyer's question to exactly one supported analysis.

Available data: 30 RFx line items, 5 vendor quotations (extracted prices, units, currencies, freight/discount/tax
mentions, extraction confidence, source references), and a 10-question vendor questionnaire covering ISO 9001,
experience, samples, volume, GSM/specification, batch documentation, emergency orders, lead time, payment terms
and references.

There is NO data on: sustainability or carbon footprint, supplier financial health, past delivery performance,
audit history, geographic footprint, or anything else not listed above.

STRICT GUARDRAIL RULES:
- If the question is general knowledge, small talk, unreleased organizational information, or anything unrelated
  to this sourcing event's structured procurement data, choose "unsupported".
- Set unsupportedReason to exactly: "I can only answer questions grounded in this sourcing event's ingested quotes, vendor qualifications, and verified Aerchain data."
- Never stretch an unrelated analysis to cover an out-of-scope question.
- If a question needs data not in the available dataset above, choose "unsupported" and say precisely what is missing.

Call choose_analysis exactly once.`;
