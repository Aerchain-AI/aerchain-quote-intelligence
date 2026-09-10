import { useEffect, useState } from "react";
import AwardChoice from "../components/AwardChoice";
import { useFigureExplainer } from "../components/ExplainFigure";
import Icon from "../components/Icon";
import { Card, CardHeader, ErrorState, Skeleton, StatTile } from "../components/ui";
import { api, formatInr, type AwardOptions, type AwardRecommendation } from "../lib/api";

const STRATEGY_LABELS: Record<AwardRecommendation["strategy"], string> = {
  split_award: "Split award",
  single_vendor: "Single vendor",
  manual_review_required: "Manual review required",
};

/** PRD §22 + §23 — what, why, based on what, how confident, what to verify.
 *
 * Every figure on this screen is clickable. Behind each one is the arithmetic
 * that produced it, computed by the engine and checked against itself — because
 * a recommendation a buyer cannot audit is a recommendation they cannot sign. */
export default function AwardScreen({ rfxId }: { rfxId: string }) {
  const [data, setData] = useState<AwardRecommendation | null>(null);
  const [options, setOptions] = useState<AwardOptions | null>(null);
  const [error, setError] = useState<string | null>(null);
  const { explain, panel } = useFigureExplainer(rfxId);

  const load = () => {
    setError(null);
    api.getAward(rfxId).then(setData).catch((err) => setError(err.message));
    // The recommendation and the set of things a buyer may choose instead are
    // fetched separately: one is the engine's answer, the other is the decision.
    api.getAwardOptions(rfxId).then(setOptions).catch(() => setOptions(null));
  };
  useEffect(load, [rfxId]);

  if (error) return <ErrorState message={error} onRetry={load} />;
  if (!data)
    return (
      <div className="mx-auto max-w-5xl space-y-4">
        <Skeleton variant="tiles" />
        <div className="panel p-6">
          <Skeleton lines={4} />
        </div>
      </div>
    );

  const strategyTone =
    data.strategy === "manual_review_required" ? "var(--warning)" : "var(--ink)";

  return (
    <div className="stagger mx-auto max-w-5xl space-y-4">
      {data.provisional && (
        <div
          className="rounded-lg border px-5 py-4"
          style={{ borderColor: "var(--warning-line)", background: "var(--warning-soft)" }}
        >
          <p className="flex items-center gap-2 text-[13px] font-semibold" style={{ color: "var(--warning)" }}>
            <Icon name="alert" size={15} />
            Provisional — {data.blockingVerifications?.length ?? 0} value(s) need verifying before you award
          </p>
          <p className="measure mt-1 text-[12.5px] leading-relaxed text-[var(--ink-secondary)]">
            The recommendation below is computed and shown in full, but it depends on values the extraction model was
            unsure about. Check these against the source document in the Comparison view first.
          </p>
          <ul className="mt-2.5 space-y-1">
            {(data.blockingVerifications ?? []).map((v, i) => (
              <li key={i} className="text-[12.5px] text-[var(--ink-secondary)]">
                <span className="num font-medium text-[var(--ink)]">#{v.lineItemId}</span> · {v.vendorName} — {v.reason}
              </li>
            ))}
          </ul>
        </div>
      )}

      <Card>
        <div className="border-b px-6 py-5" style={{ borderColor: "var(--line)" }}>
          <div className="flex items-start justify-between gap-4">
            <div className="eyebrow">Recommended strategy</div>
            {/* The document that goes to whoever signs. It carries the caveats in
                their own section rather than dropping them on the way out. */}
            <a
              href={api.awardMemoUrl(rfxId)}
              target="_blank"
              rel="noopener noreferrer"
              className="pressable inline-flex items-center gap-1.5 rounded-lg border border-[var(--line-strong)] bg-[var(--surface)] px-2.5 py-[5px] text-[12px] font-medium text-[var(--ink-secondary)] hover:border-[var(--ink-muted)] hover:text-[var(--ink)]"
            >
              <Icon name="document" size={13} />
              Award memo
            </a>
          </div>
          <h2 className="display mt-1.5 text-[26px]" style={{ color: strategyTone }}>
            {STRATEGY_LABELS[data.strategy]}
          </h2>
          <p className="measure mt-2 text-[13px] leading-relaxed text-[var(--ink-secondary)]">{data.headline}</p>
        </div>

        {data.allocations.length > 0 && (
          <div>
            {data.allocations.map((a) => (
              <button
                key={a.vendorId}
                type="button"
                onClick={() => explain("allocation", a.vendorId)}
                className="pressable group flex w-full items-center justify-between gap-4 border-b px-6 py-2.5 text-left hover:bg-[var(--surface-hover)]"
                style={{ borderColor: "var(--line)" }}
                title="Show the lines this vendor won and why"
              >
                <span className="flex items-baseline gap-3">
                  <span className="text-[13.5px] font-medium text-[var(--ink)]">{a.vendorName}</span>
                  <span className="num text-[12px] text-[var(--ink-muted)]">{a.itemCount} items</span>
                </span>
                <span className="flex items-center gap-2">
                  <span className="num text-[13.5px] font-semibold text-[var(--ink)]">{formatInr(a.total)}</span>
                  <span
                    className="opacity-0 transition-opacity duration-200 group-hover:opacity-100"
                    style={{ color: "var(--ink-muted)" }}
                    aria-hidden
                  >
                    <Icon name="chevron-right" size={13} />
                  </span>
                </span>
              </button>
            ))}
          </div>
        )}

        <div className="grid grid-cols-2 gap-px sm:grid-cols-4" style={{ background: "var(--line)" }}>
          <StatTile
            label="Total evaluated cost"
            value={formatInr(data.totalEvaluatedCost)}
            onExplain={() => explain("total_evaluated_cost")}
            explainLabel="Show every line that makes up this total"
          />
          <StatTile
            label="Estimated savings"
            value={data.savings == null ? "Not enough information" : formatInr(data.savings)}
            hint={data.savingsBaselineLabel ?? undefined}
            tone={data.savings ? "good" : undefined}
            onExplain={() => explain("savings")}
            explainLabel="Show how this saving is derived, line by line"
          />
          <StatTile
            label="Awarded items"
            value={`${data.awardedItemCount} / ${data.totalLineItems}`}
            onExplain={() => explain("awarded_items")}
            explainLabel="Show which items are awarded and which are not"
          />
          <StatTile
            label="Quality-qualified vendors"
            value={String(data.qualityQualifiedVendorCount)}
            hint={
              data.vendorsWithUnresolvedQuality.length > 0
                ? `${data.vendorsWithUnresolvedQuality.length} with unresolved answers`
                : undefined
            }
            onExplain={() => explain("quality_qualified_vendors")}
            explainLabel="Show who qualified and who was disqualified"
          />
        </div>

        <div
          className="flex items-start gap-2 border-t px-6 py-2.5 text-[11.5px] leading-relaxed text-[var(--ink-muted)]"
          style={{ borderColor: "var(--line)", background: "var(--surface-sunken)" }}
        >
          <span className="mt-[1px]">
            <Icon name="derive" size={13} />
          </span>
          Every figure above is clickable. Each opens the arithmetic behind it, computed by the engine and reconciled
          against itself — no language model is involved in any number on this screen.
        </div>
      </Card>

      {options && <AwardChoice rfxId={rfxId} data={options} onDecided={load} />}

      <Card>
        <CardHeader title="Why" subtitle="Based on what, exactly" />
        <ul className="space-y-2.5 px-6 py-4">
          {data.evidence.map((e, i) => (
            <li key={i} className="flex gap-2.5 text-[13px] leading-relaxed text-[var(--ink-secondary)]">
              <span className="mt-[7px] h-1 w-1 shrink-0 rounded-full" style={{ background: "var(--ink-muted)" }} />
              <span className="measure">{e}</span>
            </li>
          ))}
        </ul>
      </Card>

      <Card className="!border-[var(--warning-line)] !bg-[var(--warning-soft)]">
        <CardHeader title="Review before award" subtitle="The system did not resolve these — a buyer has to" />
        <ul className="space-y-2 px-6 py-4">
          {data.reviewBeforeAward.length === 0 && (
            <li className="text-[13px] text-[var(--ink-secondary)]">Nothing outstanding was detected.</li>
          )}
          {data.reviewBeforeAward.map((r, i) => (
            <li key={i} className="flex gap-2.5 text-[13px] leading-relaxed text-[var(--ink-secondary)]">
              <span className="mt-[2px] shrink-0" style={{ color: "var(--warning)" }}>
                <Icon name="alert" size={13} />
              </span>
              <span className="measure">{r}</span>
            </li>
          ))}
        </ul>
      </Card>

      <Card>
        <CardHeader title="Confidence" />
        <p className="measure px-6 py-4 text-[13px] leading-relaxed text-[var(--ink-secondary)]">{data.confidenceNote}</p>
      </Card>

      {panel}
    </div>
  );
}
