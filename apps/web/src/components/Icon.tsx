/**
 * The icon set.
 *
 * Before this, the app drew icons three incompatible ways at once: emoji
 * (📎 📄 🗑 ✉ 🤖), which render as a different picture on every operating
 * system and carry no stroke weight at all; geometric glyphs (✓ ▲ ✕ ● ◉ ✦),
 * which inherit the text font's weight rather than a drawing weight; and a
 * handful of inline SVGs at stroke 2. Every sidebar item shared one dollar-sign
 * path — six links, one placeholder icon, repeated.
 *
 * These are hand-drawn on a 24 grid at a single 1.6 stroke, so they sit at the
 * same optical weight as the 500-weight text beside them. They take colour from
 * `currentColor` and size from `size`, and nothing here is imported from an icon
 * library — a set every generated interface ships is not a set that identifies
 * this one.
 */

export type IconName =
  | "check"
  | "check-circle"
  | "alert"
  | "close"
  | "info"
  | "plus"
  | "minus"
  | "arrow-right"
  | "arrow-left"
  | "chevron-down"
  | "chevron-right"
  | "search"
  | "filter"
  | "attachment"
  | "document"
  | "spreadsheet"
  | "download"
  | "trash"
  | "send"
  | "spark"
  | "refresh"
  | "derive"
  | "external"
  | "dashboard"
  | "compose"
  | "stack"
  | "approve"
  | "vendors"
  | "settings"
  | "logout"
  | "user"
  | "clock"
  | "eye";

const PATHS: Record<IconName, JSX.Element> = {
  check: <path d="M4.5 12.6 9.4 17.5 19.5 6.9" />,
  "check-circle": (
    <>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M8.2 12.2 10.9 15 15.9 9.4" />
    </>
  ),
  // Squared apex rather than a rounded pyramid — reads as a notice, not a hazard sign.
  alert: (
    <>
      <path d="M12 4.2 21 19.4H3z" />
      <path d="M12 10v4.2" />
      <path d="M12 17.1h.01" />
    </>
  ),
  close: <path d="M6.2 6.2 17.8 17.8M17.8 6.2 6.2 17.8" />,
  info: (
    <>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M12 11.2v5" />
      <path d="M12 8.1h.01" />
    </>
  ),
  plus: <path d="M12 5.5v13M5.5 12h13" />,
  minus: <path d="M5.5 12h13" />,
  "arrow-right": <path d="M4.5 12h15M13.6 6.1 19.5 12l-5.9 5.9" />,
  "arrow-left": <path d="M19.5 12h-15M10.4 6.1 4.5 12l5.9 5.9" />,
  "chevron-down": <path d="M6.5 9.5 12 15l5.5-5.5" />,
  "chevron-right": <path d="M9.5 6.5 15 12l-5.5 5.5" />,
  search: (
    <>
      <circle cx="10.8" cy="10.8" r="6.3" />
      <path d="m15.6 15.6 4 4" />
    </>
  ),
  filter: <path d="M4 6.5h16M7.2 12h9.6M10.4 17.5h3.2" />,
  // A clip drawn as a bracket rather than the usual teardrop.
  attachment: <path d="M17.5 11.2 11 17.7a4 4 0 0 1-5.7-5.7l7.4-7.4a2.7 2.7 0 0 1 3.8 3.8l-7.4 7.4a1.4 1.4 0 0 1-1.9-1.9l6.6-6.6" />,
  document: (
    <>
      <path d="M13.5 3.5H7a1.5 1.5 0 0 0-1.5 1.5v14A1.5 1.5 0 0 0 7 20.5h10a1.5 1.5 0 0 0 1.5-1.5V8.5z" />
      <path d="M13.5 3.5v5h5" />
      <path d="M8.8 13h6.4M8.8 16.3h4.4" />
    </>
  ),
  spreadsheet: (
    <>
      <rect x="3.8" y="4.6" width="16.4" height="14.8" rx="1.5" />
      <path d="M3.8 9.4h16.4M9.6 9.4v10M3.8 14.4h16.4" />
    </>
  ),
  download: <path d="M12 4.2v11.3M7.4 11.2 12 15.8l4.6-4.6M4.5 19.5h15" />,
  trash: (
    <>
      <path d="M4.8 7.2h14.4" />
      <path d="M9.4 7.2V5.4A1 1 0 0 1 10.4 4.4h3.2a1 1 0 0 1 1 1v1.8" />
      <path d="M6.7 7.2 7.6 19a1.2 1.2 0 0 0 1.2 1.1h6.4a1.2 1.2 0 0 0 1.2-1.1l.9-11.8" />
    </>
  ),
  send: <path d="M20.2 3.8 10.6 13.4M20.2 3.8l-6.3 16.4-3.3-6.8-6.8-3.3z" />,
  // Four-point star with straight concave edges — a spark, not a twinkle.
  spark: <path d="M12 3.6 13.9 10.1 20.4 12 13.9 13.9 12 20.4 10.1 13.9 3.6 12 10.1 10.1z" />,
  refresh: (
    <>
      <path d="M19.4 12a7.4 7.4 0 1 1-2.2-5.2" />
      <path d="M19.6 4.6v4.2h-4.2" />
    </>
  ),
  // The derivation mark: a total rule with the figure resolved beneath it.
  derive: (
    <>
      <path d="M5 6.4h14M5 11h14M5 15.6h6" />
      <path d="M13.6 18.6 15.9 20.9 20.4 16.1" />
    </>
  ),
  external: (
    <>
      <path d="M14.4 4.6h5v5" />
      <path d="M19.4 4.6 11.6 12.4" />
      <path d="M18.2 13.9v4.6a1.5 1.5 0 0 1-1.5 1.5H5.9a1.5 1.5 0 0 1-1.5-1.5V7.7a1.5 1.5 0 0 1 1.5-1.5h4.6" />
    </>
  ),
  dashboard: (
    <>
      <rect x="4" y="4" width="7" height="5.6" rx="1.2" />
      <rect x="13" y="4" width="7" height="10.4" rx="1.2" />
      <rect x="4" y="11.6" width="7" height="8.4" rx="1.2" />
      <rect x="13" y="16.4" width="7" height="3.6" rx="1.2" />
    </>
  ),
  compose: (
    <>
      <path d="M11.4 4.6H6a1.6 1.6 0 0 0-1.6 1.6V18a1.6 1.6 0 0 0 1.6 1.6h11.8A1.6 1.6 0 0 0 19.4 18v-5.4" />
      <path d="M17 3.4 20.6 7 13.2 14.4l-4 .4.4-4z" />
    </>
  ),
  stack: (
    <>
      <path d="M8.4 3.8h9.2a1.6 1.6 0 0 1 1.6 1.6v9.2" />
      <rect x="4.4" y="7.4" width="11.6" height="12.8" rx="1.6" />
      <path d="M7.8 12h5M7.8 15.4h3.4" />
    </>
  ),
  approve: (
    <>
      <rect x="4.4" y="4.4" width="15.2" height="15.2" rx="2" />
      <path d="M8.4 12.2 11 14.8 15.8 9.2" />
    </>
  ),
  vendors: (
    <>
      <path d="M3.6 8.2 12 4l8.4 4.2v7.6L12 20l-8.4-4.2z" />
      <path d="M3.6 8.2 12 12.4l8.4-4.2M12 12.4V20" />
    </>
  ),
  settings: (
    <>
      <circle cx="12" cy="12" r="2.9" />
      <path d="M12 3.4v2.4M12 18.2v2.4M20.6 12h-2.4M5.8 12H3.4M18.1 5.9l-1.7 1.7M7.6 16.4l-1.7 1.7M18.1 18.1l-1.7-1.7M7.6 7.6 5.9 5.9" />
    </>
  ),
  logout: (
    <>
      <path d="M9.4 20.2H5.8a1.6 1.6 0 0 1-1.6-1.6V5.4a1.6 1.6 0 0 1 1.6-1.6h3.6" />
      <path d="M15.4 16.4 19.8 12l-4.4-4.4M19.8 12H9.2" />
    </>
  ),
  user: (
    <>
      <circle cx="12" cy="8.4" r="3.8" />
      <path d="M4.8 20.2a7.2 7.2 0 0 1 14.4 0" />
    </>
  ),
  clock: (
    <>
      <circle cx="12" cy="12" r="8.4" />
      <path d="M12 7.2V12l3.2 2" />
    </>
  ),
  eye: (
    <>
      <path d="M2.6 12S6.4 5.8 12 5.8 21.4 12 21.4 12 17.6 18.2 12 18.2 2.6 12 2.6 12" />
      <circle cx="12" cy="12" r="2.8" />
    </>
  ),
};

