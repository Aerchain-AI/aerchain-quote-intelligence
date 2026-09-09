import fs from "node:fs/promises";
import path from "node:path";
import { prisma } from "../db.js";
import { REPO_ROOT, VENDOR_DOCS_DIR } from "../paths.js";

/**
 * Loads a prepared dataset from data/import into an empty database.
 *
 * Everything is validated before anything is written. A dataset with a typo in
 * the last file leaves the database untouched rather than three-quarters
 * populated — which is the state that wastes an afternoon, because it looks like
 * it worked.
 *
 * See docs/DATA-TEMPLATE.md for the shape of each file.
 */

const IMPORT_DIR = path.join(REPO_ROOT, "data", "import");
const QUOTES_DIR = path.join(IMPORT_DIR, "quotes");

const QUOTE_FORMATS: Record<string, string> = {
  ".xlsx": "xlsx",
  ".xls": "xlsx",
  ".pdf": "pdf",
  ".docx": "docx",
  ".doc": "docx",
  ".jpg": "jpg",
  ".jpeg": "jpg",
  ".png": "jpg",
  ".txt": "txt",
  ".csv": "txt",
};

const PLACEHOLDER = /^(vendor|supplier|untitled|document|file|replace me|new vendor)/i;

interface BuyerInput {
  name: string;
  email: string;
  team: string;
  role?: string;
  avatar?: string;
  pin?: string;
}

interface SupplierInput {
  name: string;
  email: string;
  category: string;
  pastWork?: string;
  eventsInvited?: number;
  eventsQuoted?: number;
  eventsAwarded?: number;
  avgResponseDays?: number;
  onTimeDeliveryPct?: number;
  qualityScore?: number;
  lastEngagedAt?: string;
  isNew?: boolean;
}

interface LineItemInput {
  name: string;
  specification?: string;
  quantity: number;
  unit: string;
}

interface EventInput {
  name: string;
  category: string;
  description: string;
  currency: string;
  requiredByDate: string;
  status: string;
  buyerEmail: string;
  lineItems: LineItemInput[];
  invitedSupplierEmails?: string[];
}

interface QuoteInput {
  supplierEmail: string;
  eventName: string;
}

const problems: string[] = [];
function require_(condition: unknown, message: string): void {
  if (!condition) problems.push(message);
}

async function readJson<T>(file: string, fallback: T): Promise<T> {
  try {
    return JSON.parse(await fs.readFile(path.join(IMPORT_DIR, file), "utf8")) as T;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return fallback;
    problems.push(`${file} is not valid JSON: ${(err as Error).message}`);
    return fallback;
  }
}

function isDate(value: string | undefined): boolean {
  return !!value && /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(value));
}

