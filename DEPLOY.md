# Deploy TinyCart

TinyCart has two deployment stories:

- The marketing/docs/demo site is static and can run on Vercel or GitHub Pages.
- The real checkout backend is PHP + SQLite and belongs on shared hosting or a VPS with PHP 8+ and `pdo_sqlite`.

Vercel does not run PHP or persist SQLite for this project. Use Vercel for the static site and `demo-store.html` only; do not expect `checkout.php`, `admin.php`, or `order-status.php` to run there.

## Path 1: Vercel Static Demo Site

Use this for the public website, docs, and stubbed demo store.

### CLI

```bash
npm i -g vercel
vercel
```

When prompted:

- Set up and deploy: `Y`
- Framework preset: `Other`
- Build command: leave blank
- Output directory: `./`
- Development command: leave blank

For a production deployment after preview looks right:

```bash
vercel --prod
```

### Dashboard Import

1. Open the Vercel dashboard.
2. Choose **Add New** -> **Project**.
3. Import the Git repository.
4. Set **Framework Preset** to **Other**.
5. Leave **Build Command** empty.
6. Set **Output Directory** to `./`.
7. Deploy.

The included `.vercelignore` excludes PHP, tests, scripts, and Markdown files so the preview cannot look like it runs the backend. The deployed static pages still include `index.html`, `docs.html`, `demo-store.html`, `tinycart.js`, CSS, images, examples, and comparison pages.

## Path 2: GitHub Pages

The repository already includes `.github/workflows/pages.yml`.

1. Push to GitHub.
2. Open the repository settings.
3. Go to **Pages**.
4. Under **Build and deployment**, choose **GitHub Actions**.
5. Push to the default branch.
6. Wait for the **pages build and deployment** workflow to finish.

GitHub Pages serves only static files. The demo checkout in `demo-store.html` is intentionally stubbed there.

## Path 3: Shared Hosting for a Real Store

Use this for live orders, COD ops, online payment handoff, digital downloads, and customer order lookup.

### Upload Checklist

Upload these files to your store directory, for example `public_html/tinycart/`:

- `tinycart.js`
- `checkout.php`
- `coupon.php` if you use coupon preview
- `catalog.php` if you use catalog hydration
- `payment.php` if you use Stripe or PayPal
- `admin.php` if you use the ops dashboard
- `collect.php` if you use analytics
- `download.php` if you sell digital files
- `order-status.php` if customers can check order status
- `site.css`, `site.js`, and HTML pages if the static site lives on the same host

Create a writable `data/` directory beside the PHP files, preferably outside public web root when your host allows it.

Recommended permissions:

```bash
chmod 755 public_html
chmod 755 public_html/tinycart
chmod 750 public_html/tinycart/data
chmod 640 public_html/tinycart/data/orders.sqlite
chmod 640 public_html/tinycart/data/errors.log
```

### PHP 8 + SQLite Health Check

Create a temporary `health.php` next to `checkout.php`:

```php
<?php
declare(strict_types=1);

header('Content-Type: text/plain; charset=utf-8');
echo 'PHP ' . PHP_VERSION . PHP_EOL;
echo 'pdo_sqlite: ' . (extension_loaded('pdo_sqlite') ? 'yes' : 'no') . PHP_EOL;
echo 'sqlite3: ' . (extension_loaded('sqlite3') ? 'yes' : 'no') . PHP_EOL;
echo 'data writable: ' . (is_writable(__DIR__ . '/data') ? 'yes' : 'no') . PHP_EOL;
```

Open it in your browser once. You want PHP 8+, `pdo_sqlite: yes`, and `data writable: yes`.

DELETE `health.php` immediately after checking it.

### Required Edits Before Live Orders

1. Set every `ALLOWED_ORIGINS` constant to your exact storefront origin, including `https://`.
2. Replace `HMAC_SECRET`, webhook secrets, API keys, payment credentials, and admin auth.
3. Replace `PRODUCT_CATALOG`, `COUPONS`, `SHIPPING`, and matching admin/catalog constants.
4. If checkout is served from another subdomain, add it to your site Content Security Policy `connect-src`.
5. Place digital files outside web root or protect their directory with `.htaccess`.
6. Run one test order for each enabled payment method.
7. Open `admin.php` and confirm the order, stock, payment status, fulfilment status, and CSV export.

The PHP endpoints are the source of truth for price, coupon, shipping, stock, payment status, and fulfilment state.
