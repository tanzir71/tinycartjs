# TinyCart Shared Hosting Setup

These steps target Namecheap/cPanel-style shared hosting with PHP, including COD checkout, SQLite orders, and the small ops dashboard.

## Requirements

- PHP 8.1+ recommended.
- PHP extensions: `pdo_sqlite` and `json` required; `mbstring` recommended.
- Writable private `data/` directory for SQLite, logs, rate-limit buckets, and queued webhook or analytics records.
- HTTPS on the storefront origin is strongly recommended before real customer data is collected.
- Access to cPanel File Manager, SSH, or another file-permission tool is needed for protecting `data/`.

## Recommended File Layout

The simplest shared-hosting layout keeps TinyCart beside the storefront assets:

```text
public_html/
  index.html
  product-page.html
  tinycart/
    tinycart.js
    checkout.php
    coupon.php
    catalog.php
    payment.php
    admin.php
    collect.php
    data/
      .htaccess
      orders.sqlite
      collect.sqlite
```

If your host allows directories outside `public_html`, place `data/` outside web root and change `DB_PATH`, `RATE_LIMIT_DIR`, and log constants to point there. If `data/` must stay under the public folder, protect it with `.htaccess` before accepting orders.

## Upload

1. Upload `tinycart.js`, `checkout.php`, `coupon.php`, `payment.php`, `catalog.php`, `admin.php`, `collect.php`, `README.md`, `SETUP.md`, `SECURITY.md`, and `index.html` to `public_html/tinycart/` or your storefront directory.
2. Edit `checkout.php`:
   - Set `ALLOWED_ORIGINS` to your real storefront origins.
   - Add one or more long random `API_KEYS` if you want the `X-API-KEY` check.
   - Replace `HMAC_SECRET`.
   - Replace `PRODUCT_CATALOG` with your real product ids, prices, and stock.
   - Replace `COUPONS` with your real server-side coupon rules.
   - Leave `ENABLED_PAYMENT_METHODS` empty for legacy behavior, or set values such as `['online', 'cod']`; set `DEFAULT_PAYMENT_METHOD` when you want one selected first.
   - Leave `PAYMENT_PROVIDER` blank, or set it to `stripe`/`paypal` and configure the matching secret keys plus `PAYMENT_SUCCESS_URL` and `PAYMENT_CANCEL_URL`.
   - For PayPal, set `PAYMENT_SUCCESS_URL` to `/tinycart/payment.php?order_id={ORDER_ID}` so the return handler can capture the approved order.
   - Set `WEBHOOK_URL` / `WEBHOOK_SECRET` for signed order webhooks, and optional `ORDER_EMAIL_TO` for plaintext order emails.
3. Edit `coupon.php` if coupon validation is enabled:
   - Set `COUPON_ALLOWED_ORIGINS` to your real storefront origins.
   - Add long random `COUPON_API_KEYS` if you want the `X-API-KEY` check.
   - Keep `COUPONS` in sync with `checkout.php`; checkout is the source of truth.
4. Edit `payment.php` if payment providers are enabled:
   - Set `STRIPE_WEBHOOK_SECRET` for signed Stripe `checkout.session.completed` webhooks.
   - Set `PAYPAL_CLIENT_ID` and `PAYPAL_SECRET` for PayPal return capture.
5. Edit `catalog.php` if server-driven catalog hydration is enabled:
   - Set `CATALOG_ALLOWED_ORIGINS` to your real storefront origins.
   - Keep `PRODUCT_CATALOG` in sync with `checkout.php`; checkout is still the source of truth.
6. Edit `admin.php` if you want the ops dashboard:
   - Set `ADMIN_ALLOWED_ORIGINS` to your real admin/storefront origins.
   - Add long random `ADMIN_API_KEYS` for API-key access, or set `ADMIN_PASSWORD_HASH` with `password_hash('your-password', PASSWORD_DEFAULT)` for Basic Auth.
   - Leave both blank to keep the dashboard disabled.
