import { prisma } from "../db.js";
import { convertToBaseCurrency, parseSourceUnit } from "../pipeline/normalize.js";

/**
 * Re-applies the deterministic validation rules to already-extracted rows.
 *
 * This exists because validation rules can change after extraction has run, and
 * re-extracting to pick up a rule change would be wasteful (and, on a rate-limited
 * key, sometimes impossible). Nothing here re-reads a document or invents a value:
 * it only recomputes status from data already stored.
 */
/**
 * Re-normalises quotes whose unit basis the rules now read differently.
 *
 * Only the rows a rule change actually affects are touched, and only from data
 * already stored: the source value, its currency, and the adjustments parsed at
 * extraction time. Nothing re-reads a document and nothing calls the model, so a
 * rule can be corrected without spending a request or waiting on the service.
 */
async function renormaliseUnits(): Promise<number> {
  const quotes = await prisma.vendorQuote.findMany({ include: { lineItem: true } });
  let fixed = 0;

  for (const q of quotes) {
    if (q.status === "not_quoted" || q.sourceValue == null || q.sourceCurrency == null) continue;
    const parsed = parseSourceUnit(q.sourceUnit, q.lineItem.unit);
    // Already usable, or still genuinely unconvertible — leave it alone.
    if (!parsed.recognized) continue;
    if (q.normalizedValue != null) continue;

    const { value: inBase, fxRateUsed } = convertToBaseCurrency(
      q.sourceValue,
      q.sourceCurrency as "INR" | "USD",
      "INR",
    );
    const normalizedValue = Math.round((inBase / parsed.factor) * 100) / 100;

    // Adjustments are re-applied from the objects extraction already parsed, on
    // the same terms normalizeQuote uses: only when the basis matches the line.
    const parseJson = (raw: string | null) => {
      if (!raw) return null;
      try {
        return JSON.parse(raw) as { amount: number; unit: string };
      } catch {
        return null;
      }
    };
    const isPct = (a: { unit: string } | null) => !!a && a.unit.includes("%");
    const matchesUnit = (a: { unit: string } | null) => !!a && a.unit.toLowerCase().includes(q.lineItem.unit.toLowerCase());

    const freight = parseJson(q.freightJson);
    const tax = parseJson(q.taxJson);
    const discount = parseJson(q.discountJson);

    let evaluated = normalizedValue;
    if (freight && !isPct(freight) && matchesUnit(freight)) evaluated += freight.amount;
    if (tax) evaluated += isPct(tax) ? evaluated * (tax.amount / 100) : matchesUnit(tax) ? tax.amount : 0;
    if (discount) {
      evaluated -= isPct(discount) ? evaluated * (discount.amount / 100) : matchesUnit(discount) ? discount.amount : 0;
    }

    await prisma.vendorQuote.update({
      where: { id: q.id },
      data: {
        normalizedValue,
        evaluatedValue: Math.round(evaluated * 100) / 100,
        fxRateJson: fxRateUsed ? JSON.stringify(fxRateUsed) : q.fxRateJson,
      },
    });

    // The old flag said the unit could not be reconciled. It can now, so it goes;
    // where the basis was assumed rather than read, validate re-adds a disclosure.
    await prisma.quoteException.deleteMany({
      where: { vendorId: q.vendorId, lineItemId: q.lineItemId, type: "different_unit" },
    });
    if (parsed.assumed) {
      await prisma.quoteException.create({
        data: {
          vendorId: q.vendorId,
          lineItemId: q.lineItemId,
          type: "different_unit",
          message: `No unit stated against this line. Read as a rate per ${q.lineItem.unit}, matching the RFx — confirm if the vendor priced on another basis.`,
          severity: "info",
        },
      });
    }
    fixed += 1;
  }
  return fixed;
}

async function main() {
  const renormalised = await renormaliseUnits();
  console.log(
    renormalised === 0
      ? "No quotes needed re-normalising."
      : `Re-normalised ${renormalised} quote(s) whose unit basis the rules now read.`,
  );

  // Unit recognition first: the rules learned that "per unit" and "each" name no
  // unit of their own and inherit the RFx's, so rows flagged under the older
  // rule are re-checked. The stored values do not move — an unrecognised unit
  // already used a factor of 1 — only the flag and the exception clear.
  const unitFlags = await prisma.quoteException.findMany({ where: { type: "different_unit" } });
  let unitCleared = 0;
  for (const flag of unitFlags) {
    if (flag.lineItemId == null) continue;
    const quote = await prisma.vendorQuote.findFirst({
      where: { vendorId: flag.vendorId, lineItemId: flag.lineItemId },
    });
    const lineItem = await prisma.lineItem.findUnique({ where: { id: flag.lineItemId } });
    if (!quote || !lineItem) continue;
    const parsed = parseSourceUnit(quote.sourceUnit, lineItem.unit);
    if (!parsed.recognized || parsed.factor !== 1) continue;
    await prisma.quoteException.delete({ where: { id: flag.id } });
    unitCleared += 1;
  }
  console.log(
    unitCleared === 0
      ? "No unit flags to clear."
      : `Cleared ${unitCleared} unit flag(s) whose source unit is now recognised as the RFx unit.`,
  );

  const quotes = await prisma.vendorQuote.findMany();
  const exceptions = await prisma.quoteException.findMany({ where: { type: "ambiguous_value" } });

  const ambiguousKeys = new Set(exceptions.filter((e) => e.lineItemId != null).map((e) => `${e.vendorId}:${e.lineItemId}`));

  let updated = 0;
  for (const q of quotes) {
    if (q.status === "not_quoted") continue;
    const isAmbiguous = ambiguousKeys.has(`${q.vendorId}:${q.lineItemId}`);
    const isLowConfidence = q.confidenceLevel === "low";
    const expected = isLowConfidence || isAmbiguous ? "flagged" : "verified";
    if (q.status !== expected) {
      await prisma.vendorQuote.update({ where: { id: q.id }, data: { status: expected } });
      updated += 1;
    }
  }
  console.log(updated === 0 ? "All quote statuses already consistent." : `Updated ${updated} quote status(es).`);
}

main()
  .catch((err) => {
    console.error("Re-validation failed:", err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
