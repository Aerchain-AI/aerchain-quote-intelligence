import { useCallback, useEffect, useMemo, useState } from "react";
import Icon from "../components/Icon";
import CopilotDrawer from "../components/CopilotDrawer";
import { useFigureExplainer } from "../components/ExplainFigure";
import ProactiveInsightBanner from "../components/ProactiveInsightBanner";
import ReviewPanel from "../components/ReviewPanel";
import { Button, Card, ConfidenceBadge, ErrorState, NotAvailable, Spinner } from "../components/ui";
import { api, formatInr, type Comparison, type ComparisonCell, type LineItem, type VendorSummary } from "../lib/api";

/**
 * PRD §16 — the primary product screen. The comparison table occupies ~70% of
 * the width and the Procurement Copilot is permanently docked on the right ~30%.
 * Both panes scroll independently.
 */
export default function ComparisonScreen({ rfxId }: { rfxId: string }) {
  const [data, setData] = useState<Comparison | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<{ cell: ComparisonCell; lineItem: LineItem; vendor: VendorSummary } | null>(null);
  const [exceptionsOnly, setExceptionsOnly] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [contextualPrompt, setContextualPrompt] = useState<string | null>(null);
  const { explain, panel } = useFigureExplainer(rfxId);

  // Copilot highlight state
  const [highlightedVendors, setHighlightedVendors] = useState<Set<string>>(new Set());
  const [highlightedItems, setHighlightedItems] = useState<Set<number>>(new Set());
  const hasHighlights = highlightedVendors.size > 0 || highlightedItems.size > 0;

  const handleHighlight = useCallback((vendorIds: string[], lineItemIds: number[]) => {
    setHighlightedVendors(new Set(vendorIds));
    setHighlightedItems(new Set(lineItemIds));
  }, []);

  const clearHighlights = useCallback(() => {
    setHighlightedVendors(new Set());
    setHighlightedItems(new Set());
  }, []);

  const load = () => {
    setError(null);
    api.getComparison(rfxId).then(setData).catch((err) => setError(err.message));
  };
  useEffect(load, [rfxId]);

  const rows = useMemo(() => {
    if (!data) return [];
    if (!exceptionsOnly) return data.rows;
    return data.rows.filter((row) =>
      row.cells.some((c) => c.exceptions.length > 0 || !c.quote || c.quote.status !== "verified"),
    );
  }, [data, exceptionsOnly]);

  const totals = useMemo(() => {
    if (!data) return [];
    return data.vendors.map((vendor) => {
      let total = 0;
      let priced = 0;
      for (const row of data.rows) {
        const cell = row.cells.find((c) => c.vendorId === vendor.id);
        const evaluated = cell?.quote?.evaluatedValue;
        if (evaluated != null && cell?.quote?.status !== "not_quoted") {
          total += evaluated * row.lineItem.quantity;
          priced += 1;
        }
      }
      return { vendorId: vendor.id, total, priced, missing: data.rows.length - priced };
    });
  }, [data]);

  if (error) return <ErrorState message={error} onRetry={load} />;
  if (!data) return <Spinner label="Loading comparison…" />;

  const exceptionCount = data.rows.reduce((sum, r) => sum + r.cells.reduce((s, c) => s + c.exceptions.length, 0), 0);

  return (
    <div className="space-y-4">
      <ProactiveInsightBanner rfxId={rfxId} onOpenCopilot={() => setDrawerOpen(true)} onExplain={explain} />

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-5 text-[13px]">
          <span className="num font-semibold text-[var(--ink)]">{data.rows.length} items</span>
          <span className="num text-[var(--ink-secondary)]">{data.vendors.length} vendors</span>
          <span className="num" style={{ color: exceptionCount > 0 ? "var(--warning)" : "var(--ink-muted)" }}>
            {exceptionCount} line-level exceptions
          </span>
        </div>
        <div className="flex items-center gap-4">
          {hasHighlights && (
            <button
              onClick={clearHighlights}
              className="flex items-center gap-1.5 rounded-md border border-[var(--info-line)] bg-[var(--info-soft)] px-2.5 py-1 text-[11px] font-medium text-[var(--info)] transition-colors hover:bg-[var(--info-soft)]"
            >
              <Icon name="close" size={12} /> Clear highlight
            </button>
          )}
          <label className="flex cursor-pointer items-center gap-2 text-[13px] text-[var(--ink-secondary)]">
            <input
              type="checkbox"
              checked={exceptionsOnly}
              onChange={(e) => setExceptionsOnly(e.target.checked)}
              className="h-3.5 w-3.5 rounded border-[var(--line-strong)]"
            />
            Show only exceptions
          </label>
          <Button onClick={() => setDrawerOpen(true)} className="!bg-[var(--accent)] !px-3 hover:!bg-[var(--accent-hover)]">
            <span className="mr-1 inline-block align-[-2px]"><Icon name="spark" size={13} /></span> Ask AI
          </Button>
        </div>
      </div>

      <Card className="overflow-hidden">
        <div className="thin-scroll overflow-x-auto">
          <table className="grid-table">
            <thead>
              <tr>
                <th className="sticky left-0 !z-30 !text-left" style={{ background: "var(--surface-sunken)" }}>
                  Item
                </th>
                <th className="!text-right">Qty</th>
                {data.vendors.map((v) => {
                  const isHl = highlightedVendors.has(v.id);
                  return (
                    <th
                      key={v.id}
                      className="!text-right transition-colors"
                      style={isHl ? { background: "var(--accent-soft)" } : undefined}
                    >
                      <a
                        href={`/api/vendors/${v.id}/file`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="transition-colors hover:underline"
                        style={{ color: "var(--accent)", fontWeight: isHl ? 700 : 600 }}
                        title="View original document"
                      >
                        {v.name}
                      </a>
                    </th>
                  );
                })}
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => {
                const isRowHl = highlightedItems.has(row.lineItem.id);
                return (
                  <tr
                    key={row.lineItem.id}
                    className="transition-colors"
                    style={isRowHl ? { background: "var(--accent-soft)" } : undefined}
                  >
                    <td
                      className="sticky left-0 !z-10"
                      style={{ background: isRowHl ? "var(--accent-soft)" : "var(--surface)" }}
                    >
                      <div className="text-[13px] font-medium text-[var(--ink)]">
                        <span className="num mr-1.5 text-[11px] text-[var(--ink-muted)]">#{row.lineItem.id}</span>
                        {row.lineItem.name}
                      </div>
                      <div className="truncate text-[11px] text-[var(--ink-muted)]" title={row.lineItem.specification}>
                        {row.lineItem.specification}
                      </div>
                    </td>
                    <td className="cell-num text-right text-[var(--ink-secondary)]">
                      {row.lineItem.quantity.toLocaleString("en-IN")}
                      <span className="ml-1 text-[11px] text-[var(--ink-muted)]">{row.lineItem.unit}</span>
                    </td>
                    {data.vendors.map((vendor) => {
                      const cell = row.cells.find((c) => c.vendorId === vendor.id);
                      const isCellHl = highlightedVendors.has(vendor.id) || isRowHl;
                      if (!cell)
                        return (
                          <td key={vendor.id} style={isCellHl ? { background: "var(--accent-soft)" } : undefined} />
                        );
                      return (
                        <ComparisonCellView
                          key={vendor.id}
                          cell={cell}
                          highlighted={isCellHl}
                          onClick={() => setSelected({ cell, lineItem: row.lineItem, vendor })}
                        />
                      );
                    })}
                  </tr>
                );
              })}
            </tbody>
            <tfoot>
              <tr>
                <td
                  className="sticky left-0 !z-20 text-[12px] text-[var(--ink-secondary)]"
                  style={{ background: "var(--surface-sunken)" }}
                >
                  Total of priced items
                </td>
                <td />
                {data.vendors.map((v) => {
                  const t = totals.find((x) => x.vendorId === v.id);
                  const isHl = highlightedVendors.has(v.id);
                  return (
                    <td key={v.id} className={`px-3 py-2.5 text-right ${isHl ? "bg-[var(--accent-soft)]" : ""}`}>
                      {/* Clickable: a column total that mixes coverage levels is the
                          easiest number in this product to misread, so it opens the
                          row-by-row workings and names what is missing. */}
                      <button
                        type="button"
                        onClick={() => explain("vendor_total", v.id)}
                        className="explainable cell-num font-semibold text-[var(--ink)]"
                        title={`Show how ${v.name}'s column total is built`}
                      >
                        {formatInr(t?.total ?? null)}
                      </button>
                      <div className="num mt-0.5 text-[11px] font-normal text-[var(--ink-muted)]">
                        {t?.priced ?? 0} priced{t && t.missing > 0 ? `, ${t.missing} missing` : ""}
                      </div>
                    </td>
                  );
                })}
              </tr>
            </tfoot>
          </table>
        </div>
      </Card>

      <p className="text-[12px] leading-relaxed text-[var(--ink-muted)]">
        Column totals cover only the items each vendor actually priced, so they are not directly comparable where
        coverage differs — click any total to see exactly which items are in it and which are missing. Ranking uses a
        shared basket instead.
      </p>

      <CopilotDrawer
        rfxId={rfxId}
        open={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        onHighlight={handleHighlight}
        prefillPrompt={contextualPrompt}
        onPrefillConsumed={() => setContextualPrompt(null)}
      />

      {panel}

      {/* Cell review modal (overlays on top when a cell is clicked) */}
      {selected && (
        <ReviewPanel
          rfxId={rfxId}
          cell={selected.cell}
          lineItem={selected.lineItem}
          vendor={selected.vendor}
          onClose={() => setSelected(null)}
          onUpdate={load}
          onAskAI={(prompt) => {
            setContextualPrompt(prompt);
            setDrawerOpen(true);
          }}
        />
      )}
    </div>
  );
}

