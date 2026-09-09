import { useEffect, type ReactNode } from "react";
import Icon, { StatusMark, type IconName } from "./Icon";

/** Shared primitives. Deliberately restrained: the data is the interface, so
 * nothing here competes with the numbers for attention. Colour is carried by the
 * token layer in index.css, where there is exactly one accent and it has no
 * chroma — every coloured thing on screen is therefore saying something. */

export function Card({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <div className={`panel ${className}`}>{children}</div>;
}

export function CardHeader({ title, subtitle, action }: { title: string; subtitle?: string; action?: ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-4 px-5 py-3.5" style={{ borderBottom: "1px solid var(--line)" }}>
      <div className="min-w-0">
        <h2 className="text-[13.5px] font-semibold tracking-[-0.012em] text-[var(--ink)]">{title}</h2>
        {subtitle && <p className="measure mt-0.5 text-[12.5px] text-[var(--ink-secondary)]">{subtitle}</p>}
      </div>
      {action}
    </div>
  );
}

export function Button({
  children,
  onClick,
  variant = "primary",
  size = "md",
  disabled,
  type = "button",
  className = "",
  title,
  icon,
  iconRight,
}: {
  children?: ReactNode;
  onClick?: () => void;
  variant?: "primary" | "secondary" | "ghost" | "danger" | "link";
  size?: "sm" | "md";
  disabled?: boolean;
  type?: "button" | "submit";
  className?: string;
  title?: string;
  icon?: IconName;
  iconRight?: IconName;
}) {
  const styles = {
    primary:
      "bg-[var(--accent)] text-[var(--ink-inverse)] hover:bg-[var(--accent-hover)] disabled:bg-[var(--line-strong)] disabled:text-[var(--surface)] shadow-[var(--shadow-raised)]",
    secondary:
      "border border-[var(--line-strong)] bg-[var(--surface)] text-[var(--ink-secondary)] hover:border-[var(--ink-muted)] hover:text-[var(--ink)] disabled:text-[var(--ink-muted)]",
    ghost: "text-[var(--ink-secondary)] hover:bg-[var(--surface-hover)] hover:text-[var(--ink)] disabled:text-[var(--ink-muted)]",
    danger:
      "border border-[var(--critical-line)] bg-[var(--critical-soft)] text-[var(--critical)] hover:bg-[var(--critical)] hover:text-[var(--ink-inverse)] hover:border-[var(--critical)]",
    // A text link, so a group of actions is not two competing boxes.
    link: "text-[var(--ink)] underline decoration-[var(--line-strong)] underline-offset-[5px] hover:decoration-[var(--ink)]",
  }[variant];
  const sizing =
    variant === "link" ? "" : size === "sm" ? "px-2.5 py-[5px] text-[12px]" : "px-3 py-[7px] text-[13px]";
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      title={title}
      className={`pressable inline-flex items-center justify-center gap-1.5 rounded-lg font-medium disabled:cursor-not-allowed ${sizing} ${styles} ${className}`}
    >
      {icon && <Icon name={icon} size={size === "sm" ? 13 : 14} />}
      {children}
      {iconRight && <Icon name={iconRight} size={size === "sm" ? 13 : 14} />}
    </button>
  );
}

// ------------------------------------------------------------------- badges

const SEVERITY: Record<string, { tone: "critical" | "warning" | "info"; className: string }> = {
  critical: { tone: "critical", className: "bg-[var(--critical-soft)] text-[var(--critical)] ring-[var(--critical-line)]" },
  warning: { tone: "warning", className: "bg-[var(--warning-soft)] text-[var(--warning)] ring-[var(--warning-line)]" },
  info: { tone: "info", className: "bg-[var(--info-soft)] text-[var(--info)] ring-[var(--info-line)]" },
};

