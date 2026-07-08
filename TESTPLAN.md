# TinyCart Test Plan

Run the PHP server from the repo root:

```bash
php -S 127.0.0.1:8000
```

## Successful Checkout

```bash
curl -i -X POST http://127.0.0.1:8000/checkout.php \
  -H "Origin: http://127.0.0.1:8000" \
  -H "Content-Type: application/json" \
  --data '{"cartKey":"demo-store","currency":"USD","customer":{"name":"Ada Lovelace","phone":"+15551234567","email":"ada@example.com","address":"1 Byte Lane"},"cart":{"items":[{"id":"tee-001","name":"TinyCart Tee","priceCents":2400,"qty":1,"options":{"size":"M"}}],"totals":{"subtotalCents":2400}},"page":"http://127.0.0.1:8000/sample.html"}'
```

Expected: `{"ok":true,"order_id":"T...","pay_url":null}`.

## Price Tampering Rejection

```bash
curl -i -X POST http://127.0.0.1:8000/checkout.php \
  -H "Origin: http://127.0.0.1:8000" \
  -H "Content-Type: application/json" \
  --data '{"cartKey":"demo-store","currency":"USD","customer":{"name":"Mallory","phone":"+15550000000","email":"mallory@example.com","address":"2 Exploit Ave"},"cart":{"items":[{"id":"tee-001","name":"TinyCart Tee","priceCents":1,"qty":1,"options":{}}],"totals":{"subtotalCents":1}},"page":"http://127.0.0.1:8000/sample.html"}'
```

Expected: HTTP `400` with `price mismatch`.

## Coupon Validation

```bash
curl -i -X POST http://127.0.0.1:8000/coupon.php \
  -H "Origin: http://127.0.0.1:8000" \
  -H "Content-Type: application/json" \
  --data '{"code":"SAVE10","cart":{"totals":{"subtotalCents":2400}}}'
```

Expected: HTTP `200` with `{"ok":true,...,"discount_cents":240}`.

Invalid or expired codes:

```bash
curl -i -X POST http://127.0.0.1:8000/coupon.php \
  -H "Origin: http://127.0.0.1:8000" \
  -H "Content-Type: application/json" \
  --data '{"code":"EXPIRED","cart":{"totals":{"subtotalCents":2400}}}'
```

Expected: HTTP `400` with `Coupon expired.`.

Forged checkout coupons are ignored. Sending `{"code":"FAKE100","amount":2400}` in `cart.coupon` should still return `discount_cents:0` and `total_cents` equal to the server subtotal.

After configuring admin auth, deactivate `SAVE10` from `admin.php`. Expected: `/coupon.php` rejects `SAVE10`, and `/checkout.php` ignores a submitted `SAVE10` coupon. Reactivating it restores both preview and checkout discounts.

## Shipping Fees

Configure `SHIPPING` in `checkout.php` with either a flat amount or named zones such as `local` and `remote`, then submit checkout with a forged client shipping amount:

```bash
curl -i -X POST http://127.0.0.1:8000/checkout.php \
  -H "Origin: http://127.0.0.1:8000" \
  -H "Content-Type: application/json" \
  --data '{"cartKey":"demo-store","currency":"USD","customer":{"name":"Ada Lovelace","phone":"+15551234567","email":"ada@example.com","address":"1 Byte Lane"},"shipping":{"zone":"remote","amount_cents":0},"cart":{"items":[{"id":"tee-001","name":"TinyCart Tee","priceCents":2400,"qty":1,"options":{"size":"M"}}],"coupon":{"code":"SAVE10","amount":240},"totals":{"subtotalCents":2400,"discountCents":240,"totalCents":2160}},"page":"http://127.0.0.1:8000/sample.html"}'
```

Expected: the server ignores `shipping.amount_cents`, resolves the configured `remote` zone, stores `shipping_cents`, and returns `total_cents = subtotal - discount + shipping`. `/coupon.php` preview should return the same `shipping_cents` and `total_cents` for the selected zone.

## Payment Handoff

With `PAYMENT_PROVIDER` blank in `checkout.php`, successful checkout should still return `"pay_url":null`.

With Stripe or PayPal configured, successful checkout stores the order with `payment_status` pending, creates a provider checkout/order using the server-recomputed `total_cents`, and returns a non-null `pay_url`. Stripe paid status is finalized by signed `checkout.session.completed` webhooks sent to `payment.php`; PayPal paid status is finalized by the return handler at `payment.php?order_id={ORDER_ID}` after capture.

## Cash on Delivery

Set `ENABLED_PAYMENT_METHODS = ['online', 'cod']` and `DEFAULT_PAYMENT_METHOD = 'cod'` in `checkout.php`, then send a checkout payload with `"paymentMethod":"cod"`:

```bash
curl -i -X POST http://127.0.0.1:8000/checkout.php \
  -H "Origin: http://127.0.0.1:8000" \
  -H "Content-Type: application/json" \
  --data '{"cartKey":"demo-store","currency":"USD","paymentMethod":"cod","customer":{"name":"Nadia","phone":"+8801555123456","email":"","address":"12 Market Road"},"cart":{"items":[{"id":"tee-001","name":"TinyCart Tee","priceCents":2400,"qty":1,"options":{}}],"totals":{"subtotalCents":2400}},"page":"http://127.0.0.1:8000/sample.html"}'
```

