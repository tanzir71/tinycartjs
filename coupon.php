<?php
declare(strict_types=1);

/**
 * TinyCart coupon validation endpoint.
 *
 * Checkout still re-validates every coupon. This endpoint is only for UI
 * feedback so shoppers can see applied/invalid/expired states before submit.
 */

const COUPON_ALLOWED_ORIGINS = [
    'https://example.com',
    'http://localhost:8000',
    'http://127.0.0.1:8000'
];

const COUPON_API_KEYS = [
    // 'replace-with-a-long-random-key'
];

const COUPON_ERROR_LOG_PATH = __DIR__ . '/data/coupon_errors.log';
const COUPON_DB_PATH = __DIR__ . '/data/orders.sqlite';
const COUPON_RATE_LIMIT_DIR = __DIR__ . '/data/coupon_rate_limits';
const COUPON_RATE_LIMIT_WINDOW_SECONDS = 60;
const COUPON_RATE_LIMIT_MAX_REQUESTS = 60;

const COUPONS = [
    'SAVE10' => ['type' => 'percent', 'value' => 10],
    'EXPIRED' => ['type' => 'percent', 'value' => 15, 'expires_at' => '2000-01-01T00:00:00Z'],
];

couponMain();

function couponMain(): void
{
    try {
        couponEnsureDataDirs();
        couponHandleCors();

        if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
            couponJson(['ok' => true], 204);
        }

        if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
            couponJson(['ok' => false, 'error' => 'Method not allowed'], 405);
        }

        couponRequireApiKeyIfConfigured();
        couponRateLimit(couponClientIp());

        $payload = couponReadJsonBody();
        $code = strtoupper(couponCleanString($payload['code'] ?? '', 40));
        $subtotalCents = couponSubtotalCents($payload['cart'] ?? []);
        $coupon = couponValidate($code, $subtotalCents, 'couponOverrideActive');

        couponJson([
            'ok' => true,
            'code' => $coupon['code'],
            'type' => $coupon['type'],
            'value' => $coupon['value'],
            'discount_cents' => $coupon['discount_cents'],
            'message' => $coupon['code'] . ' applied.',
        ]);
    } catch (CouponClientError $error) {
        couponJson(['ok' => false, 'error' => $error->getMessage()], $error->statusCode);
    } catch (Throwable $error) {
        couponLogServerError($error);
        couponJson(['ok' => false, 'error' => 'Unable to validate coupon.'], 500);
    }
}

function couponHandleCors(): void
{
    $origin = $_SERVER['HTTP_ORIGIN'] ?? '';
    if ($origin === '') {
        return;
    }

    if (!in_array($origin, COUPON_ALLOWED_ORIGINS, true)) {
        throw new CouponClientError('Origin not allowed', 403);
    }

    header('Access-Control-Allow-Origin: ' . $origin);
    header('Vary: Origin');
    header('Access-Control-Allow-Methods: POST, OPTIONS');
    header('Access-Control-Allow-Headers: Content-Type, X-API-KEY');
    header('Access-Control-Max-Age: 600');
}

function couponRequireApiKeyIfConfigured(): void
{
    if (count(COUPON_API_KEYS) === 0) {
        return;
    }

    $provided = $_SERVER['HTTP_X_API_KEY'] ?? '';
    foreach (COUPON_API_KEYS as $allowed) {
        if (hash_equals($allowed, $provided)) {
            return;
        }
    }
    throw new CouponClientError('Unauthorized', 401);
}

function couponRateLimit(string $ip): void
{
    $key = hash('sha256', $ip);
    $path = COUPON_RATE_LIMIT_DIR . '/' . $key . '.json';
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

        if (($now - (int)($bucket['window_start'] ?? 0)) >= COUPON_RATE_LIMIT_WINDOW_SECONDS) {
            $bucket = ['window_start' => $now, 'count' => 0];
        }

        $bucket['count'] = (int)($bucket['count'] ?? 0) + 1;
        if ($bucket['count'] > COUPON_RATE_LIMIT_MAX_REQUESTS) {
            throw new CouponClientError('Too many requests', 429);
        }

        ftruncate($fp, 0);
        rewind($fp);
        fwrite($fp, json_encode($bucket));
    } finally {
        flock($fp, LOCK_UN);
        fclose($fp);
    }
}

function couponReadJsonBody(): array
{
    $raw = file_get_contents('php://input');
    if ($raw === false || strlen($raw) > 32 * 1024) {
        throw new CouponClientError('Invalid payload', 400);
    }

    $payload = json_decode($raw, true);
    if (!is_array($payload)) {
        throw new CouponClientError('Invalid JSON', 400);
    }
    return $payload;
}

