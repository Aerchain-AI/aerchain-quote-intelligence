import { GEMINI_COPILOT_MODEL, GEMINI_MODEL_LITE, GEMINI_MODEL_VISION, getKeyPool } from "../llm/client.js";

/**
 * Probes each configured key against each model with a one-token call, so you can
 * see which keys still have quota before starting a demo. Costs one request per
 * key/model pair, which is the cheapest way to know where you stand.
 */
async function main() {
  const pool = getKeyPool();
  const models = [...new Set([GEMINI_MODEL_LITE, GEMINI_MODEL_VISION, GEMINI_COPILOT_MODEL])];

  console.log(`${pool.size} key(s) configured.\n`);

  for (const model of models) {
    process.stdout.write(`${model}\n`);
    try {
      await pool.runWithFailover({
        model,
        run: async (client) => {
          const res = await client.models.generateContent({
            model,
            contents: [{ role: "user", parts: [{ text: "OK" }] }],
            config: { maxOutputTokens: 16, httpOptions: { timeout: 30_000 } },
          });
          return res;
        },
      });
      console.log(`  reachable — pool state: ${pool.describe(model)}\n`);
    } catch (err) {
      console.log(`  UNAVAILABLE — ${(err as Error).message.slice(0, 220)}\n`);
    }
  }
}

main().catch((err) => {
  console.error("Key status check failed:", (err as Error).message);
  process.exitCode = 1;
});
