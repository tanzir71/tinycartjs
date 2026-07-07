# TinyCart — Codex Handoff: Full Refinement Plan (v2, 2026-07)

This document is written for an autonomous coding agent (Codex) running in a loop.
It supersedes `POLISH_AND_ROADMAP.md` for prioritization (that file's Phases 1–4 are
mostly shipped in v0.2.0 — verify, don't redo). The goal of this pass is different:

> **Make TinyCart look and feel like a product people trust with money.**
> The code is solid; the landing page and widget UI currently read as a weekend
> project. Close that gap, then add the small features competitors make people
> pay for.

Everything here must be implementable by a beginner: exact files, exact commands,
no build tooling, no frameworks.

---

## 1. Loop protocol (how Codex should run this file)

Repeat until every checkbox in Section 6 is checked:

1. Read Section 6 top to bottom. Pick the **first unchecked task**.
2. Re-read the task's Acceptance list. That is the definition of done.
3. Implement in the smallest diff that passes. One task = one commit.
4. Run the verification loop (below). If anything fails, fix before moving on.
5. Check the box in this file, commit with message `task(<id>): <summary>`.
6. Go to step 1. If a task conflicts with an invariant (Section 2), **skip it,
   leave the box unchecked, and append a note under Section 8** instead of
   breaking the invariant.

### Verification loop (run after every task)

```bash
node --test tests/*.test.mjs        # unit + widget tests
node tests/static.test.mjs          # structural/security invariants
php -l checkout.php && php -l coupon.php && php -l payment.php \
  && php -l catalog.php && php -l admin.php && php -l collect.php
php -S 127.0.0.1:8000               # manual spot-check pages in a browser
```

For any landing-page task, also open `index.html` at 375px, 768px, and 1280px
widths and confirm nothing overflows or overlaps.

---

## 2. Non-negotiable invariants (do not regress — enforced by tests)

1. **No untrusted HTML.** `tinycart.js` must never contain `innerHTML`,
   `insertAdjacentHTML`, `eval(`, or `new Function`. DOM via
   `createElement`/`textContent` only.
2. **Server is truth.** Client price/name/total/coupon/stock are display data;
   `checkout.php` re-prices from `PRODUCT_CATALOG`.
3. **No wildcard CORS** in any PHP endpoint.
4. **Size ceiling.** `tinycart.js` < 48,000 bytes (test-enforced).
   ⚠️ **Current size is 47,432 bytes — only ~570 bytes of headroom.**
   Rule for this pass: any widget change that adds bytes must first *recover*
   bytes (dedupe strings, shorten injected CSS, remove dead branches). If a
   feature genuinely can't fit, put it in a new **opt-in** file
   (`tinycart-extras.js`) loaded only when configured — never raise the ceiling
   without an explicit note in Section 8.
5. **Zero build, zero runtime deps.** Vanilla JS + PHP + SQLite. `jsdom`-class
   devDependencies for tests are fine; nothing ships to users.
6. **Privacy first.** Analytics optional and PII-free. No third-party requests
   from the landing pages except the ones we explicitly remove in task A2.

---

## 3. Current-state audit (why the site "doesn't inspire confidence")

Findings from a full read of the repo at v0.2.0:

**Landing page (`index.html`)**
- The hero visual is an abstract wireframe SVG. Nothing on the page *looks like
  a store*. Visitors can't picture the product. Competitors lead with a
  screenshot of a cart or dashboard.
- The live demo works but is invisible: three unstyled text rows with no product
  images, no screenshots of `admin.php`, no "what the buyer sees" flow.
- Zero social proof: no GitHub stars badge, no screenshots, no FAQ, no
  "who is this for", no license/security reassurance above the fold.
- No Open Graph / Twitter meta → sharing the link produces a blank card, which
  reads as abandoned.
- No dark mode; loads Inter from Google Fonts (external request, layout shift,
  contradicts the "privacy-friendly" footer claim).
- `index.html` carries ~340 lines of inline CSS while every other page uses
  `site.css` → two diverging design systems in one small site.
- `docs.html` (and possibly other pages) starts with a UTF-8 BOM (`﻿`), which
  can render as a stray character.
- No 404 page, no `sitemap.xml`, no `robots.txt`, no PNG favicon fallback.

**Widget UI (`tinycart.js` injected styles)**
- Functional but visually generic: no item images, `x` close glyph instead of a
  proper icon, no empty-cart illustration, no success screen (checkout ends in a
  toast — buyers expect an order confirmation with an order ID they can copy).
- No dark mode; `--tc-*` tokens exist but aren't documented on the site.
- Checkout form shows all fields at once with no inline validation messages
  until submit.

**Positioning/content**
- Four "vs" pages exist but the landing page never states the one-line reason
  TinyCart exists (see Section 4 conclusion) or shows a fee comparison — the
  strongest argument it has.

---

## 4. Competitor analysis (July 2026)

| Product | Model / cost | Strengths | Weakness TinyCart can exploit |
|---|---|---|---|
| **Snipcart** | 2% of sales, or $20/mo under $1k volume | Polished drop-in cart for static sites, dashboard, shipping/tax integrations | Hosted dependency, ongoing % fee, no COD story, overkill for tiny stores |
| **Foxy.io** | Plan tiers, 100 txn/mo entry + $0.35/extra txn | Very flexible embeds, mature checkout | Paid, hosted, complex config for beginners |
| **Gumroad** | 10% + $0.50 per sale | Zero setup, handles delivery + discovery | Highest fees in class; your store lives on their domain and pipeline |
| **Lemon Squeezy** | 5% + $0.50, Merchant of Record (handles VAT) | MoR tax handling is a real moat for digital goods | Digital-only focus, fees, no self-hosting, no COD |
| **Payhip** | 5% flat (or paid plans to lower it) | Cheap for small digital catalogs | Not self-hosted, no physical/COD ops |
| **Ecwid** | Free tier, then subscriptions | Free entry, full storefront | Heavy widget, branded, account-based |
| **Shopify Buy Button / JS Buy SDK** | — | Was the default "add cart to any site" answer | **Deprecated Jan 2025, checkout breakage from Jul 2025** — its users are actively migrating and searching for alternatives |
| **simpleCart(js), Cart.js** | Free OSS | Same "tiny JS cart" niche | Effectively abandoned; no server-side validation at all |

**Conclusions to act on**

1. TinyCart's honest one-liner (use it verbatim in the hero, task A1):
   *"The $0, self-hosted cart. One JS file, a few PHP files, your own SQLite —
   works on $3/month shared hosting. No accounts, no % fees, cash-on-delivery
   built in."* No competitor above can say any clause of that sentence.
2. **Fees are the killer argument.** A merchant doing $2,000/mo pays Gumroad
   ~$210, Snipcart $40, Lemon Squeezy ~$110, TinyCart $0. Put this table on the
   landing page (task A6).
3. **COD + shared hosting** is an underserved market (South/Southeast Asia,
   MENA, LATAM small merchants) that every hosted competitor ignores. Lean in:
   i18n presets, COD-first copy, screenshots of COD ops (tasks A5, C4).
4. **Shopify Buy Button deprecation** is a live migration event. The existing
   `shopify-buy-button-alternative.html` page should be updated to mention the
   Jan 2025 deprecation and July 2025 checkout cutoff explicitly (task A7).
5. What competitors have that buyers of *this* niche actually miss: digital
   file delivery (Gumroad's core), order status for the customer, and shipping
   fees. Those are Phase C. Do **not** chase subscriptions, tax automation, or
   abandoned-cart emails — that's hosted-platform territory and breaks the
   minimal ethos.

---

## 5. Design direction (applies to every UI task)

Keep the existing identity — sharp, high-contrast, hairline grid, squared
corners, Inter, mono accents — it's distinctive. The problem is *evidence*, not
aesthetics. Every section added must show the product doing real work
(screenshots, live widgets, real numbers). Rules:

- One accent color (`--accent: #1a73e8`) used sparingly; everything else
  monochrome.
- All imagery is either the live widget, real screenshots, or inline SVG. No
  stock photos, no AI-art, no emoji as icons.
- Respect `prefers-reduced-motion`; no scroll-jacking or parallax.
- Mobile first: the primary audience deploys from cheap laptops and phones.

---

## 6. Task list (work top to bottom)

### Phase A — Landing page & site trust (highest impact, do first)

- [x] **A1. Hero rewrite with proof-of-life.**
  Files: `index.html`.
  Replace the abstract SVG mockup with a *real rendering* of the cart: a static,
  hand-written HTML/CSS replica of the open cart dialog showing 2 items, a
  coupon applied, COD selected, and a visible total (do not screenshot; build it
  in HTML so it's crisp and themable). Add the one-liner from Section 4.1 as the
  lead. Add a GitHub stars badge (shields.io is acceptable as the sole external
  image, loaded lazily) and a `v0.2.0 · MIT · PHP 8+` metadata row.
  Acceptance:
  - [ ] Hero communicates "this is a cart you can see" within one viewport at 375px and 1280px.
  - [ ] Lighthouse performance ≥ 95 mobile for `index.html`.

- [x] **A2. Kill external font request + add OG/social meta.**
  Files: `index.html`, `docs.html`, `setup.html`, `security.html`,
  `compare.html`, all four `*-alternative.html`, `site.css`.
  Switch to `font-family: system-ui, ...` stack OR self-host a WOFF2 Inter
  subset (≤2 files) — pick system stack (simpler, beginner-friendly, faster).
  Add `og:title`, `og:description`, `og:image`, `twitter:card` to every page.
  Generate `og-image.png` (1200×630): dark background, TinyCart cart glyph,
  one-liner. A simple hand-made SVG exported to PNG is fine.
  Acceptance:
  - [ ] Zero requests to fonts.googleapis.com / gstatic across the site.
  - [ ] Pasting the URL into a link-preview checker shows title, description, image.

- [x] **A3. Unify the design system + strip BOMs.**
  Files: `index.html`, `site.css`, all HTML pages.
  Move `index.html`'s inline CSS into `site.css` (dedupe against what's there;
  page-specific rules get a `.home` body class). Remove UTF-8 BOMs from all
  files (verified present in 9 files: `compare.html`, `docs.html`, `security.html`,
  `setup.html`, `site.css`, and all four `*-alternative.html`). Ensure all pages share
  header/footer markup verbatim.
  Acceptance:
  - [ ] `index.html` has no `<style>` block (a ≤20-line critical-CSS block is allowed if measured).
  - [ ] `grep -rl $'\xEF\xBB\xBF' *.html *.css *.js *.php *.md` returns nothing.
  - [ ] Visual diff of all pages: identical header/footer, consistent type scale.

- [x] **A4. Dark mode across site and widget.**
  Files: `site.css`, `index.html`, `tinycart.js`.
  Add `prefers-color-scheme: dark` variable sets for the site (`--bg`, `--fg`,
  `--line`, `--soft`) and the widget (`--tc-*` tokens already exist — add a dark
  block inside the injected CSS, gated to when the host hasn't overridden
  tokens). Mind invariant 4: recover bytes in the injected CSS first (it has
  compressible repetition, e.g. repeated `var(--tc-font,...)` fallbacks).
  Acceptance:
  - [ ] OS dark mode renders every page and the open cart correctly (no white flashes, contrast ≥ 4.5:1).
  - [ ] `tinycart.js` still < 48,000 bytes.

- [x] **A5. "See the ops" section — admin dashboard showcase.**
  Files: `index.html`, new `assets/admin-orders.png` (or inline HTML replica).
  Nobody believes "ops dashboard included" without seeing it. Run `admin.php`
  locally with 5–6 seeded fake orders (mix of `cod_due`, paid, shipped), take a
  clean 1600px-wide screenshot, optimize to <120KB, and present it in a browser-
  chrome frame with 3 captioned callouts (order queue, COD collection, CSV
  export). If a screenshot is impossible in the loop environment, build an HTML
  replica like A1.
  Acceptance:
  - [ ] Landing page shows the admin UI with realistic (fake) data.
  - [ ] Image lazy-loaded, `alt` text written, <120KB.

- [x] **A6. Honest pricing/fee comparison table on the landing page.**
  Files: `index.html`.
  Table: monthly cost at $500 / $2,000 / $10,000 of sales for TinyCart ($0 +
  your hosting), Snipcart (2% or $20 min), Gumroad (10%+50¢), Lemon Squeezy
  (5%+50¢), Payhip (5%). Add footnote: "Gateway fees (Stripe/PayPal) apply to
  everyone, including TinyCart online payments. Figures from public pricing
  pages, July 2026." Link each name to its pricing page. Keep tone factual, not
  trash-talking — note what the fee *buys* (hosting, MoR tax handling) in one
  honest sentence per row.
  Acceptance:
  - [ ] Table renders as a card grid on mobile (no horizontal scroll).
  - [ ] Every number matches Section 4 of this document.

- [x] **A7. Refresh comparison pages + add FAQ.**
  Files: four `*-alternative.html`, `compare.html`, `index.html`.
  Update the Shopify page with the JS Buy SDK deprecation timeline (deprecated
  Jan 2025; checkout breakage from Jul 1 2025) and a short migration path
  (map Buy Button attributes → `data-tc-*`). Add an 8-question FAQ section to
  `index.html` with `<details>` elements and FAQPage JSON-LD. Questions to
  answer: Is it really free? What hosting do I need? Is COD safe? How do
  payments work? Can it do digital downloads? (answer honestly: Phase C) Is it
  secure? Can I restyle it? How do I update?
  Acceptance:
  - [ ] FAQ JSON-LD validates in Google's Rich Results test format.
  - [ ] Shopify page mentions the 2025 deprecation with dates.

- [x] **A8. Site hygiene: 404, sitemap, robots, favicons, copy buttons.**
  Files: new `404.html`, `sitemap.xml`, `robots.txt`; all pages.
  404 in site style linking home/docs. Sitemap lists all public pages. Add
  `apple-touch-icon.png` + 32px PNG favicon alongside the SVG. Add a "copy"
  button to every code block site-wide (one shared ≤30-line script in
  `site.css`-adjacent `site.js`, `navigator.clipboard`, visible "Copied"
  state, keyboard accessible).
  Acceptance:
  - [ ] Every code block on every page has a working copy button.
  - [ ] GH Pages workflow (`pages.yml`) still deploys everything (verify file list if it copies explicitly).

### Phase B — Widget UI refinement (`tinycart.js`)

Byte budget note: before B tasks, do B0.

- [x] **B0. Reclaim bytes in the widget.**
  Files: `tinycart.js`, `tests/static.test.mjs`.
  Target: free ≥2,500 bytes with zero behavior change. Techniques: alias
  repeated strings (`var(--tc-line,#ddd)` etc.) via shorter custom properties
  defined once on `.tc-root`; collapse duplicate CSS declarations; shorten
  internal helper names ONLY where not part of the public API (`window.tinycart`
  surface must not change); remove commented/dead code.
  Acceptance:
  - [ ] All tests pass unchanged; public API identical (document surface in a comment).
  - [ ] `wc -c tinycart.js` ≤ 45,000 bytes.

- [x] **B1. Order-success screen (replace success toast).**
  Files: `tinycart.js`.
  After a successful checkout, swap the dialog body for a confirmation view:
  check icon (inline SVG path), "Order placed", order ID in a monospace box with
  a copy button, payment-method-specific line (COD: "Pay {{total}} in cash on
  delivery." / online: "Complete payment on the next page." before redirect),
  and a "Continue shopping" button that closes and clears the cart. Cart clears
  only on confirmed success (existing behavior — keep it).
  Acceptance:
  - [ ] Keyboard/screen-reader flow: focus moves to the confirmation heading; Esc still closes.
  - [ ] Order ID copy works; COD vs online variants render correctly.
  - [ ] Size ceiling holds.

- [ ] **B2. Optional product thumbnails.**
  Files: `tinycart.js`, `index.html` (demo), `README.md`, `docs.html`.
  New optional `data-tc-img` attribute (absolute or relative URL). Render a
  44×44 thumbnail in cart rows (`img` with `loading="lazy"`, `alt=""`,
  `referrerpolicy="no-referrer"`). URL is display-only, never sent in the
  checkout payload (invariant 2), sanitized to http(s)/relative only. Rows
  without an image keep current layout (no empty box).
  Acceptance:
  - [ ] Demo products on `index.html` show small inline-SVG-based images.
  - [ ] `javascript:` and `data:` URLs are rejected. Payload unchanged (test).

- [ ] **B3. Inline form validation + micro-polish.**
  Files: `tinycart.js`.
  Validate on blur and on submit: required name/phone/address, phone = digits,
  spaces, `+-()` and length 6–20, email format when present. Error text sits
  under the field (`aria-describedby`, `aria-invalid="true"`), first invalid
  field gets focus on submit. Replace the `x` close glyph with an inline SVG ×
  icon; give the empty state a small line-art cart SVG + "Browse products"
  hint; add a subtle item-added row highlight (respecting reduced-motion).
  Acceptance:
  - [ ] Submitting an empty form shows per-field errors, no toast-spam, focus on first error.
  - [ ] Axe/Lighthouse a11y ≥ 95 on `sample.html`.
  - [ ] Size ceiling holds (this is why B0 exists).

- [ ] **B4. Document theming properly.**
  Files: `docs.html`, `README.md`.
  A "Theming" docs section listing every `--tc-*` token with default value, a
  live themed example on the docs page (e.g. rounded pastel theme in 6 lines of
  CSS), and a warning about contrast. No widget code changes.
  Acceptance:
  - [ ] Every token in the injected CSS appears in the docs table (script-check by grepping `--tc-` names).

### Phase C — Features (each opt-in, each fights a specific competitor)

- [ ] **C1. Digital file delivery (vs Gumroad/Payhip/Lemon Squeezy).**
  Files: new `download.php`, `checkout.php`, `SETUP.md`, `docs.html`.
  Products in `PRODUCT_CATALOG` may declare `'file' => 'files/ebook.pdf'`
  (path outside webroot or guarded by `.htaccess` — document both). On paid (or
  configurable: also COD-confirmed) orders, order email + success screen include
  a signed link: `download.php?order=...&item=...&exp=...&sig=HMAC`. Endpoint
  verifies signature, expiry (default 72h), order payment status, and a max
  download count (default 5), then streams the file with `readfile()` and a
  correct `Content-Type`/`Content-Disposition`. Rate-limited like other
  endpoints.
  Acceptance:
  - [ ] Tampered/expired/over-limit links → 403 JSON, nothing streamed.
  - [ ] Unpaid online orders cannot download; COD behavior matches config.
  - [ ] `php -l` clean; curl test cases added to `TESTPLAN.md`.

- [ ] **C2. Shipping fees (vs Snipcart's core value).**
  Files: `checkout.php`, `coupon.php` (totals preview), `tinycart.js`
  (display only), `SETUP.md`.
  Minimal, honest scope: a `SHIPPING` config in `checkout.php` — flat fee,
  free-above-threshold, or per-zone flat map keyed by a `zone` select the widget
  shows when zones are configured (labels from config). Server computes and
  stores shipping; widget only previews it. No carrier APIs, ever.
  Acceptance:
  - [ ] Totals: subtotal − discount + shipping, computed server-side, to the cent.
  - [ ] Zone tampering in payload can't produce a fee lower than the configured zone floor (server re-validates zone against the config list).

- [ ] **C3. Customer order-status lookup (trust feature every hosted platform has).**
  Files: new `order-status.php`, `SETUP.md`.
  A tiny server-rendered page: enter order ID + phone (both must match) → shows
  status timeline (received → paid/cod_due → shipped), items, and total. Escaped
  output only, origin-checked, rate-limited (this is a PII-adjacent surface —
  show partial address at most, e.g. first line + city).
  Acceptance:
  - [ ] Wrong ID+phone pair reveals nothing (constant-ish response, no enumeration).
  - [ ] No unescaped output (grep for `echo` paths; reuse admin.php escaping helpers).

- [ ] **C4. i18n starter packs (COD-market wedge).**
  Files: new `examples/strings/` (`bn.json`, `hi.json`, `ur.json`, `ar.json`,
  `es.json`, `fr.json`), `docs.html`, `README.md`.
  The `strings` config already supports overrides — ship ready-made translation
  objects for the full STRINGS table, RTL note for `ar`/`ur` (widget should set
  `dir` from a new optional `dir` config key — tiny change), and a docs example.
  Acceptance:
  - [ ] Each JSON covers every key in STRINGS (script-check key parity).
  - [ ] `dir:"rtl"` config mirrors the dialog correctly.

- [ ] **C5. One-file demo store.**
  Files: new `demo-store.html`.
  A complete fake storefront (6 products with inline-SVG imagery, categories,
  the widget fully wired to the `onCheckout` stub) that doubles as (a) the
  thing linked from the hero's "Try the demo", and (b) a copy-paste starting
  template for beginners. Heavily commented HTML.
  Acceptance:
  - [ ] Works offline from a file:// open (no external requests).
  - [ ] Linked prominently from hero and docs.

### Phase D — Deployment artifact (Vercel) + hosting docs

**Reality check that must be stated in the docs:** Vercel does not run PHP or
persist SQLite. So the Vercel artifact deploys the **static site + demo store**
(marketing + docs + stubbed checkout). The PHP backend's home remains shared
hosting — which is the product's whole point. Never imply the PHP endpoints run
on Vercel.

- [ ] **D1. Vercel static deployment artifact.**
  Files: new `vercel.json`, new `DEPLOY.md`, `.vercelignore`.
  `vercel.json` (create exactly this, then adjust only if validation fails):

  ```json
  {
    "$schema": "https://openapi.vercel.sh/vercel.json",
    "cleanUrls": true,
    "trailingSlash": false,
    "headers": [
      {
        "source": "/(.*)",
        "headers": [
          { "key": "X-Content-Type-Options", "value": "nosniff" },
          { "key": "X-Frame-Options", "value": "DENY" },
          { "key": "Referrer-Policy", "value": "strict-origin-when-cross-origin" }
        ]
      },
      {
        "source": "/tinycart.js",
        "headers": [
          { "key": "Cache-Control", "value": "public, max-age=3600, must-revalidate" }
        ]
      }
    ]
  }
  ```

  `.vercelignore` excludes `*.php`, `tests/`, `scripts/`, `*.md` except nothing
  breaks if they ship — but exclude PHP explicitly so nobody thinks it runs.
  `DEPLOY.md` gives three beginner paths, each with exact commands/clicks:
  1. **Vercel (demo/marketing site):** `npm i -g vercel && vercel` — or the
     dashboard "Import Git Repository" flow, framework preset "Other", no build
     command, output dir `./`.
  2. **GitHub Pages:** already automated via `pages.yml` — document it.
  3. **Shared hosting (the real store):** FTP/cPanel upload checklist, PHP 8+,
     `pdo_sqlite` check via a provided `health.php` snippet (prints PHP version
     + extension availability, then tells the user to DELETE it), file
     permissions for the SQLite dir, and the `ALLOWED_ORIGINS` edit.
  Acceptance:
  - [ ] `vercel.json` passes `npx vercel build` locally or schema validation.
  - [ ] `DEPLOY.md` tested by following it verbatim (fresh directory).
  - [ ] Landing page and demo work on a Vercel preview URL with checkout stubbed.

- [ ] **D2. Landing page "Deploy" section.**
  Files: `index.html`, `setup.html`.
  Three-card section mirroring DEPLOY.md paths, honest about which piece goes
  where ("Demo site → Vercel/Pages, free" / "Store + checkout → any PHP host").
  Acceptance:
  - [ ] Cards link to DEPLOY.md sections; copy is accurate about PHP-on-Vercel not being a thing.

### Phase E — Tests, guardrails for everything above

- [ ] **E1. Extend static invariants.**
  Files: `tests/static.test.mjs`.
  Add asserts: no BOM in any tracked text file; no `fonts.googleapis.com` in any
  HTML; every HTML page has `og:title` and `og:image`; `download.php` and
  `order-status.php` (once they exist) contain no `Access-Control-Allow-Origin: *`
  and use the shared rate-limit helper; every `--tc-*` token documented in
  `docs.html` (B4 check); `vercel.json` parses as JSON.
  Acceptance:
  - [ ] New asserts fail when violations are reintroduced (verify by temporary mutation, then revert).

- [ ] **E2. Feature tests for C1–C3.**
  Files: `tests/endpoints.test.mjs`, `TESTPLAN.md`.
  Signed-link forgery/expiry/count for C1; shipping math + zone-tamper for C2;
  enumeration resistance for C3 (same status code + similar timing for wrong
  ID vs wrong phone).
  Acceptance:
  - [ ] `node --test tests/*.test.mjs` green; new cases documented in TESTPLAN.md.

- [ ] **E3. Final sweep.**
  Run Lighthouse (perf/a11y/SEO ≥ 95 on index, docs, demo-store), click every
  link on every page (write a tiny link-checker script in `scripts/`), test the
  full demo checkout on a real phone viewport, and update `CHANGELOG.md` +
  `README.md` for v0.3.0. Bump `package.json` version.
  Acceptance:
  - [ ] All boxes above checked or noted in Section 8; CHANGELOG entry written.

---

## 7. Explicitly out of scope (do not build, even if it seems easy)

- Subscriptions/recurring billing, tax/VAT automation (that's Lemon Squeezy's
  MoR moat — competing there breaks the minimal stack).
- Carrier shipping APIs, abandoned-cart emails, customer accounts/login.
- Any npm runtime dependency, bundler, framework, or CSS toolchain.
- Running PHP on Vercel/Netlify via community runtimes (SQLite won't persist;
  it would betray the shared-hosting story).
- Rewriting the visual identity. Refine it; don't replace it.

## 8. Deviation log (Codex appends here)

- _(empty — add dated notes for any skipped task, raised ceiling, or invariant conflict)_