Expected: HTTP `200`, `pay_url:null`, `payment_method:"cod"`, and `payment_status:"cod_due"` in the response. The stored order row should have `payment_provider = cod`.

If no `paymentMethod` is sent, legacy behavior remains: blank `PAYMENT_PROVIDER` means manual checkout; `stripe` or `paypal` means online checkout.

## Payment Method UI

Set:

```html
data-tc-config='{"paymentMethods":["online","cod"],"defaultPaymentMethod":"cod","apiCheckout":"/checkout.php"}'
```

Expected: the mobile cart shows radio options for online payment and Cash on Delivery, COD is selected by default, and checkout JSON includes `"paymentMethod":"cod"`. With zero or one configured method, the widget should not render the radio group.

## Digital Downloads

Configure `ebook-001` with a `file` in `checkout.php`, mirror it in `download.php`, then create an order:

```bash
curl -i -X POST http://127.0.0.1:8000/checkout.php \
  -H "Origin: http://127.0.0.1:8000" \
  -H "Content-Type: application/json" \
  --data '{"cartKey":"demo-store","currency":"USD","customer":{"name":"Ada Lovelace","phone":"+15551234567","email":"ada@example.com","address":"1 Byte Lane"},"cart":{"items":[{"id":"ebook-001","name":"TinyCart Ebook","priceCents":1200,"qty":1,"options":{}}],"totals":{"subtotalCents":1200}},"page":"http://127.0.0.1:8000/sample.html"}'
```

Expected: response includes a `downloads[0].url`. Before the order is marked `paid`, this URL returns HTTP `403` JSON. After marking the order paid through `payment.php` or `admin.php`, the same URL streams the file with `Content-Disposition: attachment`.

Tamper and expiry checks:

```bash
curl -i "http://127.0.0.1:8000/download.php?order=TORDER&item=wrong&exp=9999999999&sig=BAD"
curl -i "http://127.0.0.1:8000/download.php?order=TORDER&item=ebook-001&exp=1&sig=RECOMPUTED_EXPIRED_SIG"
```

Expected: HTTP `403` JSON and no file bytes. Download the paid link more than `DOWNLOAD_MAX_COUNT` times; the next request should return HTTP `403` JSON with `Download limit reached`.

Automated tests also send forged and expired links before any storage lookup, so these paths must reject with the same JSON errors even when SQLite is unavailable locally. The download-count cap requires `pdo_sqlite` because it persists attempts in the order database.

## Catalog Endpoint

```bash
curl -i http://127.0.0.1:8000/catalog.php \
  -H "Origin: http://127.0.0.1:8000"
```

Expected: HTTP `200` with `{"ok":true,"items":[...]}`, `Access-Control-Allow-Origin` echoed, and `Cache-Control: public, max-age=60`.

## Origin Rejection

```bash
curl -i -X POST http://127.0.0.1:8000/checkout.php \
  -H "Origin: https://evil.example" \
  -H "Content-Type: application/json" \
  --data '{"cart":{"items":[]},"customer":{}}'
```

Expected: HTTP `403` with `Origin not allowed`.

## Browser Fetch Simulation

```js
fetch("/checkout.php", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    cartKey: "demo-store",
    currency: "USD",
    customer: { name: "Grace", phone: "+15551230000", email: "grace@example.com", address: "3 Compiler Ct" },
    cart: {
      items: [{ id: "mug-001", name: "Checkout Mug", priceCents: 1800, qty: 1, options: { finish: "Matte" } }],
      totals: { subtotalCents: 1800 }
    },
    page: location.href
  })
}).then(r => r.json()).then(console.log);
```

## Locale and Strings

Set `data-tc-config='{"currency":"EUR","locale":"de-DE","strings":{"cart":"Warenkorb","checkout":"Bestellen"}}'` on `sample.html`.

Expected: cart totals use German EUR formatting and the floating button/checkout button use the configured text.

## Theme Tokens

Add a page style such as:

```css
.tc-root { --tc-accent:#0f766e; --tc-radius:4px; --tc-font:system-ui,sans-serif; }
```

Expected: only TinyCart UI changes; host page buttons/inputs outside `.tc-root` are unaffected.

## Persistent Cart

Add an item with options, apply `SAVE10`, then reload `sample.html`.

Expected: the same item, options, coupon, and discount return. If localStorage contains a future schema version, TinyCart clears it without throwing.

## Inventory Enforcement

Send a checkout with `qty` higher than the server stock for a product.

Expected: HTTP `400` during catalog validation if the request exceeds configured product stock. If stock is depleted by earlier successful orders, checkout returns HTTP `409` with `Out of stock`, the widget shows a stock-specific message, and the order is not stored.

## Webhooks and Email

Configure `WEBHOOK_URL` and `WEBHOOK_SECRET`, then complete a checkout.

