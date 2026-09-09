import { useEffect, useState } from "react";
import Icon from "../components/Icon";
import { Button, ErrorState, Spinner } from "../components/ui";
import { api, type ComposedEmail, type Supplier, type SupplierShortlist } from "../lib/api";

/**
 * Issuing a draft to suppliers, in two deliberate steps.
 *
 *   1. Review the email — the exact commercial instruction suppliers will quote
 *      against. Editable, because the buyer is accountable for it, not the system.
 *   2. Choose who receives it — past suppliers in this category with the record
 *      that justifies the choice, plus anyone new by email.
 *
 * The confirmation step exists because issuing is the one irreversible action in
 * the workflow: once suppliers have the requirement, you cannot un-send it.
 */

type Step = "email" | "suppliers" | "sent";

const CHECK_EL = <Icon name="check" size={13} />;

export default function SendRfxFlow({
  rfxId,
  eventName,
  onIssued,
  onCancel,
}: {
  rfxId: string;
  eventName: string;
  onIssued: () => void;
  onCancel: () => void;
}) {
  const [step, setStep] = useState<Step>("email");
  const [email, setEmail] = useState<ComposedEmail | null>(null);
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [shortlist, setShortlist] = useState<SupplierShortlist | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [newEmails, setNewEmails] = useState<string[]>([]);
  const [emailDraft, setEmailDraft] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [sending, setSending] = useState(false);
  const [sentTo, setSentTo] = useState<Array<{ name: string; email: string; isNew: boolean }>>([]);

  useEffect(() => {
    api
      .getEmailPreview(rfxId)
      .then((e) => {
        setEmail(e);
        setSubject(e.subject);
        setBody(e.body);
      })
      .catch((err) => setError(err.message));
    api.getSupplierShortlist(rfxId).then(setShortlist).catch(() => undefined);
  }, [rfxId]);

  const toggle = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });

  const addEmail = () => {
    const value = emailDraft.trim().toLowerCase();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(value)) {
      setError("That doesn't look like a valid email address.");
      return;
    }
    if (newEmails.includes(value)) return;
    setError(null);
    setNewEmails((prev) => [...prev, value]);
    setEmailDraft("");
  };

  const recipientCount = selected.size + newEmails.length;

  const send = async () => {
    setSending(true);
    setError(null);
    try {
      const result = await api.issueRfx(rfxId, {
        supplierIds: [...selected],
        newEmails,
        subject,
        body,
      });
      setSentTo(result.invited);
      setConfirming(false);
      setStep("sent");
      onIssued();
    } catch (err) {
      setError((err as Error).message);
      setConfirming(false);
    } finally {
      setSending(false);
    }
  };

  if (error && !email) return <ErrorState message={error} />;
  if (!email) return <Spinner label="Composing the RFx email…" />;

  return (
    <div className="space-y-4">
      <StepBar step={step} />
      {error && <ErrorState message={error} />}

      {/* ── Step 1: the email ── */}
      {step === "email" && (
        <>
          <div className="rounded-lg border border-[var(--line)] bg-[var(--surface)]">
            <div className="flex items-center justify-between border-b border-[var(--line)] px-5 py-3">
              <div>
                <h3 className="text-[13px] font-semibold text-[var(--info)]">Review the invitation</h3>
                <p className="text-[12px] text-[var(--ink-muted)]">
                  Built from this event — {email.lineItemCount} line items
                  {email.hasCommercialTerms ? " and the terms you agreed at creation" : ""}. Edit anything before sending.
                </p>
              </div>
            </div>
            {/* The attachments are the substance of the packet — the buyer should be
                able to open exactly what suppliers will receive before sending. */}
            <div className="border-b border-[var(--line)] bg-[var(--surface-sunken)] px-5 py-3">
              <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-[var(--ink-muted)]">
                Attachments (2)
              </p>
              <div className="flex flex-wrap gap-2">
                <a
                  href={`/api/rfx/${rfxId}/packet/rfq.pdf`}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-2 rounded-md border border-[var(--line-strong)] bg-[var(--surface)] px-3 py-2 text-[12px] text-[var(--ink-secondary)] transition-colors hover:border-[var(--ink-muted)] hover:bg-[var(--info-soft)]"
                >
                  <span className="rounded bg-[var(--critical-soft)] px-1.5 py-0.5 text-[10px] font-bold text-[var(--critical)]">PDF</span>
                  RFQ document
                  <span className="text-[var(--ink-muted)]">— scope, terms, evaluation basis</span>
                </a>
                <a
                  href={`/api/rfx/${rfxId}/packet/pricing-template.xlsx`}
                  className="inline-flex items-center gap-2 rounded-md border border-[var(--line-strong)] bg-[var(--surface)] px-3 py-2 text-[12px] text-[var(--ink-secondary)] transition-colors hover:border-[var(--ink-muted)] hover:bg-[var(--info-soft)]"
                >
                  <span className="rounded bg-[var(--good-soft)] px-1.5 py-0.5 text-[10px] font-bold text-[var(--good)]">XLSX</span>
                  Pricing template
                  <span className="text-[var(--ink-muted)]">— {email.lineItemCount} items, prices blank</span>
                </a>
              </div>
              <p className="mt-2 text-[11px] text-[var(--ink-muted)]">
                The template is what makes responses comparable. Suppliers who ignore it and reply in their own
                format still work — that is what the extraction pipeline is for.
              </p>
            </div>

            <div className="space-y-3 px-5 py-4">
              <label className="block">
                <span className="mb-1 block text-[11px] font-medium uppercase tracking-wide text-[var(--ink-muted)]">Subject</span>
                <input
                  value={subject}
                  onChange={(e) => setSubject(e.target.value)}
                  className="w-full rounded-md border border-[var(--line-strong)] px-3 py-2 text-[13px] outline-none focus:border-[var(--ink)]"
                />
              </label>
              <label className="block">
                <span className="mb-1 block text-[11px] font-medium uppercase tracking-wide text-[var(--ink-muted)]">Message</span>
                <textarea
                  value={body}
                  onChange={(e) => setBody(e.target.value)}
                  rows={18}
                  className="w-full resize-y rounded-md border border-[var(--line-strong)] px-3 py-2 font-mono text-[12px] leading-relaxed outline-none focus:border-[var(--ink)]"
                />
              </label>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <Button onClick={() => setStep("suppliers")} className="!bg-[var(--accent)] hover:!bg-[var(--accent-hover)] inline-flex items-center gap-1.5">
              Choose suppliers <Icon name="arrow-right" size={12} />
            </Button>
            <Button variant="ghost" onClick={onCancel}>
              Back to draft
            </Button>
          </div>
        </>
      )}

      {/* ── Step 2: who receives it ── */}
      {step === "suppliers" && (
        <>
          <div className="rounded-lg border border-[var(--line)] bg-[var(--surface)]">
            <div className="border-b border-[var(--line)] px-5 py-3">
              <h3 className="text-[13px] font-semibold text-[var(--info)]">
                Suppliers for {shortlist?.category ?? "this category"}
              </h3>
              <p className="text-[12px] text-[var(--ink-muted)]">{shortlist?.note ?? "Loading past suppliers…"}</p>
            </div>

            {!shortlist ? (
              <div className="px-5 py-6">
                <Spinner label="Looking up past suppliers…" />
              </div>
            ) : (
              <div className="divide-y divide-[var(--line)]">
                {shortlist.suppliers.map((s) => (
                  <SupplierRow key={s.id} supplier={s} selected={selected.has(s.id)} onToggle={() => toggle(s.id)} />
                ))}
                {shortlist.suppliers.length === 0 && (
                  <p className="px-5 py-6 text-center text-[13px] text-[var(--ink-muted)]">
                    No suppliers on record for this category yet — add one below.
                  </p>
                )}
              </div>
            )}

            {/* Ad-hoc invitees */}
            <div className="border-t border-[var(--line)] bg-[var(--surface-sunken)] px-5 py-3">
              <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-[var(--ink-muted)]">
                Invite someone not on the list
              </p>
              <div className="flex flex-wrap items-center gap-2">
                <input
                  value={emailDraft}
                  onChange={(e) => setEmailDraft(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && (e.preventDefault(), addEmail())}
                  placeholder="supplier@company.com"
                  className="min-w-[240px] flex-1 rounded-md border border-[var(--line-strong)] px-3 py-1.5 text-[13px] outline-none focus:border-[var(--ink)]"
                />
                <Button variant="secondary" onClick={addEmail}>
                  Add
                </Button>
              </div>
              {newEmails.length > 0 && (
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {newEmails.map((e) => (
                    <span
                      key={e}
                      className="inline-flex items-center gap-1.5 rounded-full bg-[var(--surface)] px-2.5 py-1 text-[12px] text-[var(--ink-secondary)] ring-1 ring-inset ring-[var(--line-strong)]"
                    >
                      {e}
                      <span className="rounded bg-[var(--warning-soft)] px-1 text-[10px] font-medium text-[var(--warning)]">new</span>
                      <button
                        onClick={() => setNewEmails((prev) => prev.filter((x) => x !== e))}
                        className="text-[var(--ink-muted)] hover:text-[var(--critical)]"
                      >
                        <Icon name="close" size={14} title="Close" />
                      </button>
                    </span>
                  ))}
                </div>
              )}
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <Button
              onClick={() => setConfirming(true)}
              disabled={recipientCount === 0}
              className="!bg-[var(--accent)] hover:!bg-[var(--accent-hover)]"
            >
              Send RFx to {recipientCount} supplier{recipientCount === 1 ? "" : "s"}
            </Button>
            <Button variant="ghost" onClick={() => setStep("email")}>
              <Icon name="arrow-left" size={13} /> Back to email
            </Button>
            {recipientCount === 0 && (
              <span className="text-[12px] text-[var(--ink-muted)]">Select at least one supplier, or add one by email.</span>
            )}
          </div>
        </>
      )}

      {/* ── Sent ── */}
      {step === "sent" && (
        <div className="rounded-lg border border-[var(--good-line)] bg-[var(--good-soft)] px-5 py-5">
          <h3 className="text-[14px] font-semibold text-[var(--good)]">RFx issued</h3>
          <p className="mt-1 text-[13px] text-[var(--good)]">
            {eventName} was sent to {sentTo.length} supplier{sentTo.length === 1 ? "" : "s"}. The event is now active and
            will accept responses.
          </p>
          <ul className="mt-3 space-y-1">
            {sentTo.map((s) => (
              <li key={s.email} className="text-[12px] text-[var(--good)]">
                • {s.name} — {s.email}
                {s.isNew && <span className="ml-1.5 text-[var(--good)]">(added to the registry)</span>}
              </li>
            ))}
          </ul>
          <p className="mt-3 text-[11px] text-[var(--good)]">
            No email was actually transmitted — this prototype records the invitation and its exact text rather than
            running mail infrastructure.
          </p>
        </div>
      )}

      {/* ── Confirmation ── */}
      {confirming && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-[var(--surface-inverse)] px-4">
          <div className="w-full max-w-md rounded-lg border border-[var(--line)] bg-[var(--surface)] p-5 shadow-xl">
            <h3 className="text-[15px] font-semibold text-[var(--info)]">Send this RFx?</h3>
            <p className="mt-2 text-[13px] text-[var(--ink-secondary)]">
              {recipientCount} supplier{recipientCount === 1 ? "" : "s"} will receive the requirement for{" "}
              <strong>{eventName}</strong>. The event moves from draft to active and can no longer be edited.
            </p>
            <div className="mt-3 max-h-32 overflow-y-auto rounded border border-[var(--line)] bg-[var(--surface-sunken)] px-3 py-2">
              {[...selected].map((id) => {
                const s = shortlist?.suppliers.find((x) => x.id === id);
                return s ? (
                  <div key={id} className="text-[12px] text-[var(--ink-secondary)]">
                    {s.name}
                  </div>
                ) : null;
              })}
              {newEmails.map((e) => (
                <div key={e} className="text-[12px] text-[var(--ink-secondary)]">
                  {e} <span className="text-[var(--warning)]">(new)</span>
                </div>
              ))}
            </div>
            <div className="mt-4 flex items-center gap-2">
              <Button onClick={send} disabled={sending} className="!bg-[var(--accent)] hover:!bg-[var(--accent-hover)]">
                {sending ? "Sending…" : "Yes, send it"}
              </Button>
              <Button variant="ghost" onClick={() => setConfirming(false)} disabled={sending}>
                Cancel
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/** One supplier, with the record that justifies choosing them, on a single line. */
function SupplierRow({
  supplier: s,
  selected,
  onToggle,
}: {
  supplier: Supplier;
  selected: boolean;
  onToggle: () => void;
}) {
  const pct = (v: number | null) => (v == null ? "—" : `${Math.round(v * 100)}%`);
  return (
    <button
      onClick={onToggle}
      className={`flex w-full items-center gap-3 px-5 py-3 text-left transition-colors ${
        selected ? "bg-[var(--info-soft)]" : "hover:bg-[var(--surface-sunken)]"
      }`}
    >
      <span
        className={`flex h-4 w-4 flex-none items-center justify-center rounded border text-[10px] ${
          selected ? "border-[var(--accent)] bg-[var(--accent)] text-[var(--ink-inverse)]" : "border-[var(--line-strong)] bg-[var(--surface)]"
        }`}
      >
        {selected ? CHECK_EL : null}
      </span>

      <div className="min-w-[200px] flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-[13px] font-medium text-[var(--ink)]">{s.name}</span>
          {s.isNew && (
            <span className="rounded bg-[var(--warning-soft)] px-1.5 py-0.5 text-[10px] font-medium text-[var(--warning)]">no history</span>
          )}
          {s.alreadyInvited && (
            <span className="rounded bg-[var(--surface-hover)] px-1.5 py-0.5 text-[10px] text-[var(--ink-secondary)]">already invited</span>
          )}
        </div>
        <p className="truncate text-[11px] text-[var(--ink-muted)]">{s.pastWork ?? s.email}</p>
      </div>

      {/* The single-line record. Dashes where there is genuinely no history. */}
      <div className="flex flex-none items-center gap-4 text-right">
        <Metric label="Quoted" value={s.eventsInvited > 0 ? `${s.eventsQuoted}/${s.eventsInvited}` : "—"} />
        <Metric label="Won" value={s.eventsInvited > 0 ? String(s.eventsAwarded) : "—"} />
        <Metric label="Responds" value={s.avgResponseDays == null ? "—" : `${s.avgResponseDays}d`} />
        <Metric
          label="On time"
          value={s.onTimeDeliveryPct == null ? "—" : `${Math.round(s.onTimeDeliveryPct)}%`}
          tone={s.onTimeDeliveryPct != null && s.onTimeDeliveryPct < 85 ? "warn" : undefined}
        />
        <Metric
          label="Quality"
          value={pct(s.qualityScore)}
          tone={s.qualityScore != null && s.qualityScore < 0.8 ? "warn" : "good"}
        />
      </div>
    </button>
  );
}

function Metric({ label, value, tone }: { label: string; value: string; tone?: "good" | "warn" }) {
  const color = value === "—" ? "text-[var(--ink-muted)]" : tone === "warn" ? "text-[var(--warning)]" : tone === "good" ? "text-[var(--good)]" : "text-[var(--ink)]";
  return (
    <div className="w-[58px]">
      <div className="text-[9px] uppercase tracking-wide text-[var(--ink-muted)]">{label}</div>
      <div className={`cell-num text-[13px] font-semibold ${color}`}>{value}</div>
    </div>
  );
}

function StepBar({ step }: { step: Step }) {
  const steps: Array<{ key: Step; label: string }> = [
    { key: "email", label: "1. Review email" },
    { key: "suppliers", label: "2. Choose suppliers" },
    { key: "sent", label: "3. Sent" },
  ];
  const activeIndex = steps.findIndex((s) => s.key === step);
  return (
    <div className="flex items-center gap-2">
      {steps.map((s, i) => (
        <div key={s.key} className="flex items-center gap-2">
          <span
            className={`rounded-full px-2.5 py-1 text-[11px] font-medium ${
              i === activeIndex
                ? "bg-[var(--accent)] text-[var(--ink-inverse)]"
                : i < activeIndex
                  ? "bg-[var(--info-soft)] text-[var(--info)]"
                  : "bg-[var(--surface-hover)] text-[var(--ink-muted)]"
            }`}
          >
            {s.label}
          </span>
          {i < steps.length - 1 && <span className="text-[var(--ink-muted)]"><Icon name="arrow-right" size={12} /></span>}
        </div>
      ))}
    </div>
  );
}
