import fs from "node:fs/promises";

export interface ParsedImage {
  mediaType: "image/jpeg" | "image/png";
  base64: string;
}

export async function parseImage(filePath: string): Promise<ParsedImage> {
  const buffer = await fs.readFile(filePath);
  const mediaType = filePath.toLowerCase().endsWith(".png") ? "image/png" : "image/jpeg";
  return { mediaType, base64: buffer.toString("base64") };
}
