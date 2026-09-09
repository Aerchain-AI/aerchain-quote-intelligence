import fs from "node:fs";
import path from "node:path";
import cors from "cors";
import dotenv from "dotenv";
import express from "express";
import { bootstrapDatabase } from "./bootstrap.js";
import { REPO_ROOT } from "./paths.js";
import { analysisRouter } from "./routes/analysis.js";
import { comparisonRouter } from "./routes/comparison.js";
import { healthRouter } from "./routes/health.js";
import { issueRouter } from "./routes/issue.js";
import { rfxRouter } from "./routes/rfx.js";
import { vendorsRouter } from "./routes/vendors.js";

// Local runs read the repo-root .env. A deployed instance has no such file and
// takes its configuration from real environment variables instead, which is why
// nothing here fails when the file is absent.
dotenv.config({ path: path.join(REPO_ROOT, ".env") });

bootstrapDatabase();

const app = express();
app.use(cors());
app.use(express.json({ limit: "50mb" }));

app.use(healthRouter);
app.use("/api", rfxRouter);
app.use("/api", vendorsRouter);
app.use("/api", comparisonRouter);
app.use("/api", analysisRouter);
app.use("/api", issueRouter);

/**
 * In production the API also serves the built front end, so the whole prototype
 * is one process on one port and one URL. In development it does not: Vite owns
 * :5173 and proxies /api here, which keeps hot reloading intact.
 */
const WEB_DIST = path.join(REPO_ROOT, "apps", "web", "dist");
if (fs.existsSync(path.join(WEB_DIST, "index.html"))) {
  // Hashed asset filenames are safe to cache hard; index.html never is, or a
  // returning viewer gets yesterday's build pointing at deleted bundles.
  app.use(express.static(WEB_DIST, { index: false, maxAge: "1y" }));

  app.get("*", (req, res, next) => {
    if (req.path.startsWith("/api")) return next();
    res.set("Cache-Control", "no-store");
    res.sendFile(path.join(WEB_DIST, "index.html"));
  });
  console.log("[server] Serving the built front end from apps/web/dist");
} else {
  console.log("[server] No front-end build found — API only. Run the web dev server separately.");
}

const port = Number(process.env.PORT ?? 4000);
app.listen(port, () => {
  console.log(`Aerchain listening on http://localhost:${port}`);
});
