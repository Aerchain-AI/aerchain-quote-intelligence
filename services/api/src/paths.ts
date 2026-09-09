import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url)); // services/api/src

export const API_ROOT = path.resolve(__dirname, ".."); // services/api
export const REPO_ROOT = path.resolve(API_ROOT, "..", ".."); // repo root
export const VENDOR_DOCS_DIR = path.join(REPO_ROOT, "data", "vendor-documents");
