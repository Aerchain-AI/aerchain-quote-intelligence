import { describe, expect, it } from "vitest";
import { explainNoMatch, matchMessage, replyAddressFor, replyTokenFor, type MatchCandidate } from "../src/inbox/match.js";
import type { InboundMail } from "../src/inbox/transport.js";

/**
 * The matcher decides which sourcing event a supplier's reply belongs to.
 *
 * These tests care as much about what it refuses to do as what it does. Filing a
 * quotation against the wrong event produces a confident, wrong comparison that
 * nothing downstream can detect — the same failure mode as valuing an unquoted
 * line at zero. Every "returns null" case below is a deliberate refusal.
 */

const PACKAGING = "6f04bcf3-6740-4aa2-9079-c56c9b8c9cb2";
const FURNITURE = "15f4f23b-f613-4e9a-957f-e6d763513a06";

function candidates(): MatchCandidate[] {
  return [
    {
      rfxId: PACKAGING,
      rfxName: "Corrugated Packaging — FY27 Sourcing Event",
      outboundMessageIds: ["<invite-packaging-1@aerchain.example>"],
      invitedEmails: [
        { supplierId: "sup-a", email: "sales@vendor-a.example" },
        { supplierId: "sup-shared", email: "desk@both-categories.example" },
      ],
    },
    {
      rfxId: FURNITURE,
      rfxName: "Office Furniture Procurement for 50 Workstations",
      outboundMessageIds: ["<invite-furniture-1@aerchain.example>"],
      invitedEmails: [
        { supplierId: "sup-f", email: "quotes@vendor-f.example" },
        { supplierId: "sup-shared-2", email: "desk@both-categories.example" },
      ],
    },
  ];
}

function mail(overrides: Partial<InboundMail> = {}): InboundMail {
  return {
    externalId: "test:1",
    messageId: "<reply-1@supplier.example>",
    inReplyTo: null,
    fromEmail: "someone@elsewhere.example",
    fromName: "Someone",
    to: ["procurement@aerchain.example"],
    subject: "Our quotation",
    receivedAt: new Date("2026-09-09T10:00:00Z"),
    snippet: "Please find attached.",
    attachments: [],
    source: "sample",
    ...overrides,
  };
}

describe("reply tokens", () => {
  it("derives a stable token from the event id", () => {
    expect(replyTokenFor(PACKAGING)).toBe("rfx-6f04bcf3");
    expect(replyTokenFor(PACKAGING)).toBe(replyTokenFor(PACKAGING));
  });

  it("plus-addresses the configured inbox", () => {
    expect(replyAddressFor(PACKAGING, "procurement@acme.example")).toBe("procurement+rfx-6f04bcf3@acme.example");
  });

  it("offers no reply address when no inbox is configured", () => {
    expect(replyAddressFor(PACKAGING, null)).toBeNull();
    expect(replyAddressFor(PACKAGING, "not-an-address")).toBeNull();
  });
});

describe("matching", () => {
  it("matches on a reply token, exactly", () => {
    const result = matchMessage(
      mail({ to: ["procurement+rfx-6f04bcf3@acme.example"], fromEmail: "sales@vendor-a.example" }),
      candidates(),
    );
    expect(result?.rfxId).toBe(PACKAGING);
    expect(result?.matchedBy).toBe("reply_token");
    expect(result?.confidence).toBe("exact");
    expect(result?.supplierId).toBe("sup-a");
  });

  it("still places a token-addressed reply sent from an uninvited colleague", () => {
    // The person who reads the RFx is rarely the person who prices it, so the
    // reply routinely comes from a different mailbox than the one invited.
    const result = matchMessage(
      mail({ to: ["procurement+rfx-6f04bcf3@acme.example"], fromEmail: "pricing.desk@vendor-a.example" }),
      candidates(),
    );
    expect(result?.rfxId).toBe(PACKAGING);
    expect(result?.confidence).toBe("exact");
    // The event is known; which supplier record it belongs to is not.
    expect(result?.supplierId).toBeNull();
  });

  it("matches a threaded reply on In-Reply-To", () => {
    const result = matchMessage(
      mail({ inReplyTo: "<invite-furniture-1@aerchain.example>", fromEmail: "quotes@vendor-f.example" }),
      candidates(),
    );
    expect(result?.rfxId).toBe(FURNITURE);
    expect(result?.matchedBy).toBe("in_reply_to");
    expect(result?.confidence).toBe("exact");
  });

  it("matches an invited sender when they were invited to exactly one open event", () => {
    const result = matchMessage(mail({ fromEmail: "sales@vendor-a.example" }), candidates());
    expect(result?.rfxId).toBe(PACKAGING);
    expect(result?.matchedBy).toBe("sender");
    expect(result?.confidence).toBe("high");
    expect(result?.supplierId).toBe("sup-a");
  });

  it("refuses to choose when the sender was invited to two open events", () => {
    // This is the case worth being careful about: a supplier bidding on two of
    // your events replies with "our quotation attached" and nothing else.
    const result = matchMessage(mail({ fromEmail: "desk@both-categories.example" }), candidates());
    expect(result).toBeNull();
  });

  it("falls back to the subject line, but only at medium confidence", () => {
    const result = matchMessage(
      mail({ subject: "Fwd: Corrugated Packaging — FY27 Sourcing Event — pricing" }),
      candidates(),
    );
    expect(result?.rfxId).toBe(PACKAGING);
    expect(result?.matchedBy).toBe("subject");
    expect(result?.confidence).toBe("medium");
  });

  it("returns nothing for a reply it cannot place", () => {
    expect(matchMessage(mail(), candidates())).toBeNull();
  });

  it("prefers the reply token over the sender when they disagree", () => {
    // An invited packaging supplier replying to the furniture reply address is
    // answering the furniture event, whatever their sender address implies.
    const result = matchMessage(
      mail({
        to: [`procurement+${replyTokenFor(FURNITURE)}@acme.example`],
        fromEmail: "sales@vendor-a.example",
      }),
      candidates(),
    );
    expect(result?.rfxId).toBe(FURNITURE);
    expect(result?.matchedBy).toBe("reply_token");
  });

  it("ignores a short event name in a subject rather than matching loosely", () => {
    const shortNamed: MatchCandidate[] = [
      { rfxId: "short-1", rfxName: "Paper", outboundMessageIds: [], invitedEmails: [] },
    ];
    expect(matchMessage(mail({ subject: "Re: paper towels order" }), shortNamed)).toBeNull();
  });
});

describe("explaining a refusal", () => {
  it("says so when the sender is bidding on several events", () => {
    const reason = explainNoMatch(mail({ fromEmail: "desk@both-categories.example" }), candidates());
    expect(reason).toContain("2 open events");
    expect(reason).toContain("ambiguous");
  });

  it("distinguishes a question from a quotation", () => {
    const reason = explainNoMatch(mail({ attachments: [] }), candidates());
    expect(reason).toContain("question rather than a quotation");
  });

  it("suggests a forward when the sender is on no invitation list", () => {
    const reason = explainNoMatch(
      mail({
        fromEmail: "new@stranger.example",
        attachments: [{ filename: "q.pdf", contentType: "application/pdf", size: 9000, storedPath: "x/q.pdf" }],
      }),
      candidates(),
    );
    expect(reason).toContain("forwarded");
  });
});
