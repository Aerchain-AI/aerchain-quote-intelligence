import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useFigureExplainer } from "../components/ExplainFigure";
import Icon from "../components/Icon";
import { EmptyState, ErrorState, InlineError, Skeleton, StatusPill } from "../components/ui";
import {
  api,
  formatInr,
  type Buyer,
  type PortfolioFigure,
  type PortfolioMetrics,
  type Rfx,
  type RfxFacets,
} from "../lib/api";

interface Filters {
  status: string;
  buyerId: string;
  category: string;
  year: string;
  search: string;
}

const EMPTY_FILTERS: Filters = { status: "", buyerId: "", category: "", year: "", search: "" };

const STATUS_CONFIG: Record<string, { label: string; dot: string; pillKey: string }> = {
  awarded: {
    label: "APPROVED",
    dot: "bg-[var(--good)]",
    pillKey: "APPROVED",
  },
  active: {
    label: "SUBMITTED",
    dot: "bg-[var(--info)]",
    pillKey: "SUBMITTED",
  },
  draft: {
    label: "DRAFT",
    dot: "bg-[var(--warning)]",
    pillKey: "DRAFT",
  },
  at_risk: {
    label: "AT RISK",
    dot: "bg-[var(--critical)]",
    pillKey: "failed",
  },
  pending_approval: {
    label: "PENDING",
    dot: "bg-[var(--warning)]",
    pillKey: "review_required",
  },
  in_fulfillment: {
    label: "FULFILLED",
    dot: "bg-[var(--good)]",
    pillKey: "FULFILLED",
  },
};

function getStatusCfg(status: string) {
  return STATUS_CONFIG[status] ?? STATUS_CONFIG.draft;
}

function eventProgress(e: Rfx): number {
  const s = e.status ?? "draft";
  if (s === "awarded" || s === "in_fulfillment") return 100;
  if (s === "pending_approval") return 80;
  if (s === "active") {
    const v = e._count?.vendors ?? 0;
    return v > 0 ? Math.min(20 + v * 10, 70) : 20;
  }
  return 10;
}

interface AttachedFile {
  name: string;
  size: number;
  type: string;
}

