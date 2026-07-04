# TinyCart — Polish & Feature Roadmap (Codex Handoff)

A phased implementation plan for an autonomous coding agent (Codex). TinyCart is a
tiny, dependency-free storefront: one JS file (`tinycart.js`), two PHP endpoints
(`checkout.php`, `collect.php`), and flat docs. The whole point is that it stays
small, readable, and safe on shared hosting. **Every task below must respect that
ethos: minimal surface area, no build step, no runtime dependencies, security by
default.**

---

## How to use this document

- Work top to bottom. Phases are ordered by dependency and value.
- Each task is self-contained: **Goal → Files → Changes → Acceptance → Effort/Risk.**
- "Acceptance" is the definition of done. Do not mark a task complete until every
  checkbox passes.
- Prefer many small PRs over one large one. One task ≈ one PR.
- If a task conflicts with an invariant below, stop and flag it rather than
  breaking the invariant.

## Non-negotiable invariants (do not regress)

These are enforced by `tests/static.test.mjs` and by project intent:

1. **No untrusted HTML.** `tinycart.js` must never contain `innerHTML`,
   `insertAdjacentHTML`, `eval(`, or `new Function`. Build DOM with
   `createElement`/`textContent` and the existing `safeTemplate`/`htmlEscape`.
2. **Server is the source of truth.** Never trust client-sent price, name, total,
   coupon, or stock. `checkout.php` re-prices from `PRODUCT_CATALOG`.
3. **No wildcard CORS.** Neither PHP endpoint may emit
   `Access-Control-Allow-Origin: *`.
4. **Stay small.** `tinycart.js` must remain under 40 KB (current test ceiling).
   If a feature threatens the ceiling, make it opt-in or raise the ceiling
   deliberately with justification.
5. **Zero build / zero dependency.** No npm runtime deps, no bundler, no
   transpile. Vanilla JS + PHP + SQLite only.
6. **Privacy first.** Analytics stay optional and PII-free.

## Baseline test loop (run before and after every task)

```bash
node tests/static.test.mjs          # structural + security invariants
php -S 127.0.0.1:8000               # then run the curl cases in TESTPLAN.md
```

Add new automated tests alongside new features (see Phase 4).

---

## Phase 0 — Landing page polish (DONE, verify only)

Completed in this pass; listed so Codex knows the current state and can extend it.

- Rebuilt `index.html` with a 4px spacing scale (`--s-1`…`--s-9`) and a real type
  hierarchy (eyebrow → display H1 with tightened tracking → lead → section heads).
- Kept the sharp, high-contrast, hairline-grid aesthetic; squared corners.
- Added a **live demo** section wired to the real widget via an `onCheckout` stub
  (no backend needed) and a lean **feature highlights** grid.
- Sticky translucent header, responsive breakpoints, reduced-motion support.

**Remaining polish (small, optional):**

- [ ] Add `prefers-color-scheme: dark` variables (mirror the sharp look in dark).
- [ ] Add Open Graph / Twitter card meta + a favicon and social preview image.
- [ ] Self-host the Inter subset (or use `font-display: optional`) to drop the
      Google Fonts request and improve privacy/perf.
- [ ] Add a "copy" button to the hero code strip.

---

## Phase 1 — Core polish & hardening

### 1.1 Accessibility pass on the cart widget
- **Goal:** WCAG 2.1 AA for the floating cart, modal, and checkout form.
- **Files:** `tinycart.js`.
- **Changes:** verify focus trap restores focus on close (already partially
  present via `state.lastFocused`); ensure the floating button and modal have
  correct `aria-label`/`aria-modal`/`role`; make the item quantity steppers and
  remove buttons keyboard-operable with visible focus rings; announce cart-count
  changes via an `aria-live="polite"` region; ensure the accent color meets 4.5:1
  against its text (compute contrast, fall back if it fails).
- **Acceptance:**
  - [ ] Full keyboard flow: open cart → edit qty → apply coupon → checkout, no mouse.
  - [ ] Focus never escapes the open modal; Esc closes and returns focus.
  - [ ] Axe/Lighthouse a11y ≥ 95 on `sample.html`.

### 1.2 Checkout error & loading states
- **Goal:** clear, non-blocking feedback on every failure mode.
- **Files:** `tinycart.js`.
- **Changes:** distinguish network failure, validation (400), rate limit (429),
  and origin (403) responses with specific toast copy; disable the submit button
  with a spinner/label while in flight (partly done); keep the cart intact on
  failure so the user can retry.
