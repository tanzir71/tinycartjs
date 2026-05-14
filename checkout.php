<?php
declare(strict_types=1);

/**
 * TinyCart checkout endpoint for shared hosting.
 *
 * Configure these values before deploying:
 * - ALLOWED_ORIGINS: merchant storefront origins allowed to POST orders.
 * - API_KEYS: leave [] to disable API-key checks, or add long random keys.
 * - HMAC_SECRET: long random secret used to sign/verify optional product data.
 *
 * Always verify item ids and prices server-side. Client prices are hints only.
 */

const ALLOWED_ORIGINS = [
    'https://example.com',
    'http://localhost:8000',
    'http://127.0.0.1:8000'
];

const API_KEYS = [
    // 'replace-with-a-long-random-key'
];

const HMAC_SECRET = 'replace-with-32-plus-random-bytes';
const REQUIRE_PRODUCT_SIGNATURES = false;
const DB_PATH = __DIR__ . '/data/orders.sqlite';
const ERROR_LOG_PATH = __DIR__ . '/data/errors.log';
const RATE_LIMIT_DIR = __DIR__ . '/data/rate_limits';
const RATE_LIMIT_WINDOW_SECONDS = 60;
const RATE_LIMIT_MAX_REQUESTS = 30;

const PRODUCT_CATALOG = [
    'tee-001' => ['name' => 'TinyCart Tee', 'price_cents' => 2400, 'stock' => 100],
    'mug-001' => ['name' => 'Checkout Mug', 'price_cents' => 1800, 'stock' => 80],
    'sticker-001' => ['name' => 'Script Tag Sticker Pack', 'price_cents' => 700, 'stock' => 250],
];

main();

function main(): void
{
    try {
        ensureDataDirs();
        handleCors();

        if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
            http_response_code(204);
            exit;
        }

        if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
            jsonResponse(['ok' => false, 'error' => 'Method not allowed'], 405);
        }

        requireApiKeyIfConfigured();
        rateLimit(clientIp());

        $payload = readJsonBody();
        $validated = validateOrderPayload($payload);
        $pdo = db();
        $orderId = storeOrder($pdo, $validated);

        jsonResponse([
            'ok' => true,
            'order_id' => $orderId,
            'pay_url' => null,
        ]);
    } catch (ClientError $error) {
        jsonResponse(['ok' => false, 'error' => $error->getMessage()], $error->statusCode);
    } catch (Throwable $error) {
        logServerError($error);
        jsonResponse(['ok' => false, 'error' => 'Unable to process order.'], 500);
    }
}

function handleCors(): void
{
    $origin = $_SERVER['HTTP_ORIGIN'] ?? '';
    if ($origin === '') {
        return;
    }

    if (!in_array($origin, ALLOWED_ORIGINS, true)) {
        throw new ClientError('Origin not allowed', 403);
    }

    header('Access-Control-Allow-Origin: ' . $origin);
    header('Vary: Origin');
    header('Access-Control-Allow-Methods: POST, OPTIONS');
    header('Access-Control-Allow-Headers: Content-Type, X-API-KEY');
    header('Access-Control-Max-Age: 600');
}

function requireApiKeyIfConfigured(): void
{
    if (count(API_KEYS) === 0) {
        return;
    }

    $provided = $_SERVER['HTTP_X_API_KEY'] ?? '';
    foreach (API_KEYS as $allowed) {
        if (hash_equals($allowed, $provided)) {
            return;
        }
    }
    throw new ClientError('Unauthorized', 401);
}

