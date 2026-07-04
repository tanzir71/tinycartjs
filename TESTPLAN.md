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

## Payment Handoff

With `PAYMENT_PROVIDER` blank in `checkout.php`, successful checkout should still return `"pay_url":null`.

With Stripe or PayPal configured, successful checkout stores the order with `payment_status` pending, creates a provider checkout/order using the server-recomputed `total_cents`, and returns a non-null `pay_url`. Stripe paid status is finalized by signed `checkout.session.completed` webhooks sent to `payment.php`; PayPal paid status is finalized by the return handler at `payment.php?order_id={ORDER_ID}` after capture.

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

Expected: checkout still succeeds even if the webhook endpoint is down. Successful webhook requests include `X-TinyCart-Signature` as an HMAC-SHA256 of the JSON body, and the JSON body contains totals/items but no customer PII.

## Order Admin

With the default `admin.php` config, the page is disabled:

```bash
curl -i http://127.0.0.1:8000/admin.php \
  -H "Origin: http://127.0.0.1:8000"
```

Expected: HTTP `403` with `Admin access is not configured.`.

After configuring `ADMIN_API_KEYS` or `ADMIN_PASSWORD_HASH`, `admin.php` should list recent orders with totals and pagination. Probe order/customer fields containing markup should render escaped text, not executable HTML.

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

TinyCart's admin page is read-only. If you add order-management routes later, enforce login and CSRF tokens there. Public checkout/collect endpoints rely on explicit `Origin` checks, optional API keys, validation, and rate limits rather than browser cookies.

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
