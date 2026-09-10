import { Router } from "express";
import { prisma } from "../db.js";
import { buildAwardOptions, recordAwardDecision } from "../award/options.js";
import { buildAwardRecommendation } from "../award/recommend.js";
import { loadComparisonDataset } from "../calc/dataset.js";
import { EXPLAINABLE_FIGURES, explainFigure } from "../calc/derivation.js";
import { buildAwardMemoPdf, buildComparisonWorkbook, exportFileNames } from "../export/exports.js";
import { summarizeExceptions } from "../calc/engine.js";
import { PORTFOLIO_FIGURES, buildPortfolioMetrics, explainPortfolioFigure } from "../calc/portfolio.js";
import { answerQuestion } from "../copilot/answer.js";
import { measureExtractionAccuracy } from "../metrics/accuracy.js";
import { buildImpactReport } from "../metrics/impact.js";

export const analysisRouter = Router();

// PRD §19 — the copilot. Intent parsing and explanation use the LLM; every
// number in the answer comes from the deterministic engine.
analysisRouter.post("/rfx/:id/copilot", async (req, res) => {
  const question = String(req.body?.question ?? "").trim();
  if (!question) return res.status(400).json({ error: "A question is required." });
  try {
    const dataset = await loadComparisonDataset(req.params.id);
    const answer = await answerQuestion(dataset, question);
    res.json(answer);
  } catch (err) {
    res.status(502).json({ error: "The copilot could not complete that request.", detail: (err as Error).message });
  }
});

// PRD §22 — award recommendation. Fully deterministic; no LLM involved.
analysisRouter.get("/rfx/:id/award", async (req, res) => {
  const dataset = await loadComparisonDataset(req.params.id);
  res.json(buildAwardRecommendation(dataset));
});

/**
 * Taking the analysis out of the app.
 *
 * Generated on demand from the stored event, so an export can never drift from
 * what the screen shows, and both carry the same caveats.
 */
analysisRouter.get("/rfx/:id/export/comparison.xlsx", async (req, res) => {
  try {
    const rfx = await prisma.rfx.findUniqueOrThrow({ where: { id: req.params.id }, select: { name: true } });
    const book = await buildComparisonWorkbook(req.params.id);
    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    res.setHeader("Content-Disposition", `attachment; filename="${exportFileNames(rfx.name).xlsx}"`);
    res.send(book);
  } catch (err) {
    res.status(404).json({ error: "Could not build the comparison workbook.", detail: (err as Error).message });
  }
});

analysisRouter.get("/rfx/:id/export/award-memo.pdf", async (req, res) => {
  try {
    const rfx = await prisma.rfx.findUniqueOrThrow({ where: { id: req.params.id }, select: { name: true } });
    const pdf = await buildAwardMemoPdf(req.params.id);
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `inline; filename="${exportFileNames(rfx.name).pdf}"`);
    res.send(pdf);
  } catch (err) {
    res.status(404).json({ error: "Could not build the award memo.", detail: (err as Error).message });
  }
});

/**
 * Portfolio headlines for the sourcing register, and their derivations.
 *
 * Summed across events by the same engine, for the same reason as everything
 * else: a number on a dashboard that nobody can trace back to a quote is a
 * number nobody should act on.
 */
analysisRouter.get("/portfolio/metrics", async (_req, res) => {
  try {
    res.json(await buildPortfolioMetrics());
  } catch (err) {
    res.status(500).json({ error: "Could not compute portfolio metrics.", detail: (err as Error).message });
  }
});

analysisRouter.get("/portfolio/explain/:figure", async (req, res) => {
  const derivation = await explainPortfolioFigure(req.params.figure);
  if (!derivation) {
    return res
      .status(404)
      .json({ error: `No derivation is defined for "${req.params.figure}".`, available: PORTFOLIO_FIGURES });
  }
  res.json(derivation);
});

/**
 * "Why is this number what it is?"
 *
 * Any figure on screen can be opened up into the arithmetic behind it. This is
 * pure engine code — the same functions that produced the number produce the
 * explanation, and the response carries independent recomputations that have to
 * agree with it. Deliberately never routed through the language model: a buyer
 * awarding a contract needs a derivation that cannot be paraphrased wrongly.
 */
analysisRouter.get("/rfx/:id/explain/:figure", async (req, res) => {
  const { figure } = req.params;
  if (!(EXPLAINABLE_FIGURES as readonly string[]).includes(figure)) {
    return res.status(404).json({
      error: `No derivation is defined for "${figure}".`,
      available: EXPLAINABLE_FIGURES,
    });
  }
  const dataset = await loadComparisonDataset(req.params.id);
  const vendorId = typeof req.query.vendorId === "string" ? req.query.vendorId : undefined;
  const derivation = explainFigure(dataset, figure, { vendorId });
  if (!derivation) {
    return res.status(404).json({
      error: `"${figure}" could not be derived for this event — the inputs it needs are not present.`,
    });
  }
  res.json(derivation);
});

/**
 * Every vendor the buyer could award to, and what they decided.
 *
 * The recommendation is the engine's answer. This is the set the buyer chooses
 * from, because a screen that only shows the computed answer has quietly made
 * the engine the decider.
 */
analysisRouter.get("/rfx/:id/award/options", async (req, res) => {
  try {
    const dataset = await loadComparisonDataset(req.params.id);
    res.json(await buildAwardOptions(dataset));
  } catch (err) {
    res.status(404).json({ error: "Could not build the award options.", detail: (err as Error).message });
  }
});

analysisRouter.post("/rfx/:id/award/decision", async (req, res) => {
  const vendorIds: string[] = Array.isArray(req.body?.vendorIds) ? req.body.vendorIds.map(String) : [];
  try {
    const result = await recordAwardDecision(req.params.id, {
      vendorIds,
      reason: req.body?.reason ?? null,
      decidedBy: req.body?.decidedBy ?? null,
    });
    res.status(201).json(result);
  } catch (err) {
    res.status(400).json({ error: (err as Error).message });
  }
});

// PRD §18 — exception centre.
analysisRouter.get("/rfx/:id/exceptions", async (req, res) => {
  const dataset = await loadComparisonDataset(req.params.id);
  const { type, severity, vendorId } = req.query as Record<string, string | undefined>;
  const filtered = dataset.exceptions.filter(
    (e) => (!type || e.type === type) && (!severity || e.severity === severity) && (!vendorId || e.vendorId === vendorId),
  );
  res.json({
    summary: summarizeExceptions(dataset),
    exceptions: filtered.map((e) => ({
      ...e,
      vendorName: dataset.vendors.find((v) => v.id === e.vendorId)?.name ?? null,
      lineItemName: e.lineItemId ? (dataset.lineItems.find((li) => li.id === e.lineItemId)?.name ?? null) : null,
    })),
  });
});

// Procurement impact panel — each metric labelled measured or target.
analysisRouter.get("/rfx/:id/metrics", async (req, res) => {
  const dataset = await loadComparisonDataset(req.params.id);
  res.json(buildImpactReport(dataset));
});

// Extraction accuracy against the generated documents' known ground truth.
analysisRouter.get("/rfx/:id/accuracy", async (req, res) => {
  const dataset = await loadComparisonDataset(req.params.id);
  res.json(measureExtractionAccuracy(dataset));
});
