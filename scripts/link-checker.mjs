import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join, normalize, relative, sep } from "node:path";

const root = process.cwd();
const checkExternal = process.argv.includes("--external");
const tracked = gitFiles();
const htmlPages = tracked.filter((file) => file.endsWith(".html"));
const failures = [];
let checked = 0;
let skippedExternal = 0;

for (const page of htmlPages) {
  const html = read(page);
  for (const href of linksIn(html)) {
    if (shouldSkip(href)) continue;
    checked += 1;
    if (/^https?:\/\//i.test(href)) {
      if (checkExternal) {
        await checkHttp(page, href);
      } else {
        skippedExternal += 1;
      }
      continue;
    }
    checkLocal(page, href);
  }
}

if (failures.length) {
  for (const failure of failures) console.error(failure);
  process.exit(1);
}

console.log(`Checked ${checked} links across ${htmlPages.length} HTML pages.`);
if (skippedExternal) {
  console.log(`Skipped ${skippedExternal} external links; pass --external to probe them.`);
}

function read(file) {
  return readFileSync(join(root, file), "utf8");
}

function linksIn(html) {
  return [...html.matchAll(/\bhref\s*=\s*["']([^"']+)["']/gi)].map((match) => match[1].trim());
}

function shouldSkip(href) {
  return href === ""
    || href.startsWith("mailto:")
    || href.startsWith("tel:")
    || href.startsWith("javascript:")
    || href.startsWith("data:");
}

function checkLocal(fromPage, href) {
  const [withoutHash, hash = ""] = href.split("#");
  const withoutQuery = withoutHash.split("?")[0];
  const targetRel = withoutQuery === ""
    ? fromPage
    : normalize(join(dirname(fromPage), decodeURIComponent(withoutQuery))).replaceAll("\\", "/");
  if (targetRel.startsWith("..") || targetRel.includes(`${sep}..${sep}`)) {
    failures.push(`${fromPage}: ${href} escapes the repo root`);
    return;
  }
  const targetAbs = join(root, targetRel);
  if (!existsSync(targetAbs)) {
    failures.push(`${fromPage}: missing local link target ${href}`);
    return;
  }
  if (hash && !hasAnchor(targetRel, decodeURIComponent(hash))) {
    failures.push(`${fromPage}: missing anchor #${hash} in ${targetRel}`);
  }
}

function hasAnchor(file, anchor) {
  const source = read(file);
  if (/\.(html|php)$/i.test(file)) {
    const escaped = escapeRegExp(anchor);
    return new RegExp(`\\b(?:id|name)=["']${escaped}["']`, "i").test(source);
  }
  if (/\.md$/i.test(file)) {
    const slugs = new Set(
      [...source.matchAll(/^#{1,6}\s+(.+)$/gm)].map((match) => slugHeading(match[1]))
    );
    return slugs.has(anchor);
  }
  return true;
}

async function checkHttp(fromPage, href) {
  try {
    const status = await httpStatus(href, "HEAD");
    if (status < 400 || [401, 403, 405, 429].includes(status)) return;
    const getStatus = await httpStatus(href, "GET");
    if (getStatus < 400 || [401, 403, 429].includes(getStatus)) return;
    failures.push(`${fromPage}: external link ${href} returned HTTP ${getStatus}`);
  } catch (error) {
    failures.push(`${fromPage}: external link ${href} failed: ${error.message}`);
  }
}

async function httpStatus(href, method) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15000);
  try {
    const response = await fetch(href, {
      method,
      redirect: "follow",
      signal: controller.signal,
      headers: { "User-Agent": "tinycart-link-checker/1.0" }
    });
    return response.status;
  } finally {
    clearTimeout(timeout);
  }
}

function gitFiles() {
  try {
    return execFileSync("git", ["ls-files"], { cwd: root, encoding: "utf8" })
      .split(/\r?\n/)
      .filter(Boolean);
  } catch {
    return walk(root).filter((file) => file.endsWith(".html"));
  }
}

function walk(dir) {
  const files = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === ".git" || entry.name === "node_modules") continue;
    const abs = join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...walk(abs));
    } else {
      files.push(relative(root, abs).replaceAll("\\", "/"));
    }
  }
  return files;
}

function slugHeading(value) {
  return value
    .replace(/<[^>]+>/g, "")
    .replace(/[`*_~[\]()]/g, "")
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9\s-]/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-");
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

assert.ok(htmlPages.length > 0, "expected tracked HTML pages");
