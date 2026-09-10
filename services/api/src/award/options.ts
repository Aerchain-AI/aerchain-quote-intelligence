import type { ComparisonDataset } from "../calc/dataset.js";
import { prisma } from "../db.js";
import {
  buildComparableBasket,
  cheapestPerLine,
  detectPriceOutliers,
  getQuote,
  resolveEligibleVendors,
} from "../calc/engine.js";
import { buildAwardRecommendation } from "./recommend.js";

/**
 * Every vendor the buyer could award to, with what they would need to know to
 * disagree with the recommendation.
 *
 * The engine's job is to compute the cheapest defensible split. It is not to
 * decide, and a screen that shows only its own answer quietly makes it the
 * decider — the buyer has no way to act on the things the engine cannot see: a
 * relationship, a plant visit, a supplier who is cheapest on paper and late
 * every quarter.
 *
 * So each row carries the four things that actually settle that argument. What
 * they cost on a like-for-like basis. What is missing or unresolved in their
 * response. Whether they are cleared to be paid at all. And what happened last
 * time. All of it computed, none of it a model's opinion.
 */

export interface AwardOption {
  vendorId: string;
  vendorName: string;
  responseFormat: string;

  /** Total over the basket every compared vendor priced. Null when they have gaps. */
  comparableTotal: number | null;
  /** Total over what this vendor actually priced. Not comparable across vendors. */
  ownBasketTotal: number;
  itemsQuoted: number;
  itemsMissing: number;

  /** Against the recommended total, on the same basket. Positive means dearer. */
  deltaVsRecommended: number | null;
  deltaPct: number | null;

  /** passed | unresolved | failed */
  qualityStatus: string;
  qualityHardFailures: string[];
  qualityUnresolved: number;
  eligible: boolean;
  ineligibleReason: string | null;

  /** The short list a buyer scans before choosing. */
  flags: Array<{ label: string; tone: "good" | "warning" | "critical" | "info" }>;

  /** From the supplier registry, where the response can be matched to one. */
  supplier: {
    id: string;
    verificationStatus: string;
    city: string | null;
    paymentTerms: string | null;
    onTimeDeliveryPct: number | null;
    awardsOnRecord: number;
    bidsOnRecord: number;
    qualityIncidents: number;
  } | null;

  /** Prices this vendor gave that the rest of the responses contradict. */
  outliers: Array<{
    lineItemId: number;
    lineItemName: string;
    evaluatedValue: number;
    peerMedian: number;
    multiple: number;
    reason: string;
  }>;

  /** True when the engine's recommendation already includes this vendor. */
  inRecommendation: boolean;
  recommendedItemCount: number | null;
}

export interface AwardOptions {
  recommendedTotal: number | null;
  recommendedVendorIds: string[];
  basketSize: number;
  totalLineItems: number;
  options: AwardOption[];
  /** What the buyer settled on, if anything. */
  decision: {
    kind: string;
    vendorIds: string[];
    vendorNames: string[];
    reason: string | null;
    decidedBy: string | null;
    decidedAt: Date;
    followedRecommendation: boolean;
  } | null;
}

