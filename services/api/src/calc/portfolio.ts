import { buildAwardRecommendation } from "../award/recommend.js";
import { prisma } from "../db.js";
import { loadComparisonDataset } from "./dataset.js";
import type { Derivation, DerivationCheck, DerivationTable } from "./derivation.js";

/**
 * Portfolio-level figures for the sourcing register.
 *
 * These used to be fiction: savings captured was the literal string "₹18.5 L",
 * and active spend was vendors × line items × ₹15,000. Both looked plausible and
 * neither was defensible, which is the one thing this product cannot afford —
 * a headline nobody can trace is worse than no headline.
 *
 * They are now summed from the same award engine that produces each event's own
 * recommendation, and each one opens the per-event breakdown behind it. Events
 * with no priced responses contribute nothing and are named, rather than being
 * quietly averaged in or padded to zero.
 *
 * No language model is involved here either.
 */

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

interface EventContribution {
  rfxId: string;
  name: string;
  status: string;
  vendorCount: number;
  totalEvaluatedCost: number | null;
  savings: number | null;
  baselineLabel: string | null;
  /** Set when this event contributes nothing, and why. */
  omittedReason: string | null;
}

export interface PortfolioMetrics {
  /** Sum of savings on events that have actually been awarded. */
  savingsCaptured: number;
  /** Evaluated value of awarded events. */
  awardedValue: number;
  /** Evaluated value of events still in flight that have priced responses. */
  activeValue: number;
  counts: { total: number; active: number; draft: number; awarded: number };
  /** Awarded or active events with nothing priced yet. */
  eventsWithoutPricing: number;
}

async function contributions(statuses: string[]): Promise<EventContribution[]> {
  const events = await prisma.rfx.findMany({
    where: { status: { in: statuses } },
    select: { id: true, name: true, status: true, _count: { select: { vendors: true } } },
    orderBy: { createdAt: "desc" },
  });

  const results: EventContribution[] = [];
  for (const event of events) {
    const base = {
      rfxId: event.id,
      name: event.name,
      status: event.status,
      vendorCount: event._count.vendors,
    };
    if (event._count.vendors === 0) {
      results.push({
        ...base,
        totalEvaluatedCost: null,
        savings: null,
        baselineLabel: null,
        omittedReason: "No vendor responses on record",
      });
      continue;
    }
    try {
      const dataset = await loadComparisonDataset(event.id);
      const award = buildAwardRecommendation(dataset);
      results.push({
        ...base,
        totalEvaluatedCost: award.totalEvaluatedCost,
        savings: award.savings,
        baselineLabel: award.savingsBaselineLabel,
        omittedReason:
          award.totalEvaluatedCost == null
            ? "No quality-qualified vendor supplied usable pricing"
            : award.savings == null
              ? "Priced, but no single-vendor baseline exists to measure a saving against"
              : null,
      });
    } catch (err) {
      results.push({
        ...base,
        totalEvaluatedCost: null,
        savings: null,
        baselineLabel: null,
        omittedReason: `Could not be evaluated: ${(err as Error).message}`,
      });
    }
  }
  return results;
}

export async function buildPortfolioMetrics(): Promise<PortfolioMetrics> {
  const [awarded, active, counts] = await Promise.all([
    contributions(["awarded"]),
    contributions(["active", "in_fulfillment"]),
    prisma.rfx.groupBy({ by: ["status"], _count: { _all: true } }),
  ]);

  const countFor = (status: string) => counts.find((c) => c.status === status)?._count._all ?? 0;

  return {
    savingsCaptured: round2(awarded.reduce((s, e) => s + (e.savings ?? 0), 0)),
    awardedValue: round2(awarded.reduce((s, e) => s + (e.totalEvaluatedCost ?? 0), 0)),
    activeValue: round2(active.reduce((s, e) => s + (e.totalEvaluatedCost ?? 0), 0)),
    counts: {
      total: counts.reduce((s, c) => s + c._count._all, 0),
      active: countFor("active") + countFor("in_fulfillment"),
      draft: countFor("draft") + countFor("pending_approval"),
      awarded: countFor("awarded"),
    },
    eventsWithoutPricing: [...awarded, ...active].filter((e) => e.totalEvaluatedCost == null).length,
  };
}

// ------------------------------------------------------------- derivations

export const PORTFOLIO_FIGURES = ["portfolio_savings", "portfolio_active_value", "portfolio_awarded_value"] as const;
export type PortfolioFigure = (typeof PORTFOLIO_FIGURES)[number];

const PROVENANCE =
  "Summed from each event's own award calculation by the deterministic engine. No language model participated in this arithmetic or in this explanation.";

function contributionTables(rows: EventContribution[], moneyKey: "savings" | "totalEvaluatedCost"): DerivationTable[] {
  const counted = rows.filter((e) => e[moneyKey] != null);
  const omitted = rows.filter((e) => e[moneyKey] == null);

  const tables: DerivationTable[] = [
    {
      caption: `Events counted (${counted.length})`,
      columns: [
        { key: "name", label: "Sourcing event", align: "left", kind: "text" },
        { key: "vendors", label: "Responses", align: "right", kind: "number" },
        { key: "basis", label: "Measured against", align: "left", kind: "text" },
        { key: "value", label: moneyKey === "savings" ? "Saving" : "Evaluated value", align: "right", kind: "currency" },
      ],
      rows: counted.map((e) => ({
        name: e.name,
        vendors: e.vendorCount,
        basis: e.baselineLabel ?? "Lowest evaluated cost per line",
        value: e[moneyKey],
      })),
      footer: {
        name: "Total",
        value: round2(counted.reduce((s, e) => s + (e[moneyKey] ?? 0), 0)),
      },
    },
  ];

  if (omitted.length > 0) {
    tables.push({
      caption: `Events contributing nothing (${omitted.length})`,
      note: "Counted as absent, not as zero. An event with no usable pricing has no measurable value — treating it as ₹0 would drag the headline down as if it had been sourced for free.",
      columns: [
        { key: "name", label: "Sourcing event", align: "left", kind: "text" },
        { key: "reason", label: "Reason", align: "left", kind: "text" },
      ],
      rows: omitted.map((e) => ({ name: e.name, reason: e.omittedReason ?? "Not evaluated" })),
    });
  }
  return tables;
}