export function SeverityBadge({ severity, children }: { severity: string; children: ReactNode }) {
  const entry = SEVERITY[severity] ?? {
    tone: "info" as const,
    className: "bg-[var(--surface-sunken)] text-[var(--ink-secondary)] ring-[var(--line-strong)]",
  };
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-md px-1.5 py-[3px] text-[11px] font-medium ring-1 ring-inset ${entry.className}`}
    >
      <StatusMark tone={entry.tone} size={6} />
      {children}
    </span>
  );
}

/** Confidence is never a bare number — the band is what tells the buyer whether
 * to trust the value without doing arithmetic in their head. */
export function ConfidenceBadge({ confidence, level }: { confidence: number | null; level?: string | null }) {
  if (confidence == null) return <span className="text-[12px] text-[var(--ink-muted)]">—</span>;
  const band = level ?? (confidence >= 0.9 ? "high" : confidence >= 0.7 ? "medium" : "low");
  const map: Record<string, { className: string; tone: "good" | "warning" | "critical" }> = {
    high: { className: "bg-[var(--good-soft)] text-[var(--good)] ring-[var(--good-line)]", tone: "good" },
    medium: { className: "bg-[var(--warning-soft)] text-[var(--warning)] ring-[var(--warning-line)]", tone: "warning" },
    low: { className: "bg-[var(--critical-soft)] text-[var(--critical)] ring-[var(--critical-line)]", tone: "critical" },
  };
  const entry = map[band] ?? map.medium;
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-md px-1.5 py-[3px] text-[11px] font-medium ring-1 ring-inset ${entry.className}`}
    >
      <StatusMark tone={entry.tone} size={6} />
      <span className="num">{Math.round(confidence * 100)}%</span>
      <span className="font-normal opacity-70">{band}</span>
    </span>
  );
}

/** A square badge, not another pill — and the state is carried by a mark and a
 * word as well as the colour. */