function ComparisonCellView({
  cell,
  highlighted,
  onClick,
}: {
  cell: ComparisonCell;
  highlighted: boolean;
  onClick: () => void;
}) {
  const q = cell.quote;
  const notQuoted = !q || q.status === "not_quoted";
  const hasException = cell.exceptions.length > 0;
  const isVerified = q?.status === "verified";
  const isLowConfidence = q?.confidence != null && q.confidence < 0.70;
  const needsReview = !notQuoted && !isVerified && (isLowConfidence || hasException || q?.status === "flagged" || q?.status === "review_required");

  return (
    <td className="text-right" style={highlighted ? { background: "var(--accent-soft)" } : undefined}>
      <button
        onClick={onClick}
        className={`group w-full rounded px-2 py-1 text-right transition-colors hover:bg-[var(--surface-hover)] ${
          notQuoted ? "" : "cursor-pointer"
        }`}
        style={{
          background: needsReview ? "var(--warning-soft)" : undefined,
          boxShadow: highlighted && !needsReview ? "inset 0 0 0 1.5px var(--accent-line)" : undefined,
        }}
      >
        {notQuoted ? (
          <NotAvailable />
        ) : (
          <>
            {/* One line, always: the mark sits beside the figure rather than
                wrapping above it when the column is narrow. */}
            <div
              className="cell-num flex items-center justify-end gap-1 whitespace-nowrap"
              style={{ color: needsReview ? "var(--warning)" : isVerified ? "var(--good)" : "var(--ink)" }}
            >
              {isVerified && <Icon name="check" size={11} />}
              {formatInr(q!.evaluatedValue, { decimals: true })}
              {needsReview && <Icon name="alert" size={11} />}
            </div>
            {q!.sourceCurrency && q!.sourceCurrency !== "INR" && (
              <div className="text-[10px]" style={{ color: "var(--info)" }}>
                from {q!.sourceCurrency}
              </div>
            )}
            {needsReview && (
              <div className="eyebrow mt-0.5 !text-[9.5px]" style={{ color: "var(--warning)" }}>
                Review required
              </div>
            )}
            {(!needsReview && isLowConfidence) && (
              <div className="mt-0.5">
                <ConfidenceBadge confidence={q!.confidence} level={q!.confidenceLevel} />
              </div>
            )}
          </>
        )}
        {hasException && !needsReview && !notQuoted && (
          <div className="text-[10px]" style={{ color: "var(--warning)" }}>
            {cell.exceptions.length} flag(s)
          </div>
        )}
      </button>
    </td>
  );
}