/** Re-adds the rows the reader can actually see. If the table and the headline
 * ever diverge, this is what catches it — the number on screen has to be the sum
 * of the rows on screen, not merely of an accumulator the reader cannot inspect. */
function tableSumCheck(headline: number, table: DerivationTable): DerivationCheck {
  const summed = round2(table.rows.reduce((s, r) => s + (Number(r.value) || 0), 0));
  return {
    label: "The rows listed below add up to the headline",
    expected: headline,
    actual: summed,
    ok: Math.abs(headline - summed) < 0.01,
    method: "Re-added the value column of the table shown in this panel, so what is displayed has to reconcile with what is claimed.",
  };
}

function partitionCheck(total: number, counted: number, omitted: number, scope: string): DerivationCheck {
  return {
    label: `Counted plus omitted equals the ${scope}`,
    expected: total,
    actual: counted + omitted,
    ok: counted + omitted === total,
    method: `Counted both partitions separately and compared against the ${scope}. Anything missing from both would silently disappear from the headline.`,
  };
}

export async function explainPortfolioFigure(figure: string): Promise<Derivation | null> {
  if (figure === "portfolio_savings") {
    const rows = await contributions(["awarded"]);
    const counted = rows.filter((e) => e.savings != null);
    const total = round2(counted.reduce((s, e) => s + (e.savings ?? 0), 0));
    return {
      figure,
      title: "Savings captured",
      value: total,
      valueKind: "currency",
      formula: "savings captured = Σ (per-event saving) over awarded events",
      rule:
        "Only awarded events count. A saving on an event still out to bid has not been captured — it is a forecast, and mixing the two makes the headline unfalsifiable. Each event's saving is measured against the cheapest single supplier that could have covered its whole award.",
      terms: [
        { role: "input", label: "Awarded events on record", value: rows.length, kind: "count" },
        { role: "input", label: "of which have a measurable saving", value: counted.length, kind: "count" },
        { role: "result", label: "Savings captured", value: total },
      ],
      tables: contributionTables(rows, "savings"),
      inclusions: ["Awarded events where a single-vendor baseline exists to measure the award against."],
      exclusions: [
        "Events still active or in draft — those savings are forecast, not captured.",
        "Awarded events with no priced responses, which contribute nothing rather than zero.",
      ],
      checks: [
        tableSumCheck(total, contributionTables(rows, "savings")[0]),
        partitionCheck(rows.length, counted.length, rows.length - counted.length, "awarded events on record"),
        {
          label: "Every counted event has a named baseline",
          expected: counted.length,
          actual: counted.filter((e) => e.baselineLabel != null).length,
          ok: counted.every((e) => e.baselineLabel != null),
          method:
            "Counted the events whose saving is measured against an identified alternative supplier. A saving with no named baseline cannot be defended.",
        },
      ],
      provenance: PROVENANCE,
    };
  }

  if (figure === "portfolio_active_value" || figure === "portfolio_awarded_value") {
    const isActive = figure === "portfolio_active_value";
    const rows = await contributions(isActive ? ["active", "in_fulfillment"] : ["awarded"]);
    const counted = rows.filter((e) => e.totalEvaluatedCost != null);
    const total = round2(counted.reduce((s, e) => s + (e.totalEvaluatedCost ?? 0), 0));
    return {
      figure,
      title: isActive ? "Active sourcing value" : "Awarded value",
      value: total,
      valueKind: "currency",
      formula: `value = Σ (event total evaluated cost) over ${isActive ? "active" : "awarded"} events`,
      rule:
        "Each event contributes the evaluated cost of its own recommended award — every line at whichever quality-qualified vendor priced it lowest. Nothing is estimated from item counts or vendor counts.",
      terms: [
        { role: "input", label: `${isActive ? "Active" : "Awarded"} events`, value: rows.length, kind: "count" },
        { role: "input", label: "of which have usable pricing", value: counted.length, kind: "count" },
        { role: "result", label: isActive ? "Active sourcing value" : "Awarded value", value: total },
      ],
      tables: contributionTables(rows, "totalEvaluatedCost"),
      inclusions: [`${isActive ? "Active and in-fulfilment" : "Awarded"} events with at least one usable price.`],
      exclusions: [
        "Draft events, which have no responses to price.",
        "Events where no quality-qualified vendor supplied a usable price — those contribute nothing rather than a guess.",
      ],
      checks: [
        tableSumCheck(total, contributionTables(rows, "totalEvaluatedCost")[0]),
        partitionCheck(rows.length, counted.length, rows.length - counted.length, "events with this status"),
      ],
      provenance: PROVENANCE,
    };
  }

  return null;
}