export function StatusPill({ status }: { status: string }) {
  const map: Record<string, { label: string; className: string; tone: "good" | "warning" | "critical" | "info" | "neutral" }> = {
    processed: { label: "Processed", className: "bg-[var(--good-soft)] text-[var(--good)] ring-[var(--good-line)]", tone: "good" },
    review_required: {
      label: "Review required",
      className: "bg-[var(--warning-soft)] text-[var(--warning)] ring-[var(--warning-line)]",
      tone: "warning",
    },
    processing: { label: "Processing", className: "bg-[var(--info-soft)] text-[var(--info)] ring-[var(--info-line)]", tone: "info" },
    pending: {
      label: "Pending",
      className: "bg-[var(--surface-sunken)] text-[var(--ink-secondary)] ring-[var(--line-strong)]",
      tone: "neutral",
    },
    failed: { label: "Failed", className: "bg-[var(--critical-soft)] text-[var(--critical)] ring-[var(--critical-line)]", tone: "critical" },
    SUBMITTED: { label: "Submitted", className: "bg-[var(--info-soft)] text-[var(--info)] ring-[var(--info-line)]", tone: "info" },
    APPROVED: { label: "Approved", className: "bg-[var(--good-soft)] text-[var(--good)] ring-[var(--good-line)]", tone: "good" },
    DRAFT: {
      label: "Draft",
      className: "bg-[var(--surface-sunken)] text-[var(--ink-secondary)] ring-[var(--line-strong)]",
      tone: "neutral",
    },
    FULFILLED: { label: "Fulfilled", className: "bg-[var(--good-soft)] text-[var(--good)] ring-[var(--good-line)]", tone: "good" },
  };
  const entry = map[status] ?? {
    label: status,
    className: "bg-[var(--surface-sunken)] text-[var(--ink-secondary)] ring-[var(--line-strong)]",
    tone: "neutral" as const,
  };
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-[5px] px-1.5 py-[3px] text-[11.5px] font-medium ring-1 ring-inset ${entry.className}`}
    >
      <StatusMark tone={entry.tone} size={6} />
      {entry.label}
    </span>
  );
}

/** Used wherever a value is genuinely absent. Never a zero, never blank. */
export function NotAvailable({ label = "Not quoted" }: { label?: string }) {
  return <span className="text-[12px] italic text-[var(--ink-muted)]">{label}</span>;
}

// -------------------------------------------------------------------- states

/** A skeleton in the shape of what is coming, rather than a spinner that says
 * nothing about it. `lines` for prose, `rows`/`cols` for a grid. */
export function Skeleton({
  variant = "lines",
  lines = 3,
  rows = 6,
  cols = 5,
  className = "",
}: {
  variant?: "lines" | "tiles" | "table";
  lines?: number;
  rows?: number;
  cols?: number;
  className?: string;
}) {
  if (variant === "tiles") {
    return (
      <div className={`grid grid-cols-2 gap-4 sm:grid-cols-4 ${className}`} aria-hidden>
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="panel p-5">
            <div className="skeleton h-2.5 w-24" />
            <div className="skeleton mt-3 h-6 w-32" />
          </div>
        ))}
      </div>
    );
  }
  if (variant === "table") {
    return (
      <div className={`panel overflow-hidden ${className}`} aria-hidden>
        <div className="skeleton h-9 w-full rounded-none" />
        {Array.from({ length: rows }).map((_, r) => (
          <div key={r} className="flex gap-3 px-3 py-2.5" style={{ borderTop: "1px solid var(--line)" }}>
            {Array.from({ length: cols }).map((_, c) => (
              <div key={c} className="skeleton h-3.5" style={{ width: c === 0 ? "34%" : `${Math.round(66 / (cols - 1))}%` }} />
            ))}
          </div>
        ))}
      </div>
    );
  }
  return (
    <div className={`space-y-2.5 ${className}`} aria-hidden>
      {Array.from({ length: lines }).map((_, i) => (
        <div key={i} className="skeleton h-3.5" style={{ width: i === lines - 1 ? "62%" : "100%" }} />
      ))}
    </div>
  );
}

export function Spinner({ label }: { label?: string }) {
  return (
    <div className="flex items-center gap-2.5 text-[13px] text-[var(--ink-secondary)]" role="status">
      <span
        className="h-3.5 w-3.5 animate-spin rounded-full border-[1.5px]"
        style={{ borderColor: "var(--line-strong)", borderTopColor: "var(--ink)" }}
      />
      {label}
    </div>
  );
}

/** Not a shrug. An empty state should say what goes here and how to put it there. */
export function EmptyState({
  title,
  hint,
  icon = "stack",
  action,
}: {
  title: string;
  hint?: string;
  icon?: IconName;
  action?: ReactNode;
}) {
  return (
    <div className="animate-fade-up px-5 py-14 text-center">
      <span
        className="mx-auto flex h-10 w-10 items-center justify-center rounded-xl"
        style={{ background: "var(--surface-hover)", color: "var(--ink-muted)" }}
      >
        <Icon name={icon} size={19} />
      </span>
      <p className="mt-3.5 text-[13.5px] font-medium text-[var(--ink)]">{title}</p>
      {hint && <p className="measure mx-auto mt-1 text-[12.5px] leading-relaxed text-[var(--ink-secondary)]">{hint}</p>}
      {action && <div className="mt-4 flex justify-center">{action}</div>}
    </div>
  );
}

export function ErrorState({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div
      className="animate-fade-up rounded-lg px-5 py-4"
      style={{ border: "1px solid var(--critical-line)", background: "var(--critical-soft)" }}
      role="alert"
    >
      <p className="flex items-center gap-2 text-[13px] font-semibold" style={{ color: "var(--critical)" }}>
        <Icon name="alert" size={15} />
        We couldn't load this
      </p>
      <p className="measure mt-1 text-[13px] text-[var(--ink-secondary)]">{message}</p>
      {onRetry && (
        <div className="mt-3">
          <Button variant="secondary" size="sm" icon="refresh" onClick={onRetry}>
            Try again
          </Button>
        </div>
      )}
    </div>
  );
}

/** Inline form error. Replaces window.alert, which cannot be styled, cannot be
 * dismissed with the keyboard, and blocks the whole tab. */
export function InlineError({ message, onDismiss }: { message: string; onDismiss?: () => void }) {
  return (
    <div
      className="animate-fade-up flex items-start gap-2.5 rounded-lg px-3.5 py-2.5"
      style={{ border: "1px solid var(--critical-line)", background: "var(--critical-soft)" }}
      role="alert"
    >
      <span style={{ color: "var(--critical)" }} className="mt-[1px]">
        <Icon name="alert" size={14} />
      </span>
      <p className="flex-1 text-[12.5px] leading-relaxed text-[var(--ink-secondary)]">{message}</p>
      {onDismiss && (
        <button onClick={onDismiss} className="pressable -mr-1 -mt-0.5 rounded p-1 text-[var(--ink-muted)] hover:text-[var(--ink)]">
          <Icon name="close" size={13} title="Dismiss" />
        </button>
      )}
    </div>
  );
}

// -------------------------------------------------------------------- layout

/** A headline figure. The label sits above and quiet; the number is the only
 * thing carrying weight. Pass `onExplain` to make the figure openable. */
export function StatTile({
  label,
  value,
  hint,
  tone,
  onExplain,
  explainLabel,
}: {
  label: string;
  value: ReactNode;
  hint?: string;
  tone?: "good" | "warning" | "critical";
  onExplain?: () => void;
  explainLabel?: string;
}) {
  const color =
    tone === "good" ? "var(--good)" : tone === "warning" ? "var(--warning)" : tone === "critical" ? "var(--critical)" : "var(--ink)";
  const figure = (
    <span className="num-lg text-[19px] font-semibold leading-tight" style={{ color }}>
      {value}
    </span>
  );
  return (
    <div className="group bg-[var(--surface)] px-5 py-3.5">
      <div className="eyebrow">{label}</div>
      <div className="mt-1.5 flex items-center gap-1.5">
        {onExplain ? (
          <button
            type="button"
            onClick={onExplain}
            className="explainable text-left"
            title={explainLabel ?? "Show how this is calculated"}
          >
            {figure}
          </button>
        ) : (
          figure
        )}
        {onExplain && (
          <span
            className="opacity-0 transition-opacity duration-200 group-hover:opacity-100"
            style={{ color: "var(--ink-muted)" }}
            aria-hidden
          >
            <Icon name="derive" size={13} />
          </span>
        )}
      </div>
      {hint && <div className="mt-1 text-[11.5px] leading-snug text-[var(--ink-muted)]">{hint}</div>}
    </div>
  );
}

/** Overlay. Escape closes, the backdrop closes, and the panel scrolls on its own
 * so a long derivation never pushes the page around behind it. */
export function Modal({
  open,
  onClose,
  title,
  subtitle,
  width = "max-w-4xl",
  children,
  footer,
}: {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  subtitle?: ReactNode;
  width?: string;
  children: ReactNode;
  footer?: ReactNode;
}) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [open, onClose]);

  if (!open) return null;
  return (
    <div className="fixed inset-0 z-modal flex items-start justify-center overflow-y-auto p-4 sm:p-8">
      <div
        className="animate-fade-in absolute inset-0 backdrop-blur-[3px]"
        style={{ background: "rgba(28, 27, 25, 0.36)" }}
        onClick={onClose}
        aria-hidden
      />
      {/* Column layout with a flexible body: on a short viewport the panel
          shrinks and the content scrolls, rather than running off the bottom of
          the screen with its footer unreachable. */}
      <div
        role="dialog"
        aria-modal="true"
        className={`animate-scale-in relative my-auto flex w-full ${width} max-h-[calc(100dvh-4rem)] flex-col overflow-hidden rounded-xl bg-[var(--surface)]`}
        style={{ boxShadow: "var(--shadow-overlay)" }}
      >
        <div
          className="flex shrink-0 items-start justify-between gap-6 px-6 py-4"
          style={{ borderBottom: "1px solid var(--line)" }}
        >
          <div className="min-w-0">
            <h2 className="text-[15px] font-semibold tracking-[-0.015em] text-[var(--ink)]">{title}</h2>
            {subtitle && <div className="mt-1 text-[12.5px] leading-relaxed text-[var(--ink-secondary)]">{subtitle}</div>}
          </div>
          <button
            type="button"
            onClick={onClose}
            className="pressable -mr-1.5 -mt-1 shrink-0 rounded-lg p-1.5 text-[var(--ink-muted)] hover:bg-[var(--surface-hover)] hover:text-[var(--ink)]"
          >
            <Icon name="close" size={16} title="Close" />
          </button>
        </div>
        <div className="thin-scroll min-h-0 flex-1 overflow-y-auto">{children}</div>
        {footer && (
          <div className="shrink-0 px-6 py-3" style={{ borderTop: "1px solid var(--line)", background: "var(--surface-sunken)" }}>
            {footer}
          </div>
        )}
      </div>
    </div>
  );
}
