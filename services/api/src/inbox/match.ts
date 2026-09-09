import type { InboundMail } from "./transport.js";

/**
 * Matching a reply to a sourcing event.
 *
 * Deterministic, and deliberately unwilling to guess. Four signals are tried in
 * descending order of certainty, and if none of them fires the message is filed
 * as unmatched for a buyer to assign by hand.
 *
 * That last part is the whole design. Filing a quotation against the wrong event
 * is the same class of error as valuing an unquoted line at zero: it produces a
 * confident, wrong answer that nothing downstream can detect. A tray of four
 * unmatched messages is a minor annoyance; one misfiled quotation silently
 * corrupts a comparison a buyer is about to award on.
 *
 * No language model is involved. A header either matches or it does not.
 */

export type MatchSignal = "reply_token" | "in_reply_to" | "sender" | "subject";
export type MatchConfidence = "exact" | "high" | "medium";

export interface MatchCandidate {
  rfxId: string;
  rfxName: string;
  /** Message-IDs of the invitations sent for this event, for header threading. */
  outboundMessageIds: string[];
  /** Invited supplier addresses, lower-cased. */
  invitedEmails: Array<{ supplierId: string; email: string }>;
}

export interface MatchResult {
  rfxId: string;
  supplierId: string | null;
  matchedBy: MatchSignal;
  confidence: MatchConfidence;
  /** Why, in a sentence, for the buyer reviewing the tray. */
  reason: string;
}

/**
 * The token that identifies an event inside a reply address.
 *
 * A supplier replying to `procurement+rfx-6f04bcf3@example.com` tells us the
 * event without us having to infer anything, and it keeps working when they
 * reply from a different address than the one invited — which they routinely do,
 * because the person who reads the RFx is rarely the person who prices it.
 */
export function replyTokenFor(rfxId: string): string {
  return `rfx-${rfxId.slice(0, 8)}`;
}

/** The address suppliers should be asked to reply to, when an inbox is configured. */
export function replyAddressFor(rfxId: string, inboxAddress: string | null): string | null {
  if (!inboxAddress || !inboxAddress.includes("@")) return null;
  const [local, domain] = inboxAddress.split("@");
  return `${local}+${replyTokenFor(rfxId)}@${domain}`;
}

function normaliseSubject(subject: string): string {
  return subject
    .toLowerCase()
    .replace(/^(re|fw|fwd)\s*:\s*/gi, "")
    .replace(/\s+/g, " ")
    .trim();
}

export function matchMessage(mail: InboundMail, candidates: MatchCandidate[]): MatchResult | null {
  // 1. A reply token in any recipient address. Exact, and survives the supplier
  //    replying from a colleague's mailbox.
  const recipients = mail.to.map((a) => a.toLowerCase());
  for (const candidate of candidates) {
    const token = replyTokenFor(candidate.rfxId);
    if (recipients.some((address) => address.includes(`+${token}@`) || address.startsWith(`${token}@`))) {
      const supplier = candidate.invitedEmails.find((i) => i.email === mail.fromEmail);
      return {
        rfxId: candidate.rfxId,
        supplierId: supplier?.supplierId ?? null,
        matchedBy: "reply_token",
        confidence: "exact",
        reason: `Addressed to the reply address for this event (${token}).`,
      };
    }
  }

  // 2. Threading headers. Also exact: this message is a reply to one we sent.
  if (mail.inReplyTo) {
    const inReplyTo = mail.inReplyTo.replace(/[<>]/g, "").trim();
    for (const candidate of candidates) {
      if (candidate.outboundMessageIds.some((id) => id.replace(/[<>]/g, "").trim() === inReplyTo)) {
        const supplier = candidate.invitedEmails.find((i) => i.email === mail.fromEmail);
        return {
          rfxId: candidate.rfxId,
          supplierId: supplier?.supplierId ?? null,
          matchedBy: "in_reply_to",
          confidence: "exact",
          reason: "Threaded reply to the invitation we sent for this event.",
        };
      }
    }
  }

  // 3. The sender is an invited supplier. High, but only when they were invited
  //    to exactly one open event — otherwise we genuinely cannot tell which
  //    event they are answering, and saying so is better than picking.
  const senderMatches = candidates.filter((c) => c.invitedEmails.some((i) => i.email === mail.fromEmail));
  if (senderMatches.length === 1) {
    const candidate = senderMatches[0];
    const supplier = candidate.invitedEmails.find((i) => i.email === mail.fromEmail)!;
    return {
      rfxId: candidate.rfxId,
      supplierId: supplier.supplierId,
      matchedBy: "sender",
      confidence: "high",
      reason: `${mail.fromEmail} was invited to this event, and to no other open event.`,
    };
  }

  // 4. The subject carries the event name. Medium — subjects get edited, and
  //    two events in the same category can read almost identically — so a
  //    buyer confirms it rather than the system committing on its own.
  const subject = normaliseSubject(mail.subject);
  const byName = candidates.filter((c) => c.rfxName.length > 12 && subject.includes(c.rfxName.toLowerCase()));
  if (byName.length === 1) {
    const candidate = byName[0];
    const supplier = candidate.invitedEmails.find((i) => i.email === mail.fromEmail);
    return {
      rfxId: candidate.rfxId,
      supplierId: supplier?.supplierId ?? null,
      matchedBy: "subject",
      confidence: "medium",
      reason: `Subject line names this event. Confirm before relying on it — subjects get edited in reply.`,
    };
  }

  // Nothing fired. The message is kept and surfaced, never discarded and never
  // filed against a best guess.
  return null;
}

/** Why a message could not be placed, phrased for the buyer who has to place it. */
export function explainNoMatch(mail: InboundMail, candidates: MatchCandidate[]): string {
  const invitedElsewhere = candidates.filter((c) => c.invitedEmails.some((i) => i.email === mail.fromEmail));
  if (invitedElsewhere.length > 1) {
    return `${mail.fromEmail} is invited to ${invitedElsewhere.length} open events and the reply names none of them, so which one this answers is genuinely ambiguous.`;
  }
  if (mail.attachments.length === 0) {
    return `No attachment and no event reference. This may be a question rather than a quotation.`;
  }
  return `${mail.fromEmail} is not on the invitation list for any open event. They may have been forwarded the RFx by someone who was.`;
}
