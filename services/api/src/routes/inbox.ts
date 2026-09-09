import { Router } from "express";
import { assignMessage, responseLedger, syncInbox, unmatchedMessages } from "../inbox/ingest.js";
import { resolveTransport } from "../inbox/transport.js";

export const inboxRouter = Router();

/**
 * Reading supplier replies out of the inbox.
 *
 * Sync is an explicit action rather than a background poller. A prototype that
 * silently reaches into a mailbox on a timer is hard to reason about and worse
 * to demo; a buyer pressing "check for replies" and watching what came back is
 * both clearer and easier to trust.
 */

inboxRouter.get("/inbox/status", (_req, res) => {
  const transport = resolveTransport();
  res.json({
    transport: transport.name,
    description: transport.describe(),
    connected: transport.name === "imap",
    inboxAddress: process.env.INBOX_ADDRESS ?? null,
  });
});

inboxRouter.post("/inbox/sync", async (req, res) => {
  try {
    const limit = Number(req.body?.limit ?? 25);
    res.json(await syncInbox({ limit: Number.isFinite(limit) ? limit : 25 }));
  } catch (err) {
    res.status(502).json({
      error: "Could not read the inbox.",
      detail: (err as Error).message,
    });
  }
});

/** Who was invited, who answered, and with what. */
inboxRouter.get("/rfx/:id/responses", async (req, res) => {
  try {
    res.json(await responseLedger(req.params.id));
  } catch (err) {
    res.status(404).json({ error: "Could not build the response ledger.", detail: (err as Error).message });
  }
});

/** Mail that arrived but could not be placed. */
inboxRouter.get("/inbox/unmatched", async (_req, res) => {
  res.json(await unmatchedMessages());
});

/** A buyer placing a message the matcher would not place on its own. */
inboxRouter.post("/inbox/messages/:messageId/assign", async (req, res) => {
  const rfxId = String(req.body?.rfxId ?? "").trim();
  const supplierId = req.body?.supplierId ? String(req.body.supplierId) : null;
  if (!rfxId) return res.status(400).json({ error: "rfxId is required." });
  try {
    res.json(await assignMessage(req.params.messageId, rfxId, supplierId));
  } catch (err) {
    res.status(400).json({ error: "Could not assign that message.", detail: (err as Error).message });
  }
});
