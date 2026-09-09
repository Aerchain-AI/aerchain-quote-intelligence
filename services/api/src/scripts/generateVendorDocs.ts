import fs from "node:fs";
import path from "node:path";
import { VENDOR_DOCS_DIR } from "../paths.js";
import { generateVendorA } from "./docgen/vendorA.js";
import { generateVendorB } from "./docgen/vendorB.js";
import { generateVendorC } from "./docgen/vendorC.js";
import { generateVendorD } from "./docgen/vendorD.js";
import { generateVendorE } from "./docgen/vendorE.js";

async function main() {
  fs.mkdirSync(VENDOR_DOCS_DIR, { recursive: true });

  const targets: Array<{ label: string; file: string; run: (p: string) => Promise<void> }> = [
    { label: "Vendor A (xlsx)", file: "vendor-a-quote.xlsx", run: generateVendorA },
    { label: "Vendor B (pdf)", file: "vendor-b-quote.pdf", run: generateVendorB },
    { label: "Vendor C (docx)", file: "vendor-c-quote.docx", run: generateVendorC },
    { label: "Vendor D (jpg)", file: "vendor-d-quote.jpg", run: generateVendorD },
    { label: "Vendor E (txt)", file: "vendor-e-quote.txt", run: generateVendorE },
  ];

  for (const t of targets) {
    const outPath = path.join(VENDOR_DOCS_DIR, t.file);
    await t.run(outPath);
    const size = fs.statSync(outPath).size;
    console.log(`✓ ${t.label} -> ${outPath} (${size} bytes)`);
  }

  console.log(`\nAll 5 vendor documents generated in ${VENDOR_DOCS_DIR}`);
}

main().catch((err) => {
  console.error("Failed to generate vendor documents:", err);
  process.exit(1);
});
