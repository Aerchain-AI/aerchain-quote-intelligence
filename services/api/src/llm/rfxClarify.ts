import { FunctionCallingConfigMode, type FunctionDeclaration } from "@google/genai";
import { GEMINI_MODEL_LITE, getKeyPool } from "./client.js";

export interface ClarifyOption {
  label: string;
  value: string;
  description: string;
}

export interface ClarifyQuestion {
  id: string;
  question: string;
  /** Why this matters commercially — shown under the question. */
  why: string;
  options: ClarifyOption[];
  multiSelect: boolean;
  /** True when a typed answer makes more sense than any option. */
  allowFreeText: boolean;
  /** PRD §15 — Prioritization. Product specification gaps are blocking; commercial/logistics are important. */
  priority?: "blocking" | "important";
}

export interface DraftLineItem {
  name: string;
  specification: string;
  quantity: number;
  unit: string;
}

export interface ClarifyResult {
  /** Restates the ask so the buyer can see it was understood. */
  interpretation: string;
  detectedCategory: string;
  /** What the buyer already stated explicitly — not asked about again. */
  alreadyKnown: string[];
  /** Proactively generated initial line items when the prompt is vague (e.g. 10 construction materials). */
  itemsDraft: DraftLineItem[];
  questions: ClarifyQuestion[];
}

const CLARIFY_TOOL_NAME = "ask_buyer";

const CLARIFY_TOOL: FunctionDeclaration = {
  name: CLARIFY_TOOL_NAME,
  description: "Analyze the buyer's prompt, generate a proactive draft list of items for the category, and ask prioritized commercial questions.",
  parametersJsonSchema: {
    type: "object",
    properties: {
      interpretation: { type: "string", description: "One sentence restating what the buyer is asking for." },
      detectedCategory: { type: "string", description: "The procurement category, e.g. 'Construction Materials' or 'Corrugated Packaging'." },
      alreadyKnown: {
        type: "array",
        description: "Facts the buyer stated explicitly (e.g. 'Currency: INR', '10 items'). Never ask about these.",
        items: { type: "string" },
      },
      itemsDraft: {
        type: "array",
        description:
          "Proactive draft table of standard items for this category with estimated quantities and specifications. " +
          "If the buyer requested a specific count (e.g., '10 construction materials'), provide EXACTLY that many realistic items.",
        items: {
          type: "object",
          properties: {
            name: { type: "string" },
            specification: { type: "string" },
            quantity: { type: "integer" },
            unit: { type: "string" },
          },
          required: ["name", "specification", "quantity", "unit"],
        },
      },
      questions: {
        type: "array",
        description:
          "3 to 5 commercial or logistical questions. Set priority 'important' for commercial/delivery/payment questions.",
        items: {
          type: "object",
          properties: {
            id: { type: "string", description: "short snake_case key, e.g. 'freight_terms'" },
            question: { type: "string" },
            why: { type: "string", description: "One short clause on why this changes the commercial shape of the event." },
            priority: { type: "string", enum: ["blocking", "important"] },
            options: {
              type: "array",
              description: "2 to 4 concrete choices.",
              items: {
                type: "object",
                properties: {
                  label: { type: "string" },
                  value: { type: "string" },
                  description: { type: "string" },
                },
                required: ["label", "value", "description"],
              },
            },
            multiSelect: { type: "boolean" },
            allowFreeText: { type: "boolean" },
          },
          required: ["id", "question", "why", "options", "multiSelect", "allowFreeText"],
        },
      },
    },
    required: ["interpretation", "detectedCategory", "alreadyKnown", "itemsDraft", "questions"],
  },
};

