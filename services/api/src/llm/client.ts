import path from "node:path";
import dotenv from "dotenv";
import { REPO_ROOT } from "../paths.js";
import { ApiKeyPool } from "./keyPool.js";

// Keys live in the repo-root .env (shared across the monorepo), not
// services/api/.env (which only holds the Prisma-CLI-facing DATABASE_URL).
dotenv.config({ path: path.join(REPO_ROOT, ".env") });

/**
 * Model policy, decided by measurement rather than preference — see
 * metrics/accuracy.ts, which scores extraction against the generated documents'
 * known ground truth.
 *
 * Measured on this dataset (see BUILD_PLAN.md for the full table):
 *   xlsx / pdf / docx / txt  lite             100% price, 100% omission detection
 *   photographed quote       lite             misses both faint prices (25/27)
 *   photographed quote       3.5-flash        misses both faint prices (25/27)
 *   photographed quote       3.7-flash        27/27, faint prices read and flagged
 *
 * Only the photograph is hard enough to need a heavier model, so that is the only
 * call that uses one — 1 per run instead of 5, which matters on a per-model
 * free-tier day quota. Every other format stays on lite with no measured loss.
 */
export const GEMINI_MODEL_LITE = "gemini-3.5-flash-lite";
export const GEMINI_MODEL_VISION = "gemini-3.7-flash";

/** Extraction model for a given vendor response format. */
export function extractionModelFor(responseFormat: string): string {
  return responseFormat === "jpg" || responseFormat === "png" ? GEMINI_MODEL_VISION : GEMINI_MODEL_LITE;
}

/** Intent routing plus prose explanation — easier work than reading a photographed
 * quotation, and it runs many times in a demo. */
export const GEMINI_COPILOT_MODEL = GEMINI_MODEL_LITE;

/** Accepts a comma-separated GEMINI_API_KEYS, or a single legacy GEMINI_API_KEY. */
function configuredKeys(): string[] {
  const raw = process.env.GEMINI_API_KEYS ?? process.env.GEMINI_API_KEY ?? "";
  return raw
    .split(",")
    .map((k) => k.trim())
    .filter(Boolean);
}

let _pool: ApiKeyPool | null = null;

/** Lazily constructed so scripts that don't need the LLM (e.g. the normalize and
 * validate unit tests) never fail on missing keys. */
export function getKeyPool(): ApiKeyPool {
  if (!_pool) _pool = new ApiKeyPool(configuredKeys());
  return _pool;
}