function couponSubtotalCents(mixed $cart): int
{
    if (!is_array($cart)) {
        return 0;
    }

    $subtotal = filter_var($cart['totals']['subtotalCents'] ?? null, FILTER_VALIDATE_INT, [
        'options' => ['min_range' => 0, 'max_range' => 100000000]
    ]);
    return $subtotal === false ? 0 : (int)$subtotal;
}

function couponValidate(string $code, int $subtotalCents, ?callable $couponOverride = null): array
{
    if ($code === '' || !isset(COUPONS[$code])) {
        throw new CouponClientError('Coupon not valid.', 400);
    }
    if ($couponOverride !== null && !$couponOverride($code)) {
        throw new CouponClientError('Coupon not valid.', 400);
    }

    $coupon = COUPONS[$code];
    if (($coupon['active'] ?? true) !== true) {
        throw new CouponClientError('Coupon not valid.', 400);
    }
    if (isset($coupon['expires_at'])) {
        $expires = strtotime((string)$coupon['expires_at']);
        if ($expires !== false && $expires < time()) {
            throw new CouponClientError('Coupon expired.', 400);
        }
    }

    $type = ($coupon['type'] ?? 'percent') === 'fixed' ? 'fixed' : 'percent';
    $value = (float)($coupon['value'] ?? 0);
    if ($value <= 0) {
        throw new CouponClientError('Coupon not valid.', 400);
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

function couponOverrideActive(string $code): bool
{
    try {
        $pdo = couponDb();
        $statement = $pdo->prepare('SELECT active FROM coupon_overrides WHERE code = :code LIMIT 1');
        $statement->execute([':code' => strtoupper(couponCleanString($code, 40))]);
        $row = $statement->fetch(PDO::FETCH_ASSOC);
        if (!is_array($row)) {
            return true;
        }
        return (int)($row['active'] ?? 1) === 1;
    } catch (Throwable) {
        return true;
    }
}

function couponDb(): PDO
{
    $pdo = new PDO('sqlite:' . COUPON_DB_PATH);
    $pdo->setAttribute(PDO::ATTR_ERRMODE, PDO::ERRMODE_EXCEPTION);
    $pdo->exec(
        'CREATE TABLE IF NOT EXISTS coupon_overrides (
            code TEXT PRIMARY KEY,
            active INTEGER NOT NULL,
            updated_at TEXT NOT NULL
        )'
    );
    return $pdo;
}

function couponCleanString(mixed $value, int $maxLength): string
{
    $value = is_scalar($value) ? (string)$value : '';
    $value = preg_replace('/[[:cntrl:]]/', '', $value) ?? '';
    $value = trim($value);
    return function_exists('mb_substr')
        ? mb_substr($value, 0, $maxLength, 'UTF-8')
        : substr($value, 0, $maxLength);
}

function couponClientIp(): string
{
    return $_SERVER['REMOTE_ADDR'] ?? '0.0.0.0';
}

function couponEnsureDataDirs(): void
{
    $dataDir = dirname(COUPON_ERROR_LOG_PATH);
    if (!is_dir($dataDir) && !mkdir($dataDir, 0750, true) && !is_dir($dataDir)) {
        throw new RuntimeException('Could not create data directory.');
    }
    if (!is_dir(COUPON_RATE_LIMIT_DIR) && !mkdir(COUPON_RATE_LIMIT_DIR, 0750, true) && !is_dir(COUPON_RATE_LIMIT_DIR)) {
        throw new RuntimeException('Could not create rate limit directory.');
    }
}

function couponLogServerError(Throwable $error): void
{
    $line = gmdate('c') . ' ' . $error->getMessage() . ' ' . $error->getFile() . ':' . $error->getLine() . PHP_EOL;
    error_log($line, 3, COUPON_ERROR_LOG_PATH);
}

function couponJson(array $payload, int $status = 200): void
{
    http_response_code($status);
    header('Content-Type: application/json; charset=utf-8');
    header('X-Content-Type-Options: nosniff');
    echo json_encode($payload, JSON_UNESCAPED_SLASHES);
    exit;
}

final class CouponClientError extends RuntimeException
{
    public int $statusCode;

    public function __construct(string $message, int $statusCode = 400)
    {
        parent::__construct($message);
        $this->statusCode = $statusCode;
    }
}
