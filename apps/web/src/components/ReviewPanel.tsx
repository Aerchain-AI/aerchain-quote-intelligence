import { type ComparisonCell, type LineItem, type VendorSummary } from "../lib/api";
import Icon from "./Icon";
import DocumentViewer from "./DocumentViewer";
import QuoteReviewCard from "./QuoteReviewCard";

export default function ReviewPanel({
  rfxId,
  cell,
  lineItem,
  vendor,
  onClose,
  onUpdate,
  onAskAI,
}: {
  rfxId: string;
  cell: ComparisonCell;
  lineItem: LineItem;
  vendor: VendorSummary;
  onClose: () => void;
  onUpdate: () => void;
  onAskAI?: (prompt: string) => void;
}) {
  const q = cell.quote;
  if (!q) return null;

  return (
    <div className="fixed inset-0 z-50 flex bg-[var(--surface-inverse)]" onClick={onClose}>
      <div 
        className="ml-auto flex h-full w-[90vw] max-w-[1200px] bg-[var(--surface-sunken)] shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Left Pane - Source Document */}
        <div className="w-1/2 h-full flex flex-col">
          <DocumentViewer 
            vendor={vendor} 
            sourceDocument={q.sourceDocument}
            sourceLocation={q.sourceLocation}
          />
        </div>

        {/* Right Pane - Review Details */}
        <div className="flex w-1/2 flex-col bg-[var(--surface-sunken)] overflow-y-auto">
          <div className="flex-none flex items-start justify-between border-b border-[var(--line)] bg-[var(--surface)] px-5 py-4 sticky top-0 z-10">
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-wider text-[var(--ink-muted)]">{vendor.name}</p>
              <h3 className="text-sm font-semibold text-[var(--ink)]">
                Cell Review
              </h3>
            </div>
            <button onClick={onClose} className="rounded p-1 text-[var(--ink-muted)] hover:bg-[var(--surface-hover)] hover:text-[var(--ink-secondary)]">
              <Icon name="close" size={14} title="Close" />
            </button>
          </div>

          <div className="flex-1 px-5 py-5">
            <QuoteReviewCard 
              rfxId={rfxId}
              vendorId={vendor.id}
              quote={q}
              lineItem={lineItem}
              exceptions={cell.exceptions}
              onAskAI={onAskAI}
              onUpdate={() => {
                onUpdate();
                onClose(); // Automatically close review panel on update in the comparison view
              }}
            />
          </div>
        </div>
      </div>
    </div>
  );
}
