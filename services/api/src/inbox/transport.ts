import fs from "node:fs/promises";
import path from "node:path";
import { simpleParser, type ParsedMail } from "mailparser";
import { REPO_ROOT } from "../paths.js";

/**
 * Where inbound mail comes from.
 *
 * Two transports, one interface. The IMAP adapter talks to a real mailbox; the
 * sample adapter reads `.eml` files off disk. Both hand back the same shape,
 * because everything downstream — matching a reply to an event, filing an
 * attachment against a supplier — is transport-agnostic and is the part worth
 * getting right.
 *
 * Both parse with the same MIME parser, so a sample message exercises the same
 * header handling, encoding quirks and attachment extraction as a real one.
 * The sample path is a stand-in for the mailbox, not for the parsing.
 */

export interface InboundAttachment {
  filename: string;
  contentType: string;
  size: number;
  /** Where the bytes were written, relative to the repo root. */
  storedPath: string;
}

export interface InboundMail {
  /** Stable per-transport identifier. Re-syncing must not file a message twice. */
  externalId: string;
  messageId: string | null;
  inReplyTo: string | null;
  fromEmail: string;
  fromName: string | null;
  /** Every To and Cc address — a plus-addressed reply token arrives in one of these. */
  to: string[];
  subject: string;
  receivedAt: Date;
  snippet: string;
  attachments: InboundAttachment[];
  source: "imap" | "sample";
}

export interface InboxTransport {
  readonly name: "imap" | "sample";
  /** Human-readable description of what is connected, for the UI. */
  describe(): string;
  fetch(options: { limit: number }): Promise<InboundMail[]>;
}

/** Where attachments pulled off messages are written. */
const ATTACHMENT_DIR = path.join(REPO_ROOT, "data", "inbound-attachments");

/** Quote files only. A signature image is not a quotation, and running the
 * extraction pipeline over one wastes a request against the daily quota. */
const QUOTE_EXTENSIONS = new Set([".xlsx", ".xls", ".pdf", ".docx", ".doc", ".jpg", ".jpeg", ".png", ".txt", ".csv"]);

function isPlausibleQuote(filename: string, size: number): boolean {
  const ext = path.extname(filename).toLowerCase();
  // Inline signature logos are small and almost never a quotation.
  return QUOTE_EXTENSIONS.has(ext) && size > 2048;
}

function addressesOf(field: ParsedMail["to"]): string[] {
  if (!field) return [];
  const list = Array.isArray(field) ? field : [field];
  return list.flatMap((entry) => entry.value.map((a) => (a.address ?? "").toLowerCase()).filter(Boolean));
}

/** Turns a parsed MIME message into our shape, writing any quote attachments to disk. */
export async function toInboundMail(
  parsed: ParsedMail,
  externalId: string,
  source: "imap" | "sample",
): Promise<InboundMail> {
  await fs.mkdir(ATTACHMENT_DIR, { recursive: true });

  const attachments: InboundAttachment[] = [];
  for (const att of parsed.attachments ?? []) {
    const filename = att.filename ?? "attachment";
    if (!isPlausibleQuote(filename, att.size)) continue;
    // Prefixed with the message id so two suppliers sending "quote.pdf" cannot
    // overwrite one another. Both halves are sanitised: a raw id can contain a
    // colon, which Windows reads as an alternate data stream rather than part
    // of the name — the write appears to succeed and the file is not there.
    const safeName = filename.replace(/[^\w.\-]+/g, "_");
    const safeId = externalId.replace(/[^\w.\-]+/g, "_");
    const stored = path.join(ATTACHMENT_DIR, `${safeId}__${safeName}`);
    await fs.writeFile(stored, att.content);
    attachments.push({
      filename,
      contentType: att.contentType ?? "application/octet-stream",
      size: att.size,
      storedPath: path.relative(REPO_ROOT, stored).split(path.sep).join("/"),
    });
  }

  const body = (parsed.text ?? "").replace(/\s+/g, " ").trim();
  const from = parsed.from?.value?.[0];

  return {
    externalId,
    messageId: parsed.messageId ?? null,
    inReplyTo: parsed.inReplyTo ?? null,
    fromEmail: (from?.address ?? "").toLowerCase(),
    fromName: from?.name || null,
    to: [...addressesOf(parsed.to), ...addressesOf(parsed.cc)],
    subject: parsed.subject ?? "(no subject)",
    receivedAt: parsed.date ?? new Date(),
    snippet: body.slice(0, 400),
    attachments,
    source,
  };
}

