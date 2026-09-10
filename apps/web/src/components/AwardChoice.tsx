import { useState } from "react";
import Icon from "./Icon";
import { Button, Card, CardHeader, InlineError, Modal } from "./ui";
import { api, formatInr, type AwardOption, type AwardOptions } from "../lib/api";

/**
 * Choosing who to award to.
 *
 * The engine computes a recommendation; this is where a person accepts or
 * overrules it. Without this the screen quietly makes the engine the decider,
 * which is the opposite of the claim the rest of the product makes — it can see
 * price, coverage and quality answers, and it cannot see a plant visit, a
 * relationship, or a supplier who is cheapest on paper and late every quarter.
 *
 * Each row carries the four things that settle that argument, all computed: what
 * they cost like-for-like, what is missing or unresolved, whether they are
 * cleared to be paid, and what happened last time.
 *
 * An override must carry a reason. The reason is the artefact — six months on,
 * "we awarded the dearer supplier" is indefensible, and "we awarded the dearer
 * supplier because the cheaper one had not cleared verification" is a decision
 * anyone can stand behind.
 */
export default function AwardChoice({
  rfxId,
  data,
  onDecided,
}: {
  rfxId: string;
  data: AwardOptions;
  onDecided: () => void;
}) {
  const [selected, setSelected] = useState<string[]>(data.decision?.vendorIds ?? data.recommendedVendorIds);
  const [confirming, setConfirming] = useState(false);
  const [reason, setReason] = useState(data.decision?.reason ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const toggle = (id: string) =>
    setSelected((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));

  const recommendedSet = [...data.recommendedVendorIds].sort().join(",");
  const followsRecommendation = [...selected].sort().join(",") === recommendedSet;
  const changed = data.decision
    ? [...selected].sort().join(",") !== [...data.decision.vendorIds].sort().join(",")
    : selected.length > 0;

  const chosenNames = selected
    .map((id) => data.options.find((o) => o.vendorId === id)?.vendorName)
    .filter(Boolean) as string[];

  const submit = async () => {
    setSaving(true);
    setError(null);
    try {
      await api.recordAwardDecision(rfxId, {
        vendorIds: selected,
        reason: followsRecommendation ? null : reason,
      });
      setConfirming(false);
      onDecided();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card>
      <CardHeader
        title="Choose who to award to"
        subtitle={`All ${data.options.length} responses, ranked on the ${data.basketSize} of ${data.totalLineItems} items every qualified vendor priced. The recommendation is pre-selected — change it if you disagree.`}
        action={
          changed ? (
            <Button icon="check" onClick={() => setConfirming(true)} disabled={selected.length === 0}>
              Record decision
            </Button>
          ) : undefined
        }
      />

      {data.decision && (
        <div
          className="flex items-start gap-2.5 px-5 py-3"
          style={{
            background: data.decision.followedRecommendation ? "var(--good-soft)" : "var(--warning-soft)",
            borderBottom: "1px solid var(--line)",
          }}
        >
          <span
            className="mt-[1px]"
            style={{ color: data.decision.followedRecommendation ? "var(--good)" : "var(--warning)" }}
          >
            <Icon name={data.decision.followedRecommendation ? "check-circle" : "alert"} size={14} />
          </span>
          <div className="text-[12.5px] leading-relaxed text-[var(--ink-secondary)]">
            <span className="font-medium text-[var(--ink)]">
              Awarded to {data.decision.vendorNames.join(", ")}
            </span>
            {data.decision.followedRecommendation
              ? " — the recommendation was accepted."
              : " — against the recommendation."}
            {data.decision.reason && <div className="measure mt-0.5">Reason given: {data.decision.reason}</div>}
            <div className="num mt-0.5 text-[11px] text-[var(--ink-muted)]">
              {new Date(data.decision.decidedAt).toLocaleString("en-IN", {
                day: "numeric",
                month: "short",
                year: "numeric",
                hour: "2-digit",
                minute: "2-digit",
              })}
            </div>
          </div>
        </div>
      )}

      <div>
        {data.options.map((o) => (
          <OptionRow
            key={o.vendorId}
            option={o}
            checked={selected.includes(o.vendorId)}
            onToggle={() => toggle(o.vendorId)}
          />
        ))}
      </div>

      <Modal
        open={confirming}
        onClose={() => setConfirming(false)}
        title="Record the award decision"
        subtitle={
          followsRecommendation
            ? "This matches the recommendation."
            : "This differs from the recommendation, so it needs a reason."
        }
        width="max-w-xl"
        footer={
          <div className="flex items-center justify-end gap-2">
            <Button variant="ghost" onClick={() => setConfirming(false)}>
              Cancel
            </Button>
            <Button
              icon="check"
              onClick={submit}
              disabled={saving || (!followsRecommendation && reason.trim().length < 8)}
            >
              {saving ? "Recording…" : "Confirm award"}
            </Button>
          </div>
        }
      >
        <div className="space-y-4 px-6 py-5">
          <div>
            <div className="eyebrow">Awarding to</div>
            <ul className="mt-1.5 space-y-1">
              {chosenNames.map((n) => (
                <li key={n} className="flex items-center gap-2 text-[13px] text-[var(--ink)]">
                  <Icon name="check" size={12} />
                  {n}
                </li>
              ))}
            </ul>
          </div>

          {!followsRecommendation && (
            <div>
              <div className="eyebrow">Why not the recommendation</div>
              <p className="measure mt-1 text-[12px] leading-relaxed text-[var(--ink-secondary)]">
                The engine recommended {data.recommendedVendorIds.length} vendor(s) at{" "}
                {formatInr(data.recommendedTotal)}. Say what you know that it does not — this is what makes the
                decision defensible when someone reads it back.
              </p>
              <textarea
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                rows={3}
                placeholder="e.g. Deccan has not cleared verification and we need delivery before the November peak."
                className="mt-2 w-full resize-y rounded-lg border border-[var(--line-strong)] bg-[var(--surface)] p-3 text-[13px] leading-relaxed outline-none placeholder:text-[var(--ink-muted)] focus:border-[var(--ink)]"
              />
            </div>
          )}

          {error && <InlineError message={error} onDismiss={() => setError(null)} />}
        </div>
      </Modal>
    </Card>
  );
}

/** One vendor, on one line: cost, gaps, clearance, track record. */
function OptionRow({
  option: o,
  checked,
  onToggle,
}: {
  option: AwardOption;
  checked: boolean;
  onToggle: () => void;
}) {
  const dearer = o.deltaVsRecommended != null && o.deltaVsRecommended > 0;
  return (
    <label
      className="flex cursor-pointer items-start gap-3 px-5 py-3.5 transition-colors hover:bg-[var(--surface-hover)]"
      style={{
        borderTop: "1px solid var(--line)",
        background: checked ? "var(--accent-soft)" : undefined,
        opacity: o.eligible ? 1 : 0.72,
      }}
    >
      <input
        type="checkbox"
        checked={checked}
        onChange={onToggle}
        disabled={!o.eligible}
        className="mt-[3px] h-3.5 w-3.5 shrink-0 accent-[var(--ink)]"
      />

      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <span className="text-[13.5px] font-medium text-[var(--ink)]">{o.vendorName}</span>
          {o.inRecommendation && (
            <span
              className="rounded-[4px] px-1.5 py-[1px] text-[10px] font-medium uppercase tracking-[0.06em]"
              style={{ background: "var(--good-soft)", color: "var(--good)", boxShadow: "inset 0 0 0 1px var(--good-line)" }}
            >
              Recommended · {o.recommendedItemCount} items
            </span>
          )}
          {!o.eligible && (
            <span className="text-[11px]" style={{ color: "var(--critical)" }}>
              Not eligible — {o.ineligibleReason}
            </span>
          )}
        </div>

        {/* The one line: what it costs, what it covers, what it would change. */}
        <div className="mt-1 flex flex-wrap items-baseline gap-x-5 gap-y-1 text-[12px] text-[var(--ink-secondary)]">
          <span>
            {o.comparableTotal != null ? (
              <>
                <span className="num font-medium text-[var(--ink)]">{formatInr(o.comparableTotal)}</span>
                <span className="ml-1 text-[11px] text-[var(--ink-muted)]">on the shared basket</span>
              </>
            ) : (
              <>
                <span className="num font-medium text-[var(--ink)]">{formatInr(o.ownBasketTotal)}</span>
                <span className="ml-1 text-[11px]" style={{ color: "var(--warning)" }}>
                  not comparable — {o.itemsWithoutComparablePrice} without a comparable price
                </span>
              </>
            )}
          </span>

          <span className="num text-[11.5px] text-[var(--ink-muted)]">
            {o.itemsQuoted} comparable{o.itemsWithoutComparablePrice > 0 ? `, ${o.itemsWithoutComparablePrice} not` : ""}
          </span>

          {o.deltaVsRecommended != null && o.deltaVsRecommended !== 0 && (
            <span className="num text-[11.5px]" style={{ color: dearer ? "var(--warning)" : "var(--good)" }}>
              {dearer ? "+" : ""}
              {formatInr(o.deltaVsRecommended)}
              {o.deltaPct != null && ` (${dearer ? "+" : ""}${o.deltaPct}%)`} vs recommendation
            </span>
          )}

          {o.supplier?.paymentTerms && (
            <span className="text-[11.5px] text-[var(--ink-muted)]">{o.supplier.paymentTerms}</span>
          )}
        </div>

        {/* Track record, where the response matches a registered supplier. */}
        {o.supplier && (
          <div className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-[var(--ink-muted)]">
            {o.supplier.city && <span>{o.supplier.city}</span>}
            {o.supplier.bidsOnRecord > 0 ? (
              <span className="num">
                {o.supplier.awardsOnRecord} award(s) from {o.supplier.bidsOnRecord} bid(s)
              </span>
            ) : (
              <span>No previous procurement on record</span>
            )}
            {o.supplier.onTimeDeliveryPct != null && (
              <span className="num">{o.supplier.onTimeDeliveryPct}% on time</span>
            )}
            <span className="num" style={{ color: o.supplier.qualityIncidents > 0 ? "var(--warning)" : undefined }}>
              {o.supplier.qualityIncidents} quality incident(s)
            </span>
          </div>
        )}

        {/* An order-of-magnitude gap is not a competitive position. Naming the
            line and the likely cause beats ranking the vendor last in silence. */}
        {o.outliers.length > 0 && (
          <div
            className="mt-2 rounded-lg px-3 py-2"
            style={{ border: "1px solid var(--critical-line)", background: "var(--critical-soft)" }}
          >
            <div className="flex items-center gap-1.5 text-[11.5px] font-medium" style={{ color: "var(--critical)" }}>
              <Icon name="alert" size={12} />
              {o.outliers.length} price(s) the other responses contradict
            </div>
            <ul className="mt-1 space-y-0.5">
              {o.outliers.slice(0, 3).map((x) => (
                <li key={x.lineItemId} className="text-[11px] leading-relaxed text-[var(--ink-secondary)]">
                  <span className="num">#{x.lineItemId}</span> {x.lineItemName} —{" "}
                  <span className="num">{formatInr(x.evaluatedValue)}</span> against a market median of{" "}
                  <span className="num">{formatInr(x.peerMedian)}</span>. {x.reason}
                </li>
              ))}
              {o.outliers.length > 3 && (
                <li className="text-[11px] text-[var(--ink-muted)]">
                  and {o.outliers.length - 3} more on other lines.
                </li>
              )}
            </ul>
          </div>
        )}

        <div className="mt-1.5 flex flex-wrap gap-1.5">
          {o.flags.map((f) => (
            <span
              key={f.label}
              className="inline-flex items-center gap-1 rounded-[4px] px-1.5 py-[1px] text-[10.5px]"
              style={{
                background:
                  f.tone === "good"
                    ? "var(--good-soft)"
                    : f.tone === "critical"
                      ? "var(--critical-soft)"
                      : f.tone === "warning"
                        ? "var(--warning-soft)"
                        : "var(--surface-sunken)",
                color:
                  f.tone === "good"
                    ? "var(--good)"
                    : f.tone === "critical"
                      ? "var(--critical)"
                      : f.tone === "warning"
                        ? "var(--warning)"
                        : "var(--ink-secondary)",
              }}
            >
              {f.tone !== "info" && (
                <Icon name={f.tone === "good" ? "check" : f.tone === "critical" ? "close" : "alert"} size={10} />
              )}
              {f.label}
            </span>
          ))}
        </div>
      </div>
    </label>
  );
}
