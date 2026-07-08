# Changelog

All notable TinyCart changes are documented here.

## 0.3.0 - 2026-07-08

- Added signed digital delivery, `download.php`, expiry/count enforcement, and paid-order gating.
- Added server-computed shipping fees with flat rates, free-shipping thresholds, shopper-selected zones, and coupon preview totals.
- Added customer order-status lookup by exact order id and phone with partial address display.
- Added starter i18n string packs, RTL direction support, and a full offline `demo-store.html`.
- Added Vercel/GitHub Pages/static deployment docs while keeping PHP checkout on shared hosting or a VPS.
- Expanded endpoint, widget, i18n, static, link, Lighthouse, and mobile demo checkout verification.

## 0.2.0 - 2026-07-04

- Added server-validated coupons with checkout revalidation.
- Added optional Stripe and PayPal payment handoff plus paid-order handlers.
- Added cacheable server catalog hydration, i18n strings, locale-aware money formatting, theme tokens, and versioned cart persistence.
- Added atomic SQLite inventory reservation, signed order webhooks, best-effort order email, COD checkout, and an authenticated ops dashboard.
- Expanded automated endpoint, widget, payment, and static tests.

## 0.1.0 - 2026-05-14

- Initial dependency-free cart widget, checkout endpoint, collect endpoint, sample page, and shared-hosting setup docs.
