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

const COUPONS = [
    'SAVE10' => ['type' => 'percent', 'value' => 10],
    'EXPIRED' => ['type' => 'percent', 'value' => 15, 'expires_at' => '2000-01-01T00:00:00Z'],
];

const PAYMENT_PROVIDER = '';
const PAYMENT_SUCCESS_URL = '';
const PAYMENT_CANCEL_URL = '';
const PAYMENT_HTTP_TIMEOUT_SECONDS = 12;
const STRIPE_SECRET_KEY = '';
const STRIPE_API_BASE = 'https://api.stripe.com';
const PAYPAL_CLIENT_ID = '';
const PAYPAL_SECRET = '';
const PAYPAL_API_BASE = 'https://api-m.paypal.com';
const WEBHOOK_URL = '';
const WEBHOOK_SECRET = '';
const ORDER_EMAIL_TO = '';

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
        $payment = createPaymentHandoff($validated, $orderId);
        if ($payment !== null) {
            updateOrderPayment($pdo, $orderId, $payment);
        }
        dispatchOrderNotifications($pdo, $orderId, $validated);

        jsonResponse([
            'ok' => true,
            'order_id' => $orderId,
            'pay_url' => $payment['url'] ?? null,
            'subtotal_cents' => $validated['subtotal_cents'],
            'discount_cents' => $validated['discount_cents'],
            'total_cents' => $validated['total_cents'],
            'coupon_code' => $validated['coupon_code'],
            'payment_provider' => $payment['provider'] ?? null,
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

    $coupon = resolveCheckoutCoupon($cart['coupon'] ?? null, $serverSubtotal);
    $discountCents = $coupon['discount_cents'];
    $totalCents = max(0, $serverSubtotal - $discountCents);

    return [
        'customer' => [
            'name' => $name,
            'phone' => $phone,
            'email' => $email,
            'address' => $address,
        ],
        'items' => $validatedItems,
        'subtotal_cents' => $serverSubtotal,
        'discount_cents' => $discountCents,
        'total_cents' => $totalCents,
        'coupon_code' => $coupon['code'],
        'currency' => cleanString($payload['currency'] ?? 'USD', 8) ?: 'USD',
        'cart_key' => cleanString($payload['cartKey'] ?? '', 80),
        'page' => cleanString($payload['page'] ?? '', 500),
    ];
}

function resolveCheckoutCoupon(mixed $coupon, int $subtotalCents): array
{
    $empty = ['code' => null, 'discount_cents' => 0];
    if (!is_array($coupon)) {
        return $empty;
    }

    $code = strtoupper(cleanString($coupon['code'] ?? '', 40));
    if ($code === '') {
        return $empty;
    }

    try {
        $validated = validateCoupon($code, $subtotalCents);
    } catch (ClientError) {
        return $empty;
    }

    return [
        'code' => $validated['code'],
        'discount_cents' => $validated['discount_cents'],
    ];
}

function validateCoupon(string $code, int $subtotalCents): array
{
    if (!isset(COUPONS[$code])) {
        throw new ClientError('Coupon not valid.', 400);
    }

    $coupon = COUPONS[$code];
    if (($coupon['active'] ?? true) !== true) {
        throw new ClientError('Coupon not valid.', 400);
    }
    if (isset($coupon['expires_at'])) {
        $expires = strtotime((string)$coupon['expires_at']);
        if ($expires !== false && $expires < time()) {
            throw new ClientError('Coupon expired.', 400);
        }
    }

    $type = ($coupon['type'] ?? 'percent') === 'fixed' ? 'fixed' : 'percent';
    $value = (float)($coupon['value'] ?? 0);
    if ($value <= 0) {
        throw new ClientError('Coupon not valid.', 400);
    }

    return [
        'code' => $code,
        'type' => $type,
        'value' => $value,
        'discount_cents' => couponDiscountCents($type, $value, $subtotalCents),
    ];
}

function couponDiscountCents(string $type, float $value, int $subtotalCents): int
{
    $discount = $type === 'fixed'
        ? (int)round($value * 100)
        : (int)round($subtotalCents * ($value / 100));
    return max(0, min($subtotalCents, $discount));
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
            discount_cents INTEGER NOT NULL DEFAULT 0,
            total_cents INTEGER NOT NULL,
            coupon_code TEXT,
            payment_status TEXT NOT NULL DEFAULT "pending",
            payment_provider TEXT,
            payment_session_id TEXT,
            paid_at TEXT,
            page TEXT,
            ip_hash TEXT NOT NULL,
            created_at TEXT NOT NULL
        )'
    );
    ensureColumn($pdo, 'orders', 'discount_cents', 'INTEGER NOT NULL DEFAULT 0');
    ensureColumn($pdo, 'orders', 'total_cents', 'INTEGER NOT NULL DEFAULT 0');
    ensureColumn($pdo, 'orders', 'coupon_code', 'TEXT');
    ensureColumn($pdo, 'orders', 'payment_status', 'TEXT NOT NULL DEFAULT "pending"');
    ensureColumn($pdo, 'orders', 'payment_provider', 'TEXT');
    ensureColumn($pdo, 'orders', 'payment_session_id', 'TEXT');
    ensureColumn($pdo, 'orders', 'paid_at', 'TEXT');
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
    $pdo->exec(
        'CREATE TABLE IF NOT EXISTS inventory (
            product_id TEXT PRIMARY KEY,
            stock INTEGER NOT NULL
        )'
    );
    $pdo->exec(
        'CREATE TABLE IF NOT EXISTS webhook_deliveries (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            order_id TEXT NOT NULL,
            url TEXT NOT NULL,
            payload_json TEXT NOT NULL,
            signature TEXT NOT NULL,
            status TEXT NOT NULL,
            attempts INTEGER NOT NULL DEFAULT 0,
            next_attempt_at TEXT NOT NULL,
            last_error TEXT,
            created_at TEXT NOT NULL
        )'
    );
    seedInventory($pdo);
    return $pdo;
}

