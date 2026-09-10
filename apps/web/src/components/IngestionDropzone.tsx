import { useCallback, useState } from "react";
import Icon from "./Icon";
import { Button } from "./ui";

export interface FilePayload {
  name: string;
  responseFormat: string;
  fileBase64?: string;
  textContent?: string;
}

/**
 * Where vendor responses come in.
 *
 * It took one file at a time, which is not how quotations arrive: a buyer
 * closing an RFx has five replies sitting in a folder and wants them all in.
 * Dropping several used to silently ingest the first and discard the rest,
 * which is the worst of the three possible behaviours.
 */
export default function IngestionDropzone({
  onUpload,
  busy,
}: {
  onUpload: (payloads: FilePayload[]) => void;
  /** True while the queue is working, so the zone can say so. */
  busy?: boolean;
}) {
  const [activeTab, setActiveTab] = useState<"file" | "text">("file");
  const [isDragging, setIsDragging] = useState(false);
  const [text, setText] = useState("");
  const [vendorName, setVendorName] = useState("");
  const [rejected, setRejected] = useState<string[]>([]);

  const handleDrag = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
  }, []);

  const handleDragIn = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(true);
  }, []);

  const handleDragOut = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
  }, []);

  const FORMATS: Record<string, string> = {
    xlsx: "xlsx",
    pdf: "pdf",
    docx: "docx",
    png: "jpg", // the backend treats png and jpg alike
    jpg: "jpg",
    jpeg: "jpg",
  };

  const readOne = (file: File, useTypedName: boolean): Promise<FilePayload | null> =>
    new Promise((resolve) => {
      const ext = file.name.split(".").pop()?.toLowerCase() ?? "";
      const format = FORMATS[ext];
      if (!format) {
        resolve(null);
        return;
      }
      const reader = new FileReader();
      reader.onerror = () => resolve(null);
      reader.onload = (e) => {
        const base64 = (e.target?.result as string).split(",")[1];
        resolve(
          base64
            ? {
                // One typed name cannot describe five files, so it is only used
                // when there is exactly one. Otherwise each file names itself.
                name: (useTypedName && vendorName) || file.name.replace(/\.[^/.]+$/, ""),
                responseFormat: format,
                fileBase64: base64,
              }
            : null,
        );
      };
      reader.readAsDataURL(file);
    });

  const processFiles = async (files: FileList) => {
    const list = Array.from(files);
    const useTypedName = list.length === 1;
    const results = await Promise.all(list.map((f) => readOne(f, useTypedName)));

    // Named rather than counted: a buyer who dropped a folder needs to know
    // which file did not go in, not that "1 file was skipped".
    setRejected(list.filter((_, i) => results[i] == null).map((f) => f.name));

    const payloads = results.filter((r): r is FilePayload => r != null);
    if (payloads.length > 0) {
      onUpload(payloads);
      setVendorName("");
    }
  };

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      setIsDragging(false);
      if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
        void processFiles(e.dataTransfer.files);
        e.dataTransfer.clearData();
      }
    },
    [vendorName]
  );

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      void processFiles(e.target.files);
      // Cleared so the same file can be picked twice in a row, which otherwise
      // fires no change event and looks like the upload was ignored.
      e.target.value = "";
    }
  };

  const handleTextSubmit = () => {
    if (!text.trim()) return;
    onUpload([
      {
        name: vendorName || "Pasted Text Response",
        responseFormat: "txt",
        textContent: text,
      },
    ]);
    setText("");
    setVendorName("");
  };

  return (
    <div className="mb-6 overflow-hidden rounded-xl border border-[var(--line)] bg-[var(--surface)] shadow-sm">
      <div className="border-b border-[var(--line)] bg-[var(--surface-sunken)] px-5 py-3 flex items-center justify-between">
        <div className="flex items-center gap-4">
          <button
            onClick={() => setActiveTab("file")}
            className={`text-[13px] font-semibold transition-colors ${
              activeTab === "file" ? "text-[var(--ink)]" : "text-[var(--ink-muted)] hover:text-[var(--ink-secondary)]"
            }`}
          >
            Upload file
          </button>
          <button
            onClick={() => setActiveTab("text")}
            className={`text-[13px] font-semibold transition-colors ${
              activeTab === "text" ? "text-[var(--ink)]" : "text-[var(--ink-muted)] hover:text-[var(--ink-secondary)]"
            }`}
          >
            Paste text
          </button>
        </div>
        
        {/* PRD: Email Ingestion Cue */}
        <div className="flex items-center gap-1.5 text-[12px] text-[var(--ink-muted)] bg-[var(--surface)] border border-[var(--line)] px-3 py-1 rounded-full shadow-sm">
          <Icon name="send" size={13} className="text-[var(--ink-muted)]" />
          <span>Forward quotes to: <strong className="text-[var(--ink-secondary)]">fy27-corrugated@inbound.aerchain.io</strong></span>
        </div>
      </div>

      <div className="p-5">
        <div className="mb-4 max-w-sm">
          <label className="block text-[11px] font-semibold uppercase tracking-wider text-[var(--ink-muted)] mb-1.5">
            Vendor Name (Optional, single file only)
          </label>
          <input
            type="text"
            value={vendorName}
            onChange={(e) => setVendorName(e.target.value)}
            placeholder="e.g. Sundaram Packaging"
            className="w-full rounded-md border border-[var(--line-strong)] px-3 py-1.5 text-[13px] outline-none focus:border-[var(--ink)] focus:ring-2 focus:ring-[var(--line)]"
          />
        </div>

        {activeTab === "file" && (
          <div
            className={`relative flex min-h-[140px] flex-col items-center justify-center rounded-lg border-2 border-dashed transition-colors ${
              isDragging
                ? "border-[var(--info)] bg-[var(--info-soft)]"
                : "border-[var(--line-strong)] bg-[var(--surface-sunken)] hover:bg-[var(--surface-hover)]"
            }`}
            onDragEnter={handleDragIn}
            onDragLeave={handleDragOut}
            onDragOver={handleDrag}
            onDrop={handleDrop}
          >
            <input
              type="file"
              id="file-upload"
              multiple
              className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
              onChange={handleFileSelect}
              accept=".xlsx,.pdf,.docx,.png,.jpg,.jpeg"
            />
            <div className="text-center pointer-events-none">
              <span
                className="mx-auto mb-2.5 flex h-10 w-10 items-center justify-center rounded-xl"
                style={{ background: "var(--surface-hover)", color: "var(--ink-muted)" }}
              >
                <Icon name="document" size={19} />
              </span>
              <p className="text-[13px] font-medium text-[var(--ink-secondary)]">
                {busy ? "Add more — they join the queue" : "Drag and drop quote files here"}
              </p>
              <p className="mt-1 text-[11px] text-[var(--ink-muted)]">
                Several at once is fine. Supports .xlsx, .pdf, .docx, .png, .jpg
              </p>
            </div>
          </div>
        )}

        {rejected.length > 0 && (
          <p className="mb-3 text-[12px]" style={{ color: "var(--critical)" }}>
            Not a supported format, so {rejected.length === 1 ? "it was" : "these were"} left out:{" "}
            {rejected.join(", ")}
          </p>
        )}

        {activeTab === "text" && (
          <div>
            <textarea
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder="Paste raw email text or informal quote details here..."
              className="min-h-[120px] w-full resize-y rounded-lg border border-[var(--line-strong)] bg-[var(--surface-sunken)] p-3 text-[13px] outline-none focus:border-[var(--ink)] focus:bg-[var(--surface)] focus:ring-2 focus:ring-[var(--line)]"
            />
            <div className="mt-3 flex justify-end">
              <Button onClick={handleTextSubmit} disabled={!text.trim()} className="!bg-[var(--accent)] hover:!bg-[var(--accent-hover)]">
                Submit Text Quote
              </Button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
