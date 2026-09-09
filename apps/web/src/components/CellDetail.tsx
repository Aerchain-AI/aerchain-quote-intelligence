import { formatInr, parseJson, type ComparisonCell, type LineItem } from "../lib/api";
import Icon from "./Icon";
import { ConfidenceBadge, SeverityBadge } from "./ui";

interface MoneyAdjustment {
  amount: number;
  unit: string;
  basis?: string;
  notes?: string;
}

interface FxRate {
  from: string;
  to: string;
  rate: number;
  asOf: string;
  source: string;
}

/**
 * PRD §15 — the traceability drill-down. Every claim on this panel is either a
 * stored value or explicitly marked absent. The original value is always shown
 * next to the normalized one, so the conversion is never hidden.
 */
export default function CellDetail({
  cell,
  lineItem,
  onClose,
}: {
  cell: ComparisonCell;
  lineItem: LineItem;
  onClose: () => void;
}) {
  const q = cell.quote;
  const discount = parseJson<MoneyAdjustment>(q?.discountJson);
  const freight = parseJson<MoneyAdjustment>(q?.freightJson);
  const tax = parseJson<MoneyAdjustment>(q?.taxJson);
  const fx = parseJson<FxRate>(q?.fxRateJson);

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-end bg-[var(--surface-inverse)]" onClick={onClose}>
      <div
        className="h-full w-full max-w-xl overflow-y-auto border-l border-[var(--line)] bg-[var(--surface)] shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="sticky top-0 flex items-start justify-between gap-4 border-b border-[var(--line)] bg-[var(--surface)] px-5 py-4">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-wider text-[var(--ink-muted)]">{cell.vendorName}</p>
            <h3 className="text-sm font-semibold text-[var(--ink)]">
              #{lineItem.id} {lineItem.name}
            </h3>
            <p className="mt-0.5 text-[12px] text-[var(--ink-muted)]">
              {lineItem.specification} · {lineItem.quantity.toLocaleString("en-IN")} {lineItem.unit}
            </p>
          </div>
          <button onClick={onClose} className="rounded p-1 text-[var(--ink-muted)] hover:bg-[var(--surface-hover)] hover:text-[var(--ink-secondary)]">
            <Icon name="close" size={14} title="Close" />
          </button>
        </div>

        <div className="space-y-5 px-5 py-5">
          {!q || q.status === "not_quoted" ? (
            <div className="rounded-md border border-[var(--warning-line)] bg-[var(--warning-soft)] px-4 py-3">
              <p className="text-[13px] font-semibold text-[var(--warning)]">Not quoted</p>
              <p className="mt-1 text-[13px] text-[var(--warning)]">
                {q?.notes ?? "This vendor did not provide a usable price for this item."}
              </p>
              <p className="mt-2 text-[12px] text-[var(--warning)]">
                No value is assumed for this cell. It is excluded from totals rather than treated as zero.
              </p>
            </div>
          ) : (
            <>
              <Section label="As quoted by the vendor">
                <Row
                  label="Original value"
                  value={
                    q.sourceValue == null
                      ? "—"
                      : `${q.sourceCurrency === "USD" ? "$" : "₹"}${q.sourceValue.toLocaleString("en-IN")} ${q.sourceUnit ?? ""}`
                  }
                />
                <Row label="Currency" value={q.sourceCurrency ?? "—"} />
                <Row label="Unit basis" value={q.sourceUnit ?? "—"} />
              </Section>

              <Section label="Normalized for comparison">
                <Row
                  label="Normalized price"
                  value={q.normalizedValue == null ? "Not derivable" : `${formatInr(q.normalizedValue, { decimals: true })} per ${q.normalizedUnit}`}
                  emphasis
                />
                {fx && (
                  <>
                    <Row label="Exchange rate" value={`1 ${fx.from} = ${fx.rate} ${fx.to}`} />
                    <Row label="Rate as of" value={fx.asOf} />
                    <Row label="Rate source" value={fx.source} small />
                  </>
                )}
                <Row
                  label="Evaluated cost"
                  value={q.evaluatedValue == null ? "Not enough information" : `${formatInr(q.evaluatedValue, { decimals: true })} per ${q.normalizedUnit}`}
                  emphasis
                />
                <Row
                  label="Line total"
                  value={q.evaluatedValue == null ? "Not enough information" : formatInr(q.evaluatedValue * lineItem.quantity)}
                />
              </Section>

              <Section label="Adjustments">
                <Row
                  label="Discount"
                  value={discount ? `${discount.amount} ${discount.unit}` : "Not specified"}
                  muted={!discount}
                />
                <Row label="Freight" value={freight ? `${freight.amount} ${freight.unit}` : "Freight not specified"} muted={!freight} />
                <Row label="Tax" value={tax ? `${tax.amount} ${tax.unit}` : "Tax not specified"} muted={!tax} />
              </Section>

              <Section label="Source">
                <Row label="Document" value={q.sourceDocument ?? "—"} />
                <Row label="Location" value={q.sourceLocation ?? "—"} />
                {q.sourceExcerpt && (
                  <div className="mt-2 rounded border border-[var(--line)] bg-[var(--surface-sunken)] px-3 py-2">
                    <p className="text-[11px] font-medium uppercase tracking-wide text-[var(--ink-muted)]">Extracted from</p>
                    <p className="mt-1 font-mono text-[12px] text-[var(--ink-secondary)]">"{q.sourceExcerpt}"</p>
                  </div>
                )}
              </Section>

              <Section label="Confidence">
                <div className="flex items-center gap-2">
                  <ConfidenceBadge confidence={q.confidence} level={q.confidenceLevel} />
                  <span className="text-[12px] text-[var(--ink-muted)]">as reported by the extraction model</span>
                </div>
              </Section>

              {q.notes && (
                <Section label="Notes">
                  <p className="text-[13px] text-[var(--ink-secondary)]">{q.notes}</p>
                </Section>
              )}
            </>
          )}

          {cell.exceptions.length > 0 && (
            <Section label={`Exceptions (${cell.exceptions.length})`}>
              <div className="space-y-2">
                {cell.exceptions.map((ex) => (
                  <div key={ex.id} className="rounded border border-[var(--line)] px-3 py-2">
                    <div className="flex items-center gap-2">
                      <SeverityBadge severity={ex.severity}>{ex.type.replace(/_/g, " ")}</SeverityBadge>
                    </div>
                    <p className="mt-1.5 text-[13px] text-[var(--ink-secondary)]">{ex.message}</p>
                  </div>
                ))}
              </div>
            </Section>
          )}
        </div>
      </div>
    </div>
  );
}

function Section({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-[var(--ink-muted)]">{label}</p>
      <div className="space-y-1.5">{children}</div>
    </div>
  );
}

function Row({
  label,
  value,
  emphasis,
  muted,
  small,
}: {
  label: string;
  value: string;
  emphasis?: boolean;
  muted?: boolean;
  small?: boolean;
}) {
  return (
    <div className="flex items-baseline justify-between gap-4">
      <span className="text-[13px] text-[var(--ink-muted)]">{label}</span>
      <span
        className={`text-right ${small ? "text-[11px]" : "text-[13px]"} ${
          emphasis ? "font-semibold text-[var(--ink)]" : muted ? "italic text-[var(--ink-muted)]" : "text-[var(--ink)]"
        }`}
      >
        {value}
      </span>
    </div>
  );
}
