import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import Icon from "../components/Icon";
import { Button, Card, CardHeader, EmptyState, ErrorState, InlineError, Skeleton, StatusPill } from "../components/ui";
import { api, type InboxStatus, type ResponseLedger, type SyncSummary, type UnmatchedMessage } from "../lib/api";

/**
 * Who was invited, who answered, and with what.
 *
 * The panel is deliberately honest about three separate things that are easy to
 * conflate: a supplier who has not replied, a supplier who replied with a
 * question rather than a price, and a reply that arrived but could not be placed
 * against any event. Only the first is "waiting"; the other two need a person.
 */
export default function ResponsesScreen({ rfxId }: { rfxId: string }) {
  const navigate = useNavigate();
  const [ledger, setLedger] = useState<ResponseLedger | null>(null);
  const [status, setStatus] = useState<InboxStatus | null>(null);
  const [unmatched, setUnmatched] = useState<UnmatchedMessage[]>([]);
  const [sync, setSync] = useState<SyncSummary | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [syncError, setSyncError] = useState<string | null>(null);

  const load = useCallback(() => {
    setError(null);
    Promise.all([api.getResponses(rfxId), api.getInboxStatus(), api.getUnmatchedMail()])
      .then(([l, s, u]) => {
        setLedger(l);
        setStatus(s);
        setUnmatched(u);
      })
      .catch((err) => setError(err.message));
  }, [rfxId]);

  useEffect(load, [load]);

  const runSync = async () => {
    setSyncing(true);
    setSyncError(null);
    try {
      setSync(await api.syncInbox());
      load();
    } catch (err) {
      setSyncError((err as Error).message);
    } finally {
      setSyncing(false);
    }
  };

  if (error) return <ErrorState message={error} onRetry={load} />;
  if (!ledger || !status)
    return (
      <div className="mx-auto max-w-5xl space-y-4">
        <Skeleton variant="table" rows={5} cols={4} />
      </div>
    );

  const responded = ledger.invited.filter((i) => i.status === "responded").length;
  const quoted = ledger.invited.filter((i) => i.vendorId).length;

  return (
    <div className="stagger mx-auto max-w-5xl space-y-4">
      <Card>
        <CardHeader
          title="Supplier responses"
          subtitle={`${responded} of ${ledger.invited.length} invited suppliers have replied — ${quoted} with a quotation attached`}
          action={
            <Button icon="refresh" onClick={runSync} disabled={syncing}>
              {syncing ? "Checking…" : "Check for replies"}
            </Button>
          }
        />

        <div
          className="flex flex-wrap items-center gap-x-6 gap-y-1.5 px-5 py-2.5 text-[11.5px]"
          style={{ background: "var(--surface-sunken)", borderBottom: "1px solid var(--line)" }}
        >
          <span className="flex items-center gap-1.5 text-[var(--ink-secondary)]">
            <Icon name={status.connected ? "check-circle" : "info"} size={13} />
            {status.description}
          </span>
          {ledger.replyAddress ? (
            <span className="text-[var(--ink-muted)]">
              Suppliers reply to <span className="num text-[var(--ink)]">{ledger.replyAddress}</span>
            </span>
          ) : (
            <span className="text-[var(--ink-muted)]">
              Set <span className="num">INBOX_ADDRESS</span> to give this event its own reply address.
            </span>
          )}
        </div>

        {sync && (
          <div className="px-5 py-3 text-[12.5px] text-[var(--ink-secondary)]" style={{ borderBottom: "1px solid var(--line)" }}>
            Read <span className="num font-medium text-[var(--ink)]">{sync.fetched}</span> message(s):{" "}
            <span className="num">{sync.matched}</span> filed, <span className="num">{sync.attached}</span> attached as
            quotations, <span className="num">{sync.unmatched}</span> unplaced
            {sync.duplicates > 0 && <>, {sync.duplicates} already seen</>}.
          </div>
        )}
        {syncError && (
          <div className="px-5 py-3">
            <InlineError message={syncError} onDismiss={() => setSyncError(null)} />
          </div>
        )}

        {ledger.invited.length === 0 ? (
          <EmptyState
            icon="send"
            title="This event has not been issued to anyone yet"
            hint="Send the draft to suppliers and their replies will be filed here automatically."
          />
        ) : (
          <div className="thin-scroll overflow-x-auto">
            <table className="grid-table">
              <thead>
                <tr>
                  <th className="!text-left">Supplier</th>
                  <th className="!text-left">Status</th>
                  <th className="!text-left">Reply</th>
                  <th className="!text-left">Attachment</th>
                  <th className="!text-right">Received</th>
                </tr>
              </thead>
              <tbody>
                {ledger.invited.map((invite) => {
                  const awaiting = invite.status !== "responded";
                  const open = () => invite.vendorId && navigate(`/events/${rfxId}/vendors/${invite.vendorId}`);
                  return (
                    <tr
                      key={invite.supplierId}
                      onClick={open}
                      onKeyDown={(e) => {
                        if (invite.vendorId && (e.key === "Enter" || e.key === " ")) {
                          e.preventDefault();
                          open();
                        }
                      }}
                      tabIndex={invite.vendorId ? 0 : undefined}
                      role={invite.vendorId ? "link" : undefined}
                      className={invite.vendorId ? "cursor-pointer" : undefined}
                      title={invite.vendorId ? `Open ${invite.name}'s response to review it` : undefined}
                    >
                      <td className="text-left">
                        <div className="text-[13px] font-medium text-[var(--ink)]">{invite.name}</div>
                        <div className="text-[11px] text-[var(--ink-muted)]">{invite.email}</div>
                      </td>
                      <td className="text-left">
                        {awaiting ? (
                          <StatusPill status="pending" />
                        ) : invite.vendorId ? (
                          // The response's own status, not a generic "replied".
                          // A quotation needing review is the thing a buyer most
                          // wants to click, so it says so and it opens.
                          <StatusPill status={invite.vendorStatus ?? "pending"} />
                        ) : (
                          <StatusPill status="review_required" />
                        )}
                        {!awaiting && !invite.vendorId && (
                          <div className="mt-1 text-[11px] text-[var(--ink-muted)]">Replied, no quotation attached</div>
                        )}
                        {invite.itemsFound != null && (
                          <div className="num mt-1 text-[11px] text-[var(--ink-muted)]">
                            {invite.itemsFound} priced
                            {invite.itemsMissing ? `, ${invite.itemsMissing} missing` : ""}
                          </div>
                        )}
                      </td>
                      <td className="max-w-[22rem] text-left">
                        {awaiting ? (
                          <span className="text-[12px] italic text-[var(--ink-muted)]">Awaiting reply</span>
                        ) : (
                          <>
                            <div className="truncate text-[12.5px] text-[var(--ink-secondary)]" title={invite.responseSubject ?? ""}>
                              {invite.responseSubject}
                            </div>
                            {invite.snippet && (
                              <div className="truncate text-[11px] text-[var(--ink-muted)]" title={invite.snippet}>
                                {invite.snippet}
                              </div>
                            )}
                            {invite.matchedBy && (
                              <div className="mt-0.5 text-[10.5px] text-[var(--ink-muted)]">
                                Filed by {invite.matchedBy.replace(/_/g, " ")}
                              </div>
                            )}
                          </>
                        )}
                      </td>
                      <td className="text-left">
                        {invite.documentUrl ? (
                          // The document itself, not a link to a screen about it.
                          // Anyone auditing the comparison should be one click
                          // from what the supplier actually sent.
                          <a
                            href={invite.documentUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            onClick={(e) => e.stopPropagation()}
                            className="pressable inline-flex items-center gap-1.5 text-[12px] text-[var(--ink)] underline decoration-[var(--line-strong)] underline-offset-4 hover:decoration-[var(--ink)]"
                            title="Open the document this supplier sent"
                          >
                            <Icon name="attachment" size={12} />
                            {invite.attachments[0] ??
                              `${invite.name.split(" ")[0]}.${invite.responseFormat ?? "file"}`}
                          </a>
                        ) : (
                          <span className="text-[12px] text-[var(--ink-muted)]">—</span>
                        )}
                      </td>
                      <td className="num whitespace-nowrap text-right text-[12px] text-[var(--ink-secondary)]">
                        {invite.vendorId && (
                          <span className="mr-2 inline-block align-[-2px] text-[var(--ink-muted)]" aria-hidden>
                            <Icon name="chevron-right" size={12} />
                          </span>
                        )}
                        {invite.respondedAt
                          ? new Date(invite.respondedAt).toLocaleString("en-IN", {
                              day: "numeric",
                              month: "short",
                              hour: "2-digit",
                              minute: "2-digit",
                            })
                          : "—"}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {ledger.uninvited.length > 0 && (
        <Card>
          <CardHeader
            title="Replies from suppliers you did not invite"
            subtitle="The RFx was forwarded, or the matcher placed these on the subject line alone. Confirm before relying on them."
          />
          <div className="divide-y" style={{ borderColor: "var(--line)" }}>
            {ledger.uninvited.map((m) => (
              <div key={m.id} className="px-5 py-3.5" style={{ borderTop: "1px solid var(--line)" }}>
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <span className="text-[13px] font-medium text-[var(--ink)]">{m.fromName ?? m.from}</span>
                  <span className="num text-[11px] text-[var(--ink-muted)]">{m.from}</span>
                </div>
                <div className="mt-0.5 text-[12.5px] text-[var(--ink-secondary)]">{m.subject}</div>
                {m.note && (
                  <div className="mt-1.5 flex items-start gap-1.5 text-[11.5px]" style={{ color: "var(--warning)" }}>
                    <Icon name="alert" size={12} />
                    <span className="text-[var(--ink-secondary)]">{m.note}</span>
                  </div>
                )}
                {m.attachments.length > 0 && (
                  <div className="mt-1.5 flex items-center gap-1.5 text-[11.5px] text-[var(--ink-muted)]">
                    <Icon name="attachment" size={12} />
                    {m.attachments.join(", ")}
                    {!m.vendorId && <span className="italic">— not attached yet</span>}
                  </div>
                )}
              </div>
            ))}
          </div>
        </Card>
      )}

      {unmatched.length > 0 && (
        <Card>
          <CardHeader
            title={`Unplaced mail (${unmatched.length})`}
            subtitle="Arrived in the inbox but could not be matched to any open event. Nothing is discarded and nothing is guessed."
          />
          <div>
            {unmatched.map((m) => (
              <div key={m.id} className="px-5 py-3.5" style={{ borderTop: "1px solid var(--line)" }}>
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <span className="text-[13px] font-medium text-[var(--ink)]">{m.fromName ?? m.from}</span>
                  <span className="num text-[11px] text-[var(--ink-muted)]">
                    {new Date(m.receivedAt).toLocaleString("en-IN", {
                      day: "numeric",
                      month: "short",
                      hour: "2-digit",
                      minute: "2-digit",
                    })}
                  </span>
                </div>
                <div className="mt-0.5 text-[12.5px] text-[var(--ink-secondary)]">{m.subject}</div>
                {m.note && <div className="mt-1 text-[11.5px] text-[var(--ink-muted)]">{m.note}</div>}
                <div className="mt-2.5 flex items-center gap-2">
                  <Button
                    size="sm"
                    variant="secondary"
                    icon="plus"
                    onClick={() =>
                      api
                        .assignInboundMessage(m.id, rfxId)
                        .then(load)
                        .catch((err) => setSyncError(err.message))
                    }
                  >
                    File against this event
                  </Button>
                  {m.attachments.length > 0 && (
                    <span className="flex items-center gap-1.5 text-[11.5px] text-[var(--ink-muted)]">
                      <Icon name="attachment" size={12} />
                      {m.attachments.join(", ")}
                    </span>
                  )}
                </div>
              </div>
            ))}
          </div>
        </Card>
      )}
    </div>
  );
}
