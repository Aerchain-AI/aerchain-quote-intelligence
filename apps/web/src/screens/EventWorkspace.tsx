import { useEffect, useState } from "react";
import Icon from "../components/Icon";
import ResponsesScreen from "./ResponsesScreen";
import { Link, NavLink, Navigate, Route, Routes, useLocation, useParams } from "react-router-dom";
import { ErrorState, Spinner } from "../components/ui";
import { api, type RfxDetail } from "../lib/api";
import AwardScreen from "./AwardScreen";
import ComparisonScreen from "./ComparisonScreen";
import EventOverview from "./EventOverview";
import VendorsScreen from "./VendorsScreen";

/**
 * One event's workspace. Every tab here operates on the event in the URL, so
 * what you opened is what you see.
 *
 * Tabs that depend on vendor responses stay visible but disabled when the event
 * has none — hiding them would leave a buyer wondering where the comparison
 * went; disabling them with a reason answers the question.
 */

interface TabDef {
  to: string;
  label: string;
  step: string;
  /** Needs at least one processed vendor response to mean anything. */
  needsResponses?: boolean;
}

const TABS: TabDef[] = [
  { to: "overview", label: "Overview", step: "1" },
  { to: "responses", label: "Supplier Replies", step: "2" },
  { to: "vendors", label: "Vendor Responses", step: "3", needsResponses: true },
  { to: "comparison", label: "Comparison", step: "4", needsResponses: true },
  { to: "award", label: "Award Recommendation", step: "5", needsResponses: true },
];

export default function EventWorkspace() {
  const { rfxId = "" } = useParams();
  const location = useLocation();
  const [detail, setDetail] = useState<RfxDetail | null>(null);
  const [error, setError] = useState<string | null>(null);

  const isComparisonRoute = location.pathname.endsWith("/comparison");

  const load = () => {
    api.getRfx(rfxId).then(setDetail).catch((err) => setError(err.message));
  };
  useEffect(load, [rfxId]);

  if (error) {
    return (
      <Shell>
        <ErrorState message={error} />
      </Shell>
    );
  }
  if (!detail) {
    return (
      <Shell>
        <Spinner label="Loading sourcing event…" />
      </Shell>
    );
  }

  const hasResponses = detail.vendors.length > 0;
  const disabledReason =
    detail.status === "draft"
      ? "This event is still a draft — no vendor responses have been collected yet."
      : "No vendor responses are stored against this event.";

  return (
    <div className="min-h-[100dvh]">
      <header
        className="sticky top-0 z-header border-b bg-[var(--surface)]/88 backdrop-blur-md"
        style={{ borderColor: "var(--line)" }}
      >
        <div className="mx-auto max-w-[1600px] px-6 py-3">
          {/* In-context way out. The sidebar can get you back, but a workspace
              you drilled into should say where it came from. */}
          <Link
            to="/events"
            className="pressable inline-flex items-center gap-1.5 text-[12px] font-medium text-[var(--ink-secondary)] hover:text-[var(--ink)]"
          >
            <Icon name="arrow-left" size={13} />
            All sourcing events
          </Link>
          <div className="mt-1 flex flex-wrap items-baseline justify-between gap-4">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="display text-[17px] text-[var(--ink)]">{detail.name}</h1>
              <StatusChip status={detail.status ?? "draft"} />
            </div>
            <p className="text-[12px] text-[var(--ink-secondary)]">
              {detail.category} · {detail.currency} · {detail.lineItems?.length ?? 0} items ·{" "}
              {detail.buyer?.name ?? "unattributed"} · required by{" "}
              {new Date(detail.requiredByDate).toLocaleDateString("en-IN", {
                day: "numeric",
                month: "short",
                year: "numeric",
              })}
            </p>
          </div>
        </div>

        <nav className="mx-auto max-w-[1600px] px-6">
          <div className="flex gap-1 overflow-x-auto">
            {TABS.map((tab) => {
              const blocked = Boolean(tab.needsResponses) && !hasResponses;
              if (blocked) {
                return (
                  <span
                    key={tab.to}
                    title={disabledReason}
                    className="flex cursor-not-allowed items-center gap-2 whitespace-nowrap border-b-2 border-transparent px-3 py-2.5 text-[13px] font-medium text-[var(--ink-muted)] opacity-55"
                  >
                    <span className="text-[10px] font-semibold">{tab.step}</span>
                    {tab.label}
                  </span>
                );
              }
              return (
                <NavLink
                  key={tab.to}
                  to={tab.to}
                  className={({ isActive }) =>
                    `pressable flex items-center gap-2 whitespace-nowrap border-b-2 px-3 py-2.5 text-[13px] font-medium ${
                      isActive
                        ? "border-[var(--ink)] text-[var(--ink)]"
                        : "border-transparent text-[var(--ink-secondary)] hover:border-[var(--line-strong)] hover:text-[var(--ink)]"
                    }`
                  }
                >
                  <span className="num text-[10px] text-[var(--ink-muted)]">{tab.step}</span>
                  {tab.label}
                </NavLink>
              );
            })}
          </div>
        </nav>
      </header>

      <main className={isComparisonRoute ? "px-4 py-2 overflow-x-hidden" : "mx-auto max-w-[1600px] px-6 py-6"}>
        {!hasResponses && (
          <p
            className="mb-4 flex items-start gap-2 rounded-lg px-4 py-2.5 text-[12px] leading-relaxed text-[var(--ink-secondary)]"
            style={{ border: "1px solid var(--line)", background: "var(--surface-sunken)" }}
          >
            <span className="mt-[1px] text-[var(--ink-muted)]">
              <Icon name="info" size={14} />
            </span>
            {disabledReason} The later steps unlock once responses are ingested.
          </p>
        )}
        <Routes>
          <Route index element={<Navigate to="overview" replace />} />
          <Route path="overview" element={<EventOverview rfxId={rfxId} onSaved={load} />} />
          <Route path="responses" element={<ResponsesScreen rfxId={rfxId} />} />
          {hasResponses && (
            <>
              <Route path="vendors/*" element={<VendorsScreen rfxId={detail.id} />} />
              <Route path="comparison" element={<ComparisonScreen rfxId={detail.id} />} />
              <Route path="award" element={<AwardScreen rfxId={detail.id} />} />
            </>
          )}
          {/* Any workflow route on an event without responses falls back to overview. */}
          <Route path="*" element={<Navigate to="overview" replace />} />
        </Routes>
      </main>
    </div>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen">
      <header className="border-b border-[var(--line)] bg-[var(--surface)]">
        <div className="mx-auto max-w-[1600px] px-6 py-3">
          <Link to="/events" className="text-[12px] font-medium text-[var(--info)] hover:text-[var(--info)]">
            <Icon name="arrow-left" size={13} /> All sourcing events
          </Link>
        </div>
      </header>
      <main className="mx-auto max-w-[1600px] px-6 py-6">{children}</main>
    </div>
  );
}

function StatusChip({ status }: { status: string }) {
  const map: Record<string, string> = {
    awarded: "bg-[var(--good-soft)] text-[var(--good)] ring-[var(--good-line)]",
    active: "bg-[var(--info-soft)] text-[var(--info)] ring-[var(--info-line)]",
    draft: "bg-[var(--warning-soft)] text-[var(--warning)] ring-[var(--warning-line)]",
  };
  return (
    <span
      className={`rounded px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide ring-1 ring-inset ${map[status] ?? map.draft}`}
    >
      {status}
    </span>
  );
}
