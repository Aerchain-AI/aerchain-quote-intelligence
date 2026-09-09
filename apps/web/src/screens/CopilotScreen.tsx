import { useState } from "react";
import Icon from "../components/Icon";
import { Button, Card, ErrorState, SeverityBadge, Spinner } from "../components/ui";
import { api, type CopilotAnswer } from "../lib/api";

/** PRD §19 — five questions answered excellently. The suggestions are the demo
 * spine; anything else typed here goes through the same path. */
const SUGGESTED = [
  "Who is cheapest overall?",
  "Who is cheapest for each item?",
  "What if we split the order by the cheapest vendor for each line?",
  "Only consider vendors who passed the quality questionnaire. Who should we award to?",
  "What are the biggest risks with Vendor B?",
  "If Vendor B gives us a 5% additional discount, does it become the cheapest overall?",
  "Which vendor has the lowest carbon footprint?",
];

interface Entry {
  question: string;
  answer: CopilotAnswer | null;
  error: string | null;
}

export default function CopilotScreen({ rfxId }: { rfxId: string }) {
  const [question, setQuestion] = useState("");
  const [entries, setEntries] = useState<Entry[]>([]);
  const [busy, setBusy] = useState(false);
  const [showCalc, setShowCalc] = useState<number | null>(null);

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
    <div className="mx-auto max-w-4xl space-y-4">
      {entries.length === 0 && (
        <Card className="px-5 py-6">
          <h2 className="text-sm font-semibold text-[var(--ink)]">Ask anything about these quotes</h2>
          <p className="mt-1 text-[13px] text-[var(--ink-secondary)]">
            Questions are routed to a fixed set of analyses. Every number in an answer is computed by the calculation
            engine from extracted data — the model interprets the question and explains the result, it never does the
            arithmetic.
          </p>
          <div className="mt-4 flex flex-wrap gap-2">
            {SUGGESTED.map((s) => (
              <button
                key={s}
                onClick={() => ask(s)}
                className="rounded-full border border-[var(--line-strong)] bg-[var(--surface)] px-3 py-1.5 text-[12px] text-[var(--ink-secondary)] transition-colors hover:border-[var(--ink-muted)] hover:bg-[var(--surface-sunken)]"
              >
                {s}
              </button>
            ))}
          </div>
        </Card>
      )}

      <div className="space-y-4">
        {entries.map((entry, i) => (
          <div key={i} className="space-y-2">
            <div className="flex justify-end">
              <div className="max-w-[80%] rounded-lg bg-[var(--surface-inverse)] px-4 py-2 text-[13px] text-[var(--ink-inverse)]">{entry.question}</div>
            </div>

            {entry.error && <ErrorState message={entry.error} />}
            {!entry.answer && !entry.error && (
              <Card className="px-4 py-3">
                <Spinner label="Routing the question, running the calculation, then explaining the result…" />
              </Card>
            )}

            {entry.answer && (
              <Card>
                <div className="flex flex-wrap items-center gap-2 border-b border-[var(--line)] px-4 py-2">
                  <SeverityBadge severity={entry.answer.supported ? "info" : "warning"}>
                    {entry.answer.analysisType.replace(/_/g, " ")}
                  </SeverityBadge>
                  {entry.answer.cached && <span className="text-[11px] text-[var(--ink-muted)]">cached</span>}
                  <span className="text-[12px] text-[var(--ink-muted)]">{entry.answer.interpretation}</span>
                </div>

                <div className="px-4 py-3">
                  <p className="whitespace-pre-wrap text-[13px] leading-relaxed text-[var(--ink)]">{entry.answer.answer}</p>
                </div>

                {entry.answer.caveats.length > 0 && (
                  <div className="border-t border-[var(--line)] bg-[var(--warning-soft)] px-4 py-3">
                    <p className="text-[11px] font-semibold uppercase tracking-wider text-[var(--warning)]">
                      What this answer does not cover
                    </p>
                    <ul className="mt-1.5 space-y-1">
                      {entry.answer.caveats.map((c, ci) => (
                        <li key={ci} className="text-[12px] leading-relaxed text-[var(--warning)]">
                          • {c}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}

                {entry.answer.calculation != null && (
                  <div className="border-t border-[var(--line)] px-4 py-2">
                    <button
                      onClick={() => setShowCalc(showCalc === i ? null : i)}
                      className="text-[12px] font-medium text-[var(--ink-secondary)] hover:text-[var(--ink)]"
                    >
                      <>{showCalc === i ? "Hide calculation" : "View calculation"} <Icon name={showCalc === i ? "chevron-down" : "chevron-right"} size={12} /></>
                    </button>
                    {showCalc === i && (
                      <pre className="mt-2 max-h-80 overflow-auto rounded bg-[var(--surface-inverse)] p-3 font-mono text-[11px] leading-relaxed text-[var(--ink-inverse)]">
                        {JSON.stringify(entry.answer.calculation, null, 2)}
                      </pre>
                    )}
                  </div>
                )}
              </Card>
            )}
          </div>
        ))}
      </div>

      <div className="sticky bottom-4">
        <Card className="flex items-center gap-2 px-3 py-2 shadow-sm">
          <input
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && ask(question)}
            placeholder="Ask anything about these quotes…"
            disabled={busy}
            className="flex-1 bg-transparent px-2 py-1.5 text-[13px] text-[var(--ink)] outline-none placeholder:text-[var(--ink-muted)]"
          />
          <Button onClick={() => ask(question)} disabled={busy || !question.trim()}>
            {busy ? "Thinking…" : "Ask"}
          </Button>
        </Card>
      </div>

      {entries.length > 0 && (
        <div className="flex flex-wrap gap-2 pb-4">
          {SUGGESTED.map((s) => (
            <button
              key={s}
              onClick={() => ask(s)}
              disabled={busy}
              className="rounded-full border border-[var(--line-strong)] bg-[var(--surface)] px-3 py-1 text-[11px] text-[var(--ink-secondary)] transition-colors hover:bg-[var(--surface-sunken)] disabled:opacity-50"
            >
              {s}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
