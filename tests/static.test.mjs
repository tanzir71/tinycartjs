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
  "site.css",
  "docs.html",
  "setup.html",
  "security.html",
  "compare.html",
  "shopify-buy-button-alternative.html",
  "snipcart-alternative.html",
  "gumroad-alternative.html",
  "stripe-payment-links-alternative.html",
  "sample.html",
  "examples/plain-html.html",
  "examples/wordpress-shortcode.php",
  "examples/astro-eleventy.md",
  "examples/react-wrapper.jsx",
  "scripts/minify.mjs",
  ".github/workflows/ci.yml",
  ".github/workflows/pages.yml",
  ".nojekyll"
]) {
  assert.ok(existsSync(join(root, file)), `${file} should exist`);
}

const js = read("tinycart.js").replace(/\r\n/g, "\n");
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
assert.ok(js.length < 48_000, "tinycart.js should stay compact enough for the MVP");

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
  "ENABLED_PAYMENT_METHODS",
  "DEFAULT_PAYMENT_METHOD",
  "createPaymentHandoff",
  "payment_method",
  "payment_status",
  "fulfillment_status",
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
  "couponOverrideActive",
  "coupon_overrides",
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
  "requireAdminCsrf",
  "adminCsrfToken",
  "fetchAdminOrders",
  "updateAdminOrderStatus",
  "markAdminCodCollected",
  "updateAdminInventoryStock",
  "setAdminCouponOverride",
  "retryAdminWebhook",
  "renderAdminCsv",
  "coupon_overrides",
  "webhook_deliveries",
  "Fulfillment",
  "Cash collected",
  "renderAdminPage",
  "htmlspecialchars",
  "Access-Control-Allow-Origin: "
]) {
  assert.ok(admin.includes(token), `admin.php should include ${token}`);
}
assert.ok(!admin.includes("Access-Control-Allow-Origin: *"), "admin.php should not allow wildcard CORS");
assert.ok(!/(DROP|exec\s*\()/i.test(admin), "admin.php should avoid destructive SQL and shell execution");
assert.ok(admin.includes("prepare("), "admin.php should use prepared SQL for dashboard writes");

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
for (const token of ["Architecture at a Glance", "Checkout Payload and Response", "Status Reference", "Recommended daily flow", "Troubleshooting"]) {
  assert.ok(readme.includes(token), `README should include detailed docs for ${token}`);
}

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
assert.doesNotMatch(stripLiquidRawBlocks(staticSiteExample), /{%\s*(?!raw|endraw)\w+/,
  "Jekyll-rendered Markdown examples must wrap framework Liquid-like tags in raw blocks");
for (const [file, markdown] of [["README.md", readme], ["examples/astro-eleventy.md", staticSiteExample]]) {
  assert.doesNotMatch(stripLiquidRawBlocks(markdown), /({%\s*(?!raw|endraw)\w+)|({{\s*[\w.]+)/,
    `${file} must wrap Liquid-like examples in raw blocks for GitHub Pages`);
}

const reactExample = read("examples/react-wrapper.jsx");
assert.ok(reactExample.includes("useEffect") && reactExample.includes("window.tinycart.init") && reactExample.includes("data-tc-id"), "React example should initialize TinyCart without adding it as a dependency");

const security = read("SECURITY.md");
assert.ok(security.includes("server-side price verification"), "SECURITY should document price verification");
assert.ok(security.includes("Content-Security-Policy"), "SECURITY should include CSP guidance");

const setup = read("SETUP.md");
assert.ok(setup.includes("Namecheap"), "SETUP should include shared hosting instructions");
assert.ok(setup.includes(".htaccess"), "SETUP should include .htaccess guidance");
for (const token of ["Recommended File Layout", "Endpoint Configuration Details", "Daily operator runbook", "Suggested status meanings", "Troubleshooting"]) {
  assert.ok(setup.includes(token), `SETUP should include detailed setup docs for ${token}`);
}

const ci = read(".github/workflows/ci.yml");
assert.ok(ci.includes("node --test tests/*.test.mjs"), "CI should run the Node test suite");
assert.ok(ci.includes("node tests/static.test.mjs"), "CI should run static invariants");
assert.ok(ci.includes("php -l"), "CI should lint PHP files");
assert.ok(ci.includes("tinycart.js"), "CI should check the TinyCart byte size");
assert.ok(ci.includes("48000"), "CI should preserve the documented byte-size ceiling");

const pagesWorkflow = read(".github/workflows/pages.yml");
assert.ok(pagesWorkflow.includes("actions/configure-pages@v5"), "Pages workflow should configure GitHub Pages");
assert.ok(pagesWorkflow.includes("actions/upload-pages-artifact@v3"), "Pages workflow should upload a Pages artifact");
assert.ok(pagesWorkflow.includes("actions/deploy-pages@v5"), "Pages workflow should deploy with the official Pages action");
assert.ok(pagesWorkflow.includes("touch _site/.nojekyll"), "Pages workflow should bypass Jekyll for the static docs site");
assert.ok(!pagesWorkflow.includes("checkout.php"), "Pages workflow should not publish server endpoints");
assert.ok(!pagesWorkflow.includes("tests/"), "Pages workflow should not publish test files");

const index = read("index.html");
const publicHtmlPages = [
  "index.html",
  "docs.html",
  "setup.html",
  "security.html",
  "compare.html",
  "shopify-buy-button-alternative.html",
  "snipcart-alternative.html",
  "gumroad-alternative.html",
  "stripe-payment-links-alternative.html"
];
for (const page of publicHtmlPages) {
  assert.ok(read(page).includes('rel="icon" type="image/svg+xml"'), `${page} should declare the TinyCart SVG favicon`);
}
assert.ok(index.includes("https://github.com/tanzir71/tinycartjs"), "landing should link to GitHub repo");
for (const page of ["docs.html", "setup.html", "security.html", "compare.html"]) {
  assert.ok(index.includes(`href="${page}"`), `landing should link to ${page}`);
}
assert.doesNotMatch(index, /href="(?:README|SETUP|SECURITY)\.md"/, "landing should not send public docs traffic to Markdown files");
assert.ok(index.includes("max-width: 760px"), "landing should use a compact hero measure");
assert.ok(index.includes("clamp(40px, 6.4vw, 72px)"), "landing headline should avoid oversized display text");
assert.ok(index.includes("clamp(44px, 7vw, 76px)"), "landing sections should keep tighter vertical rhythm");
assert.ok(index.includes("scrollbar-color: var(--fg) var(--soft)"), "landing scrollbar should match the site design");
const heroDiagram = index.match(/<svg class="tc-diagram"[\s\S]*?<\/svg>/)?.[0] ?? "";
assert.ok(heroDiagram, "hero should use the refined TinyCart diagram");
assert.ok(heroDiagram.includes('vector-effect="non-scaling-stroke"'), "hero diagram should keep crisp non-scaling hairlines");
assert.doesNotMatch(heroDiagram, /stroke-width="2"/, "hero diagram should avoid thick mockup strokes");
assert.doesNotMatch(heroDiagram, /stroke-dasharray/, "hero diagram should avoid dotted connector lines");
assert.ok(heroDiagram.includes("TC/CART"), "hero diagram should read as a precise TinyCart schematic");
for (const token of [
  "Cash, cards, and fulfilment in one quiet dashboard",
  "Payments",
  "Orders",
  "Fulfilment",
  "Shipping, tax, refunds",
  "manual"
]) {
  assert.ok(index.includes(token), `landing should explain ${token} in the shopping flow`);
}

const siteCss = read("site.css");
for (const token of ["scrollbar-color: var(--fg) var(--soft)", ".diagram-wrap", ".comparison-table", ".doc-shell"]) {
  assert.ok(siteCss.includes(token), `site.css should include ${token}`);
}

const docsHtml = read("docs.html");
for (const token of ["TinyCart Docs", "data-tc-id", "tinycart.init", "apiCheckout", "catalogUrl", "Developer API"]) {
  assert.ok(docsHtml.includes(token), `docs.html should include ${token}`);
}
for (const token of [
  "Checkout payload and response",
  "Shopping cart flows",
  "Status reference",
  "Payment flow",
  "Order records",
  "Fulfilment is manual",
  "Shipping, tax, refunds",
  "Server endpoints",
  "Troubleshooting",
  "webhook",
  "ORDER_EMAIL_TO"
]) {
  assert.ok(docsHtml.includes(token), `docs.html should explain ${token}`);
}
assert.ok(docsHtml.includes("setup.html") && docsHtml.includes("security.html") && docsHtml.includes("compare.html"),
  "docs.html should link setup, security, and comparisons");
assert.doesNotMatch(docsHtml, /href="README\.md"/, "docs page should not route readers back to README.md");

const setupHtml = read("setup.html");
for (const token of ["TinyCart Setup", "Namecheap", "public_html/tinycart", ".htaccess", "ALLOWED_ORIGINS", "Recommended file layout", "Go-live checks", "Troubleshooting", "Webhook retries"]) {
  assert.ok(setupHtml.includes(token), `setup.html should include ${token}`);
}

const securityHtml = read("security.html");
for (const token of ["TinyCart Security", "server-side price verification", "Content-Security-Policy", "HMAC", "Do not expose"]) {
  assert.ok(securityHtml.includes(token), `security.html should include ${token}`);
}

const compareHtml = read("compare.html");
for (const token of ["TinyCart Compare", "Shopify Buy Button", "Snipcart", "Gumroad", "Stripe Payment Links"]) {
  assert.ok(compareHtml.includes(token), `compare.html should include ${token}`);
}

for (const [file, competitor] of [
  ["shopify-buy-button-alternative.html", "Shopify Buy Button"],
  ["snipcart-alternative.html", "Snipcart"],
  ["gumroad-alternative.html", "Gumroad"],
  ["stripe-payment-links-alternative.html", "Stripe Payment Links"]
]) {
  const html = read(file);
  assert.ok(html.includes(`${competitor} alternative`), `${file} should have a focused alternative title`);
  assert.ok(html.includes("TinyCart is a better fit") && html.includes("compare.html"), `${file} should link back to the comparison hub`);
}

assert.ok(js.includes("--tc-bg:#fff"), "cart widget should default to light mode");
assert.ok(js.includes(".tc-dialog{position:fixed;inset:auto 12px 12px 12px"), "cart modal should use compact mobile spacing");
assert.match(js, /\.tc-dialog\{[^}]*padding:0/, "cart modal should neutralize host section padding");
assert.ok(js.includes(".tc-body{overflow:auto;scrollbar-color:var(--tc-fg,#111) var(--tc-soft,#f7f7f7);"), "cart modal should style its scrollbar");
assert.ok(js.includes(".tc-form{display:grid;gap:8px;margin-top:8px;padding-top:10px"), "checkout form spacing should stay compact");
assert.ok(!js.includes("prefers-color-scheme:dark"), "cart widget should not force a dark theme by media query");

console.log("Static TinyCart checks passed.");

function stripLiquidRawBlocks(markdown) {
  return markdown.replace(/{%\s*raw\s*%}[\s\S]*?{%\s*endraw\s*%}/g, "");
}