- **Acceptance:**
  - [ ] Each of the TESTPLAN failure cases surfaces a distinct, human message.
  - [ ] Double-submit is impossible (button disabled until response/rejection).

### 1.3 Coupon UX + server validation path
- **Goal:** finish the coupon story end-to-end.
- **Files:** `tinycart.js`, new `coupon.php`, `README.md`.
- **Changes:** wire `apiCoupon`/`onValidateCoupon` UI states (applied, invalid,
  expired); add a minimal `coupon.php` that validates against a server list with
  origin + rate-limit checks mirroring `checkout.php`; **re-validate the coupon in
  `checkout.php`** so a client-applied discount can never be trusted.
- **Acceptance:**
  - [ ] Invalid/expired codes show inline errors and do not alter totals.
  - [ ] `checkout.php` recomputes the discount server-side; a forged coupon in the
        payload is ignored.

### 1.4 Config & error robustness
- **Goal:** fail safe on malformed input.
- **Files:** `tinycart.js`, `checkout.php`, `collect.php`.
- **Changes:** validate `data-tc-config` and `data-tc-options` more defensively
  (already dropping nested objects — add tests); guard `localStorage` access in
  private-mode/quota-exceeded scenarios; ensure PHP endpoints return structured
  JSON errors (never a PHP notice/HTML) and log to the existing error log.
- **Acceptance:**
  - [ ] Corrupt `localStorage` value is discarded, cart resets, no throw.
  - [ ] Malformed JSON body to either endpoint → clean `400 {"ok":false,...}`.

---

## Phase 2 — Feature-rich additions (payments, catalog, i18n)

Each item is independent and opt-in. Ship them in this order.

### 2.1 Payment handoff (Stripe + PayPal)
- **Goal:** turn a stored order into a real payment without adding a JS dependency.
- **Files:** `checkout.php` (return `pay_url`), new `payment.php` or provider
  branch, `SETUP.md`.
- **Changes:** after `checkout.php` stores an order, optionally create a provider
  checkout session server-side (Stripe Checkout / PayPal Orders v2) and return a
  `pay_url`; `tinycart.js` already redirects to `result.pay_url`. Keep credentials
  server-side only; make providers pluggable via a small config switch.
- **Acceptance:**
  - [ ] With Stripe configured, a completed checkout redirects to a hosted
        payment page; amount equals the server-recomputed total (to the cent).
  - [ ] Webhook/return handler marks the order paid; unpaid orders stay `pending`.
  - [ ] Providers can be disabled and TinyCart still stores orders as before.

### 2.2 Server-driven catalog endpoint
- **Goal:** stop hardcoding prices in the page; let the server own product truth.
- **Files:** new `catalog.php`, `tinycart.js` (optional fetch), `README.md`.
- **Changes:** `catalog.php` serves `{id, name, price_cents, currency, stock}`
  from `PRODUCT_CATALOG` (read-only, cacheable, origin-checked). `tinycart.js`
  can optionally hydrate button prices/stock from it on init (feature-flagged via
  a `catalogUrl` config key) so displayed prices always match the server.
- **Acceptance:**
  - [ ] With `catalogUrl` set, add-to-cart prices come from the server, not the DOM.
  - [ ] Out-of-stock items are visually disabled client-side (server still enforces).

### 2.3 Multi-currency + i18n
- **Goal:** localized formatting and strings without bloating the core.
- **Files:** `tinycart.js`, `README.md`.
- **Changes:** use `Intl.NumberFormat` for currency display keyed off `currency`
  + a new optional `locale` config; extract user-facing strings into a `strings`
  config object with English defaults so integrators can translate; keep money as
  integer cents internally.
- **Acceptance:**
  - [ ] EUR/JPY/USD render with correct symbol, grouping, and decimals.
  - [ ] All visible strings are overridable via config; defaults unchanged.

### 2.4 Themes / design tokens
- **Goal:** let integrators restyle without forking.
- **Files:** `tinycart.js` (CSS custom properties), `README.md`.
- **Changes:** expose the widget's palette, radius, and font via CSS variables
  (`--tc-*`) settable by the host page; honor `prefers-color-scheme`; keep the
  default sharp theme. Ensure injected styles stay scoped (no leakage into host).