export default function EventsScreen() {
  const navigate = useNavigate();
  const [error, setError] = useState<string | null>(null);
  const [buyers, setBuyers] = useState<Buyer[]>([]);
  const [events, setEvents] = useState<Rfx[]>([]);
  const [facets, setFacets] = useState<RfxFacets | null>(null);
  const [filters, setFilters] = useState<Filters>(EMPTY_FILTERS);
  const [loaded, setLoaded] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  // Chat input
  const [chatInput, setChatInput] = useState("");
  const [attachments, setAttachments] = useState<AttachedFile[]>([]);
  const [isDraggingOver, setIsDraggingOver] = useState(false);

  const loadEvents = () => {
    api
      .listRfx()
      .then((list) => {
        setEvents(list);
        setLoaded(true);
      })
      .catch((err) => setError(err.message));
    api.getRfxFacets().then(setFacets).catch(() => undefined);
  };

  useEffect(() => {
    api.listBuyers().then(setBuyers).catch(() => undefined);
    loadEvents();
  }, []);

  const filtered = useMemo(() => {
    const search = filters.search.trim().toLowerCase();
    const list = events.filter((e) => {
      if (filters.status && (e.status ?? "draft") !== filters.status) return false;
      if (filters.buyerId && e.buyerId !== filters.buyerId) return false;
      if (filters.category && e.category !== filters.category) return false;
      if (filters.year && new Date(e.createdAt ?? "").getFullYear() !== Number(filters.year)) return false;
      if (search && !`${e.name} ${e.category} ${e.buyer?.name ?? ""}`.toLowerCase().includes(search)) return false;
      return true;
    });

    // Pin DRAFT and PENDING events to the top
    return list.sort((a, b) => {
      const aIsDraft = a.status === "draft" || a.status === "pending";
      const bIsDraft = b.status === "draft" || b.status === "pending";
      if (aIsDraft && !bIsDraft) return -1;
      if (!aIsDraft && bIsDraft) return 1;
      return new Date(b.createdAt || 0).getTime() - new Date(a.createdAt || 0).getTime();
    });
  }, [events, filters]);

  /* The two money headlines used to be invented — savings was the literal string
     "₹18.5 L" and spend was vendors × items × ₹15,000. They now come from the
     award engine, summed across events, and each one opens its own derivation. */
  const { explain, panel } = useFigureExplainer("portfolio");
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [metrics, setMetrics] = useState<PortfolioMetrics | null>(null);
  useEffect(() => {
    api.getPortfolioMetrics().then(setMetrics).catch(() => setMetrics(null));
  }, [events.length]);

  const handleStartFresh = () => {
    sessionStorage.removeItem("qic.rfx.inProgress");
    navigate("/events/new?fresh=true");
  };

  const handleDeleteDraft = async (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    e.preventDefault();
    setDeleteError(null);
    if (!window.confirm("Permanently delete this draft event?")) return;
    setDeletingId(id);
    try {
      await api.deleteRfx(id);
      setEvents((prev) => prev.filter((r) => r.id !== id));
    } catch (err) {
      // Not window.alert: it cannot be styled, cannot be dismissed with the
      // keyboard, and blocks the whole tab until someone clicks OK.
      setDeleteError(`We couldn't delete that draft. ${(err as Error).message}`);
    } finally {
      setDeletingId(null);
    }
  };

  return (
    <div
      className="min-h-[100dvh]"
      onDragOver={(e) => { e.preventDefault(); setIsDraggingOver(true); }}
      onDragLeave={() => setIsDraggingOver(false)}
    >
      {/* ── Page header ── */}
      <header
        className="sticky top-0 z-header border-b bg-[var(--surface)]/85 backdrop-blur-md"
        style={{ borderColor: "var(--line)" }}
      >
        <div className="mx-auto max-w-[1600px] px-6 py-4 flex items-center justify-between">
          <div className="relative w-96">
            <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[var(--ink-muted)]">
              <Icon name="search" size={15} />
            </span>
            <input 
              type="text" 
              placeholder="Search events, vendors or documents"
              aria-label="Search sourcing events"
              value={filters.search}
              onChange={(e) => setFilters((f) => ({ ...f, search: e.target.value }))}
              className="pressable w-full rounded-lg border border-[var(--line)] bg-[var(--surface-sunken)] py-[7px] pl-9 pr-4 text-[13px] outline-none placeholder:text-[var(--ink-muted)] focus:border-[var(--ink)] focus:bg-[var(--surface)]"
            />
          </div>
          <div className="flex items-center gap-4">
            <button
              onClick={handleStartFresh}
              className="pressable flex items-center gap-2 rounded-lg bg-[var(--accent)] px-3.5 py-2 text-[13px] font-medium text-[var(--ink-inverse)] shadow-[var(--shadow-raised)] hover:bg-[var(--accent-hover)]"
            >
              <Icon name="spark" size={13} />
              Draft a new RFx
            </button>
          </div>
        </div>
      </header>

      {/* ── Main content ── */}
      <main className="mx-auto max-w-[1600px] space-y-5 px-6 py-6 pb-36">
        {error && <ErrorState message={error} onRetry={loadEvents} />}
        {deleteError && <InlineError message={deleteError} onDismiss={() => setDeleteError(null)} />}
        {!loaded && !error && (
          <>
            <Skeleton variant="tiles" />
            <Skeleton variant="table" rows={7} cols={5} />
          </>
        )}

        {loaded && (
          <>
            {/* ════ KPI Dashboard ════ */}
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
              <KpiCard
                title="Active sourcing value"
                value={metrics ? formatInr(metrics.activeValue) : "…"}
                hint={
                  metrics
                    ? `${metrics.counts.active} event(s) in flight`
                    : undefined
                }
                onExplain={() => explain("portfolio_active_value")}
              />
              <KpiCard title="Events in progress" value={metrics ? String(metrics.counts.active) : "…"} statusPill="SUBMITTED" />
              <KpiCard title="Pending / draft" value={metrics ? String(metrics.counts.draft) : "…"} statusPill="review_required" />
              <KpiCard
                title="Savings captured"
                value={metrics ? formatInr(metrics.savingsCaptured) : "…"}
                hint={metrics ? `across ${metrics.counts.awarded} awarded event(s)` : undefined}
                tone={metrics && metrics.savingsCaptured > 0 ? "good" : undefined}
                onExplain={() => explain("portfolio_savings")}
              />
            </div>

            {/* ════ Data Table ════ */}
            <div className="panel overflow-hidden">
              <div className="px-5 py-4" style={{ borderBottom: "1px solid var(--line)" }}>
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <h2 className="text-[14px] font-semibold tracking-[-0.012em] text-[var(--ink)]">All sourcing events</h2>
                    <p className="text-[12px] text-[var(--ink-secondary)]">
                      Drafts and pending events sit at the top.
                    </p>
                  </div>
                </div>

                <div className="mt-3 flex flex-wrap gap-2">
                  <input
                    value={filters.search}
                    onChange={(e) => setFilters((f) => ({ ...f, search: e.target.value }))}
                    placeholder="Search events, categories, buyers…"
                    className="pressable min-w-[240px] flex-1 rounded-lg border border-[var(--line)] bg-[var(--surface-sunken)] px-3 py-[7px] text-[12.5px] outline-none placeholder:text-[var(--ink-muted)] focus:border-[var(--ink)] focus:bg-[var(--surface)]"
                  />
                  <FilterSelect
                    value={filters.status}
                    onChange={(v) => setFilters((f) => ({ ...f, status: v }))}
                    label="All statuses"
                    options={(facets?.statuses ?? []).map((s) => ({ value: s, label: getStatusCfg(s).label }))}
                  />
                </div>
              </div>

              {/* Column headings */}
              <div className="eyebrow grid grid-cols-[minmax(0,1.8fr)_150px_100px_130px_140px_92px] gap-2 bg-[var(--surface-sunken)] px-5 py-2"
                style={{ borderBottom: "1px solid var(--line)" }}>
                <span>Event</span>
                <span>Category</span>
                <span>Progress</span>
                <span>Status</span>
                <span>Buyer</span>
                <span className="text-right">Action / Date</span>
              </div>

              {/* Rows */}
              <div className="stagger">
                {filtered.map((e) => {
                  const cfg = getStatusCfg(e.status ?? "draft");
                  const progress = eventProgress(e);
                  const isDraft = e.status === "draft" || e.status === "pending";

                  return (
                    <div
                      key={e.id}
                      // Every row opens its own event. Sending drafts to the blank
                      // builder lost the draft entirely — the builder has no way to
                      // load a saved record, so it restored unrelated sessionStorage.
                      // The overview IS the draft editor, so drafts go there too.
                      onClick={() => navigate(`/events/${e.id}/overview`)}
                      role="link"
                      tabIndex={0}
                      onKeyDown={(evt) => {
                        if (evt.key === "Enter" || evt.key === " ") {
                          evt.preventDefault();
                          navigate(`/events/${e.id}/overview`);
                        }
                      }}
                      className="grid w-full cursor-pointer grid-cols-[minmax(0,1.8fr)_150px_100px_130px_140px_92px] items-center gap-2 px-5 py-3 text-left transition-colors hover:bg-[var(--surface-hover)]"
                      style={{
                        borderTop: "1px solid var(--line)",
                        borderLeft: isDraft ? "2.5px solid var(--warning)" : "2.5px solid transparent",
                        background: isDraft ? "var(--warning-soft)" : undefined,
                      }}
                    >
                      {/* Name + meta */}
                      <div className="min-w-0 pr-4">
                        <div className="flex min-w-0 items-center gap-2">
                          <span className={`h-1.5 w-1.5 flex-none rounded-full ${cfg.dot}`} />
                          <span className="truncate text-[13px] font-medium text-[var(--ink)]" title={e.name}>
                            {e.name}
                          </span>
                          {isDraft && (
                            <span
                              className="flex-none rounded-[4px] px-1.5 py-[1px] text-[10px] font-medium uppercase tracking-[0.06em]"
                              style={{
                                background: "var(--surface)",
                                color: "var(--warning)",
                                boxShadow: "inset 0 0 0 1px var(--warning-line)",
                              }}
                            >
                              Resume
                            </span>
                          )}
                        </div>
                        <p className="num mt-0.5 truncate pl-3.5 text-[11px] text-[var(--ink-muted)]">
                          {e._count?.lineItems ?? 0} items
                          {e._count?.vendors ? ` · ${e._count.vendors} vendor responses` : ""}
                        </p>
                      </div>

                      {/* Category */}
                      <span className="truncate text-[12px] text-[var(--ink-secondary)]">{e.category || "—"}</span>

                      {/* Progress bar */}
                      <div className="pr-3">
                        <div className="flex items-center gap-1.5">
                          <div className="relative h-1 flex-1 overflow-hidden rounded-full" style={{ background: "var(--surface-hover)" }}>
                            <div
                              className="absolute left-0 top-0 h-full rounded-full transition-[width] duration-700 ease-out"
                              style={{ width: `${progress}%`, background: "var(--ink)" }}
                            />
                          </div>
                          <span className="num w-7 text-right text-[10px] text-[var(--ink-muted)]">{progress}%</span>
                        </div>
                      </div>

                      {/* Status pill */}
                      <StatusPill status={cfg.pillKey} />

                      {/* Buyer */}
                      <span className="truncate text-[12px] text-[var(--ink-secondary)]">{e.buyer?.name ?? "Unattributed"}</span>

                      {/* Date & Actions */}
                      <div className="flex items-center justify-end gap-2">
                        {isDraft && (
                          <button
                            onClick={(evt) => handleDeleteDraft(e.id, evt)}
                            disabled={deletingId === e.id}
                            className="pressable rounded-md p-1 text-[var(--ink-muted)] hover:bg-[var(--critical-soft)] hover:text-[var(--critical)] disabled:opacity-40"
                          >
                            <Icon name="trash" size={14} title="Delete draft" />
                          </button>
                        )}
                        <span className="num text-right text-[11px] text-[var(--ink-muted)]">
                          {e.createdAt
                            ? new Date(e.createdAt).toLocaleDateString("en-IN", {
                                day: "numeric",
                                month: "short",
                              })
                            : "—"}
                        </span>
                      </div>
                    </div>
                  );
                })}
                {filtered.length === 0 && (
                  <EmptyState
                    icon="search"
                    title="No events match these filters"
                    hint="Clear the search box or pick a different status to see the rest of the register."
                  />
                )}
              </div>
            </div>
          </>
        )}

        {panel}
      </main>
    </div>
  );
}