function seedInventory(PDO $pdo): void
{
    $insert = $pdo->prepare(
        'INSERT OR IGNORE INTO inventory (product_id, stock)
         VALUES (:product_id, :stock)'
    );
    foreach (PRODUCT_CATALOG as $id => $product) {
        $insert->execute([
            ':product_id' => $id,
            ':stock' => max(0, (int)($product['stock'] ?? 0)),
        ]);
    }
}

function ensureColumn(PDO $pdo, string $table, string $column, string $definition): void
{
    $columns = $pdo->query('PRAGMA table_info(' . $table . ')')->fetchAll(PDO::FETCH_ASSOC);
    foreach ($columns as $existing) {
        if (($existing['name'] ?? '') === $column) {
            return;
        }
    }
    $pdo->exec('ALTER TABLE ' . $table . ' ADD COLUMN ' . $column . ' ' . $definition);
}

function storeOrder(PDO $pdo, array $order): string
{
    $orderId = 'T' . gmdate('ymdHis') . strtoupper(bin2hex(random_bytes(3)));
    $pdo->beginTransaction();

    try {
        reserveInventory($pdo, $order['items']);

        $insertOrder = $pdo->prepare(
            'INSERT INTO orders (
                id, cart_key, currency, customer_name, customer_phone, customer_email,
                customer_address, subtotal_cents, discount_cents, total_cents, coupon_code,
                payment_status, payment_provider, payment_session_id, paid_at, page, ip_hash, created_at
            ) VALUES (
                :id, :cart_key, :currency, :customer_name, :customer_phone, :customer_email,
                :customer_address, :subtotal_cents, :discount_cents, :total_cents, :coupon_code,
                :payment_status, :payment_provider, :payment_session_id, :paid_at, :page, :ip_hash, :created_at
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
            ':discount_cents' => $order['discount_cents'],
            ':total_cents' => $order['total_cents'],
            ':coupon_code' => $order['coupon_code'],
            ':payment_status' => 'pending',
            ':payment_provider' => null,
            ':payment_session_id' => null,
            ':paid_at' => null,
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

function reserveInventory($pdo, array $items): void
{
    $update = $pdo->prepare(
        'UPDATE inventory
         SET stock = stock - :qty
         WHERE product_id = :product_id AND stock >= :qty'
    );
    foreach ($items as $item) {
        $update->execute([
            ':product_id' => $item['id'],
            ':qty' => (int)$item['qty'],
        ]);
        if ($update->rowCount() !== 1) {
            throw new ClientError('Out of stock', 409);
        }
    }
}

function dispatchOrderNotifications($pdo, string $orderId, array $order, ?callable $http = null, ?callable $mailer = null): void
{
    $summary = orderSummary($orderId, $order);

    if (WEBHOOK_URL !== '') {
        $body = json_encode($summary, JSON_UNESCAPED_SLASHES);
        $signature = hash_hmac('sha256', $body, WEBHOOK_SECRET);
        $http = $http ?? 'paymentHttpRequest';
        try {
            $response = $http(
                'POST',
                WEBHOOK_URL,
                [
                    'Content-Type' => 'application/json',
                    'X-TinyCart-Signature' => $signature,
                ],
                $body
            );
            $status = (int)($response['status'] ?? 0);
            if ($status < 200 || $status >= 300) {
                queueWebhookFailure($pdo, $orderId, $body, $signature, 'HTTP ' . $status);
            }
        } catch (Throwable $error) {
            queueWebhookFailure($pdo, $orderId, $body, $signature, $error->getMessage());
        }
    }

    if (ORDER_EMAIL_TO !== '') {
        $mailer = $mailer ?? 'mail';
        try {
            $mailer(ORDER_EMAIL_TO, 'TinyCart order ' . $orderId, plainOrderEmail($summary));
        } catch (Throwable) {
            // Email is best-effort and must not block checkout.
        }
    }
}

function orderSummary(string $orderId, array $order): array
{
    return [
        'order_id' => $orderId,
        'cart_key' => $order['cart_key'],
        'currency' => $order['currency'],
        'subtotal_cents' => $order['subtotal_cents'],
        'discount_cents' => $order['discount_cents'],
        'total_cents' => $order['total_cents'],
        'coupon_code' => $order['coupon_code'],
        'items' => array_map(static fn(array $item): array => [
            'id' => $item['id'],
            'name' => $item['name'],
            'price_cents' => $item['price_cents'],
            'qty' => $item['qty'],
            'line_total_cents' => $item['line_total_cents'],
        ], $order['items']),
        'created_at' => gmdate('c'),
    ];
}

function queueWebhookFailure($pdo, string $orderId, string $payload, string $signature, string $error): void
{
    if ($pdo === null) {
        return;
    }
    try {
        $insert = $pdo->prepare(
            'INSERT INTO webhook_deliveries (
                order_id, url, payload_json, signature, status, attempts, next_attempt_at, last_error, created_at
            ) VALUES (
                :order_id, :url, :payload_json, :signature, :status, :attempts, :next_attempt_at, :last_error, :created_at
            )'
        );
        $insert->execute([
            ':order_id' => $orderId,
            ':url' => WEBHOOK_URL,
            ':payload_json' => $payload,
            ':signature' => $signature,
            ':status' => 'pending',
            ':attempts' => 1,
            ':next_attempt_at' => gmdate('c', time() + 60),
            ':last_error' => cleanString($error, 300),
            ':created_at' => gmdate('c'),
        ]);
    } catch (Throwable) {
        // Never block checkout because notification bookkeeping failed.
    }
}

function plainOrderEmail(array $summary): string
{
    $lines = [
        'Order: ' . $summary['order_id'],
        'Total: ' . $summary['total_cents'] . ' ' . $summary['currency'],
    ];
    foreach ($summary['items'] as $item) {
        $lines[] = $item['qty'] . ' x ' . $item['name'] . ' (' . $item['id'] . ')';
    }
    return implode(PHP_EOL, $lines);
}

function updateOrderPayment(PDO $pdo, string $orderId, array $payment): void
{
    $update = $pdo->prepare(
        'UPDATE orders
         SET payment_provider = :provider, payment_session_id = :session_id, payment_status = :status
         WHERE id = :id'
    );
    $update->execute([
        ':id' => $orderId,
        ':provider' => $payment['provider'],
        ':session_id' => $payment['session_id'],
        ':status' => $payment['status'] ?? 'pending',
    ]);
}

function createPaymentHandoff(array $order, string $orderId, ?callable $http = null): ?array
{
    $provider = strtolower(cleanString(PAYMENT_PROVIDER, 20));
    if ($provider === '' || $order['total_cents'] <= 0) {
        return null;
    }
    $http = $http ?? 'paymentHttpRequest';

    if ($provider === 'stripe') {
        return createStripeCheckoutSession($order, $orderId, $http);
    }
    if ($provider === 'paypal') {
        return createPayPalOrder($order, $orderId, $http);
    }
    throw new RuntimeException('Unsupported payment provider.');
}

function createStripeCheckoutSession(array $order, string $orderId, callable $http): array
{
    if (STRIPE_SECRET_KEY === '' || PAYMENT_SUCCESS_URL === '' || PAYMENT_CANCEL_URL === '') {
        throw new RuntimeException('Stripe payments are not configured.');
    }

    $params = [
        'mode' => 'payment',
        'client_reference_id' => $orderId,
        'success_url' => paymentUrl(PAYMENT_SUCCESS_URL, $orderId),
        'cancel_url' => paymentUrl(PAYMENT_CANCEL_URL, $orderId),
        'metadata' => ['order_id' => $orderId],
        'line_items' => [[
            'quantity' => 1,
            'price_data' => [
                'currency' => strtolower($order['currency']),
                'unit_amount' => $order['total_cents'],
                'product_data' => ['name' => 'TinyCart Order ' . $orderId],
            ],
        ]],
    ];
    if ($order['customer']['email'] !== '') {
        $params['customer_email'] = $order['customer']['email'];
    }

    $response = $http(
        'POST',
        rtrim(STRIPE_API_BASE, '/') . '/v1/checkout/sessions',
        [
            'Authorization' => 'Bearer ' . STRIPE_SECRET_KEY,
            'Content-Type' => 'application/x-www-form-urlencoded',
        ],
        http_build_query($params)
    );
    $data = paymentJson($response);
    if (empty($data['id']) || empty($data['url'])) {
        throw new RuntimeException('Stripe checkout session did not include a payment URL.');
    }

    return [
        'provider' => 'stripe',
        'session_id' => cleanString($data['id'], 120),
        'url' => cleanString($data['url'], 500),
        'status' => 'pending',
    ];
}

function createPayPalOrder(array $order, string $orderId, callable $http): array
{
    if (PAYPAL_CLIENT_ID === '' || PAYPAL_SECRET === '' || PAYMENT_SUCCESS_URL === '' || PAYMENT_CANCEL_URL === '') {
        throw new RuntimeException('PayPal payments are not configured.');
    }

    $tokenResponse = $http(
        'POST',
        rtrim(PAYPAL_API_BASE, '/') . '/v1/oauth2/token',
        [
            'Authorization' => 'Basic ' . base64_encode(PAYPAL_CLIENT_ID . ':' . PAYPAL_SECRET),
            'Content-Type' => 'application/x-www-form-urlencoded',
        ],
        'grant_type=client_credentials'
    );
    $token = paymentJson($tokenResponse)['access_token'] ?? '';
    if ($token === '') {
        throw new RuntimeException('PayPal token response was invalid.');
    }

    $body = json_encode([
        'intent' => 'CAPTURE',
        'purchase_units' => [[
            'reference_id' => $orderId,
            'custom_id' => $orderId,
            'amount' => [
                'currency_code' => strtoupper($order['currency']),
                'value' => centsDecimal($order['total_cents']),
            ],
        ]],
        'payment_source' => [
            'paypal' => [
                'experience_context' => [
                    'return_url' => paymentUrl(PAYMENT_SUCCESS_URL, $orderId),
                    'cancel_url' => paymentUrl(PAYMENT_CANCEL_URL, $orderId),
                    'user_action' => 'PAY_NOW',
                ],
            ],
        ],
    ], JSON_UNESCAPED_SLASHES);

    $response = $http(
        'POST',
        rtrim(PAYPAL_API_BASE, '/') . '/v2/checkout/orders',
        [
            'Authorization' => 'Bearer ' . $token,
            'Content-Type' => 'application/json',
        ],
        $body
    );
    $data = paymentJson($response);
    $approveUrl = paypalApproveUrl($data);
    if (empty($data['id']) || $approveUrl === '') {
        throw new RuntimeException('PayPal order did not include an approval URL.');
    }

    return [
        'provider' => 'paypal',
        'session_id' => cleanString($data['id'], 120),
        'url' => cleanString($approveUrl, 500),
        'status' => 'pending',
    ];
}

function paymentJson(array $response): array
{
    $status = (int)($response['status'] ?? 0);
    $data = json_decode((string)($response['body'] ?? ''), true);
    if ($status < 200 || $status >= 300 || !is_array($data)) {
        throw new RuntimeException('Payment provider request failed.');
    }
    return $data;
}

function paypalApproveUrl(array $data): string
{
    foreach (($data['links'] ?? []) as $link) {
        if (is_array($link) && ($link['rel'] ?? '') === 'approve') {
            return (string)($link['href'] ?? '');
        }
    }
    return '';
}

function paymentUrl(string $template, string $orderId): string
{
    return str_replace('{ORDER_ID}', rawurlencode($orderId), $template);
}

function centsDecimal(int $cents): string
{
    return number_format($cents / 100, 2, '.', '');
}

function paymentHttpRequest(string $method, string $url, array $headers, string $body): array
{
    $headerLines = [];
    foreach ($headers as $name => $value) {
        $headerLines[] = $name . ': ' . $value;
    }
    $context = stream_context_create([
        'http' => [
            'method' => $method,
            'header' => implode("\r\n", $headerLines),
            'content' => $body,
            'timeout' => PAYMENT_HTTP_TIMEOUT_SECONDS,
            'ignore_errors' => true,
        ],
    ]);
    $raw = file_get_contents($url, false, $context);
    $status = 0;
    foreach (($http_response_header ?? []) as $header) {
        if (preg_match('/^HTTP\/\S+\s+(\d+)/', $header, $matches)) {
            $status = (int)$matches[1];
            break;
        }
    }
    return ['status' => $status, 'body' => $raw === false ? '' : $raw];
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
    $value = trim($value);
    return function_exists('mb_substr')
        ? mb_substr($value, 0, $maxLength, 'UTF-8')
        : substr($value, 0, $maxLength);
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
