import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..");
const inputPath = join(root, "tinycart.js");
const outputPath = join(root, "tinycart.min.js");
const args = new Set(process.argv.slice(2));

const source = readFileSync(inputPath, "utf8");
const minified = minifyJs(source);

if (args.has("--check")) {
  if (!existsSync(outputPath)) {
    process.exit(0);
  }
  const current = readFileSync(outputPath, "utf8");
  if (current !== minified) {
    console.error("tinycart.min.js is stale. Run npm run build:min.");
    process.exit(1);
  }
  process.exit(0);
}

if (args.has("--dry-run")) {
  console.log(`${source.length} -> ${minified.length} bytes`);
  process.exit(0);
}

writeFileSync(outputPath, minified);
console.log(`Wrote tinycart.min.js (${minified.length} bytes).`);

function minifyJs(input) {
  let output = "";
  let quote = "";
  let escaped = false;
  let pendingSpace = false;

  for (let index = 0; index < input.length; index += 1) {
    const char = input[index];
    const next = input[index + 1] ?? "";

    if (quote) {
      output += char;
      if (escaped) {
        escaped = false;
      } else if (char === "\\") {
        escaped = true;
      } else if (char === quote) {
        quote = "";
      }
      continue;
    }

    if (char === "/" && next === "/") {
      while (index < input.length && input[index] !== "\n") {
        index += 1;
      }
      pendingSpace = true;
      continue;
    }

    if (char === "/" && next === "*") {
      index += 2;
      while (index < input.length && !(input[index] === "*" && input[index + 1] === "/")) {
        index += 1;
      }
      index += 1;
      pendingSpace = true;
      continue;
    }

    if (char === "'" || char === '"' || char === "`") {
      if (pendingSpace && needsSpace(output.at(-1), char)) {
        output += " ";
      }
      pendingSpace = false;
      quote = char;
      output += char;
      continue;
    }

    if (/\s/.test(char)) {
      pendingSpace = true;
      continue;
    }

    if (pendingSpace && needsSpace(output.at(-1), char)) {
      output += " ";
    }
    pendingSpace = false;
    output += char;
  }

  return output.trim() + "\n";
}

function needsSpace(previous, next) {
  if (!previous || !next) return false;
  return /[A-Za-z0-9_$]/.test(previous) && /[A-Za-z0-9_$]/.test(next);
}
