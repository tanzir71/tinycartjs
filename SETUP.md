# TinyCart Shared Hosting Setup

These steps target Namecheap/cPanel-style shared hosting with PHP.

## Requirements

- PHP 8.1+ recommended.
- PHP extensions: `pdo_sqlite`, `json`, `mbstring`, `openssl`.
- Writable private `data/` directory for SQLite, logs, and rate-limit buckets.

## Upload

1. Upload `tinycart.js`, `checkout.php`, `README.md`, `SECURITY.md`, and `index.html` to `public_html/tinycart/` or your storefront directory.
2. Edit `checkout.php`:
   - Set `ALLOWED_ORIGINS` to your real storefront origins.
   - Add one or more long random `API_KEYS` if you want the `X-API-KEY` check.
   - Replace `HMAC_SECRET`.
   - Replace `PRODUCT_CATALOG` with your real product ids, prices, and stock.
3. Create `data/` beside `checkout.php` or let the script create it.

Recommended permissions:

```bash
chmod 755 public_html
chmod 755 public_html/tinycart
chmod 750 public_html/tinycart/data
chmod 640 public_html/tinycart/data/orders.sqlite
chmod 640 public_html/tinycart/data/errors.log
```

If cPanel runs PHP as your user, `750`/`640` usually works. If SQLite cannot write, use cPanel File Manager to make `data/` writable by the account owner, not world-writable.

## SQLite

`checkout.php` creates `data/orders.sqlite` and the required tables automatically with PDO prepared statements.

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

## Cron Ideas

TinyCart does not need cron for basic orders. If you later add payment retries or notifications, add cPanel Cron entries like:

```cron
*/10 * * * * /usr/local/bin/php /home/USERNAME/public_html/tinycart/jobs/retry_failed_payments.php >/dev/null 2>&1
0 3 * * * find /home/USERNAME/public_html/tinycart/data/rate_limits -type f -mtime +2 -delete
15 3 * * * /usr/local/bin/php /home/USERNAME/public_html/tinycart/jobs/export_orders.php >/dev/null 2>&1
```

Keep cron scripts outside public web access where possible, or protect `/jobs` with `.htaccess`.

## Merchant Page Embed

Place product buttons anywhere on your site, then include:

```html
<script
  src="/tinycart/tinycart.js"
  data-tc-config='{"cartKey":"store-1","currency":"USD","apiCheckout":"/tinycart/checkout.php","accent":"#1A73E8"}'>
</script>
```

If your checkout endpoint is on another subdomain, add that origin to your CSP `connect-src` and to `ALLOWED_ORIGINS`.
