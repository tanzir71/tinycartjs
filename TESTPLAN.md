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
