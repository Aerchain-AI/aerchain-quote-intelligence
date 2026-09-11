import { useCallback, useEffect, useRef, useState } from "react";
import Icon from "../components/Icon";
import { Link, useNavigate, useParams } from "react-router-dom";
import { Button, Card, ErrorState, Spinner, StatusPill } from "../components/ui";
import { api, type ExceptionCentre, type VendorSummary } from "../lib/api";
import IngestionDropzone, { type FilePayload } from "../components/IngestionDropzone";
import VendorDetailView from "./VendorDetailView";

const FORMAT_LABELS: Record<string, string> = {
  xlsx: "Excel spreadsheet",
  pdf: "PDF quotation",
  docx: "Word document",
  jpg: "Photographed quotation",
  txt: "Email / plain text",
};

/** PRD §13 — vendor response status. Five different formats, one status view. */
const CHECK_EL = <Icon name="check" size={13} />;

/**
 * One response waiting its turn.
 *
 * Uploading and extracting are separate steps and only the second can fail in
 * an interesting way, so they are tracked separately: a file that reached the
 * server is not lost when the model cannot read it, and the retry starts from
 * extraction rather than sending the bytes again.
 */
interface QueueItem {
  key: string;
  payload: FilePayload;
  vendorId: string | null;
  status: "waiting" | "uploading" | "extracting" | "done" | "failed" | "skipped";
  attempts: number;
  error: string | null;
  /** When the current attempt began, so the row can show how long it has run. */
  startedAt: number | null;
  /** Set when the buyer asks to move on without waiting for this one. */
  skipRequested: boolean;
}

/**
 * Three goes at each file, the first two without pausing.
 *
 * Extraction fails almost entirely on transient upstream errors, and the key
 * pool has already tried every key by the time it gives up, so an immediate
 * second attempt costs a second and often works. The pause before the last one
 * is there so a genuine outage is not hammered by a queue of five files.
 */
const MAX_ATTEMPTS = 3;
const RETRY_DELAY_MS = [0, 0, 4000];