const CLARIFY_SYSTEM_PROMPT = `You help a procurement buyer turn a rough request into a well-formed RFx.

Rules for Proactive Item Drafting & Question Prioritization (PRD §15):
1. Proactive Item Generation:
   - DO NOT ask reactively "What items do you need?".
   - Instead, PROACTIVELY generate a draft array ("itemsDraft") of standard line items for the category with realistic specifications and quantities.
   - If the user asks for "10 construction materials", output 10 realistic construction items (e.g. Portland Cement 43 Grade, Steel Rebar Fe 500, Red Clay Bricks, M-Sand, Coarse Aggregate 20mm, TMT Steel Bars 12mm, AAC Blocks, Waterproofing Compound, PVC Drain Pipes 110mm, Ready Mix Concrete M25).
2. Question Prioritization:
   - Classify missing line item specifications as a BLOCKING gap (resolved via the proactive itemsDraft table).
   - Commercial and logistical questions (Delivery horizon, Freight, Payment Terms, Tax, Quality gates) are IMPORTANT questions.
   - Every question must include priority "important".
   - Ask 3 to 5 commercial questions maximum with 2-4 concrete choices.

Call ask_buyer exactly once.`;

export async function clarifyRfxRequest(description: string): Promise<ClarifyResult> {
  const response = await getKeyPool().runWithFailover(
    {
      model: GEMINI_MODEL_LITE,
      run: (client) =>
        client.models.generateContent({
          model: GEMINI_MODEL_LITE,
          contents: [{ role: "user", parts: [{ text: `Buyer's request: "${description}"` }] }],
          config: {
            systemInstruction: CLARIFY_SYSTEM_PROMPT,
            maxOutputTokens: 8192,
            httpOptions: { timeout: 60_000 },
            tools: [{ functionDeclarations: [CLARIFY_TOOL] }],
            toolConfig: {
              functionCallingConfig: { mode: FunctionCallingConfigMode.ANY, allowedFunctionNames: [CLARIFY_TOOL_NAME] },
            },
          },
        }),
    },
    { deadlineMs: 75_000 },
  );

  const call = response.functionCalls?.[0];
  if (!call?.args) throw new Error("The model did not return clarifying questions.");
  const res = call.args as unknown as ClarifyResult;

  // Fallback generation if itemsDraft is missing or empty for vague prompt
  if (!res.itemsDraft || res.itemsDraft.length === 0) {
    res.itemsDraft = generateFallbackItems(description);
  }

  return res;
}

function generateFallbackItems(description: string): DraftLineItem[] {
  const lower = description.toLowerCase();
  if (lower.includes("construction") || lower.includes("building")) {
    return [
      { name: "Portland Cement (43 Grade)", specification: "IS 8112 compliant, 50kg bags", quantity: 500, unit: "bags" },
      { name: "TMT Steel Rebar (Fe 500D)", specification: "12mm diameter, IS 1786", quantity: 10, unit: "tons" },
      { name: "Red Clay Bricks (Class 7.5)", specification: "230 x 110 x 70 mm", quantity: 20000, unit: "pcs" },
      { name: "Manufactured Sand (M-Sand)", specification: "Zone II fine aggregate for masonry", quantity: 50, unit: "tons" },
      { name: "Coarse Aggregate (20mm)", specification: "Hard crushed granite stone", quantity: 40, unit: "tons" },
      { name: "AAC Lightweight Blocks", specification: "600 x 200 x 150 mm", quantity: 3000, unit: "pcs" },
      { name: "TMT Steel Rebar (Fe 500D)", specification: "16mm diameter, IS 1786", quantity: 8, unit: "tons" },
      { name: "Waterproofing Compound", specification: "Integral liquid admixture", quantity: 200, unit: "litres" },
      { name: "PVC Soil & Waste Pipes", specification: "110mm outer dia, Type B", quantity: 150, unit: "meters" },
      { name: "Ready Mix Concrete (M25)", specification: "Slump 100-120mm", quantity: 100, unit: "cum" },
    ];
  }

  // Default fallback for packaging or general
  return [
    { name: "5-Ply Corrugated Box – Small", specification: "300×200×150 mm", quantity: 10000, unit: "pcs" },
    { name: "5-Ply Corrugated Box – Medium", specification: "400×300×250 mm", quantity: 8000, unit: "pcs" },
    { name: "5-Ply Corrugated Box – Large", specification: "600×400×400 mm", quantity: 5000, unit: "pcs" },
    { name: "BOPP Packaging Tape", specification: "48 mm x 65 m", quantity: 10000, unit: "rolls" },
    { name: "Stretch Film Roll", specification: "500 mm width, 20 micron", quantity: 2000, unit: "rolls" },
  ];
}
