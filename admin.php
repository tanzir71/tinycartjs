<?php
declare(strict_types=1);

/**
 * TinyCart read-only order admin view.
 *
 * Configure either ADMIN_API_KEYS or ADMIN_PASSWORD_HASH before deploying.
 * ADMIN_PASSWORD_HASH should be created with password_hash('your-password', PASSWORD_DEFAULT).
 */

const ADMIN_ALLOWED_ORIGINS = [
    'https://example.com',
    'http://localhost:8000',
    'http://127.0.0.1:8000'
];

const ADMIN_API_KEYS = [];
const ADMIN_PASSWORD_HASH = '';
const ADMIN_DB_PATH = __DIR__ . '/data/orders.sqlite';
const ADMIN_PAGE_SIZE = 25;

main();

function main(): void
{
    try {
        handleAdminOrigin();

        if (($_SERVER['REQUEST_METHOD'] ?? 'GET') === 'OPTIONS') {
            http_response_code(204);
            exit;
        }
        if (($_SERVER['REQUEST_METHOD'] ?? 'GET') !== 'GET') {
            throw new AdminError('Method not allowed', 405);
        }

        requireAdminAuth();
        $listing = fetchAdminOrders(adminDb(), adminPage(), ADMIN_PAGE_SIZE);

        http_response_code(200);
        header('Content-Type: text/html; charset=utf-8');
        header('X-Content-Type-Options: nosniff');
        echo renderAdminPage($listing);
    } catch (AdminError $error) {
        adminTextResponse($error->getMessage(), $error->statusCode);
    } catch (Throwable) {
        adminTextResponse('Unable to load orders.', 500);
    }
}

function handleAdminOrigin(): void
{
    $origin = $_SERVER['HTTP_ORIGIN'] ?? '';
    if ($origin === '') {
        return;
    }
    if (!in_array($origin, ADMIN_ALLOWED_ORIGINS, true)) {
        throw new AdminError('Origin not allowed', 403);
    }

    header('Access-Control-Allow-Origin: ' . $origin);
    header('Vary: Origin');
    header('Access-Control-Allow-Methods: GET, OPTIONS');
    header('Access-Control-Allow-Headers: X-API-KEY, Authorization');
    header('Access-Control-Max-Age: 600');
}

function requireAdminAuth(): void
{
    $hasKeyConfig = count(ADMIN_API_KEYS) > 0;
    $hasPasswordConfig = ADMIN_PASSWORD_HASH !== '';
    if (!$hasKeyConfig && !$hasPasswordConfig) {
        throw new AdminError('Admin access is not configured.', 403);
    }

    $providedKey = $_SERVER['HTTP_X_API_KEY'] ?? '';
    if ($providedKey !== '') {
        foreach (ADMIN_API_KEYS as $allowed) {
            if (hash_equals($allowed, $providedKey)) {
                return;
            }
        }
    }

    $password = $_SERVER['PHP_AUTH_PW'] ?? '';
    if ($hasPasswordConfig && $password !== '' && password_verify($password, ADMIN_PASSWORD_HASH)) {
        return;
    }

    header('WWW-Authenticate: Basic realm="TinyCart Admin"');
    throw new AdminError('Unauthorized', 401);
}

function adminDb(): PDO
{
    $pdo = new PDO('sqlite:' . ADMIN_DB_PATH);
    $pdo->setAttribute(PDO::ATTR_ERRMODE, PDO::ERRMODE_EXCEPTION);
    $pdo->setAttribute(PDO::ATTR_DEFAULT_FETCH_MODE, PDO::FETCH_ASSOC);
    return $pdo;
}

function adminPage(): int
{
    $page = filter_var($_GET['page'] ?? 1, FILTER_VALIDATE_INT, [
        'options' => ['min_range' => 1, 'max_range' => 100000]
    ]);
    return $page === false ? 1 : (int)$page;
}

function fetchAdminOrders($pdo, int $page, int $pageSize = ADMIN_PAGE_SIZE): array
{
    $page = max(1, $page);
    $pageSize = max(1, min(100, $pageSize));
    $limit = $pageSize + 1;
    $offset = ($page - 1) * $pageSize;

    $statement = $pdo->prepare(
        'SELECT id, created_at, currency, subtotal_cents, discount_cents, total_cents,
                coupon_code, payment_status, payment_provider, customer_name, customer_email
         FROM orders
         ORDER BY datetime(created_at) DESC, id DESC
         LIMIT :limit OFFSET :offset'
    );
    $statement->execute([
        ':limit' => $limit,
        ':offset' => $offset,
    ]);

    $rows = $statement->fetchAll();
    $hasNext = count($rows) > $pageSize;
    if ($hasNext) {
        $rows = array_slice($rows, 0, $pageSize);
    }

    return [
        'orders' => array_map('normalizeAdminOrder', $rows),
        'page' => $page,
        'page_size' => $pageSize,
        'has_prev' => $page > 1,
        'has_next' => $hasNext,
    ];
}