export async function buildAwardOptions(dataset: ComparisonDataset): Promise<AwardOptions> {
  const constraints = { requireQualityPass: true };
  const recommendation = buildAwardRecommendation(dataset);
  const eligibility = resolveEligibleVendors(dataset, constraints);

  // Ranked on the basket the eligible vendors all priced, which is the only
  // like-for-like basis. Vendors with gaps still appear — a buyer may well
  // choose one and source the remainder elsewhere — but their total is marked
  // as not comparable rather than shown as if it were.
  const basket = buildComparableBasket(dataset, eligibility.eligibleVendorIds);
  const totalsById = new Map(basket.totals.map((t) => [t.vendorId, t]));

  const recommendedIds = recommendation.allocations.map((a) => a.vendorId);
  const recommendedTotal = recommendation.totalEvaluatedCost;

  // What the recommended split costs over the shared basket, and only that.
  //
  // The obvious thing — adding up each recommended vendor's comparable total —
  // is wrong by construction: every one of those totals covers the whole basket,
  // so summing two of them prices the order twice. The comparison a buyer wants
  // is "this vendor for the shared basket, against the split for the shared
  // basket", so the split is restricted to the same lines.
  const { lines: winners } = cheapestPerLine(dataset, constraints);
  const basketLineIds = new Set(basket.lineItemIds);
  const recommendedComparable = basket.lineItemIds.length
    ? Math.round(
        winners
          .filter((l) => basketLineIds.has(l.lineItemId) && l.winnerLineTotal != null)
          .reduce((sum, l) => sum + l.winnerLineTotal!, 0) * 100,
      ) / 100
    : null;

  // Prices the rest of the responses contradict, so a vendor ranked last on an
  // order-of-magnitude gap says why rather than just losing.
  const outliers = detectPriceOutliers(dataset);

  const suppliers = await prisma.supplier.findMany({
    include: { participation: true },
  });

  const options: AwardOption[] = dataset.vendors.map((vendor) => {
    const total = totalsById.get(vendor.id);
    const itemsQuoted =
      total?.itemsQuoted ??
      dataset.lineItems.filter((li) => {
        const q = getQuote(dataset, vendor.id, li.id);
        return !!q && q.status !== "not_quoted" && q.evaluatedValue != null;
      }).length;
    const itemsMissing = dataset.lineItems.length - itemsQuoted;

    let ownBasketTotal = total?.ownBasketTotal ?? 0;
    if (!total) {
      ownBasketTotal = dataset.lineItems.reduce((sum, li) => {
        const q = getQuote(dataset, vendor.id, li.id);
        return q && q.evaluatedValue != null ? sum + q.evaluatedValue * li.quantity : sum;
      }, 0);
      ownBasketTotal = Math.round(ownBasketTotal * 100) / 100;
    }

    const comparableTotal = total?.comparableTotal ?? null;
    const excluded = eligibility.excluded.find((e) => e.vendorId === vendor.id);

    // A single-vendor comparison against the recommendation only means anything
    // on the shared basket, so it is offered only where both sides have one.
    const delta =
      comparableTotal != null && recommendedComparable != null
        ? Math.round((comparableTotal - recommendedComparable) * 100) / 100
        : null;
    const deltaPct =
      delta != null && recommendedComparable
        ? Math.round((delta / recommendedComparable) * 1000) / 10
        : null;

    const vendorExceptions = dataset.exceptions.filter((e) => e.vendorId === vendor.id);
    const flags: AwardOption["flags"] = [];
    if (itemsMissing > 0) {
      flags.push({ label: `${itemsMissing} item(s) unpriced`, tone: "critical" });
    }
    if (vendorExceptions.some((e) => e.type === "missing_freight")) {
      flags.push({ label: "Freight not stated", tone: "warning" });
    }
    if (vendorExceptions.some((e) => e.type === "missing_tax")) {
      flags.push({ label: "Tax not stated", tone: "info" });
    }
    if (vendorExceptions.some((e) => e.type === "different_currency")) {
      flags.push({ label: "Quoted in another currency", tone: "info" });
    }
    const unconvertible = vendorExceptions.filter((e) => e.type === "different_unit" && e.severity !== "info").length;
    if (unconvertible > 0) {
      flags.push({ label: `${unconvertible} unit basis unresolved`, tone: "warning" });
    }
    const uncertain = vendorExceptions.filter(
      (e) => e.type === "low_confidence" || e.type === "ambiguous_value",
    ).length;
    if (uncertain > 0) {
      flags.push({ label: `${uncertain} value(s) to verify`, tone: "warning" });
    }
    if (vendor.quality.status === "failed") {
      flags.push({ label: "Failed a quality question", tone: "critical" });
    } else if (vendor.quality.status === "unresolved") {
      flags.push({ label: `${vendor.quality.unresolved.length} quality answers blank`, tone: "warning" });
    }
    const vendorOutliers = outliers.filter((o) => o.vendorId === vendor.id);
    if (vendorOutliers.length > 0) {
      flags.unshift({
        label: `${vendorOutliers.length} price(s) far outside the market`,
        tone: "critical",
      });
    }
    if (flags.length === 0) {
      flags.push({ label: "Complete, nothing outstanding", tone: "good" });
    }

    // Matched by name, the same way an uploaded response is filed against the
    // supplier who sent it.
    const supplier = suppliers.find(
      (s) => s.name.trim().toLowerCase() === vendor.name.trim().toLowerCase(),
    );
    if (supplier?.verificationStatus === "pending") {
      flags.unshift({ label: "Verification pending", tone: "warning" });
    }

    const allocation = recommendation.allocations.find((a) => a.vendorId === vendor.id);

    return {
      vendorId: vendor.id,
      vendorName: vendor.name,
      responseFormat: vendor.responseFormat,
      comparableTotal,
      ownBasketTotal,
      itemsQuoted,
      itemsMissing,
      deltaVsRecommended: delta,
      deltaPct,
      qualityStatus: vendor.quality.status,
      qualityHardFailures: vendor.quality.hardFailures,
      qualityUnresolved: vendor.quality.unresolved.length,
      eligible: eligibility.eligibleVendorIds.includes(vendor.id),
      ineligibleReason: excluded?.reason ?? null,
      flags,
      supplier: supplier
        ? {
            id: supplier.id,
            verificationStatus: supplier.verificationStatus,
            city: supplier.city,
            paymentTerms: supplier.paymentTerms,
            onTimeDeliveryPct: supplier.onTimeDeliveryPct,
            awardsOnRecord: supplier.participation.filter((p) => p.result === "awarded").length,
            bidsOnRecord: supplier.participation.length,
            qualityIncidents: supplier.participation.reduce((sum, p) => sum + p.qualityIncidents, 0),
          }
        : null,
      outliers: vendorOutliers.map((o) => ({
        lineItemId: o.lineItemId,
        lineItemName: o.lineItemName,
        evaluatedValue: o.evaluatedValue,
        peerMedian: o.peerMedian,
        multiple: o.multiple,
        reason: o.reason,
      })),
      inRecommendation: !!allocation,
      recommendedItemCount: allocation?.itemCount ?? null,
    };
  });

  // Cheapest comparable first; vendors without a comparable total after them,
  // ordered by their own coverage.
  options.sort((a, b) => {
    if (a.comparableTotal != null && b.comparableTotal != null) return a.comparableTotal - b.comparableTotal;
    if (a.comparableTotal != null) return -1;
    if (b.comparableTotal != null) return 1;
    return b.itemsQuoted - a.itemsQuoted;
  });

  const stored = await prisma.awardDecision.findUnique({ where: { rfxId: dataset.rfxId } });
  const parse = (raw: string): string[] => {
    try {
      return JSON.parse(raw) as string[];
    } catch {
      return [];
    }
  };

  return {
    recommendedTotal,
    recommendedVendorIds: recommendedIds,
    basketSize: basket.lineItemIds.length,
    totalLineItems: dataset.lineItems.length,
    options,
    decision: stored
      ? {
          kind: stored.kind,
          vendorIds: parse(stored.vendorIdsJson),
          vendorNames: parse(stored.vendorNamesJson),
          reason: stored.reason,
          decidedBy: stored.decidedBy,
          decidedAt: stored.decidedAt,
          followedRecommendation: stored.kind === "recommended",
        }
      : null,
  };
}

