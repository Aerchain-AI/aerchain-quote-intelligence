import { useRef, useEffect, useState } from "react";
import Icon from "./Icon";
import { api, type CopilotAnswer } from "../lib/api";
import { Button, SeverityBadge, Spinner } from "./ui";

const QUICK_PROMPTS = [
  "Who is cheapest overall?",
  "Who is cheapest for each item?",
  "Split order by cheapest quality-qualified vendor",
  "What are the biggest risks with Vendor B?",
  "5% discount from Vendor B — still cheapest?",
];

interface Entry {
  question: string;
  answer: CopilotAnswer | null;
  error: string | null;
}

/** Try to extract vendor IDs and line-item IDs from a copilot calculation object */
function extractHighlightIds(calculation: unknown): { vendorIds: string[]; lineItemIds: number[] } | null {
  if (!calculation || typeof calculation !== "object") return null;
  const calc = calculation as Record<string, unknown>;

  const vendorIds: string[] = [];
  const lineItemIds: number[] = [];

  if (Array.isArray(calc.ranking)) {
    for (const r of calc.ranking as Array<Record<string, unknown>>) {
      if (r.vendorId && typeof r.vendorId === "string") vendorIds.push(r.vendorId);
    }
  }
  if (Array.isArray(calc.allocations)) {
    for (const a of calc.allocations as Array<Record<string, unknown>>) {
      if (a.vendorId && typeof a.vendorId === "string") vendorIds.push(a.vendorId);
      if (Array.isArray(a.lineItemIds)) lineItemIds.push(...(a.lineItemIds as number[]));
    }
  }
  if (Array.isArray(calc.lines)) {
    for (const l of calc.lines as Array<Record<string, unknown>>) {
      if (l.winnerVendorId && typeof l.winnerVendorId === "string") vendorIds.push(l.winnerVendorId);
      if (l.lineItemId && typeof l.lineItemId === "number") lineItemIds.push(l.lineItemId);
    }
  }
  if (calc.vendorId && typeof calc.vendorId === "string") vendorIds.push(calc.vendorId);

  const uniqueVendors = [...new Set(vendorIds)];
  const uniqueItems = [...new Set(lineItemIds)];

  if (uniqueVendors.length === 0 && uniqueItems.length === 0) return null;
  return { vendorIds: uniqueVendors, lineItemIds: uniqueItems };
}

/**
 * Slide-over Copilot panel. Hidden by default, toggled via an external state.
 */
