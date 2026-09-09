import fs from "node:fs/promises";
import path from "node:path";
import { prisma } from "../db.js";
import { replyTokenFor } from "../inbox/match.js";
import { REPO_ROOT } from "../paths.js";

/**
 * Authors the sample inbox.
 *
 * These are real MIME messages with real base64 attachments, written to
 * `data/inbound-samples/*.eml` and parsed by the same library that parses live
 * IMAP mail. Nothing about the ingestion path is simulated — only the mailbox
 * connection is.
 *
 * Each message exercises a different branch of the matcher, including the two
 * that deliberately refuse to act:
 *
 *   01  reply token in the To address        exact    → filed and attached
 *   02  invited sender, no token             high     → filed and attached
 *   03  subject names the event, unknown sender  medium → held for confirmation
 *   04  sender invited nowhere               (none)   → unmatched tray
 *   05  invited sender, a question, no file  high     → responded, not a quotation
 *
 * Generated from the live invitation list, so the addresses are the ones the
 * event was actually issued to rather than invented ones.
 */

const SAMPLE_DIR = path.join(REPO_ROOT, "data", "inbound-samples");
const DOCS_DIR = path.join(REPO_ROOT, "data", "vendor-documents");

function rfc2822(date: Date): string {
  return date.toUTCString().replace("GMT", "+0000");
}

interface MessageSpec {
  file: string;
  from: string;
  fromName: string;
  to: string;
  subject: string;
  body: string;
  attachment?: { source: string; filename: string; contentType: string };
  receivedAt: Date;
}

async function buildEml(spec: MessageSpec): Promise<string> {
  const boundary = `----aerchain-${Math.random().toString(36).slice(2, 12)}`;
  const messageId = `<${Math.random().toString(36).slice(2)}.${Date.now()}@supplier.example>`;

  const headers = [
    `From: ${spec.fromName} <${spec.from}>`,
    `To: <${spec.to}>`,
    `Subject: ${spec.subject}`,
    `Date: ${rfc2822(spec.receivedAt)}`,
    `Message-ID: ${messageId}`,
    "MIME-Version: 1.0",
  ];

  if (!spec.attachment) {
    return [...headers, 'Content-Type: text/plain; charset="utf-8"', "", spec.body, ""].join("\r\n");
  }

  const bytes = await fs.readFile(path.join(DOCS_DIR, spec.attachment.source));
  // 76-character lines, as the MIME spec requires.
  const encoded = bytes.toString("base64").replace(/(.{76})/g, "$1\r\n");

  return [
    ...headers,
    `Content-Type: multipart/mixed; boundary="${boundary}"`,
    "",
    `--${boundary}`,
    'Content-Type: text/plain; charset="utf-8"',
    "",
    spec.body,
    "",
    `--${boundary}`,
    `Content-Type: ${spec.attachment.contentType}; name="${spec.attachment.filename}"`,
    "Content-Transfer-Encoding: base64",
    `Content-Disposition: attachment; filename="${spec.attachment.filename}"`,
    "",
    encoded,
    "",
    `--${boundary}--`,
    "",
  ].join("\r\n");
}

