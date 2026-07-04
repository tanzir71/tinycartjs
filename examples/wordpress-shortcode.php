<?php
/**
 * TinyCart WordPress shortcode snippet.
 *
 * Copy into a small site plugin or your theme functions.php, then place:
 * [tinycart_product id="tee-001" name="TinyCart Tee" price="24.00" label="Add tee"]
 */

add_action('wp_footer', function (): void {
    $config = wp_json_encode([
        'cartKey' => 'wordpress-store',
        'currency' => 'USD',
        'apiCheckout' => home_url('/tinycart/checkout.php'),
        'apiCoupon' => home_url('/tinycart/coupon.php'),
        'catalogUrl' => home_url('/tinycart/catalog.php'),
    ]);

    echo '<script src="' . esc_url(home_url('/tinycart/tinycart.js')) . '" data-tc-config="' . esc_attr($config) . '"></script>';
});

add_shortcode('tinycart_product', function (array $atts): string {
    $atts = shortcode_atts([
        'id' => '',
        'name' => '',
        'price' => '',
        'label' => 'Add to cart',
        'options' => '{}',
    ], $atts, 'tinycart_product');

    return sprintf(
        '<button data-tc-id="%s" data-tc-name="%s" data-tc-price="%s" data-tc-options="%s">%s</button>',
        esc_attr($atts['id']),
        esc_attr($atts['name']),
        esc_attr($atts['price']),
        esc_attr($atts['options']),
        esc_html($atts['label'])
    );
});