export default function CopilotDrawer({
  rfxId,
  open,
  onClose,
  onHighlight,
  prefillPrompt,
  onPrefillConsumed,
}: {
  rfxId: string;
  open: boolean;
  onClose: () => void;
  onHighlight: (vendorIds: string[], lineItemIds: number[]) => void;
  prefillPrompt?: string | null;
  onPrefillConsumed?: () => void;
}) {
  const [question, setQuestion] = useState("");
  const [entries, setEntries] = useState<Entry[]>([]);
  const [busy, setBusy] = useState(false);
  const [showCalc, setShowCalc] = useState<number | null>(null);
  const feedRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (feedRef.current) {
      feedRef.current.scrollTop = feedRef.current.scrollHeight;
    }
  }, [entries]);

  useEffect(() => {
    if (prefillPrompt && open) {
      ask(prefillPrompt);
      onPrefillConsumed?.();
    }
  }, [prefillPrompt, open]);

  const ask = async (text: string) => {
    const trimmed = text.trim();
    if (!trimmed || busy) return;
    setBusy(true);
    setQuestion("");
    const index = entries.length;
    setEntries((prev) => [...prev, { question: trimmed, answer: null, error: null }]);
    try {
      const answer = await api.askCopilot(rfxId, trimmed);
      setEntries((prev) => prev.map((e, i) => (i === index ? { ...e, answer } : e)));
    } catch (err) {
      setEntries((prev) => prev.map((e, i) => (i === index ? { ...e, error: (err as Error).message } : e)));
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      {/* Backdrop */}
      {open && (
        <div 
          className="fixed inset-0 z-40 bg-[var(--surface-inverse)] backdrop-blur-[1px] transition-opacity"
          onClick={onClose}
        />
      )}

      {/* Drawer */}
      <div 
        className={`fixed right-0 top-0 z-50 flex h-full w-[420px] flex-col border-l border-[var(--line)] bg-[var(--surface)] shadow-2xl transition-transform duration-300 ease-in-out ${
          open ? "translate-x-0" : "translate-x-full"
        }`}
      >
        {/* Header */}
        <div className="flex-none flex items-center justify-between border-b border-[var(--line)] bg-[var(--surface-inverse)] px-4 py-3">
          <div className="flex items-center gap-2">
            <Icon name="spark" size={15} className="text-[var(--ink-inverse)]" />
            <h2 className="text-[13px] font-semibold text-[var(--ink-inverse)]">Procurement Copilot</h2>
          </div>
          <button
            onClick={onClose}
            className="rounded p-1 text-[var(--info-line)] transition-colors hover:bg-[var(--info)] hover:text-[var(--ink-inverse)]"
            title="Close"
          >
            <Icon name="close" size={14} title="Close" />
          </button>
        </div>

      {/* Chat Feed */}
      <div ref={feedRef} className="flex-1 overflow-y-auto px-3 py-3 space-y-3">
        {entries.length === 0 && (
          <div className="flex flex-col items-center justify-center h-full text-center px-3">
            <div className="mb-2 opacity-30"><Icon name="spark" size={26} /></div>
            <p className="text-[12px] font-semibold text-[var(--ink-secondary)]">Ask anything about these quotes</p>
            <p className="mt-1 text-[11px] text-[var(--ink-muted)] leading-relaxed">
              Every number is computed from extracted data — the AI interprets and explains, never does the arithmetic.
            </p>
          </div>
        )}

        {entries.map((entry, i) => (
          <div key={i} className="space-y-2">
            {/* User message */}
            <div className="flex justify-end">
              <div className="max-w-[90%] rounded-lg bg-[var(--surface-inverse)] px-3 py-1.5 text-[11px] text-[var(--ink-inverse)] leading-relaxed">
                {entry.question}
              </div>
            </div>

            {/* Loading */}
            {!entry.answer && !entry.error && (
              <div className="rounded-lg border border-[var(--line)] bg-[var(--surface-sunken)] px-3 py-2">
                <Spinner label="Computing…" />
              </div>
            )}

            {/* Error */}
            {entry.error && (
              <div className="rounded-lg border border-[var(--critical-line)] bg-[var(--critical-soft)] px-3 py-2 text-[11px] text-[var(--critical)]">
                {entry.error}
              </div>
            )}

            {/* Structured Answer */}
            {entry.answer && (
              <StructuredAnswer
                answer={entry.answer}
                index={i}
                showCalc={showCalc}
                setShowCalc={setShowCalc}
                onHighlight={onHighlight}
              />
            )}
          </div>
        ))}
      </div>

      {/* Quick prompts */}
      <div className="flex-none border-t border-[var(--line)] bg-[var(--surface-sunken)] px-3 py-2">
        <div className="flex flex-wrap gap-1">
          {QUICK_PROMPTS.map((s) => (
            <button
              key={s}
              onClick={() => ask(s)}
              disabled={busy}
              className="rounded-full border border-[var(--line)] bg-[var(--surface)] px-2 py-0.5 text-[10px] text-[var(--ink-secondary)] transition-colors hover:border-[var(--ink-muted)] hover:bg-[var(--info-soft)] hover:text-[var(--info)] disabled:opacity-40"
            >
              {s}
            </button>
          ))}
        </div>
      </div>

      {/* Input bar */}
      <div className="flex-none border-t border-[var(--line)] px-3 py-2.5">
        <div className="flex items-center gap-2 rounded-lg border border-[var(--line-strong)] bg-[var(--surface)] px-2.5 py-1.5 focus-within:border-[var(--ink)] focus-within:ring-2 focus-within:ring-[var(--line)]">
          <input
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && ask(question)}
            placeholder="Ask about this event…"
            disabled={busy}
            className="flex-1 bg-transparent text-[12px] text-[var(--ink)] outline-none placeholder:text-[var(--ink-muted)] min-w-0"
          />
          <Button onClick={() => ask(question)} disabled={busy || !question.trim()} className="!px-2.5 !py-1 !text-[10px] flex-none">
            {busy ? "…" : "Ask"}
          </Button>
        </div>
        <p className="mt-1 text-[9px] text-[var(--ink-muted)] text-center">
          Grounded in this event's data only.
        </p>
      </div>
    </div>
    </>
  );
}

