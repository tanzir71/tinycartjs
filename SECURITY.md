# TinyCart Security

TinyCart is a storefront widget, not a payment processor. The browser improves UX; the server is the source of truth.

## Implemented Safeguards

- server-side price verification against `PRODUCT_CATALOG`.
- Optional HMAC product signatures with expiry.
- PDO prepared statements for every SQLite write.
- Origin allowlist with CORS preflight handling.
- Optional `X-API-KEY` allowlist.
- Per-IP rate limiting with locked bucket files.
- Generic server errors returned to clients; details are logged to `data/errors.log`.
- Input size limits and required field validation.
- DOM safety in `tinycart.js`: merchant/customer strings are inserted with `textContent` or safe attributes, not raw HTML. `htmlEscape()` is exposed for integrations that need string escaping.
- Cart storage limit to reduce localStorage abuse.
- `navigator.sendBeacon` analytics with `fetch(..., { keepalive: true })` fallback.

## Still Required From Merchants

- Verify product ids, prices, stock, totals, discounts, and payment status server-side.
- Protect admin or order-management endpoints with authentication and CSRF tokens.
- Do not expose `HMAC_SECRET`, API keys, payment secrets, or database files.
- Use HTTPS everywhere.
- Collect only the PII you need and define a retention period.

## CSP Recommendations

Merchant page using local `tinycart.js`:

```http
Content-Security-Policy: default-src 'self'; script-src 'self'; connect-src 'self' https://checkout.example.com; img-src 'self' data:; style-src 'self' 'unsafe-inline'; base-uri 'self'; form-action 'self'
```

Landing page with Google-hosted Inter:

```http
Content-Security-Policy: default-src 'self'; script-src 'self'; connect-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; base-uri 'self'; form-action 'self'
```

TinyCart injects a small inline `<style>` block, so `style-src 'unsafe-inline'` is the simplest CSP option for the MVP. A stricter production variant can move the CSS into a hosted stylesheet.

## API Key Rotation

1. Add a new key to `API_KEYS` while keeping the old key.
2. Deploy merchant pages or server callers with the new key.
3. Confirm traffic is using the new key.
4. Remove the old key and redeploy.

Use at least 32 random bytes. Store keys outside git when possible.

## HMAC Secret Rotation

HMAC signatures are valid until `data-tc-exp`. To rotate safely:

1. Add support for a previous secret during the overlap window.
2. Start signing new product buttons with the new secret.
3. Wait until all old signatures expire.
4. Remove the previous secret.

Do not put the HMAC secret in JavaScript. Sign product data server-side and verify it in `checkout.php`.

## Privacy

The default endpoint stores name, phone, optional email, address, item data, page URL, IP hash, and timestamp. Remove fields you do not need, publish retention terms, and delete/export data according to local privacy obligations such as GDPR/CCPA where applicable.
