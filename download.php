<?php
declare(strict_types=1);

const DOWNLOAD_DB_PATH = __DIR__ . '/data/orders.sqlite';
const DOWNLOAD_RATE_LIMIT_DIR = __DIR__ . '/data/rate_limits';
const DOWNLOAD_RATE_LIMIT_WINDOW_SECONDS = 60;
const DOWNLOAD_RATE_LIMIT_MAX_REQUESTS = 30;
const DOWNLOAD_SECRET = 'replace-with-32-plus-random-bytes';
const DOWNLOAD_MAX_COUNT = 5;
const DOWNLOAD_ALLOW_COD_DUE = false;
const DOWNLOAD_FILES = [
    'ebook-001' => ['name' => 'TinyCart Ebook', 'file' => 'files/ebook.pdf'],
];

downloadMain();

function downloadMain(): void
{
    try {
        if ($_SERVER['REQUEST_METHOD'] !== 'GET') {
            downloadJson(['ok' => false, 'error' => 'Method not allowed'], 405);
        }
        downloadRateLimit(downloadClientIp());
        $orderId = downloadClean($_GET['order'] ?? '', 80);
        $itemId = downloadClean($_GET['item'] ?? '', 120);
        $exp = filter_var($_GET['exp'] ?? null, FILTER_VALIDATE_INT);
        $sig = downloadClean($_GET['sig'] ?? '', 128);
        if ($orderId === '' || $itemId === '' || $exp === false || $sig === '') {
            throw new DownloadError('Invalid download link');
        }
        if ($exp < time()) {
            throw new DownloadError('Download link expired');
        }
        $expected = hash_hmac('sha256', $orderId . '|' . $itemId . '|' . $exp, DOWNLOAD_SECRET);
        if (!hash_equals($expected, $sig)) {
            throw new DownloadError('Invalid download link');
        }

        $pdo = downloadDb();
        downloadEnsureTables($pdo);
        $row = downloadOrderItem($pdo, $orderId, $itemId);
        if (!$row || !downloadPaymentAllowed($row)) {
            throw new DownloadError('Download unavailable');
        }
        if (downloadCount($pdo, $orderId, $itemId) >= DOWNLOAD_MAX_COUNT) {
            throw new DownloadError('Download limit reached');
        }
        $file = downloadFilePath($itemId);
        downloadRecord($pdo, $orderId, $itemId);
        header('Content-Type: ' . (mime_content_type($file) ?: 'application/octet-stream'));
        header('Content-Disposition: attachment; filename="' . basename($file) . '"');
        header('X-Content-Type-Options: nosniff');
        readfile($file);
    } catch (DownloadError $error) {
        downloadJson(['ok' => false, 'error' => $error->getMessage()], 403);
    } catch (Throwable) {
        downloadJson(['ok' => false, 'error' => 'Download unavailable'], 500);
    }
}

function downloadDb(): PDO
{
    $dir = dirname(DOWNLOAD_DB_PATH);
    if (!is_dir($dir)) {
        mkdir($dir, 0755, true);
    }
    $pdo = new PDO('sqlite:' . DOWNLOAD_DB_PATH);
    $pdo->setAttribute(PDO::ATTR_ERRMODE, PDO::ERRMODE_EXCEPTION);
    return $pdo;
}

function downloadEnsureTables(PDO $pdo): void
{
    $pdo->exec('CREATE TABLE IF NOT EXISTS downloads (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        order_id TEXT NOT NULL,
        product_id TEXT NOT NULL,
        downloaded_at TEXT NOT NULL,
        ip_hash TEXT NOT NULL
    )');
}

function downloadOrderItem(PDO $pdo, string $orderId, string $itemId): ?array
{
    $statement = $pdo->prepare(
        'SELECT o.payment_method, o.payment_status, i.product_name
         FROM orders o
         JOIN order_items i ON i.order_id = o.id
         WHERE o.id = :order_id AND i.product_id = :product_id
         LIMIT 1'
    );
    $statement->execute([':order_id' => $orderId, ':product_id' => $itemId]);
    $row = $statement->fetch(PDO::FETCH_ASSOC);
    return is_array($row) ? $row : null;
}

