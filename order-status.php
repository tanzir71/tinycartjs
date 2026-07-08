<?php
declare(strict_types=1);

/**
 * TinyCart customer order-status lookup.
 *
 * Shoppers enter order id + phone. The page reveals nothing unless both match
 * one stored order row, and it only shows partial address context.
 */

const ORDER_STATUS_ALLOWED_ORIGINS = [
    'https://example.com',
    'http://localhost:8000',
    'http://127.0.0.1:8000'
];

const ORDER_STATUS_DB_PATH = __DIR__ . '/data/orders.sqlite';
const ORDER_STATUS_RATE_LIMIT_DIR = __DIR__ . '/data/order_status_rate_limits';
const ORDER_STATUS_RATE_LIMIT_WINDOW_SECONDS = 60;
const ORDER_STATUS_RATE_LIMIT_MAX_REQUESTS = 20;

statusMain();

function statusMain(): void
{
    try {
        statusHandleOrigin();

        $method = $_SERVER['REQUEST_METHOD'] ?? 'GET';
        if ($method === 'OPTIONS') {
            http_response_code(204);
            exit;
        }

        $order = null;
        $submitted = false;
        if ($method === 'POST') {
            statusRateLimit(statusClientIp());
            $submitted = true;
            $orderId = statusCleanString($_POST['order_id'] ?? '', 120);
            $phone = statusCleanString($_POST['phone'] ?? '', 40);
            if ($orderId !== '' && $phone !== '') {
                $order = lookupOrderStatus(statusDb(), $orderId, $phone);
            }
        } elseif ($method !== 'GET') {
            throw new StatusError('Method not allowed', 405);
        }

        statusHtmlResponse(renderOrderStatusPage($order, $submitted));
    } catch (StatusError $error) {
        statusTextResponse($error->getMessage(), $error->statusCode);
    } catch (Throwable) {
        statusTextResponse('Unable to look up order.', 500);
    }
}

function statusHandleOrigin(): void
{
    $origin = $_SERVER['HTTP_ORIGIN'] ?? '';
    if ($origin === '') {
        return;
    }
    if (!in_array($origin, ORDER_STATUS_ALLOWED_ORIGINS, true)) {
        throw new StatusError('Origin not allowed', 403);
    }

    header('Access-Control-Allow-Origin: ' . $origin);
    header('Vary: Origin');
    header('Access-Control-Allow-Methods: GET, POST, OPTIONS');
    header('Access-Control-Allow-Headers: Content-Type');
    header('Access-Control-Max-Age: 600');
}

function statusDb(): PDO
{
    $pdo = new PDO('sqlite:' . ORDER_STATUS_DB_PATH);
    $pdo->setAttribute(PDO::ATTR_ERRMODE, PDO::ERRMODE_EXCEPTION);
    statusEnsureSchema($pdo);
    return $pdo;
}

function statusEnsureSchema(PDO $pdo): void
{
    $pdo->exec(
        'CREATE TABLE IF NOT EXISTS orders (
            id TEXT PRIMARY KEY,
            currency TEXT NOT NULL DEFAULT "USD",
            customer_phone TEXT NOT NULL DEFAULT "",
            customer_address TEXT NOT NULL DEFAULT "",
            subtotal_cents INTEGER NOT NULL DEFAULT 0,
            discount_cents INTEGER NOT NULL DEFAULT 0,
            shipping_cents INTEGER NOT NULL DEFAULT 0,
            total_cents INTEGER NOT NULL DEFAULT 0,
            coupon_code TEXT,
            payment_method TEXT NOT NULL DEFAULT "manual",
            payment_status TEXT NOT NULL DEFAULT "pending",
            fulfillment_status TEXT NOT NULL DEFAULT "new",
            created_at TEXT NOT NULL DEFAULT ""
        )'
    );
    statusEnsureColumn($pdo, 'orders', 'shipping_cents', 'INTEGER NOT NULL DEFAULT 0');
    $pdo->exec(
        'CREATE TABLE IF NOT EXISTS order_items (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            order_id TEXT NOT NULL,
            product_id TEXT NOT NULL,
            product_name TEXT NOT NULL,
            price_cents INTEGER NOT NULL,
            qty INTEGER NOT NULL,
            line_total_cents INTEGER NOT NULL,
            options_json TEXT NOT NULL DEFAULT "",
            FOREIGN KEY(order_id) REFERENCES orders(id) ON DELETE CASCADE
        )'
    );
}

