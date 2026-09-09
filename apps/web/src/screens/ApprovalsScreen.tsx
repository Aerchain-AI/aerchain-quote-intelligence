import Icon from "../components/Icon";

/**
 * Placeholder. There is no approvals model in the schema, so these two rows are
 * invented — the names, the values and the suppliers are all made up. They are
 * labelled as such on screen: everywhere else in this product a number can be
 * clicked and traced back to a quote, and an unmarked mock here would quietly
 * break that contract.
 */
export default function ApprovalsScreen() {
  const approvals = [
    {
      id: "APP-101",
      prx: "Corrugated Packaging — FY27 Sourcing Event",
      buyer: "Prem Kumar (Packaging Team)",
      value: "₹42,50,000",
      vendor: "Vendor C (Split award with Vendor A)",
      status: "Pending Sign-off",
      date: "2026-09-08",
    },
    {
      id: "APP-098",
      prx: "IT Hardware — Laptop Refresh Q3",
      buyer: "Sarah Jenkins (IT Sourcing)",
      value: "₹18,20,000",
      vendor: "Dell Commercial Direct",
      status: "Approved",
      date: "2026-09-02",
    },
  ];

  return (
    <div className="mx-auto max-w-[1200px] px-8 py-8 space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-[var(--ink)]">RFx Approval Requests</h1>
        <p className="mt-1 text-sm text-[var(--ink-muted)]">
          Review evidence-backed award recommendations requiring executive or category manager sign-off.
        </p>
      </div>

      <div
        className="rounded-lg border px-4 py-3"
        style={{ borderColor: "var(--warning-line)", background: "var(--warning-soft)" }}
      >
        <p className="text-[13px] font-semibold" style={{ color: "var(--warning)" }}>
          <Icon name="alert" size={14} /> Sample data — this screen is not wired up yet
        </p>
        <p className="mt-1 text-[12.5px] leading-relaxed text-[var(--ink-secondary)]">
          There is no approvals record in the database. The rows below are illustrative: the values, buyers and
          suppliers are invented and cannot be traced to a quotation. Every other figure in this product can.
        </p>
      </div>

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
    </div>
  );
}
