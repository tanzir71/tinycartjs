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

TinyCart has no admin mutation endpoints. If you add admin order-management routes, enforce login and CSRF tokens there. Public checkout/collect endpoints rely on explicit `Origin` checks, optional API keys, validation, and rate limits rather than browser cookies.

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