async function main() {
  // Whichever active event was issued to the most suppliers, unless one is named
  // on the command line. Ordering by issue date picks whatever happened to be
  // sent last, which is rarely the event worth demonstrating.
  const requestedId = process.argv[2];
  const active = await prisma.rfx.findMany({
    where: requestedId ? { id: requestedId } : { status: "active" },
    include: { invitations: { include: { supplier: true }, orderBy: { sentAt: "asc" } } },
  });
  const rfx = active.sort((a, b) => b.invitations.length - a.invitations.length)[0];

  if (!rfx) {
    console.error(
      requestedId
        ? `No event with id ${requestedId}.`
        : "No active RFx found. Issue one to suppliers first.",
    );
    process.exitCode = 1;
    return;
  }
  if (rfx.invitations.length < 2) {
    console.error(
      `"${rfx.name}" has ${rfx.invitations.length} invitation(s). Issue it to at least two suppliers so the ` +
        "samples can show both a matched and an unmatched reply.",
    );
    process.exitCode = 1;
    return;
  }

  const inbox = process.env.INBOX_ADDRESS ?? "procurement@aerchain-demo.example";
  const [local, domain] = inbox.split("@");
  const replyAddress = `${local}+${replyTokenFor(rfx.id)}@${domain}`;

  const [first, second, third] = rfx.invitations;
  const now = Date.now();
  const hoursAgo = (h: number) => new Date(now - h * 3600_000);

  const specs: MessageSpec[] = [
    {
      file: "01-reply-token-exact.eml",
      from: first.email,
      fromName: first.supplier.name,
      to: replyAddress,
      subject: `Re: Request for Quotation — ${rfx.name}`,
      body:
        `Dear Procurement team,\r\n\r\n` +
        `Please find our quotation attached against your RFQ. Prices are per unit, ex-works, ` +
        `and hold for 30 days from today.\r\n\r\n` +
        `Freight is quoted separately on the last sheet.\r\n\r\n` +
        `Regards,\r\nSales desk\r\n${first.supplier.name}`,
      attachment: { source: "vendor-a-quote.xlsx", filename: "Quotation.xlsx", contentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" },
      receivedAt: hoursAgo(28),
    },
    {
      file: "02-invited-sender-high.eml",
      from: second.email,
      fromName: second.supplier.name,
      to: inbox,
      subject: `Quotation — ${rfx.category}`,
      body:
        `Hello,\r\n\r\n` +
        `Attaching our offer. Note the discount on the second page applies to the whole order, ` +
        `not per line.\r\n\r\n` +
        `Thanks,\r\n${second.supplier.name}`,
      attachment: { source: "vendor-b-quote.pdf", filename: "Offer.pdf", contentType: "application/pdf" },
      receivedAt: hoursAgo(21),
    },
    {
      file: "03-subject-only-medium.eml",
      from: "estimates@northwind-packaging.example",
      fromName: "Northwind Packaging",
      to: inbox,
      subject: `Fwd: ${rfx.name} — our pricing`,
      body:
        `Hi,\r\n\r\n` +
        `Your RFQ was passed to us by a colleague. Our pricing is attached — we can cover the ` +
        `full list.\r\n\r\n` +
        `Regards,\r\nEstimating\r\nNorthwind Packaging`,
      attachment: { source: "vendor-c-quote.docx", filename: "Pricing.docx", contentType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" },
      receivedAt: hoursAgo(14),
    },
    {
      file: "04-uninvited-unmatched.eml",
      from: "sales@harbourline-supplies.example",
      fromName: "Harbourline Supplies",
      to: inbox,
      subject: "Our rate card",
      body:
        `Good morning,\r\n\r\n` +
        `Attaching our standard rate card for your consideration.\r\n\r\n` +
        `Best,\r\nHarbourline Supplies`,
      attachment: { source: "vendor-e-quote.txt", filename: "RateCard.txt", contentType: "text/plain" },
      receivedAt: hoursAgo(9),
    },
    {
      file: "05-question-no-attachment.eml",
      from: (third ?? first).email,
      fromName: (third ?? first).supplier.name,
      to: replyAddress,
      subject: `Re: Request for Quotation — ${rfx.name} — clarification`,
      body:
        `Hi,\r\n\r\n` +
        `Before we price this: is freight to be quoted delivered, or ex-works with freight ` +
        `shown separately? The RFQ says to state it clearly but does not say which basis you ` +
        `want compared.\r\n\r\n` +
        `We will send pricing as soon as you confirm.\r\n\r\n` +
        `Regards,\r\n${(third ?? first).supplier.name}`,
      receivedAt: hoursAgo(4),
    },
  ];

  await fs.mkdir(SAMPLE_DIR, { recursive: true });
  for (const spec of specs) {
    const eml = await buildEml(spec);
    await fs.writeFile(path.join(SAMPLE_DIR, spec.file), eml, "utf8");
    const size = (Buffer.byteLength(eml) / 1024).toFixed(0);
    console.log(`  ${spec.file.padEnd(34)} ${spec.from.padEnd(38)} ${size} KB`);
  }

  console.log(`\nWrote ${specs.length} sample messages to data/inbound-samples`);
  console.log(`Reply address for this event: ${replyAddress}`);
  console.log(`Run a sync to file them:      POST /api/inbox/sync`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
