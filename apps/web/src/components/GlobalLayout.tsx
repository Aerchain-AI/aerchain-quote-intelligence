import React from "react";
import { Link, useLocation } from "react-router-dom";
import type { DemoProfile } from "../lib/auth";
import { ChatProvider } from "../lib/ChatContext";
import GlobalChat from "./GlobalChat";
import Icon, { type IconName } from "./Icon";

interface GlobalLayoutProps {
  children: React.ReactNode;
  session: DemoProfile | null;
  onLogout: () => void;
}

/** Each link had an `icon` field that nothing read, and the markup drew the same
 * dollar-sign path six times — six destinations, one placeholder. */
const NAV: Array<{ name: string; to: string; icon: IconName }> = [
  { name: "Dashboard", to: "/dashboard", icon: "dashboard" },
  { name: "New RFx", to: "/events/new", icon: "compose" },
  { name: "My RFx", to: "/events", icon: "stack" },
  { name: "Approvals", to: "/approvals", icon: "approve" },
  { name: "Vendors", to: "/vendors", icon: "vendors" },
  { name: "Settings", to: "/settings", icon: "settings" },
];

export default function GlobalLayout({ children, session, onLogout }: GlobalLayoutProps) {
  const location = useLocation();

  // "/events" also owns "/events/123", but not "/events/new", which has its own link.
  const isActive = (to: string) => {
    if (to === "/events") {
      return (
        location.pathname === "/events" ||
        (location.pathname.startsWith("/events/") && location.pathname !== "/events/new")
      );
    }
    return location.pathname.startsWith(to);
  };

  return (
    <ChatProvider>
      <div className="flex min-h-[100dvh]" style={{ background: "var(--canvas)" }}>
        <a href="#main" className="skip-link">
          Skip to content
        </a>

        <aside
          className="grain fixed inset-y-0 left-0 z-overlay flex w-60 flex-col overflow-hidden"
          style={{ background: "var(--surface-inverse)" }}
        >
          <div className="relative z-10 flex h-16 shrink-0 items-center gap-2.5 px-5">
            <span
              className="flex h-7 w-7 items-center justify-center rounded-[7px]"
              style={{ background: "var(--ink-inverse)" }}
              aria-hidden
            >
              <Icon name="derive" size={16} className="text-[var(--ink)]" strokeWidth={1.8} />
            </span>
            <span className="display text-[15px]" style={{ color: "var(--ink-inverse)" }}>
              Aerchain
            </span>
          </div>

          <nav className="relative z-10 flex-1 space-y-0.5 px-2.5 py-3" aria-label="Primary">
            {NAV.map((link) => {
              const active = isActive(link.to);
              return (
                <Link
                  key={link.name}
                  to={link.to === "/events/new" ? "/events/new?fresh=true" : link.to}
                  aria-current={active ? "page" : undefined}
                  onClick={() => {
                    if (link.to === "/events/new") sessionStorage.removeItem("qic.rfx.inProgress");
                  }}
                  className="pressable group relative flex items-center gap-3 rounded-lg px-3 py-2 text-[13px] font-medium"
                  style={{
                    background: active ? "var(--surface-inverse-hover)" : "transparent",
                    color: active ? "var(--ink-inverse)" : "rgba(250, 249, 247, 0.62)",
                  }}
                  onMouseEnter={(e) => {
                    if (!active) e.currentTarget.style.color = "var(--ink-inverse)";
                  }}
                  onMouseLeave={(e) => {
                    if (!active) e.currentTarget.style.color = "rgba(250, 249, 247, 0.62)";
                  }}
                >
                  {active && (
                    <span
                      className="absolute left-0 top-1/2 h-4 w-[2.5px] -translate-y-1/2 rounded-r-full"
                      style={{ background: "var(--ink-inverse)" }}
                      aria-hidden
                    />
                  )}
                  <Icon name={link.icon} size={16} />
                  {link.name}
                </Link>
              );
            })}
          </nav>

          {session && (
            <div
              className="relative z-10 flex shrink-0 items-center justify-between gap-2 p-3.5"
              style={{ borderTop: "1px solid rgba(250, 249, 247, 0.1)" }}
            >
              <div className="flex min-w-0 flex-1 items-center gap-2.5">
                {/* A rounded square, not another avatar circle. */}
                <div
                  className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-[9px] text-[11px] font-semibold text-[var(--ink-inverse)] ${session.accentColor}`}
                >
                  {session.avatar}
                </div>
                <div className="min-w-0">
                  <p className="truncate text-[12.5px] font-medium" style={{ color: "var(--ink-inverse)" }}>
                    {session.name}
                  </p>
                  <p className="truncate text-[11px]" style={{ color: "rgba(250, 249, 247, 0.5)" }}>
                    {session.role || "Manager"}
                  </p>
                </div>
              </div>
              <button
                onClick={onLogout}
                className="pressable rounded-md p-1.5"
                style={{ color: "rgba(250, 249, 247, 0.55)" }}
                onMouseEnter={(e) => (e.currentTarget.style.color = "var(--ink-inverse)")}
                onMouseLeave={(e) => (e.currentTarget.style.color = "rgba(250, 249, 247, 0.55)")}
              >
                <Icon name="logout" size={16} title="Sign out" />
              </button>
            </div>
          )}
        </aside>

        {/* A div, not a <main> — the screens rendered inside own that element,
            and nesting two of them is invalid. This is just the offset column. */}
        <div id="main" className="relative flex w-full flex-1 flex-col pb-24 pl-60">
          {children}
        </div>

        <GlobalChat />
      </div>
    </ChatProvider>
  );
}