/**
 * Records what the buyer decided.
 *
 * An override must carry a reason. Not as bureaucracy — the reason is the whole
 * artefact. Six months on, "we awarded the dearer supplier" is indefensible and
 * "we awarded the dearer supplier because the cheaper one had not cleared
 * verification and we needed delivery in November" is a decision anyone can
 * stand behind.
 */
export async function recordAwardDecision(
  rfxId: string,
  input: { vendorIds: string[]; reason?: string | null; decidedBy?: string | null },
): Promise<{ kind: string; followedRecommendation: boolean }> {
  const dataset = await (await import("../calc/dataset.js")).loadComparisonDataset(rfxId);
  const recommendation = buildAwardRecommendation(dataset);
  const recommendedIds = recommendation.allocations.map((a) => a.vendorId).sort();
  const chosen = [...new Set(input.vendorIds)].sort();

  if (chosen.length === 0) {
    throw new Error("Choose at least one vendor to award to.");
  }
  const unknown = chosen.filter((id) => !dataset.vendors.some((v) => v.id === id));
  if (unknown.length > 0) {
    throw new Error("One or more chosen vendors are not responses on this event.");
  }

  const followed =
    chosen.length === recommendedIds.length && chosen.every((id, i) => id === recommendedIds[i]);
  const reason = input.reason?.trim() || null;
  if (!followed && !reason) {
    throw new Error(
      "Awarding against the recommendation needs a reason. It is what makes the decision defensible later.",
    );
  }

  const names = chosen.map((id) => dataset.vendors.find((v) => v.id === id)?.name ?? "Unknown vendor");

  await prisma.awardDecision.upsert({
    where: { rfxId },
    create: {
      rfxId,
      kind: followed ? "recommended" : "override",
      vendorIdsJson: JSON.stringify(chosen),
      vendorNamesJson: JSON.stringify(names),
      recommendedJson: JSON.stringify({
        strategy: recommendation.strategy,
        vendorIds: recommendedIds,
        totalEvaluatedCost: recommendation.totalEvaluatedCost,
        savings: recommendation.savings,
      }),
      reason,
      decidedBy: input.decidedBy ?? null,
    },
    update: {
      kind: followed ? "recommended" : "override",
      vendorIdsJson: JSON.stringify(chosen),
      vendorNamesJson: JSON.stringify(names),
      reason,
      decidedBy: input.decidedBy ?? null,
      decidedAt: new Date(),
    },
  });

  await prisma.rfxEvent.create({
    data: {
      rfxId,
      type: "shortlisted",
      title: followed ? "Award decision recorded" : "Award decision recorded, against the recommendation",
      detail: `${names.join(", ")}${reason ? ` — ${reason}` : ""}`,
      actor: input.decidedBy ?? null,
      occurredAt: new Date(),
    },
  });

  return { kind: followed ? "recommended" : "override", followedRecommendation: followed };
}
