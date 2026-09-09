import { USD_TO_INR_RATE } from "@aerchain/shared";
import type { ComparisonDataset } from "../calc/dataset.js";
import { getQuote } from "../calc/engine.js";
import {
  VENDOR_A_LINES,
  VENDOR_B_LINES,
  VENDOR_C_LINES,
  VENDOR_D_LINES,
  VENDOR_E_LINES,
  type GroundTruthLine,
} from "../scripts/data/groundTruth.js";

/**
 * Extraction accuracy, measured against the known ground truth of the generated
 * test documents. This is only possible because we authored those documents —
 * a production deployment has no ground truth, so this is a prototype validation
 * measurement, and it is labelled as such wherever it is displayed.
 *
 * The pipeline never sees this data; it parses the generated files independently.
 */

const GROUND_TRUTH_BY_VENDOR: Record<string, GroundTruthLine[]> = {
  "Vendor A": VENDOR_A_LINES,
  "Vendor B": VENDOR_B_LINES,
  "Vendor C": VENDOR_C_LINES,
  "Vendor D": VENDOR_D_LINES,
  "Vendor E": VENDOR_E_LINES,
};

/** What the normalized per-RFx-unit INR price *should* be for a ground-truth line. */
function expectedNormalizedValue(line: GroundTruthLine): number | null {
  if (!line.quoted || line.price == null) return null;
  const effectivePrice = line.handwrittenOverride ? line.handwrittenOverride.handwrittenPrice : line.price;
  const perUnit = effectivePrice / line.perQuantity;
  const inInr = line.currency === "USD" ? perUnit * USD_TO_INR_RATE.rate : perUnit;
  return Math.round(inInr * 100) / 100;
}

export interface FieldComparison {
  vendorName: string;
  lineItemId: number;
  expected: number | null;
  extracted: number | null;
  correct: boolean;
  note: string | null;
}

export interface VendorAccuracy {
  vendorName: string;
  pricedFieldsExpected: number;
  pricedFieldsCorrect: number;
  priceAccuracy: number | null;
  omissionsExpected: number;
  omissionsCorrectlyDetected: number;
  falselyReportedMissing: number;
}

export interface AccuracyReport {
  overallPriceAccuracy: number | null;
  totalPricedFields: number;
  totalCorrect: number;
  omissionDetectionAccuracy: number | null;
  perVendor: VendorAccuracy[];
  mismatches: FieldComparison[];
  basis: string;
}

/** Prices are compared with a small tolerance to absorb rounding at the last paisa. */
const TOLERANCE = 0.02;

export function measureExtractionAccuracy(dataset: ComparisonDataset): AccuracyReport {
  const perVendor: VendorAccuracy[] = [];
  const mismatches: FieldComparison[] = [];
  let totalPricedFields = 0;
  let totalCorrect = 0;
  let totalOmissions = 0;
  let totalOmissionsDetected = 0;

  for (const vendor of dataset.vendors) {
    const truth = GROUND_TRUTH_BY_VENDOR[vendor.name];
    if (!truth) continue;

    let pricedFieldsExpected = 0;
    let pricedFieldsCorrect = 0;
    let omissionsExpected = 0;
    let omissionsCorrectlyDetected = 0;
    let falselyReportedMissing = 0;

    // Items the vendor's document does not contain at all count as expected omissions.
    const truthById = new Map(truth.map((t) => [t.lineItemId, t]));
    for (const li of dataset.lineItems) {
      const truthLine = truthById.get(li.id);
      const quote = getQuote(dataset, vendor.id, li.id);
      const extractedValue = quote?.status === "not_quoted" ? null : (quote?.normalizedValue ?? null);
      const expected = truthLine ? expectedNormalizedValue(truthLine) : null;

      if (expected == null) {
        // Ground truth says this item was not usably quoted.
        omissionsExpected += 1;
        if (extractedValue == null) {
          omissionsCorrectlyDetected += 1;
        } else {
          mismatches.push({
            vendorName: vendor.name,
            lineItemId: li.id,
            expected: null,
            extracted: extractedValue,
            correct: false,
            note: "Item was not usably quoted in the document, but a price was extracted.",
          });
        }
        continue;
      }

      pricedFieldsExpected += 1;
      if (extractedValue == null) {
        falselyReportedMissing += 1;
        mismatches.push({
          vendorName: vendor.name,
          lineItemId: li.id,
          expected,
          extracted: null,
          correct: false,
          note: "Document contains a price but the pipeline did not produce a comparable value.",
        });
        continue;
      }
      const correct = Math.abs(extractedValue - expected) <= TOLERANCE;
      if (correct) {
        pricedFieldsCorrect += 1;
      } else {
        mismatches.push({
          vendorName: vendor.name,
          lineItemId: li.id,
          expected,
          extracted: extractedValue,
          correct: false,
          note: "Normalized value differs from ground truth.",
        });
      }
    }

    totalPricedFields += pricedFieldsExpected;
    totalCorrect += pricedFieldsCorrect;
    totalOmissions += omissionsExpected;
    totalOmissionsDetected += omissionsCorrectlyDetected;

    perVendor.push({
      vendorName: vendor.name,
      pricedFieldsExpected,
      pricedFieldsCorrect,
      priceAccuracy: pricedFieldsExpected > 0 ? pricedFieldsCorrect / pricedFieldsExpected : null,
      omissionsExpected,
      omissionsCorrectlyDetected,
      falselyReportedMissing,
    });
  }

  return {
    overallPriceAccuracy: totalPricedFields > 0 ? totalCorrect / totalPricedFields : null,
    totalPricedFields,
    totalCorrect,
    omissionDetectionAccuracy: totalOmissions > 0 ? totalOmissionsDetected / totalOmissions : null,
    perVendor,
    mismatches,
    basis:
      "Measured by comparing every normalized price against the known ground truth of the generated vendor documents. " +
      "The extraction pipeline never reads that ground truth.",
  };
}
