import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useFigureExplainer } from "../components/ExplainFigure";
import Icon from "../components/Icon";
import ProcurementHistory from "../components/ProcurementHistory";
import { api, formatInr, type PortfolioMetrics, type Rfx } from "../lib/api";
import { listDrafts, removeDraft, type StoredDraft } from "../lib/rfxDrafts";

export default function DashboardScreen() {
  const [rfxs, setRfxs] = useState<Rfx[]>([]);
  const [loading, setLoading] = useState(true);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  // RFx drafts the buyer started and did not finish. They are not events and
  // never reach the server, so they are read straight from the browser.
  const [drafts, setDrafts] = useState<StoredDraft[]>([]);
  const navigate = useNavigate();

  const loadEvents = () => {
    setLoading(true);
    api.listRfx()
      .then((data) => setRfxs(data))
      .catch(() => setRfxs([]))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    loadEvents();
    setDrafts(listDrafts());
  }, []);

  // Sort PENDING and DRAFT events to the top
  const sortedRfxs = useMemo(() => {
    return [...rfxs].sort((a, b) => {
      const aIsDraft = a.status === "draft" || a.status === "pending";
      const bIsDraft = b.status === "draft" || b.status === "pending";
      if (aIsDraft && !bIsDraft) return -1;
      if (!aIsDraft && bIsDraft) return 1;
      return new Date(b.createdAt || 0).getTime() - new Date(a.createdAt || 0).getTime();
    });
  }, [rfxs]);

  const activeCount = rfxs.filter((r) => r.status === "active" || r.status === "issued").length;
  const draftCount = rfxs.filter((r) => r.status === "draft" || r.status === "pending").length;
  const awardedCount = rfxs.filter((r) => r.status === "awarded").length;

  const handleDeleteDraft = async (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    e.preventDefault();
    if (!window.confirm("Permanently delete this draft event?")) return;
    setDeletingId(id);
    try {
      await api.deleteRfx(id);
      setRfxs((prev) => prev.filter((r) => r.id !== id));
    } catch (err) {
      alert(`Failed to delete draft: ${(err as Error).message}`);
    } finally {
      setDeletingId(null);
    }
  };

  const { explain, panel } = useFigureExplainer("portfolio");
  const [metrics, setMetrics] = useState<PortfolioMetrics | null>(null);
  useEffect(() => {
    api.getPortfolioMetrics().then(setMetrics).catch(() => setMetrics(null));
  }, []);

  // Starting a new one no longer discards the one in progress: it keeps its own
  // id and stays in the list below.
  const handleStartFresh = () => {
    navigate("/events/new?fresh=true");
  };

  const discardDraft = (id: string) => {
    removeDraft(id);
    setDrafts(listDrafts());
  };

  return (
    <div className="mx-auto max-w-[1200px] px-8 py-8 space-y-8">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="display text-[24px] text-[var(--ink)]">Overview</h1>
          <p className="mt-1 text-sm text-[var(--ink-muted)]">
            Real-time status of sourcing events, supplier response extractions, and AI copilot insights.
          </p>
        </div>
        <button
          onClick={handleStartFresh}
          type="button"
          className="inline-flex items-center gap-2 rounded-lg bg-[var(--accent)] px-4 py-2.5 text-sm font-semibold text-[var(--ink-inverse)] shadow-sm hover:bg-[var(--accent-hover)] transition-colors"
        >
          <Icon name="spark" size={13} /> New RFx event
        </button>
      </div>

      {/* Unfinished drafts.
          A draft abandoned halfway used to exist only in the tab it was typed
          in, and clicking "New RFx" deleted it without asking. It is the most
          expensive thing on this screen to lose: the conversation, the item
          list, and every correction made by hand. */}
      {drafts.length > 0 && (
        <div className="panel overflow-hidden">
          <div className="flex items-center justify-between gap-3 border-b border-[var(--line)] px-5 py-3">
            <div>
              <p className="text-[13px] font-semibold text-[var(--ink)]">Unfinished RFx drafts</p>
              <p className="mt-0.5 text-[11.5px] text-[var(--ink-muted)]">
                Saved in this browser. Nothing has been created from them yet.
              </p>
            </div>
            <span className="num text-[12px] text-[var(--ink-muted)]">{drafts.length}</span>
          </div>
          <ul className="divide-y divide-[var(--line)]">
            {drafts.map((d) => (
              <li key={d.id} className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 px-5 py-3">
                <div className="min-w-0">
                  <p className="truncate text-[13px] font-medium text-[var(--ink)]">{d.title}</p>
                  <p className="mt-0.5 text-[11.5px] text-[var(--ink-muted)]">
                    {d.stageLabel}
                    {d.itemCount > 0 ? ` · ${d.itemCount} item(s)` : ""} · last edited{" "}
                    {new Date(d.updatedAt).toLocaleString("en-IN", {
                      day: "numeric",
                      month: "short",
                      hour: "numeric",
                      minute: "2-digit",
                    })}
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <button
                    onClick={() => navigate(`/events/new?draft=${encodeURIComponent(d.id)}`)}
                    className="pressable rounded-md bg-[var(--accent)] px-3 py-1.5 text-[12px] font-medium text-[var(--ink-inverse)] hover:bg-[var(--accent-hover)]"
                  >
                    Continue
                  </button>
                  <button
                    onClick={() => discardDraft(d.id)}
                    className="pressable rounded-md border border-[var(--line-strong)] px-2.5 py-1.5 text-[12px] font-medium text-[var(--ink-secondary)] hover:text-[var(--critical)]"
                  >
                    Discard
                  </button>
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Metric Cards */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-5">
        <div className="panel p-5">
          <p className="eyebrow">Active events</p>
          <p className="num-lg mt-2 text-[28px] font-semibold text-[var(--ink)]">{activeCount}</p>
          <p className="mt-1.5 text-[11.5px] text-[var(--ink-secondary)]">In evaluation or quote analysis</p>
        </div>
        <div
          className="rounded-[10px] p-5"
          style={{ border: "1px solid var(--warning-line)", background: "var(--warning-soft)" }}
        >
          <p className="eyebrow" style={{ color: "var(--warning)" }}>
            Pending / draft
          </p>
          <p className="num-lg mt-2 text-[28px] font-semibold" style={{ color: "var(--warning)" }}>
            {draftCount}
          </p>
          <p className="mt-1.5 text-[11.5px] text-[var(--ink-secondary)]">Waiting on a buyer</p>
        </div>
        <div className="panel p-5">
          <p className="eyebrow">Awarded events</p>
          <p className="num-lg mt-2 text-[28px] font-semibold text-[var(--ink)]">{awardedCount}</p>
          <p className="mt-1.5 text-[11.5px] text-[var(--ink-secondary)]">Decisions with a traceable basis</p>
        </div>
        <div className="group panel p-5">
          <p className="eyebrow">Savings captured</p>
          <button
            type="button"
            onClick={() => explain("portfolio_savings")}
            className="explainable mt-2 block text-left"
            title="Show which events this is summed from"
          >
            <span
              className="num-lg text-[28px] font-semibold"
              style={{ color: metrics && metrics.savingsCaptured > 0 ? "var(--good)" : "var(--ink)" }}
            >
              {metrics ? formatInr(metrics.savingsCaptured) : "…"}
            </span>
          </button>
          <p className="mt-1.5 text-[11.5px] text-[var(--ink-secondary)]">
            {metrics ? `Across ${metrics.counts.awarded} awarded event(s)` : "Summing awarded events…"}
          </p>
        </div>
      </div>

      {/* Sourcing Events List (Prioritizing Draft/Pending at the top) */}
      <div className="rounded-xl border border-[var(--line)] bg-[var(--surface)] shadow-sm overflow-hidden">
        <div className="flex items-center justify-between border-b border-[var(--line)] px-6 py-4 bg-[var(--surface-sunken)]">
          <div>
            <h2 className="text-base font-semibold text-[var(--ink)]">Sourcing events</h2>
            <p className="text-xs text-[var(--ink-muted)]">Drafts and pending events are pinned to the top.</p>
          </div>
          <Link to="/events" className="text-xs font-medium text-[var(--ink)] hover:text-[var(--ink)] inline-flex items-center gap-1.5">
            View all <Icon name="arrow-right" size={12} />
          </Link>
        </div>
        {loading ? (
          <div className="p-8 text-center text-sm text-[var(--ink-muted)]">Loading events…</div>
        ) : sortedRfxs.length === 0 ? (
          <div className="p-8 text-center text-sm text-[var(--ink-muted)]">No sourcing events yet.</div>
        ) : (
          <div className="divide-y divide-[var(--line)]">
            {sortedRfxs.map((r) => {
              const isDraft = r.status === "draft" || r.status === "pending";
              return (
                <div
                  key={r.id}
                  className={`flex items-center justify-between px-6 py-4 transition-colors ${
                    isDraft ? "border-l-4 border-[var(--warning)] bg-[var(--warning-soft)] hover:bg-[var(--warning-soft)]" : "hover:bg-[var(--surface-sunken)]"
                  }`}
                >
                  <div>
                    <div className="flex items-center gap-2">
                      <Link
                        to={isDraft ? "/events/new" : `/events/${r.id}/overview`}
                        className="text-sm font-semibold text-[var(--ink)] hover:text-[var(--ink)]"
                      >
                        {r.name}
                      </Link>
                      {isDraft && (
                        <span
                          className="inline-flex items-center rounded-[4px] px-1.5 py-[1px] text-[10px] font-medium uppercase tracking-[0.06em]"
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
                    <p className="mt-0.5 text-xs text-[var(--ink-muted)]">
                      {r.category} · {r._count?.lineItems ?? 0} items · Raised by {r.buyer?.name || "Buyer"}
                    </p>
                  </div>

                  <div className="flex items-center gap-3">
                    <span
                      className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${
                        r.status === "awarded"
                          ? "bg-[var(--good-soft)] text-[var(--good)]"
                          : r.status === "active"
                          ? "bg-[var(--info-soft)] text-[var(--info)]"
                          : "bg-[var(--warning-soft)] text-[var(--warning)] border border-[var(--warning-line)]"
                      }`}
                    >
                      {r.status}
                    </span>

                    {isDraft ? (
                      <Link
                        to="/events/new"
                        className="pressable inline-flex items-center gap-1.5 rounded-lg bg-[var(--accent)] px-3 py-1.5 text-[12px] font-medium text-[var(--ink-inverse)] hover:bg-[var(--accent-hover)]"
                      >
                        Resume draft <Icon name="arrow-right" size={12} />
                      </Link>
                    ) : (
                      <Link
                        to={`/events/${r.id}/comparison`}
                        className="rounded border border-[var(--line)] px-3 py-1.5 text-xs font-medium text-[var(--ink-secondary)] hover:bg-[var(--surface-hover)]"
                      >
                        Open Workspace
                      </Link>
                    )}

                    {/* Delete action for draft/pending events */}
                    {isDraft && (
                      <button
                        onClick={(e) => handleDeleteDraft(r.id, e)}
                        disabled={deletingId === r.id}
                        className="rounded border border-[var(--critical-line)] bg-[var(--surface)] p-1.5 text-xs font-medium text-[var(--critical)] hover:bg-[var(--critical-soft)] hover:border-[var(--critical-line)] transition-colors disabled:opacity-50"
                        title="Delete abandoned draft"
                      >
                        {deletingId === r.id ? <Icon name="refresh" size={13} className="animate-spin" /> : <Icon name="trash" size={13} title="Delete draft" />}
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      <ProcurementHistory compact />

      {panel}
    </div>
  );
}
