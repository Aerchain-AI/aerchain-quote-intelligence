import {
  FunctionCallingConfigMode,
  type FunctionDeclaration,
} from "@google/genai";
import { GEMINI_MODEL_LITE, getKeyPool } from "./client.js";

/** PRD §12 — AI-assisted RFx creation. The model drafts; the buyer reviews and
 * edits before anything is created. Nothing here is auto-committed. */

export interface DraftLineItem {
  name: string;
  specification: string;
  quantity: number;
  unit: string;
}

export interface RfxDraft {
  name: string;
  category: string;
  description: string;
  suggestedRequiredByDays: number;
  currency: string;
  lineItems: DraftLineItem[];
  assumptions: string[];
}

const DRAFT_TOOL_NAME = "propose_rfx";

const DRAFT_TOOL: FunctionDeclaration = {
  name: DRAFT_TOOL_NAME,
  description: "Propose a draft RFx for the buyer to review and edit.",
  parametersJsonSchema: {
    type: "object",
    properties: {
      name: {
        type: "string",
        description:
          "A specific sourcing event name, including the category and period.",
      },
      category: { type: "string" },
      description: {
        type: "string",
        description: "Two or three sentences of scope for the event.",
      },
      suggestedRequiredByDays: {
        type: "integer",
        description:
          "Realistic days from today for the required-by date, given typical lead times for this category.",
      },
      currency: { type: "string", enum: ["INR", "USD"] },
      lineItems: {
        type: "array",
        description:
          "The line items to source. Use realistic quantities and units for the described operation.",
        items: {
          type: "object",
          properties: {
            name: { type: "string" },
            specification: {
              type: "string",
              description:
                "Dimensions, grade, or 'Standard' if genuinely unspecified.",
            },
            quantity: { type: "integer" },
            unit: {
              type: "string",
              description: "pcs, sheets, kg, rolls, etc.",
            },
          },
          required: ["name", "specification", "quantity", "unit"],
        },
      },
      assumptions: {
        type: "array",
        description:
          "Anything you inferred rather than being told, so the buyer can correct it.",
        items: { type: "string" },
      },
    },
    required: [
      "name",
      "category",
      "description",
      "suggestedRequiredByDays",
      "currency",
      "lineItems",
      "assumptions",
    ],
  },
};

const DRAFT_SYSTEM_PROMPT = `You draft procurement RFx events for a category buyer.

From a short description of what the buyer needs, propose a complete, realistic RFx: a specific event name,
the category, a scope description, a sensible required-by horizon, and a set of line items with realistic
quantities, units and specifications for the operation described.

Be explicit about what you inferred. Every quantity and specification you invent because the buyer did not
state it must appear in "assumptions" so they can correct it before the RFx is created. Do not silently
present guesses as requirements.

Anything the buyer has already answered is a settled requirement: apply it, and do NOT repeat it back as an
assumption. Reserve "assumptions" for what you filled in on your own.

Call propose_rfx exactly once.`;

export interface ClarificationAnswer {
  question: string;
  answer: string;
}

export async function draftRfx(
  description: string,
  itemCountHint?: number,
  answers: ClarificationAnswer[] = [],
): Promise<RfxDraft> {
  const hint = itemCountHint ? `\n\nAim for roughly ${itemCountHint} line items.` : "";
  // Answers the buyer already gave are settled requirements, not guesses — the
  // draft should apply them silently rather than listing them back as assumptions.
  const answered = answers.length
    ? `\n\nThe buyer has already answered these, so treat them as settled requirements:\n` +
      answers.map((a) => `- ${a.question} -> ${a.answer}`).join("\n")
    : "";

  const response = await getKeyPool().runWithFailover(
    {
      model: GEMINI_MODEL_LITE,
      run: (client) =>
        client.models.generateContent({
          model: GEMINI_MODEL_LITE,
          contents: [
            { role: "user", parts: [{ text: `Buyer's description: "${description}"${answered}${hint}` }] },
          ],
          config: {
            systemInstruction: DRAFT_SYSTEM_PROMPT,
            maxOutputTokens: 16384,
            httpOptions: { timeout: 120_000 },
            tools: [{ functionDeclarations: [DRAFT_TOOL] }],
            toolConfig: {
              functionCallingConfig: {
                mode: FunctionCallingConfigMode.ANY,
                allowedFunctionNames: [DRAFT_TOOL_NAME],
              },
            },
          },
        }),
    },
    { deadlineMs: 150_000 },
  );

  const call = response.functionCalls?.[0];
  if (!call?.args) {
    const finishReason = response.candidates?.[0]?.finishReason;
    throw new Error(
      finishReason === "MAX_TOKENS"
        ? "The draft was cut off before it completed. Try asking for fewer line items."
        : `The model did not return an RFx draft${finishReason ? ` (stopped with ${finishReason})` : ""}.`,
    );
  }
  return call.args as unknown as RfxDraft;
}
