export default function VendorsDirectoryScreen() {
  const vendors = [
    { id: "V-001", name: "Vendor A", format: "Excel (.xlsx)", qualityScore: "100%", status: "Qualified", categories: "Corrugated Packaging, Tapes" },
    { id: "V-002", name: "Vendor B", format: "PDF (.pdf)", qualityScore: "95%", status: "Qualified", categories: "Packaging Rolls, Boxes" },
    { id: "V-003", name: "Vendor C", format: "Word (.docx)", qualityScore: "100%", status: "Qualified (USD Quotes)", categories: "Kraft Paper, Packaging" },
    { id: "V-004", name: "Vendor D", format: "Photo/JPG (.jpg)", qualityScore: "82%", status: "Requires Review", categories: "Printed Containers" },
    { id: "V-005", name: "Vendor E", format: "Email Text (.txt)", qualityScore: "88%", status: "Conditional", categories: "Protective Packaging" },
  ];

  return (
    <div className="mx-auto max-w-[1200px] px-8 py-8 space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-[var(--ink)]">Supplier Directory</h1>
        <p className="mt-1 text-sm text-[var(--ink-muted)]">
          Master index of registered suppliers, formats processed by AI extraction, and quality compliance scores.
        </p>
      </div>

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
                <td className="px-6 py-4 font-mono font-medium text-[var(--ink-secondary)]">{v.id}</td>
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
    </div>
  );
}
