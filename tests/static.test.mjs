import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();
const read = (file) => readFileSync(join(root, file), "utf8");

for (const file of [
  "tinycart.js",
  "checkout.php",
  "coupon.php",
  "payment.php",
  "catalog.php",
  "admin.php",
  "collect.php",
  "README.md",
  "SETUP.md",
  "SECURITY.md",
  "CHANGELOG.md",
  "package.json",
  "index.html",
  "sample.html",
  "examples/plain-html.html",
  "examples/wordpress-shortcode.php",
  "examples/astro-eleventy.md",
  "examples/react-wrapper.jsx",
  "scripts/minify.mjs",
  ".github/workflows/ci.yml"
]) {
  assert.ok(existsSync(join(root, file)), `${file} should exist`);
}

const js = read("tinycart.js");
for (const token of [
  "win.tinycart = api",
  "init,",
  "add,",
  "remove,",
  "update,",
  "getCart,",
  "clear,",
  "htmlEscape",
  "navigator.sendBeacon",
  "keepalive",
  "apiKey",
  "X-API-KEY",
  "locale",
  "strings",
  "STRINGS",
  "CART_VERSION",
  "queuePing",
  "flushQueue",
  "catalogUrl",
  "hydrateCatalog",
  "--tc-radius",
  "--tc-font",
  "prefers-color-scheme:dark",
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
// Raised deliberately for opt-in catalogUrl hydration and i18n strings while keeping TinyCart small.
assert.ok(js.length < 44_000, "tinycart.js should stay compact enough for the MVP");

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
  "COUPONS",
  "PAYMENT_PROVIDER",
  "createPaymentHandoff",
  "payment_status",
  "inventory",
  "reserveInventory",
  "WEBHOOK_URL",
  "dispatchOrderNotifications",
  "webhook_deliveries",
  "discount_cents",
  "price mismatch",
  "orders.sqlite"
]) {
  assert.ok(php.includes(token), `checkout.php should include ${token}`);
}
assert.ok(!php.includes("Access-Control-Allow-Origin: *"), "checkout.php should not allow wildcard CORS");

const coupon = read("coupon.php");
for (const token of [
  "COUPON_ALLOWED_ORIGINS",
  "COUPON_API_KEYS",
  "COUPONS",
  "couponRateLimit",
  "discount_cents",
  "Access-Control-Allow-Origin: "
]) {
  assert.ok(coupon.includes(token), `coupon.php should include ${token}`);
}
assert.ok(!coupon.includes("Access-Control-Allow-Origin: *"), "coupon.php should not allow wildcard CORS");

const payment = read("payment.php");
for (const token of [
  "STRIPE_WEBHOOK_SECRET",
  "stripePaidOrder",
  "paypalCapturePaidOrder",
  "markOrderPaid",
  "payment_status = 'paid'"
]) {
  assert.ok(payment.includes(token), `payment.php should include ${token}`);
}

const catalog = read("catalog.php");
for (const token of [
  "CATALOG_ALLOWED_ORIGINS",
  "PRODUCT_CATALOG",
  "Cache-Control: public, max-age=60",
  "catalogItems",
  "Access-Control-Allow-Origin: "
]) {
  assert.ok(catalog.includes(token), `catalog.php should include ${token}`);
}
assert.ok(!catalog.includes("Access-Control-Allow-Origin: *"), "catalog.php should not allow wildcard CORS");

const admin = read("admin.php");
for (const token of [
  "ADMIN_ALLOWED_ORIGINS",
  "ADMIN_PASSWORD_HASH",
  "ADMIN_API_KEYS",
  "fetchAdminOrders",
  "renderAdminPage",
  "htmlspecialchars",
  "Access-Control-Allow-Origin: "
]) {
  assert.ok(admin.includes(token), `admin.php should include ${token}`);
}
assert.ok(!admin.includes("Access-Control-Allow-Origin: *"), "admin.php should not allow wildcard CORS");
assert.ok(!/(INSERT|UPDATE|DELETE|DROP|ALTER|CREATE TABLE|exec\s*\()/i.test(admin), "admin.php should stay read-only");

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
assert.ok(readme.includes("img.shields.io"), "README should include a release/status badge");
assert.ok(readme.includes("cdn.jsdelivr.net/gh/tanzir71/tinycartjs"), "README should document jsDelivr usage");
assert.ok(readme.includes("tinycart.min.js"), "README should document the optional minified build");

const changelog = read("CHANGELOG.md");
assert.ok(changelog.includes("## 0.2.0 - 2026-07-04"), "CHANGELOG should include the current release entry");

const pkg = JSON.parse(read("package.json"));
assert.equal(pkg.name, "tinycartjs");
assert.equal(pkg.version, "0.2.0");
assert.deepEqual(pkg.dependencies ?? {}, {}, "package.json should not add runtime dependencies");
assert.deepEqual(pkg.devDependencies ?? {}, {}, "package.json should not add dev dependencies");
assert.ok(pkg.files.includes("tinycart.js"), "package.json should publish tinycart.js");
assert.equal(pkg.scripts["build:min"], "node scripts/minify.mjs", "package.json should expose the no-dependency minify helper");

const plainExample = read("examples/plain-html.html");
assert.ok(plainExample.includes("data-tc-config") && plainExample.includes("catalogUrl"), "plain HTML example should use TinyCart config");

const wordpressExample = read("examples/wordpress-shortcode.php");
assert.ok(wordpressExample.includes("add_shortcode") && wordpressExample.includes("data-tc-id"), "WordPress example should include a shortcode product button");

const staticSiteExample = read("examples/astro-eleventy.md");
assert.ok(staticSiteExample.includes("Astro") && staticSiteExample.includes("Eleventy") && staticSiteExample.includes("data-tc-options"), "static site example should cover Astro and Eleventy");

const reactExample = read("examples/react-wrapper.jsx");
assert.ok(reactExample.includes("useEffect") && reactExample.includes("window.tinycart.init") && reactExample.includes("data-tc-id"), "React example should initialize TinyCart without adding it as a dependency");

const security = read("SECURITY.md");
assert.ok(security.includes("server-side price verification"), "SECURITY should document price verification");
assert.ok(security.includes("Content-Security-Policy"), "SECURITY should include CSP guidance");

const setup = read("SETUP.md");
assert.ok(setup.includes("Namecheap"), "SETUP should include shared hosting instructions");
assert.ok(setup.includes(".htaccess"), "SETUP should include .htaccess guidance");

const ci = read(".github/workflows/ci.yml");
assert.ok(ci.includes("node --test tests/*.test.mjs"), "CI should run the Node test suite");
assert.ok(ci.includes("node tests/static.test.mjs"), "CI should run static invariants");
assert.ok(ci.includes("php -l"), "CI should lint PHP files");
assert.ok(ci.includes("tinycart.js"), "CI should check the TinyCart byte size");
assert.ok(ci.includes("44000"), "CI should preserve the documented byte-size ceiling");

const index = read("index.html");
assert.ok(index.includes("https://github.com/tanzir71/tinycartjs"), "landing should link to GitHub repo");
assert.ok(index.includes("README.md") && index.includes("SECURITY.md"), "landing should link docs and security");

console.log("Static TinyCart checks passed.");