function normalizeAdminOrder(array $row): array
{
    return [
        'id' => (string)($row['id'] ?? ''),
        'created_at' => (string)($row['created_at'] ?? ''),
        'currency' => strtoupper((string)($row['currency'] ?? 'USD')),
        'subtotal_cents' => (int)($row['subtotal_cents'] ?? 0),
        'discount_cents' => (int)($row['discount_cents'] ?? 0),
        'total_cents' => (int)($row['total_cents'] ?? 0),
        'coupon_code' => (string)($row['coupon_code'] ?? ''),
        'payment_status' => (string)($row['payment_status'] ?? 'pending'),
        'payment_provider' => (string)($row['payment_provider'] ?? ''),
        'customer_name' => (string)($row['customer_name'] ?? ''),
        'customer_email' => (string)($row['customer_email'] ?? ''),
    ];
}

function renderAdminPage(array $listing): string
{
    $page = max(1, (int)($listing['page'] ?? 1));
    $orders = is_array($listing['orders'] ?? null) ? $listing['orders'] : [];
    $rows = '';

    foreach ($orders as $order) {
        $rows .= '<tr>'
            . '<td><code>' . adminHtml($order['id'] ?? '') . '</code></td>'
            . '<td>' . adminHtml($order['created_at'] ?? '') . '</td>'
            . '<td>' . adminHtml($order['customer_name'] ?? '') . '<br><span>' . adminHtml($order['customer_email'] ?? '') . '</span></td>'
            . '<td>' . adminHtml(formatAdminMoney((int)($order['subtotal_cents'] ?? 0), (string)($order['currency'] ?? 'USD'))) . '</td>'
            . '<td>' . adminHtml(formatAdminMoney((int)($order['discount_cents'] ?? 0), (string)($order['currency'] ?? 'USD'))) . '</td>'
            . '<td><strong>' . adminHtml(formatAdminMoney((int)($order['total_cents'] ?? 0), (string)($order['currency'] ?? 'USD'))) . '</strong></td>'
            . '<td>' . adminHtml($order['coupon_code'] ?? '') . '</td>'
            . '<td>' . adminHtml($order['payment_status'] ?? '') . '<br><span>' . adminHtml($order['payment_provider'] ?? '') . '</span></td>'
            . '</tr>';
    }

    if ($rows === '') {
        $rows = '<tr><td colspan="8" class="empty">No orders yet.</td></tr>';
    }

    $prev = !empty($listing['has_prev'])
        ? '<a href="?page=' . ($page - 1) . '">Previous</a>'
        : '<span>Previous</span>';
    $next = !empty($listing['has_next'])
        ? '<a href="?page=' . ($page + 1) . '">Next</a>'
        : '<span>Next</span>';

    return '<!doctype html><html lang="en"><head><meta charset="utf-8">'
        . '<meta name="viewport" content="width=device-width,initial-scale=1">'
        . '<title>TinyCart Orders</title>'
        . '<style>'
        . 'body{margin:0;font-family:system-ui,-apple-system,Segoe UI,sans-serif;background:#f7f7f7;color:#111}'
        . 'main{max-width:1120px;margin:0 auto;padding:32px 20px}'
        . 'h1{font-size:28px;line-height:1.1;margin:0 0 20px}'
        . 'table{width:100%;border-collapse:collapse;background:#fff;border:1px solid #ddd}'
        . 'th,td{text-align:left;vertical-align:top;padding:12px;border-bottom:1px solid #e8e8e8;font-size:14px}'
        . 'th{font-size:12px;text-transform:uppercase;letter-spacing:.04em;background:#111;color:#fff}'
        . 'code{font-family:ui-monospace,SFMono-Regular,Consolas,monospace;font-size:13px}'
        . 'span{color:#666}.empty{text-align:center;color:#666;padding:32px}.pager{display:flex;gap:12px;justify-content:flex-end;margin-top:16px}'
        . '.pager a,.pager span{border:1px solid #ccc;background:#fff;color:#111;padding:8px 10px;text-decoration:none}'
        . '.pager span{color:#777;background:#f2f2f2}'
        . '@media(max-width:760px){table{display:block;overflow-x:auto}th,td{white-space:nowrap}}'
        . '</style></head><body><main>'
        . '<h1>TinyCart Orders</h1>'
        . '<table><thead><tr><th>Order</th><th>Created</th><th>Customer</th><th>Subtotal</th><th>Discount</th><th>Total</th><th>Coupon</th><th>Payment</th></tr></thead>'
        . '<tbody>' . $rows . '</tbody></table>'
        . '<nav class="pager" aria-label="Pagination">' . $prev . $next . '</nav>'
        . '</main></body></html>';
}

function formatAdminMoney(int $cents, string $currency): string
{
    return number_format($cents / 100, 2, '.', '') . ' ' . strtoupper($currency);
}

function adminHtml(mixed $value): string
{
    return htmlspecialchars((string)$value, ENT_QUOTES | ENT_SUBSTITUTE, 'UTF-8');
}

function adminTextResponse(string $message, int $status): void
{
    http_response_code($status);
    header('Content-Type: text/plain; charset=utf-8');
    header('X-Content-Type-Options: nosniff');
    echo $message;
    exit;
}

final class AdminError extends RuntimeException
{
    public int $statusCode;

    public function __construct(string $message, int $statusCode)
    {
        parent::__construct($message);
        $this->statusCode = $statusCode;
    }
}
