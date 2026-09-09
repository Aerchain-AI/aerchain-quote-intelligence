import { useEffect, useState } from "react";
import Icon from "./Icon";
import { ErrorState, Modal, Skeleton } from "./ui";
import {
  api,
  formatInr,
  type Derivation,
  type DerivationCheck,
  type DerivationTable,
  type DerivationTerm,
  type ExplainableFigure,
  type PortfolioFigure,
} from "../lib/api";

/**
 * "Where did that number come from?"
 *
 * Every figure this app puts in front of a buyer can be opened up into the
 * arithmetic that produced it. The content of this panel is fetched from the
 * calculation engine, not written by a language model — the same code path that
 * computed the figure emits the derivation, so the two cannot disagree. The
 * verification block at the bottom is the part that makes it a proof rather than
 * a story: the server recomputes the result a second, independent way and this
 * panel reports whether the two agree, including when they do not.
 */

/** Scope is either a sourcing event id, or "portfolio" for the register-level
 * headlines, which are summed across events rather than derived from one. */
export function useFigureExplainer(scope: string) {
  const [request, setRequest] = useState<{ figure: string; vendorId?: string } | null>(null);
  const explain = (figure: ExplainableFigure | PortfolioFigure, vendorId?: string) =>
    setRequest({ figure, vendorId });
  const panel = <ExplainModal scope={scope} request={request} onClose={() => setRequest(null)} />;
  return { explain, panel };
}

function ExplainModal({
  scope,
  request,
  onClose,
}: {
  scope: string;
  request: { figure: string; vendorId?: string } | null;
  onClose: () => void;
}) {
  const [data, setData] = useState<Derivation | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!request) {
      setData(null);
      setError(null);
      return;
    }
    let cancelled = false;
    setData(null);
    setError(null);
    const fetching =
      scope === "portfolio"
        ? api.explainPortfolio(request.figure as PortfolioFigure)
        : api.explainFigure(scope, request.figure as ExplainableFigure, request.vendorId);
    fetching.then((d) => !cancelled && setData(d)).catch((err) => !cancelled && setError(err.message));
    return () => {
      cancelled = true;
    };
  }, [scope, request]);

  return (
    <Modal
      open={request != null}
      onClose={onClose}
      title={data ? data.title : "How this is calculated"}
      subtitle={data ? <code className="text-[12px] text-[var(--ink)]">{data.formula}</code> : undefined}
      footer={
        data ? (
          <p className="text-[11.5px] leading-relaxed text-[var(--ink-muted)]">{data.provenance}</p>
        ) : undefined
      }
    >
      <div className="px-6 py-5">
        {error && <ErrorState message={error} />}
        {!error && !data && (
          <div className="space-y-5">
            <div className="skeleton h-[74px] w-full" />
            <Skeleton lines={2} />
            <Skeleton variant="table" rows={5} cols={5} />
          </div>
        )}
        {data && <DerivationBody derivation={data} />}
      </div>
    </Modal>
  );
}

