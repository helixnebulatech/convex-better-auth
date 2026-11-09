#!/usr/bin/env node
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import path from "node:path";

const root = path.join(import.meta.dirname, "..");
const { version } = JSON.parse(
  readFileSync(path.join(root, "package.json"), "utf-8")
);

const srcPath = path.join(root, "src/version.ts");
writeFileSync(srcPath, `export const VERSION = "${version}";\n`);

const distPath = path.join(root, "dist/version.js");
if (existsSync(distPath)) {
  const existing = readFileSync(distPath, "utf-8");
  const mapMatch = existing.match(/\n\/\/# sourceMappingURL=.*$/);
  const tail = mapMatch ? mapMatch[0] : "";
  writeFileSync(distPath, `export const VERSION = "${version}";${tail}\n`);
}