function StructuredAnswer({
  answer,
  index,
  showCalc,
  setShowCalc,
  onHighlight,
}: {
  answer: CopilotAnswer;
  index: number;
  showCalc: number | null;
  setShowCalc: (v: number | null) => void;
  onHighlight: (vendorIds: string[], lineItemIds: number[]) => void;
}) {
  const highlights = answer.calculation ? extractHighlightIds(answer.calculation) : null;

  return (
    <div className="rounded-lg border border-[var(--line)] bg-[var(--surface)] shadow-sm overflow-hidden">
      {/* Badge bar */}
      <div className="flex flex-wrap items-center gap-1.5 border-b border-[var(--line)] bg-[var(--surface-sunken)] px-2.5 py-1.5">
        <SeverityBadge severity={answer.supported ? "info" : "warning"}>
          {answer.analysisType.replace(/_/g, " ")}
        </SeverityBadge>
        {answer.cached && <span className="text-[9px] text-[var(--ink-muted)]">cached</span>}
      </div>

      {/* Section 1: Answer */}
      <div className="px-2.5 py-2.5 border-b border-[var(--line)]">
        <p className="text-[9px] font-semibold uppercase tracking-wider text-[var(--info)] mb-0.5">Answer</p>
        <p className="whitespace-pre-wrap text-[11px] leading-relaxed text-[var(--ink)]">{answer.answer}</p>
      </div>

      {/* Section 2: Calculation */}
      {answer.calculation != null && (
        <div className="px-2.5 py-1.5 border-b border-[var(--line)]">
          <button
            onClick={() => setShowCalc(showCalc === index ? null : index)}
            className="text-[10px] font-medium text-[var(--ink-secondary)] hover:text-[var(--info)] transition-colors flex items-center gap-1"
          >
            <span className="text-[9px] font-semibold uppercase tracking-wider text-[var(--ink-muted)]">Calculation</span>
            <span className="text-[var(--ink-muted)]"><Icon name="chevron-down" size={12} className={showCalc === index ? "rotate-180" : ""} /></span>
          </button>
          {showCalc === index && (
            <pre className="mt-1.5 max-h-40 overflow-auto rounded bg-[var(--surface-inverse)] p-2 font-mono text-[9px] leading-relaxed text-[var(--ink-inverse)]">
              {JSON.stringify(answer.calculation, null, 2)}
            </pre>
          )}
        </div>
      )}

      {/* Section 3: Evidence / Interpretation */}
      <div className="px-2.5 py-1.5 border-b border-[var(--line)]">
        <p className="text-[9px] font-semibold uppercase tracking-wider text-[var(--ink-muted)] mb-0.5">Evidence</p>
        <p className="text-[10px] text-[var(--ink-secondary)]">{answer.interpretation}</p>
        {highlights && (
          <button
            onClick={() => onHighlight(highlights.vendorIds, highlights.lineItemIds)}
            className="mt-1.5 inline-flex items-center gap-1 rounded-md border border-[var(--info-line)] bg-[var(--info-soft)] px-2 py-0.5 text-[10px] font-medium text-[var(--info)] transition-colors hover:bg-[var(--info-soft)]"
          >
            <Icon name="eye" size={13} /> Highlight in table
          </button>
        )}
      </div>

      {/* Section 4: Caveats */}
      {answer.caveats.length > 0 && (
        <div className="px-2.5 py-1.5 bg-[var(--warning-soft)]">
          <p className="text-[9px] font-semibold uppercase tracking-wider text-[var(--warning)] mb-0.5">Caveats</p>
          <ul className="space-y-0.5">
            {answer.caveats.map((c, ci) => (
              <li key={ci} className="text-[10px] leading-relaxed text-[var(--warning)]">• {c}</li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
