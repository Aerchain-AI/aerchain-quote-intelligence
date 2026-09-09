import { prisma } from "../db.js";

/**
 * A sourcing event's timeline.
 *
 * Two sources, deliberately kept distinct:
 *   - stored RfxEvent rows (milestones someone recorded)
 *   - derived entries from real pipeline activity on this event (vendor
 *     extractions that actually ran, with their real timestamps)
 *
 * Nothing here invents a milestone to fill a gap. An event with no recorded
 * history shows its creation and nothing else.
 */

export interface TimelineEntry {
  id: string;
  type: string;
  title: string;
  detail: string | null;
  actor: string | null;
  occurredAt: string;
  /** stored = someone recorded it; derived = read from real pipeline activity. */
  source: "stored" | "derived";
}

const TYPE_ORDER: Record<string, number> = {
  created: 0,
  issued: 1,
  response_received: 2,
  extraction_complete: 3,
  shortlisted: 4,
  awarded: 5,
  note: 6,
};

export async function buildTimeline(rfxId: string): Promise<TimelineEntry[]> {
  const rfx = await prisma.rfx.findUnique({
    where: { id: rfxId },
    include: {
      buyer: true,
      timeline: { orderBy: { occurredAt: "asc" } },
      vendors: { orderBy: { name: "asc" } },
      _count: { select: { lineItems: true } },
    },
  });
  if (!rfx) return [];

  const entries: TimelineEntry[] = [];

  // Creation is always known — it is the row's own timestamp.
  entries.push({
    id: `${rfx.id}-created`,
    type: "created",
    title: "RFx created",
    detail: `${rfx._count.lineItems} line items · base currency ${rfx.currency}`,
    actor: rfx.buyer?.name ?? null,
    occurredAt: rfx.createdAt.toISOString(),
    source: "derived",
  });

  for (const e of rfx.timeline) {
    entries.push({
      id: e.id,
      type: e.type,
      title: e.title,
      detail: e.detail,
      actor: e.actor,
      occurredAt: e.occurredAt.toISOString(),
      source: "stored",
    });
  }

  // Real extraction activity, with the timings the pipeline actually recorded.
  for (const v of rfx.vendors) {
    if (!v.processedAt) continue;
    const seconds = v.processingMs ? ` in ${(v.processingMs / 1000).toFixed(1)}s` : "";
    entries.push({
      id: `${v.id}-processed`,
      type: "extraction_complete",
      title: `${v.name} response processed`,
      detail:
        `${v.itemsFoundCount ?? 0} of ${(v.itemsFoundCount ?? 0) + (v.itemsMissingCount ?? 0)} items extracted` +
        `${v.overallConfidence != null ? ` · ${Math.round(v.overallConfidence * 100)}% confidence` : ""}` +
        `${seconds} · ${v.responseFormat.toUpperCase()}`,
      actor: null,
      occurredAt: v.processedAt.toISOString(),
      source: "derived",
    });
  }

  return entries.sort((a, b) => {
    const t = new Date(a.occurredAt).getTime() - new Date(b.occurredAt).getTime();
    return t !== 0 ? t : (TYPE_ORDER[a.type] ?? 9) - (TYPE_ORDER[b.type] ?? 9);
  });
}
