import { useEffect, useState } from "react";
import Icon from "./Icon";
import { api, formatInr, type AwardRecommendation, type ExplainableFigure } from "../lib/api";
import { Spinner } from "./ui";

/**
 * The standing read on the comparison, above the grid.
 *
 * It used to claim "One vendor currently has the lowest evaluated cost (—)",
 * which was wrong twice over: on a split award there is no single cheapest
 * vendor to name, and the em-dash was a null total leaking into the sentence.
 * The headline now follows the strategy the engine actually chose, and every
 * number in it opens its own derivation.
 *
 * It is also no longer badged "AI". Nothing in this banner comes from a model —
 * it is the award engine's output, and saying otherwise undersells it.
 */
export default function ProactiveInsightBanner({
  rfxId,
  onOpenCopilot,
  onExplain,
}: {
  rfxId: string;
  onOpenCopilot: () => void;
  onExplain?: (figure: ExplainableFigure, vendorId?: string) => void;
}) {
  const [award, setAward] = useState<AwardRecommendation | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setLoading(true);
    api
      .getAward(rfxId)
      .then(setAward)
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, [rfxId]);

  if (loading) {
    return (
      <div
        className="mb-4 flex items-center justify-center rounded-lg border bg-[var(--surface)] p-5"
        style={{ borderColor: "var(--line)" }}
      >
        <Spinner label="Evaluating the comparison…" />
      </div>
    );
  }
  // Fail quietly — the grid below is still perfectly usable without this strip.
  if (error || !award) return null;

  const headline = (() => {
    if (award.strategy === "single_vendor" && award.singleVendorOption) {
      return (
        <>
          <strong className="font-semibold text-[var(--ink)]">{award.singleVendorOption.vendorName}</strong> has the
          lowest evaluated cost across the items every qualified vendor priced.
        </>
      );
    }
    if (award.strategy === "split_award") {
      return (
        <>
          No single vendor is cheapest on everything. Splitting across{" "}
          <strong className="font-semibold text-[var(--ink)]">{award.allocations.length} qualified vendors</strong>{" "}
          gives the lowest evaluated cost.
        </>
      );
    }
    return <>{award.headline}</>;
  })();

  const Figure = ({ children, figure }: { children: React.ReactNode; figure: ExplainableFigure }) =>
    onExplain ? (
      <button type="button" onClick={() => onExplain(figure)} className="explainable num font-semibold">
        {children}
      </button>
    ) : (
      <span className="num font-semibold">{children}</span>
    );

  return (
    <div
      className="mb-4 overflow-hidden rounded-lg border bg-[var(--surface)]"
      style={{ borderColor: "var(--accent-line)" }}
    >
      <div
        className="flex items-center justify-between gap-3 border-b px-5 py-2"
        style={{ borderColor: "var(--line)", background: "var(--accent-soft)" }}
      >
        <span className="eyebrow" style={{ color: "var(--accent)" }}>
          Computed recommendation
        </span>
        <button
          type="button"
          onClick={onOpenCopilot}
          className="text-[12px] font-medium text-[var(--accent)] hover:underline inline-flex items-center gap-1.5"
        >
          Ask about this comparison <Icon name="arrow-right" size={12} />
        </button>
      </div>

      <div className="px-5 py-4">
        <p className="text-[13.5px] leading-relaxed text-[var(--ink-secondary)]">{headline}</p>

        <div className="mt-3 flex flex-wrap items-baseline gap-x-8 gap-y-2">
          <span className="text-[13px] text-[var(--ink-secondary)]">
            Total evaluated cost{" "}
            <Figure figure="total_evaluated_cost">{formatInr(award.totalEvaluatedCost)}</Figure>
          </span>
          {award.savings != null && (
            <span className="text-[13px] text-[var(--ink-secondary)]">
              Saving{" "}
              <span style={{ color: "var(--good)" }}>
                <Figure figure="savings">{formatInr(award.savings)}</Figure>
              </span>{" "}
              <span className="text-[12px] text-[var(--ink-muted)]">{award.savingsBaselineLabel}</span>
            </span>
          )}
          <span className="text-[13px] text-[var(--ink-secondary)]">
            Awarded{" "}
            <Figure figure="awarded_items">
              {award.awardedItemCount} / {award.totalLineItems}
            </Figure>
          </span>
        </div>

        {award.reviewBeforeAward.length > 0 && (
          <ul className="mt-3.5 space-y-1 border-t pt-3" style={{ borderColor: "var(--line)" }}>
            {award.reviewBeforeAward.slice(0, 3).map((caveat, i) => (
              <li key={i} className="flex items-start gap-2 text-[12px] leading-relaxed text-[var(--ink-secondary)]">
                <span className="mt-[2px] shrink-0" style={{ color: "var(--warning)" }}>
                  <Icon name="alert" size={12} />
                </span>
                {caveat}
              </li>
            ))}
            {award.reviewBeforeAward.length > 3 && (
              <li className="text-[12px] text-[var(--ink-muted)]">
                {award.reviewBeforeAward.length - 3} more open on the Award tab.
              </li>
            )}
          </ul>
        )}
      </div>
    </div>
  );
}