function downloadPaymentAllowed(array $row): bool
{
    if (($row['payment_status'] ?? '') === 'paid') {
        return true;
    }
    return DOWNLOAD_ALLOW_COD_DUE
        && ($row['payment_method'] ?? '') === 'cod'
        && ($row['payment_status'] ?? '') === 'cod_due';
}

function downloadCount(PDO $pdo, string $orderId, string $itemId): int
{
    $statement = $pdo->prepare('SELECT COUNT(*) FROM downloads WHERE order_id = :order_id AND product_id = :product_id');
    $statement->execute([':order_id' => $orderId, ':product_id' => $itemId]);
    return (int)$statement->fetchColumn();
}

function downloadRecord(PDO $pdo, string $orderId, string $itemId): void
{
    $insert = $pdo->prepare('INSERT INTO downloads (order_id, product_id, downloaded_at, ip_hash) VALUES (:order_id, :product_id, :downloaded_at, :ip_hash)');
    $insert->execute([
        ':order_id' => $orderId,
        ':product_id' => $itemId,
        ':downloaded_at' => gmdate('c'),
        ':ip_hash' => hash('sha256', downloadClientIp()),
    ]);
}

function downloadFilePath(string $itemId): string
{
    $relative = DOWNLOAD_FILES[$itemId]['file'] ?? '';
    $base = realpath(__DIR__);
    $absolute = str_starts_with($relative, '/') || preg_match('/^[A-Za-z]:[\\\\\\/]/', $relative);
    $file = realpath($absolute ? $relative : __DIR__ . '/' . $relative);
    if (!$base || !$file || !is_file($file) || (!$absolute && !str_starts_with($file, $base))) {
        throw new DownloadError('Download file missing');
    }
    return $file;
}

function downloadRateLimit(string $key): void
{
    if (!is_dir(DOWNLOAD_RATE_LIMIT_DIR) && !mkdir(DOWNLOAD_RATE_LIMIT_DIR, 0750, true) && !is_dir(DOWNLOAD_RATE_LIMIT_DIR)) {
        throw new RuntimeException('Could not create rate limit directory.');
    }
    $file = DOWNLOAD_RATE_LIMIT_DIR . '/' . hash('sha256', $key) . '.json';
    $now = time();
    $bucket = ['window_start' => $now, 'count' => 0];
    $blocked = false;

    $fp = fopen($file, 'c+');
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
        if (($now - (int)($bucket['window_start'] ?? 0)) >= DOWNLOAD_RATE_LIMIT_WINDOW_SECONDS) {
            $bucket = ['window_start' => $now, 'count' => 0];
        }
        $bucket['count'] = (int)($bucket['count'] ?? 0) + 1;
        if ($bucket['count'] > DOWNLOAD_RATE_LIMIT_MAX_REQUESTS) {
            $blocked = true;
        } else {
            ftruncate($fp, 0);
            rewind($fp);
            fwrite($fp, json_encode($bucket));
        }
    } finally {
        flock($fp, LOCK_UN);
        fclose($fp);
    }

    if ($blocked) {
        downloadJson(['ok' => false, 'error' => 'Too many requests'], 429);
    }
}

function downloadClientIp(): string
{
    return $_SERVER['REMOTE_ADDR'] ?? 'unknown';
}

function downloadClean(mixed $value, int $max): string
{
    return substr(trim(preg_replace('/[\x00-\x1F\x7F]/', '', (string)$value)), 0, $max);
}

function downloadJson(array $payload, int $status): never
{
    http_response_code($status);
    header('Content-Type: application/json; charset=utf-8');
    header('X-Content-Type-Options: nosniff');
    echo json_encode($payload, JSON_UNESCAPED_SLASHES);
    exit;
}

class DownloadError extends RuntimeException {}
