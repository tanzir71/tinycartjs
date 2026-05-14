# TinyCart

TinyCart turns a static website into a small storefront with one script include and a few `data-tc-*` attributes.

Repository: https://github.com/tanzir71/tinycartjs

## Quick Start

1. Upload `tinycart.js` and `checkout.php` to your site.
2. Configure `checkout.php`: set `ALLOWED_ORIGINS`, optional `API_KEYS`, `HMAC_SECRET`, and `PRODUCT_CATALOG`.
3. Add product buttons and the script tag:

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
  data-tc-config='{"cartKey":"store-1","currency":"USD","apiCheckout":"/checkout.php","accent":"#1A73E8"}'>
</script>
```

TinyCart auto-initializes from `data-tc-config`, stores the cart in `localStorage`, renders a floating cart button, and posts checkout JSON to your backend.

## Product Attributes

- `data-tc-id`: required product id. Must exist in the server catalog.
- `data-tc-name`: required display name. Displayed with `textContent`, never as raw HTML.
- `data-tc-price`: required decimal price, such as `24.00`. The server must re-check this.
- `data-tc-qty`: optional default quantity, default `1`.
- `data-tc-options`: optional JSON object, such as `{"size":"M"}`.
- `data-tc-stock`: optional client-side stock cap.
- `data-tc-sig`: optional HMAC signature for signed product data.
- `data-tc-exp`: optional Unix expiry timestamp paired with `data-tc-sig`.

## Configuration

```js
tinycart.init({
  cartKey: "store-1",
  currency: "USD",
  apiCheckout: "/checkout.php",
  apiCoupon: "/coupon.php",
  analyticsUrl: "/analytics.php",
  accent: "#1A73E8",
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

## Developer API

- `tinycart.init(config)`: initializes or re-initializes the widget.
- `tinycart.add(item)`: adds `{id, name, price, qty, options, stock, sig, exp}`.
- `tinycart.remove(itemId)`: removes by TinyCart item key or product id.
- `tinycart.update(itemId, { qty })`: updates quantity; `qty <= 0` removes the item.
- `tinycart.getCart()`: returns cart items, coupon, and totals.
- `tinycart.clear()`: empties cart and coupon state.
- `tinycart.applyCoupon(code)`: validates a coupon locally, through `apiCoupon`, or with `onValidateCoupon`.
- `tinycart.on(event, handler)`: subscribes and returns an unsubscribe function.

Events:

- `cart:updated`
- `cart:opened`
- `cart:checkedout`
- `cart:applyCoupon`

TinyCart also dispatches DOM events named `tinycart:cart:updated`, etc.

## Sample Product Buttons

```html
<button data-tc-id="tee-001" data-tc-name="TinyCart Tee" data-tc-price="24.00" data-tc-options='{"size":"M","color":"Black"}'>Add tee</button>
<button data-tc-id="mug-001" data-tc-name="Checkout Mug" data-tc-price="18.00" data-tc-options='{"finish":"Matte"}'>Add mug</button>
<button data-tc-id="sticker-001" data-tc-name="Script Tag Sticker Pack" data-tc-price="7.00" data-tc-qty="2">Add stickers</button>

<script src="tinycart.js" data-tc-config='{"cartKey":"demo-store","currency":"USD","apiCheckout":"/checkout.php","accent":"#1A73E8"}'></script>
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
