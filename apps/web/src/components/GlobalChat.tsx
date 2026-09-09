import React, { useRef } from "react";
import AnalysisChart from "./AnalysisChart";
import Icon, { type IconName } from "./Icon";
import { useGlobalChat } from "../lib/ChatContext";

export default function GlobalChat() {
  const {
    chatInput,
    setChatInput,
    attachments,
    setAttachments,
    isDraggingOver,
    activeContext,
    placeholderText,
    thread,
    threadBusy,
    clearThread,
    submitChat,
  } = useGlobalChat();

  const fileInputRef = useRef<HTMLInputElement>(null);
  const chatInputRef = useRef<HTMLTextAreaElement>(null);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      submitChat();
    }
  };

  const addFiles = (fileList: FileList | null) => {
    if (!fileList) return;
    const accepted = Array.from(fileList).filter((f) =>
      [
        "application/pdf",
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        "application/msword",
        "image/png",
        "image/jpeg",
        "image/jpg",
        "text/plain",
      ].includes(f.type)
    );
    setAttachments((prev) => [
      ...prev,
      ...accepted.map((f) => ({ name: f.name, size: f.size, type: f.type })),
    ]);
  };

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

      {/* ════ Persistent Multi-Modal AI Chat Bar ════ */}
      <div className="fixed bottom-0 left-60 right-0 z-overlay px-6 py-3 backdrop-blur-xl"
        style={{
          borderTop: "1px solid var(--line)",
          background: "rgba(255, 255, 255, 0.86)",
          boxShadow: "0 -8px 28px -12px rgba(41, 37, 32, 0.1)",
        }}>
        <div className="mx-auto max-w-[860px]">
          {/* Answers for the event in scope. Scoped to this event only — moving
              to another event starts a fresh thread. */}
          {thread.length > 0 && (
            <div className="thin-scroll animate-fade-up mb-2 max-h-[28rem] space-y-4 overflow-y-auto rounded-lg p-3.5"
              style={{ border: "1px solid var(--line)", background: "var(--surface-sunken)" }}>
              {thread.map((turn) => (
                <div key={turn.id}>
                  <p className="text-[12px] font-medium text-[var(--ink)]">{turn.question}</p>
                  {turn.error ? (
                    <p className="mt-0.5 text-[12px]" style={{ color: "var(--critical)" }}>{turn.error}</p>
                  ) : turn.answer == null ? (
                    <p className="mt-0.5 text-[12px] text-[var(--ink-muted)]">Working it out…</p>
                  ) : (
                    <>
                      <p className="mt-0.5 whitespace-pre-wrap text-[12px] leading-relaxed text-[var(--ink-secondary)]">
                        {turn.answer}
                      </p>
                      {turn.full && (
                        <div className="mt-3 empty:hidden">
                          <AnalysisChart answer={turn.full} />
                        </div>
                      )}
                      {turn.caveats.length > 0 && (
                        <ul className="mt-1 space-y-0.5">
                          {turn.caveats.map((c, i) => (
                            <li key={i} className="text-[11px] text-[var(--warning)]">
                              • {c}
                            </li>
                          ))}
                        </ul>
                      )}
                    </>
                  )}
                </div>
              ))}
              <button onClick={clearThread} className="text-[11px] text-[var(--ink-muted)] hover:text-[var(--ink-secondary)]">
                Clear
              </button>
            </div>
          )}

          {/* Context Badge indicator */}
          <div className="mb-1.5 flex items-center gap-2">
            <span className="inline-flex items-center gap-1.5 text-[11px] font-medium text-[var(--ink)] bg-[var(--accent-soft)] px-2.5 py-0.5 rounded-full border border-[var(--line)]">
              <span className="h-1.5 w-1.5 rounded-full bg-[var(--accent)] animate-pulse" />
              {activeContext.contextLabel}
            </span>
            {threadBusy && <span className="text-[10px] text-[var(--ink-muted)]">thinking…</span>}
            {activeContext.entityType === "builder" && (
              <span className="text-[10px] text-[var(--ink-muted)]">
                Type to refine your draft or add items
              </span>
            )}
          </div>

          {/* Attachment chips row */}
          {attachments.length > 0 && (
            <div className="mb-2 flex flex-wrap gap-2">
              {attachments.map((f, i) => (
                <div
                  key={i}
                  className="animate-fade-up flex items-center gap-2 rounded-lg border border-[var(--line)] bg-[var(--surface)] px-2.5 py-1.5 text-[12px] text-[var(--ink-secondary)] shadow-[var(--shadow-raised)]"
                >
                  <Icon name={fileIcon(f.type)} size={13} className="text-[var(--ink-muted)]" />
                  <span className="max-w-[140px] truncate font-medium">{f.name}</span>
                  <span className="num text-[11px] text-[var(--ink-muted)]">{formatBytes(f.size)}</span>
                  <button
                    onClick={() => setAttachments((prev) => prev.filter((_, idx) => idx !== i))}
                    className="pressable ml-1 rounded p-0.5 text-[var(--ink-muted)] hover:text-[var(--critical)]"
                  >
                    <Icon name="close" size={12} title="Remove attachment" />
                  </button>
                </div>
              ))}
            </div>
          )}

          {/* Input row */}
          <div
            className={`pressable flex items-center gap-1 rounded-xl border bg-[var(--surface)] px-1.5 shadow-[var(--shadow-raised)] ${
              isDraggingOver
                ? "border-[var(--ink)] ring-2 ring-[var(--line)]"
                : "border-[var(--line-strong)] focus-within:border-[var(--ink)] focus-within:ring-2 focus-within:ring-[var(--line)]"
            }`}
          >
            {/* Paperclip */}
            <button
              onClick={() => fileInputRef.current?.click()}
              className="pressable flex-none rounded-lg p-2 text-[var(--ink-muted)] hover:bg-[var(--surface-hover)] hover:text-[var(--ink)]"
            >
              <Icon name="attachment" size={17} title="Attach a PDF, spreadsheet, image or text file" />
            </button>
            <input
              ref={fileInputRef}
              type="file"
              multiple
              accept=".pdf,.docx,.doc,.png,.jpg,.jpeg,.txt,.xlsx,.xls"
              className="hidden"
              onChange={(e) => addFiles(e.target.files)}
            />

            {/* Text area */}
            <textarea
              ref={chatInputRef}
              rows={1}
              value={chatInput}
              onChange={(e) => {
                setChatInput(e.target.value);
              }}
              onKeyDown={handleKeyDown}
              placeholder={placeholderText}
              className="flex-1 resize-none bg-transparent px-1 py-2.5 text-[13px] leading-relaxed text-[var(--ink)] outline-none placeholder:text-[var(--ink-muted)]"
              style={{ minHeight: "40px" }}
            />

            {/* Send button */}
            <button
              onClick={() => submitChat()}
              disabled={!chatInput.trim() && attachments.length === 0}
              className="pressable m-1 flex flex-none items-center gap-1.5 rounded-lg bg-[var(--accent)] px-3.5 py-[7px] text-[13px] font-medium text-[var(--ink-inverse)] hover:bg-[var(--accent-hover)] disabled:cursor-not-allowed disabled:opacity-35"
            >
              <Icon name="send" size={14} />
              Send
            </button>
          </div>
        </div>
      </div>
    </>
  );
}

function fileIcon(type: string): IconName {
  if (type.includes("excel") || type.includes("spreadsheet")) return "spreadsheet";
  if (type.startsWith("image/")) return "eye";
  if (type === "application/pdf" || type.includes("word")) return "document";
  return "attachment";
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)}KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)}MB`;
}
