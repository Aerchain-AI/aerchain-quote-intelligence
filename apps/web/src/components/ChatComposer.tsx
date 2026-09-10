import React, { useCallback, useEffect, useRef, useState } from "react";
import Icon, { type IconName } from "./Icon";
import { useGlobalChat } from "../lib/ChatContext";

/**
 * The box you type into, and the edge you drag.
 *
 * Both live here because both are needed in two places: the copilot rail on an
 * event, and the RFx builder's conversation column. Sending a message and then
 * hunting for the transcript in a different part of the screen reads as two
 * unrelated panels; keeping the composer in the same column as the thread it
 * belongs to is the whole point, so the composer had to become something a
 * screen can place for itself.
 */

export function ChatComposer({
  compact = false,
  placeholder,
}: {
  compact?: boolean;
  /** Overrides the context's own prompt, e.g. once a thread is underway. */
  placeholder?: string;
}) {
  const {
    chatInput,
    setChatInput,
    attachments,
    setAttachments,
    isDraggingOver,
    activeContext,
    placeholderText,
    threadBusy,
    submitChat,
  } = useGlobalChat();

  const fileInputRef = useRef<HTMLInputElement>(null);

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
      {/* In a narrow column the context is already named by the header above the
          transcript, so repeating it here would only cost a line. */}
      {!compact && (
        <div className="mb-1.5 flex items-center gap-2">
          <span className="inline-flex items-center gap-1.5 rounded-full border border-[var(--line)] bg-[var(--accent-soft)] px-2.5 py-0.5 text-[11px] font-medium text-[var(--ink)]">
            <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-[var(--accent)]" />
            {activeContext.contextLabel}
          </span>
          {threadBusy && <span className="text-[10px] text-[var(--ink-muted)]">thinking…</span>}
          {activeContext.entityType === "builder" && (
            <span className="text-[10px] text-[var(--ink-muted)]">
              Type to refine your draft or add items
            </span>
          )}
        </div>
      )}

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

      <div
        className={`pressable flex items-center gap-1 rounded-xl border bg-[var(--surface)] px-1.5 shadow-[var(--shadow-raised)] ${
          isDraggingOver
            ? "border-[var(--ink)] ring-2 ring-[var(--line)]"
            : "border-[var(--line-strong)] focus-within:border-[var(--ink)] focus-within:ring-2 focus-within:ring-[var(--line)]"
        }`}
      >
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

        <textarea
          rows={1}
          value={chatInput}
          onChange={(e) => setChatInput(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={placeholder ?? placeholderText}
          className="flex-1 resize-none bg-transparent px-1 py-2.5 text-[13px] leading-relaxed text-[var(--ink)] outline-none placeholder:text-[var(--ink-muted)]"
          style={{ minHeight: "40px" }}
        />

        {/* The word "Send" is dropped in a narrow column, where an arrow beside a
            focused input is unambiguous and the width is better spent on text. */}
        <button
          onClick={() => submitChat()}
          disabled={!chatInput.trim() && attachments.length === 0}
          className={`pressable m-1 flex flex-none items-center gap-1.5 rounded-lg bg-[var(--accent)] py-[7px] text-[13px] font-medium text-[var(--ink-inverse)] hover:bg-[var(--accent-hover)] disabled:cursor-not-allowed disabled:opacity-35 ${
            compact ? "px-2.5" : "px-3.5"
          }`}
          aria-label="Send"
        >
          <Icon name="send" size={14} />
          {!compact && "Send"}
        </button>
      </div>
    </>
  );
}

/**
 * How wide a conversation column is, in pixels.
 *
 * Kept in a custom property rather than passed down, because the column and the
 * things that must stay clear of it are separate fixed elements, and a property
 * updates all of them in the same frame as the drag with no React render in
 * between. The chosen width outlives the session: a reader who wants a wide
 * transcript should not have to say so again tomorrow.
 */
export function usePaneWidth(opts: {
  key: string;
  cssVar: string;
  initial: number;
  min: number;
  max: number;
  /** Pixels that must stay available to everything else on the row. */
  reserve: number;
}) {
  const { key, cssVar, initial, min, max, reserve } = opts;

  const clamp = useCallback(
    (px: number) => {
      const ceiling = Math.min(max, Math.max(min, window.innerWidth - reserve));
      return Math.round(Math.min(ceiling, Math.max(min, px)));
    },
    [min, max, reserve],
  );

  const [width, setWidth] = useState<number>(() => {
    if (typeof window === "undefined") return initial;
    try {
      const raw = window.localStorage.getItem(key);
      const n = raw ? Number(raw) : NaN;
      return Number.isFinite(n) ? clamp(n) : clamp(initial);
    } catch {
      return initial;
    }
  });

  useEffect(() => {
    document.documentElement.style.setProperty(cssVar, `${width}px`);
    try {
      window.localStorage.setItem(key, String(width));
    } catch {
      /* a private window is not a reason to break the layout */
    }
  }, [cssVar, key, width]);

  // A window narrowed after the fact should pull the column in with it.
  useEffect(() => {
    const onResize = () => setWidth((w) => clamp(w));
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [clamp]);

  const set = useCallback((px: number) => setWidth(clamp(px)), [clamp]);
  const reset = useCallback(() => setWidth(clamp(initial)), [clamp, initial]);

  return { width, set, reset, min, max };
}

/**
 * The edge you drag.
 *
 * A separator, not a button: it reports its position to assistive technology and
 * answers the arrow keys, because a width is a setting and settings should not
 * require a mouse. Double-clicking returns it to the default.
 */
export function PaneResizer({
  width,
  min,
  max,
  offset,
  onResize,
  onReset,
  label = "Panel width",
}: {
  width: number;
  min: number;
  max: number;
  /** Distance from the viewport's left edge to where this column starts. */
  offset: number;
  onResize: (px: number) => void;
  onReset: () => void;
  label?: string;
}) {
  const [dragging, setDragging] = useState(false);

  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    e.preventDefault();
    (e.target as HTMLDivElement).setPointerCapture(e.pointerId);
    // A drag across a page of text otherwise selects all of it, which leaves the
    // reader looking at a screen of highlight once they let go.
    document.body.style.userSelect = "none";
    document.body.style.cursor = "col-resize";
    setDragging(true);
  };

  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!dragging) return;
    onResize(e.clientX - offset);
  };

  const endDrag = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!dragging) return;
    (e.target as HTMLDivElement).releasePointerCapture(e.pointerId);
    document.body.style.userSelect = "";
    document.body.style.cursor = "";
    setDragging(false);
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    const step = e.shiftKey ? 48 : 16;
    if (e.key === "ArrowLeft") {
      e.preventDefault();
      onResize(width - step);
    } else if (e.key === "ArrowRight") {
      e.preventDefault();
      onResize(width + step);
    } else if (e.key === "Home") {
      e.preventDefault();
      onReset();
    }
  };

  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label={label}
      aria-valuenow={width}
      aria-valuemin={min}
      aria-valuemax={max}
      tabIndex={0}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
      onDoubleClick={onReset}
      onKeyDown={onKeyDown}
      title="Drag to resize. Double-click to reset."
      className="group absolute inset-y-0 right-0 z-10 w-2 translate-x-1 cursor-col-resize select-none touch-none focus:outline-none"
    >
      {/* The line only shows itself on approach, so a resting column stays quiet. */}
      <span
        className={`pointer-events-none absolute inset-y-0 left-1/2 w-[3px] -translate-x-1/2 rounded-full transition-opacity duration-150 ${
          dragging ? "opacity-100" : "opacity-0 group-hover:opacity-100 group-focus:opacity-100"
        }`}
        style={{ background: "var(--ink-muted)" }}
      />
    </div>
  );
}

export function fileIcon(type: string): IconName {
  if (type.includes("excel") || type.includes("spreadsheet")) return "spreadsheet";
  if (type.startsWith("image/")) return "eye";
  if (type === "application/pdf" || type.includes("word")) return "document";
  return "attachment";
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)}KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)}MB`;
}
