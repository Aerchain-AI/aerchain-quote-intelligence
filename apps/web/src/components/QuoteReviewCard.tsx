import { useState } from "react";
import Icon from "./Icon";
import { api, formatInr, parseJson, type Quote, type QuoteException, type LineItem } from "../lib/api";
import { Button, ConfidenceBadge, SeverityBadge } from "./ui";

interface MoneyAdjustment {
  amount: number;
  unit: string;
  basis?: string;
  notes?: string;
}

interface FxRate {
  from: string;
  to: string;
  rate: number;
  asOf: string;
  source: string;
}

export default function QuoteReviewCard({
  rfxId,
  vendorId,
  quote: q,
  lineItem,
  exceptions,
  onUpdate,
  onAskAI,
}: {
  rfxId: string;
  vendorId: string;
  quote: Quote;
  lineItem: LineItem;
  exceptions: QuoteException[];
  onUpdate: () => void;
  onAskAI?: (prompt: string) => void;
}) {
  const discount = parseJson<MoneyAdjustment>(q.discountJson);
  const freight = parseJson<MoneyAdjustment>(q.freightJson);
  const tax = parseJson<MoneyAdjustment>(q.taxJson);
  const fx = parseJson<FxRate>(q.fxRateJson);

  const [isCorrecting, setIsCorrecting] = useState(false);
  const [saving, setSaving] = useState(false);
  
  const [formValue, setFormValue] = useState(q.normalizedValue?.toString() ?? "");
  const [formCurrency, setFormCurrency] = useState(q.normalizedCurrency ?? "INR");
  const [formUnit, setFormUnit] = useState(q.normalizedUnit ?? lineItem.unit);

  const handleConfirm = async () => {
    setSaving(true);
    try {
      await api.updateQuote(rfxId, vendorId, q.id, { status: "verified" });
      onUpdate();
    } catch (e) {
      console.error(e);
      setSaving(false);
    }
  };

  const handleCorrectSubmit = async () => {
    if (!formValue) return;
    setSaving(true);
    try {
      await api.updateQuote(rfxId, vendorId, q.id, {
        status: "verified",
        value: Number(formValue),
        currency: formCurrency,
        unit: formUnit,
      });
      onUpdate();
      setIsCorrecting(false);
    } catch (e) {
      console.error(e);
      setSaving(false);
    }
  };

  return (
    <div className="rounded-lg border border-[var(--line)] bg-[var(--surface)] shadow-sm overflow-hidden mb-6">
      <div className="bg-[var(--surface-sunken)] border-b border-[var(--line)] px-5 py-4">
        <h3 className="text-sm font-semibold text-[var(--ink)]">
          #{lineItem.id} {lineItem.name}
        </h3>
        <p className="mt-0.5 text-[12px] text-[var(--ink-muted)]">
          {lineItem.specification} · {lineItem.quantity.toLocaleString("en-IN")} {lineItem.unit}
        </p>
      </div>

      <div className="p-5 space-y-6">
        {q.status === "not_quoted" ? (
          <div className="rounded-md border border-[var(--warning-line)] bg-[var(--warning-soft)] px-4 py-3">
            <p className="text-[13px] font-semibold text-[var(--warning)]">Not quoted</p>
            <p className="mt-1 text-[13px] text-[var(--warning)]">
              {q.notes ?? "This vendor did not provide a usable price for this item."}
            </p>
          </div>
        ) : (
          <>
            <Section label="Layer 1: Original Source (Vendor)">
              <Row
                label="Original value"
                value={
                  q.sourceValue == null
                    ? "—"
                    : `${q.sourceCurrency === "USD" ? "$" : "₹"}${q.sourceValue.toLocaleString("en-IN")} ${q.sourceUnit ?? ""}`
                }
                emphasis
              />
              {q.sourceExcerpt && (
                <div className="mt-2 rounded border border-[var(--line)] bg-[var(--surface-sunken)] px-3 py-2">
                  <p className="text-[11px] font-medium uppercase tracking-wide text-[var(--ink-muted)]">Extracted from text</p>
                  <p className="mt-1 font-mono text-[12px] text-[var(--ink-secondary)]">"{q.sourceExcerpt}"</p>
                </div>
              )}
            </Section>

            <Section label="Layer 2: AI Interpretation">
              <Row
                label="AI parsed value"
                value={q.aiInterpretedValue == null && q.normalizedValue == null ? "Not derivable" : `${formatInr(q.aiInterpretedValue ?? q.normalizedValue, { decimals: true })} per ${q.aiInterpretedUnit ?? q.normalizedUnit}`}
              />
              <div className="flex items-center gap-2 mt-2">
                <ConfidenceBadge confidence={q.confidence} level={q.confidenceLevel} />
                <span className="text-[12px] text-[var(--ink-muted)]">extraction confidence</span>
              </div>
            </Section>

            {q.status === "verified" ? (
              <div className="flex items-center gap-2 rounded-md border border-[var(--good-line)] bg-[var(--good-soft)] px-4 py-3 text-[var(--good)]">
                <Icon name="check" size={13} />
                <span className="text-[13px] font-medium">Verified by buyer</span>
                <span className="ml-auto text-[13px] font-semibold">
                  {formatInr(q.normalizedValue, { decimals: true })} per {q.normalizedUnit}
                </span>
              </div>
            ) : (
              <div className="rounded-lg border border-[var(--line)] bg-[var(--surface)] shadow-sm overflow-hidden">
                <div className="bg-[var(--surface-sunken)] px-4 py-3 border-b border-[var(--line)]">
                  <h4 className="text-[13px] font-semibold text-[var(--ink)]">Review & Verification</h4>
                  <p className="text-[12px] text-[var(--ink-muted)] mt-0.5">Please verify the AI extraction to use it in comparison.</p>
                </div>
                <div className="p-4 space-y-4">
                  {isCorrecting ? (
                    <div className="space-y-3">
                      <div className="flex gap-2">
                        <div className="flex-1">
                          <label className="block text-[11px] font-semibold uppercase text-[var(--ink-muted)] mb-1">Value</label>
                          <input 
                            type="number" 
                            value={formValue} 
                            onChange={e => setFormValue(e.target.value)} 
                            className="w-full rounded border border-[var(--line-strong)] px-3 py-1.5 text-[13px] outline-none focus:border-[var(--ink)]"
                          />
                        </div>
                        <div className="w-24">
                          <label className="block text-[11px] font-semibold uppercase text-[var(--ink-muted)] mb-1">Currency</label>
                          <select 
                            value={formCurrency} 
                            onChange={e => setFormCurrency(e.target.value)}
                            className="w-full rounded border border-[var(--line-strong)] px-3 py-1.5 text-[13px] outline-none focus:border-[var(--ink)]"
                          >
                            <option value="INR">INR</option>
                            <option value="USD">USD</option>
                          </select>
                        </div>
                        <div className="w-24">
                          <label className="block text-[11px] font-semibold uppercase text-[var(--ink-muted)] mb-1">Unit</label>
                          <input 
                            value={formUnit} 
                            onChange={e => setFormUnit(e.target.value)}
                            className="w-full rounded border border-[var(--line-strong)] px-3 py-1.5 text-[13px] outline-none focus:border-[var(--ink)]"
                          />
                        </div>
                      </div>
                      <div className="flex gap-2 justify-end pt-2">
                        <Button variant="ghost" onClick={() => setIsCorrecting(false)} disabled={saving}>Cancel</Button>
                        <Button onClick={handleCorrectSubmit} disabled={saving || !formValue} className="!bg-[var(--accent)]">Save Correction</Button>
                      </div>
                    </div>
                  ) : (
                    <div className="flex gap-3">
                      <Button onClick={handleConfirm} disabled={saving} className="flex-1 !bg-[var(--good)] hover:!bg-[var(--good)]">Confirm AI Value</Button>
                      <Button variant="secondary" onClick={() => setIsCorrecting(true)} disabled={saving} className="flex-1">Correct Manually</Button>
                    </div>
                  )}
                </div>
              </div>
            )}

            <Section label="Evaluated Cost">
               {q.status === "verified" ? (
                  <Row
                    label="Calculated Evaluated Cost"
                    value={q.evaluatedValue == null ? "Not enough information" : `${formatInr(q.evaluatedValue, { decimals: true })} per ${q.normalizedUnit}`}
                    emphasis
                  />
               ) : (
                  <Row
                    label="Projected Evaluated Cost"
                    value={q.evaluatedValue == null ? "Not enough information" : `${formatInr(q.evaluatedValue, { decimals: true })} per ${q.normalizedUnit}`}
                  />
               )}
              <Row
                label="Projected Line total"
                value={q.evaluatedValue == null ? "Not enough information" : formatInr(q.evaluatedValue * lineItem.quantity)}
              />
              {(discount || freight || tax || fx) && (
                <div className="mt-3 space-y-1.5 border-t border-[var(--line)] pt-3">
                  {fx && <Row label="Exchange rate" value={`1 ${fx.from} = ${fx.rate} ${fx.to}`} small />}
                  {discount && <Row label="Discount" value={`${discount.amount} ${discount.unit}`} small />}
                  {freight && <Row label="Freight" value={`${freight.amount} ${freight.unit}`} small />}
                  {tax && <Row label="Tax" value={`${tax.amount} ${tax.unit}`} small />}
                </div>
              )}
            </Section>
            
            {q.notes && (
              <Section label="Notes">
                <p className="text-[13px] text-[var(--ink-secondary)]">{q.notes}</p>
              </Section>
            )}
          </>
        )}

        {exceptions.length > 0 && (
          <Section label={`Exceptions (${exceptions.length})`}>
            <div className="space-y-2">
              {exceptions.map((ex) => (
                <div key={ex.id} className="rounded border border-[var(--line)] px-3 py-2">
                  <div className="flex items-center gap-2">
                    <SeverityBadge severity={ex.severity}>{ex.type.replace(/_/g, " ")}</SeverityBadge>
                  </div>
                  <p className="mt-1.5 text-[13px] text-[var(--ink-secondary)]">{ex.message}</p>
                </div>
              ))}
            </div>
          </Section>
        )}

        {/* Contextual AI Assistance */}
        <div className="border-t border-[var(--line)] pt-5 mt-5">
          <Section label="AI Assistance">
            <div className="flex flex-col gap-2">
              <Button
                variant="secondary"
                className="justify-start text-left !py-2 !text-[12px] bg-[var(--surface-sunken)] hover:bg-[var(--surface-hover)] border-[var(--line)]"
                onClick={() => {
                  const prompt = `Action: Explain uncertainty\nVendor: ${vendorId}\nRFx Item: ${lineItem.name}\nRFx Quantity: ${lineItem.quantity}\nVendor quoted: ${q.sourceValue ?? "—"}\nDetected unit: ${q.sourceUnit ?? "—"}\nConfidence: ${q.confidence ? Math.round(q.confidence * 100) + "%" : "—"}\nExceptions: ${exceptions.map(e => e.message).join(" | ") || "None"}\nSource: ${q.sourceDocument ?? "—"}`;
                  onAskAI?.(prompt);
                }}
              >
                <span className="mr-2 inline-block align-[-2px] text-[var(--ink-muted)]"><Icon name="spark" size={13} /></span> Ask AI why this is uncertain
              </Button>
              <Button
                variant="secondary"
                className="justify-start text-left !py-2 !text-[12px] bg-[var(--surface-sunken)] hover:bg-[var(--surface-hover)] border-[var(--line)]"
                onClick={() => {
                  const prompt = `Action: Analyze freight impact\nVendor: ${vendorId}\nRFx Item: ${lineItem.name}\nRFx Quantity: ${lineItem.quantity}\nExceptions: ${exceptions.map(e => e.message).join(" | ")}\nSource: ${q.sourceDocument ?? "—"}`;
                  onAskAI?.(prompt);
                }}
              >
                <span className="mr-2 inline-block align-[-2px] text-[var(--ink-muted)]"><Icon name="spark" size={13} /></span> Ask AI to analyze freight impact
              </Button>
              <Button
                variant="secondary"
                className="justify-start text-left !py-2 !text-[12px] bg-[var(--surface-sunken)] hover:bg-[var(--surface-hover)] border-[var(--line)]"
                onClick={() => {
                  const prompt = `Action: Compare with other vendors\nVendor: ${vendorId}\nRFx Item: ${lineItem.name}\nRFx Quantity: ${lineItem.quantity}`;
                  onAskAI?.(prompt);
                }}
              >
                <span className="mr-2 inline-block align-[-2px] text-[var(--ink-muted)]"><Icon name="spark" size={13} /></span> Ask AI to compare with other vendors
              </Button>
            </div>
          </Section>
        </div>
      </div>
    </div>
  );
}

function Section({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-[var(--ink-muted)]">{label}</p>
      <div className="space-y-1.5">{children}</div>
    </div>
  );
}

function Row({
  label,
  value,
  emphasis,
  small,
}: {
  label: string;
  value: string;
  emphasis?: boolean;
  small?: boolean;
}) {
  return (
    <div className="flex items-baseline justify-between gap-4">
      <span className="text-[13px] text-[var(--ink-muted)]">{label}</span>
      <span
        className={`text-right ${small ? "text-[11px]" : "text-[13px]"} ${
          emphasis ? "font-semibold text-[var(--ink)]" : "text-[var(--ink)]"
        }`}
      >
        {value}
      </span>
    </div>
  );
}