async function main() {
  const existing = await prisma.rfx.count();
  const force = process.argv.includes("--force");
  if (existing > 0 && !force) {
    console.error(
      `The database already holds ${existing} event(s). Importing on top would duplicate them.\n` +
        "Wipe it first, or pass --force if you really mean to add to what is there.",
    );
    process.exitCode = 1;
    return;
  }

  const buyers = await readJson<BuyerInput[]>("buyers.json", []);
  const suppliers = await readJson<SupplierInput[]>("suppliers.json", []);
  const events = await readJson<EventInput[]>("events.json", []);
  const quotes = await readJson<QuoteInput[]>("quotes/manifest.json", []);

  // ------------------------------------------------------------- validation

  require_(buyers.length > 0, "buyers.json is empty — at least one buyer is needed to raise an event.");
  require_(events.length > 0, "events.json is empty — there is nothing to import.");

  const buyerEmails = new Set<string>();
  buyers.forEach((b, i) => {
    require_(b.name?.trim(), `buyers[${i}] has no name.`);
    require_(b.email?.includes("@"), `buyers[${i}] ("${b.name}") has no valid email.`);
    require_(b.team?.trim(), `buyers[${i}] ("${b.name}") has no team.`);
    require_(!buyerEmails.has(b.email), `buyers[${i}] repeats the email ${b.email}. Emails must be unique.`);
    require_(!b.pin || /^\d{4}$/.test(b.pin), `buyers[${i}] ("${b.name}") has a PIN that is not four digits.`);
    buyerEmails.add(b.email);
  });

  const supplierEmails = new Set<string>();
  const categories = new Set<string>();
  suppliers.forEach((s, i) => {
    require_(s.name?.trim(), `suppliers[${i}] has no name.`);
    require_(
      !PLACEHOLDER.test(s.name ?? ""),
      `suppliers[${i}] is named "${s.name}". Use the real company name — it labels their column in the comparison and appears in the award recommendation.`,
    );
    require_(s.email?.includes("@"), `suppliers[${i}] ("${s.name}") has no valid email.`);
    require_(!supplierEmails.has(s.email), `suppliers[${i}] repeats the email ${s.email}. Emails must be unique.`);
    require_(s.category?.trim(), `suppliers[${i}] ("${s.name}") has no category.`);
    require_(
      s.qualityScore == null || (s.qualityScore >= 0 && s.qualityScore <= 1),
      `suppliers[${i}] ("${s.name}") has qualityScore ${s.qualityScore}. It is a 0-1 fraction, not a percentage.`,
    );
    require_(
      s.onTimeDeliveryPct == null || (s.onTimeDeliveryPct >= 0 && s.onTimeDeliveryPct <= 100),
      `suppliers[${i}] ("${s.name}") has onTimeDeliveryPct ${s.onTimeDeliveryPct}, outside 0-100.`,
    );
    require_(
      (s.eventsQuoted ?? 0) <= (s.eventsInvited ?? 0),
      `suppliers[${i}] ("${s.name}") quoted more events than it was invited to.`,
    );
    require_(
      (s.eventsAwarded ?? 0) <= (s.eventsQuoted ?? 0),
      `suppliers[${i}] ("${s.name}") won more events than it quoted for.`,
    );
    require_(
      !s.lastEngagedAt || isDate(s.lastEngagedAt),
      `suppliers[${i}] ("${s.name}") has lastEngagedAt "${s.lastEngagedAt}". Use YYYY-MM-DD.`,
    );
    supplierEmails.add(s.email);
    if (s.category) categories.add(s.category);
  });

  const eventNames = new Set<string>();
  events.forEach((e, i) => {
    require_(e.name?.trim(), `events[${i}] has no name.`);
    require_(
      !PLACEHOLDER.test(e.name ?? ""),
      `events[${i}] is still named "${e.name}" — replace the template placeholder.`,
    );
    require_(!eventNames.has(e.name), `events[${i}] repeats the name "${e.name}". Names must be distinctive.`);
    require_(e.description?.trim(), `events[${i}] ("${e.name}") has no description — it goes into the RFQ document.`);
    require_(["INR", "USD"].includes(e.currency), `events[${i}] ("${e.name}") has currency "${e.currency}". Use INR or USD.`);
    require_(isDate(e.requiredByDate), `events[${i}] ("${e.name}") has requiredByDate "${e.requiredByDate}". Use YYYY-MM-DD.`);
    require_(
      ["draft", "active", "awarded"].includes(e.status),
      `events[${i}] ("${e.name}") has status "${e.status}". Use draft, active or awarded.`,
    );
    require_(buyerEmails.has(e.buyerEmail), `events[${i}] ("${e.name}") names buyer ${e.buyerEmail}, who is not in buyers.json.`);
    require_(
      Array.isArray(e.lineItems) && e.lineItems.length > 0,
      `events[${i}] ("${e.name}") has no line items.`,
    );
    require_(
      !e.category || categories.size === 0 || categories.has(e.category),
      `events[${i}] ("${e.name}") is in category "${e.category}", which no supplier matches. They will not be offered when you issue it.`,
    );
    (e.lineItems ?? []).forEach((li, j) => {
      require_(li.name?.trim(), `events[${i}].lineItems[${j}] has no name.`);
      require_(
        typeof li.quantity === "number" && li.quantity > 0,
        `events[${i}].lineItems[${j}] ("${li.name}") has quantity ${li.quantity}. It must be a positive number.`,
      );
      require_(li.unit?.trim(), `events[${i}].lineItems[${j}] ("${li.name}") has no unit.`);
    });
    for (const email of e.invitedSupplierEmails ?? []) {
      require_(
        supplierEmails.has(email),
        `events[${i}] ("${e.name}") invites ${email}, who is not in suppliers.json.`,
      );
    }
    eventNames.add(e.name);
  });

  // Quote files, matched to the manifest by filename.
  let quoteFiles: string[] = [];
  try {
    quoteFiles = (await fs.readdir(QUOTES_DIR)).filter((f) => f !== "manifest.json");
  } catch {
    quoteFiles = [];
  }
  const resolvedQuotes: Array<QuoteInput & { file: string; format: string }> = [];
  quotes.forEach((q, i) => {
    require_(supplierEmails.has(q.supplierEmail), `quotes/manifest.json[${i}] names ${q.supplierEmail}, who is not in suppliers.json.`);
    require_(eventNames.has(q.eventName), `quotes/manifest.json[${i}] names event "${q.eventName}", which is not in events.json.`);
    const match = quoteFiles.find((f) => path.parse(f).name.toLowerCase() === q.supplierEmail.toLowerCase());
    if (!match) {
      problems.push(
        `quotes/manifest.json[${i}] expects a file named "${q.supplierEmail}.<ext>" in data/import/quotes — none found.`,
      );
      return;
    }
    const format = QUOTE_FORMATS[path.extname(match).toLowerCase()];
    if (!format) {
      problems.push(`quotes/${match} has an unsupported extension. Use xlsx, pdf, docx, jpg, png, txt or csv.`);
      return;
    }
    resolvedQuotes.push({ ...q, file: match, format });
  });

  if (problems.length > 0) {
    console.error(`\n${problems.length} problem(s) — nothing was written:\n`);
    for (const p of problems) console.error(`  - ${p}`);
    console.error("\nSee docs/DATA-TEMPLATE.md for the expected shape.");
    process.exitCode = 1;
    return;
  }

  // ---------------------------------------------------------------- writing

  const buyerByEmail = new Map<string, string>();
  for (const b of buyers) {
    const row = await prisma.buyer.upsert({
      where: { email: b.email },
      create: { name: b.name, email: b.email, team: b.team },
      update: { name: b.name, team: b.team },
    });
    buyerByEmail.set(b.email, row.id);
  }

  const supplierByEmail = new Map<string, string>();
  for (const s of suppliers) {
    const row = await prisma.supplier.upsert({
      where: { email: s.email },
      create: {
        name: s.name,
        email: s.email,
        category: s.category,
        pastWork: s.pastWork ?? null,
        eventsInvited: s.eventsInvited ?? 0,
        eventsQuoted: s.eventsQuoted ?? 0,
        eventsAwarded: s.eventsAwarded ?? 0,
        avgResponseDays: s.avgResponseDays ?? null,
        onTimeDeliveryPct: s.onTimeDeliveryPct ?? null,
        qualityScore: s.qualityScore ?? null,
        lastEngagedAt: s.lastEngagedAt ? new Date(s.lastEngagedAt) : null,
        isNew: s.isNew ?? false,
      },
      update: {},
    });
    supplierByEmail.set(s.email, row.id);
  }

  // LineItem.id is a plain integer primary key with no default — it was designed
  // around a single 30-item event. Importing several means allocating ids that
  // are unique across all of them, so they run on from wherever the table ends.
  // The first event in events.json therefore gets 1..N, which is why the one you
  // plan to demo should be listed first.
  let nextLineItemId = ((await prisma.lineItem.aggregate({ _max: { id: true } }))._max.id ?? 0) + 1;

  const eventByName = new Map<string, string>();
  for (const e of events) {
    const rfx = await prisma.rfx.create({
      data: {
        name: e.name,
        category: e.category,
        description: e.description,
        currency: e.currency,
        requiredByDate: new Date(e.requiredByDate),
        status: e.status,
        buyerId: buyerByEmail.get(e.buyerEmail)!,
        issuedAt: (e.invitedSupplierEmails?.length ?? 0) > 0 ? new Date() : null,
        lineItems: {
          create: e.lineItems.map((li) => ({
            id: nextLineItemId++,
            name: li.name,
            specification: li.specification ?? "",
            quantity: li.quantity,
            unit: li.unit,
          })),
        },
      },
    });
    eventByName.set(e.name, rfx.id);

    for (const email of e.invitedSupplierEmails ?? []) {
      await prisma.rfxInvitation.create({
        data: {
          rfxId: rfx.id,
          supplierId: supplierByEmail.get(email)!,
          email,
          emailSubject: `Request for Quotation — ${e.name}`,
          emailBody: "Imported with the dataset. Regenerate a real draft from the Send flow.",
        },
      });
    }

    await prisma.rfxEvent.create({
      data: {
        rfxId: rfx.id,
        type: "created",
        title: "Event created",
        detail: e.description.slice(0, 160),
        occurredAt: new Date(),
      },
    });
  }

  // Quotation documents become vendor response rows, ready but not extracted.
  await fs.mkdir(VENDOR_DOCS_DIR, { recursive: true });
  for (const q of resolvedQuotes) {
    const supplier = suppliers.find((s) => s.email === q.supplierEmail)!;
    const vendor = await prisma.vendor.create({
      data: {
        rfxId: eventByName.get(q.eventName)!,
        name: supplier.name,
        responseFormat: q.format,
        filePath: "",
        status: "pending",
      },
    });
    const ext = path.extname(q.file);
    const destination = path.join(VENDOR_DOCS_DIR, `vendor-${vendor.id}${ext}`);
    await fs.copyFile(path.join(QUOTES_DIR, q.file), destination);
    await prisma.vendor.update({ where: { id: vendor.id }, data: { filePath: destination } });
  }

  const lineItemCount = events.reduce((sum, e) => sum + e.lineItems.length, 0);
  console.log("Imported:");
  console.log(`  ${buyers.length} buyer(s)`);
  console.log(`  ${suppliers.length} supplier(s) across ${categories.size} categor(ies)`);
  console.log(`  ${events.length} event(s), ${lineItemCount} line item(s)`);
  console.log(`  ${resolvedQuotes.length} quotation(s) attached, none extracted yet`);
  if (resolvedQuotes.length > 0) {
    console.log(`\nNext: npm run pipeline:demo   (one API call per quotation)`);
  }
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
