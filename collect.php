<?php
declare(strict_types=1);

/**
 * TinyCart analytics/collect endpoint.
 *
 * Use this as `analyticsUrl` for lightweight sendBeacon/fetch keepalive pings.
 * Configure origins, optional API keys, and rate limits before deploy.
 */

const COLLECT_ALLOWED_ORIGINS = [
    'https://example.com',
    'http://localhost:8000',
    'http://127.0.0.1:8000'
];

const COLLECT_API_KEYS = [
    // 'replace-with-a-long-random-key'
];

const COLLECT_DB_PATH = __DIR__ . '/data/collect.sqlite';
const COLLECT_ERROR_LOG_PATH = __DIR__ . '/data/collect_errors.log';
const MAX_PAYLOAD_BYTES = 16 * 1024;
const FAILED_PAYLOAD_MAX_BYTES = 4096;
const COLLECT_RATE_WINDOW_SECONDS = 60;
const COLLECT_RATE_MAX_REQUESTS = 120;

collectMain();

function collectMain(): void
{
    try {
        collectEnsureDataDir();
        collectHandleCors();

        if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
            collectJson(['ok' => true], 204);
        }

        if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
            collectJson(['ok' => false, 'error' => 'Method not allowed'], 405);
        }

        collectRequireApiKeyIfConfigured();
        [$raw, $payload] = collectReadJson();
        $event = collectValidateEvent($payload);

        $pdo = collectDb();
        rateLimit($pdo, collectClientIp());
        collectStoreEvent($pdo, $event);

        collectJson(['ok' => true]);
    } catch (CollectClientError $error) {
        collectJson(['ok' => false, 'error' => $error->getMessage()], $error->statusCode);
    } catch (Throwable $error) {
        collectLogServerError($error);
        collectJson(['ok' => false, 'error' => 'Unable to store event.'], 500);
    }
}

function collectHandleCors(): void
{
    $origin = $_SERVER['HTTP_ORIGIN'] ?? '';
    if ($origin === '') {
        return;
    }

    if (!in_array($origin, COLLECT_ALLOWED_ORIGINS, true)) {
        throw new CollectClientError('Origin not allowed', 403);
    }

    header('Access-Control-Allow-Origin: ' . $origin);
    header('Vary: Origin');
    header('Access-Control-Allow-Methods: POST, OPTIONS');
    header('Access-Control-Allow-Headers: Content-Type, X-API-KEY');
    header('Access-Control-Max-Age: 600');
}

function collectRequireApiKeyIfConfigured(): void
{
    if (count(COLLECT_API_KEYS) === 0) {
        return;
    }

    $provided = $_SERVER['HTTP_X_API_KEY'] ?? '';
    foreach (COLLECT_API_KEYS as $allowed) {
        if (hash_equals($allowed, $provided)) {
            return;
        }
    }
    throw new CollectClientError('Unauthorized', 401);
}

function collectDb(): PDO
{
    $pdo = new PDO('sqlite:' . COLLECT_DB_PATH);
    $pdo->setAttribute(PDO::ATTR_ERRMODE, PDO::ERRMODE_EXCEPTION);
    $pdo->exec(
        'CREATE TABLE IF NOT EXISTS collect_events (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            event_type TEXT NOT NULL,
            cart_key TEXT NOT NULL,
            currency TEXT,
            payload_json TEXT NOT NULL,
            origin TEXT,
            ip_hash TEXT NOT NULL,
            user_agent TEXT,
            client_ts TEXT,
            created_at TEXT NOT NULL
        )'
    );
    $pdo->exec(
        'CREATE TABLE IF NOT EXISTS failed_payloads (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            reason TEXT NOT NULL,
            raw_payload TEXT NOT NULL,
            origin TEXT,
            ip_hash TEXT NOT NULL,
            created_at TEXT NOT NULL
        )'
    );
    $pdo->exec(
        'CREATE TABLE IF NOT EXISTS rate_limits (
            bucket TEXT PRIMARY KEY,
            window_start INTEGER NOT NULL,
            count INTEGER NOT NULL
        )'
    );
    return $pdo;
}

function rateLimit(PDO $pdo, string $ip): void
{
    $bucket = hash('sha256', $ip);
    $now = time();
    $windowStart = $now - COLLECT_RATE_WINDOW_SECONDS;

    $pdo->beginTransaction();
    try {
        $delete = $pdo->prepare('DELETE FROM rate_limits WHERE window_start < :window_start');
        $delete->execute([':window_start' => $windowStart]);

        $select = $pdo->prepare('SELECT window_start, count FROM rate_limits WHERE bucket = :bucket');
        $select->execute([':bucket' => $bucket]);
        $row = $select->fetch(PDO::FETCH_ASSOC);

        if (!$row || ((int)$row['window_start'] + COLLECT_RATE_WINDOW_SECONDS) <= $now) {
            $upsert = $pdo->prepare(
                'INSERT INTO rate_limits (bucket, window_start, count)
                 VALUES (:bucket, :window_start, 1)
                 ON CONFLICT(bucket) DO UPDATE SET window_start = excluded.window_start, count = 1'
            );
            $upsert->execute([':bucket' => $bucket, ':window_start' => $now]);
        } else {
            $count = (int)$row['count'] + 1;
            if ($count > COLLECT_RATE_MAX_REQUESTS) {
                $pdo->rollBack();
                throw new CollectClientError('Too many requests', 429);
            }
            $update = $pdo->prepare('UPDATE rate_limits SET count = :count WHERE bucket = :bucket');
            $update->execute([':count' => $count, ':bucket' => $bucket]);
        }

        $pdo->commit();
    } catch (Throwable $error) {
        if ($pdo->inTransaction()) {
            $pdo->rollBack();
        }
        throw $error;
    }
}