function statusEnsureColumn(PDO $pdo, string $table, string $column, string $definition): void
{
    $columns = $pdo->query('PRAGMA table_info(' . $table . ')')->fetchAll(PDO::FETCH_ASSOC);
    foreach ($columns as $existing) {
        if (($existing['name'] ?? '') === $column) {
            return;
        }
    }
    $pdo->exec('ALTER TABLE ' . $table . ' ADD COLUMN ' . $column . ' ' . $definition);
}

function lookupOrderStatus($pdo, string $orderId, string $phone): ?array
{
    $orderId = statusCleanString($orderId, 120);
    $phone = statusCleanString($phone, 40);
    if ($orderId === '' || $phone === '') {
        return null;
    }

    $statement = $pdo->prepare(
        'SELECT id, created_at, currency, customer_address, subtotal_cents, discount_cents,
                shipping_cents, total_cents, coupon_code, payment_method, payment_status,
                fulfillment_status
         FROM orders
         WHERE id = :id
         AND customer_phone = :phone
         LIMIT 1'
    );
    $statement->execute([':id' => $orderId, ':phone' => $phone]);
    $row = $statement->fetch();
    if (!is_array($row)) {
        return null;
    }

    $order = normalizeStatusOrder($row);
    $order['items'] = fetchStatusItems($pdo, $order['id']);
    return $order;
}

function fetchStatusItems($pdo, string $orderId): array
{
    $statement = $pdo->prepare(
        'SELECT product_id, product_name, price_cents, qty, line_total_cents
         FROM order_items
         WHERE order_id = :order_id
         ORDER BY id ASC'
    );
    $statement->execute([':order_id' => $orderId]);
    return array_map(static fn(array $row): array => [
        'product_id' => (string)($row['product_id'] ?? ''),
        'product_name' => (string)($row['product_name'] ?? ''),
        'price_cents' => (int)($row['price_cents'] ?? 0),
        'qty' => (int)($row['qty'] ?? 0),
        'line_total_cents' => (int)($row['line_total_cents'] ?? 0),
    ], $statement->fetchAll());
}

function normalizeStatusOrder(array $row): array
{
    return [
        'id' => (string)($row['id'] ?? ''),
        'created_at' => (string)($row['created_at'] ?? ''),
        'currency' => (string)($row['currency'] ?? 'USD'),
        'customer_address' => (string)($row['customer_address'] ?? ''),
        'subtotal_cents' => (int)($row['subtotal_cents'] ?? 0),
        'discount_cents' => (int)($row['discount_cents'] ?? 0),
        'shipping_cents' => (int)($row['shipping_cents'] ?? 0),
        'total_cents' => (int)($row['total_cents'] ?? 0),
        'coupon_code' => (string)($row['coupon_code'] ?? ''),
        'payment_method' => (string)($row['payment_method'] ?? ''),
        'payment_status' => (string)($row['payment_status'] ?? 'pending'),
        'fulfillment_status' => (string)($row['fulfillment_status'] ?? 'new'),
        'items' => [],
    ];
}

