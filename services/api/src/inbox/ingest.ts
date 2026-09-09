import fs from "node:fs/promises";
import path from "node:path";
import { prisma } from "../db.js";
import { REPO_ROOT, VENDOR_DOCS_DIR } from "../paths.js";
import { explainNoMatch, matchMessage, replyAddressFor, type MatchCandidate } from "./match.js";
import { resolveTransport, type InboundAttachment, type InboundMail } from "./transport.js";

/**
 * Pulling supplier replies out of the inbox and filing them against events.
 *
 * The sequence is: fetch → store → match → attach. Each stage is separable on
 * purpose. A message is stored before anything tries to interpret it, so a
 * matching failure never loses mail; and a match is recorded before any
 * attachment is turned into a vendor response, so a buyer can see and correct
 * the filing decision independently of the extraction that follows it.
 *
 * Extraction itself is not run here. Attaching a reply is free and instant;
 * extracting it costs a request against a daily quota, so that stays an explicit
 * action a buyer takes per response.
 */

export interface SyncSummary {
  transport: string;
  fetched: number;
  /** Already seen on a previous sync. */
  duplicates: number;
  matched: number;
  unmatched: number;
  attached: number;
  messages: Array<{
    id: string;
    from: string;
    subject: string;
    matchedTo: string | null;
    reason: string;
  }>;
}