/** A portfolio headline. The trend arrows that used to sit here were hardcoded
 * percentages against no baseline, so they are gone — there is no period-on-period
 * history in this dataset to compute one from. */
function KpiCard({
  title,
  value,
  hint,
  tone,
  statusPill,
  onExplain,
}: {
  title: string;
  value: string;
  hint?: string;
  tone?: "good";
  statusPill?: string;
  onExplain?: () => void;
}) {
  const figure = (
    <span
      className="num-lg text-[28px] font-semibold leading-none"
      style={{ color: tone === "good" ? "var(--good)" : "var(--ink)" }}
    >
      {value}
    </span>
  );
  return (
    <div
      className="flex flex-col justify-between rounded-xl border bg-[var(--surface)] p-5 shadow-[var(--shadow-raised)]"
      style={{ borderColor: "var(--line)" }}
    >
      <div className="eyebrow">{title}</div>
      <div className="mt-2.5 flex items-end justify-between gap-3">
        {onExplain ? (
          <button type="button" onClick={onExplain} className="explainable text-left" title="Show how this is calculated">
            {figure}
          </button>
        ) : (
          figure
        )}
        {statusPill && <StatusPill status={statusPill} />}
      </div>
      {hint && <div className="mt-1.5 text-[11.5px] text-[var(--ink-muted)]">{hint}</div>}
    </div>
  );
}

function FilterSelect({
  value,
  onChange,
  label,
  options,
}: {
  value: string;
  onChange: (v: string) => void;
  label: string;
  options: Array<{ value: string; label: string }>;
}) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className={`pressable rounded-lg border px-2.5 py-[7px] text-[12.5px] outline-none ${
        value
          ? "border-[var(--ink)] bg-[var(--accent-soft)] text-[var(--ink)]"
          : "border-[var(--line)] bg-[var(--surface)] text-[var(--ink-secondary)]"
      }`}
    >
      <option value="">{label}</option>
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  );
}