function renderOrderStatusPage(?array $order, bool $submitted = false): string
{
    $result = '';
    if ($submitted && $order === null) {
        $result = '<section class="notice">No matching order found. Check the order id and phone exactly as used at checkout.</section>';
    } elseif ($order !== null) {
        $result = renderStatusResult($order);
    }

    return '<!doctype html><html lang="en"><head><meta charset="utf-8">'
        . '<meta name="viewport" content="width=device-width,initial-scale=1">'
        . '<title>Order status - TinyCart</title>'
        . '<style>'
        . 'body{margin:0;background:#f7f7f7;color:#111;font:16px/1.5 system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}'
        . 'main{max-width:760px;margin:0 auto;padding:32px 16px 48px}h1{margin:0 0 8px;font-size:clamp(30px,6vw,52px);line-height:1}'
        . 'p{margin:0 0 18px;color:#555}.panel,.notice{border:1px solid #ddd;background:#fff;padding:18px}.panel{display:grid;gap:16px}'
        . 'form{display:grid;gap:10px;margin:22px 0}label{display:grid;gap:5px;font-weight:700}input{min-height:42px;border:1px solid #ccc;padding:8px 10px;font:inherit}'
        . 'button{min-height:42px;border:1px solid #111;background:#111;color:#fff;font-weight:800;cursor:pointer}.timeline{display:grid;gap:8px;margin:0;padding:0;list-style:none}'
        . '.timeline li{border-left:3px solid #bbb;padding-left:10px}.timeline .on{border-color:#111}.grid{display:grid;gap:10px}.muted{color:#666}'
        . 'table{width:100%;border-collapse:collapse}th,td{border-bottom:1px solid #eee;padding:8px;text-align:left}td:last-child,th:last-child{text-align:right}'
        . 'dl{display:grid;grid-template-columns:1fr auto;gap:6px;margin:0}.total{font-size:20px;font-weight:900}@media(max-width:560px){table,tbody,tr,td,th{display:block}td:last-child,th:last-child{text-align:left}}'
        . '</style></head><body><main>'
        . '<h1>Order status</h1><p>Enter the order id and phone number from checkout.</p>'
        . '<form method="post" action="order-status.php">'
        . '<label>Order id<input name="order_id" autocomplete="off" required></label>'
        . '<label>Phone<input name="phone" autocomplete="tel" required></label>'
        . '<button type="submit">Look up order</button></form>'
        . $result
        . '</main></body></html>';
}

function renderStatusResult(array $order): string
{
    $currency = (string)($order['currency'] ?? 'USD');
    $rows = '';
    foreach ($order['items'] ?? [] as $item) {
        $rows .= '<tr><td>' . statusHtml($item['product_name'] ?? '') . '<br><span class="muted">'
            . statusHtml($item['product_id'] ?? '') . '</span></td><td>'
            . (int)($item['qty'] ?? 0) . '</td><td>'
            . statusHtml(statusMoney((int)($item['line_total_cents'] ?? 0), $currency)) . '</td></tr>';
    }
    if ($rows === '') {
        $rows = '<tr><td colspan="3">No line items found.</td></tr>';
    }

    return '<section class="panel">'
        . '<div><strong>Order ' . statusHtml($order['id'] ?? '') . '</strong><br><span class="muted">'
        . statusHtml($order['created_at'] ?? '') . '</span></div>'
        . renderStatusTimeline($order)
        . '<div class="grid"><span class="muted">Delivery area</span><strong>'
        . statusHtml(partialStatusAddress((string)($order['customer_address'] ?? ''))) . '</strong></div>'
        . '<table><thead><tr><th>Item</th><th>Qty</th><th>Total</th></tr></thead><tbody>' . $rows . '</tbody></table>'
        . '<dl><dt>Subtotal</dt><dd>' . statusHtml(statusMoney((int)($order['subtotal_cents'] ?? 0), $currency)) . '</dd>'
        . '<dt>Discount</dt><dd>-' . statusHtml(statusMoney((int)($order['discount_cents'] ?? 0), $currency)) . '</dd>'
        . '<dt>Shipping</dt><dd>' . statusHtml(statusMoney((int)($order['shipping_cents'] ?? 0), $currency)) . '</dd>'
        . '<dt class="total">Total</dt><dd class="total">' . statusHtml(statusMoney((int)($order['total_cents'] ?? 0), $currency)) . '</dd></dl>'
        . '</section>';
}