// ------------------------------------------------------------------- sample

const SAMPLE_DIR = path.join(REPO_ROOT, "data", "inbound-samples");

/**
 * Reads real `.eml` files from disk.
 *
 * This is what the demo runs on: no credentials, no network, and it cannot fail
 * in front of an audience because a mailbox was empty or slow. The files are
 * genuine MIME with genuine attachments, so every step after the fetch is the
 * same code that runs against a live mailbox.
 */
export class SampleInboxTransport implements InboxTransport {
  readonly name = "sample" as const;

  describe(): string {
    return "Sample inbox — .eml files in data/inbound-samples";
  }

  async fetch({ limit }: { limit: number }): Promise<InboundMail[]> {
    let files: string[];
    try {
      files = (await fs.readdir(SAMPLE_DIR)).filter((f) => f.toLowerCase().endsWith(".eml")).sort();
    } catch {
      return [];
    }

    const mail: InboundMail[] = [];
    for (const file of files.slice(0, limit)) {
      const raw = await fs.readFile(path.join(SAMPLE_DIR, file));
      const parsed = await simpleParser(raw);
      // Deterministic id, so re-running a sync is a no-op rather than a duplicate.
      mail.push(await toInboundMail(parsed, `sample:${file}`, "sample"));
    }
    return mail;
  }
}

// --------------------------------------------------------------------- imap

export interface ImapConfig {
  host: string;
  port: number;
  secure: boolean;
  user: string;
  pass: string;
  mailbox: string;
}

export function readImapConfig(): ImapConfig | null {
  const { IMAP_HOST, IMAP_PORT, IMAP_USER, IMAP_PASSWORD, IMAP_MAILBOX, IMAP_SECURE } = process.env;
  if (!IMAP_HOST || !IMAP_USER || !IMAP_PASSWORD) return null;
  return {
    host: IMAP_HOST,
    port: Number(IMAP_PORT ?? 993),
    secure: IMAP_SECURE ? IMAP_SECURE !== "false" : true,
    user: IMAP_USER,
    pass: IMAP_PASSWORD,
    mailbox: IMAP_MAILBOX ?? "INBOX",
  };
}

/**
 * Talks to a real mailbox over IMAP.
 *
 * Read-only: the connection is opened without write access, so nothing here can
 * mark, move or delete a message in someone's inbox. De-duplication is handled
 * by storing the message's own identifier rather than by flagging it as read,
 * which means running a sync twice is harmless and leaves the mailbox exactly
 * as it was found.
 */
export class ImapInboxTransport implements InboxTransport {
  readonly name = "imap" as const;

  constructor(private readonly config: ImapConfig) {}

  describe(): string {
    return `IMAP — ${this.config.user} at ${this.config.host} (${this.config.mailbox}, read-only)`;
  }

  async fetch({ limit }: { limit: number }): Promise<InboundMail[]> {
    // Imported lazily so the API starts, and the sample transport works, on a
    // machine that never configures IMAP at all.
    const { ImapFlow } = await import("imapflow");
    const client = new ImapFlow({
      host: this.config.host,
      port: this.config.port,
      secure: this.config.secure,
      auth: { user: this.config.user, pass: this.config.pass },
      logger: false,
    });

    const mail: InboundMail[] = [];
    await client.connect();
    try {
      const lock = await client.getMailboxLock(this.config.mailbox, { readOnly: true });
      try {
        const status = client.mailbox && typeof client.mailbox !== "boolean" ? client.mailbox : null;
        const total = status?.exists ?? 0;
        if (total === 0) return [];
        const from = Math.max(1, total - limit + 1);

        for await (const msg of client.fetch(`${from}:*`, { source: true, uid: true })) {
          if (!msg.source) continue;
          const parsed = await simpleParser(msg.source);
          // The UID is stable within a mailbox; pairing it with the account
          // keeps ids unique if the mailbox is ever changed.
          mail.push(await toInboundMail(parsed, `imap:${this.config.user}:${msg.uid}`, "imap"));
        }
      } finally {
        lock.release();
      }
    } finally {
      await client.logout().catch(() => undefined);
    }
    return mail.reverse();
  }
}

/** The configured transport: a real mailbox when credentials exist, samples otherwise. */
export function resolveTransport(): InboxTransport {
  const config = readImapConfig();
  return config ? new ImapInboxTransport(config) : new SampleInboxTransport();
}