function rateLimit(string $ip): void
{
    if (!is_dir(RATE_LIMIT_DIR) && !mkdir(RATE_LIMIT_DIR, 0750, true) && !is_dir(RATE_LIMIT_DIR)) {
        throw new RuntimeException('Could not create rate limit directory.');
    }

    $key = hash('sha256', $ip);
    $path = RATE_LIMIT_DIR . '/' . $key . '.json';
    $now = time();
    $bucket = ['window_start' => $now, 'count' => 0];

    $fp = fopen($path, 'c+');
    if (!$fp) {
        throw new RuntimeException('Could not open rate limit file.');
    }

    try {
        flock($fp, LOCK_EX);
        $raw = stream_get_contents($fp);
        if ($raw !== false && trim($raw) !== '') {
            $decoded = json_decode($raw, true);
            if (is_array($decoded)) {
                $bucket = $decoded;
            }
        }

        if (($now - (int)($bucket['window_start'] ?? 0)) >= RATE_LIMIT_WINDOW_SECONDS) {
            $bucket = ['window_start' => $now, 'count' => 0];
        }

        $bucket['count'] = (int)($bucket['count'] ?? 0) + 1;
        if ($bucket['count'] > RATE_LIMIT_MAX_REQUESTS) {
            throw new ClientError('Too many requests', 429);
        }

        ftruncate($fp, 0);
        rewind($fp);
        fwrite($fp, json_encode($bucket));
    } finally {
        flock($fp, LOCK_UN);
        fclose($fp);
    }
}

function readJsonBody(): array
{
    $raw = file_get_contents('php://input');
    if ($raw === false || strlen($raw) > 128 * 1024) {
        throw new ClientError('Invalid payload', 400);
    }

    $payload = json_decode($raw, true);
    if (!is_array($payload)) {
        throw new ClientError('Invalid JSON', 400);
    }
    return $payload;
}

function validateOrderPayload(array $payload): array
{
    $customer = $payload['customer'] ?? [];
    $cart = $payload['cart'] ?? [];
    $items = $cart['items'] ?? [];

    if (!is_array($customer) || !is_array($cart) || !is_array($items) || count($items) < 1) {
        throw new ClientError('Cart is empty', 400);
    }

    $name = cleanString($customer['name'] ?? '', 120);
    $phone = cleanString($customer['phone'] ?? '', 40);
    $email = cleanString($customer['email'] ?? '', 254);
    $address = cleanString($customer['address'] ?? '', 500);

    if ($name === '' || $phone === '' || $address === '') {
        throw new ClientError('Missing required customer fields', 400);
    }
    if ($email !== '' && !filter_var($email, FILTER_VALIDATE_EMAIL)) {
        throw new ClientError('Invalid email', 400);
    }

    $validatedItems = [];
    $serverSubtotal = 0;

    foreach ($items as $item) {
        if (!is_array($item)) {
            throw new ClientError('Invalid cart item', 400);
        }

        $id = cleanString($item['id'] ?? '', 120);
        $qty = filter_var($item['qty'] ?? null, FILTER_VALIDATE_INT, [
            'options' => ['min_range' => 1, 'max_range' => 999]
        ]);
        $clientPrice = filter_var($item['priceCents'] ?? null, FILTER_VALIDATE_INT, [
            'options' => ['min_range' => 0, 'max_range' => 100000000]
        ]);

        if ($id === '' || $qty === false || $clientPrice === false || !isset(PRODUCT_CATALOG[$id])) {
            throw new ClientError('Invalid cart item', 400);
        }

        $catalog = PRODUCT_CATALOG[$id];
        if ((int)$catalog['price_cents'] !== (int)$clientPrice) {
            throw new ClientError('price mismatch', 400);
        }
        if (isset($catalog['stock']) && $qty > (int)$catalog['stock']) {
            throw new ClientError('Insufficient stock', 400);
        }

        $sig = cleanString($item['sig'] ?? '', 512);
        if ($sig !== '' || REQUIRE_PRODUCT_SIGNATURES) {
            verifyProductSignature([
                'id' => $id,
                'priceCents' => (int)$catalog['price_cents'],
                'exp' => cleanString($item['exp'] ?? '', 40),
                'sig' => $sig,
            ]);
        }

        $options = $item['options'] ?? [];
        if (!is_array($options)) {
            $options = [];
        }

        $lineTotal = (int)$catalog['price_cents'] * (int)$qty;
        $serverSubtotal += $lineTotal;
        $validatedItems[] = [
            'id' => $id,
            'name' => $catalog['name'],
            'price_cents' => (int)$catalog['price_cents'],
            'qty' => (int)$qty,
            'line_total_cents' => $lineTotal,
            'options_json' => json_encode($options, JSON_UNESCAPED_SLASHES),
            'signature' => $sig,
        ];
    }

    $clientTotal = filter_var($cart['totals']['subtotalCents'] ?? null, FILTER_VALIDATE_INT);
    if ($clientTotal !== false && (int)$clientTotal !== $serverSubtotal) {
        throw new ClientError('price mismatch', 400);
    }

    return [
        'customer' => [
            'name' => $name,
            'phone' => $phone,
            'email' => $email,
            'address' => $address,
        ],
        'items' => $validatedItems,
        'subtotal_cents' => $serverSubtotal,
        'currency' => cleanString($payload['currency'] ?? 'USD', 8) ?: 'USD',
        'cart_key' => cleanString($payload['cartKey'] ?? '', 80),
        'page' => cleanString($payload['page'] ?? '', 500),
    ];
}