export default function VendorsScreen({
  rfxId,
  onVendorsChanged,
}: {
  rfxId: string;
  /** Tells the workspace its response count moved, so the tabs that depend on
   * having responses unlock without a page reload. */
  onVendorsChanged?: () => void;
}) {
  const [vendors, setVendors] = useState<VendorSummary[] | null>(null);
  const [exceptions, setExceptions] = useState<ExceptionCentre | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [processing, setProcessing] = useState<string | null>(null);
  const [removing, setRemoving] = useState<string | null>(null);

  // The queue is held in a ref and mirrored into state for rendering. The loop
  // that drains it needs to see writes immediately, and React state does not
  // give it that inside a single pass.
  const queueRef = useRef<QueueItem[]>([]);
  const [queueView, setQueueView] = useState<QueueItem[]>([]);
  const drainingRef = useRef(false);
  const syncQueue = () => setQueueView([...queueRef.current]);

  const removeResponse = async (vendorId: string, vendorName: string) => {
    if (!window.confirm(`Remove ${vendorName}'s response? Its quotes, exceptions and questionnaire go with it.`)) return;
    setRemoving(vendorId);
    try {
      await api.deleteVendorResponse(rfxId, vendorId);
      load();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setRemoving(null);
    }
  };
  // Which response is open lives in the URL rather than in component state, so
  // the Supplier Replies tab can link straight to one, the back button works,
  // and a reviewer can paste someone the exact response they are asking about.
  const { "*": splat } = useParams();
  const navigate = useNavigate();
  const selectedVendorId = (splat ?? "").split("/")[0] || null;
  const setSelectedVendorId = (id: string | null) =>
    navigate(id ? `/events/${rfxId}/vendors/${id}` : `/events/${rfxId}/vendors`);

  const load = () => {
    setError(null);
    Promise.all([api.listVendors(rfxId), api.getExceptions(rfxId)])
      .then(([v, e]) => {
        setVendors(v);
        setExceptions(e);
        // The workspace gates Comparison, Award and Accuracy on whether any
        // response exists, and it read that from a detail it fetched once on
        // mount. Uploading a quote left those tabs locked until a hard reload.
        onVendorsChanged?.();
      })
      .catch((err) => setError(err.message));
  };
  useEffect(load, [rfxId]);

  /**
   * Take one file as far as it will go, retrying extraction on failure.
   *
   * Upload and extraction are attempted separately so a file that is on the
   * server is not re-sent when only the model failed.
   */
  const runItem = async (item: QueueItem) => {
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
      if (item.skipRequested) {
        item.status = "skipped";
        item.startedAt = null;
        syncQueue();
        return;
      }
      item.attempts = attempt;
      item.error = null;
      item.startedAt = Date.now();
      try {
        if (!item.vendorId) {
          item.status = "uploading";
          syncQueue();
          const created = await api.addVendor(rfxId, item.payload);
          item.vendorId = created.id;
          setVendors((prev) => (prev ? [created, ...prev] : [created]));
          // The response exists now, so the workspace is told before extraction
          // is attempted. A quotation the model could not read is still a
          // quotation, and gating the Comparison tab on the model succeeding
          // locked the buyer out of their own data during an outage.
          onVendorsChanged?.();
        }

        item.status = "extracting";
        syncQueue();
        await api.processVendor(rfxId, item.vendorId);

        item.status = "done";
        item.startedAt = null;
        syncQueue();
        return;
      } catch (err) {
        item.error = (err as Error).message;
        if (attempt === MAX_ATTEMPTS || item.skipRequested) {
          item.status = item.skipRequested ? "skipped" : "failed";
          item.startedAt = null;
          syncQueue();
          return;
        }
        item.status = "waiting";
        syncQueue();
        const wait = RETRY_DELAY_MS[attempt] ?? 0;
        if (wait > 0) await new Promise((r) => setTimeout(r, wait));
      }
    }
  };

  /** One at a time, on purpose: five extractions at once is how a rate limit is hit. */
  const drainQueue = useCallback(async () => {
    if (drainingRef.current) return;
    drainingRef.current = true;
    try {
      for (;;) {
        const next = queueRef.current.find((i) => i.status === "waiting" && i.attempts === 0);
        if (!next) break;
        await runItem(next);
        load();
      }
    } finally {
      drainingRef.current = false;
      syncQueue();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rfxId]);

  const handleUpload = (payloads: FilePayload[]) => {
    queueRef.current = [
      ...queueRef.current,
      ...payloads.map((payload, i) => ({
        key: `${Date.now()}-${i}-${payload.name}`,
        payload,
        vendorId: null,
        status: "waiting" as const,
        attempts: 0,
        error: null,
        startedAt: null,
        skipRequested: false,
      })),
    ];
    syncQueue();
    void drainQueue();
  };

  /**
   * Stop waiting on this one and let the rest through.
   *
   * The request already running cannot be recalled, so the flag is read between
   * attempts rather than mid-flight. What it buys the buyer is that a slow file
   * stops costing them the other four.
   */
  const skipQueued = (key: string) => {
    const item = queueRef.current.find((i) => i.key === key);
    if (!item) return;
    item.skipRequested = true;
    if (item.status === "waiting") {
      item.status = "skipped";
      item.startedAt = null;
    }
    syncQueue();
  };

  /** A file that used up its three attempts, sent round again by hand. */
  const retryQueued = (key: string) => {
    const item = queueRef.current.find((i) => i.key === key);
    if (!item) return;
    item.status = "waiting";
    item.attempts = 0;
    item.error = null;
    item.startedAt = null;
    item.skipRequested = false;
    syncQueue();
    void drainQueue();
  };

  const clearFinishedQueue = () => {
    queueRef.current = queueRef.current.filter((i) => i.status !== "done" && i.status !== "skipped");
    syncQueue();
  };

  const reprocess = async (vendorId: string) => {
    setProcessing(vendorId);
    try {
      await api.processVendor(rfxId, vendorId);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setProcessing(null);
      // Reload either way. A failed extraction restores the vendor's previous
      // status server-side, and the buyer needs to see that rather than a row
      // stuck on "processing".
      load();
    }
  };

  if (error) return <ErrorState message={error} onRetry={load} />;
  if (!vendors) return <Spinner label="Loading vendor responses…" />;

  const exceptionsFor = (vendorId: string) => exceptions?.exceptions.filter((e) => e.vendorId === vendorId) ?? [];

  if (selectedVendorId) {
    return <VendorDetailView rfxId={rfxId} vendorId={selectedVendorId} onBack={() => setSelectedVendorId(null)} />;
  }

  return (
    <div className="space-y-4">
      <IngestionDropzone onUpload={handleUpload} busy={queueView.some((i) => i.status !== "done")} />

      <UploadQueue
        items={queueView}
        onRetry={retryQueued}
        onSkip={skipQueued}
        onClearDone={clearFinishedQueue}
      />

      <p className="text-[13px] text-[var(--ink-secondary)]">
        {vendors.length} vendors responded in {new Set(vendors.map((v) => v.responseFormat)).size} different formats.
        Each was put through the same pipeline: classify → extract → normalize → validate.
      </p>

      <div className="grid gap-3">
        {vendors.map((vendor) => {
          const vendorExceptions = exceptionsFor(vendor.id);
          const lowConfidence = vendorExceptions.filter(
            (e) => e.type === "low_confidence" || e.type === "ambiguous_value",
          ).length;
          return (
            <Card key={vendor.id}>
              <div className="flex flex-wrap items-start justify-between gap-4 px-5 py-4">
                <div className="min-w-[220px]">
                  <div className="flex items-center gap-3">
                    <h3 className="text-sm font-semibold text-[var(--ink)]">{vendor.name}</h3>
                    <StatusPill status={processing === vendor.id ? "processing" : vendor.status} />
                  </div>
                  <p className="mt-1 text-[12px] text-[var(--ink-muted)]">
                    {FORMAT_LABELS[vendor.responseFormat] ?? vendor.responseFormat}
                  </p>
                </div>

                {processing === vendor.id ? (
                  <div className="flex flex-1 items-center justify-center py-2">
                     <PipelineAnimation />
                  </div>
                ) : (
                  <div className="flex flex-1 flex-wrap gap-x-8 gap-y-2 text-[13px]">
                    <Stat
                      label="Items found"
                    value={
                      vendor.itemsFoundCount == null ? "—" : `${vendor.itemsFoundCount} / ${(vendor.itemsFoundCount ?? 0) + (vendor.itemsMissingCount ?? 0)}`
                    }
                  />
                  <Stat
                    label="Missing"
                    value={vendor.itemsMissingCount == null ? "—" : String(vendor.itemsMissingCount)}
                    tone={vendor.itemsMissingCount ? "warn" : undefined}
                  />
                  <Stat
                    label="Flagged values"
                    value={String(lowConfidence)}
                    tone={lowConfidence ? "warn" : undefined}
                  />
                  <Stat
                    label="Confidence"
                    value={vendor.overallConfidence == null ? "—" : `${Math.round(vendor.overallConfidence * 100)}%`}
                  />
                    <Stat label="Exceptions" value={String(vendorExceptions.length)} />
                  </div>
                )}

                <div className="flex items-center gap-2">
                  <button 
                    onClick={() => setSelectedVendorId(vendor.id)}
                    className="text-[13px] font-medium text-[var(--ink-secondary)] hover:text-[var(--ink)] mr-2 inline-flex items-center gap-1.5"
                  >
                    View extraction <Icon name="arrow-right" size={12} />
                  </button>
                  <Button variant="secondary" onClick={() => reprocess(vendor.id)} disabled={processing === vendor.id}>
                    {processing === vendor.id ? "Processing…" : "Re-process"}
                  </Button>
                  <button
                    onClick={() => removeResponse(vendor.id, vendor.name)}
                    disabled={removing === vendor.id}
                    title="Remove this response from the event"
                    className="ml-2 rounded px-2 py-1 text-[12px] text-[var(--ink-muted)] transition-colors hover:bg-[var(--critical-soft)] hover:text-[var(--critical)] disabled:opacity-50"
                  >
                    {removing === vendor.id ? "Removing…" : "Remove"}
                  </button>
                </div>
              </div>

              {!processing && vendorExceptions.length > 0 && (
                <div className="border-t border-[var(--line)] bg-[var(--surface-sunken)] px-5 py-3">
                  <ul className="space-y-1">
                    {vendorExceptions.slice(0, 3).map((ex) => (
                      <li key={ex.id} className="text-[12px] text-[var(--ink-secondary)]">
                        <span className={ex.severity === "critical" ? "text-[var(--critical)]" : "text-[var(--warning)]"}>
                          <Icon name={ex.severity === "critical" ? "alert" : "info"} size={12} />
                        </span>{" "}
                        {ex.lineItemId ? `Item #${ex.lineItemId}: ` : ""}
                        {ex.message.length > 150 ? `${ex.message.slice(0, 150)}…` : ex.message}
                      </li>
                    ))}
                    {vendorExceptions.length > 3 && (
                      <li className="text-[12px] text-[var(--ink-muted)]">
                        <button onClick={() => setSelectedVendorId(vendor.id)} className="hover:text-[var(--ink-secondary)]">
                          +{vendorExceptions.length - 3} more in the review workspace <Icon name="arrow-right" size={12} />
                        </button>
                      </li>
                    )}
                  </ul>
                </div>
              )}
            </Card>
          );
        })}
      </div>
    </div>
  );
}