/** Icons that read better filled than stroked at small sizes. */
const FILLED: ReadonlySet<IconName> = new Set(["spark"]);

export default function Icon({
  name,
  size = 16,
  className = "",
  strokeWidth = 1.6,
  title,
}: {
  name: IconName;
  size?: number;
  className?: string;
  strokeWidth?: number;
  /** Supply when the icon is the only label. Omit when text sits beside it. */
  title?: string;
}) {
  const filled = FILLED.has(name);
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill={filled ? "currentColor" : "none"}
      stroke={filled ? "none" : "currentColor"}
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={`shrink-0 ${className}`}
      aria-hidden={title ? undefined : true}
      role={title ? "img" : undefined}
      focusable="false"
    >
      {title && <title>{title}</title>}
      {PATHS[name]}
    </svg>
  );
}

/** A status dot that is a shape, not just a colour — so the state survives a
 * greyscale print and a colour-blind reader. */
export function StatusMark({ tone, size = 8 }: { tone: "good" | "warning" | "critical" | "info" | "neutral"; size?: number }) {
  const color = tone === "neutral" ? "var(--ink-muted)" : `var(--${tone})`;
  if (tone === "warning") {
    return (
      <svg width={size + 2} height={size + 2} viewBox="0 0 10 10" aria-hidden className="shrink-0">
        <path d="M5 1 9.3 8.6H.7z" fill={color} />
      </svg>
    );
  }
  if (tone === "critical") {
    return (
      <svg width={size + 2} height={size + 2} viewBox="0 0 10 10" aria-hidden className="shrink-0">
        <path d="M5 .8 9.2 5 5 9.2.8 5z" fill={color} />
      </svg>
    );
  }
  return (
    <svg width={size + 2} height={size + 2} viewBox="0 0 10 10" aria-hidden className="shrink-0">
      <circle cx="5" cy="5" r="3.4" fill={color} />
    </svg>
  );
}