function db(): PDO
{
    $pdo = new PDO('sqlite:' . DB_PATH);
    $pdo->setAttribute(PDO::ATTR_ERRMODE, PDO::ERRMODE_EXCEPTION);
    $pdo->exec('PRAGMA foreign_keys = ON');
    $pdo->exec(
        'CREATE TABLE IF NOT EXISTS orders (
            id TEXT PRIMARY KEY,
            cart_key TEXT NOT NULL,
            currency TEXT NOT NULL,
            customer_name TEXT NOT NULL,
            customer_phone TEXT NOT NULL,
            customer_email TEXT,
            customer_address TEXT NOT NULL,
            subtotal_cents INTEGER NOT NULL,
            page TEXT,
            ip_hash TEXT NOT NULL,
            created_at TEXT NOT NULL
        )'
    );
    $pdo->exec(
        'CREATE TABLE IF NOT EXISTS order_items (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            order_id TEXT NOT NULL,
            product_id TEXT NOT NULL,
            product_name TEXT NOT NULL,
            price_cents INTEGER NOT NULL,
            qty INTEGER NOT NULL,
            line_total_cents INTEGER NOT NULL,
            options_json TEXT NOT NULL,
            signature TEXT,
            FOREIGN KEY(order_id) REFERENCES orders(id) ON DELETE CASCADE
        )'
    );
    return $pdo;
}

function storeOrder(PDO $pdo, array $order): string
{
    $orderId = 'T' . gmdate('ymdHis') . strtoupper(bin2hex(random_bytes(3)));
    $pdo->beginTransaction();

    try {
        $insertOrder = $pdo->prepare(
            'INSERT INTO orders (
                id, cart_key, currency, customer_name, customer_phone, customer_email,
                customer_address, subtotal_cents, page, ip_hash, created_at
            ) VALUES (
                :id, :cart_key, :currency, :customer_name, :customer_phone, :customer_email,
                :customer_address, :subtotal_cents, :page, :ip_hash, :created_at
            )'
        );
        $insertOrder->execute([
            ':id' => $orderId,
            ':cart_key' => $order['cart_key'],
            ':currency' => $order['currency'],
            ':customer_name' => $order['customer']['name'],
            ':customer_phone' => $order['customer']['phone'],
            ':customer_email' => $order['customer']['email'],
            ':customer_address' => $order['customer']['address'],
            ':subtotal_cents' => $order['subtotal_cents'],
            ':page' => $order['page'],
            ':ip_hash' => hash('sha256', clientIp()),
            ':created_at' => gmdate('c'),
        ]);

        $insertItem = $pdo->prepare(
            'INSERT INTO order_items (
                order_id, product_id, product_name, price_cents, qty, line_total_cents, options_json, signature
            ) VALUES (
                :order_id, :product_id, :product_name, :price_cents, :qty, :line_total_cents, :options_json, :signature
            )'
        );

        foreach ($order['items'] as $item) {
            $insertItem->execute([
                ':order_id' => $orderId,
                ':product_id' => $item['id'],
                ':product_name' => $item['name'],
                ':price_cents' => $item['price_cents'],
                ':qty' => $item['qty'],
                ':line_total_cents' => $item['line_total_cents'],
                ':options_json' => $item['options_json'],
                ':signature' => $item['signature'],
            ]);
        }

        $pdo->commit();
        return $orderId;
    } catch (Throwable $error) {
        $pdo->rollBack();
        throw $error;
    }
}

