import { useEffect, useState } from "react";
import { Card, CardHeader, ErrorState, Spinner } from "../components/ui";
import { api, type ImpactReport } from "../lib/api";

/** Each metric states whether it was measured here or is a stated target.
 * Nothing on this screen is an unearned performance claim. */
export default function ImpactScreen({ rfxId }: { rfxId: string }) {
  const [data, setData] = useState<ImpactReport | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = () => {
    setError(null);
    api.getMetrics(rfxId).then(setData).catch((err) => setError(err.message));
  };
  useEffect(load, [rfxId]);

  if (error) return <ErrorState message={error} onRetry={load} />;
  if (!data) return <Spinner label="Measuring…" />;

  const measured = data.metrics.filter((m) => m.basis === "measured");
  const targets = data.metrics.filter((m) => m.basis === "target");

  return (
    <div className="mx-auto max-w-5xl space-y-4">
      <Card>
        <CardHeader title="Measured in this run" subtitle="Computed from the system's own output, not estimated" />
        <div className="grid grid-cols-1 gap-px bg-[var(--line)] sm:grid-cols-2 lg:grid-cols-3">
          {measured.map((m) => (
            <div key={m.label} className="bg-[var(--surface)] px-5 py-4">
              <div className="text-[11px] uppercase tracking-wide text-[var(--ink-muted)]">{m.label}</div>
              <div className="cell-num mt-1 text-[20px] font-semibold text-[var(--ink)]">{m.value}</div>
              <p className="mt-1.5 text-[11px] leading-relaxed text-[var(--ink-muted)]">{m.detail}</p>
            </div>
          ))}
        </div>
      </Card>

      <Card className="border-dashed border-[var(--line-strong)]">
        <CardHeader
          title="Targets and assumptions"
          subtitle="Stated for context — these are not measurements of this system"
        />
        <div className="grid grid-cols-1 gap-px bg-[var(--line)] sm:grid-cols-2">
          {targets.map((m) => (
            <div key={m.label} className="bg-[var(--surface)] px-5 py-4">
              <div className="flex items-center gap-2">
                <span className="text-[11px] uppercase tracking-wide text-[var(--ink-muted)]">{m.label}</span>
                <span className="rounded bg-[var(--surface-hover)] px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-[var(--ink-muted)]">
                  Target
                </span>
              </div>
              <div className="cell-num mt-1 text-[20px] font-semibold text-[var(--ink-muted)]">{m.value}</div>
              <p className="mt-1.5 text-[11px] leading-relaxed text-[var(--ink-muted)]">{m.detail}</p>
            </div>
          ))}
        </div>
      </Card>

      <p className="text-[12px] leading-relaxed text-[var(--ink-muted)]">
        Generated {new Date(data.generatedAt).toLocaleString("en-IN")}. Extraction accuracy is measured against the
        known ground truth of the generated vendor documents — a validation measurement available in this prototype
        because those documents were authored here, not something a production deployment could compute.
      </p>
    </div>
  );
}
