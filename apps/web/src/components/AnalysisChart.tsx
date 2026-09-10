import { useState } from "react";
import { BarChart, BeforeAfterChart, ChartFrame, ChartTable, type BarDatum } from "./Chart";
import Icon from "./Icon";
import { formatInr, type CopilotAnswer } from "../lib/api";

/**
 * Turns a copilot answer into a chart.
 *
 * The mapping from analysis to chart form is a fixed switch in this file. The
 * model never emits a chart specification, a series list or an axis choice — it
 * routed the question to one of a fixed set of analyses, the engine computed
 * that analysis, and this code draws the object it returned.
 *
 * That matters for the same reason the arithmetic split matters. A model asked
 * to pick a chart will occasionally pick a misleading one, and a misleading
 * chart is harder to catch than a wrong number because nobody re-adds a bar.
 *
 * Analyses whose answer is genuinely prose — a vendor's risk profile, the
 * commercial terms table — get no chart rather than a decorative one.
 */

interface VendorTotalish {
  vendorName: string;
  comparableTotal: number | null;
  ownBasketTotal: number;
  itemsQuoted: number;
  itemsWithoutComparablePrice: number;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : null;
}

export default function AnalysisChart({ answer }: { answer: CopilotAnswer }) {
  const [showTable, setShowTable] = useState(false);
  const calc = asRecord(answer.calculation);
  if (!calc || !answer.supported) return null;

  const toggle = (
    <button
      type="button"
      onClick={() => setShowTable((v) => !v)}
      className="pressable inline-flex items-center gap-1 text-[11px] font-medium text-[var(--ink-secondary)] hover:text-[var(--ink)]"
    >
      <Icon name={showTable ? "chevron-down" : "chevron-right"} size={11} />
      {showTable ? "Hide table" : "Show as table"}
    </button>
  );

  switch (answer.analysisType) {
    // ------------------------------------------------ ranking across vendors
    case "cheapest_overall": {
      const ranking = (calc.ranking as VendorTotalish[] | undefined) ?? [];
      const basketSize = Number(calc.basketSize ?? 0);
      const totalLineItems = Number(calc.totalLineItems ?? 0);
      const priced = ranking.filter((r) => r.comparableTotal != null);
      if (priced.length === 0) return null;

      const data: BarDatum[] = priced.map((r, i) => ({
        label: r.vendorName,
        value: r.comparableTotal!,
        display: formatInr(r.comparableTotal),
        highlight: i === 0,
        note: `${r.itemsQuoted} of ${r.itemsQuoted + r.itemsWithoutComparablePrice} items comparable`,
      }));

      // Vendors with gaps cannot be ranked here at all, so they are named rather
      // than drawn short, which would read as cheap.
      const excluded = ranking.filter((r) => r.comparableTotal == null);

      return (
        <ChartFrame
          title="Evaluated cost on the shared basket"
          caption={`Ranked over the ${basketSize} of ${totalLineItems} line items every compared vendor priced. Totals over different item sets are not comparable, so nothing else is drawn here.`}
          action={toggle}
        >
          <BarChart data={data} />
          {excluded.length > 0 && (
            <p className="mt-2.5 text-[11px] leading-relaxed text-[var(--ink-muted)]">
              Not ranked: {excluded.map((r) => `${r.vendorName} (${r.itemsWithoutComparablePrice} items without a comparable price)`).join(", ")}.
              Drawing them on this scale would make an incomplete response look cheapest.
            </p>
          )}
          {showTable && (
            <ChartTable
              columns={["Vendor", "Comparable total", "Items quoted", "Items missing"]}
              rows={ranking.map((r) => [
                r.vendorName,
                r.comparableTotal == null ? "Not comparable" : formatInr(r.comparableTotal),
                String(r.itemsQuoted),
                String(r.itemsWithoutComparablePrice),
              ])}
            />
          )}
        </ChartFrame>
      );
    }

    // ---------------------------------------------------------- split award
    case "split_award": {
      const allocations =
        (calc.allocations as Array<{ vendorName: string; itemCount: number; total: number }> | undefined) ?? [];
      if (allocations.length === 0) return null;
      const splitTotal = Number(calc.splitTotal ?? 0);
      const baseline = calc.bestSingleVendorTotal == null ? null : Number(calc.bestSingleVendorTotal);
      const baselineName = (calc.bestSingleVendorName as string | null) ?? null;

      return (
        <ChartFrame
          title="Where the split sends the spend"
          caption={
            baseline != null
              ? `Against buying everything from ${baselineName}, the cheapest single supplier able to cover the whole award.`
              : "No single supplier covers every awarded item, so there is no baseline to compare against."
          }
          action={toggle}
        >
          <BarChart
            data={allocations.map((a) => ({
              label: a.vendorName,
              value: a.total,
              display: formatInr(a.total),
              note: `${a.itemCount} line item(s)`,
            }))}
          />
          {baseline != null && (
            <div className="mt-3 pt-3" style={{ borderTop: "1px solid var(--line)" }}>
              <BeforeAfterChart
                beforeLabel={`All from ${baselineName}`}
                afterLabel="Split across vendors"
                rows={[
                  {
                    label: "Total evaluated cost",
                    before: baseline,
                    after: splitTotal,
                    beforeDisplay: formatInr(baseline),
                    afterDisplay: formatInr(splitTotal),
                    changed: splitTotal < baseline,
                  },
                ]}
              />
            </div>
          )}
          {showTable && (
            <ChartTable
              columns={["Vendor", "Items", "Allocated"]}
              rows={allocations.map((a) => [a.vendorName, String(a.itemCount), formatInr(a.total)])}
            />
          )}
        </ChartFrame>
      );
    }

    // ------------------------------------------------------ response coverage
    case "incomplete_responses": {
      const gaps =
        (calc.vendorsWithIncompleteResponses as
          | Array<{ vendorName: string; itemsNotQuoted: number; itemsNotComparable: number }>
          | undefined) ?? [];
      const byType = (calc.byType as Array<{ type: string; count: number }> | undefined) ?? [];
      if (gaps.length === 0 && byType.length === 0) return null;

      return (
        <ChartFrame
          title="Where the responses are incomplete"
          caption="Counted, not inferred. A gap is missing information, never a price of zero — and a price quoted on a basis we could not convert is shown as its own bar, because chasing it is different work."
          action={toggle}
        >
          {gaps.length > 0 && (
            <BarChart
              data={gaps.flatMap((g) => [
                ...(g.itemsNotQuoted > 0
                  ? [{
                      label: g.vendorName,
                      value: g.itemsNotQuoted,
                      display: `${g.itemsNotQuoted} not quoted`,
                      incomplete: true,
                    }]
                  : []),
                ...(g.itemsNotComparable > 0
                  ? [{
                      label: `${g.vendorName} (unit basis)`,
                      value: g.itemsNotComparable,
                      display: `${g.itemsNotComparable} not comparable`,
                      incomplete: true,
                    }]
                  : []),
              ])}
            />
          )}
          {showTable && byType.length > 0 && (
            <ChartTable
              columns={["Exception type", "Count"]}
              rows={byType.map((t) => [t.type.replace(/_/g, " "), String(t.count)])}
            />
          )}
        </ChartFrame>
      );
    }

    // ------------------------------------------------------ discount scenario
    case "scenario_discount": {
      const before = asRecord(calc.before);
      const after = asRecord(calc.after);
      if (!before || !after) return null;
      const beforeRanking = ((before.ranking as VendorTotalish[] | undefined) ?? []).filter((r) => r.comparableTotal != null);
      const afterRanking = ((after.ranking as VendorTotalish[] | undefined) ?? []).filter((r) => r.comparableTotal != null);
      if (beforeRanking.length === 0) return null;

      const afterByName = new Map(afterRanking.map((r) => [r.vendorName, r.comparableTotal!]));
      const discounted = calc.vendorName as string | undefined;

      return (
        <ChartFrame
          title={`If ${discounted} discounted by ${calc.discountPercent}%`}
          caption="The discount is modelled uniformly across every line that vendor priced. A discount they intend to apply to part of the order only would not move the total this far."
          action={toggle}
        >
          <BeforeAfterChart
            beforeLabel="Today"
            afterLabel="With the discount"
            rows={beforeRanking.map((r) => ({
              label: r.vendorName,
              before: r.comparableTotal!,
              after: afterByName.get(r.vendorName) ?? r.comparableTotal!,
              beforeDisplay: formatInr(r.comparableTotal),
              afterDisplay: formatInr(afterByName.get(r.vendorName) ?? r.comparableTotal),
              changed: r.vendorName === discounted,
            }))}
          />
          <p className="mt-3 text-[11.5px] leading-relaxed text-[var(--ink-secondary)]">
            {calc.becomesCheapest
              ? `That is enough: ${discounted} becomes the cheapest, taking the position from ${calc.previousWinnerName}.`
              : `Not enough to change the outcome. ${calc.newWinnerName} is still cheapest.`}
          </p>
        </ChartFrame>
      );
    }

    // --------------------------------------------------- winner per line item
    case "cheapest_per_line": {
      const lines =
        (calc.lines as
          | Array<{ lineItemName: string; winnerVendorName: string | null; winnerLineTotal: number | null; marginOverRunnerUp: number | null }>
          | undefined) ?? [];
      const won = new Map<string, { count: number; total: number }>();
      for (const l of lines) {
        if (!l.winnerVendorName || l.winnerLineTotal == null) continue;
        const entry = won.get(l.winnerVendorName) ?? { count: 0, total: 0 };
        entry.count += 1;
        entry.total += l.winnerLineTotal;
        won.set(l.winnerVendorName, entry);
      }
      if (won.size === 0) return null;
      const ranked = [...won.entries()].sort((a, b) => b[1].count - a[1].count);

      // Thin margins are where a re-check is worth the buyer's time.
      const thin = lines
        .filter((l) => l.marginOverRunnerUp != null && l.winnerLineTotal != null && l.marginOverRunnerUp < l.winnerLineTotal * 0.02)
        .slice(0, 5);

      return (
        <ChartFrame
          title="Lines won, per vendor"
          caption="Lowest evaluated cost on each line, among vendors that cleared the quality gate."
          action={toggle}
        >
          <BarChart
            data={ranked.map(([name, v]) => ({
              label: name,
              value: v.count,
              display: `${v.count} line${v.count === 1 ? "" : "s"}`,
              note: formatInr(v.total),
            }))}
          />
          {thin.length > 0 && (
            <p className="mt-2.5 text-[11px] leading-relaxed text-[var(--ink-muted)]">
              Won by under 2%: {thin.map((l) => l.lineItemName).join(", ")}. Worth checking against the source
              document before the split rests on them.
            </p>
          )}
          {showTable && (
            <ChartTable
              columns={["Vendor", "Lines won", "Value"]}
              rows={ranked.map(([name, v]) => [name, String(v.count), formatInr(v.total)])}
            />
          )}
        </ChartFrame>
      );
    }

    // A risk profile and a terms comparison are prose and tables. Drawing them
    // would be decoration, so they get nothing.
    default:
      return null;
  }
}
