import { useState } from "react";
import Icon from "../components/Icon";
import { DEMO_PROFILES, setSession, type DemoProfile } from "../lib/auth";

/**
 * Demo login screen.
 *
 * Two-step flow:
 *   1. Pick a profile card (shows name, team, role, avatar)
 *   2. Enter the 4-digit demo PIN for that profile
 *
 * The PIN is shown as a "Default PIN" hint so evaluators can log in without
 * needing external instructions.
 */
export default function LoginScreen({ onLogin }: { onLogin: (p: DemoProfile) => void }) {
  const [selected, setSelected] = useState<DemoProfile | null>(null);
  const [pin, setPin] = useState("");
  const [error, setError] = useState("");
  const [shaking, setShaking] = useState(false);

  const handleSelectProfile = (p: DemoProfile) => {
    setSelected(p);
    setPin("");
    setError("");
  };

  const handlePinInput = (digit: string) => {
    if (pin.length >= 4) return;
    const next = pin + digit;
    setPin(next);
    if (next.length === 4) {
      // Validate immediately when 4th digit entered
      setTimeout(() => checkPin(next), 80);
    }
  };

  const handlePinBackspace = () => {
    setPin((p) => p.slice(0, -1));
    setError("");
  };

  const checkPin = (value: string) => {
    if (!selected) return;
    if (value === selected.pin) {
      setSession(selected);
      onLogin(selected);
    } else {
      setShaking(true);
      setError("Incorrect PIN. Try again.");
      setPin("");
      setTimeout(() => setShaking(false), 600);
    }
  };

  return (
    <div className="relative flex min-h-[100dvh] flex-col items-center justify-center overflow-hidden bg-[var(--surface-inverse)] px-4">
      {/* Grain rather than blurred colour blobs: a surface, not a wallpaper. */}
      <div className="grain pointer-events-none absolute inset-0" />

      {/* Logo / wordmark */}
      <div className="relative mb-10 text-center">
        <div
          className="mb-3.5 inline-flex h-11 w-11 items-center justify-center rounded-xl"
          style={{ background: "var(--ink-inverse)" }}
        >
          <Icon name="derive" size={22} className="text-[var(--ink)]" strokeWidth={1.8} />
        </div>
        <h1 className="display text-[27px] text-[var(--ink-inverse)]">Aerchain</h1>
        <p className="mt-1 text-[13px] text-[var(--ink-muted)]">Quote Intelligence · Procurement Copilot</p>
      </div>

      {!selected ? (
        /* ── Step 1: Profile picker ── */
        <div className="relative w-full max-w-2xl">
          <p className="mb-5 text-center text-[13px] font-medium text-[var(--ink-muted)]">
            Select your profile to continue
          </p>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {DEMO_PROFILES.map((p) => (
              <button
                key={p.id}
                onClick={() => handleSelectProfile(p)}
                className="group flex items-center gap-4 rounded-2xl border border-[var(--line-strong)] bg-[var(--surface-inverse)] px-5 py-4 text-left transition-all hover:border-[var(--ink-muted)] hover:bg-[var(--surface-inverse-hover)] hover:shadow-[var(--shadow-lifted)]"
              >
                {/* Avatar */}
                <div
                  className={`flex h-11 w-11 flex-none items-center justify-center rounded-xl text-[13px] font-bold text-[var(--ink-inverse)] shadow-sm ${p.accentColor}`}
                >
                  {p.avatar}
                </div>
                {/* Info */}
                <div className="min-w-0">
                  <p className="truncate text-[14px] font-semibold text-[var(--ink-inverse)] group-hover:text-[var(--ink-inverse)]">
                    {p.name}
                  </p>
                  <p className="truncate text-[12px] text-[var(--ink-muted)]">{p.role}</p>
                  <p className="truncate text-[11px] text-[var(--ink-muted)]">{p.team}</p>
                </div>
                {/* Arrow */}
                <span className="ml-auto flex-none text-[var(--ink-secondary)] transition-transform group-hover:translate-x-0.5 group-hover:text-[var(--ink-muted)]">
                  <Icon name="arrow-right" size={12} />
                </span>
              </button>
            ))}
          </div>

          {/* Demo credential hint */}
          <div className="mt-6 rounded-xl border border-[var(--line-strong)] bg-[var(--surface-inverse)] px-4 py-3">
            <p className="text-center text-[11px] text-[var(--ink-muted)]">
              <span className="font-semibold text-[var(--ink-muted)]">Demo mode</span> — Select any profile.
              Each uses a 4-digit PIN shown on the next screen.
            </p>
          </div>
        </div>
      ) : (
        /* ── Step 2: PIN entry ── */
        <div className={`relative w-full max-w-sm ${shaking ? "animate-[shake_0.5s_ease-in-out]" : ""}`}>
          {/* Back */}
          <button
            onClick={() => setSelected(null)}
            className="mb-6 flex items-center gap-1.5 text-[12px] text-[var(--ink-muted)] hover:text-[var(--ink-muted)]"
          >
            <Icon name="arrow-left" size={13} /> Back to profiles
          </button>

          <div className="rounded-2xl border border-[var(--line-strong)] bg-[var(--surface-inverse)] p-7">
            {/* Selected profile mini card */}
            <div className="mb-7 flex items-center gap-3">
              <div
                className={`flex h-11 w-11 flex-none items-center justify-center rounded-xl text-[13px] font-bold text-[var(--ink-inverse)] ${selected.accentColor}`}
              >
                {selected.avatar}
              </div>
              <div>
                <p className="text-[14px] font-semibold text-[var(--ink-inverse)]">{selected.name}</p>
                <p className="text-[12px] text-[var(--ink-muted)]">{selected.team}</p>
              </div>
            </div>

            {/* PIN label */}
            <p className="mb-4 text-center text-[13px] font-medium text-[var(--ink-muted)]">Enter your PIN</p>

            {/* PIN dots */}
            <div className="mb-1 flex justify-center gap-4">
              {[0, 1, 2, 3].map((i) => (
                <div
                  key={i}
                  className={`h-4 w-4 rounded-full border-2 transition-all ${
                    i < pin.length
                      ? "scale-110 border-[var(--info)] bg-[var(--info)]"
                      : "border-[var(--line-strong)] bg-transparent"
                  }`}
                />
              ))}
            </div>

            {/* Error */}
            <p className={`mb-4 text-center text-[12px] text-[var(--critical)] transition-opacity ${error ? "opacity-100" : "opacity-0"}`}>
              {error || " "}
            </p>

            {/* Number pad */}
            <div className="grid grid-cols-3 gap-2.5">
              {["1", "2", "3", "4", "5", "6", "7", "8", "9", "", "0", "del"].map((d, i) => {
                if (d === "") return <div key={i} />;
                const isBack = d === "del";
                return (
                  <button
                    key={i}
                    onClick={() => isBack ? handlePinBackspace() : handlePinInput(d)}
                    className={`flex h-14 items-center justify-center rounded-xl text-[18px] font-semibold transition-all active:scale-95 ${
                      isBack
                        ? "bg-[var(--surface-inverse-hover)] text-[var(--ink-muted)] hover:bg-[var(--surface-inverse-hover)]"
                        : "bg-[var(--surface-inverse-hover)] text-[var(--ink-inverse)] hover:bg-[var(--surface-inverse-hover)] hover:text-[var(--ink-inverse)]"
                    }`}
                  >
                    {isBack ? <Icon name="arrow-left" size={17} title="Delete last digit" /> : <span className="num">{d}</span>}
                  </button>
                );
              })}
            </div>

            {/* Default PIN hint */}
            <div className="mt-5 rounded-lg border border-[var(--line-strong)] bg-[var(--surface-inverse)] px-3 py-2 text-center">
              <p className="text-[11px] text-[var(--ink-muted)]">
                Default PIN for <span className="font-semibold text-[var(--ink-muted)]">{selected.name}</span>:{" "}
                <span className="font-mono font-bold tracking-widest text-[var(--info-line)]">{selected.pin}</span>
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Footer */}
      <p className="relative mt-10 text-[11px] text-[var(--ink-secondary)]">
        © 2027 Aerchain · Demo environment · Data is not real
      </p>

      {/* Shake keyframe */}
      <style>{`
        @keyframes shake {
          0%, 100% { transform: translateX(0); }
          15%       { transform: translateX(-8px); }
          30%       { transform: translateX(8px); }
          45%       { transform: translateX(-6px); }
          60%       { transform: translateX(6px); }
          75%       { transform: translateX(-4px); }
          90%       { transform: translateX(4px); }
        }
      `}</style>
    </div>
  );
}
