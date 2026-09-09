import { useEffect, useState } from "react";
import { api } from "../lib/api";
import { Spinner } from "../components/ui";

export default function ApprovalsScreen() {
  const [approvals, setApprovals] = useState<Array<{
    id: string;
    prx: string;
    buyer: string;
    value: string;
    vendor: string;
    status: string;
    date: string;
  }> | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api
      .listApprovals()
      .then((data) => setApprovals(data))
      .catch(() => setApprovals([]))
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <Spinner label="Loading approval requests..." />;

  return (
    <div className="mx-auto max-w-[1200px] px-8 py-8 space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-[var(--ink)]">RFx Approval Requests</h1>
        <p className="mt-1 text-sm text-[var(--ink-muted)]">
          Review evidence-backed award recommendations requiring executive or category manager sign-off.
        </p>
      </div>

      {!approvals || approvals.length === 0 ? (
        <div className="rounded-xl border border-[var(--line)] bg-[var(--surface)] p-12 text-center text-[var(--ink-muted)]">
          <p className="text-base font-medium text-[var(--ink)]">No approval requests pending</p>
          <p className="mt-1 text-sm">When award recommendations are submitted for approval, they will appear here.</p>
        </div>
      ) : (
        <div className="rounded-xl border border-[var(--line)] bg-[var(--surface)] shadow-sm overflow-hidden">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="border-b border-[var(--line)] bg-[var(--surface-sunken)] text-xs uppercase tracking-wider text-[var(--ink-muted)] font-semibold">
                <th className="px-6 py-3">Approval ID</th>
                <th className="px-6 py-3">RFx Sourcing Event</th>
                <th className="px-6 py-3">Requested By</th>
                <th className="px-6 py-3">Evaluated Value</th>
                <th className="px-6 py-3">Recommended Supplier</th>
                <th className="px-6 py-3">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--line)] text-sm">
              {approvals.map((item) => (
                <tr key={item.id} className="hover:bg-[var(--surface-sunken)]">
                  <td className="px-6 py-4 font-mono font-medium text-[var(--ink-secondary)]">{item.id}</td>
                  <td className="px-6 py-4 font-semibold text-[var(--ink)]">{item.prx}</td>
                  <td className="px-6 py-4 text-[var(--ink-secondary)]">{item.buyer}</td>
                  <td className="px-6 py-4 font-medium text-[var(--ink)]">{item.value}</td>
                  <td className="px-6 py-4 text-[var(--ink-secondary)]">{item.vendor}</td>
                  <td className="px-6 py-4">
                    <span
                      className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${
                        item.status === "Approved"
                          ? "bg-[var(--good-soft)] text-[var(--good)]"
                          : "bg-[var(--warning-soft)] text-[var(--warning)]"
                      }`}
                    >
                      {item.status}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
