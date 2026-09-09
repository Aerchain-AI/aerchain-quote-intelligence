import { useEffect, useState } from "react";
import Icon from "../components/Icon";
import { Card, CardHeader, EmptyState, ErrorState, Skeleton } from "../components/ui";
import { api, type AccuracyReport, type ImpactReport } from "../lib/api";

/**
 * What the system got right, measured rather than asserted.
 *
 * This screen was computed and unreachable — the accuracy endpoint existed and
 * no route pointed at it. That is the wrong thing to leave hidden: a buyer
 * deciding whether to trust an extracted price wants to know how often the
 * extraction has been wrong, and a claim of accuracy nobody can open is worth
 * about as much as a savings figure nobody can trace.
 *
 * Accuracy is only measurable where ground truth exists, which is true of the
 * generated reference documents and false of a real supplier's quotation. The
 * screen says so rather than quietly reporting on a subset.
 */
export default function TrustScreen({ rfxId }: { rfxId: string }) {
  const [impact, setImpact] = useState<ImpactReport | null>(null);
  const [accuracy, setAccuracy] = useState<AccuracyReport | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);

  const load = () => {
    setError(null);
    Promise.all([api.getMetrics(rfxId), api.getAccuracy(rfxId).catch(() => null)])
      .then(([m, a]) => {
        setImpact(m);
        setAccuracy(a);
      })
      .catch((err) => setError(err.message))
      .finally(() => setLoaded(true));
  };
  useEffect(load, [rfxId]);

  if (error) return <ErrorState message={error} onRetry={load} />;
  if (!loaded || !impact)
    return (
      <div className="mx-auto max-w-5xl space-y-4">
        <Skeleton variant="tiles" />
        <Skeleton variant="table" rows={5} cols={4} />
      </div>
    );

  const measured = impact.metrics.filter((m) => m.basis === "measured");
  const targets = impact.metrics.filter((m) => m.basis !== "measured");

  return (
    <div className="stagger mx-auto max-w-5xl space-y-4">
      <Card>
        <CardHeader
          title="Measured in this run"
          subtitle="Computed from the system's own output. Nothing on this screen is an unearned performance claim."
        />
        {measured.length === 0 ? (
          <EmptyState
            icon="derive"
            title="Nothing to measure yet"
            hint="Process at least one vendor response and these figures are computed from the result."
          />
        ) : (
          <div className="grid grid-cols-1 gap-px sm:grid-cols-2 lg:grid-cols-3" style={{ background: "var(--line)" }}>
            {measured.map((m) => (
              <div key={m.label} className="bg-[var(--surface)] px-5 py-4">
                <div className="eyebrow">{m.label}</div>
                <div className="num-lg mt-1.5 text-[19px] font-semibold text-[var(--ink)]">{m.value}</div>
                {m.detail && <div className="mt-1 text-[11.5px] leading-relaxed text-[var(--ink-muted)]">{m.detail}</div>}
              </div>
            ))}
          </div>
        )}
      </Card>

      {accuracy ? (
        <Card>
          <CardHeader
            title="Extraction accuracy against ground truth"
            subtitle="Only possible because these reference documents were authored here. A real supplier quotation has no ground truth, so this is a prototype validation measurement, not a live one."
          />
          <div className="grid grid-cols-2 gap-px sm:grid-cols-4" style={{ background: "var(--line)" }}>
            <Tile
              label="Price accuracy"
              value={accuracy.overallPriceAccuracy == null ? "n/a" : `${Math.round(accuracy.overallPriceAccuracy * 100)}%`}
              tone="good"
            />
            <Tile
              label="Omissions detected"
              value={accuracy.omissionDetectionAccuracy == null ? "n/a" : `${Math.round(accuracy.omissionDetectionAccuracy * 100)}%`}
              tone="good"
            />
            <Tile label="Fields compared" value={`${accuracy.totalCorrect} / ${accuracy.totalPricedFields}`} />
            <Tile
              label="Mismatches"
              value={String(accuracy.mismatches.length)}
              tone={accuracy.mismatches.length > 0 ? "warning" : undefined}
            />
          </div>

          <div className="thin-scroll overflow-x-auto" style={{ borderTop: "1px solid var(--line)" }}>
            <table className="grid-table">
              <thead>
                <tr>
                  <th className="!text-left">Vendor</th>
                  <th className="!text-right">Prices correct</th>
                  <th className="!text-right">Accuracy</th>
                  <th className="!text-right">Omissions caught</th>
                  <th className="!text-right">Falsely called missing</th>
                </tr>
              </thead>
              <tbody>
                {accuracy.perVendor.map((v) => (
                  <tr key={v.vendorName}>
                    <td className="text-left">{v.vendorName}</td>
                    <td className="num text-right">
                      {v.pricedFieldsCorrect} / {v.pricedFieldsExpected}
                    </td>
                    <td className="num text-right">
                      {v.priceAccuracy == null ? "n/a" : `${Math.round(v.priceAccuracy * 100)}%`}
                    </td>
                    <td className="num text-right">
                      {v.omissionsCorrectlyDetected} / {v.omissionsExpected}
                    </td>
                    <td
                      className="num text-right"
                      style={{ color: v.falselyReportedMissing > 0 ? "var(--warning)" : undefined }}
                    >
                      {v.falselyReportedMissing}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <p className="measure px-5 py-3.5 text-[11.5px] leading-relaxed text-[var(--ink-muted)]">{accuracy.basis}</p>

          {accuracy.mismatches.length > 0 && (
            <div className="thin-scroll overflow-x-auto" style={{ borderTop: "1px solid var(--line)" }}>
              <table className="grid-table">
                <thead>
                  <tr>
                    <th className="!text-left">Vendor</th>
                    <th className="!text-left">Item #</th>
                    <th className="!text-right">Expected</th>
                    <th className="!text-right">Extracted</th>
                    <th className="!text-left">Why it differs</th>
                  </tr>
                </thead>
                <tbody>
                  {accuracy.mismatches.map((m, i) => (
                    <tr key={i}>
                      <td className="text-left">{m.vendorName}</td>
                      <td className="num text-left">#{m.lineItemId}</td>
                      <td className="num text-right">{m.expected ?? "not quoted"}</td>
                      <td className="num text-right" style={{ color: "var(--warning)" }}>
                        {m.extracted ?? "not quoted"}
                      </td>
                      <td className="text-left text-[var(--ink-secondary)]">{m.note ?? "Value differs from ground truth."}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      ) : (
        <Card>
          <CardHeader title="Extraction accuracy" subtitle="Not measurable for this event" />
          <div className="px-5 py-4 text-[13px] leading-relaxed text-[var(--ink-secondary)]">
            <p className="measure">
              Accuracy can only be measured where the correct answer is already known. It is known for the reference
              documents authored for this prototype, and it is not known for a real supplier's quotation, which is the
              whole reason extraction is needed.
            </p>
            <p className="measure mt-2.5">
              For responses without ground truth, the honest signals are the per-value confidence bands on the
              comparison and the exception list. Both are shown rather than averaged into a single reassuring number.
            </p>
          </div>
        </Card>
      )}

      {targets.length > 0 && (
        <Card>
          <CardHeader title="Stated targets" subtitle="Not measured here. Listed so the two are never confused." />
          <ul className="space-y-2 px-5 py-4">
            {targets.map((m) => (
              <li key={m.label} className="flex items-baseline justify-between gap-4 text-[13px]">
                <span className="text-[var(--ink-secondary)]">{m.label}</span>
                <span className="num text-[var(--ink-muted)]">{m.value}</span>
              </li>
            ))}
          </ul>
        </Card>
      )}

      <p className="flex items-start gap-2 px-1 text-[11.5px] leading-relaxed text-[var(--ink-muted)]">
        <span className="mt-[1px]">
          <Icon name="info" size={13} />
        </span>
        <span className="measure">
          A model read the vendor documents. Every number on this screen, and every number it reports on, was computed
          by the calculation engine.
        </span>
      </p>
    </div>
  );
}

function Tile({ label, value, tone }: { label: string; value: string; tone?: "good" | "warning" }) {
  const color = tone === "good" ? "var(--good)" : tone === "warning" ? "var(--warning)" : "var(--ink)";
  return (
    <div className="bg-[var(--surface)] px-5 py-4">
      <div className="eyebrow">{label}</div>
      <div className="num-lg mt-1.5 text-[19px] font-semibold" style={{ color }}>
        {value}
      </div>
    </div>
  );
}
