import { useEffect, useState } from "react";
import Icon from "./Icon";
import { type VendorSummary } from "../lib/api";

export default function DocumentViewer({ 
  vendor, 
  sourceDocument,
  sourceLocation
}: { 
  vendor: VendorSummary;
  sourceDocument?: string | null;
  sourceLocation?: string | null;
}) {
  const fileUrl = `/api/vendors/${vendor.id}/file`;
  const [textContent, setTextContent] = useState("");

  useEffect(() => {
    if (vendor.responseFormat === "txt") {
      fetch(fileUrl)
        .then((r) => r.text())
        .then(setTextContent)
        .catch(console.error);
    }
  }, [vendor.responseFormat, fileUrl]);

  return (
    <div className="flex h-full w-full flex-col border-r border-[var(--line)] bg-[var(--surface-hover)]">
      <div className="flex-none border-b border-[var(--line)] bg-[var(--surface)] px-5 py-3 flex justify-between items-start">
        <div>
          <h3 className="text-[13px] font-semibold text-[var(--ink)]">Source Document</h3>
          <a 
            href={fileUrl} 
            target="_blank" 
            rel="noopener noreferrer"
            className="text-[11px] text-[var(--info)] hover:text-[var(--info)] hover:underline block truncate max-w-sm"
            title="Open original document in new tab"
          >
            {sourceDocument ?? "Open Document"}
          </a>
        </div>
        {sourceLocation && (
          <div className="text-right">
            <span className="text-[10px] font-semibold uppercase tracking-wider text-[var(--ink-muted)] block">AI Locator</span>
            <span className="text-[11px] font-medium text-[var(--ink-secondary)]">{sourceLocation}</span>
          </div>
        )}
      </div>
      <div className="flex-1 overflow-hidden p-4">
        {vendor.responseFormat === "txt" && (
          <pre className="h-full w-full overflow-auto whitespace-pre-wrap rounded bg-[var(--surface)] p-4 text-[13px] text-[var(--ink)] shadow-sm border border-[var(--line)]">
            {textContent}
          </pre>
        )}
        {(vendor.responseFormat === "jpg" || vendor.responseFormat === "png") && (
          <div className="h-full w-full overflow-auto rounded bg-[var(--surface)] shadow-sm border border-[var(--line)] p-2">
            <img src={fileUrl} className="w-full object-contain" alt="Quote Source" />
          </div>
        )}
        {vendor.responseFormat === "pdf" && (
          <iframe src={fileUrl} className="h-full w-full border-0 rounded shadow-sm border border-[var(--line)]" title="PDF Quote" />
        )}
        {["xlsx", "docx"].includes(vendor.responseFormat) && (
          <div className="flex h-full flex-col items-center justify-center rounded-lg border-2 border-dashed border-[var(--line-strong)] bg-[var(--surface)]">
            <div
              className="mx-auto flex h-12 w-12 items-center justify-center rounded-xl"
              style={{ background: "var(--surface-hover)", color: "var(--ink-muted)" }}
            >
              <Icon name="attachment" size={22} />
            </div>
            <p className="mt-4 text-[13px] font-medium text-[var(--ink-secondary)]">Document viewer not supported inline for .{vendor.responseFormat}</p>
            <a 
              href={fileUrl} 
              target="_blank" 
              rel="noopener noreferrer" 
              className="mt-4 text-[13px] font-semibold text-[var(--info)] hover:underline"
            >
              Download Document
            </a>
          </div>
        )}
      </div>
    </div>
  );
}
