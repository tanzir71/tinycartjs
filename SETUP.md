# TinyCart Shared Hosting Setup

These steps target Namecheap/cPanel-style shared hosting with PHP.

## Requirements

- PHP 8.1+ recommended.
- PHP extensions: `pdo_sqlite`, `json`, `mbstring`, `openssl`.
- Writable private `data/` directory for SQLite, logs, and rate-limit buckets.

## Upload

1. Upload `tinycart.js`, `checkout.php`, `collect.php`, `README.md`, `SETUP.md`, `SECURITY.md`, and `index.html` to `public_html/tinycart/` or your storefront directory.
2. Edit `checkout.php`:
   - Set `ALLOWED_ORIGINS` to your real storefront origins.
   - Add one or more long random `API_KEYS` if you want the `X-API-KEY` check.
   - Replace `HMAC_SECRET`.
   - Replace `PRODUCT_CATALOG` with your real product ids, prices, and stock.
3. Create `data/` beside `checkout.php` or let the script create it.
4. Edit `collect.php` if analytics are enabled:
   - Set `COLLECT_ALLOWED_ORIGINS` to the storefront origins that may send beacons.
   - Add long random `COLLECT_API_KEYS` if you configure `apiKey` in TinyCart.
   - Tune `COLLECT_RATE_MAX_REQUESTS` and `COLLECT_RATE_WINDOW_SECONDS` for your traffic.

Recommended permissions:

```bash
chmod 755 public_html
chmod 755 public_html/tinycart
chmod 750 public_html/tinycart/data
chmod 640 public_html/tinycart/data/orders.sqlite
chmod 640 public_html/tinycart/data/collect.sqlite
chmod 640 public_html/tinycart/data/errors.log
chmod 640 public_html/tinycart/data/collect_errors.log
```

If cPanel runs PHP as your user, `750`/`640` usually works. If SQLite cannot write, use cPanel File Manager to make `data/` writable by the account owner, not world-writable.

## SQLite

`checkout.php` creates `data/orders.sqlite` and the required order tables automatically with PDO prepared statements. `collect.php` creates `data/collect.sqlite` with `collect_events`, `failed_payloads`, and `rate_limits`.

If SQLite is unavailable on your hosting plan, use a protected file log fallback: change `storeOrder()` to append validated orders as JSON lines to `data/orders.jsonl` with `flock()`. Keep the same validation steps before writing.

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
  data-tc-config='{"cartKey":"store-1","currency":"USD","apiCheckout":"/tinycart/checkout.php","analyticsUrl":"/tinycart/collect.php","accent":"#1A73E8"}'>
</script>
```

If your checkout or collect endpoint is on another subdomain, add that origin to your CSP `connect-src`, `ALLOWED_ORIGINS`, and `COLLECT_ALLOWED_ORIGINS`.

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
