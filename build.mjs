import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const root = path.dirname(fileURLToPath(import.meta.url));
const headerPath = path.join(root, "src", "userscript-header.txt");
const outputDirectory = path.join(root, "dist");
const outputFile = path.join(outputDirectory, "JS_WebUtils.user.js");
const header = fs.readFileSync(headerPath, "utf8").trimEnd();

fs.mkdirSync(outputDirectory, { recursive: true });

await build({
  entryPoints: [path.join(root, "src", "main.js")],
  bundle: true,
  format: "iife",
  platform: "browser",
  target: "es2020",
  banner: { js: `${header}\n` },
  outfile: outputFile,
  charset: "utf8",
  legalComments: "none",
  sourcemap: false
});
