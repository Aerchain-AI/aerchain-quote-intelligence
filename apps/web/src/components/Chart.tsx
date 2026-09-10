import { useLayoutEffect, useRef, useState, type ReactNode } from "react";

/**
 * Charts for the analyst conversation.
 *
 * Every chart here is a magnitude comparison of a single measure — what each
 * vendor costs, how many lines each covered, what a scenario changes. That form
 * takes one hue, not a categorical palette: the bars are all the same ink, and
 * colour appears only where it means something, which is the winning bar and the
 * delta on a scenario.
 *
 * Horizontal, because supplier names are long and rotated axis labels are a tax
 * on the reader. Sorted, because rank is the question being asked. Directly
 * labelled, because a buyer reading a comparison wants the number, not an
 * estimate off a gridline — the axis is a secondary reference, so it is drawn
 * faintly and given no gridlines of its own.
 *
 * The data comes from the calculation object the engine returned. No model
 * produced a chart spec; this is the same numbers the text answer used, drawn.
 */

export interface BarDatum {
  label: string;
  value: number;
  /** Rendered instead of the raw number, e.g. currency-formatted. */
  display: string;
  /** Marks this bar as the answer to the question. */
  highlight?: boolean;
  /** Shown under the label, e.g. "27 of 30 items". */
  note?: string;
  /** Portion of the bar that is genuinely absent rather than zero. */
  incomplete?: boolean;
}

/**
 * The chart's own width in CSS pixels.
 *
 * These charts used to draw into a fixed 640-unit viewBox stretched to fit with
 * preserveAspectRatio="none", which scales the text as well as the bars: the
 * same chart read wide and thin in the old bottom bar and squashed to
 * illegibility once the conversation moved into a 380px rail. Measuring the
 * container and drawing at 1 unit per pixel keeps every label at its true size,
 * and lets the label column and the value gutter shrink with the space actually
 * available rather than a number picked for one layout.
 */
