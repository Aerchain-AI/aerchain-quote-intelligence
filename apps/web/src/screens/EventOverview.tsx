import { useEffect, useState } from "react";
import Icon, { type IconName } from "../components/Icon";
import { Button, ErrorState, Spinner } from "../components/ui";
import { api, type RfxDetail } from "../lib/api";
import SendRfxFlow from "./SendRfxFlow";

/**
 * The Overview tab of an event workspace.
 *
 * A draft is a working document, so it opens editable. Anything issued or
 * awarded is a record of what happened and opens read-only with its timeline —
 * rewriting history after an award would defeat the point of keeping one.
 */

interface EditableLineItem {
  name: string;
  specification: string;
  quantity: number;
  unit: string;
}

/** The timeline used glyphs from four different families, so each step drew at a
 * different weight. One set, one stroke. */
const TIMELINE_ICON: Record<string, IconName> = {
  created: "compose",
  issued: "send",
  response_received: "download",
  extraction_complete: "check",
  shortlisted: "filter",
  awarded: "approve",
  note: "info",
};

export default function EventOverview({ rfxId, onSaved }: { rfxId: string; onSaved: () => void }) {
  const [detail, setDetail] = useState<RfxDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  /** Secondary detail is collapsed by default — a draft screen should lead with
   * what you still have to decide, not with an audit trail. */
  const [showDetail, setShowDetail] = useState(false);

  const [name, setName] = useState("");
  const [category, setCategory] = useState("");
  const [currency, setCurrency] = useState("INR");
  const [requiredBy, setRequiredBy] = useState("");
  const [description, setDescription] = useState("");
  const [items, setItems] = useState<EditableLineItem[]>([]);

  useEffect(() => {
    setDetail(null);
    setEditing(false);
    setSaveError(null);
    api
      .getRfx(rfxId)
      .then((d) => {
        setDetail(d);
        setName(d.name);
        setCategory(d.category);
        setCurrency(d.currency);
        setRequiredBy(d.requiredByDate.slice(0, 10));
        setDescription(d.description);
        setItems((d.lineItems ?? []).map((li) => ({ ...li })));
      })
      .catch((err) => setError(err.message));
  }, [rfxId]);

  const save = async () => {
    setSaving(true);
    setSaveError(null);
    try {
      await api.updateRfx(rfxId, { name, category, currency, description, requiredByDate: requiredBy, lineItems: items });
      const fresh = await api.getRfx(rfxId);
      setDetail(fresh);
      setEditing(false);
      onSaved();
    } catch (err) {
      setSaveError((err as Error).message);
    } finally {
      setSaving(false);
    }
  };

  if (error) return <ErrorState message={error} />;
  if (!detail) return <Spinner label="Loading event…" />;

  const isDraft = detail.status === "draft";

  if (sending) {
    return (
      <SendRfxFlow
        rfxId={rfxId}
        eventName={detail.name}
        onIssued={() => {
          onSaved();
          api.getRfx(rfxId).then(setDetail).catch(() => undefined);
        }}
        onCancel={() => setSending(false)}
      />
    );
  }

  return (
    <div className="space-y-4">
      {/* The workspace header already carries the name, status and buyer, so this
          bar only offers the actions. */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-[12px] text-[var(--ink-muted)]">
          Created {detail.createdAt ? new Date(detail.createdAt).toLocaleString("en-IN") : "—"}
          {detail.sourceRequest ? ` · from the request "${detail.sourceRequest}"` : ""}
        </p>
        <div className="flex items-center gap-2">
          {isDraft && !editing && (
            <>
              <Button variant="secondary" onClick={() => setEditing(true)}>
                Edit draft
              </Button>
              <Button onClick={() => setSending(true)} className="!bg-[var(--accent)] hover:!bg-[var(--accent-hover)] inline-flex items-center gap-1.5">
                Send draft to suppliers <Icon name="arrow-right" size={12} />
              </Button>
            </>
          )}
          {editing && (
            <>
              <Button onClick={save} disabled={saving}>
                {saving ? "Saving…" : "Save changes"}
              </Button>
              <Button variant="ghost" onClick={() => setEditing(false)} disabled={saving}>
                Cancel
              </Button>
            </>
          )}
        </div>
      </div>

      {saveError && <ErrorState message={saveError} />}

      {!isDraft && (
        <p className="rounded-md border border-[var(--line)] bg-[var(--surface-sunken)] px-3 py-2 text-[12px] text-[var(--ink-secondary)]">
          This event is <strong>{detail.status}</strong> — it is a record of what happened, so it opens read-only.
          Only drafts can be edited.
        </p>
      )}

      {/* AI Summary Card */}
      <div className="rounded-xl border border-[var(--line)] bg-[var(--accent-soft)]/50 p-4">
        <div className="flex items-start gap-3">
          <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-[var(--accent-soft)] text-[var(--ink)]">
            <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" viewBox="0 0 24 24" fill="currentColor">
              <path d="M12 2a1 1 0 0 1 .993.883L13 3v2h2.5a2.5 2.5 0 0 1 2.495 2.336L18 7.5v2a1 1 0 0 1-1.993.117L16 9.5v-2a.5.5 0 0 0-.41-.492L15.5 7H13v3a1 1 0 0 1-1.993.117L11 10V7H8.5a.5.5 0 0 0-.492.41L8 7.5v12a.5.5 0 0 0 .41.492L8.5 20h3a1 1 0 0 1 .117 1.993L11.5 22h-3a2.5 2.5 0 0 1-2.495-2.336L6 19.5v-12a2.5 2.5 0 0 1 2.336-2.495L8.5 5H11V3a1 1 0 0 1 1-1Zm7 7a2.5 2.5 0 0 1 2.495 2.336L21.5 11.5v8a2.5 2.5 0 0 1-2.336 2.495L19 22h-3.5a1 1 0 0 1-.117-1.993L15.5 20H19a.5.5 0 0 0 .492-.41L19.5 19.5v-8a.5.5 0 0 0-.41-.492L19 11h-3.5a1 1 0 0 1-.117-1.993L15.5 9H19Z" />
            </svg>
          </div>
          <div>
            <h3 className="text-[13px] font-semibold text-[var(--ink)]">AI-Generated Summary</h3>
            <p className="mt-0.5 text-[13px] text-[var(--ink)]/80">
              This RFx covers {detail.category?.toLowerCase() || "procurement"} for Q3 fulfillment. {detail.lineItems?.length ?? 0} line items, {detail.vendors?.length ?? 0} vendor quotes received. {detail.vendors.length > 0 ? "Lowest quote is 8% under budget." : ""}
            </p>
          </div>
        </div>
      </div>

      {/* Scope */}
      <section>
        <SectionHeading>Scope</SectionHeading>
        {editing ? (
          <div className="grid gap-3 rounded-lg border border-[var(--line)] bg-[var(--surface)] p-4 sm:grid-cols-2">
            <Field label="Event name">
              <input value={name} onChange={(e) => setName(e.target.value)} className={inputClass} />
            </Field>
            <Field label="Category">
              <input value={category} onChange={(e) => setCategory(e.target.value)} className={inputClass} />
            </Field>
            <Field label="Currency">
              <select value={currency} onChange={(e) => setCurrency(e.target.value)} className={inputClass}>
                <option value="INR">INR</option>
                <option value="USD">USD</option>
              </select>
            </Field>
            <Field label="Required by">
              <input type="date" value={requiredBy} onChange={(e) => setRequiredBy(e.target.value)} className={inputClass} />
            </Field>
            <div className="sm:col-span-2">
              <Field label="Description">
                <textarea
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  rows={3}
                  className={`${inputClass} resize-none`}
                />
              </Field>
            </div>
          </div>
        ) : (
          <div className="rounded-lg border border-[var(--line)] bg-[var(--surface)] p-4">
            <p className="text-[13px] text-[var(--ink-secondary)]">{detail.description}</p>
            <div className="mt-3 flex flex-wrap gap-x-8 gap-y-2 text-[12px]">
              <Meta label="Required by" value={new Date(detail.requiredByDate).toLocaleDateString("en-IN")} />
              <Meta label="Line items" value={String(detail.lineItems?.length ?? 0)} />
              <Meta label="Vendor responses" value={String(detail.vendors.length)} />
            </div>
          </div>
        )}
      </section>

      {/* Line items */}
      <section>
        <div className="flex items-center justify-between">
          <SectionHeading>Line items ({editing ? items.length : (detail.lineItems?.length ?? 0)})</SectionHeading>
          {editing && (
            <Button
              variant="secondary"
              onClick={() => setItems((prev) => [...prev, { name: "", specification: "", quantity: 0, unit: "pcs" }])}
            >
              + Add item
            </Button>
          )}
        </div>
        <div className="max-h-80 overflow-y-auto rounded-lg border border-[var(--line)] bg-[var(--surface)]">
          <table className="w-full">
            <thead className="sticky top-0 bg-[var(--surface-sunken)]">
              <tr className="border-b border-[var(--line)] text-[11px] uppercase tracking-wide text-[var(--ink-muted)]">
                <th className="px-3 py-2 text-left font-semibold">Item</th>
                <th className="px-3 py-2 text-left font-semibold">Specification</th>
                <th className="px-3 py-2 text-right font-semibold">Qty</th>
                <th className="px-3 py-2 text-left font-semibold">Unit</th>
                {editing && <th className="px-3 py-2" />}
              </tr>
            </thead>
            <tbody>
              {editing
                ? items.map((li, i) => (
                    <tr key={i} className="border-b border-[var(--line)]">
                      <td className="px-2 py-1">
                        <input
                          value={li.name}
                          onChange={(e) =>
                            setItems((prev) => prev.map((x, xi) => (xi === i ? { ...x, name: e.target.value } : x)))
                          }
                          className={cellInputClass}
                        />
                      </td>
                      <td className="px-2 py-1">
                        <input
                          value={li.specification}
                          onChange={(e) =>
                            setItems((prev) =>
                              prev.map((x, xi) => (xi === i ? { ...x, specification: e.target.value } : x)),
                            )
                          }
                          className={cellInputClass}
                        />
                      </td>
                      <td className="px-2 py-1">
                        <input
                          type="number"
                          value={li.quantity}
                          onChange={(e) =>
                            setItems((prev) =>
                              prev.map((x, xi) => (xi === i ? { ...x, quantity: Number(e.target.value) } : x)),
                            )
                          }
                          className={`${cellInputClass} text-right`}
                        />
                      </td>
                      <td className="px-2 py-1">
                        <input
                          value={li.unit}
                          onChange={(e) =>
                            setItems((prev) => prev.map((x, xi) => (xi === i ? { ...x, unit: e.target.value } : x)))
                          }
                          className={`${cellInputClass} w-20`}
                        />
                      </td>
                      <td className="px-2 py-1 text-right">
                        <button
                          onClick={() => setItems((prev) => prev.filter((_, xi) => xi !== i))}
                          className="rounded px-1.5 py-0.5 text-[12px] text-[var(--ink-muted)] hover:bg-[var(--critical-soft)] hover:text-[var(--critical)]"
                          title="Remove"
                        >
                          <Icon name="close" size={14} title="Close" />
                        </button>
                      </td>
                    </tr>
                  ))
                : detail.lineItems?.map((li) => (
                    <tr key={li.id} className="border-b border-[var(--line)]">
                      <td className="px-3 py-1.5 text-[13px] text-[var(--ink)]">{li.name}</td>
                      <td className="px-3 py-1.5 text-[12px] text-[var(--ink-muted)]">{li.specification}</td>
                      <td className="cell-num px-3 py-1.5 text-right text-[var(--ink-secondary)]">
                        {li.quantity.toLocaleString("en-IN")}
                      </td>
                      <td className="px-3 py-1.5 text-[12px] text-[var(--ink-muted)]">{li.unit}</td>
                    </tr>
                  ))}
            </tbody>
          </table>
        </div>
      </section>

      {/* Secondary detail. Present, but not competing with the decision. */}
      <button
        onClick={() => setShowDetail((v) => !v)}
        className="text-[12px] font-medium text-[var(--info)] hover:text-[var(--info)]"
      >
        {showDetail ? "Hide" : "Show"} history and creation details
      </button>

      {showDetail && (
      <>
      {/* What happened */}
      <section>
        <SectionHeading>Timeline</SectionHeading>
        <div className="rounded-lg border border-[var(--line)] bg-[var(--surface)] p-4">
          <ol className="relative space-y-4 border-l border-[var(--line)] pl-5">
            {detail.timeline.map((t) => (
              <li key={t.id} className="relative">
                <span className="absolute -left-[26px] flex h-4 w-4 items-center justify-center rounded-full bg-[var(--info-soft)] text-[9px] text-[var(--info)]">
                  <Icon name={TIMELINE_ICON[t.type] ?? "info"} size={12} />
                </span>
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <p className="text-[13px] font-medium text-[var(--ink)]">{t.title}</p>
                  <p className="text-[11px] text-[var(--ink-muted)]">
                    {new Date(t.occurredAt).toLocaleString("en-IN", {
                      day: "numeric",
                      month: "short",
                      year: "numeric",
                      hour: "2-digit",
                      minute: "2-digit",
                    })}
                  </p>
                </div>
                {t.detail && <p className="mt-0.5 text-[12px] text-[var(--ink-secondary)]">{t.detail}</p>}
                {t.actor && <p className="mt-0.5 text-[11px] text-[var(--ink-muted)]">{t.actor}</p>}
              </li>
            ))}
            {detail.timeline.length === 0 && (
              <li className="text-[13px] text-[var(--ink-muted)]">No milestones recorded for this event.</li>
            )}
          </ol>
        </div>
      </section>

      {/* Vendor responses, when there are any */}
      {detail.vendors.length > 0 && (
        <section>
          <SectionHeading>Vendor responses</SectionHeading>
          <div className="divide-y divide-[var(--line)] rounded-lg border border-[var(--line)] bg-[var(--surface)]">
            {detail.vendors.map((v) => (
              <div key={v.id} className="flex items-center justify-between px-4 py-2.5">
                <div>
                  <span className="text-[13px] font-medium text-[var(--ink)]">{v.name}</span>
                  <span className="ml-2 text-[11px] uppercase text-[var(--ink-muted)]">{v.responseFormat}</span>
                </div>
                <div className="text-right text-[12px] text-[var(--ink-secondary)]">
                  {v.itemsFoundCount != null && (
                    <span className="cell-num">
                      {v.itemsFoundCount}/{(v.itemsFoundCount ?? 0) + (v.itemsMissingCount ?? 0)} items
                    </span>
                  )}
                  {v.overallConfidence != null && (
                    <span className="ml-3 text-[var(--ink-muted)]">{Math.round(v.overallConfidence * 100)}% confidence</span>
                  )}
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* How the scope was decided */}
      {detail.clarifications && detail.clarifications.length > 0 && (
        <section>
          <SectionHeading>Decisions taken at creation</SectionHeading>
          <div className="space-y-2 rounded-lg border border-[var(--line)] bg-[var(--surface)] p-4">
            {detail.clarifications.map((c, i) => (
              <div key={i}>
                <p className="text-[12px] text-[var(--ink-muted)]">{c.question}</p>
                <p className="text-[13px] text-[var(--ink)]">{c.answer}</p>
              </div>
            ))}
          </div>
        </section>
      )}
      </>
      )}
    </div>
  );
}

const inputClass =
  "w-full rounded-md border border-[var(--line-strong)] px-2.5 py-1.5 text-[13px] outline-none focus:border-[var(--ink)]";
const cellInputClass =
  "w-full rounded border border-transparent px-1.5 py-1 text-[12px] outline-none hover:border-[var(--line)] focus:border-[var(--ink)]";

function SectionHeading({ children }: { children: React.ReactNode }) {
  return <h3 className="mb-2 text-[13px] font-semibold text-[var(--info)]">{children}</h3>;
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-[11px] font-medium uppercase tracking-wide text-[var(--ink-muted)]">{label}</span>
      {children}
    </label>
  );
}

function Meta({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-[11px] uppercase tracking-wide text-[var(--ink-muted)]">{label}</div>
      <div className="text-[13px] text-[var(--ink)]">{value}</div>
    </div>
  );
}