function renderStatusTimeline(array $order): string
{
    $payment = statusPaymentLabel((string)($order['payment_status'] ?? 'pending'));
    $fulfillment = statusFulfillmentLabel((string)($order['fulfillment_status'] ?? 'new'));
    return '<ol class="timeline">'
        . '<li class="on"><strong>Received</strong><br><span class="muted">We have your order.</span></li>'
        . '<li class="on"><strong>' . statusHtml($payment) . '</strong><br><span class="muted">'
        . statusHtml((string)($order['payment_method'] ?? 'manual')) . '</span></li>'
        . '<li class="on"><strong>' . statusHtml($fulfillment) . '</strong><br><span class="muted">Fulfillment status</span></li>'
        . '</ol>';
}

function statusPaymentLabel(string $status): string
{
    return [
        'paid' => 'Paid',
        'cod_due' => 'Cash due',
        'cancelled' => 'Payment cancelled',
        'refunded' => 'Refunded',
    ][$status] ?? 'Payment pending';
}

function statusFulfillmentLabel(string $status): string
{
    return [
        'confirmed' => 'Confirmed',
        'packed' => 'Packed',
        'shipped' => 'Shipped',
        'fulfilled' => 'Fulfilled',
        'cancelled' => 'Cancelled',
    ][$status] ?? 'Received';
}

function partialStatusAddress(string $address): string
{
    $lines = preg_split('/\R+/', trim($address)) ?: [];
    $first = statusCleanString($lines[0] ?? '', 160);
    if ($first === '') {
        return 'Address on file';
    }
    $parts = array_values(array_filter(array_map('trim', explode(',', $first))));
    if (count($parts) > 1) {
        return statusCleanString($parts[0] . ', ' . end($parts), 160);
    }
    return $first;
}

function statusRateLimit(string $ip): void
{
    if (!is_dir(ORDER_STATUS_RATE_LIMIT_DIR) && !mkdir(ORDER_STATUS_RATE_LIMIT_DIR, 0750, true) && !is_dir(ORDER_STATUS_RATE_LIMIT_DIR)) {
        throw new RuntimeException('Could not create rate limit directory.');
    }

    $path = ORDER_STATUS_RATE_LIMIT_DIR . '/' . hash('sha256', $ip) . '.json';
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
        if (($now - (int)($bucket['window_start'] ?? 0)) >= ORDER_STATUS_RATE_LIMIT_WINDOW_SECONDS) {
            $bucket = ['window_start' => $now, 'count' => 0];
        }
        $bucket['count'] = (int)($bucket['count'] ?? 0) + 1;
        if ($bucket['count'] > ORDER_STATUS_RATE_LIMIT_MAX_REQUESTS) {
            throw new StatusError('Too many requests', 429);
        }
        ftruncate($fp, 0);
        rewind($fp);
        fwrite($fp, json_encode($bucket));
    } finally {
        flock($fp, LOCK_UN);
        fclose($fp);
    }
}

function statusClientIp(): string
{
    return $_SERVER['REMOTE_ADDR'] ?? '0.0.0.0';
}

function statusMoney(int $cents, string $currency): string
{
    return number_format($cents / 100, 2, '.', '') . ' ' . strtoupper($currency);
}

function statusCleanString(mixed $value, int $maxLength): string
{
    $text = trim((string)$value);
    return function_exists('mb_substr')
        ? mb_substr($text, 0, $maxLength)
        : substr($text, 0, $maxLength);
}

function statusHtml(mixed $value): string
{
    return htmlspecialchars((string)$value, ENT_QUOTES | ENT_SUBSTITUTE, 'UTF-8');
}

function statusHtmlResponse(string $html): void
{
    http_response_code(200);
    header('Content-Type: text/html; charset=utf-8');
    header('X-Content-Type-Options: nosniff');
    echo $html;
}

function statusTextResponse(string $message, int $status): void
{
    http_response_code($status);
    header('Content-Type: text/plain; charset=utf-8');
    header('X-Content-Type-Options: nosniff');
    echo $message;
}

final class StatusError extends RuntimeException
{
    public int $statusCode;

    public function __construct(string $message, int $statusCode)
    {
        parent::__construct($message);
        $this->statusCode = $statusCode;
    }
}
