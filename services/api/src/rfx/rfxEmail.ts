import { prisma } from "../db.js";

/**
 * Composes the RFx invitation email.
 *
 * Built deterministically from the stored event rather than generated, for the
 * same reason the comparison numbers are: this email is the commercial
 * instruction a supplier will quote against. It must say exactly what the RFx
 * says — every line item, every agreed term — with nothing softened, invented or
 * paraphrased. It also costs no quota and reads identically every time.
 *
 * The buyer can still edit the text before it goes out; this is the starting draft.
 */

export interface ComposedEmail {
  subject: string;
  body: string;
  /** Shown above the preview so the buyer knows what the supplier will receive. */
  lineItemCount: number;
  hasCommercialTerms: boolean;
}

function formatDate(d: Date): string {
  return d.toLocaleDateString("en-IN", { day: "numeric", month: "long", year: "numeric" });
}

export async function composeRfxEmail(rfxId: string): Promise<ComposedEmail> {
  const rfx = await prisma.rfx.findUniqueOrThrow({
    where: { id: rfxId },
    include: { lineItems: { orderBy: { id: "asc" } }, buyer: true },
  });

  let clarifications: Array<{ question: string; answer: string }> = [];
  if (rfx.clarificationsJson) {
    try {
      clarifications = JSON.parse(rfx.clarificationsJson);
    } catch {
      clarifications = [];
    }
  }
  // Only terms the buyer actually settled — never pad the email with "Not specified".
  const settledTerms = clarifications.filter(
    (c) => c.answer && c.answer.trim() && c.answer.trim().toLowerCase() !== "not specified",
  );

  const subject = `Request for Quotation — ${rfx.name}`;

  const itemRows = rfx.lineItems
    .map(
      (li, i) =>
        `${String(i + 1).padStart(3, " ")}. ${li.name}` +
        (li.specification ? `\n     Specification: ${li.specification}` : "") +
        `\n     Quantity: ${li.quantity.toLocaleString("en-IN")} ${li.unit}`,
    )
    .join("\n\n");

  const termsBlock = settledTerms.length
    ? settledTerms.map((c) => `- ${c.question}\n  ${c.answer}`).join("\n")
    : "- No additional commercial conditions were specified beyond those stated above.";

  const body = `Dear Supplier,

We invite you to submit a quotation for the requirement set out below.

SOURCING EVENT
${rfx.name}
Category: ${rfx.category}
Quotation currency: ${rfx.currency}
Required by: ${formatDate(rfx.requiredByDate)}

SCOPE
${rfx.description}

LINE ITEMS (${rfx.lineItems.length})
${itemRows}

COMMERCIAL CONDITIONS
${termsBlock}

ATTACHED
1. RFQ document (PDF) — the formal requirement, terms and evaluation basis.
2. Pricing template (Excel) — line items pre-filled, price columns blank, plus the
   supplier questionnaire on the second sheet.

WHAT WE NEED FROM YOU
1. A unit price for every line item, quoted in ${rfx.currency}, using the attached template.
   If you cannot supply an item, mark it "not quoted" rather than deleting the row — an
   omitted line is read as no quote, not as zero cost.
2. State clearly whether freight and taxes are included in your unit prices or charged separately.
3. Note any minimum order quantities, lead times or validity periods that apply.
4. Complete the supplier questionnaire on the second sheet of the template.

Returning the completed template gives you the fastest and most accurate evaluation. If it does
not suit your systems, we will still accept a quotation in your own format — spreadsheet, PDF,
Word or plain email — provided prices are per unit and clearly attributable to the line items above.

If any part of this requirement is unclear, reply to this email before quoting rather than
making an assumption.

Regards,
${rfx.buyer?.name ?? "Procurement"}
${rfx.buyer?.team ?? "Procurement Team"}`;

  return {
    subject,
    body,
    lineItemCount: rfx.lineItems.length,
    hasCommercialTerms: settledTerms.length > 0,
  };
}