Expected: checkout still succeeds even if the webhook endpoint is down. Successful webhook requests include `X-TinyCart-Signature` as an HMAC-SHA256 of the JSON body, and the JSON body contains totals/items, `payment_method`, `payment_status`, and `fulfillment_status`, but no customer PII.

If delivery fails, open `admin.php` and use `Retry now` in Webhook health. Expected: the delivery row moves back to `pending`, `attempts` increments, and `next_attempt_at` is set to now.

## Order Admin

With the default `admin.php` config, the page is disabled:

```bash
curl -i http://127.0.0.1:8000/admin.php \
  -H "Origin: http://127.0.0.1:8000"
```

Expected: HTTP `403` with `Admin access is not configured.`.

After configuring `ADMIN_API_KEYS` or `ADMIN_PASSWORD_HASH`, `admin.php` should list recent orders with totals and pagination. Probe order/customer/note fields containing markup should render escaped text, not executable HTML.

Admin write checks:

- POST without a valid `_csrf` token should return HTTP `403`.
- Unknown payment or fulfilment status values should return HTTP `400`.
- Updating payment status, fulfilment status, and admin note should persist and redirect back to the dashboard.
- The `Cash collected` COD action should set `payment_status` to `paid` and populate `paid_at`.
- Updating inventory should change the `inventory` stock shown in the panel.
- CSV export should include only the current filtered order list and prefix formula-like cells such as `=`, `+`, `-`, and `@` with an apostrophe.

## Order Status Lookup

Post the same form once with a real order id and wrong phone, then once with a wrong order id and real phone:

```bash
curl -i -X POST http://127.0.0.1:8000/order-status.php \
  -H "Origin: http://127.0.0.1:8000" \
  -H "Content-Type: application/x-www-form-urlencoded" \
  --data 'order_id=TREAL123&phone=%2B0000000000'

curl -i -X POST http://127.0.0.1:8000/order-status.php \
  -H "Origin: http://127.0.0.1:8000" \
  -H "Content-Type: application/x-www-form-urlencoded" \
  --data 'order_id=T404&phone=%2B15551234567'
```

Expected: both misses return HTTP `200` with the same "No matching order found" page shape and similar response timing. A hit requires exact order id and exact phone, escapes every rendered field, and shows only partial address context.

## Beacon / Collect Accepts JSON

```bash
curl -i -X POST http://127.0.0.1:8000/collect.php \
  -H "Origin: http://127.0.0.1:8000" \
  -H "Content-Type: application/json" \
  --data '{"type":"cart_snapshot","cartKey":"demo-store","currency":"USD","payload":{"count":2,"total":3100},"ts":"2026-05-14T00:00:00.000Z"}'
```

Expected: HTTP `200` with `{"ok":true}`.

Browser sendBeacon/fetch keepalive simulation:

```js
const body = JSON.stringify({
  type: "cart_snapshot",
  cartKey: "demo-store",
  currency: "USD",
  payload: { count: 1, total: 2400 },
  ts: new Date().toISOString()
});

if (!navigator.sendBeacon("/collect.php", new Blob([body], { type: "application/json" }))) {
  fetch("/collect.php", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body,
    keepalive: true
  });
}
```

## Collect Origin Rejection

```bash
curl -i -X POST http://127.0.0.1:8000/collect.php \
  -H "Origin: https://evil.example" \
  -H "Content-Type: application/json" \
  --data '{"type":"cart_snapshot","cartKey":"demo-store","payload":{},"ts":"2026-05-14T00:00:00.000Z"}'
```

Expected: HTTP `403` with `Origin not allowed`.

## XSS Probe

Add this button to `sample.html` during local testing:

```html
<button
  data-tc-id="tee-001"
  data-tc-name="<img src=x onerror=alert(1)>"
  data-tc-price="24.00"
  data-tc-options='{"size":"<script>alert(1)</script>","__proto__":"blocked","nested":{"bad":true}}'>
  Add XSS probe
</button>
```

Expected:

- No alert executes.
- The cart displays the payload as text, not markup.
- `__proto__` and nested option values are dropped.

## CSRF Expectations

TinyCart's admin write forms require login and PHP session CSRF tokens. Public checkout/collect endpoints rely on explicit `Origin` checks, optional API keys, validation, and rate limits rather than browser cookies.

## Collect Rate Limit

This sends 130 events quickly. With the default `COLLECT_RATE_MAX_REQUESTS = 120`, the later requests should return HTTP `429`.

```bash
for i in $(seq 1 130); do
  curl -s -o /dev/null -w "%{http_code}\n" \
    -X POST http://127.0.0.1:8000/collect.php \
    -H "Origin: http://127.0.0.1:8000" \
    -H "Content-Type: application/json" \
    --data "{\"type\":\"cart_snapshot\",\"cartKey\":\"demo-store\",\"payload\":{\"n\":$i},\"ts\":\"2026-05-14T00:00:00.000Z\"}"
done
```

Expected: initial `200` responses followed by `429` once the bucket is exhausted.
