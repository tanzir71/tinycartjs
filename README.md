# TinyCart

[![version 0.2.0](https://img.shields.io/badge/version-0.2.0-111111)](https://github.com/tanzir71/tinycartjs/releases)
[![zero dependencies](https://img.shields.io/badge/dependencies-zero-1A73E8)](package.json)

TinyCart turns a static website into a small storefront with one script include and a few `data-tc-*` attributes, then hands validated orders to PHP/SQLite for COD, online payment, inventory, coupons, and ops admin.

Repository: https://github.com/tanzir71/tinycartjs

## Quick Start

1. Upload `tinycart.js`, `checkout.php`, optional `coupon.php`, optional `payment.php`, optional `catalog.php`, optional `admin.php`, and optional `collect.php` to your site.
2. Configure `checkout.php`: set `ALLOWED_ORIGINS`, optional `API_KEYS`, `HMAC_SECRET`, `PRODUCT_CATALOG`, `COUPONS`, and optional payment methods such as COD.
3. Configure `coupon.php` if you use server-side coupon validation: set `COUPON_ALLOWED_ORIGINS`, optional `COUPON_API_KEYS`, and `COUPONS`.
4. Configure `admin.php` if you use the ops dashboard for order status, COD collection, stock, coupon overrides, CSV export, or webhook retry.
5. Configure `collect.php` if you use analytics: set `COLLECT_ALLOWED_ORIGINS` and optional `COLLECT_API_KEYS`.
6. Add product buttons and the script tag:

```html
<button
  data-tc-id="tee-001"
  data-tc-name="TinyCart Tee"
  data-tc-price="24.00"
  data-tc-qty="1"
  data-tc-options='{"size":"M","color":"Black"}'>
  Add tee
</button>

<script
  src="tinycart.js"
  data-tc-config='{"cartKey":"store-1","currency":"USD","apiCheckout":"/checkout.php","apiCoupon":"/coupon.php","paymentMethods":["online","cod"],"defaultPaymentMethod":"cod","accent":"#1A73E8"}'>
</script>
```

TinyCart auto-initializes from `data-tc-config`, stores the cart in `localStorage`, renders a floating cart button, and posts checkout JSON to your backend.

## CDN / Releases

For production, pin a release tag instead of loading from a moving branch:

```html
<script
  src="https://cdn.jsdelivr.net/gh/tanzir71/tinycartjs@v0.2.0/tinycart.js"
  data-tc-config='{"cartKey":"store-1","currency":"USD","apiCheckout":"/checkout.php","paymentMethods":["online","cod"],"defaultPaymentMethod":"cod"}'>
</script>
```

If you want a smaller asset, run `npm run build:min` to produce `tinycart.min.js`, then serve the pinned CDN path:

```html
<script src="https://cdn.jsdelivr.net/gh/tanzir71/tinycartjs@v0.2.0/tinycart.min.js"></script>
```

The minified file is optional; `tinycart.js` remains the canonical readable build.

## Product Attributes

- `data-tc-id`: required product id. Must exist in the server catalog.
- `data-tc-name`: required display name. Displayed with `textContent`, never as raw HTML.
- `data-tc-price`: required decimal price, such as `24.00`. The server must re-check this.
- `data-tc-qty`: optional default quantity, default `1`.
- `data-tc-options`: optional JSON object, such as `{"size":"M"}`. TinyCart accepts simple string/number/boolean values only and drops nested objects.
- `data-tc-stock`: optional client-side stock cap.
- `data-tc-sig`: optional HMAC signature for signed product data.
- `data-tc-exp`: optional Unix expiry timestamp paired with `data-tc-sig`.

## Configuration

```js
tinycart.init({
  cartKey: "store-1",
  currency: "USD",
  locale: "en-US",
  apiCheckout: "/checkout.php",
  apiCoupon: "/coupon.php",
  catalogUrl: "/catalog.php",
  analyticsUrl: "/collect.php",
  apiKey: "optional-public-endpoint-key",
  accent: "#1A73E8",
  paymentMethods: ["online", "cod"],
  defaultPaymentMethod: "cod",
  allowedOptionKeys: ["size", "color", "finish"],
  maxQueueItems: 20,
  maxQueueBytes: 24576,
  strings: {
    cart: "Cart",
    checkout: "Checkout",
    coupon: "Coupon code",
    paymentOnline: "Pay online",
    paymentCod: "Cash on delivery",
    paymentManual: "Manual payment"
  },
  coupons: { SAVE10: { type: "percent", value: 10 } },
  onCheckout: async (payload) => fetch("/checkout.php", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  }).then((res) => res.json()),
  onValidateCoupon: async (code, cart) => ({ ok: code === "SAVE10", type: "percent", value: 10 })
});
```

JSON inside `data-tc-config` cannot include functions, so use `tinycart.init()` when you need hooks.

Set `locale` to any `Intl.NumberFormat` locale, such as `de-DE` or `ja-JP`, to localize currency display while keeping all amounts as integer cents internally. Use `strings` to override visible widget copy for translation; unspecified keys use the English defaults.

## Developer API

- `tinycart.init(config)`: initializes or re-initializes the widget.
- `tinycart.add(item)`: adds `{id, name, price, qty, options, stock, sig, exp}`.
- `tinycart.remove(itemId)`: removes by TinyCart item key or product id.
- `tinycart.update(itemId, { qty })`: updates quantity; `qty <= 0` removes the item.
- `tinycart.getCart()`: returns cart items, coupon, and totals.
- `tinycart.clear()`: empties cart and coupon state.
- `tinycart.applyCoupon(code)`: validates a coupon locally, through `apiCoupon`, or with `onValidateCoupon`.
- `tinycart.flushQueue()`: retries queued analytics pings immediately.
- `tinycart.safeTemplate(template, values)`: interpolates `{% raw %}{{placeholders}}{% endraw %}` with escaped values and rejects template strings containing tags.
- `tinycart.on(event, handler)`: subscribes and returns an unsubscribe function.

Events:

- `cart:updated`
- `cart:opened`
- `cart:checkedout`
- `cart:applyCoupon`

TinyCart also dispatches DOM events named `tinycart:cart:updated`, etc.

## Analytics / Collect Endpoint

Set `analyticsUrl` to `/collect.php` to receive lightweight events. TinyCart uses `navigator.sendBeacon` when no API key is configured. If `apiKey` is configured, TinyCart uses `fetch(..., { keepalive: true })` so it can send `X-API-KEY`.

Failed analytics sends are queued in `localStorage` under the cart key with size, count, retention, and exponential-backoff limits. The queue is for operational events only; do not put secrets or unnecessary PII into analytics payloads.

## Coupon Endpoint

Set `apiCoupon` to `/coupon.php` to validate coupons before checkout. The coupon endpoint checks origin, optional API keys, rate limits, and a server-side `COUPONS` list, then returns the computed discount for UI feedback.

`checkout.php` re-validates the coupon against its own `COUPONS` list and recomputes `discount_cents`/`total_cents` before storing the order. Invalid, expired, or forged coupon payloads are ignored by checkout.

`admin.php` can activate or deactivate configured coupon codes through the `coupon_overrides` table. Overrides are respected by both `/coupon.php` previews and final `/checkout.php` validation, so operators can pause a campaign without editing PHP constants.

## COD and Payment Methods

By default TinyCart keeps legacy behavior: if no `paymentMethod` is sent and `PAYMENT_PROVIDER` is blank, checkout is treated as `manual`; if `PAYMENT_PROVIDER` is `stripe` or `paypal`, checkout is treated as `online`.

To show shopper choices, set `ENABLED_PAYMENT_METHODS` in `checkout.php`, for example `['online', 'cod']`, and set the widget config to `paymentMethods: ["online", "cod"]`. `DEFAULT_PAYMENT_METHOD` and `defaultPaymentMethod` choose the initially selected option. The widget renders radio controls only when more than one method is configured.

Cash on Delivery orders skip Stripe/PayPal handoff. Checkout stores `payment_method: cod`, `payment_provider: cod`, and `payment_status: cod_due`; the response has no `pay_url`. In the admin dashboard, use **Cash collected** to mark COD orders paid and set `paid_at`.

## Payment Handoff

Payment providers are disabled by default. To redirect completed checkouts to a hosted payment page, configure `checkout.php` with `PAYMENT_PROVIDER` set to `stripe` or `paypal`, add the matching server-side credentials, and set `PAYMENT_SUCCESS_URL` / `PAYMENT_CANCEL_URL`.

TinyCart stores online orders first with `payment_status: pending`, then creates the provider checkout/order using the server-recomputed `total_cents`. The browser receives `pay_url` and `tinycart.js` redirects there automatically. Keep all provider credentials in PHP only; never put Stripe or PayPal secrets in `data-tc-config`.

For Stripe, point the Checkout success URL at your thank-you page and configure a Stripe webhook to POST `checkout.session.completed` events to `payment.php`; set `STRIPE_WEBHOOK_SECRET` in `payment.php` so signatures are verified before marking an order paid. For PayPal, use `payment.php?order_id={ORDER_ID}` as the success URL; the handler captures the approved PayPal order server-side before marking the TinyCart order paid.

## Catalog Endpoint

Set `catalogUrl` to `/catalog.php` to hydrate product name, price, currency, and stock from the server. When catalog data is available, TinyCart uses the server price instead of `data-tc-price`, and out-of-stock buttons are disabled client-side. `checkout.php` still enforces catalog truth during checkout.

## Theme Tokens

TinyCart styles are scoped under `.tc-root` and use CSS custom properties so host pages can theme without forking:

```css
.tc-root {
  --tc-accent: #1A73E8;
  --tc-bg: #fff;
  --tc-fg: #080808;
  --tc-muted: #666;
  --tc-line: #e7e7e7;
  --tc-soft: #f7f7f7;
  --tc-radius: 18px;
  --tc-font: Inter, system-ui, sans-serif;
}
```

The widget includes dark-mode token defaults via `prefers-color-scheme`; host-defined `.tc-root` variables can override them.

## Persistent Cart

TinyCart stores items, options, coupon state, and totals metadata in `localStorage` under a versioned schema. Reloads preserve the cart exactly; future incompatible schema versions are cleared safely rather than throwing or loading corrupt data.

## Inventory

`checkout.php` seeds an `inventory` table from `PRODUCT_CATALOG` and decrements stock inside the same SQLite transaction that stores the order. If any line cannot reserve stock, checkout returns `409 {"ok":false,"error":"Out of stock"}` and no order is stored. The admin dashboard can update stock without editing PHP.

## Webhooks and Email

Set `WEBHOOK_URL` and `WEBHOOK_SECRET` in `checkout.php` to POST a signed, PII-free order summary after a successful checkout. The payload includes order id, totals, coupon code, payment method/status, fulfilment status, and line items; it does not include customer name, phone, email, or address. Delivery failures are queued in `webhook_deliveries` with a future retry time and never block checkout. Admin can queue an immediate retry from the webhook health panel.

Set `ORDER_EMAIL_TO` to send a plaintext best-effort order email from PHP `mail()`.

## Order Admin

Upload `admin.php` for a minimal ops dashboard backed by `data/orders.sqlite`. It is closed by default: configure `ADMIN_API_KEYS` or set `ADMIN_PASSWORD_HASH` with `password_hash()` before using it, and set `ADMIN_ALLOWED_ORIGINS` to your storefront/admin origin.

The dashboard lists and filters orders, opens order detail, updates payment and fulfilment status, stores admin notes, marks COD cash collected, updates stock, toggles coupon overrides, exports the filtered order list as CSV, and queues webhook retries. All write forms require auth plus a PHP session CSRF token.

## Sample Product Buttons

```html
<button data-tc-id="tee-001" data-tc-name="TinyCart Tee" data-tc-price="24.00" data-tc-options='{"size":"M","color":"Black"}'>Add tee</button>
<button data-tc-id="mug-001" data-tc-name="Checkout Mug" data-tc-price="18.00" data-tc-options='{"finish":"Matte"}'>Add mug</button>
<button data-tc-id="sticker-001" data-tc-name="Script Tag Sticker Pack" data-tc-price="7.00" data-tc-qty="2">Add stickers</button>

<script src="tinycart.js" data-tc-config='{"cartKey":"demo-store","currency":"USD","apiCheckout":"/checkout.php","apiCoupon":"/coupon.php","paymentMethods":["online","cod"],"defaultPaymentMethod":"cod","accent":"#1A73E8"}'></script>
```

## Signed Product Flow

HMAC signatures are optional defense in depth. They do not replace server-side catalog checks.

PHP signing:

```php
$expires = time() + 3600;
$sig = hash_hmac('sha256', 'tee-001|2400|' . $expires, HMAC_SECRET);
```

Node signing:

```js
import crypto from "node:crypto";
const expires = Math.floor(Date.now() / 1000) + 3600;
const sig = crypto.createHmac("sha256", process.env.TINYCART_HMAC_SECRET)
  .update(`tee-001|2400|${expires}`)
  .digest("hex");
```

Render `data-tc-exp` and `data-tc-sig` on the product button. TinyCart preserves them in the checkout payload. `checkout.php` verifies them with `hash_hmac()` and `hash_equals()`.

## Security Note

Never trust client-sent price, name, total, coupon, or stock. Use TinyCart for UX; use your backend for truth.
