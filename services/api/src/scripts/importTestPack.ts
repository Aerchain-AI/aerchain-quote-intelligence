import fs from "node:fs/promises";
import path from "node:path";
import { prisma } from "../db.js";
import { REPO_ROOT, VENDOR_DOCS_DIR } from "../paths.js";

/**
 * Loads the RFX-2026-091 test pack from data/testpack.
 *
 * The pack is a supplier master, a verification register, procurement history,
 * the RFx itself and five vendor responses in five formats. This script maps it
 * onto the schema and stops there: the quotation documents become vendor
 * response rows with their files in place, and nothing is extracted. Extraction
 * costs an API call per document and is a separate, deliberate step.
 *
 * Two things it does not invent:
 *
 * The pack carries no email addresses, and a supplier's address is what matches
 * an emailed reply back to an event. One is derived per supplier from the
 * company name against a placeholder domain, and every derived address is
 * printed at the end so it is obvious which ones are real and which are not.
 *
 * The historical award values and savings arrived as a record. They are stored
 * as such, in their own table, and never mixed with the figures this system
 * computes and can show its working for.
 */

const PACK_DIR = path.join(REPO_ROOT, "data", "testpack");

interface RfxDoc {
  rfx_id: string;
  title: string;
  request: string;
  created: string;
  required_by: string;
  delivery_location: string;
  currency: string;
  response_deadline?: string;
  line_items: Array<{ line_no: number; item: string; specification: string; quantity: number; unit: string }>;
}

interface CompletedProcurement {
  event_id: string;
  title: string;
  category: string;
  completed_date: string;
  awarded_vendor_id: string;
  awarded_vendor: string;
  award_value_inr: number;
  baseline_inr: number;
  savings_inr: number;
  savings_pct: number;
}

/** Minimal CSV reader. The pack has no quoted fields or embedded commas. */
function parseCsv(text: string): Array<Record<string, string>> {
  const lines = text.trim().split(/\r?\n/).filter(Boolean);
  const headers = lines[0].split(",").map((h) => h.trim());
  return lines.slice(1).map((line) => {
    const cells = line.split(",").map((c) => c.trim());
    return Object.fromEntries(headers.map((h, i) => [h, cells[i] ?? ""]));
  });
}

/** The pack has no addresses. Derived, and reported as derived. */
function derivedEmail(vendorName: string): string {
  const slug = vendorName
    .toLowerCase()
    .replace(/\b(pvt|ltd|limited|india|solutions|industries|packaging|supplies|indl?|inc)\b/g, "")
    .replace(/[^a-z0-9]+/g, "")
    .slice(0, 22);
  return `sales@${slug || "supplier"}.example`;
}

/** verification_status in the master is free text; the schema wants a token. */
function verificationToken(status: string): string {
  const s = status.toLowerCase();
  if (s.includes("pending")) return "pending";
  if (s.includes("verif")) return "verified";
  return "unverified";
}

const RESPONSE_FILES: Array<{ vendorId: string; file: string; format: string }> = [
  { vendorId: "V001", file: "Vendor_V001_Corrupack.pdf", format: "pdf" },
  { vendorId: "V002", file: "Vendor_V002_Deccan.docx", format: "docx" },
  { vendorId: "V003", file: "Vendor_V003_SouthBox.xlsx", format: "xlsx" },
  { vendorId: "V004", file: "Vendor_V004_MetroPack.txt", format: "txt" },
  { vendorId: "V005", file: "Vendor_V005_GreenWrap_photo.jpg", format: "jpg" },
];

