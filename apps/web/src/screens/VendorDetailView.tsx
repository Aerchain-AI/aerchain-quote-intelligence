import { useEffect, useState } from "react";
import Icon from "../components/Icon";
import { api, type ExtractionDetail } from "../lib/api";
import { Spinner, ErrorState, SeverityBadge, ConfidenceBadge } from "../components/ui";
import DocumentViewer from "../components/DocumentViewer";
import QuoteReviewCard from "../components/QuoteReviewCard";

export default function VendorDetailView({
  rfxId,
  vendorId,
  onBack,
}: {
  rfxId: string;
  vendorId: string;
  onBack: () => void;
}) {
  const [detail, setDetail] = useState<ExtractionDetail | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = () => {
    setError(null);
    api.getExtraction(vendorId).then(setDetail).catch((err) => setError(err.message));
  };
  useEffect(load, [vendorId]);

  if (error) return <ErrorState message={error} onRetry={load} />;
  if (!detail) return <Spinner label="Loading extraction detail…" />;

  const vendor = detail.vendor;
  
  const quoted = detail.quotes.filter((q) => q.status !== "not_quoted");
  const withCurrency = quoted.filter((q) => q.sourceCurrency).length;
  const withUnit = quoted.filter((q) => q.sourceUnit).length;
  const avgConfidence = quoted.length > 0 ? quoted.reduce((s, q) => s + (q.confidence ?? 0), 0) / quoted.length : null;

  // Filter exceptions not tied to a specific line item
  const docLevelExceptions = detail.exceptions.filter(ex => !ex.lineItemId);

  return (
    <div className="fixed inset-0 z-40 flex bg-[var(--surface)] pt-[56px] h-screen overflow-hidden">
      {/* Left Pane - Source Document */}
      <div className="w-1/2 h-full flex flex-col">
        <DocumentViewer 
          vendor={vendor} 
          sourceDocument={detail.quotes[0]?.sourceDocument}
        />
      </div>

      {/* Right Pane - Extraction & Exceptions */}
      <div className="w-1/2 h-full flex flex-col bg-[var(--surface-sunken)] overflow-y-auto">
        <div className="sticky top-0 z-10 bg-[var(--surface)] border-b border-[var(--line)] px-6 py-4 flex items-center gap-4 shadow-sm">
          <button 
            onClick={onBack}
            className="flex h-8 w-8 items-center justify-center rounded-full bg-[var(--surface-hover)] text-[var(--ink-muted)] hover:bg-[var(--line)] hover:text-[var(--ink-secondary)] transition-colors"
            title="Back to all vendors"
          >
            <Icon name="arrow-left" size={15} />
          </button>
          <div>
            <h2 className="text-[16px] font-semibold text-[var(--ink)]">{vendor.name}</h2>
            <p className="text-[12px] text-[var(--ink-muted)]">Extraction & Validation Review</p>
          </div>
        </div>

        <div className="p-6 space-y-6">
          {/* Metrics Summary */}
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-4 bg-[var(--surface)] p-5 rounded-lg border border-[var(--line)] shadow-sm">
            <Metric label="Items extracted" value={`${quoted.length} / ${detail.quotes.length}`} />
            <Metric label="Prices extracted" value={String(quoted.filter((q) => q.sourceValue != null).length)} />
            <Metric label="Units read" value={`${withUnit} / ${quoted.length || 1}`} />
            <Metric label="Currency detected" value={`${withCurrency} / ${quoted.length || 1}`} />
          </div>

          {avgConfidence != null && (
            <div className="bg-[var(--surface)] p-5 rounded-lg border border-[var(--line)] shadow-sm">
              <p className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-[var(--ink-muted)]">
                Model-reported confidence
              </p>
              <div className="flex items-center gap-4">
                <div className="flex-1">
                  <div className="mt-1.5 h-2 overflow-hidden rounded-full bg-[var(--surface-hover)]">
                    <div 
                      className={`h-full rounded-full ${avgConfidence >= 0.9 ? "bg-[var(--good)]" : avgConfidence >= 0.7 ? "bg-[var(--warning)]" : "bg-[var(--critical)]"}`} 
                      style={{ width: `${Math.round(avgConfidence * 100)}%` }} 
                    />
                  </div>
                </div>
                <span className="cell-num text-[14px] font-semibold text-[var(--ink)]">
                  {Math.round(avgConfidence * 100)}%
                </span>
              </div>
            </div>
          )}

          {/* Document Level Exceptions */}
          {docLevelExceptions.length > 0 && (
            <div className="bg-[var(--surface)] p-5 rounded-lg border border-[var(--warning-line)] shadow-sm">
              <h3 className="text-sm font-semibold text-[var(--warning)] mb-3">Document-Level Exceptions</h3>
              <div className="space-y-3">
                {docLevelExceptions.map(ex => (
                  <div key={ex.id} className="rounded border border-[var(--warning-line)] bg-[var(--warning-soft)] px-3 py-2">
                    <div className="flex items-center gap-2">
                      <SeverityBadge severity={ex.severity}>{ex.type.replace(/_/g, " ")}</SeverityBadge>
                    </div>
                    <p className="mt-1 text-[12px] text-[var(--warning)] leading-relaxed">{ex.message}</p>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Line Items */}
          <div>
            <h3 className="text-sm font-semibold text-[var(--ink)] mb-4">Extracted Line Items</h3>
            {detail.quotes.map(q => {
              const lineExceptions = detail.exceptions.filter(ex => ex.lineItemId === q.lineItemId);
              return (
                <QuoteReviewCard
                  key={q.id}
                  rfxId={rfxId}
                  vendorId={vendorId}
                  quote={q}
                  lineItem={q.lineItem}
                  exceptions={lineExceptions}
                  onUpdate={load}
                />
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-[11px] uppercase tracking-wide text-[var(--ink-muted)]">{label}</div>
      <div className="cell-num text-[16px] font-semibold text-[var(--ink)]">{value}</div>
    </div>
  );
}
