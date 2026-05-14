import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();
const read = (file) => readFileSync(join(root, file), "utf8");

for (const file of ["tinycart.js", "checkout.php", "collect.php", "README.md", "SETUP.md", "SECURITY.md", "index.html", "sample.html"]) {
  assert.ok(existsSync(join(root, file)), `${file} should exist`);
}

const js = read("tinycart.js");
for (const token of [
  "tinycart.init",
  "tinycart.add",
  "tinycart.remove",
  "tinycart.update",
  "tinycart.getCart",
  "tinycart.clear",
  "tinycart.on",
  "htmlEscape",
  "navigator.sendBeacon",
  "keepalive",
  "apiKey",
  "X-API-KEY",
  "queuePing",
  "flushQueue",
  "sanitizeOptions",
  "safeTemplate",
  "cart:updated",
  "cart:opened",
  "cart:checkedout",
  "cart:applyCoupon",
  "data-tc-config",
  "data-tc-sig",
  "localStorage"
]) {
  assert.ok(js.includes(token), `tinycart.js should include ${token}`);
}

for (const forbidden of ["innerHTML", "insertAdjacentHTML", "eval(", "new Function"]) {
  assert.ok(!js.includes(forbidden), `tinycart.js should not contain ${forbidden}`);
}
assert.ok(js.length < 40_000, "tinycart.js should stay compact enough for the MVP");

const php = read("checkout.php");
for (const token of [
  "new PDO",
  "prepare(",
  "hash_hmac",
  "hash_equals",
  "ALLOWED_ORIGINS",
  "API_KEYS",
  "rateLimit",
  "PRODUCT_CATALOG",
  "price mismatch",
  "orders.sqlite"
]) {
  assert.ok(php.includes(token), `checkout.php should include ${token}`);
}
assert.ok(!php.includes("Access-Control-Allow-Origin: *"), "checkout.php should not allow wildcard CORS");

const collect = read("collect.php");
for (const token of [
  "COLLECT_ALLOWED_ORIGINS",
  "COLLECT_API_KEYS",
  "collect_events",
  "failed_payloads",
  "prepare(",
  "rateLimit",
  "Access-Control-Allow-Origin: ",
  "MAX_PAYLOAD_BYTES",
  "hash_equals"
]) {
  assert.ok(collect.includes(token), `collect.php should include ${token}`);
}
assert.ok(!collect.includes("Access-Control-Allow-Origin: *"), "collect.php should not allow wildcard CORS");

const readme = read("README.md");
assert.ok(readme.includes("https://github.com/tanzir71/tinycartjs"), "README should use the chosen GitHub repo URL");
assert.ok(readme.includes("data-tc-id"), "README should document product buttons");

const security = read("SECURITY.md");
assert.ok(security.includes("server-side price verification"), "SECURITY should document price verification");
assert.ok(security.includes("Content-Security-Policy"), "SECURITY should include CSP guidance");

const setup = read("SETUP.md");
assert.ok(setup.includes("Namecheap"), "SETUP should include shared hosting instructions");
assert.ok(setup.includes(".htaccess"), "SETUP should include .htaccess guidance");

const index = read("index.html");
assert.ok(index.includes("https://github.com/tanzir71/tinycartjs"), "landing should link to GitHub repo");
assert.ok(index.includes("README.md") && index.includes("SECURITY.md"), "landing should link docs and security");

console.log("Static TinyCart checks passed.");