async function main() {
  const force = process.argv.includes("--force");
  const existing = await prisma.rfx.count();
  if (existing > 0 && !force) {
    console.error(`The database already holds ${existing} event(s). Run "npm run db:wipe" first, or pass --force.`);
    process.exitCode = 1;
    return;
  }

  const read = async (file: string) => fs.readFile(path.join(PACK_DIR, file), "utf8");

  const master = parseCsv(await read("vendor_master.csv"));
  const verification = parseCsv(await read("vendor_verification.csv"));
  const history = parseCsv(await read("vendor_procurement_history.csv"));
  const completed = JSON.parse(await read("completed_procurements.json")) as CompletedProcurement[];
  const rfxDoc = JSON.parse(await read("RFX-2026-091.json")) as RfxDoc;

  // ------------------------------------------------------------------ buyer
  const buyer = await prisma.buyer.upsert({
    where: { email: "priya.sharma@aerchain.example" },
    create: { name: "Priya Sharma", email: "priya.sharma@aerchain.example", team: "Packaging Procurement" },
    update: {},
  });

  // -------------------------------------------------------------- suppliers
  const verificationById = new Map(verification.map((v) => [v.vendor_id, v]));
  const supplierByVendorId = new Map<string, string>();
  const derivedAddresses: Array<[string, string]> = [];

  for (const row of master) {
    const email = derivedEmail(row.vendor_name);
    derivedAddresses.push([row.vendor_name, email]);
    const check = verificationById.get(row.vendor_id);
    const supplier = await prisma.supplier.upsert({
      where: { email },
      create: {
        name: row.vendor_name,
        email,
        category: rfxDoc.title.includes("Corrugated") ? "Corrugated Packaging" : "Packaging",
        city: row.city || null,
        gstin: row.gstin || null,
        verificationStatus: verificationToken(row.verification_status),
        verificationNote: check?.verification_evidence || null,
        paymentTerms: row.payment_terms || null,
        // Track record is derived from the history file below, not asserted here.
        isNew: (check?.history ?? "").toLowerCase().includes("no completed"),
      },
      update: {},
    });
    supplierByVendorId.set(row.vendor_id, supplier.id);
  }

  // ------------------------------------------------------- past procurements
  const procurementByExternalId = new Map<string, string>();
  for (const c of completed) {
    const row = await prisma.pastProcurement.upsert({
      where: { externalId: c.event_id },
      create: {
        externalId: c.event_id,
        title: c.title,
        category: c.category,
        completedAt: new Date(c.completed_date),
        awardedSupplierId: supplierByVendorId.get(c.awarded_vendor_id) ?? null,
        awardedVendorName: c.awarded_vendor,
        awardValueInr: c.award_value_inr,
        baselineInr: c.baseline_inr ?? null,
        savingsInr: c.savings_inr ?? null,
        savingsPct: c.savings_pct ?? null,
        source: "Imported historical record — supplied, not computed by this system",
      },
      update: {},
    });
    procurementByExternalId.set(c.event_id, row.id);
  }

  for (const h of history) {
    const supplierId = supplierByVendorId.get(h.vendor_id);
    const procurementId = procurementByExternalId.get(h.event_id);
    if (!supplierId || !procurementId) continue;
    await prisma.pastParticipation.upsert({
      where: { supplierId_procurementId: { supplierId, procurementId } },
      create: {
        supplierId,
        procurementId,
        result: h.result.toLowerCase().startsWith("awarded") ? "awarded" : "participated",
        performance: h.performance || null,
        qualityIncidents: Number(h.quality_incidents ?? 0) || 0,
      },
      update: {},
    });
  }

  // Track record counted from the records, rather than taken on assertion.
  for (const [vendorId, supplierId] of supplierByVendorId) {
    const rows = history.filter((h) => h.vendor_id === vendorId);
    const awarded = rows.filter((h) => h.result.toLowerCase().startsWith("awarded")).length;
    const incidents = rows.reduce((s, h) => s + (Number(h.quality_incidents) || 0), 0);
    await prisma.supplier.update({
      where: { id: supplierId },
      data: {
        eventsInvited: rows.length,
        eventsQuoted: rows.length,
        eventsAwarded: awarded,
        // Every recorded delivery in this pack was on time and incident-free.
        // Left null where there is no record at all rather than defaulted to a
        // flattering number.
        onTimeDeliveryPct: rows.length > 0 ? 100 : null,
        qualityScore: rows.length > 0 && incidents === 0 ? 0.9 : rows.length > 0 ? 0.7 : null,
        lastEngagedAt: rows.length > 0 ? new Date("2026-04-22") : null,
        pastWork:
          rows.length > 0
            ? `${awarded} award(s) and ${rows.length - awarded} unsuccessful bid(s) on record, ${incidents} quality incident(s).`
            : "No completed procurement on record.",
      },
    });
  }

  // -------------------------------------------------------------------- rfx
  const rfx = await prisma.rfx.create({
    data: {
      name: `${rfxDoc.title} (${rfxDoc.rfx_id})`,
      category: "Corrugated Packaging",
      description: `${rfxDoc.request}. Delivery to ${rfxDoc.delivery_location}. Responses due ${rfxDoc.response_deadline ?? "as advised"}. ${rfxDoc.currency}.`,
      currency: "INR",
      requiredByDate: new Date(rfxDoc.required_by),
      status: "active",
      buyerId: buyer.id,
      issuedAt: new Date(rfxDoc.created),
      sourceRequest: rfxDoc.request,
      lineItems: {
        create: rfxDoc.line_items.map((li) => ({
          id: li.line_no,
          name: li.item,
          specification: li.specification ?? "",
          quantity: li.quantity,
          unit: li.unit,
        })),
      },
    },
  });

  await prisma.rfxEvent.create({
    data: {
      rfxId: rfx.id,
      type: "created",
      title: `${rfxDoc.rfx_id} raised`,
      detail: rfxDoc.request,
      actor: buyer.name,
      occurredAt: new Date(rfxDoc.created),
    },
  });

  // Everyone who responded was invited. V006 is on the master but did not
  // respond to this event, so it stays in the registry and off this invitation
  // list rather than appearing as a silent non-responder.
  const respondingVendorIds = new Set(RESPONSE_FILES.map((r) => r.vendorId));
  for (const [vendorId, supplierId] of supplierByVendorId) {
    if (!respondingVendorIds.has(vendorId)) continue;
    const supplier = await prisma.supplier.findUniqueOrThrow({ where: { id: supplierId } });
    await prisma.rfxInvitation.create({
      data: {
        rfxId: rfx.id,
        supplierId,
        email: supplier.email,
        emailSubject: `Request for Quotation — ${rfxDoc.title}`,
        emailBody: `Imported with the ${rfxDoc.rfx_id} test pack.`,
        status: "responded",
        respondedAt: new Date(rfxDoc.created),
      },
    });
  }

  // ------------------------------------------------------- vendor responses
  await fs.mkdir(VENDOR_DOCS_DIR, { recursive: true });
  let attached = 0;
  for (const r of RESPONSE_FILES) {
    const supplierId = supplierByVendorId.get(r.vendorId);
    if (!supplierId) {
      console.warn(`  ${r.vendorId} is not on the supplier master — skipping its response.`);
      continue;
    }
    const supplier = await prisma.supplier.findUniqueOrThrow({ where: { id: supplierId } });
    const source = path.join(PACK_DIR, r.file);
    try {
      await fs.access(source);
    } catch {
      console.warn(`  ${r.file} is missing from data/testpack — skipping.`);
      continue;
    }

    const vendor = await prisma.vendor.create({
      data: { rfxId: rfx.id, name: supplier.name, responseFormat: r.format, filePath: "", status: "pending" },
    });
    const destination = path.join(VENDOR_DOCS_DIR, `vendor-${vendor.id}${path.extname(r.file)}`);
    await fs.copyFile(source, destination);
    await prisma.vendor.update({ where: { id: vendor.id }, data: { filePath: destination } });
    attached += 1;
  }

  // ------------------------------------------------------------------ report
  console.log(`\n${rfxDoc.rfx_id} — ${rfxDoc.title}`);
  console.log(`  buyer            ${buyer.name}`);
  console.log(`  line items       ${rfxDoc.line_items.length}`);
  console.log(`  suppliers        ${master.length} on the master`);
  console.log(`  invited          ${respondingVendorIds.size}`);
  console.log(`  responses        ${attached} attached, none extracted yet`);
  console.log(`  past procurement ${completed.length} record(s), ${history.length} participation row(s)`);

  const pending = master.filter((m) => verificationToken(m.verification_status) === "pending");
  if (pending.length > 0) {
    console.log(`\n  Pending verification: ${pending.map((p) => p.vendor_name).join(", ")}`);
  }

  console.log("\n  Email addresses are not in the pack, so these were derived:");
  for (const [name, email] of derivedAddresses) {
    console.log(`    ${name.padEnd(32)} ${email}`);
  }

  console.log("\nNext: npm run pipeline:demo   (one API call per response, five in total)");
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
