import { useEffect, useState } from "react";
import Icon from "./Icon";
import { Card, CardHeader, EmptyState } from "./ui";
import { api, formatInr, type ProcurementHistory as History } from "../lib/api";

/**
 * Procurement that completed before this system existed.
 *
 * Deliberately not shown as sourcing events. These are records that arrived with
 * the dataset: their award values and savings were supplied, and there is no
 * derivation to open behind them. Every figure this system computed can be
 * clicked and traced, and putting a number that cannot be beside numbers that
 * can would quietly devalue the ones that can.
 *
 * So they sit in their own section, the basis is stated on the panel rather than
 * hidden in a tooltip, and the totals here are never added to the computed
 * savings on the register.
 */
export default function ProcurementHistory({ compact = false }: { compact?: boolean }) {
  const [data, setData] = useState<History | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    api
      .getProcurementHistory()
      .then(setData)
      .catch(() => setFailed(true));
  }, []);

  if (failed) return null;
  if (!data) return null;

  if (data.records.length === 0) {
    return (
      <Card>
        <CardHeader title="Procurement history" subtitle="Completed before this system" />
        <EmptyState
          icon="clock"
          title="No historical records"
          hint="Completed procurements imported with a dataset appear here, kept separate from the events this system runs."
        />
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader
        title="Completed procurement"
        subtitle={`${data.records.length} record(s) closed before this system. Kept separate from the events above.`}
        action={
          <span className="num text-[12px] text-[var(--ink-muted)]">
            {formatInr(data.recordedValue)} awarded
          </span>
        }
      />

      <div>
        {data.records.map((r) => (
          <div key={r.id} className="px-5 py-3.5" style={{ borderTop: "1px solid var(--line)" }}>
            <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
              <div className="min-w-0">
                <span className="text-[13px] font-medium text-[var(--ink)]">{r.title}</span>
                <span className="num ml-2 text-[11px] text-[var(--ink-muted)]">{r.externalId}</span>
              </div>
              <span className="num text-[11.5px] text-[var(--ink-muted)]">
                {new Date(r.completedAt).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" })}
              </span>
            </div>

            <div className="mt-1 text-[12px] text-[var(--ink-secondary)]">
              Awarded to <span className="font-medium text-[var(--ink)]">{r.awardedVendorName}</span> · {r.category}
            </div>

            <div className="mt-2 flex flex-wrap items-baseline gap-x-6 gap-y-1 text-[12px]">
              <span className="text-[var(--ink-secondary)]">
                Award <span className="num font-medium text-[var(--ink)]">{formatInr(r.awardValueInr)}</span>
              </span>
              {r.baselineInr != null && (
                <span className="text-[var(--ink-secondary)]">
                  Baseline <span className="num text-[var(--ink-muted)]">{formatInr(r.baselineInr)}</span>
                </span>
              )}
              {r.savingsInr != null && (
                <span className="text-[var(--ink-secondary)]">
                  Recorded saving{" "}
                  <span className="num font-medium" style={{ color: "var(--good)" }}>
                    {formatInr(r.savingsInr)}
                  </span>
                  {r.savingsPct != null && <span className="num ml-1 text-[var(--ink-muted)]">({r.savingsPct}%)</span>}
                </span>
              )}
            </div>

            {!compact && r.participants.length > 0 && (
              <div className="mt-2 flex flex-wrap gap-1.5">
                {r.participants.map((p) => (
                  <span
                    key={p.supplierId}
                    className="inline-flex items-center gap-1.5 rounded-[5px] px-1.5 py-[2px] text-[11px]"
                    style={{
                      background: p.result === "awarded" ? "var(--good-soft)" : "var(--surface-sunken)",
                      color: p.result === "awarded" ? "var(--good)" : "var(--ink-secondary)",
                      boxShadow: `inset 0 0 0 1px ${p.result === "awarded" ? "var(--good-line)" : "var(--line)"}`,
                    }}
                  >
                    {p.result === "awarded" && <Icon name="check" size={10} />}
                    {p.name}
                    {p.performance && <span className="opacity-70">· {p.performance}</span>}
                  </span>
                ))}
              </div>
            )}
          </div>
        ))}
      </div>

      <p
        className="flex items-start gap-2 px-5 py-3 text-[11.5px] leading-relaxed text-[var(--ink-muted)]"
        style={{ borderTop: "1px solid var(--line)", background: "var(--surface-sunken)" }}
      >
        <span className="mt-[1px]">
          <Icon name="info" size={13} />
        </span>
        <span className="measure">{data.basis}</span>
      </p>
    </Card>
  );
}