function DerivationBody({ derivation: d }: { derivation: Derivation }) {
  return (
    <div className="stagger space-y-7">
      <Headline derivation={d} />

      <section>
        <SectionLabel>The rule</SectionLabel>
        <p className="measure mt-1.5 text-[13px] leading-relaxed text-[var(--ink-secondary)]">{d.rule}</p>
      </section>

      {d.terms.length > 0 && (
        <section>
          <SectionLabel>The arithmetic</SectionLabel>
          <div
            className="mt-2 overflow-hidden rounded-lg border"
            style={{ borderColor: "var(--line)" }}
          >
            {d.terms.map((t, i) => (
              <TermRow key={i} term={t} kind={d.valueKind} last={i === d.terms.length - 1} />
            ))}
          </div>
        </section>
      )}

      {d.tables.map((t, i) => (
        <DerivationTableView key={i} table={t} />
      ))}

      {(d.inclusions.length > 0 || d.exclusions.length > 0) && (
        <section className="grid gap-5 sm:grid-cols-2">
          {d.inclusions.length > 0 && (
            <div>
              <SectionLabel>What is counted</SectionLabel>
              <ul className="mt-1.5 space-y-1.5">
                {d.inclusions.map((s, i) => (
                  <li key={i} className="flex gap-2 text-[12.5px] leading-relaxed text-[var(--ink-secondary)]">
                    <span className="mt-[2px]" aria-hidden style={{ color: "var(--good)" }}>
                      <Icon name="plus" size={12} />
                    </span>
                    {s}
                  </li>
                ))}
              </ul>
            </div>
          )}
          {d.exclusions.length > 0 && (
            <div>
              <SectionLabel>What is not counted</SectionLabel>
              <ul className="mt-1.5 space-y-1.5">
                {d.exclusions.map((s, i) => (
                  <li key={i} className="flex gap-2 text-[12.5px] leading-relaxed text-[var(--ink-secondary)]">
                    <span className="mt-[2px]" aria-hidden style={{ color: "var(--warning)" }}>
                      <Icon name="minus" size={12} />
                    </span>
                    {s}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </section>
      )}

      {d.checks.length > 0 && <Verification checks={d.checks} />}
    </div>
  );
}

function Headline({ derivation: d }: { derivation: Derivation }) {
  const failing = d.checks.some((c) => !c.ok);
  return (
    <div
      className="flex flex-wrap items-baseline gap-x-4 gap-y-1 rounded-lg border px-5 py-4"
      style={{
        borderColor: failing ? "var(--critical-line)" : "var(--line)",
        background: failing ? "var(--critical-soft)" : "var(--surface-sunken)",
      }}
    >
      <span className="num-lg text-[30px] font-semibold leading-none text-[var(--ink)]">
        {d.value == null ? "Not enough information" : d.valueKind === "currency" ? formatInr(d.value) : d.value}
      </span>
      {d.checks.length > 0 && (
        <span
          className="inline-flex items-center gap-1.5 text-[12px] font-medium"
          style={{ color: failing ? "var(--critical)" : "var(--good)" }}
        >
          <Icon name={failing ? "alert" : "check-circle"} size={14} />
          {failing
            ? `${d.checks.filter((c) => !c.ok).length} verification(s) did not reconcile`
            : `Reconciled by ${d.checks.length} independent check${d.checks.length > 1 ? "s" : ""}`}
        </span>
      )}
    </div>
  );
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return <div className="eyebrow">{children}</div>;
}

function TermRow({ term, kind, last }: { term: DerivationTerm; kind: "currency" | "count"; last: boolean }) {
  const isResult = term.role === "result";
  return (
    <div
      className={`flex items-start justify-between gap-6 px-4 py-2.5 ${last ? "" : "border-b"}`}
      style={{
        borderColor: "var(--line)",
        background: isResult ? "var(--surface-sunken)" : "var(--surface)",
      }}
    >
      <div className="min-w-0">
        <div className={`text-[13px] ${isResult ? "font-semibold text-[var(--ink)]" : "text-[var(--ink-secondary)]"}`}>
          {term.role === "operator" && (
            <span className="mr-1 inline-block align-[-1px] text-[var(--ink-muted)]">
              <Icon name="minus" size={11} />
            </span>
          )}
          {term.label}
        </div>
        {term.note && <div className="mt-0.5 text-[11.5px] leading-relaxed text-[var(--ink-muted)]">{term.note}</div>}
      </div>
      <div
        className={`num shrink-0 text-[13.5px] ${isResult ? "font-semibold text-[var(--ink)]" : "text-[var(--ink-secondary)]"}`}
      >
        {term.value == null
          ? (term.valueText ?? "—")
          : (term.kind ?? kind) === "currency"
            ? formatInr(term.value)
            : term.value.toLocaleString("en-IN")}
      </div>
    </div>
  );
}

function cellText(value: string | number | null | undefined, kind?: string): string {
  if (value == null || value === "") return "—";
  if (kind === "currency" && typeof value === "number") return formatInr(value, { decimals: true });
  if (kind === "number" && typeof value === "number") return value.toLocaleString("en-IN");
  return String(value);
}

function DerivationTableView({ table }: { table: DerivationTable }) {
  const [expanded, setExpanded] = useState(false);
  const LIMIT = 12;
  const overflow = table.rows.length > LIMIT;
  const rows = expanded || !overflow ? table.rows : table.rows.slice(0, LIMIT);

  return (
    <section>
      <SectionLabel>{table.caption}</SectionLabel>
      {table.note && <p className="measure mt-1 text-[12px] leading-relaxed text-[var(--ink-muted)]">{table.note}</p>}
      <div
        className="thin-scroll mt-2 overflow-x-auto rounded-lg border"
        style={{ borderColor: "var(--line)" }}
      >
        <table className="grid-table">
          <thead>
            <tr>
              {table.columns.map((c) => (
                <th
                  key={c.key}
                  className={`whitespace-nowrap ${c.align === "right" ? "!text-right" : "!text-left"}`}
                >
                  {c.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, i) => (
              <tr key={i}>
                {table.columns.map((c) => (
                  <td
                    key={c.key}
                    className={`${c.align === "right" ? "num whitespace-nowrap text-right" : "text-left"} ${
                      c.kind === "text" && c.align === "left" ? "min-w-[9rem] max-w-[18rem]" : "whitespace-nowrap"
                    } ${
                      c.key === "diff" || c.key === "margin"
                        ? "font-semibold text-[var(--good)]"
                        : "text-[var(--ink-secondary)]"
                    }`}
                  >
                    {cellText(row[c.key], c.kind)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
          {table.footer && (
            <tfoot>
              <tr>
                {table.columns.map((c) => (
                  <td
                    key={c.key}
                    className={`whitespace-nowrap ${c.align === "right" ? "num text-right" : "text-left"}`}
                  >
                    {table.footer![c.key] == null ? "" : cellText(table.footer![c.key], c.kind)}
                  </td>
                ))}
              </tr>
            </tfoot>
          )}
        </table>
      </div>
      {overflow && (
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          className="pressable mt-1.5 inline-flex items-center gap-1 text-[12px] font-medium text-[var(--ink)] underline decoration-[var(--line-strong)] underline-offset-4 hover:decoration-[var(--ink)]"
        >
          <Icon name={expanded ? "minus" : "plus"} size={11} />
          {expanded ? "Show fewer rows" : `Show all ${table.rows.length} rows`}
        </button>
      )}
    </section>
  );
}

/** The proof. Each row is the same figure computed a different way; if the two
 * disagree the panel says so rather than quietly showing the headline number. */
function Verification({ checks }: { checks: DerivationCheck[] }) {
  return (
    <section>
      <SectionLabel>Verification</SectionLabel>
      <p className="measure mt-1 text-[12px] leading-relaxed text-[var(--ink-muted)]">
        Each check recomputes the result by a different route and compares. These run on every request, and a mismatch
        is reported rather than hidden.
      </p>
      <div className="mt-2 space-y-2">
        {checks.map((c, i) => (
          <div
            key={i}
            className="rounded-lg border px-4 py-3"
            style={{
              borderColor: c.ok ? "var(--good-line)" : "var(--critical-line)",
              background: c.ok ? "var(--good-soft)" : "var(--critical-soft)",
            }}
          >
            <div className="flex items-baseline justify-between gap-4">
              <span
                className="inline-flex items-center gap-1.5 text-[12.5px] font-medium"
                style={{ color: c.ok ? "var(--good)" : "var(--critical)" }}
              >
                <Icon name={c.ok ? "check" : "close"} size={13} />
                {c.label}
              </span>
              <span className="num shrink-0 text-[12px] text-[var(--ink-secondary)]">
                {c.expected.toLocaleString("en-IN")}
                <span className="mx-1.5 text-[var(--ink-muted)]">{c.ok ? "=" : "≠"}</span>
                {c.actual.toLocaleString("en-IN")}
              </span>
            </div>
            <p className="mt-1 text-[11.5px] leading-relaxed text-[var(--ink-secondary)]">{c.method}</p>
          </div>
        ))}
      </div>
    </section>
  );
}