7. Create `data/` beside `checkout.php` or let the scripts create it.
8. Edit `collect.php` if analytics are enabled:
   - Set `COLLECT_ALLOWED_ORIGINS` to the storefront origins that may send beacons.
   - Add long random `COLLECT_API_KEYS` if you configure `apiKey` in TinyCart.
   - Tune `COLLECT_RATE_MAX_REQUESTS` and `COLLECT_RATE_WINDOW_SECONDS` for your traffic.

Before going live, run one test order with each enabled payment method, then open `admin.php` and confirm the order row, line items, status badges, inventory decrement, coupon handling, and webhook health panel all reflect the expected state.

Recommended permissions:

```bash
chmod 755 public_html
chmod 755 public_html/tinycart
chmod 750 public_html/tinycart/data
chmod 640 public_html/tinycart/data/orders.sqlite
chmod 640 public_html/tinycart/data/collect.sqlite
chmod 640 public_html/tinycart/data/errors.log
chmod 640 public_html/tinycart/data/coupon_errors.log
chmod 640 public_html/tinycart/data/payment_errors.log
chmod 640 public_html/tinycart/data/collect_errors.log
```

If cPanel runs PHP as your user, `750`/`640` usually works. If SQLite cannot write, use cPanel File Manager to make `data/` writable by the account owner, not world-writable.

## Endpoint Configuration Details

Use exact origins everywhere. Include the scheme and host, and include the port for local development:

```php
const ALLOWED_ORIGINS = [
    'https://store.example',
    'https://www.store.example',
    'http://127.0.0.1:8000',
];
```

Keep these constants aligned across files:

| File | Constants to review | Notes |
| --- | --- | --- |
| `checkout.php` | `PRODUCT_CATALOG`, `COUPONS`, `ENABLED_PAYMENT_METHODS`, `PAYMENT_PROVIDER`, `WEBHOOK_URL`, `ORDER_EMAIL_TO` | Checkout is the final authority for money, stock, payment method, and order creation. |
| `coupon.php` | `COUPONS`, `COUPON_ALLOWED_ORIGINS`, `COUPON_API_KEYS` | Coupon preview should match checkout, but checkout still recomputes everything. |
| `catalog.php` | `PRODUCT_CATALOG`, `CATALOG_ALLOWED_ORIGINS` | Catalog hydration improves display accuracy; it does not replace checkout validation. |
| `payment.php` | `STRIPE_WEBHOOK_SECRET`, `PAYPAL_CLIENT_ID`, `PAYPAL_SECRET` | Only needed when online payments are enabled. |
| `admin.php` | `ADMIN_ALLOWED_ORIGINS`, `ADMIN_API_KEYS`, `ADMIN_PASSWORD_HASH`, `ADMIN_PRODUCT_CATALOG`, `ADMIN_COUPONS` | Admin catalog/coupon lists should mirror checkout so operators see the right stock and toggles. |
| `collect.php` | `COLLECT_ALLOWED_ORIGINS`, `COLLECT_API_KEYS`, rate limits | Analytics should not receive secrets or unnecessary customer PII. |

Generate secrets with your password manager or a local command such as `openssl rand -hex 32`. Do not reuse `HMAC_SECRET`, API keys, webhook secrets, or admin passwords.

## SQLite

`checkout.php` creates `data/orders.sqlite` and the required order tables automatically with PDO prepared statements. Manual and online orders start with `payment_status` set to `pending`; COD orders use `payment_status` `cod_due` and skip payment provider handoff. When payment providers are enabled, online checkout responses include `pay_url` for the hosted payment page. `payment.php` updates the same order row to `paid` after a verified Stripe webhook or captured PayPal return. `catalog.php` serves a read-only cacheable catalog for optional client hydration. `admin.php` reads and updates orders, stock, coupon overrides, and webhook retry state after auth. `coupon.php` stores rate-limit buckets in `data/coupon_rate_limits/`. `collect.php` creates `data/collect.sqlite` with `collect_events`, `failed_payloads`, and `rate_limits`.

The checkout database also includes an `inventory` table seeded from `PRODUCT_CATALOG` on first run. Existing rows are not overwritten automatically, so restock through `admin.php` or SQLite. Coupon activation overrides live in `coupon_overrides`; the configured coupon rules still live in PHP constants. Failed webhook attempts are recorded in `webhook_deliveries` and can be queued for immediate retry in the dashboard.

