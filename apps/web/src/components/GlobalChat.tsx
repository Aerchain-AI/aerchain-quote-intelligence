import AnalysisChart from "./AnalysisChart";
import Icon from "./Icon";
import { ChatComposer, PaneResizer, usePaneWidth } from "./ChatComposer";
import { useGlobalChat } from "../lib/ChatContext";

/**
 * The conversation, everywhere except the RFx builder.
 *
 * Before anything is asked there is nothing to read, so the composer sits across
 * the foot of the page as one inviting line. From the first question it moves
 * into a left rail together with the transcript — one column, beside the work,
 * at a width the reader sets by dragging its edge.
 *
 * It used to expand upward from the bottom bar, which put a three-paragraph
 * answer directly over the comparison the question was about. Lifting only the
 * transcript out fixed that but left the box it was typed into stranded at the
 * far side of the screen, reading as two unrelated panels rather than one
 * session. Both halves live in the same column now.
 *
 * The RFx builder already gives the conversation a column of its own, so it
 * places the composer itself and this renders nothing there but the drop target.
 */
export default function GlobalChat() {
  const { isDraggingOver, activeContext, thread, threadBusy, clearThread } = useGlobalChat();
  const rail = usePaneWidth({
    key: "aerchain.chatRailWidth",
    cssVar: "--chat-rail",
    initial: 380,
    min: 300,
    max: 760,
    reserve: 240 + 420,
  });

  const open = thread.length > 0;
  const ownedByScreen = activeContext.entityType === "builder";

  return (
    <>
      {/* ── Full-screen drag overlay ── */}
      {isDraggingOver && (
        <div className="animate-fade-in pointer-events-none fixed inset-0 z-modal flex flex-col items-center justify-center backdrop-blur-sm"
          style={{ background: "rgba(28, 27, 25, 0.18)" }}>
          <div
            className="animate-scale-in rounded-2xl px-14 py-11 text-center"
            style={{
              border: "1.5px dashed var(--ink-muted)",
              background: "var(--surface)",
              boxShadow: "var(--shadow-overlay)",
            }}
          >
            <span
              className="mx-auto flex h-11 w-11 items-center justify-center rounded-xl"
              style={{ background: "var(--surface-hover)", color: "var(--ink)" }}
            >
              <Icon name="attachment" size={20} />
            </span>
            <p className="mt-3.5 text-[15px] font-medium text-[var(--ink)]">Drop the file here</p>
            <p className="mt-1 text-[13px] text-[var(--ink-secondary)]">PDF, Word, Excel, an image, or plain text</p>
          </div>
        </div>
      )}

      {ownedByScreen ? null : open ? (
        /* One column: what was asked, what came back, and where to ask next. */
        <aside
          className="animate-fade-up fixed bottom-0 left-60 top-0 z-overlay flex flex-col"
          style={{
            width: "var(--chat-rail)",
            borderRight: "1px solid var(--line)",
            background: "var(--surface)",
          }}
          aria-label="Conversation"
        >
          <PaneResizer
            width={rail.width}
            min={rail.min}
            max={rail.max}
            offset={240}
            onResize={rail.set}
            onReset={rail.reset}
            label="Conversation width"
          />

          <div
            className="flex shrink-0 items-center justify-between gap-2 px-4 py-3"
            style={{ borderBottom: "1px solid var(--line)", background: "var(--surface-sunken)" }}
          >
            <span className="eyebrow truncate">{activeContext.contextLabel}</span>
            <button
              onClick={clearThread}
              className="pressable shrink-0 rounded-md px-1.5 py-0.5 text-[11px] font-medium text-[var(--ink-muted)] hover:bg-[var(--surface-hover)] hover:text-[var(--ink)]"
            >
              Clear
            </button>
          </div>

          <div className="thin-scroll min-h-0 flex-1 space-y-5 overflow-y-auto px-4 py-4">
            {thread.map((turn) => (
              <div key={turn.id}>
                <p className="text-[12.5px] font-medium text-[var(--ink)]">{turn.question}</p>
                {turn.error ? (
                  <p className="mt-1 text-[12px]" style={{ color: "var(--critical)" }}>
                    {turn.error}
                  </p>
                ) : turn.answer == null ? (
                  <p className="mt-1 text-[12px] text-[var(--ink-muted)]">Working it out…</p>
                ) : (
                  <>
                    <p className="mt-1 whitespace-pre-wrap text-[12px] leading-relaxed text-[var(--ink-secondary)]">
                      {turn.answer}
                    </p>
                    {turn.full?.degraded && (
                      /* Not an error. The figures are the engine's either way;
                         what is missing is the sentences the model would have
                         written around them, and saying so is more useful than
                         a red panel that throws the answer away. */
                      <p
                        className="mt-2 rounded-md px-2 py-1.5 text-[11px] leading-relaxed"
                        style={{ background: "var(--surface-sunken)", color: "var(--ink-secondary)" }}
                      >
                        Written by the system, not the language model, which could not be reached. Every figure above
                        is computed by the engine and is unaffected.
                      </p>
                    )}
                    {turn.full && (
                      <div className="mt-3 empty:hidden">
                        <AnalysisChart answer={turn.full} />
                      </div>
                    )}
                    {turn.caveats.length > 0 && (
                      <ul className="mt-2 space-y-1">
                        {turn.caveats.map((c, i) => (
                          <li key={i} className="flex gap-1.5 text-[11px] leading-relaxed text-[var(--ink-secondary)]">
                            <span className="mt-[2px] shrink-0" style={{ color: "var(--warning)" }}>
                              <Icon name="alert" size={10} />
                            </span>
                            {c}
                          </li>
                        ))}
                      </ul>
                    )}
                  </>
                )}
              </div>
            ))}
            {threadBusy && <p className="text-[11px] text-[var(--ink-muted)]">thinking…</p>}
          </div>

          <div
            className="shrink-0 px-3 py-3"
            style={{ borderTop: "1px solid var(--line)", background: "var(--surface)" }}
          >
            <ChatComposer compact placeholder="Ask a follow-up…" />
          </div>
        </aside>
      ) : (
        /* Nothing asked yet — one line across the foot of the page. */
        <div
          className="fixed bottom-0 left-60 right-0 z-overlay px-6 py-3 backdrop-blur-xl"
          style={{
            borderTop: "1px solid var(--line)",
            background: "rgba(255, 255, 255, 0.86)",
            boxShadow: "0 -8px 28px -12px rgba(41, 37, 32, 0.1)",
          }}
        >
          <div className="mx-auto max-w-[860px]">
            <ChatComposer />
          </div>
        </div>
      )}
    </>
  );
}
