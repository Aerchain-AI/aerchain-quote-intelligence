import { GoogleGenAI } from "@google/genai";

/**
 * A pool of API keys with automatic failover.
 *
 * Google's free tier meters quota **per key, per model, per day**. So a key that
 * is exhausted on the vision model may still have room on the lite model, and
 * cooldowns are tracked at that granularity rather than blacklisting whole keys.
 *
 * Failure handling splits three ways:
 *   quota (429)      → this key is done for this model; cool it down, move to the next key
 *   transient (503/504) → the service is busy, not the key; back off and retry the same key
 *   anything else    → a real error; surface it immediately rather than burning the pool
 *
 * Adding a second provider later means giving it its own pool that exposes the
 * same runWithFailover contract; nothing above this layer needs to change.
 */

export interface FailoverOptions {
  /** Retries per key for transient (non-quota) failures. */
  transientAttemptsPerKey?: number;
  /** Overall wall-clock budget. Interactive callers should set this so a wide
   * outage fails fast instead of walking the whole pool. */
  deadlineMs?: number;
}

export interface PoolCall<T> {
  /** The model being called — cooldowns are per key *and* model. */
  model: string;
  run: (client: GoogleGenAI) => Promise<T>;
}

const QUOTA_PATTERN = /"code":\s*429|RESOURCE_EXHAUSTED|exceeded your current quota/i;
// Includes client-side aborts and socket failures: a request that timed out
// locally is every bit as retryable as a 503 from the service.
const TRANSIENT_PATTERN =
  /"code":\s*(500|502|503|504)|UNAVAILABLE|DEADLINE_EXCEEDED|deadline exceeded|overloaded|high demand|aborted|AbortError|ETIMEDOUT|ECONNRESET|socket hang up|fetch failed/i;

/** Google reports a per-day quota separately from a per-minute one; the daily one
 * is not worth retrying within a session. */
const DAILY_QUOTA_PATTERN = /PerDay|GenerateRequestsPerDayPerProjectPerModel/i;

const DEFAULT_RATE_COOLDOWN_MS = 60_000;
const DAILY_COOLDOWN_MS = 6 * 60 * 60 * 1000;

function parseRetryDelayMs(message: string): number | null {
  const match = message.match(/"retryDelay":\s*"(\d+(?:\.\d+)?)s"/);
  return match ? Math.ceil(Number(match[1]) * 1000) : null;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Bounds a call by wall-clock time. The underlying request may still be in flight
 * afterwards — it will hit its own timeout — but the caller is not made to wait for
 * it, which is what matters when someone is watching a screen. */
async function withDeadline<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error("deadline exceeded waiting for the model")), ms);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

interface PooledKey {
  index: number;
  /** Last 4 characters only — a key must never be logged in full. */
  label: string;
  client: GoogleGenAI;
}

export class ApiKeyPool {
  private readonly keys: PooledKey[];
  /** `${keyIndex}:${model}` → epoch ms until which that pairing is unusable. */
  private readonly cooldowns = new Map<string, number>();

  constructor(apiKeys: string[]) {
    if (apiKeys.length === 0) {
      throw new Error(
        "No Gemini API keys configured. Set GEMINI_API_KEYS (comma-separated) in the repo-root .env. " +
          "Get free keys at aistudio.google.com -> Get API key.",
      );
    }
    this.keys = apiKeys.map((apiKey, index) => ({
      index,
      label: `key${index + 1}(…${apiKey.slice(-4)})`,
      client: new GoogleGenAI({ apiKey }),
    }));
  }

  get size(): number {
    return this.keys.length;
  }

  private cooldownKey(keyIndex: number, model: string): string {
    return `${keyIndex}:${model}`;
  }

  private isAvailable(key: PooledKey, model: string): boolean {
    const until = this.cooldowns.get(this.cooldownKey(key.index, model));
    return until == null || Date.now() >= until;
  }

  private coolDown(key: PooledKey, model: string, message: string): void {
    const retryDelay = parseRetryDelayMs(message);
    const isDaily = DAILY_QUOTA_PATTERN.test(message);
    // A per-minute limit is worth waiting out; a daily one is not, so park the
    // pairing long enough that the pool stops reaching for it this session.
    const ms = isDaily ? DAILY_COOLDOWN_MS : Math.max(retryDelay ?? DEFAULT_RATE_COOLDOWN_MS, DEFAULT_RATE_COOLDOWN_MS);
    this.cooldowns.set(this.cooldownKey(key.index, model), Date.now() + ms);
    console.warn(
      `[keypool] ${key.label} is out of quota for ${model} (${isDaily ? "daily" : "rate"} limit) — ` +
        `cooling down for ${Math.round(ms / 1000)}s and failing over.`,
    );
  }

  /** Status for diagnostics — never includes key material. */
  describe(model: string): string {
    return this.keys
      .map((k) => {
        const until = this.cooldowns.get(this.cooldownKey(k.index, model));
        const state = until != null && Date.now() < until ? `cooling ${Math.round((until - Date.now()) / 1000)}s` : "ready";
        return `${k.label}:${state}`;
      })
      .join(", ");
  }

  /**
   * Runs `call.run` against the first available key, failing over on quota errors
   * and retrying transient ones. Throws only when every key is exhausted for that
   * model, or when the error is not something failover can fix.
   */
  async runWithFailover<T>(call: PoolCall<T>, options: FailoverOptions = {}): Promise<T> {
    const { transientAttemptsPerKey = 2, deadlineMs } = options;
    const startedAt = Date.now();
    const outOfTime = () => deadlineMs != null && Date.now() - startedAt >= deadlineMs;
    const errors: string[] = [];

    for (const key of this.keys) {
      if (!this.isAvailable(key, call.model)) continue;
      // An interactive caller would rather hear "unavailable" quickly than wait
      // out every key: 3 keys x 2 attempts x a long timeout is minutes of silence.
      if (outOfTime()) {
        errors.push("deadline reached before trying remaining keys");
        break;
      }

      for (let attempt = 1; attempt <= transientAttemptsPerKey; attempt++) {
        if (outOfTime()) {
          errors.push(`${key.label}: deadline reached`);
          break;
        }
        try {
          const remaining = deadlineMs == null ? null : deadlineMs - (Date.now() - startedAt);
          return remaining == null ? await call.run(key.client) : await withDeadline(call.run(key.client), remaining);
        } catch (err) {
          const message = (err as Error).message ?? "";

          if (QUOTA_PATTERN.test(message)) {
            this.coolDown(key, call.model, message);
            errors.push(`${key.label}: quota exhausted`);
            break; // next key
          }

          if (TRANSIENT_PATTERN.test(message) && attempt < transientAttemptsPerKey && !outOfTime()) {
            await sleep(attempt * 5000);
            continue; // same key, the service was just busy
          }

          if (TRANSIENT_PATTERN.test(message)) {
            errors.push(`${key.label}: service unavailable after ${attempt} attempts`);
            break; // try another key — it may land on a less busy backend
          }

          throw err; // not a failover-able problem
        }
      }
    }

    const allTransient = errors.length > 0 && errors.every((e) => e.includes("service unavailable") || e.includes("deadline"));
    const advice = allTransient
      ? `Every key reached ${call.model} but the service did not respond — this is an upstream outage, not a quota problem. Retry shortly.`
      : "Add another key to GEMINI_API_KEYS, or wait for the daily quota to reset.";
    throw new Error(
      `All ${this.keys.length} API key(s) failed for ${call.model}. ${errors.join("; ")}. ` +
        `Pool state: ${this.describe(call.model)}. ${advice}`,
    );
  }
}
