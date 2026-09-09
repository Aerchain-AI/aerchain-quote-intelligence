import { useEffect, useState } from "react";
import Icon from "../components/Icon";
import { Card, CardHeader, EmptyState, ErrorState, Skeleton } from "../components/ui";
import { api, formatInr, type SupplierRecord } from "../lib/api";

/**
 * The supplier registry.
 *
 * It listed quote responses before, which is a different thing: a response
 * belongs to one event, a supplier persists across all of them. What a buyer
 * wants here is who they can buy from, whether that supplier is actually cleared
 * to be paid, and what happened last time.
 *
 * Verification is given its own column rather than a footnote. A supplier whose
 * registration is still pending can be quoted and compared, and awarding to them
 * is a decision someone has to take knowingly.
 */
export default function VendorsDirectoryScreen() {
  const [suppliers, setSuppliers] = useState<SupplierRecord[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);

  const load = () => {
    setError(null);
    api.listSuppliers().then(setSuppliers).catch((err) => setError(err.message));
  };
  useEffect(load, []);

  if (error) return <ErrorState message={error} onRetry={load} />;
  if (!suppliers)
    return (
      <div className="mx-auto max-w-[1200px] space-y-4 px-8 py-8">
        <Skeleton variant="table" rows={6} cols={5} />
      </div>
    );

  const pending = suppliers.filter((s) => s.verificationStatus === "pending");

  return (
    <div className="stagger mx-auto max-w-[1200px] space-y-4 px-8 py-8">
      <div>
        <h1 className="display text-[24px] text-[var(--ink)]">Supplier registry</h1>
        <p className="measure mt-1 text-[13px] text-[var(--ink-secondary)]">
          Who you can buy from, whether they are cleared, and what is on record from previous procurement.
        </p>
      </div>

      {pending.length > 0 && (
        <div
          className="flex items-start gap-2.5 rounded-lg px-4 py-3"
          style={{ border: "1px solid var(--warning-line)", background: "var(--warning-soft)" }}
        >
          <span className="mt-[1px]" style={{ color: "var(--warning)" }}>
            <Icon name="alert" size={14} />
          </span>
          <p className="measure text-[12.5px] leading-relaxed text-[var(--ink-secondary)]">
            <span className="font-medium text-[var(--ink)]">
              {pending.map((s) => s.name).join(", ")}
            </span>{" "}
            {pending.length === 1 ? "is" : "are"} still pending verification. Quotes are compared normally; awarding
            before the registration clears is a decision to take knowingly.
          </p>
        </div>
      )}

      {suppliers.length === 0 ? (
        <Card>
          <EmptyState
            icon="vendors"
            title="No suppliers registered yet"
            hint="Import a supplier master, or add one when issuing an RFx, and they will appear here."
          />
        </Card>
      ) : (
        <Card className="overflow-hidden">
          <CardHeader title={`${suppliers.length} suppliers`} subtitle="Click a row for what is on record" />
          <div className="thin-scroll overflow-x-auto">
            <table className="grid-table">
              <thead>
                <tr>
                  <th className="!text-left">Supplier</th>
                  <th className="!text-left">Location</th>
                  <th className="!text-left">GSTIN</th>
                  <th className="!text-left">Verification</th>
                  <th className="!text-right">Awards on record</th>
                  <th className="!text-left">Payment terms</th>
                </tr>
              </thead>
              <tbody>
                {suppliers.map((s) => {
                  const open = expanded === s.id;
                  return (
                    <>
                      <tr
                        key={s.id}
                        onClick={() => setExpanded(open ? null : s.id)}
                        className="cursor-pointer"
                      >
                        <td className="text-left">
                          <div className="flex items-center gap-1.5">
                            <span
                              className="transition-transform"
                              style={{ color: "var(--ink-muted)", transform: open ? "rotate(90deg)" : undefined }}
                            >
                              <Icon name="chevron-right" size={12} />
                            </span>
                            <span className="text-[13px] font-medium text-[var(--ink)]">{s.name}</span>
                          </div>
                          <div className="pl-[18px] text-[11px] text-[var(--ink-muted)]">{s.email}</div>
                        </td>
                        <td className="text-left text-[var(--ink-secondary)]">{s.city ?? "—"}</td>
                        <td className="num text-left text-[11.5px] text-[var(--ink-secondary)]">{s.gstin ?? "—"}</td>
                        <td className="text-left">
                          <VerificationBadge status={s.verificationStatus} />
                        </td>
                        <td className="num text-right">
                          {s.historyCount === 0 ? (
                            <span className="text-[var(--ink-muted)]">No record</span>
                          ) : (
                            <>
                              {s.awardedCount} of {s.historyCount}
                            </>
                          )}
                        </td>
                        <td className="text-left text-[var(--ink-secondary)]">{s.paymentTerms ?? "—"}</td>
                      </tr>

                      {open && (
                        <tr key={`${s.id}-detail`}>
                          <td colSpan={6} className="!p-0">
                            <div className="px-5 py-4" style={{ background: "var(--surface-sunken)" }}>
                              {s.verificationNote && (
                                <p className="text-[12px] text-[var(--ink-secondary)]">
                                  <span className="eyebrow mr-2">Verification</span>
                                  {s.verificationNote}
                                </p>
                              )}

                              <div className="mt-3">
                                <div className="eyebrow">Previous procurement</div>
                                {s.history.length === 0 ? (
                                  <p className="mt-1 text-[12px] text-[var(--ink-muted)]">
                                    Nothing on record. That is an absence of history, not a poor one.
                                  </p>
                                ) : (
                                  <ul className="mt-1.5 space-y-1.5">
                                    {s.history.map((h) => (
                                      <li key={h.externalId} className="flex flex-wrap items-baseline gap-x-3 text-[12px]">
                                        <span
                                          className="inline-flex items-center gap-1 font-medium"
                                          style={{ color: h.result === "awarded" ? "var(--good)" : "var(--ink-secondary)" }}
                                        >
                                          {h.result === "awarded" && <Icon name="check" size={11} />}
                                          {h.result === "awarded" ? "Awarded" : "Bid, not awarded"}
                                        </span>
                                        <span className="text-[var(--ink)]">{h.title}</span>
                                        <span className="num text-[11px] text-[var(--ink-muted)]">{h.externalId}</span>
                                        {h.awardValueInr != null && (
                                          <span className="num text-[var(--ink-secondary)]">
                                            {formatInr(h.awardValueInr)}
                                          </span>
                                        )}
                                        {h.performance && (
                                          <span className="text-[11px] text-[var(--ink-muted)]">{h.performance}</span>
                                        )}
                                        <span
                                          className="text-[11px]"
                                          style={{ color: h.qualityIncidents > 0 ? "var(--warning)" : "var(--ink-muted)" }}
                                        >
                                          {h.qualityIncidents} quality incident(s)
                                        </span>
                                      </li>
                                    ))}
                                  </ul>
                                )}
                              </div>

                              {s.currentInvitations.length > 0 && (
                                <div className="mt-3">
                                  <div className="eyebrow">Currently invited to</div>
                                  <ul className="mt-1.5 space-y-1">
                                    {s.currentInvitations.map((i) => (
                                      <li key={i.rfxId} className="text-[12px] text-[var(--ink-secondary)]">
                                        {i.rfxName}
                                        <span className="ml-2 text-[11px] text-[var(--ink-muted)]">
                                          {i.status === "responded" ? "responded" : "awaiting reply"}
                                        </span>
                                      </li>
                                    ))}
                                  </ul>
                                </div>
                              )}
                            </div>
                          </td>
                        </tr>
                      )}
                    </>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Card>
      )}
    </div>
  );
}

/** Verification has its own words. Borrowing the extraction vocabulary made a
 * cleared supplier read "Processed", which says nothing about whether they can
 * be paid. */
function VerificationBadge({ status }: { status: string }) {
  const map: Record<string, { label: string; tone: "good" | "warning" | "neutral" }> = {
    verified: { label: "Verified", tone: "good" },
    pending: { label: "Pending verification", tone: "warning" },
    unverified: { label: "Not verified", tone: "neutral" },
  };
  const entry = map[status] ?? map.unverified;
  const colour =
    entry.tone === "good"
      ? { bg: "var(--good-soft)", fg: "var(--good)", line: "var(--good-line)" }
      : entry.tone === "warning"
        ? { bg: "var(--warning-soft)", fg: "var(--warning)", line: "var(--warning-line)" }
        : { bg: "var(--surface-sunken)", fg: "var(--ink-secondary)", line: "var(--line-strong)" };
  return (
    <span
      className="inline-flex items-center gap-1.5 rounded-[5px] px-1.5 py-[3px] text-[11.5px] font-medium"
      style={{ background: colour.bg, color: colour.fg, boxShadow: `inset 0 0 0 1px ${colour.line}` }}
    >
      <Icon name={entry.tone === "good" ? "check" : entry.tone === "warning" ? "alert" : "info"} size={11} />
      {entry.label}
    </span>
  );
}
