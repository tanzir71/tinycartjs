# Astro and Eleventy Snippets

## Astro

```astro
---
const product = {
  id: "tee-001",
  name: "TinyCart Tee",
  price: "24.00",
  options: { size: "M", color: "Black" }
};
---

<button
  data-tc-id={product.id}
  data-tc-name={product.name}
  data-tc-price={product.price}
  data-tc-options={JSON.stringify(product.options)}>
  Add {product.name}
</button>

<script
  src="/tinycart/tinycart.js"
  data-tc-config='{"cartKey":"astro-store","currency":"USD","apiCheckout":"/tinycart/checkout.php","apiCoupon":"/tinycart/coupon.php","catalogUrl":"/tinycart/catalog.php"}'>
</script>
```

## Eleventy

```njk
{% set product = {
  id: "tee-001",
  name: "TinyCart Tee",
  price: "24.00",
  options: { size: "M", color: "Black" }
} %}

<button
  data-tc-id="{{ product.id | escape }}"
  data-tc-name="{{ product.name | escape }}"
  data-tc-price="{{ product.price | escape }}"
  data-tc-options='{{ product.options | dump | escape }}'>
  Add {{ product.name | escape }}
</button>

<script
  src="/tinycart/tinycart.js"
  data-tc-config='{"cartKey":"eleventy-store","currency":"USD","apiCheckout":"/tinycart/checkout.php","apiCoupon":"/tinycart/coupon.php","catalogUrl":"/tinycart/catalog.php"}'>
</script>
```
