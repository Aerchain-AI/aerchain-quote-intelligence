import { useEffect, useState } from "react";
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

export default function VendorsScreen({ rfxId }: { rfxId: string }) {
  const [vendors, setVendors] = useState<VendorSummary[] | null>(null);
  const [exceptions, setExceptions] = useState<ExceptionCentre | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [processing, setProcessing] = useState<string | null>(null);
  const [removing, setRemoving] = useState<string | null>(null);

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
      })
      .catch((err) => setError(err.message));
  };
  useEffect(load, [rfxId]);

  const handleUpload = async (payload: FilePayload) => {
    try {
      // 1. Create the pending vendor
      const newVendor = await api.addVendor(rfxId, payload);
      // 2. Add it to the top of the list
      setVendors((prev) => (prev ? [newVendor, ...prev] : [newVendor]));
      // 3. Immediately trigger processing
      await reprocess(newVendor.id);
    } catch (err) {
      setError((err as Error).message);
    }
  };

  const reprocess = async (vendorId: string) => {
    setProcessing(vendorId);
    try {
      await api.processVendor(rfxId, vendorId);
      load();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setProcessing(null);
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
      <IngestionDropzone onUpload={handleUpload} />

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