/**
 * HMAC signing snippet for rendering product buttons server-side:
 *
 * $expires = time() + 3600;
 * $sig = signProduct('tee-001', 2400, $expires);
 * echo '<button data-tc-id="tee-001" data-tc-price="24.00" data-tc-exp="' . $expires . '" data-tc-sig="' . htmlspecialchars($sig, ENT_QUOTES) . '">Buy</button>';
 */
function signProduct(string $productId, int $priceCents, int $expires): string
{
    return hash_hmac('sha256', $productId . '|' . $priceCents . '|' . $expires, HMAC_SECRET);
}

function verifyProductSignature(array $item): void
{
    $productId = (string)($item['id'] ?? '');
    $priceCents = (int)($item['priceCents'] ?? 0);
    $expires = filter_var($item['exp'] ?? null, FILTER_VALIDATE_INT);
    $sig = (string)($item['sig'] ?? '');

    if ($productId === '' || $priceCents < 0 || $expires === false || $sig === '') {
        throw new ClientError('Invalid product signature', 400);
    }
    if ($expires < time()) {
        throw new ClientError('Product signature expired', 400);
    }

    $expected = signProduct($productId, $priceCents, (int)$expires);
    if (!hash_equals($expected, $sig)) {
        throw new ClientError('Invalid product signature', 400);
    }
}

function cleanString(mixed $value, int $maxLength): string
{
    $value = is_scalar($value) ? (string)$value : '';
    $value = preg_replace('/[[:cntrl:]]/', '', $value) ?? '';
    return mb_substr(trim($value), 0, $maxLength, 'UTF-8');
}

function clientIp(): string
{
    return $_SERVER['REMOTE_ADDR'] ?? '0.0.0.0';
}

function ensureDataDirs(): void
{
    $dataDir = dirname(DB_PATH);
    if (!is_dir($dataDir) && !mkdir($dataDir, 0750, true) && !is_dir($dataDir)) {
        throw new RuntimeException('Could not create data directory.');
    }
    if (!is_dir(RATE_LIMIT_DIR) && !mkdir(RATE_LIMIT_DIR, 0750, true) && !is_dir(RATE_LIMIT_DIR)) {
        throw new RuntimeException('Could not create rate limit directory.');
    }
}

function logServerError(Throwable $error): void
{
    $line = gmdate('c') . ' ' . $error->getMessage() . ' ' . $error->getFile() . ':' . $error->getLine() . PHP_EOL;
    error_log($line, 3, ERROR_LOG_PATH);
}

function jsonResponse(array $payload, int $status = 200): void
{
    http_response_code($status);
    header('Content-Type: application/json; charset=utf-8');
    header('X-Content-Type-Options: nosniff');
    echo json_encode($payload, JSON_UNESCAPED_SLASHES);
    exit;
}

final class ClientError extends RuntimeException
{
    public int $statusCode;

    public function __construct(string $message, int $statusCode = 400)
    {
        parent::__construct($message);
        $this->statusCode = $statusCode;
    }
}