- **Acceptance:**
  - [ ] Overriding `--tc-accent`/`--tc-radius` on the host restyles the cart.
  - [ ] Widget styles do not affect host page elements (scoped/prefixed).

### 2.5 Saved / persistent cart & recovery
- **Goal:** resilience across reloads and optional cross-device recovery.
- **Files:** `tinycart.js`, optional `cart.php`.
- **Changes:** cart already persists in `localStorage`; add a versioned schema +
  migration so format changes don't corrupt old carts; optional signed
  server-side cart save (`cart.php`) returning a short recovery token (no PII).
- **Acceptance:**
  - [ ] Reload preserves cart, coupon, and options exactly.
  - [ ] A schema bump migrates or safely clears old carts (no throw).

### 2.6 Inventory / stock enforcement
- **Goal:** prevent overselling.
- **Files:** `checkout.php`, `catalog.php`.
- **Changes:** decrement stock atomically within the SQLite transaction that
  stores the order; reject the order if any line exceeds available stock; surface
  a specific "out of stock" error to the client.
- **Acceptance:**
  - [ ] Concurrent checkouts cannot drive stock negative (transaction test).
  - [ ] Over-cap quantity is rejected with a clear message; nothing is stored.

### 2.7 Order webhooks / notifications
- **Goal:** let merchants react to new orders.
- **Files:** `checkout.php`, `SETUP.md`.
- **Changes:** after a successful store, optionally POST a signed (HMAC) order
  summary to a configured `WEBHOOK_URL`, with retry/backoff and no secrets in the
  payload; optionally send a plaintext order email via `mail()`.
- **Acceptance:**
  - [ ] Webhook fires once per order, signed, and is verifiable by the receiver.
  - [ ] Webhook failure never blocks or reverses the stored order.

### 2.8 Minimal order admin view
- **Goal:** read-only visibility into orders on shared hosting.
- **Files:** new `admin.php`.
- **Changes:** password/API-key-gated, origin-checked, read-only list of recent
  orders from the SQLite DB with pagination; no mutation, no framework, server-
  rendered escaped HTML only.
- **Acceptance:**
  - [ ] Unauthenticated access is refused (401/403).
  - [ ] Lists orders with totals; no XSS (all output escaped); no write paths.

---

## Phase 3 — Distribution & DX

### 3.1 Versioning, changelog, and a pinned CDN build
- **Files:** `CHANGELOG.md`, `package.json` (metadata only, no deps), README badge.
- **Changes:** adopt semver; document a `tinycart.min.js` (optional, produced by a
  simple no-dependency minify step run manually or in CI) and jsDelivr usage.
- **Acceptance:** [ ] Tagged release + changelog entry; CDN snippet documented.

### 3.2 Framework snippets
- **Files:** `README.md` or `examples/`.
- **Changes:** copy-paste examples for plain HTML, WordPress, Astro/Eleventy, and
  a React wrapper that mounts the buttons — no framework becomes a dependency.
- **Acceptance:** [ ] Each snippet works against `sample.html` locally.

---

## Phase 4 — Testing & CI

### 4.1 Expand automated tests
- **Files:** `tests/`.
- **Changes:** add DOM tests for `tinycart.js` cart math, coupon logic, options
  sanitization, and `safeTemplate` escaping using `jsdom` **as a devDependency
  only** (or a lightweight custom harness to keep zero deps). Add PHP endpoint
  tests scripting the TESTPLAN curl cases and asserting status + JSON.
- **Acceptance:**
  - [ ] Cart totals, discounts, and stock caps have unit coverage.
  - [ ] Price-tamper, origin, rate-limit, and coupon-forgery cases are automated.

### 4.2 GitHub Actions CI
- **Files:** `.github/workflows/ci.yml`.
- **Changes:** run `node tests/static.test.mjs`, the new unit tests, `php -l` lint
  on every PHP file, and a byte-size check for `tinycart.js`.
- **Acceptance:** [ ] CI is green on a clean checkout and blocks size regressions.

---

## Suggested sequencing for Codex

1. Phase 1 (1.1 → 1.4): finish and harden what exists.
2. Phase 4.1 early: land the test harness so later features arrive with coverage.
3. Phase 2 in order (2.1 payments first — highest user value).
4. Phase 3 + 4.2: package and automate.

Each task: branch → implement → run the baseline test loop → add feature tests →
open a focused PR referencing the task number here.