## Cash on Delivery

For emerging-market or offline fulfilment flows, configure COD alongside online payment:

```php
const PAYMENT_PROVIDER = 'stripe'; // or 'paypal', or blank if only manual/COD
const ENABLED_PAYMENT_METHODS = ['online', 'cod'];
const DEFAULT_PAYMENT_METHOD = 'cod';
```

Then mirror those choices in the widget:

```html
<script
  src="/tinycart/tinycart.js"
  data-tc-config='{"cartKey":"store-1","currency":"USD","apiCheckout":"/tinycart/checkout.php","paymentMethods":["online","cod"],"defaultPaymentMethod":"cod"}'>
</script>
```

COD orders are stored with `payment_method = cod`, `payment_provider = cod`, and `payment_status = cod_due`. Use the admin order detail button labeled `Cash collected` after the courier or shop operator receives cash; this sets the order to `paid` and records `paid_at`.

For COD-only stores, leave `PAYMENT_PROVIDER` blank and use:

```php
const ENABLED_PAYMENT_METHODS = ['cod'];
const DEFAULT_PAYMENT_METHOD = 'cod';
```

With a single configured payment method, the widget does not render radio controls. Checkout still stores the method and status.

## Ops Dashboard Flow

Open `admin.php` after configuring auth. The dashboard supports:

- Filtering orders by method, payment status, fulfilment status, and search text.
- Updating payment status, fulfilment status, and an internal admin note.
- Calling or WhatsApp-linking the stored phone number from order detail.
- Exporting the current filtered order list as CSV with spreadsheet-safe cells.
- Updating stock in `inventory`.
- Activating or deactivating configured coupon codes through `coupon_overrides`.
- Viewing pending/failed webhook deliveries and queueing `Retry now`.

All POST actions use the same admin auth plus a PHP session CSRF token. Allowed statuses are intentionally small: payment `pending`, `paid`, `cod_due`, `cancelled`, `refunded`; fulfilment `new`, `confirmed`, `packed`, `shipped`, `fulfilled`, `cancelled`.

If SQLite is unavailable on your hosting plan, use a protected file log fallback: change `storeOrder()` to append validated orders as JSON lines to `data/orders.jsonl` with `flock()`. Keep the same validation steps before writing.

Daily operator runbook:

1. Open the order list and filter for `payment_status = cod_due` or `fulfillment_status = new`.
2. Open each new order, verify customer contact, address, items, coupon, total, and payment method.
3. Use the phone or WhatsApp link if the customer needs confirmation before packing.
4. Move the fulfilment status forward as work happens: `confirmed`, `packed`, `shipped`, then `fulfilled`.
5. For COD, press **Cash collected** only after the courier/shop receives cash.
6. Use admin notes for delivery attempts, customer requests, or stock substitutions.
7. Export a filtered CSV for courier routes, accounting, or daily reconciliation.
8. Check Webhook health and retry failed deliveries after the downstream service is back.

Suggested status meanings:

| Field | Value | Operator meaning |
| --- | --- | --- |
| Payment | `pending` | Awaiting online confirmation or manual payment review. |
| Payment | `cod_due` | Cash should still be collected. |
| Payment | `paid` | Payment was verified or collected. |
| Payment | `cancelled` | Stop fulfilment. |
| Payment | `refunded` | Payment was returned outside TinyCart. |
| Fulfilment | `new` | Not reviewed yet. |
| Fulfilment | `confirmed` | Accepted and ready to prepare. |
| Fulfilment | `packed` | Items are prepared. |
| Fulfilment | `shipped` | With courier or in transit. |
| Fulfilment | `fulfilled` | Complete. |
| Fulfilment | `cancelled` | Do not continue fulfilment. |

## Protect Data and Logs

Create `public_html/tinycart/data/.htaccess`:

```apache
Require all denied
```

For older Apache:

```apache
Deny from all
```

Optional top-level `.htaccess` security headers:

```apache
<IfModule mod_headers.c>
  Header set X-Content-Type-Options "nosniff"
  Header set Referrer-Policy "strict-origin-when-cross-origin"
  Header set Content-Security-Policy "default-src 'self'; script-src 'self'; connect-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; base-uri 'self'; form-action 'self'"
</IfModule>
```