function collectReadJson(): array
{
    $raw = file_get_contents('php://input');
    if ($raw === false) {
        throw new CollectClientError('Invalid payload', 400);
    }

    if (strlen($raw) > MAX_PAYLOAD_BYTES) {
        throw new CollectClientError('Payload too large', 413);
    }

    $payload = json_decode($raw, true);
    if (!is_array($payload)) {
        throw new CollectClientError('Invalid JSON', 400);
    }

    return [$raw, $payload];
}

function collectValidateEvent(array $payload): array
{
    $type = collectCleanString($payload['type'] ?? '', 80);
    $cartKey = collectCleanString($payload['cartKey'] ?? '', 80);
    $currency = collectCleanString($payload['currency'] ?? '', 8);
    $clientTs = collectCleanString($payload['ts'] ?? '', 40);
    $eventPayload = $payload['payload'] ?? [];

    if ($type === '' || $cartKey === '' || !is_array($eventPayload)) {
        throw new CollectClientError('Invalid event', 400);
    }

    return [
        'type' => $type,
        'cart_key' => $cartKey,
        'currency' => $currency,
        'client_ts' => $clientTs,
        'payload_json' => json_encode($eventPayload, JSON_UNESCAPED_SLASHES),
    ];
}

function collectStoreEvent(PDO $pdo, array $event): void
{
    $insert = $pdo->prepare(
        'INSERT INTO collect_events (
            event_type, cart_key, currency, payload_json, origin, ip_hash, user_agent, client_ts, created_at
        ) VALUES (
            :event_type, :cart_key, :currency, :payload_json, :origin, :ip_hash, :user_agent, :client_ts, :created_at
        )'
    );
    $insert->execute([
        ':event_type' => $event['type'],
        ':cart_key' => $event['cart_key'],
        ':currency' => $event['currency'],
        ':payload_json' => $event['payload_json'],
        ':origin' => $_SERVER['HTTP_ORIGIN'] ?? '',
        ':ip_hash' => hash('sha256', collectClientIp()),
        ':user_agent' => collectCleanString($_SERVER['HTTP_USER_AGENT'] ?? '', 300),
        ':client_ts' => $event['client_ts'],
        ':created_at' => gmdate('c'),
    ]);
}

function collectStoreFailedPayload(PDO $pdo, string $reason, string $raw): void
{
    $insert = $pdo->prepare(
        'INSERT INTO failed_payloads (reason, raw_payload, origin, ip_hash, created_at)
         VALUES (:reason, :raw_payload, :origin, :ip_hash, :created_at)'
    );
    $insert->execute([
        ':reason' => collectCleanString($reason, 120),
        ':raw_payload' => collectCleanString($raw, FAILED_PAYLOAD_MAX_BYTES),
        ':origin' => $_SERVER['HTTP_ORIGIN'] ?? '',
        ':ip_hash' => hash('sha256', collectClientIp()),
        ':created_at' => gmdate('c'),
    ]);
}

function collectCleanString(mixed $value, int $maxLength): string
{
    $value = is_scalar($value) ? (string)$value : '';
    $value = preg_replace('/[[:cntrl:]]/', '', $value) ?? '';
    $value = trim($value);
    return function_exists('mb_substr')
        ? mb_substr($value, 0, $maxLength, 'UTF-8')
        : substr($value, 0, $maxLength);
}

function collectClientIp(): string
{
    return $_SERVER['REMOTE_ADDR'] ?? '0.0.0.0';
}

function collectEnsureDataDir(): void
{
    $dir = dirname(COLLECT_DB_PATH);
    if (!is_dir($dir) && !mkdir($dir, 0750, true) && !is_dir($dir)) {
        throw new RuntimeException('Could not create data directory.');
    }
}

function collectLogServerError(Throwable $error): void
{
    $line = gmdate('c') . ' ' . $error->getMessage() . ' ' . $error->getFile() . ':' . $error->getLine() . PHP_EOL;
    error_log($line, 3, COLLECT_ERROR_LOG_PATH);
}

function collectJson(array $payload, int $status = 200): void
{
    http_response_code($status);
    header('Content-Type: application/json; charset=utf-8');
    header('X-Content-Type-Options: nosniff');
    echo json_encode($payload, JSON_UNESCAPED_SLASHES);
    exit;
}

final class CollectClientError extends RuntimeException
{
    public int $statusCode;

    public function __construct(string $message, int $statusCode = 400)
    {
        parent::__construct($message);
        $this->statusCode = $statusCode;
    }
}
