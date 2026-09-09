import { useCallback, useState } from "react";
import Icon from "./Icon";
import { Button } from "./ui";

export interface FilePayload {
  name: string;
  responseFormat: string;
  fileBase64?: string;
  textContent?: string;
}

export default function IngestionDropzone({ onUpload }: { onUpload: (payload: FilePayload) => void }) {
  const [activeTab, setActiveTab] = useState<"file" | "text">("file");
  const [isDragging, setIsDragging] = useState(false);
  const [text, setText] = useState("");
  const [vendorName, setVendorName] = useState("");

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

  const processFile = (file: File) => {
    const ext = file.name.split(".").pop()?.toLowerCase() ?? "";
    const formatMap: Record<string, string> = {
      xlsx: "xlsx",
      pdf: "pdf",
      docx: "docx",
      png: "jpg", // backend supports jpg/png as image
      jpg: "jpg",
      jpeg: "jpg",
    };
    const format = formatMap[ext];
    
    if (!format) {
      alert(`Unsupported file format: ${ext}`);
      return;
    }

    const reader = new FileReader();
    reader.onload = (e) => {
      const dataUrl = e.target?.result as string;
      // split base64 part
      const base64 = dataUrl.split(",")[1];
      if (base64) {
        onUpload({
          name: vendorName || file.name.replace(/\.[^/.]+$/, ""),
          responseFormat: format,
          fileBase64: base64,
        });
        setVendorName("");
      }
    };
    reader.readAsDataURL(file);
  };

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      setIsDragging(false);
      if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
        processFile(e.dataTransfer.files[0]);
        e.dataTransfer.clearData();
      }
    },
    [vendorName]
  );

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      processFile(e.target.files[0]);
    }
  };

  const handleTextSubmit = () => {
    if (!text.trim()) return;
    onUpload({
      name: vendorName || "Pasted Text Response",
      responseFormat: "txt",
      textContent: text,
    });
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
            Vendor Name (Optional)
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
                Drag and drop a quote file here
              </p>
              <p className="mt-1 text-[11px] text-[var(--ink-muted)]">
                Supports .xlsx, .pdf, .docx, .png, .jpg
              </p>
            </div>
          </div>
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