If the checkout or collect endpoint lives on a different subdomain, include that exact origin in `connect-src`; do not use `*`.

## Cron Ideas

TinyCart does not need cron for basic orders. If you later add payment retries or notifications, add cPanel Cron entries like:

```cron
*/10 * * * * /usr/local/bin/php /home/USERNAME/public_html/tinycart/jobs/retry_failed_payments.php >/dev/null 2>&1
0 3 * * * find /home/USERNAME/public_html/tinycart/data/rate_limits -type f -mtime +2 -delete
5 3 * * * /usr/local/bin/sqlite3 /home/USERNAME/public_html/tinycart/data/collect.sqlite "DELETE FROM failed_payloads WHERE created_at < datetime('now','-14 days');" >/dev/null 2>&1
15 3 * * * /usr/local/bin/php /home/USERNAME/public_html/tinycart/jobs/export_orders.php >/dev/null 2>&1
```

Keep cron scripts outside public web access where possible, or protect `/jobs` with `.htaccess`.

## Merchant Page Embed

Place product buttons anywhere on your site, then include:

```html
<script
  src="/tinycart/tinycart.js"
  data-tc-config='{"cartKey":"store-1","currency":"USD","apiCheckout":"/tinycart/checkout.php","apiCoupon":"/tinycart/coupon.php","catalogUrl":"/tinycart/catalog.php","analyticsUrl":"/tinycart/collect.php","paymentMethods":["online","cod"],"defaultPaymentMethod":"cod","accent":"#1A73E8"}'>
</script>
```

If your checkout or collect endpoint is on another subdomain, add that origin to your CSP `connect-src`, `ALLOWED_ORIGINS`, and `COLLECT_ALLOWED_ORIGINS`.

## Troubleshooting

| Problem | What to inspect |
| --- | --- |
| Checkout returns `Origin not allowed` | The request origin must exactly match `ALLOWED_ORIGINS`, including `https://` and any port. |
| Checkout returns `Unauthorized` | `API_KEYS` is non-empty but the widget config lacks the matching `apiKey`. |
| Checkout returns `price mismatch` | The page HTML, catalog endpoint, and `PRODUCT_CATALOG` are out of sync. Refresh cached pages after changing products. |
| Checkout returns `Out of stock` | The SQLite `inventory` table has less stock than the cart asks for. Restock in admin or inspect `data/orders.sqlite`. |
| Coupon preview works but final checkout has no discount | `coupon.php`, `checkout.php`, or the `coupon_overrides` table disagree. Checkout is the final authority. |
| Admin dashboard says access is disabled | Set either `ADMIN_API_KEYS` or `ADMIN_PASSWORD_HASH`; leave neither blank in production. |
| Admin POST returns `403` | The session CSRF token is missing or stale. Reload the dashboard and submit again. |
| Stripe or PayPal redirect is missing | `paymentMethod` is `online`, `PAYMENT_PROVIDER` is set, and provider credentials plus success/cancel URLs must all be valid. |
| Webhooks fail repeatedly | Check `WEBHOOK_URL`, `WEBHOOK_SECRET`, downstream availability, and TLS. Retry from Webhook health after fixing the receiver. |
| SQLite files are downloaded by URL | `data/.htaccess` is missing or ignored. Move `data/` outside public web root if possible. |
| GitHub Pages deploys PHP/tests/docs internals | Use the included Pages workflow, keep `.nojekyll`, and configure Pages to deploy from GitHub Actions instead of legacy branch publishing. |

## Common Node Hosting

TinyCart itself is static. On Render, Railway, Fly.io, Vercel, Netlify, or a VPS:

1. Serve `tinycart.js`, `index.html`, and docs as static assets.
2. Implement the same endpoint contract in Node: reject unknown `Origin`, enforce max body size, validate event/order fields, use parameterized SQL, and rate limit by IP/client.
3. Send these headers from checkout and collect responses:

```http
Content-Type: application/json; charset=utf-8
X-Content-Type-Options: nosniff
Referrer-Policy: strict-origin-when-cross-origin
Access-Control-Allow-Origin: https://your-store.example
Vary: Origin
```
