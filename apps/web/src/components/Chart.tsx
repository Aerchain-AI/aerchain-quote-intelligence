import { useState, type ReactNode } from "react";

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
  if (data.length === 0) return null;

  const max = Math.max(...data.map((d) => Math.abs(d.value)), 1);
  const height = data.length * (barHeight + gap) - gap;
  const plotLeft = maxLabelWidth + 12;

  return (
    <div className="relative">
      <svg
        width="100%"
        height={height}
        viewBox={`0 0 640 ${height}`}
        preserveAspectRatio="none"
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

        {data.map((d, i) => {
          const y = i * (barHeight + gap);
          const width = Math.max(2, (Math.abs(d.value) / max) * (640 - plotLeft - 96));
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
              <rect x="0" y={y - gap / 2} width="640" height={barHeight + gap} fill="transparent" />

              <text
                x={maxLabelWidth}
                y={y + barHeight / 2}
                textAnchor="end"
                dominantBaseline="central"
                className="fill-[var(--ink-secondary)] text-[11.5px]"
                style={{ fontSize: 11.5 }}
              >
                {d.label.length > 26 ? `${d.label.slice(0, 25)}…` : d.label}
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
                <rect x={plotLeft + width} y={y} width="26" height={barHeight} rx="3" fill="url(#chart-missing)" />
              )}

              <text
                x={plotLeft + width + (d.incomplete ? 34 : 8)}
                y={y + barHeight / 2}
                dominantBaseline="central"
                className="fill-[var(--ink)]"
                style={{ fontSize: 11.5, fontFamily: "var(--font-mono, monospace)", fontWeight: 500 }}
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
  if (rows.length === 0) return null;
  const max = Math.max(...rows.flatMap((r) => [r.before, r.after]), 1);
  const barHeight = 13;
  const rowHeight = barHeight * 2 + 6 + 14;
  const height = rows.length * rowHeight;
  const plotLeft = 180;

  return (
    <div>
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
      <svg width="100%" height={height} viewBox={`0 0 640 ${height}`} preserveAspectRatio="none" role="img">
        {rows.map((r, i) => {
          const y = i * rowHeight;
          const w = (v: number) => Math.max(2, (v / max) * (640 - plotLeft - 100));
          return (
            <g key={r.label + i}>
              <text
                x={plotLeft - 12}
                y={y + barHeight}
                textAnchor="end"
                dominantBaseline="central"
                className="fill-[var(--ink-secondary)]"
                style={{ fontSize: 11.5 }}
              >
                {r.label.length > 24 ? `${r.label.slice(0, 23)}…` : r.label}
              </text>
              <rect x={plotLeft} y={y} width={w(r.before)} height={barHeight} rx="2.5" fill="var(--line-strong)" />
              <text
                x={plotLeft + w(r.before) + 7}
                y={y + barHeight / 2}
                dominantBaseline="central"
                className="fill-[var(--ink-muted)]"
                style={{ fontSize: 10.5, fontFamily: "var(--font-mono, monospace)" }}
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
                style={{ fontSize: 10.5, fontFamily: "var(--font-mono, monospace)", fontWeight: 500 }}
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