function Stat({ label, value, tone }: { label: string; value: string; tone?: "warn" }) {
  return (
    <div>
      <div className="text-[11px] uppercase tracking-wide text-[var(--ink-muted)]">{label}</div>
      <div className={`cell-num text-[14px] ${tone === "warn" ? "text-[var(--warning)]" : "text-[var(--ink)]"}`}>{value}</div>
    </div>
  );
}

function PipelineAnimation() {
  const steps = ["Classify", "Extract", "Map", "Normalize"];
  const [activeStep, setActiveStep] = useState(0);

  useEffect(() => {
    // Cycle through steps roughly matching the extraction pipeline's stages
    const interval = setInterval(() => {
      setActiveStep((prev) => (prev + 1 < steps.length ? prev + 1 : prev));
    }, 1500); // Progress every 1.5s
    return () => clearInterval(interval);
  }, [steps.length]);

  return (
    <div className="flex items-center w-full max-w-md px-4">
      {steps.map((step, idx) => {
        const isPast = idx < activeStep;
        const isActive = idx === activeStep;
        return (
          <div key={step} className="flex flex-1 items-center">
            <div className="flex flex-col items-center flex-shrink-0">
              <div
                className={`flex h-6 w-6 items-center justify-center rounded-full border-2 text-[10px] font-bold transition-colors ${
                  isPast
                    ? "border-[var(--good)] bg-[var(--good)] text-[var(--ink-inverse)]"
                    : isActive
                    ? "border-[var(--info)] bg-[var(--info-soft)] text-[var(--info)] animate-pulse"
                    : "border-[var(--line)] bg-[var(--surface)] text-[var(--ink-muted)]"
                }`}
              >
                {isPast ? CHECK_EL : idx + 1}
              </div>
              <span
                className={`mt-1.5 text-[10px] font-medium uppercase tracking-wider ${
                  isActive ? "text-[var(--ink)] font-semibold" : isPast ? "text-[var(--good)]" : "text-[var(--ink-muted)]"
                }`}
              >
                {step}
              </span>
            </div>
            {idx < steps.length - 1 && (
              <div className="mx-2 h-[2px] flex-1 bg-[var(--surface-hover)]">
                <div
                  className="h-full bg-[var(--good)] transition-all duration-1000 ease-in-out"
                  style={{ width: isPast ? "100%" : "0%" }}
                />
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

/**
 * What is in the queue and how it is going.
 *
 * A buyer who drops five files is owed a per-file account of what happened, not
 * a spinner. A failure names its reason and offers another go: extraction fails
 * on transient upstream errors more often than on anything about the document,
 * and a file that failed at nine o'clock usually reads fine at ten.
 */
function UploadQueue({
  items,
  onRetry,
  onSkip,
  onClearDone,
}: {
  items: QueueItem[];
  onRetry: (key: string) => void;
  onSkip: (key: string) => void;
  onClearDone: () => void;
}) {
  // A row that has been running for two minutes should say so. A spinner with
  // no elapsed time is the difference between "slow" and "stuck", and the buyer
  // is the one who has to tell them apart.
  const [now, setNow] = useState(Date.now());
  const running = items.some((i) => i.startedAt != null);
  useEffect(() => {
    if (!running) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [running]);

  if (items.length === 0) return null;

  const done = items.filter((i) => i.status === "done").length;
  const failed = items.filter((i) => i.status === "failed").length;
  const skipped = items.filter((i) => i.status === "skipped").length;
  const pending = items.length - done - failed - skipped;

  const label: Record<QueueItem["status"], string> = {
    waiting: "Waiting",
    uploading: "Uploading",
    extracting: "Extracting",
    done: "Extracted",
    failed: "Failed",
    skipped: "Skipped",
  };
  const tone: Record<QueueItem["status"], string> = {
    waiting: "var(--ink-muted)",
    uploading: "var(--info)",
    extracting: "var(--info)",
    done: "var(--good)",
    failed: "var(--critical)",
    skipped: "var(--warning)",
  };

  return (
    <div className="mb-4 overflow-hidden rounded-xl border border-[var(--line)] bg-[var(--surface)] shadow-sm">
      <div className="flex items-center justify-between gap-3 border-b border-[var(--line)] bg-[var(--surface-sunken)] px-5 py-2.5">
        <div>
          <p className="text-[13px] font-semibold text-[var(--ink)]">Upload queue</p>
          <p className="mt-0.5 text-[11.5px] text-[var(--ink-muted)]">
            One at a time, in order. {done} extracted
            {pending > 0 ? `, ${pending} to go` : ""}
            {failed > 0 ? `, ${failed} failed` : ""}
            {skipped > 0 ? `, ${skipped} skipped` : ""}. A photographed quotation is the slowest to read.
          </p>
        </div>
        {done > 0 && (
          <button
            onClick={onClearDone}
            className="pressable rounded-md px-2 py-1 text-[11.5px] font-medium text-[var(--ink-muted)] hover:bg-[var(--surface-hover)] hover:text-[var(--ink)]"
          >
            Clear finished
          </button>
        )}
      </div>
      <ul className="divide-y divide-[var(--line)]">
        {items.map((item) => (
          <li key={item.key} className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 px-5 py-2.5">
            <div className="min-w-0">
              <p className="truncate text-[12.5px] font-medium text-[var(--ink)]">{item.payload.name}</p>
              {item.error && (
                <p className="mt-0.5 text-[11.5px]" style={{ color: "var(--critical)" }}>
                  {item.error}
                </p>
              )}
            </div>
            <div className="flex shrink-0 items-center gap-3">
              <span className="num text-[11.5px] font-medium" style={{ color: tone[item.status] }}>
                {label[item.status]}
                {item.startedAt ? ` · ${Math.max(0, Math.round((now - item.startedAt) / 1000))}s` : ""}
                {item.status !== "done" && item.attempts > 1 ? ` · attempt ${item.attempts} of ${MAX_ATTEMPTS}` : ""}
              </span>
              {(item.status === "extracting" || item.status === "uploading" || item.status === "waiting") &&
                !item.skipRequested && (
                  <button
                    onClick={() => onSkip(item.key)}
                    className="pressable rounded-md px-2 py-1 text-[11.5px] font-medium text-[var(--ink-muted)] hover:bg-[var(--surface-hover)] hover:text-[var(--ink)]"
                  >
                    Skip
                  </button>
                )}
              {(item.status === "failed" || item.status === "skipped") && (
                <button
                  onClick={() => onRetry(item.key)}
                  className="pressable rounded-md border border-[var(--line-strong)] px-2.5 py-1 text-[11.5px] font-medium text-[var(--ink-secondary)] hover:bg-[var(--surface-hover)] hover:text-[var(--ink)]"
                >
                  Try again
                </button>
              )}
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
