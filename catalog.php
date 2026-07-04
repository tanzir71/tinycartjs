<?php
declare(strict_types=1);

/**
 * TinyCart read-only product catalog endpoint.
 *
 * Keep this catalog in sync with checkout.php; checkout remains the source of
 * truth and still re-prices every order server-side.
 */

const CATALOG_ALLOWED_ORIGINS = [
    'https://example.com',
    'http://localhost:8000',
    'http://127.0.0.1:8000'
];

const PRODUCT_CATALOG = [
    'tee-001' => ['name' => 'TinyCart Tee', 'price_cents' => 2400, 'currency' => 'USD', 'stock' => 100],
    'mug-001' => ['name' => 'Checkout Mug', 'price_cents' => 1800, 'currency' => 'USD', 'stock' => 80],
    'sticker-001' => ['name' => 'Script Tag Sticker Pack', 'price_cents' => 700, 'currency' => 'USD', 'stock' => 250],
];

catalogMain();

function catalogMain(): void
{
    try {
        catalogCors();
        if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
            catalogJson(['ok' => true], 204);
        }
        if ($_SERVER['REQUEST_METHOD'] !== 'GET') {
            catalogJson(['ok' => false, 'error' => 'Method not allowed'], 405);
        }

        header('Cache-Control: public, max-age=60');
        catalogJson(['ok' => true, 'items' => catalogItems()]);
    } catch (CatalogClientError $error) {
        catalogJson(['ok' => false, 'error' => $error->getMessage()], $error->statusCode);
    } catch (Throwable) {
        catalogJson(['ok' => false, 'error' => 'Unable to load catalog.'], 500);
    }
}

function catalogCors(): void
{
    $origin = $_SERVER['HTTP_ORIGIN'] ?? '';
    if ($origin === '') {
        return;
    }
    if (!in_array($origin, CATALOG_ALLOWED_ORIGINS, true)) {
        throw new CatalogClientError('Origin not allowed', 403);
    }
    header('Access-Control-Allow-Origin: ' . $origin);
    header('Vary: Origin');
    header('Access-Control-Allow-Methods: GET, OPTIONS');
    header('Access-Control-Allow-Headers: Content-Type, X-API-KEY');
    header('Access-Control-Max-Age: 600');
}

function catalogItems(): array
{
    $items = [];
    foreach (PRODUCT_CATALOG as $id => $product) {
        $items[] = [
            'id' => catalogCleanString($id, 120),
            'name' => catalogCleanString($product['name'] ?? '', 180),
            'price_cents' => (int)($product['price_cents'] ?? 0),
            'currency' => catalogCleanString($product['currency'] ?? 'USD', 8) ?: 'USD',
            'stock' => max(0, (int)($product['stock'] ?? 0)),
        ];
    }
    return $items;
}

function catalogCleanString(mixed $value, int $maxLength): string
{
    $value = is_scalar($value) ? (string)$value : '';
    $value = preg_replace('/[[:cntrl:]]/', '', $value) ?? '';
    $value = trim($value);
    return function_exists('mb_substr')
        ? mb_substr($value, 0, $maxLength, 'UTF-8')
        : substr($value, 0, $maxLength);
}

function catalogJson(array $payload, int $status = 200): void
{
    http_response_code($status);
    header('Content-Type: application/json; charset=utf-8');
    header('X-Content-Type-Options: nosniff');
    echo json_encode($payload, JSON_UNESCAPED_SLASHES);
    exit;
}

final class CatalogClientError extends RuntimeException
{
    public int $statusCode;

    public function __construct(string $message, int $statusCode = 400)
    {
        parent::__construct($message);
        $this->statusCode = $statusCode;
    }
}
