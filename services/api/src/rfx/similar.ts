import { prisma } from "../db.js";

/**
 * Finds past sourcing events resembling a buyer's new request.
 *
 * Deliberately deterministic — token overlap over the event name, category,
 * description, original request and line-item names. No model call, so the
 * "have we bought this before?" answer costs nothing, never rate-limits, and
 * returns the same suggestions for the same input every time.
 */

export interface SimilarRfx {
  id: string;
  name: string;
  category: string;
  status: string;
  currency: string;
  createdAt: string;
  requiredByDate: string;
  buyerName: string | null;
  lineItemCount: number;
  /** 0-1. Only reported so the UI can order and threshold; not shown as a score. */
  score: number;
  /** The words that actually drove the match, so a suggestion is explainable. */
  matchedOn: string[];
  sampleLineItems: string[];
}

/** Words too common in procurement text to indicate similarity. */
const STOPWORDS = new Set([
  "the", "a", "an", "and", "or", "for", "of", "to", "in", "on", "with", "we", "our", "i", "need",
  "want", "require", "please", "some", "any", "new", "get", "buy", "purchase", "procure", "sourcing",
  "event", "rfx", "rfq", "items", "item", "line", "lines", "quote", "quotes", "vendor", "vendors",
  "supplier", "suppliers", "is", "are", "be", "this", "that", "it", "at", "by", "from", "across",
]);

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, " ")
    .split(/\s+/)
    .map((t) => t.trim())
    .filter((t) => t.length > 2 && !STOPWORDS.has(t))
    .map((t) => (t.endsWith("s") && t.length > 4 ? t.slice(0, -1) : t)); // crude singularisation
}

export async function findSimilarRfx(
  request: string,
  options: { excludeRfxId?: string; limit?: number; minScore?: number } = {},
): Promise<SimilarRfx[]> {
  const { excludeRfxId, limit = 4, minScore = 0.08 } = options;
  const requestTokens = new Set(tokenize(request));
  if (requestTokens.size === 0) return [];

  const candidates = await prisma.rfx.findMany({
    where: excludeRfxId ? { id: { not: excludeRfxId } } : undefined,
    include: { buyer: true, lineItems: { orderBy: { id: "asc" } } },
    orderBy: { createdAt: "desc" },
  });

  const scored: SimilarRfx[] = [];
  for (const rfx of candidates) {
    const haystack = [
      rfx.name,
      rfx.category,
      rfx.description,
      rfx.sourceRequest ?? "",
      ...rfx.lineItems.map((li) => `${li.name} ${li.specification}`),
    ].join(" ");
    const candidateTokens = new Set(tokenize(haystack));

    const matchedOn = [...requestTokens].filter((t) => candidateTokens.has(t));
    if (matchedOn.length === 0) continue;

    // Overlap relative to the request, so a short ask isn't penalised against a
    // long historical record.
    const score = matchedOn.length / requestTokens.size;
    if (score < minScore) continue;

    scored.push({
      id: rfx.id,
      name: rfx.name,
      category: rfx.category,
      status: rfx.status,
      currency: rfx.currency,
      createdAt: rfx.createdAt.toISOString(),
      requiredByDate: rfx.requiredByDate.toISOString(),
      buyerName: rfx.buyer?.name ?? null,
      lineItemCount: rfx.lineItems.length,
      score: Math.round(score * 100) / 100,
      matchedOn: matchedOn.slice(0, 6),
      sampleLineItems: rfx.lineItems.slice(0, 4).map((li) => li.name),
    });
  }

  return scored.sort((a, b) => b.score - a.score).slice(0, limit);
}


/**
 * Procurement that closed before this system, matched against a new request.
 *
 * These records carry a category, who won and what it cost, but no line items —
 * so there is nothing to copy from them and they are returned as a separate
 * list rather than mixed in with reorderable events. A precedent you can clone
 * and a precedent you can only read are different offers to make a buyer, and
 * presenting them as one would promise a button that cannot exist.
 *
 * Same deterministic token overlap, no model call.
 */
export interface SimilarPastProcurement {
  externalId: string;
  title: string;
  category: string;
  completedAt: string;
  awardedVendorName: string;
  awardValueInr: number;
  savingsInr: number | null;
  savingsPct: number | null;
  score: number;
  matchedOn: string[];
  /** Stated on every record: nothing here was computed by this system. */
  basis: string;
}

export async function findSimilarPastProcurement(
  request: string,
  options: { limit?: number; minScore?: number } = {},
): Promise<SimilarPastProcurement[]> {
  const { limit = 3, minScore = 0.08 } = options;
  const requestTokens = new Set(tokenize(request));
  if (requestTokens.size === 0) return [];

  const records = await prisma.pastProcurement.findMany({ orderBy: { completedAt: "desc" } });

  const scored = records.map((r) => {
    const haystack = tokenize(`${r.title} ${r.category} ${r.awardedVendorName}`);
    const matched = [...new Set(haystack.filter((t) => requestTokens.has(t)))];
    const score = requestTokens.size === 0 ? 0 : matched.length / requestTokens.size;
    return {
      externalId: r.externalId,
      title: r.title,
      category: r.category,
      completedAt: r.completedAt.toISOString(),
      awardedVendorName: r.awardedVendorName,
      awardValueInr: r.awardValueInr,
      savingsInr: r.savingsInr,
      savingsPct: r.savingsPct,
      score,
      matchedOn: matched,
      basis: r.source,
    };
  });

  return scored
    .filter((r) => r.score >= minScore)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}
