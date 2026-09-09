import fs from "node:fs/promises";

export async function parseText(filePath: string): Promise<string> {
  return fs.readFile(filePath, "utf-8");
}
