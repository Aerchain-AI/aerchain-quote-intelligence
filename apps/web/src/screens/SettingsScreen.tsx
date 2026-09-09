export default function SettingsScreen() {
  return (
    <div className="mx-auto max-w-[1000px] px-8 py-8 space-y-8">
      <div>
        <h1 className="text-2xl font-bold text-[var(--ink)]">Workspace Settings</h1>
        <p className="mt-1 text-sm text-[var(--ink-muted)]">
          Configure default currencies, AI extraction key failover pools, and human-in-the-loop validation thresholds.
        </p>
      </div>

      <div className="space-y-6">
        <div className="rounded-xl border border-[var(--line)] bg-[var(--surface)] p-6 shadow-sm space-y-4">
          <h2 className="text-base font-semibold text-[var(--ink)] border-b border-[var(--line)] pb-3">
            Currency &amp; Evaluation Engine Defaults
          </h2>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-semibold uppercase text-[var(--ink-muted)] mb-1">Base Comparison Currency</label>
              <input
                type="text"
                disabled
                value="INR (₹) — Hardened comparison default"
                className="w-full rounded-md border border-[var(--line-strong)] bg-[var(--surface-sunken)] px-3 py-2 text-sm text-[var(--ink-secondary)]"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold uppercase text-[var(--ink-muted)] mb-1">USD/INR Hardened Exchange Rate</label>
              <input
                type="text"
                disabled
                value="83.50 INR / USD"
                className="w-full rounded-md border border-[var(--line-strong)] bg-[var(--surface-sunken)] px-3 py-2 text-sm text-[var(--ink-secondary)]"
              />
            </div>
          </div>
        </div>

        <div className="rounded-xl border border-[var(--line)] bg-[var(--surface)] p-6 shadow-sm space-y-4">
          <h2 className="text-base font-semibold text-[var(--ink)] border-b border-[var(--line)] pb-3">
            AI Key Pool &amp; Failover Configuration
          </h2>
          <div className="space-y-3">
            <div className="flex items-center justify-between rounded-lg border border-[var(--line)] bg-[var(--surface-sunken)] p-4">
              <div>
                <p className="text-sm font-semibold text-[var(--ink)]">Gemini Key Pool Status</p>
                <p className="text-xs text-[var(--ink-muted)]">Free-tier automatic quota failover enabled for gemini-3.5-flash-lite and vision model.</p>
              </div>
              <span className="inline-flex items-center gap-1.5 rounded-full bg-[var(--good-soft)] px-3 py-1 text-xs font-semibold text-[var(--good)]">
                <span className="h-2 w-2 rounded-full bg-[var(--good)]" /> Active (1 Key Pool)
              </span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
