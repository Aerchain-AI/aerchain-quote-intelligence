import { useEffect, useState } from "react";
import { api } from "../lib/api";
import { Spinner } from "../components/ui";

export default function VendorsDirectoryScreen() {
  const [vendors, setVendors] = useState<Array<{ id: string; name: string; format: string; qualityScore: string; status: string; categories: string }> | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.listAllVendors()
      .then((data) => setVendors(data))
      .catch(() => setVendors([]))
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <Spinner label="Loading supplier directory..." />;

  return (
    <div className="mx-auto max-w-[1200px] px-8 py-8 space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-[var(--ink)]">Supplier Directory</h1>
        <p className="mt-1 text-sm text-[var(--ink-muted)]">
          Master index of registered suppliers, formats processed by AI extraction, and quality compliance scores.
        </p>
      </div>

      {!vendors || vendors.length === 0 ? (
        <div className="rounded-xl border border-[var(--line)] bg-[var(--surface)] p-12 text-center text-[var(--ink-muted)]">
          <p className="text-base font-medium text-[var(--ink)]">No vendors registered yet</p>
          <p className="mt-1 text-sm">When vendor quotes or suppliers are added, they will appear here.</p>
        </div>
      ) : (
        <div className="rounded-xl border border-[var(--line)] bg-[var(--surface)] shadow-sm overflow-hidden">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="border-b border-[var(--line)] bg-[var(--surface-sunken)] text-xs uppercase tracking-wider text-[var(--ink-muted)] font-semibold">
                <th className="px-6 py-3">Vendor Code</th>
                <th className="px-6 py-3">Vendor Name</th>
                <th className="px-6 py-3">Primary Response Format</th>
                <th className="px-6 py-3">Quality Score</th>
                <th className="px-6 py-3">Categories</th>
                <th className="px-6 py-3">Compliance Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--line)] text-sm">
              {vendors.map((v) => (
                <tr key={v.id} className="hover:bg-[var(--surface-sunken)]">
                  <td className="px-6 py-4 font-mono font-medium text-[var(--ink-secondary)]">{v.id.substring(0, 8)}</td>
                  <td className="px-6 py-4 font-semibold text-[var(--ink)]">{v.name}</td>
                  <td className="px-6 py-4 text-[var(--ink-secondary)]">{v.format}</td>
                  <td className="px-6 py-4 font-medium text-[var(--ink)]">{v.qualityScore}</td>
                  <td className="px-6 py-4 text-[var(--ink-secondary)]">{v.categories}</td>
                  <td className="px-6 py-4">
                    <span
                      className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${
                        v.status.includes("Qualified")
                          ? "bg-[var(--good-soft)] text-[var(--good)]"
                          : "bg-[var(--warning-soft)] text-[var(--warning)]"
                      }`}
                    >
                      {v.status}
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