function useChartWidth() {
  const ref = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    setWidth(Math.round(el.getBoundingClientRect().width));
    const observer = new ResizeObserver((entries) => {
      const next = Math.round(entries[0].contentRect.width);
      setWidth((prev) => (Math.abs(prev - next) > 1 ? next : prev));
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  return { ref, width };
}

/** Roughly how many characters fit in a pixel width at the label size. */
function fitChars(px: number, fontSize: number) {
  return Math.max(6, Math.floor(px / (fontSize * 0.52)));
}

function clip(label: string, px: number, fontSize: number) {
  const max = fitChars(px, fontSize);
  return label.length > max ? `${label.slice(0, max - 1)}…` : label;
}

export function ChartFrame({
  title,
  caption,
  children,
  action,
}: {
  title: string;
  caption?: string;
  children: ReactNode;
  action?: ReactNode;
}) {
  return (
    <figure className="m-0">
      <figcaption className="mb-2.5 flex items-start justify-between gap-4">
        <div>
          <div className="text-[12.5px] font-medium text-[var(--ink)]">{title}</div>
          {caption && <div className="measure mt-0.5 text-[11.5px] leading-relaxed text-[var(--ink-muted)]">{caption}</div>}
        </div>
        {action}
      </figcaption>
      {children}
    </figure>
  );
}

/**
 * Horizontal bars, one series.
 *
 * A bar whose vendor did not price every line is drawn with a hatched tail: the
 * length is what they quoted, and the hatch says the rest is missing rather than
 * free. Reading it as a shorter bar would make the incomplete response look
 * cheapest, which is exactly the mistake the comparison exists to prevent.
 */
export function BarChart({
  data,
  maxLabelWidth = 168,
  barHeight = 22,
  gap = 8,
}: {
  data: BarDatum[];
  maxLabelWidth?: number;
  barHeight?: number;
  gap?: number;
}) {
  const [hovered, setHovered] = useState<number | null>(null);
  const { ref, width: measured } = useChartWidth();

  const max = Math.max(...data.map((d) => Math.abs(d.value)), 1);
  const height = Math.max(data.length * (barHeight + gap) - gap, 1);

  // Until the container has been measured there is no honest place to put a
  // bar, so the row height is reserved and nothing is drawn.
  const W = measured || 0;
  const narrow = W > 0 && W < 440;
  const labelSize = narrow ? 10.5 : 11.5;
  const valueSize = narrow ? 10.5 : 11.5;
  const labelWidth = Math.min(maxLabelWidth, Math.max(64, W * 0.32));
  // The gutter is sized from the longest value that has to sit in it, not from
  // a fraction of the width: a crore-scale total needs the same room at any
  // rail width, and a clipped number is worse than a shorter bar.
  const longestValue = Math.max(...data.map((d) => d.display.length), 4);
  const valueGutter = Math.min(W * 0.45, longestValue * valueSize * 0.62 + 14);
  const plotLeft = labelWidth + 12;
  const span = Math.max(24, W - plotLeft - valueGutter);

  if (data.length === 0) return null;

  return (
    <div className="relative" ref={ref}>
      <svg
        width="100%"
        height={height}
        viewBox={`0 0 ${W || 640} ${height}`}
        role="img"
        aria-label={`Bar chart: ${data.map((d) => `${d.label} ${d.display}`).join(", ")}`}
      >
        <defs>
          {/* The tail on an incomplete response. Hatching rather than a second
              colour, so it survives greyscale and colour-blind reading. */}
          <pattern id="chart-missing" width="6" height="6" patternTransform="rotate(45)" patternUnits="userSpaceOnUse">
            <rect width="6" height="6" fill="var(--surface-hover)" />
            <line x1="0" y1="0" x2="0" y2="6" stroke="var(--line-strong)" strokeWidth="1.5" />
          </pattern>
        </defs>

        {W > 0 && data.map((d, i) => {
          const y = i * (barHeight + gap);
          const width = Math.max(2, (Math.abs(d.value) / max) * span);
          const isHovered = hovered === i;
          const fill = d.highlight ? "var(--good)" : "var(--ink)";
          return (
            <g
              key={d.label + i}
              onMouseEnter={() => setHovered(i)}
              onMouseLeave={() => setHovered(null)}
              style={{ cursor: "default" }}
            >
              {/* Hit target spans the row, not just the mark. */}
              <rect x="0" y={y - gap / 2} width={W} height={barHeight + gap} fill="transparent" />

              <text
                x={labelWidth}
                y={y + barHeight / 2}
                textAnchor="end"
                dominantBaseline="central"
                className="fill-[var(--ink-secondary)]"
                style={{ fontSize: labelSize }}
              >
                {clip(d.label, labelWidth, labelSize)}
              </text>

              <rect
                x={plotLeft}
                y={y}
                width={width}
                height={barHeight}
                rx="3"
                fill={fill}
                opacity={isHovered ? 1 : 0.88}
              />
              {d.incomplete && (
                <rect
                  x={plotLeft + width}
                  y={y}
                  width={narrow ? 16 : 26}
                  height={barHeight}
                  rx="3"
                  fill="url(#chart-missing)"
                />
              )}

              <text
                x={plotLeft + width + (d.incomplete ? (narrow ? 22 : 34) : 8)}
                y={y + barHeight / 2}
                dominantBaseline="central"
                className="fill-[var(--ink)]"
                style={{ fontSize: valueSize, fontFamily: "var(--font-mono, monospace)", fontWeight: 500 }}
              >
                {d.display}
              </text>
            </g>
          );
        })}
      </svg>

      {hovered != null && data[hovered].note && (
        <div
          className="pointer-events-none absolute left-0 right-0 -bottom-1 text-[11px] text-[var(--ink-muted)]"
          role="status"
        >
          {data[hovered].label}: {data[hovered].note}
        </div>
      )}
    </div>
  );
}

/**
 * Two bars per row, for a before-and-after.
 *
 * The baseline is drawn in a recessive grey and the result in ink, which is a
 * lightness encoding rather than a hue one, so it reads the same in greyscale.
 * Both are labelled, and a legend names them, so identity never depends on the
 * shade alone.
 */
export function BeforeAfterChart({
  rows,
  beforeLabel,
  afterLabel,
}: {
  rows: Array<{ label: string; before: number; after: number; beforeDisplay: string; afterDisplay: string; changed?: boolean }>;
  beforeLabel: string;
  afterLabel: string;
}) {
  const { ref, width: measured } = useChartWidth();
  const max = Math.max(...rows.flatMap((r) => [r.before, r.after]), 1);
  const barHeight = 13;
  const rowHeight = barHeight * 2 + 6 + 14;
  const height = Math.max(rows.length * rowHeight, 1);

  const W = measured || 0;
  const narrow = W > 0 && W < 440;
  const labelSize = narrow ? 10.5 : 11.5;
  const valueSize = narrow ? 9.5 : 10.5;
  const plotLeft = Math.min(180, Math.max(72, W * 0.34));
  const longestValue = Math.max(...rows.flatMap((r) => [r.beforeDisplay.length, r.afterDisplay.length]), 4);
  const valueGutter = Math.min(W * 0.45, longestValue * valueSize * 0.62 + 14);
  const span = Math.max(24, W - plotLeft - valueGutter);

  if (rows.length === 0) return null;

  return (
    <div ref={ref}>
      <div className="mb-2.5 flex items-center gap-4 text-[11px] text-[var(--ink-secondary)]">
        <span className="flex items-center gap-1.5">
          <span className="inline-block h-2.5 w-2.5 rounded-[2px]" style={{ background: "var(--line-strong)" }} />
          {beforeLabel}
        </span>
        <span className="flex items-center gap-1.5">
          <span className="inline-block h-2.5 w-2.5 rounded-[2px]" style={{ background: "var(--ink)" }} />
          {afterLabel}
        </span>
      </div>
      <svg width="100%" height={height} viewBox={`0 0 ${W || 640} ${height}`} role="img">
        {W > 0 && rows.map((r, i) => {
          const y = i * rowHeight;
          const w = (v: number) => Math.max(2, (v / max) * span);
          return (
            <g key={r.label + i}>
              <text
                x={plotLeft - 12}
                y={y + barHeight}
                textAnchor="end"
                dominantBaseline="central"
                className="fill-[var(--ink-secondary)]"
                style={{ fontSize: labelSize }}
              >
                {clip(r.label, plotLeft - 12, labelSize)}
              </text>
              <rect x={plotLeft} y={y} width={w(r.before)} height={barHeight} rx="2.5" fill="var(--line-strong)" />
              <text
                x={plotLeft + w(r.before) + 7}
                y={y + barHeight / 2}
                dominantBaseline="central"
                className="fill-[var(--ink-muted)]"
                style={{ fontSize: valueSize, fontFamily: "var(--font-mono, monospace)" }}
              >
                {r.beforeDisplay}
              </text>
              <rect
                x={plotLeft}
                y={y + barHeight + 3}
                width={w(r.after)}
                height={barHeight}
                rx="2.5"
                fill={r.changed ? "var(--good)" : "var(--ink)"}
              />
              <text
                x={plotLeft + w(r.after) + 7}
                y={y + barHeight + 3 + barHeight / 2}
                dominantBaseline="central"
                className="fill-[var(--ink)]"
                style={{ fontSize: valueSize, fontFamily: "var(--font-mono, monospace)", fontWeight: 500 }}
              >
                {r.afterDisplay}
              </text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}

/** The same numbers as a table. A chart a reader cannot check is decoration. */
export function ChartTable({ columns, rows }: { columns: string[]; rows: string[][] }) {
  return (
    <div className="thin-scroll mt-2 overflow-x-auto rounded-lg" style={{ border: "1px solid var(--line)" }}>
      <table className="grid-table">
        <thead>
          <tr>
            {columns.map((c, i) => (
              <th key={c} className={i === 0 ? "!text-left" : "!text-right"}>
                {c}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <tr key={i}>
              {row.map((cell, j) => (
                <td key={j} className={j === 0 ? "text-left" : "num text-right"}>
                  {cell}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