const FORMAT_BY_EXTENSION: Record<string, string> = {
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

/** Every event that could plausibly be the subject of a reply. */
async function loadCandidates(): Promise<MatchCandidate[]> {
  const events = await prisma.rfx.findMany({
    where: { status: { in: ["active", "in_fulfillment"] } },
    select: {
      id: true,
      name: true,
      invitations: { select: { supplierId: true, email: true } },
    },
  });
  return events.map((e) => ({
    rfxId: e.id,
    rfxName: e.name,
    // The prototype does not send real mail (PRD §34), so there are no outbound
    // Message-IDs yet. The threading branch is wired and will start firing the
    // moment a real sender records them.
    outboundMessageIds: [],
    invitedEmails: e.invitations.map((i) => ({ supplierId: i.supplierId, email: i.email.toLowerCase() })),
  }));
}

/** Turns one attachment into a vendor response row, ready to extract. */
async function attachAsVendorResponse(
  mail: InboundMail,
  attachment: InboundAttachment,
  rfxId: string,
  supplierName: string,
): Promise<string | null> {
  const ext = path.extname(attachment.filename).toLowerCase();
  const responseFormat = FORMAT_BY_EXTENSION[ext];
  if (!responseFormat) return null;

  // The row is created first because its id names the file. If the copy then
  // fails, the row is removed again — an earlier version left orphaned vendors
  // with an empty filePath behind, which show up in the comparison as a column
  // with no document under it.
  const vendor = await prisma.vendor.create({
    data: {
      rfxId,
      name: supplierName,
      responseFormat,
      filePath: "",
      status: "pending",
    },
  });

  try {
    // Copied rather than moved, so the original message attachment stays intact
    // as evidence of what the supplier actually sent.
    const destination = path.join(VENDOR_DOCS_DIR, `vendor-${vendor.id}${ext}`);
    await fs.mkdir(VENDOR_DOCS_DIR, { recursive: true });
    await fs.copyFile(path.join(REPO_ROOT, attachment.storedPath), destination);
    await prisma.vendor.update({ where: { id: vendor.id }, data: { filePath: destination } });
    return vendor.id;
  } catch (err) {
    await prisma.vendor.delete({ where: { id: vendor.id } }).catch(() => undefined);
    throw err;
  }
}

/** A readable supplier name, preferring what the mailbox told us over the address. */
function supplierNameFrom(mail: InboundMail): string {
  if (mail.fromName && mail.fromName.trim().length > 1) return mail.fromName.trim();
  const local = mail.fromEmail.split("@")[0] ?? "Supplier";
  return local.replace(/[._-]+/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

export async function syncInbox(options: { limit?: number } = {}): Promise<SyncSummary> {
  const transport = resolveTransport();
  const mail = await transport.fetch({ limit: options.limit ?? 25 });
  const candidates = await loadCandidates();

  const summary: SyncSummary = {
    transport: transport.describe(),
    fetched: mail.length,
    duplicates: 0,
    matched: 0,
    unmatched: 0,
    attached: 0,
    messages: [],
  };

  for (const item of mail) {
    const seen = await prisma.inboundMessage.findUnique({ where: { externalId: item.externalId } });
    if (seen) {
      summary.duplicates += 1;
      continue;
    }

    const match = matchMessage(item, candidates);
    const record = await prisma.inboundMessage.create({
      data: {
        externalId: item.externalId,
        messageId: item.messageId,
        inReplyTo: item.inReplyTo,
        fromEmail: item.fromEmail,
        fromName: item.fromName,
        toJson: JSON.stringify(item.to),
        subject: item.subject,
        receivedAt: item.receivedAt,
        snippet: item.snippet,
        attachmentsJson: JSON.stringify(item.attachments),
        source: item.source,
        rfxId: match?.rfxId ?? null,
        supplierId: match?.supplierId ?? null,
        matchedBy: match?.matchedBy ?? null,
        matchConfidence: match?.confidence ?? null,
        status: match ? "matched" : "unmatched",
        note: match?.reason ?? explainNoMatch(item, candidates),
      },
    });

    if (!match) {
      summary.unmatched += 1;
      summary.messages.push({
        id: record.id,
        from: item.fromEmail,
        subject: item.subject,
        matchedTo: null,
        reason: record.note ?? "",
      });
      continue;
    }

    summary.matched += 1;

    // Mark the invitation answered, and credit the supplier's response record.
    if (match.supplierId) {
      await prisma.rfxInvitation
        .update({
          where: { rfxId_supplierId: { rfxId: match.rfxId, supplierId: match.supplierId } },
          data: {
            status: "responded",
            respondedAt: item.receivedAt,
            responseSubject: item.subject,
            responseMessageId: item.messageId,
          },
        })
        .catch(() => undefined);
      await prisma.supplier
        .update({ where: { id: match.supplierId }, data: { eventsQuoted: { increment: 1 } } })
        .catch(() => undefined);
    }

    // An exact or high-confidence match files the attachment on its own: in both
    // cases we know which supplier sent it and which event it answers. A medium
    // match is a subject-line guess, and those wait for a buyer to confirm —
    // a quotation attached to the wrong event is worse than one not yet attached.
    if (match.confidence !== "medium" && item.attachments.length > 0) {
      const name = supplierNameFrom(item);
      for (const attachment of item.attachments) {
        const vendorId = await attachAsVendorResponse(item, attachment, match.rfxId, name);
        if (vendorId) {
          await prisma.inboundMessage.update({
            where: { id: record.id },
            data: { vendorId, status: "ingested" },
          });
          summary.attached += 1;
          break; // one quotation per message
        }
      }
    }

    const event = candidates.find((c) => c.rfxId === match.rfxId);
    summary.messages.push({
      id: record.id,
      from: item.fromEmail,
      subject: item.subject,
      matchedTo: event?.rfxName ?? match.rfxId,
      reason: match.reason,
    });
  }

  return summary;
}

/**
 * Who was invited, who answered, and with what.
 *
 * Awaiting is stated as a fact about the invitation, not inferred from the
 * absence of a vendor row — a supplier can reply with a question and no
 * attachment, and that is a response even though it is not a quotation.
 */
export async function responseLedger(rfxId: string) {
  const [invitations, messages, inboxAddress] = await Promise.all([
    prisma.rfxInvitation.findMany({
      where: { rfxId },
      include: { supplier: true },
      orderBy: { sentAt: "asc" },
    }),
    prisma.inboundMessage.findMany({ where: { rfxId }, orderBy: { receivedAt: "desc" } }),
    Promise.resolve(process.env.INBOX_ADDRESS ?? null),
  ]);

  const bySupplier = new Map<string, (typeof messages)[number]>();
  for (const m of messages) {
    if (m.supplierId && !bySupplier.has(m.supplierId)) bySupplier.set(m.supplierId, m);
  }

  // Every response on the event, however it arrived. The ledger used to read
  // only the ones an inbound message created, so a quotation that was uploaded
  // or imported showed as "replied, no quotation attached" while its 30 prices
  // sat in the comparison two tabs away. Where the response came from is not
  // something the buyer asked about.
  const vendors = await prisma.vendor.findMany({ where: { rfxId } });

  const parseAttachments = (raw: string): InboundAttachment[] => {
    try {
      return JSON.parse(raw) as InboundAttachment[];
    } catch {
      return [];
    }
  };

  return {
    replyAddress: replyAddressFor(rfxId, inboxAddress),
    inboxConnected: resolveTransport().name === "imap",
    transport: resolveTransport().describe(),
    invited: invitations.map((invitation) => {
      const reply = bySupplier.get(invitation.supplierId);
      // The message names the response where one exists; otherwise the supplier
      // is matched to a response by name, which is how an uploaded or imported
      // quotation is filed against the supplier who sent it.
      const vendor =
        vendors.find((v) => v.id === reply?.vendorId) ??
        vendors.find((v) => v.name.trim().toLowerCase() === invitation.supplier.name.trim().toLowerCase()) ??
        null;

      const emailAttachments = reply ? parseAttachments(reply.attachmentsJson).map((a) => a.filename) : [];
      return {
        supplierId: invitation.supplierId,
        name: invitation.supplier.name,
        email: invitation.email,
        invitedAt: invitation.sentAt,
        status: invitation.status,
        respondedAt: invitation.respondedAt,
        responseSubject: invitation.responseSubject,
        snippet: reply?.snippet ?? null,
        attachments: emailAttachments,
        vendorId: vendor?.id ?? null,
        vendorName: vendor?.name ?? null,
        vendorStatus: vendor?.status ?? null,
        responseFormat: vendor?.responseFormat ?? null,
        itemsFound: vendor?.itemsFoundCount ?? null,
        itemsMissing: vendor?.itemsMissingCount ?? null,
        /** The document the supplier actually sent, so it can be opened and checked. */
        documentUrl: vendor ? `/api/vendors/${vendor.id}/file` : null,
        matchedBy: reply?.matchedBy ?? (vendor ? "uploaded" : null),
      };
    }),
    // Replies from addresses that were never invited. Worth surfacing: the RFx
    // was very likely forwarded, and that is a supplier you did not know about.
    uninvited: messages
      .filter((m) => !m.supplierId)
      .map((m) => ({
        id: m.id,
        from: m.fromEmail,
        fromName: m.fromName,
        subject: m.subject,
        receivedAt: m.receivedAt,
        snippet: m.snippet,
        attachments: parseAttachments(m.attachmentsJson).map((a) => a.filename),
        matchedBy: m.matchedBy,
        matchConfidence: m.matchConfidence,
        vendorId: m.vendorId,
        note: m.note,
      })),
  };
}

/** The tray: mail that arrived but could not be placed. */
export async function unmatchedMessages() {
  const messages = await prisma.inboundMessage.findMany({
    where: { status: "unmatched" },
    orderBy: { receivedAt: "desc" },
  });
  return messages.map((m) => ({
    id: m.id,
    from: m.fromEmail,
    fromName: m.fromName,
    subject: m.subject,
    receivedAt: m.receivedAt,
    snippet: m.snippet,
    attachments: (() => {
      try {
        return (JSON.parse(m.attachmentsJson) as InboundAttachment[]).map((a) => a.filename);
      } catch {
        return [];
      }
    })(),
    note: m.note,
  }));
}

/** A buyer placing a message the matcher would not place on its own. */
export async function assignMessage(messageId: string, rfxId: string, supplierId: string | null) {
  const message = await prisma.inboundMessage.findUniqueOrThrow({ where: { id: messageId } });
  const attachments = (() => {
    try {
      return JSON.parse(message.attachmentsJson) as InboundAttachment[];
    } catch {
      return [];
    }
  })();

  let vendorId: string | null = message.vendorId;
  if (!vendorId && attachments.length > 0) {
    const name = supplierNameFrom({
      fromName: message.fromName,
      fromEmail: message.fromEmail,
    } as InboundMail);
    for (const attachment of attachments) {
      vendorId = await attachAsVendorResponse(
        { externalId: message.externalId, attachments } as InboundMail,
        attachment,
        rfxId,
        name,
      );
      if (vendorId) break;
    }
  }

  await prisma.inboundMessage.update({
    where: { id: messageId },
    data: {
      rfxId,
      supplierId,
      vendorId,
      status: vendorId ? "ingested" : "matched",
      matchedBy: "manual",
      matchConfidence: "exact",
      note: "Assigned by a buyer.",
    },
  });

  if (supplierId) {
    await prisma.rfxInvitation
      .update({
        where: { rfxId_supplierId: { rfxId, supplierId } },
        data: {
          status: "responded",
          respondedAt: message.receivedAt,
          responseSubject: message.subject,
          responseMessageId: message.messageId,
        },
      })
      .catch(() => undefined);
  }

  return { messageId, rfxId, supplierId, vendorId };
}
